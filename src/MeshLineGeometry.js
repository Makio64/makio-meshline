import { Box3, BufferAttribute, BufferGeometry, Sphere, StaticDrawUsage, StreamDrawUsage, Vector2, Vector3 } from 'three/webgpu'

const MANAGED_ATTRIBUTE_NAMES = new Set( [
	'position',
	'previous',
	'next',
	'side',
	'joinRole',
	'width',
	'uv',
	'progress',
	'endpoint',
	'vertexColor',
] )

// Three r186-r187 keep a replaced vertex or index buffer on the GPU until a JS
// GC collects its attribute, and renderer.info.memory never drops. Rebuilds
// free the buffers they drop through the renderer that last drew the line.
// Storage buffers belong to their compute owner (the culling system swaps one
// in as the index). Interleaved ones are left alone: r186 keys them per
// attribute and r187 per buffer, so a shared GPU buffer can't be freed portably.
const releaseAttribute = ( renderer, attribute ) => {
	if ( !renderer || !attribute || attribute.isInterleavedBufferAttribute || attribute.isStorageBufferAttribute ) return
	try {
		renderer._attributes?.delete?.( attribute )
	} catch {
		// Already released, or its device is gone.
	}
}

// A dynamic line whose point count changes keeps buffers with room to grow.
// The first build and any exact fit stay exact, so only a count that really
// changes pays for headroom; a count far below the capacity gives it back.
const CAPACITY_GROWTH = 1.5
const CAPACITY_SHRINK = 4
const resolveCapacity = ( current, needed, step ) => {
	if ( current === 0 || current === needed ) return needed
	if ( current > needed && current <= needed * CAPACITY_SHRINK ) return current
	return Math.ceil( needed * CAPACITY_GROWTH / step ) * step
}

// The part of a buffer in use: all of it, unless it holds spare capacity.
const usedLengthOf = attribute => attribute._meshLineUsedLength ?? attribute.array.length

// First point whose position differs from the copy the buffer holds of it.
const firstChangedPoint = ( line, positions, pointCount ) => {
	for ( let point = 0, source = 0, target = 0; point < pointCount; point++, source += 3, target += 12 ) {
		if (
			line[source] !== positions[target] ||
			line[source + 1] !== positions[target + 1] ||
			line[source + 2] !== positions[target + 2]
		) return point
	}
	return pointCount
}

/**
 * Replace each sharp corner of a polyline with two cutoff points so the
 * shader-side miter never sees near-hairpin bends. Screen-space meshlines
 * can't faithfully render a single vertex whose two neighbouring segments
 * diverge too far — the bisector collapses and produces bowtie-shaped ribbons
 * at oblique camera angles. Splitting the corner into two gentler bends
 * lets the miter math stay well-conditioned.
 *
 * `dotThreshold` is on `dot(dir_in, dir_out)`: values closer to -1 mean
 * "subdivide only the sharpest corners". Default -0.5 ≈ interior bend < 60°.
 * `alpha` controls how far back along each adjacent segment the cutoff sits.
 */
function subdivideSharpBends( line, isLooped, dotThreshold = -0.5, alpha = 0.001 ) {
	const n = line.length / 3
	if ( n < 3 ) return line

	// Clamp alpha so two adjacent sharp bends can't insert overlapping points.
	const a = Math.max( 0, Math.min( alpha, 0.5 ) )
	let out = null

	const pushOriginalPoint = ( x, y, z ) => {
		if ( out ) out.push( x, y, z )
	}

	const ensureOutput = beforePointIndex => {
		if ( out ) return
		out = []
		for ( let j = 0; j < beforePointIndex * 3; j++ ) {
			out.push( line[j] )
		}
	}

	for ( let i = 0; i < n; i++ ) {
		const x = line[i * 3], y = line[i * 3 + 1], z = line[i * 3 + 2]

		// Endpoints of non-looped polylines have no "bend" to subdivide.
		if ( !isLooped && ( i === 0 || i === n - 1 ) ) {
			pushOriginalPoint( x, y, z )
			continue
		}

		const iPrev = i === 0 ? n - 1 : i - 1
		const iNext = i === n - 1 ? 0 : i + 1
		const px = line[iPrev * 3], py = line[iPrev * 3 + 1], pz = line[iPrev * 3 + 2]
		const nx = line[iNext * 3], ny = line[iNext * 3 + 1], nz = line[iNext * 3 + 2]

		const dx1 = x - px, dy1 = y - py, dz1 = z - pz
		const dx2 = nx - x, dy2 = ny - y, dz2 = nz - z
		const len1 = Math.hypot( dx1, dy1, dz1 )
		const len2 = Math.hypot( dx2, dy2, dz2 )
		if ( len1 < 1e-6 || len2 < 1e-6 ) {
			pushOriginalPoint( x, y, z )
			continue
		}

		const cosAngle = ( dx1 * dx2 + dy1 * dy2 + dz1 * dz2 ) / ( len1 * len2 )
		if ( cosAngle >= dotThreshold ) {
			pushOriginalPoint( x, y, z )
			continue
		}

		ensureOutput( i )
		out.push(
			x + ( px - x ) * a, y + ( py - y ) * a, z + ( pz - z ) * a,
			x + ( nx - x ) * a, y + ( ny - y ) * a, z + ( nz - z ) * a,
		)
	}

	return out ? new Float32Array( out ) : line
}

/**
 * Interior joins that carry a bevel bridge for one stored polyline.
 *
 * An open line skips both endpoints: `previous` collapses onto the first point
 * and `next` onto the last, so those rows carry no incident direction. A looped
 * line's last stored point is the synthetic seam duplicate of point 0, so the
 * seam corner is bridged once, at index 0.
 */
export const countJoinBridges = ( numPoints, isLooped ) => {
	if ( numPoints < 2 ) return 0
	return isLooped ? numPoints - 1 : Math.max( 0, numPoints - 2 )
}

/**
 * Geometry builder that creates the vertex buffers (position, previous, next,
 * side, progress, uv, width, vertex colors) needed for meshline rendering.
 * Supports multi-line batching and efficient in-place position updates.
 */
export class MeshLineGeometry extends BufferGeometry {
	constructor( options = null ) {
		super()
		this.type = 'MeshLine'
		this.isMeshLine = true
		this._renderer = null
		this._seamViews = null // setPositionRange() source viewing the closing-point copies
		if ( options ) this.buildLine( options )
	}

	/**
	 * Remember the renderer that draws this geometry, so rebuilds can free the
	 * GPU buffers they replace. Called by `MeshLine` before each draw.
	 * @param {object} renderer
	 */
	_trackRenderer( renderer ) {
		if ( renderer ) this._renderer = renderer
	}

	/**
	 * Vertices in use: four per point. A dynamic line keeps its buffers when its
	 * point count changes, so `attributes.position.count` can be a larger capacity.
	 * @type {number}
	 */
	get vertexCount() {
		return this._vertexCount ?? 0
	}

	/**
	 * Indices in use, which is also what `drawRange` draws. Past them, a buffer
	 * with spare capacity holds zeros: degenerate triangles.
	 * @type {number}
	 */
	get indexCount() {
		return this._indexCount ?? 0
	}

	// A copy holds the same buffers, spare capacity included.
	copy( source ) {
		super.copy( source )
		this._vertexCount = source._vertexCount ?? source.attributes?.position?.count ?? 0
		this._indexCount = source._indexCount ?? source.index?.count ?? 0
		return this
	}

	/**
	 * Initialize the geometry from configuration options. Creates all needed
	 * buffer attributes based on the `needs*` flags.
	 * @param {import('./index.d.ts').MeshLineConfigureOptions} options
	 */
	buildLine( options = {} ) {
		const previousOptions = this.options ?? {}
		const lines = options.lines !== undefined ? options.lines : ( options.points !== undefined ? options.points : previousOptions.lines )

		const nextOptions = {
			needsPositions: true,
			needsPrevious: true,
			needsNext: true,
			needsUV: false,
			needsSide: true,
			needsProgress: true,
			needsWidth: false,
			needsVertexColor: false,
			needsEndpointMetadata: false,
			smoothSharpBends: false,
			verbose: false,
			dynamic: false,
			closed: false,
			lineWidth: undefined,
			frustumCulled: true,
			widthCallback: null,
			vertexColors: null,
			gpuPositionNode: null,
			positionFn: null,
			previousFn: null,
			nextFn: null,
			join: null,
			usage: undefined,
			...previousOptions,
			...options,
			lines,
		}
		validateGeometryOptions( nextOptions )
		this.options = nextOptions

		this.widthCallback = this.options.widthCallback || null
		// Keep existing attributes across `buildLine()` so same-sized rebuilds can
		// update their buffers in place. Optional managed attributes are reconciled
		// in `build()`; custom attributes remain untouched. The drawn lines and their
		// bookkeeping change once setLines() converted the input: input that fails
		// to convert leaves them drawn.
		this._attrs ||= {}
		this._lineCount ??= 0
		this._lines ||= [] // Store individual line arrays for multi-line mode
		this._rawLineBounds ||= []
		this._rawLineBoundsValid = false
		this._lineLoops ||= [] // Store loop flag for each line
		this._lineSourceIndices ||= [] // Caller batch index of each stored line
		this._lineProgress ||= []
		this._lineArcCaches ||= []
		this._lineVertexOffsets ||= []
		this._lineMaxWidths ||= []
		this._lineWidthScratch ||= []
		this._maxWidthMultiplier ??= 1
		this._boundsWidthPadding = 0
		this._boundsUseMiterPadding = false
		this._boundsMiterLimit = 3
		this._preparedBounds = null
		this._preparedProgressReady = null
		this._preparedProgressTotals = null
		this._isSingleLoopValue = false
		this._buildPrepared ||= { lines: [], loops: [], sourceIndices: [] }
		this._updatePrepared ||= { lines: [], loops: [], sourceIndices: [] }
		this._partialRestoreScratch ||= null
		this.boundingBoxes ||= [] // Bounding box for each line
		if ( lines === undefined ) {
			this.clearGeometry()
			return
		}
		try {
			this.setLines( lines )
		} catch ( error ) {
			// A rejected build keeps the options of the last accepted one.
			this.options = previousOptions
			this.widthCallback = previousOptions.widthCallback || null
			throw error
		}
	}

	/**
	 * Set one or more polylines and rebuild all geometry buffers.
	 * @param {import('./index.d.ts').MultiLinePoints} lines
	 * @param {boolean | boolean[]} [closed] - Optional per-line or global loop flag
	 */
	setLines( lines, closed = undefined ) {

		if ( !lines ) throw new Error( '[MeshLine] Lines data required' )

		const previousClosed = this.options.closed
		if ( closed !== undefined ) this.options.closed = closed
		const needsEndpointMetadata = !!(
			this.options.needsEndpointMetadata ||
			this.options.gpuPositionNode ||
			this.options.positionFn ||
			this.options.previousFn ||
			this.options.nextFn
		)
		const needsArcProgress = !this.options.gpuPositionNode && !!(
			this.options.needsProgress ||
			this.options.needsUV ||
			this.options.needsWidth ||
			needsEndpointMetadata
		)
		this._lineProgress ||= []
		this._buildPrepared ||= { lines: [], loops: [], sourceIndices: [] }
		let prepared
		try {
			prepared = prepareLinesInput(
				lines,
				this.options,
				this._buildPrepared,
				this.options.frustumCulled !== false,
				needsArcProgress ? this._lineProgress : null,
				needsArcProgress
			)
		} catch ( error ) {
			// Input that fails to convert leaves the drawn lines, their source and
			// their loop flags as they were.
			this.options.closed = previousClosed
			throw error
		}

		this._adoptPrepared( prepared, lines )
		// The shape may have changed, so drop what both spare sets still hold
		// beyond reusable closing-point copies.
		releaseSpareLines( this._buildPrepared, this._lines )
		releaseSpareLines( this._updatePrepared, this._lines )
		this._rawLineBoundsValid = false
		if ( this._lineArcCaches ) {
			for ( let i = 0; i < this._lineArcCaches.length; i++ ) {
				if ( this._lineArcCaches[i] ) this._lineArcCaches[i].valid = false
			}
		}
		this._preparedBounds = prepared.bounds || null
		this._preparedProgressReady = prepared.progressReady || null
		this._preparedProgressTotals = prepared.progressTotals || null
		this._isSingleLoopValue = false
		this._lineCount = this._lines.length

		try {
			this.build()
		} catch ( error ) {
			this._lines = []
			this._lineLoops = []
			this._lineSourceIndices = []
			this._lineCount = 0
			this._preparedBounds = null
			this._preparedProgressReady = null
			this._preparedProgressTotals = null
			this.clearGeometry()
			// A rejected build clears the geometry, but the source and loop flags
			// stay those of the last accepted one, as on the surface geometry.
			this.options.closed = previousClosed
			throw error
		}
		this.options.lines = lines
	}

	// Makes a refilled scratch the drawn set. The drawn set and the setPositions()
	// and setLines() scratch sets (lines, loops, sourceIndices and the
	// closing-point copies in loopedScratch) only trade places, so a refill never
	// rewrites a drawn line. The traded set comes back empty but for the copies a
	// refill may reuse, none while a setPositionRange() source still views them.
	_adoptPrepared( prepared, source ) {
		const lines = this._lines
		const loops = this._lineLoops
		const sourceIndices = this._lineSourceIndices
		const seams = this._loopedScratch || []
		this._lines = prepared.lines
		this._lineLoops = prepared.loops
		this._lineSourceIndices = prepared.sourceIndices
		this._loopedScratch = prepared.loopedScratch
		lines.length = 0
		loops.length = 0
		sourceIndices.length = 0
		if ( source === this._seamViews ) seams.length = 0
		else this._seamViews = null
		prepared.lines = lines
		prepared.loops = loops
		prepared.sourceIndices = sourceIndices
		prepared.loopedScratch = seams
	}

	// Helper to set or update buffer attribute efficiently
	setOrUpdateAttribute( name, array, itemSize, usage = StaticDrawUsage, usedLength = undefined ) {
		const existing = this._attrs[name]

		// Check if we can reuse existing attribute (same total size)
		if ( existing && existing.itemSize === itemSize && existing.array.length === array.length && existing.array.constructor === array.constructor && existing.usage === usage ) {
			if ( existing.array !== array ) existing.copyArray( array )
			existing._meshLineUsedLength = usedLength
			markAttributeFullUpdate( existing )
		} else {
			// Create new attribute
			if ( existing ) {
				this.deleteAttribute( name )
				releaseAttribute( this._renderer, existing )
			}
			const attr = new BufferAttribute( array, itemSize )
			attr.setUsage( usage )
			attr._meshLineUsedLength = usedLength
			attr._meshLineFullUpdateRange = { start: 0, count: usedLength ?? array.length }
			this._attrs[name] = attr
			this.setAttribute( name, attr )
		}
	}

	getReusableArray( name, ArrayType, length, itemSize, usage ) {
		const existing = this._attrs[name]
		if (
			existing &&
			existing.itemSize === itemSize &&
			existing.array.length === length &&
			existing.array.constructor === ArrayType &&
			existing.usage === usage
		) {
			return existing.array
		}
		return new ArrayType( length )
	}

	deleteUnusedAttribute( name, array ) {
		if ( array || !this._attrs[name] ) return
		this.deleteAttribute( name )
		releaseAttribute( this._renderer, this._attrs[name] )
		delete this._attrs[name]
	}

	setUsage( usage, name = null ) {
		for ( const [attrName, attr] of Object.entries( this._attrs ) ) {
			if ( ( name != null && attrName !== name ) || attr.usage === usage ) continue
			const replacement = attr.clone().setUsage( usage )
			this._attrs[attrName] = replacement
			this.setAttribute( attrName, replacement )
			releaseAttribute( this._renderer, attr )
		}
	}

	// build geometry for multiple lines from separate line arrays
	build() {
		const lines = this._lines
		const lineLoops = this._lineLoops
		if ( !lines || lines.length === 0 ) {
			this.clearGeometry()
			return
		}
		this._maxWidthMultiplier = 1
		this._lineMaxWidths ||= []

		const usage = this.options.usage ?? ( this.options.dynamic === true ? StreamDrawUsage : StaticDrawUsage )

		// Calculate total vertices and indices needed
		let totalVertices = 0
		let totalIndices = 0
		const previousTopology = this._linePointCounts
		const nextTopology = this._linePointCountsScratch || []
		let topologyMatches = previousTopology?.length === lines.length

		// Bevel join fill reuses each point's already-emitted incoming/outgoing
		// rows, so it adds indices but never vertices. It is opt-in because it
		// changes `index.count`, which callers and `toNonIndexed()` can observe.
		const joinType = typeof this.options.join === 'string' ? this.options.join : this.options.join?.type
		const bevelJoins = joinType === 'bevel'
		const bevelJoinsChanged = this._bevelJoins !== bevelJoins
		if ( bevelJoinsChanged ) topologyMatches = false
		this._bevelJoins = bevelJoins
		this._lineIndexCounts = this._lineIndexCounts || []
		this._lineVertexOffsets = this._lineVertexOffsets || []

		for ( let lineIndex = 0; lineIndex < lines.length; lineIndex++ ) {
			const line = lines[lineIndex]
			const numPoints = line.length / 3
			// Bridge topology depends on the loop flag too, and a `gpuPositionNode`
			// line keeps its point count when `closed` flips (no seam point is
			// appended), so fold the flag into the signature or stale connectivity
			// gets reused with the seam bridge missing.
			const topologyKey = lineLoops[lineIndex] ? -numPoints : numPoints
			nextTopology[lineIndex] = topologyKey
			if ( topologyMatches && previousTopology[lineIndex] !== topologyKey ) topologyMatches = false
			this._lineVertexOffsets[lineIndex] = totalVertices
			let lineIndices = 0
			if ( numPoints >= 2 ) {
				totalVertices += numPoints * 4
				lineIndices = ( numPoints - 1 ) * 6
				if ( bevelJoins ) lineIndices += countJoinBridges( numPoints, lineLoops[lineIndex] ) * 6
			}
			this._lineIndexCounts[lineIndex] = lineIndices
			totalIndices += lineIndices
		}
		nextTopology.length = lines.length
		this._lineIndexCounts.length = lines.length
		this._lineVertexOffsets.length = lines.length
		if ( previousTopology && !topologyMatches ) this._removeCustomVertexAttributes()

		if ( totalVertices === 0 ) {
			this.clearGeometry()
			return
		}

		// Later point counts that fit the capacity reuse these buffers, and the
		// draw range hides the unused tail (see resolveCapacity()).
		const growable = usage !== StaticDrawUsage
		const vertexCapacity = growable ? resolveCapacity( this._attrs.joinRole?.count ?? 0, totalVertices, 4 ) : totalVertices
		const sparseVertices = vertexCapacity !== totalVertices
		const used = itemSize => sparseVertices ? totalVertices * itemSize : undefined

		// Initialize arrays
		let positions, previous, next, sides, joinRoles, widths, uvs, progress, endpoints, colors
		const needsEndpointMetadata = !!(
			this.options.needsEndpointMetadata ||
			this.options.gpuPositionNode ||
			this.options.positionFn ||
			this.options.previousFn ||
			this.options.nextFn
		)
		const needsLineProgress = !!(
			this.options.gpuPositionNode ||
			this.options.needsProgress ||
			this.options.needsUV ||
			this.options.needsWidth ||
			needsEndpointMetadata
		)
		const proceduralProgress = !!this.options.gpuPositionNode
		if ( this.options.needsPositions ) {
			positions = this.getReusableArray( 'position', Float32Array, vertexCapacity * 3, 3, usage )
		}
		if ( this.options.needsPrevious ) {
			previous = this.getReusableArray( 'previous', Float32Array, vertexCapacity * 3, 3, usage )
		}
		if ( this.options.needsNext ) {
			next = this.getReusableArray( 'next', Float32Array, vertexCapacity * 3, 3, usage )
		}
		if ( this.options.needsSide ) {
			sides = this.getReusableArray( 'side', Float32Array, vertexCapacity, 1, usage )
		}
		// Both hold one repeating pattern whatever the topology, so a reused
		// buffer is already filled and uploaded.
		const reuseSides = !!( sides && sides === this._attrs.side?.array )
		// Pack incident-body ownership in the sign and side in the magnitude.
		// Unlike vertexIndex-derived bits, this survives toNonIndexed().
		joinRoles = this.getReusableArray( 'joinRole', Float32Array, vertexCapacity, 1, usage )
		const reuseJoinRoles = joinRoles === this._attrs.joinRole?.array
		if ( this.options.needsWidth ) {
			widths = this.getReusableArray( 'width', Float32Array, vertexCapacity, 1, usage )
		}
		if ( this.options.needsUV ) {
			uvs = this.getReusableArray( 'uv', Float32Array, vertexCapacity * 2, 2, usage )
		}
		const reuseUVs = !!( topologyMatches && uvs && uvs === this._attrs.uv?.array )
		if ( this.options.needsProgress ) {
			progress = this.getReusableArray( 'progress', Float32Array, vertexCapacity, 1, usage )
		}
		if ( needsEndpointMetadata ) {
			endpoints = this.getReusableArray( 'endpoint', Float32Array, vertexCapacity * 4, 4, usage )
		}
		if ( this.options.needsVertexColor && this.options.vertexColors ) {
			colors = this.getReusableArray( 'vertexColor', Float32Array, vertexCapacity * 3, 3, usage )
		}

		this.deleteUnusedAttribute( 'position', positions )
		this.deleteUnusedAttribute( 'previous', previous )
		this.deleteUnusedAttribute( 'next', next )
		this.deleteUnusedAttribute( 'side', sides )
		this.deleteUnusedAttribute( 'joinRole', joinRoles )
		this.deleteUnusedAttribute( 'width', widths )
		this.deleteUnusedAttribute( 'uv', uvs )
		this.deleteUnusedAttribute( 'progress', progress )
		this.deleteUnusedAttribute( 'endpoint', endpoints )
		this.deleteUnusedAttribute( 'vertexColor', colors )

		if ( sides && !reuseSides ) {
			fillPattern4( sides, 1, -1, 1, -1 )
		}
		if ( !reuseJoinRoles ) {
			fillPattern4( joinRoles, -1, -2, 1, 2 )
		}

		// Use 32-bit indices if we exceed the 16-bit limit (65 535)
		// This prevents index overflow that can lead to wrongly connected segments
		// when drawing very large or detailed geometries.
		const IndicesArray = ( vertexCapacity > 65535 ) ? Uint32Array : Uint16Array
		const oldIndex = this.getIndex()
		const indexCapacity = growable && oldIndex?.itemSize === 1 && oldIndex.array.constructor === IndicesArray
			? resolveCapacity( oldIndex.array.length, totalIndices, 6 )
			: totalIndices
		const usedIndices = indexCapacity !== totalIndices ? totalIndices : undefined
		const reuseIndex = !!(
			oldIndex &&
			oldIndex.itemSize === 1 &&
			oldIndex.array.length === indexCapacity &&
			oldIndex.array.constructor === IndicesArray
		)
		const reuseConnectivity = reuseIndex && topologyMatches && oldIndex === this._meshLineIndex
		const indices = reuseIndex ? oldIndex.array : new IndicesArray( indexCapacity )

		// One open line rebuilt into the buffers it already fills: the points
		// before the first change keep their position and neighbours, so a line
		// that grows or shrinks at its end rewrites and uploads only that end.
		// Only a dynamic line that changed length takes this path: an explicit
		// rebuild of the same points still rewrites everything.
		const previousPoints = previousTopology?.length === 1 ? previousTopology[0] : 0
		const keepsPrefix = growable && lines.length === 1 && !lineLoops[0] &&
			previousPoints >= 2 && previousPoints !== lines[0].length / 3 &&
			!!positions && positions === this._attrs.position?.array &&
			!!previous && previous === this._attrs.previous?.array &&
			!!next && next === this._attrs.next?.array
		const sharedPoints = keepsPrefix ? Math.min( previousPoints, lines[0].length / 3 ) : 0
		const tailStart = keepsPrefix ? Math.max( 0, firstChangedPoint( lines[0], positions, sharedPoints ) - 1 ) : -1

		// Vertex colors hold one RGB triplet per source point, addressed like
		// setPositionRange(): a closed CPU loop's appended seam point has no slot
		// and reuses the line's first color. An array covering every point of a
		// multi-line batch is read from each line's global point start; a shorter
		// one stays a shared pattern that every line reads from its own start.
		const vertexColors = this.options.vertexColors
		const colorSource = colors && ( vertexColors instanceof Float32Array || ( Array.isArray( vertexColors ) && typeof vertexColors[0] === 'number' ) )
			? vertexColors
			: null
		if ( colors && !colorSource ) colors.fill( 0 )
		const syntheticSeams = !proceduralProgress
		let concatenatedColors = false
		if ( colorSource && lines.length > 1 ) {
			let sourcePoints = 0
			for ( let lineIndex = 0; lineIndex < lines.length; lineIndex++ ) {
				sourcePoints += lines[lineIndex].length / 3 - ( syntheticSeams && lineLoops[lineIndex] ? 1 : 0 )
			}
			concatenatedColors = colorSource.length >= sourcePoints * 3
		}
		let colorPointStart = 0

		let vertexOffset = 0
		let indexOffset = 0
		let vertexIndex = 0
		const preparedProgressReady = this._preparedProgressReady
		const preparedProgressTotals = this._preparedProgressTotals
		const widthCallback = this.widthCallback
		const endpointTopologyReusable = !!( topologyMatches && endpoints && endpoints === this._attrs.endpoint?.array )
		const endpointFreshZeroed = !!( endpoints && endpoints !== this._attrs.endpoint?.array )

		// Process each line separately
		for ( let lineIdx = 0; lineIdx < lines.length; lineIdx++ ) {
			const line = lines[lineIdx]
			const isLooped = lineLoops[lineIdx]
			const numPoints = line.length / 3
			const colorStart = concatenatedColors ? colorPointStart : 0
			colorPointStart += numPoints - ( syntheticSeams && isLooped ? 1 : 0 )
			if ( numPoints < 2 ) continue
			const lineVertexOffset = vertexOffset
			let rawTotalLength = !proceduralProgress && preparedProgressTotals ? ( preparedProgressTotals[lineIdx] || 0 ) : 0

			const lineProgress = needsLineProgress
				? ( ( !proceduralProgress && preparedProgressReady?.[lineIdx] && this._lineProgress[lineIdx] )
					? this._lineProgress[lineIdx]
					: computeLineProgress( line, proceduralProgress, this._lineProgress[lineIdx] ) )
				: null
			this._lineProgress[lineIdx] = lineProgress
			let lineMaxWidth = 1
			let progressWrittenWithWidths = false

			if ( widths ) {
				if ( widthCallback ) {
					if ( rawTotalLength > 0 && lineProgress ) {
						if ( progress && !uvs && !endpoints ) {
							lineMaxWidth = writeBuildWidthsAndProgressNormalized(
								widths,
								progress,
								lineProgress,
								1 / rawTotalLength,
								widthCallback,
								numPoints,
								isLooped,
								lineIdx,
								lineVertexOffset
							)
							progressWrittenWithWidths = true
						} else {
							normalizeLineProgress( lineProgress, numPoints, rawTotalLength )
							rawTotalLength = 0
							lineMaxWidth = writeBuildWidths( widths, lineProgress, widthCallback, numPoints, isLooped, lineIdx, lineVertexOffset )
						}
					} else {
						lineMaxWidth = writeBuildWidths( widths, lineProgress, widthCallback, numPoints, isLooped, lineIdx, lineVertexOffset )
					}
					if ( lineMaxWidth > this._maxWidthMultiplier ) this._maxWidthMultiplier = lineMaxWidth
				} else {
					widths.fill( 1, lineVertexOffset, lineVertexOffset + numPoints * 4 )
				}
			}

			if ( colorSource ) {
				writeColorLine( colors, colorSource, colorStart, numPoints, isLooped, lineVertexOffset )
			}

			if ( tailStart > 0 ) {
				writePositionRange( positions, line, lineVertexOffset, tailStart, numPoints )
				writeNeighborRange( line, isLooped, previous, next, lineVertexOffset, tailStart, numPoints )
				vertexOffset = lineVertexOffset + numPoints * 4
			} else if ( positions && previous && next ) {
				vertexOffset = writePositionAndNeighbors( line, isLooped, positions, previous, next, lineVertexOffset )
			} else {
				if ( positions ) writePositionRange( positions, line, lineVertexOffset, 0, numPoints )
				if ( previous || next ) writeNeighborRange( line, isLooped, previous, next, lineVertexOffset, 0, numPoints )
				vertexOffset = lineVertexOffset + numPoints * 4
			}

			if ( !progressWrittenWithWidths ) {
				const endpointCanStreamNormalized = endpoints && ( endpointTopologyReusable || ( endpointFreshZeroed && !isLooped ) )
				if ( rawTotalLength > 0 && endpoints && !endpointCanStreamNormalized ) {
					normalizeLineProgress( lineProgress, numPoints, rawTotalLength )
					rawTotalLength = 0
				}

				if ( rawTotalLength > 0 ) {
					const invTotalLength = 1 / rawTotalLength
					if ( endpoints && !endpointTopologyReusable ) {
						const firstEOffset = lineVertexOffset * 4
						const lastEOffset = firstEOffset + ( numPoints - 1 ) * 16
						endpoints[firstEOffset] = -1; endpoints[firstEOffset + 4] = -1; endpoints[firstEOffset + 8] = -1; endpoints[firstEOffset + 12] = -1
						endpoints[lastEOffset] = 1; endpoints[lastEOffset + 4] = 1; endpoints[lastEOffset + 8] = 1; endpoints[lastEOffset + 12] = 1
					}
					if ( progress && uvs ) {
						if ( reuseUVs ) writeProgressAndUVLineUpdateNormalized( progress, uvs, lineProgress, invTotalLength, lineVertexOffset )
						else writeProgressAndUVLineNormalized( progress, uvs, lineProgress, invTotalLength, lineVertexOffset )
						if ( endpoints ) writeEndpointMetadataUpdateNormalized( endpoints, lineProgress, invTotalLength, isLooped, lineVertexOffset )
					} else if ( progress && endpoints ) {
						writeProgressAndEndpointMetadataUpdateNormalized( progress, endpoints, lineProgress, invTotalLength, isLooped, lineVertexOffset )
					} else {
						if ( progress ) writeScalarLineNormalized( progress, lineProgress, invTotalLength, lineVertexOffset )
						if ( uvs ) {
							if ( reuseUVs ) writeUVLineUpdateNormalized( uvs, lineProgress, invTotalLength, lineVertexOffset )
							else writeUVLineNormalized( uvs, lineProgress, invTotalLength, lineVertexOffset )
						}
						if ( endpoints ) writeEndpointMetadataUpdateNormalized( endpoints, lineProgress, invTotalLength, isLooped, lineVertexOffset )
					}
				} else if ( progress && uvs ) {
					if ( reuseUVs ) writeProgressAndUVLineUpdate( progress, uvs, lineProgress, lineVertexOffset )
					else writeProgressAndUVLine( progress, uvs, lineProgress, lineVertexOffset )
					if ( endpoints ) {
						if ( endpointTopologyReusable ) {
							writeEndpointMetadataUpdate( endpoints, lineProgress, isLooped, lineVertexOffset )
						} else {
							writeEndpointMetadata(
								endpoints,
								lineProgress,
								isLooped,
								lineVertexOffset,
								endpointFreshZeroed && !isLooped
							)
						}
					}
				} else if ( progress && endpoints && endpointCanStreamNormalized ) {
					if ( !endpointTopologyReusable ) {
						const firstEOffset = lineVertexOffset * 4
						const lastEOffset = firstEOffset + ( numPoints - 1 ) * 16
						endpoints[firstEOffset] = -1; endpoints[firstEOffset + 4] = -1; endpoints[firstEOffset + 8] = -1; endpoints[firstEOffset + 12] = -1
						endpoints[lastEOffset] = 1; endpoints[lastEOffset + 4] = 1; endpoints[lastEOffset + 8] = 1; endpoints[lastEOffset + 12] = 1
					}
					writeProgressAndEndpointMetadataUpdate( progress, endpoints, lineProgress, isLooped, lineVertexOffset )
				} else {
					if ( progress ) writeScalarLine( progress, lineProgress, lineVertexOffset )
					if ( uvs ) {
						if ( reuseUVs ) writeUVLineUpdate( uvs, lineProgress, lineVertexOffset )
						else writeUVLine( uvs, lineProgress, lineVertexOffset )
					}
					if ( endpoints ) {
						if ( endpointTopologyReusable ) {
							writeEndpointMetadataUpdate( endpoints, lineProgress, isLooped, lineVertexOffset )
						} else {
							writeEndpointMetadata(
								endpoints,
								lineProgress,
								isLooped,
								lineVertexOffset,
								endpointFreshZeroed && !isLooped
							)
						}
					}
				}
			}
			this._lineMaxWidths[lineIdx] = lineMaxWidth

			// Connectivity is a pure function of each line's point count, loop flag
			// and join type. Preserve the index buffer when that topology is
			// unchanged, even if attributes or source positions are rebuilt.
			if ( !reuseConnectivity ) {
				indexOffset = writeLineIndices( indices, indexOffset, vertexIndex, numPoints, bevelJoins, isLooped )
			}

			vertexIndex += numPoints * 4
		}
		this._lineProgress.length = lines.length
		this._lineMaxWidths.length = lines.length

		// Set attributes
		if ( tailStart > 0 ) {
			for ( const attribute of [this._attrs.position, this._attrs.previous, this._attrs.next] ) {
				attribute._meshLineUsedLength = used( 3 )
				markAttributeUpdateRange( attribute, tailStart * 12, totalVertices * 3 - tailStart * 12 )
			}
		} else {
			if ( positions ) {
				this.setOrUpdateAttribute( 'position', positions, 3, usage, used( 3 ) )
			}
			if ( previous ) {
				this.setOrUpdateAttribute( 'previous', previous, 3, usage, used( 3 ) )
			}
			if ( next ) {
				this.setOrUpdateAttribute( 'next', next, 3, usage, used( 3 ) )
			}
		}
		if ( sides && !reuseSides ) {
			this.setOrUpdateAttribute( 'side', sides, 1, usage, used( 1 ) )
		}
		if ( !reuseJoinRoles ) {
			this.setOrUpdateAttribute( 'joinRole', joinRoles, 1, usage, used( 1 ) )
		}
		if ( widths ) {
			this.setOrUpdateAttribute( 'width', widths, 1, usage, used( 1 ) )
		}
		if ( uvs ) {
			this.setOrUpdateAttribute( 'uv', uvs, 2, usage, used( 2 ) )
		}
		if ( progress ) {
			this.setOrUpdateAttribute( 'progress', progress, 1, usage, used( 1 ) )
		}
		if ( endpoints ) {
			this.setOrUpdateAttribute( 'endpoint', endpoints, 4, usage, used( 4 ) )
		}
		if ( colors ) {
			this.setOrUpdateAttribute( 'vertexColor', colors, 3, usage, used( 3 ) )
		}

		// A reused pattern buffer skips its update above: keep its used length current.
		if ( this._attrs.side ) this._attrs.side._meshLineUsedLength = used( 1 )
		this._attrs.joinRole._meshLineUsedLength = used( 1 )

		// Set indices
		if ( reuseIndex ) {
			oldIndex._meshLineUsedLength = usedIndices
			if ( reuseConnectivity ) {
				// Nothing to upload.
			} else if ( keepsPrefix && !bevelJoins && !bevelJoinsChanged && oldIndex === this._meshLineIndex ) {
				// The body quads of the shared segments are the same indices.
				const sharedIndices = ( sharedPoints - 1 ) * 6
				markAttributeUpdateRange( oldIndex, sharedIndices, totalIndices - sharedIndices )
			} else {
				markAttributeFullUpdate( oldIndex )
			}
		} else {
			this.setIndex( new BufferAttribute( indices, 1 ) )
			this.getIndex()._meshLineUsedLength = usedIndices
		}
		const index = this.getIndex()
		// Indices past the ones in use stay zero, so nothing that reads the whole
		// buffer meets a stale triangle.
		if ( reuseIndex && this._indexCount > totalIndices ) {
			indices.fill( 0, totalIndices, this._indexCount )
			index.addUpdateRange( totalIndices, this._indexCount - totalIndices )
			index.needsUpdate = true
		}
		this._vertexCount = totalVertices
		this._indexCount = totalIndices
		if ( this._meshLineIndex !== index ) releaseAttribute( this._renderer, this._meshLineIndex )
		this._meshLineIndex = index
		this._linePointCounts = nextTopology
		this._linePointCountsScratch = previousTopology || []

		if ( this.options.frustumCulled !== false ) {
			this.computeBoundingBoxes( this._preparedBounds )
			this.computeBoundingSphere( true )
		} else {
			this.boundingBoxes = []
			this.boundingBox = null
			this.boundingSphere = null
		}
		this._preparedBounds = null
		this._preparedProgressReady = null
		this._preparedProgressTotals = null

		this.setDrawRange( 0, usedIndices ?? Infinity )

		// Verbose logging
		if ( this.options.verbose ) {
			const attrs = Object.keys( this._attrs )
			console.log( `[MeshLine] geometry built with attributes: ${attrs.join( ', ' )}` )
		}
	}

	_removeCustomVertexAttributes() {
		for ( const [name, attribute] of Object.entries( this.attributes ) ) {
			if (
				MANAGED_ATTRIBUTE_NAMES.has( name ) ||
				attribute.isInstancedBufferAttribute ||
				attribute.data?.isInstancedInterleavedBuffer
			) continue
			this.deleteAttribute( name )
			releaseAttribute( this._renderer, attribute )
			if ( this._attrs[name] === attribute ) delete this._attrs[name]
		}
	}

	clearGeometry() {
		for ( const name of Object.keys( this.attributes ) ) {
			this.deleteAttribute( name )
		}
		this.setIndex( null )
		for ( const attribute of Object.values( this._attrs || {} ) ) releaseAttribute( this._renderer, attribute )
		releaseAttribute( this._renderer, this._meshLineIndex )
		this._attrs = {}
		this._lineProgress = []
		this._lineArcCaches = null
		this._lineWidthScratch = []
		this._lineMaxWidths = []
		this._linePointCounts = []
		this._linePointCountsScratch = []
		this._vertexCount = 0
		this._indexCount = 0
		this._lineIndexCounts = []
		this._lineVertexOffsets = []
		this._meshLineIndex = null
		this._loopedScratch = null
		this._updatePrepared = null
		this._buildPrepared = null
		this._preparedBounds = null
		this._preparedProgressReady = null
		this._rawLineBoundsValid = false
		this.boundingBoxes = []
		if ( !this.boundingBox ) this.boundingBox = new Box3()
		this.boundingBox.makeEmpty()
		if ( !this.boundingSphere ) this.boundingSphere = new Sphere()
		this.boundingSphere.center.set( 0, 0, 0 )
		this.boundingSphere.radius = 0
		this.setDrawRange( 0, 0 )
	}

	computeBoundingBoxes( preparedBounds = null ) {
		if ( !this._lines || this._lines.length === 0 ) {
			this.boundingBoxes = []
			if ( !this.boundingBox ) this.boundingBox = new Box3()
			this.boundingBox.makeEmpty()
			return
		}
		const padding = this.getBoundingPadding()
		const boxes = this.boundingBoxes || []
		if ( !this.boundingBox ) this.boundingBox = new Box3()
		this.boundingBox.makeEmpty()
		// Unpadded extents stay valid until `_lines` is replaced or mutated, so
		// padding-only changes (lineWidth, miterLimit, sizeAttenuation) skip a
		// full point rescan.
		const rawBounds = this._rawLineBounds ||= []
		const reuseRawBounds = !preparedBounds && this._rawLineBoundsValid && rawBounds.length === this._lines.length
		let gMinX = Infinity, gMinY = Infinity, gMinZ = Infinity
		let gMaxX = -Infinity, gMaxY = -Infinity, gMaxZ = -Infinity
		for ( let idx = 0; idx < this._lines.length; idx++ ) {
			const box = boxes[idx] || new Box3()
			const raw = rawBounds[idx] ||= new Float64Array( 6 )
			if ( !reuseRawBounds ) {
				const bounds = preparedBounds?.[idx]
				if ( bounds ) {
					raw[0] = bounds[0]; raw[1] = bounds[1]; raw[2] = bounds[2]
					raw[3] = bounds[3]; raw[4] = bounds[4]; raw[5] = bounds[5]
				} else {
					box.setFromArray( this._lines[idx] )
					raw[0] = box.min.x
					raw[1] = box.min.y
					raw[2] = box.min.z
					raw[3] = box.max.x
					raw[4] = box.max.y
					raw[5] = box.max.z
				}
			}
			const minX = raw[0] - padding
			const minY = raw[1] - padding
			const minZ = raw[2] - padding
			const maxX = raw[3] + padding
			const maxY = raw[4] + padding
			const maxZ = raw[5] + padding
			const bMin = box.min
			const bMax = box.max
			bMin.x = minX; bMin.y = minY; bMin.z = minZ
			bMax.x = maxX; bMax.y = maxY; bMax.z = maxZ
			if ( minX < gMinX ) gMinX = minX
			if ( minY < gMinY ) gMinY = minY
			if ( minZ < gMinZ ) gMinZ = minZ
			if ( maxX > gMaxX ) gMaxX = maxX
			if ( maxY > gMaxY ) gMaxY = maxY
			if ( maxZ > gMaxZ ) gMaxZ = maxZ
			boxes[idx] = box
		}
		this.boundingBox.min.set( gMinX, gMinY, gMinZ )
		this.boundingBox.max.set( gMaxX, gMaxY, gMaxZ )
		boxes.length = this._lines.length
		rawBounds.length = this._lines.length
		this._rawLineBoundsValid = true
		this.boundingBoxes = boxes
	}

	getBoundingPadding() {
		if ( this.options?.sizeAttenuation === false ) return 0
		const lineWidth = Number( this.options?.lineWidth ?? 0 )
		if ( !Number.isFinite( lineWidth ) || lineWidth <= 0 ) return 0
		const requestedMiterLimit = Number( this.options?.miterLimit ?? 4 )
		const miterLimit = Number.isFinite( requestedMiterLimit ) ? Math.max( 1, Math.min( requestedMiterLimit, 1e6 ) ) : 4
		const maxWidth = Number( this._maxWidthMultiplier ?? 1 )
		// A split fold overlaps past its joint by up to one half width, so its
		// corners sit sqrt(2) half widths out even under a lower miter limit.
		const join = this.options?.join
		const folds = join?.fold !== false && join?.type !== 'bevel'
		const reach = folds ? Math.max( Math.SQRT2, miterLimit ) : Math.max( 1, miterLimit )
		return lineWidth * reach * 0.5 * Math.max( 1, maxWidth )
	}

	computeBoundingBox() {
		if ( !this.attributes.position && this._ownerLine && !this._ownerLine._built && !this._ownerLine._building ) {
			this._ownerLine.ensureBuilt()
			if ( this.boundingBox ) return
		}
		if ( !this.boundingBox ) this.boundingBox = new Box3()
		this.boundingBox.makeEmpty()
		if ( !this.boundingBoxes || this.boundingBoxes.length === 0 ) return
		this.boundingBox.copy( this.boundingBoxes[0] )
		for ( let i = 1; i < this.boundingBoxes.length; i++ ) {
			this.boundingBox.union( this.boundingBoxes[i] )
		}
	}

	computeBoundingSphere( boundingBoxReady = false ) {
		if ( !this.attributes.position && this._ownerLine && !this._ownerLine._built && !this._ownerLine._building ) {
			this._ownerLine.ensureBuilt()
			if ( this.boundingSphere ) return
		}
		if ( !boundingBoxReady ) this.computeBoundingBox()
		if ( !this.boundingSphere ) this.boundingSphere = new Sphere()
		if ( this.boundingBox.isEmpty() ) {
			this.boundingSphere.center.set( 0, 0, 0 )
			this.boundingSphere.radius = 0
			return
		}
		this.boundingBox.getBoundingSphere( this.boundingSphere )
	}

	/**
	 * Release GPU resources and internal attribute references.
	 */
	dispose() {
		this._attrs = {}
		this._lines = []
		this._rawLineBoundsValid = false
		this._lineLoops = []
		this._lineSourceIndices = []
		this._lineProgress = []
		this._lineArcCaches = null
		this._lineWidthScratch = []
		this._lineMaxWidths = []
		this._linePointCounts = []
		this._linePointCountsScratch = []
		this._vertexCount = 0
		this._indexCount = 0
		this._lineIndexCounts = []
		this._lineVertexOffsets = []
		this._meshLineIndex = null
		this._loopedScratch = null
		this._updatePrepared = null
		this._buildPrepared = null
		this._seamViews = null
		this._preparedBounds = null
		this._preparedProgressReady = null
		this._renderer = null
		super.dispose()
	}

	/**
	 * Fast in-place position update without rebuilding geometry structure.
	 * Falls back to `setLines()` if the number of lines or points changes.
	 * @param {import('./index.d.ts').MultiLinePoints} pts
	 * @param {boolean} [updateBounding=false] - Whether to recompute bounding volumes
	 */
	setPositions( pts, updateBounding = false ) {
		if ( !pts ) return

		// Resolve the active buffers before preparing points so validation and
		// arc-length progress can share one source scan on the common update path.
		const positionAttr = this.getAttribute( 'position' )
		if ( !positionAttr ) {
			this.setLines( pts )
			return
		}
		const previousAttr = this.getAttribute( 'previous' )
		const nextAttr = this.getAttribute( 'next' )
		const progressAttr = this.getAttribute( 'progress' )
		const uvAttr = this.getAttribute( 'uv' )
		const widthAttr = this.getAttribute( 'width' )
		const endpointAttr = this.getAttribute( 'endpoint' )
		const needsLineProgress = !!(
			this.options.gpuPositionNode ||
			progressAttr ||
			uvAttr ||
			widthAttr ||
			endpointAttr?.itemSize === 4
		)
		const proceduralProgress = !!this.options.gpuPositionNode
		const progressChanged = needsLineProgress && !proceduralProgress
		const widthCallback = this.widthCallback
		const widthChanged = !!( widthAttr && widthCallback )

		if (
			!proceduralProgress &&
			previousAttr &&
			nextAttr &&
			this._lines.length === 1 &&
			!this._lineLoops[0] &&
			!this.options.closed &&
			!( this.options.smoothSharpBends === true && !this.options.gpuPositionNode ) &&
			pts instanceof Float32Array &&
			pts.length === this._lines[0].length &&
			( !widthChanged || ( progressAttr && !uvAttr && !( endpointAttr?.itemSize === 4 ) ) )
		) {
			if ( !needsLineProgress ) {
				const ok = updateBounding
					? writeOpenValidPositionNeighborsAndBounds( pts, positionAttr.array, previousAttr.array, nextAttr.array )
					: writeOpenValidPositionAndNeighbors( pts, positionAttr.array, previousAttr.array, nextAttr.array )
				if ( ok ) {
					this._lines[0] = pts
					this._rawLineBoundsValid = false
					if ( this._lineArcCaches?.[0] ) this._lineArcCaches[0].valid = false
					this._lineMaxWidths[0] = 1
					this.options.lines = pts
					markAttributeFullUpdate( positionAttr )
					markAttributeFullUpdate( previousAttr )
					markAttributeFullUpdate( nextAttr )
					if ( updateBounding ) {
						this._rawLineBounds ||= []
						const raw = this._rawLineBounds[0] ||= new Float64Array( 6 )
						raw[0] = lastScanMinX; raw[1] = lastScanMinY; raw[2] = lastScanMinZ
						raw[3] = lastScanMaxX; raw[4] = lastScanMaxY; raw[5] = lastScanMaxZ
						this._rawLineBounds.length = 1
						this._rawLineBoundsValid = true
						this.computeBoundingBoxes()
						this.computeBoundingSphere( true )
					}
					return
				}
				writePositionAndNeighbors( this._lines[0], false, positionAttr.array, previousAttr.array, nextAttr.array, 0 )
			} else {
				const numPoints = pts.length / 3
				const lineProgress = this._lineProgress[0]?.length === numPoints
					? this._lineProgress[0]
					: new Float32Array( numPoints )
				this._lineProgress[0] = lineProgress
				const totalLength = updateBounding
					? writeOpenValidPositionNeighborsBoundsAndProgress( pts, positionAttr.array, previousAttr.array, nextAttr.array, lineProgress )
					: writeOpenValidPositionNeighborsAndProgress( pts, positionAttr.array, previousAttr.array, nextAttr.array, lineProgress )
				if ( totalLength > 0 && totalLength < Infinity ) {
					const invTotalLength = 1 / totalLength
					const progressArray = progressAttr ? progressAttr.array : null
					const uvArray = uvAttr ? uvAttr.array : null
					const endpointArray = endpointAttr?.itemSize === 4 ? endpointAttr.array : null
					let lineMaxWidth = 1
					if ( widthChanged ) {
						try {
							lineMaxWidth = writeBuildWidthsAndProgressNormalized(
								widthAttr.array,
								progressArray,
								lineProgress,
								invTotalLength,
								widthCallback,
								numPoints,
								false,
								0,
								0
							)
						} catch ( error ) {
							writePositionAndNeighbors( this._lines[0], false, positionAttr.array, previousAttr.array, nextAttr.array, 0 )
							const restoredProgress = computeLineProgress( this._lines[0], false, lineProgress )
							this._lineProgress[0] = restoredProgress
							writeScalarLine( progressArray, restoredProgress, 0 )
							if ( lastWrittenWidthsPoints > 0 ) {
								const widthArray = widthAttr.array
								for ( let i = 0, vo = 0; i < lastWrittenWidthsPoints; i++, vo += 4 ) {
									const w = Math.abs( widthCallback( restoredProgress[i], i, 0 ) )
									widthArray[vo] = w
									widthArray[vo + 1] = w
									widthArray[vo + 2] = w
									widthArray[vo + 3] = w
								}
							}
							throw error
						}
						this._maxWidthMultiplier = lineMaxWidth > 1 ? lineMaxWidth : 1
					} else if ( progressArray && uvArray ) {
						writeProgressAndUVLineUpdateNormalized( progressArray, uvArray, lineProgress, invTotalLength, 0 )
						if ( endpointArray ) writeEndpointMetadataUpdateNormalized( endpointArray, lineProgress, invTotalLength, false, 0 )
					} else if ( progressArray && endpointArray ) {
						writeProgressAndEndpointMetadataUpdateNormalized( progressArray, endpointArray, lineProgress, invTotalLength, false, 0 )
					} else {
						if ( progressArray ) writeScalarLineNormalized( progressArray, lineProgress, invTotalLength, 0 )
						if ( uvArray ) writeUVLineUpdateNormalized( uvArray, lineProgress, invTotalLength, 0 )
						if ( endpointArray ) writeEndpointMetadataUpdateNormalized( endpointArray, lineProgress, invTotalLength, false, 0 )
					}
					this._lines[0] = pts
					this._rawLineBoundsValid = false
					if ( this._lineArcCaches?.[0] ) this._lineArcCaches[0].valid = false
					this._lineMaxWidths[0] = lineMaxWidth
					this._lineMaxWidths.length = 1
					this.options.lines = pts
					markAttributeFullUpdate( positionAttr )
					markAttributeFullUpdate( previousAttr )
					markAttributeFullUpdate( nextAttr )
					if ( progressAttr ) markAttributeFullUpdate( progressAttr )
					if ( uvAttr ) markAttributeFullUpdate( uvAttr )
					if ( widthChanged ) markAttributeFullUpdate( widthAttr )
					if ( endpointArray ) markAttributeFullUpdate( endpointAttr )
					if ( updateBounding ) {
						this._rawLineBounds ||= []
						const raw = this._rawLineBounds[0] ||= new Float64Array( 6 )
						raw[0] = lastScanMinX; raw[1] = lastScanMinY; raw[2] = lastScanMinZ
						raw[3] = lastScanMaxX; raw[4] = lastScanMaxY; raw[5] = lastScanMaxZ
						this._rawLineBounds.length = 1
						this._rawLineBoundsValid = true
						this.computeBoundingBoxes()
						this.computeBoundingSphere( true )
					}
					return
				}
				writePositionAndNeighbors( this._lines[0], false, positionAttr.array, previousAttr.array, nextAttr.array, 0 )
			}
		} else if (
			!proceduralProgress &&
			!needsLineProgress &&
			!widthChanged &&
			previousAttr &&
			nextAttr &&
			this._lines.length > 1 &&
			Array.isArray( pts ) &&
			pts.length === this._lines.length &&
			pts[0] instanceof Float32Array &&
			!this.options.closed &&
			!( this.options.smoothSharpBends === true && !this.options.gpuPositionNode )
		) {
			const lineCount = this._lines.length
			const oldLines = this._lines
			const lineLoops = this._lineLoops
			const posArray = positionAttr.array
			const prevArray = previousAttr.array
			const nextArray = nextAttr.array
			let vertexOffset = 0
			let failedAt = -1
			if ( updateBounding ) {
				const rawBounds = this._rawLineBounds ||= []
				for ( let i = 0; i < lineCount; i++ ) {
					const line = pts[i]
					const oldLine = oldLines[i]
					if ( !( line instanceof Float32Array ) || line.length !== oldLine.length || lineLoops[i] ) {
						failedAt = i
						break
					}
					if ( !writeOpenValidPositionNeighborsAndBounds( line, posArray, prevArray, nextArray, vertexOffset ) ) {
						failedAt = i
						break
					}
					const raw = rawBounds[i] ||= new Float64Array( 6 )
					raw[0] = lastScanMinX; raw[1] = lastScanMinY; raw[2] = lastScanMinZ
					raw[3] = lastScanMaxX; raw[4] = lastScanMaxY; raw[5] = lastScanMaxZ
					vertexOffset += line.length / 3 * 4
				}
				if ( failedAt === -1 ) {
					const maxWidths = this._lineMaxWidths
					const arcCaches = this._lineArcCaches
					for ( let i = 0; i < lineCount; i++ ) {
						oldLines[i] = pts[i]
						maxWidths[i] = 1
						if ( arcCaches?.[i] ) arcCaches[i].valid = false
					}
					maxWidths.length = lineCount
					rawBounds.length = lineCount
					this._rawLineBoundsValid = true
					this.options.lines = pts
					markAttributeFullUpdate( positionAttr )
					markAttributeFullUpdate( previousAttr )
					markAttributeFullUpdate( nextAttr )
					this.computeBoundingBoxes()
					this.computeBoundingSphere( true )
					return
				}
			} else {
				for ( let i = 0; i < lineCount; i++ ) {
					const line = pts[i]
					const oldLine = oldLines[i]
					if ( !( line instanceof Float32Array ) || line.length !== oldLine.length || lineLoops[i] ) {
						failedAt = i
						break
					}
					if ( !writeOpenValidPositionAndNeighbors( line, posArray, prevArray, nextArray, vertexOffset ) ) {
						failedAt = i
						break
					}
					vertexOffset += line.length / 3 * 4
				}
				if ( failedAt === -1 ) {
					const maxWidths = this._lineMaxWidths
					const arcCaches = this._lineArcCaches
					for ( let i = 0; i < lineCount; i++ ) {
						oldLines[i] = pts[i]
						maxWidths[i] = 1
						if ( arcCaches?.[i] ) arcCaches[i].valid = false
					}
					maxWidths.length = lineCount
					this._rawLineBoundsValid = false
					this.options.lines = pts
					markAttributeFullUpdate( positionAttr )
					markAttributeFullUpdate( previousAttr )
					markAttributeFullUpdate( nextAttr )
					return
				}
			}
			let restoreVertexOffset = 0
			for ( let i = 0; i <= failedAt; i++ ) {
				restoreVertexOffset = writePositionAndNeighbors( oldLines[i], lineLoops[i], posArray, prevArray, nextArray, restoreVertexOffset )
			}
			this._rawLineBoundsValid = false
		}

		this._updatePrepared ||= { lines: [], loops: [], sourceIndices: [] }
		const prepared = prepareLinesInput(
			pts,
			this.options,
			this._updatePrepared,
			updateBounding,
			progressChanged ? this._lineProgress : null,
			progressChanged && !widthChanged
		)
		const newLines = prepared.lines
		const newLoops = prepared.loops

		// Validate we have the same number of lines
		if ( newLines.length !== this._lines.length ) {
			// Fallback to full rebuild if line count changes
			this.setLines( pts )
			return
		}

		// Validate each line has the same number of points and loop state
		for ( let i = 0; i < newLines.length; i++ ) {
			if ( newLines[i].length !== this._lines[i].length || newLoops[i] !== this._lineLoops[i] ) {
				// Fallback to full rebuild if any line changes size or loop topology
				this.setLines( pts )
				return
			}
		}

		const positionsArray = positionAttr.array
		const prevArray = previousAttr ? previousAttr.array : null
		const nextArray = nextAttr ? nextAttr.array : null
		const progressArray = progressAttr ? progressAttr.array : null
		const uvArray = uvAttr ? uvAttr.array : null
		const widthArray = widthAttr ? widthAttr.array : null
		const endpointArray = endpointAttr ? endpointAttr.array : null
		if ( widthArray ) this._lineWidthScratch ||= []

		// Evaluate every callback before mutating live GPU attributes. If a user
		// callback rejects an update, the previously rendered geometry stays valid,
		// and so do the width maxima its bounds are padded by: they collect in
		// scratch and swap in once every line has passed.
		const lineMaxWidths = this._lineMaxWidthsScratch ||= []
		let maxWidthMultiplier = 1
		for ( let lineIdx = 0; lineIdx < newLines.length; lineIdx++ ) {
			const line = newLines[lineIdx]
			const isLooped = newLoops[lineIdx]
			const numPoints = line.length / 3
			const lineProgress = needsLineProgress
				? ( ( proceduralProgress || prepared.progressReady?.[lineIdx] ) && this._lineProgress[lineIdx]
					? this._lineProgress[lineIdx]
					: computeLineProgress( line, proceduralProgress, this._lineProgress[lineIdx] ) )
				: null
			this._lineProgress[lineIdx] = lineProgress

			if ( !widthChanged ) {
				lineMaxWidths[lineIdx] = 1
				continue
			}
			const widths = this._lineWidthScratch[lineIdx]?.length === numPoints
				? this._lineWidthScratch[lineIdx]
				: new Float32Array( numPoints )
			this._lineWidthScratch[lineIdx] = widths
			const lineMaxWidth = evaluateLineWidths( widths, lineProgress, widthCallback, numPoints, isLooped, lineIdx )
			if ( lineMaxWidth > maxWidthMultiplier ) maxWidthMultiplier = lineMaxWidth
			lineMaxWidths[lineIdx] = lineMaxWidth
		}
		if ( widthArray ) {
			this._lineWidthScratch.length = widthChanged ? newLines.length : 0
			this._maxWidthMultiplier = maxWidthMultiplier
		}
		lineMaxWidths.length = newLines.length
		this._lineMaxWidthsScratch = this._lineMaxWidths
		this._lineMaxWidths = lineMaxWidths

		// Process each line
		let globalVertexIndex = 0
		const progressTotals = prepared.progressTotals

		for ( let lineIdx = 0; lineIdx < newLines.length; lineIdx++ ) {
			const line = newLines[lineIdx]
			const isLooped = newLoops[lineIdx]
			const numPoints = line.length / 3
			const lineProgress = this._lineProgress[lineIdx]
			const lineWidths = widthChanged ? this._lineWidthScratch[lineIdx] : null
			const lineVertexOffset = globalVertexIndex
			const rawTotalLength = progressTotals ? progressTotals[lineIdx] : 0

			if ( prevArray && nextArray ) {
				globalVertexIndex = writePositionAndNeighbors(
					line,
					isLooped,
					positionsArray,
					prevArray,
					nextArray,
					globalVertexIndex
				)
				// Derived attributes stream through their own buffers: one tight pass
				// per array beats interleaving every output stream per point, while
				// fusing progress+uv, progress+endpoint, or progress+width avoids extra passes.
				const updateEndpoints = Boolean( endpointArray && endpointAttr.itemSize === 4 )
				if ( progressChanged && widthChanged && progressArray && !uvArray && !updateEndpoints ) {
					writeTwoScalarLines( progressArray, lineProgress, widthArray, lineWidths, lineVertexOffset )
				} else {
					if ( progressChanged ) {
						if ( rawTotalLength > 0 ) {
							const invTotalLength = 1 / rawTotalLength
							if ( progressArray && uvArray ) {
								writeProgressAndUVLineUpdateNormalized( progressArray, uvArray, lineProgress, invTotalLength, lineVertexOffset )
								if ( updateEndpoints ) writeEndpointMetadataUpdateNormalized( endpointArray, lineProgress, invTotalLength, isLooped, lineVertexOffset )
							} else if ( progressArray && updateEndpoints ) {
								writeProgressAndEndpointMetadataUpdateNormalized( progressArray, endpointArray, lineProgress, invTotalLength, isLooped, lineVertexOffset )
							} else {
								if ( progressArray ) writeScalarLineNormalized( progressArray, lineProgress, invTotalLength, lineVertexOffset )
								if ( uvArray ) writeUVLineUpdateNormalized( uvArray, lineProgress, invTotalLength, lineVertexOffset )
								if ( updateEndpoints ) writeEndpointMetadataUpdateNormalized( endpointArray, lineProgress, invTotalLength, isLooped, lineVertexOffset )
							}
						} else if ( progressArray && uvArray ) {
							writeProgressAndUVLineUpdate( progressArray, uvArray, lineProgress, lineVertexOffset )
							if ( updateEndpoints ) writeEndpointMetadataUpdate( endpointArray, lineProgress, isLooped, lineVertexOffset )
						} else if ( progressArray && updateEndpoints ) {
							writeProgressAndEndpointMetadataUpdate( progressArray, endpointArray, lineProgress, isLooped, lineVertexOffset )
						} else {
							if ( progressArray ) writeScalarLine( progressArray, lineProgress, lineVertexOffset )
							if ( uvArray ) writeUVLineUpdate( uvArray, lineProgress, lineVertexOffset )
							if ( updateEndpoints ) writeEndpointMetadataUpdate( endpointArray, lineProgress, isLooped, lineVertexOffset )
						}
					}
					if ( widthChanged ) writeScalarLine( widthArray, lineWidths, lineVertexOffset )
				}
				continue
			}

			if ( rawTotalLength > 0 && lineProgress ) {
				normalizeLineProgress( lineProgress, numPoints, rawTotalLength )
			}

			for ( let i = 0; i < numPoints; i++ ) {
				const o = i * 3
				const x = line[o]
				const y = line[o + 1]
				const z = line[o + 2]

				const vectorOffset = globalVertexIndex * 3
				positionsArray[vectorOffset] = x
				positionsArray[vectorOffset + 1] = y
				positionsArray[vectorOffset + 2] = z
				positionsArray[vectorOffset + 3] = x
				positionsArray[vectorOffset + 4] = y
				positionsArray[vectorOffset + 5] = z
				positionsArray[vectorOffset + 6] = x
				positionsArray[vectorOffset + 7] = y
				positionsArray[vectorOffset + 8] = z
				positionsArray[vectorOffset + 9] = x
				positionsArray[vectorOffset + 10] = y
				positionsArray[vectorOffset + 11] = z

				const t = lineProgress ? lineProgress[i] : 0
				if ( progressArray && progressChanged ) writeScalarPoint( progressArray, globalVertexIndex, t )
				if ( uvArray && progressChanged ) writeUVPoint( uvArray, globalVertexIndex, t )
				if ( widthChanged ) {
					const width = lineWidths[i]
					writeScalarPoint( widthArray, globalVertexIndex, width )
				}
				// previous
				if ( prevArray ) {
					let px, py, pz
					if ( i === 0 ) {
						if ( isLooped ) {
							// Use second-to-last point (before the duplicate closing point)
							const po = ( numPoints - 2 ) * 3
							px = line[po]
							py = line[po + 1]
							pz = line[po + 2]
						} else {
							px = x; py = y; pz = z
						}
					} else {
						const po = ( i - 1 ) * 3
						px = line[po]
						py = line[po + 1]
						pz = line[po + 2]
					}
					prevArray[vectorOffset] = px
					prevArray[vectorOffset + 1] = py
					prevArray[vectorOffset + 2] = pz
					prevArray[vectorOffset + 3] = px
					prevArray[vectorOffset + 4] = py
					prevArray[vectorOffset + 5] = pz
					prevArray[vectorOffset + 6] = px
					prevArray[vectorOffset + 7] = py
					prevArray[vectorOffset + 8] = pz
					prevArray[vectorOffset + 9] = px
					prevArray[vectorOffset + 10] = py
					prevArray[vectorOffset + 11] = pz
				}

				// next
				if ( nextArray ) {
					let nx, ny, nz
					if ( i === numPoints - 1 ) {
						if ( isLooped ) {
							// Use second point (the first real point after the closing duplicate)
							nx = line[3]
							ny = line[4]
							nz = line[5]
						} else {
							nx = x; ny = y; nz = z
						}
					} else {
						const po = ( i + 1 ) * 3
						nx = line[po]
						ny = line[po + 1]
						nz = line[po + 2]
					}
					nextArray[vectorOffset] = nx
					nextArray[vectorOffset + 1] = ny
					nextArray[vectorOffset + 2] = nz
					nextArray[vectorOffset + 3] = nx
					nextArray[vectorOffset + 4] = ny
					nextArray[vectorOffset + 5] = nz
					nextArray[vectorOffset + 6] = nx
					nextArray[vectorOffset + 7] = ny
					nextArray[vectorOffset + 8] = nz
					nextArray[vectorOffset + 9] = nx
					nextArray[vectorOffset + 10] = ny
					nextArray[vectorOffset + 11] = nz
				}

				globalVertexIndex += 4
			}

			if ( endpointArray && endpointAttr.itemSize === 4 && progressChanged ) {
				writeEndpointMetadataUpdate( endpointArray, lineProgress, isLooped, lineVertexOffset )
			}
		}

		// Mark attributes as needing update
		markAttributeFullUpdate( positionAttr )
		if ( previousAttr ) markAttributeFullUpdate( previousAttr )
		if ( nextAttr ) markAttributeFullUpdate( nextAttr )
		if ( progressAttr && progressChanged ) markAttributeFullUpdate( progressAttr )
		if ( uvAttr && progressChanged ) markAttributeFullUpdate( uvAttr )
		if ( widthAttr && widthChanged ) markAttributeFullUpdate( widthAttr )
		if ( endpointAttr?.itemSize === 4 && progressChanged ) markAttributeFullUpdate( endpointAttr )

		// Update cached lines
		this._adoptPrepared( prepared, pts )
		this._rawLineBoundsValid = false
		if ( this._lineArcCaches ) {
			for ( let i = 0; i < this._lineArcCaches.length; i++ ) {
				if ( this._lineArcCaches[i] ) this._lineArcCaches[i].valid = false
			}
		}
		// As in setLines(), the new points become the source that a partial
		// buildLine() rebuilds from.
		this.options.lines = pts

		// Update bounding volumes if requested
		if ( updateBounding ) {
			this.computeBoundingBoxes( prepared.bounds )
			this.computeBoundingSphere( true )
		}
	}

	/**
	 * Update a fixed-size point range without rewriting or uploading the full
	 * position/neighbor buffers. Arc-length-derived attributes still refresh for
	 * the complete affected line because moving one point changes normalized
	 * progress on every following point.
	 * @param {ArrayLike<number> | Array<import('three').Vector2 | import('three').Vector3 | number[]>} pts
	 * @param {number} startPoint
	 * @param {{lineIndex?: number, updateBounding?: boolean}} [options]
	 * @returns {this}
	 */
	setPositionRange( pts, startPoint, { lineIndex = 0, updateBounding = false } = {} ) {
		if ( this.options.smoothSharpBends === true && !this.options.gpuPositionNode ) {
			throw new Error( '[MeshLine] setPositionRange() is unavailable with smoothSharpBends; use setPositions() so generated topology can be rebuilt' )
		}
		if ( !Number.isInteger( lineIndex ) || lineIndex < 0 || lineIndex >= this._lines.length ) {
			throw new RangeError( `[MeshLine] lineIndex ${lineIndex} is outside [0, ${this._lines.length})` )
		}
		if ( !Number.isInteger( startPoint ) || startPoint < 0 ) {
			throw new RangeError( '[MeshLine] startPoint must be a non-negative integer' )
		}

		const range = toFloat32( pts )
		if ( range.length === 0 || range.length % 3 !== 0 ) {
			throw new Error( '[MeshLine] setPositionRange() requires one or more complete xyz points' )
		}
		for ( let i = 0; i < range.length; i++ ) {
			if ( !Number.isFinite( range[i] ) ) {
				throw new Error( `[MeshLine] setPositionRange() received a non-finite component at offset ${i}` )
			}
		}

		const line = this._lines[lineIndex]
		const isLooped = !!this._lineLoops[lineIndex]
		const hasSyntheticSeam = isLooped && !this.options.gpuPositionNode
		const storedPointCount = line.length / 3
		const sourcePointCount = storedPointCount - ( hasSyntheticSeam ? 1 : 0 )
		const rangePointCount = range.length / 3
		const endPoint = startPoint + rangePointCount
		if ( endPoint > sourcePointCount ) {
			throw new RangeError( `[MeshLine] point range [${startPoint}, ${endPoint}) exceeds line ${lineIndex} length ${sourcePointCount}` )
		}
		validatePositionRangeTopology( line, range, startPoint, sourcePointCount, isLooped )

		const positionAttr = this.getAttribute( 'position' )
		if ( !positionAttr ) throw new Error( '[MeshLine] setPositionRange() requires built position data' )
		const previousAttr = this.getAttribute( 'previous' )
		const nextAttr = this.getAttribute( 'next' )
		const progressAttr = this.getAttribute( 'progress' )
		const uvAttr = this.getAttribute( 'uv' )
		const widthAttr = this.getAttribute( 'width' )
		const endpointAttr = this.getAttribute( 'endpoint' )
		const proceduralProgress = !!this.options.gpuPositionNode
		const widthCallback = this.widthCallback
		const needsArcProgress = !proceduralProgress && !!(
			progressAttr ||
			uvAttr ||
			widthCallback ||
			endpointAttr?.itemSize === 4
		)
		const callbackCanReject = !!( widthAttr && widthCallback )
		if ( callbackCanReject && !needsArcProgress ) {
			this._lineWidthScratch ||= []
			const restoreRange = ( this._partialRestoreScratch = this._partialRestoreScratch?.length >= range.length
				? this._partialRestoreScratch
				: new Float32Array( range.length ) ).subarray( 0, range.length )
			restoreRange.set( line.subarray( startPoint * 3, endPoint * 3 ) )
		}

		if ( this._rawLineBoundsValid && this._rawLineBounds?.[lineIndex] ) {
			const raw = this._rawLineBounds[lineIndex]
			let minX = raw[0], minY = raw[1], minZ = raw[2]
			let maxX = raw[3], maxY = raw[4], maxZ = raw[5]
			let canUpdateInPlace = true
			for ( let i = startPoint * 3, end = endPoint * 3; i < end; i += 3 ) {
				const ox = line[i], oy = line[i + 1], oz = line[i + 2]
				if ( ox <= minX || ox >= maxX || oy <= minY || oy >= maxY || oz <= minZ || oz >= maxZ ) {
					canUpdateInPlace = false
					break
				}
			}
			if ( canUpdateInPlace ) {
				for ( let i = 0; i < range.length; i += 3 ) {
					const nx = range[i], ny = range[i + 1], nz = range[i + 2]
					minX = Math.min( minX, nx )
					maxX = Math.max( maxX, nx )
					minY = Math.min( minY, ny )
					maxY = Math.max( maxY, ny )
					minZ = Math.min( minZ, nz )
					maxZ = Math.max( maxZ, nz )
				}
				raw[0] = minX; raw[1] = minY; raw[2] = minZ
				raw[3] = maxX; raw[4] = maxY; raw[5] = maxZ
			} else {
				this._rawLineBoundsValid = false
			}
		} else {
			this._rawLineBoundsValid = false
		}

		let lineVertexOffset = this._lineVertexOffsets?.[lineIndex]
		if ( lineVertexOffset === undefined ) {
			lineVertexOffset = 0
			for ( let i = 0; i < lineIndex; i++ ) lineVertexOffset += this._lines[i].length / 3 * 4
		}

		if ( needsArcProgress || callbackCanReject || ( proceduralProgress && !this._lineProgress[lineIndex] ) ) {
			updatePositionRangeDerivedAttributes(
				this,
				line,
				range,
				startPoint,
				endPoint,
				sourcePointCount,
				storedPointCount,
				isLooped,
				hasSyntheticSeam,
				proceduralProgress,
				needsArcProgress,
				callbackCanReject,
				lineIndex,
				lineVertexOffset,
				positionAttr,
				previousAttr,
				nextAttr,
				progressAttr,
				uvAttr,
				widthAttr,
				endpointAttr,
				widthCallback
			)
		} else {
			if ( this._lineArcCaches?.[lineIndex] ) this._lineArcCaches[lineIndex].valid = false
			line.set( range, startPoint * 3 )
			if ( hasSyntheticSeam && startPoint === 0 ) {
				line.set( line.subarray( 0, 3 ), sourcePointCount * 3 )
			}
			writePositionAndNeighborRanges(
				line,
				isLooped,
				hasSyntheticSeam,
				startPoint,
				endPoint,
				rangePointCount,
				sourcePointCount,
				storedPointCount,
				lineVertexOffset,
				positionAttr,
				previousAttr,
				nextAttr
			)
		}

		const source = rangeEditSource(
			this.options.lines,
			this._seamViews,
			line,
			this._lineSourceIndices[lineIndex],
			sourcePointCount * 3,
			startPoint
		)
		// A new source views the stored closing-point copies. MeshLine keeps it,
		// so _adoptPrepared() does not reuse them while it is the source, and
		// later edits update it in place.
		if ( source !== this.options.lines ) this._seamViews = source
		this.options.lines = source

		if ( updateBounding ) {
			this.computeBoundingBoxes()
			this.computeBoundingSphere( true )
		}
		return this
	}

}

//------------------------------------------------------ HELPERS
// normalize various point inputs into a Float32Array
let warnedNonFloat32 = false

// A flat run of coordinates: Float64Array and the integer arrays convert like a number[].
const isTypedArray = value => ArrayBuffer.isView( value ) && !( value instanceof DataView )

const toFloat32 = pts => {
	if ( pts instanceof Float32Array ) {
		return pts
	}

	if ( pts instanceof BufferGeometry ) {
		const position = pts.getAttribute( 'position' )
		if ( !position || position.itemSize < 2 ) {
			throw new TypeError( '[MeshLine] BufferGeometry requires a position attribute with at least xy components' )
		}
		if ( position.itemSize === 3 && !position.isInterleavedBufferAttribute && position.array instanceof Float32Array ) {
			return position.array
		}
		const result = new Float32Array( position.count * 3 )
		for ( let i = 0; i < position.count; i++ ) {
			result[i * 3] = position.getX( i )
			result[i * 3 + 1] = position.getY( i )
			result[i * 3 + 2] = position.itemSize >= 3 ? position.getZ( i ) : 0
		}
		return result
	}

	if ( !warnedNonFloat32 ) {
		console.warn( `[MeshLine] Use Float32Array for positions to avoid array conversion & get optimal performance` )
		warnedNonFloat32 = true
	}

	if ( Array.isArray( pts ) && typeof pts[0] === 'number' ) {
		return new Float32Array( pts )
	}
	if ( isTypedArray( pts ) ) {
		return new Float32Array( pts )
	}

	// Pre-allocate assuming all points are valid
	const result = new Float32Array( pts.length * 3 )
	let offset = 0

	for ( let i = 0; i < pts.length; i++ ) {
		const p = pts[i]
		if ( p instanceof Vector3 ) {
			result[offset++] = p.x
			result[offset++] = p.y
			result[offset++] = p.z
		} else if ( p instanceof Vector2 ) {
			result[offset++] = p.x
			result[offset++] = p.y
			result[offset++] = 0
		} else if ( Array.isArray( p ) ) {
			result[offset++] = p[0] ?? 0
			result[offset++] = p[1] ?? 0
			result[offset++] = p[2] ?? 0
		} else if ( p && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number' ) {
			result[offset++] = p.x
			result[offset++] = p.y
			result[offset++] = p.z ?? 0
		} else {
			// Invalid points are skipped but warning for the user
			console.warn( `[MeshLine] Invalid point: ${p}` )
		}
	}

	// If we skipped some points, return a correctly sized array
	return offset === result.length ? result : result.slice( 0, offset )
}

const isPointTuple = value => Array.isArray( value ) && typeof value[0] === 'number' && typeof value[1] === 'number' && value.length <= 4

const isPointObject = value => value instanceof Vector3 || value instanceof Vector2 || ( value && typeof value === 'object' && typeof value.x === 'number' && typeof value.y === 'number' )

const isSingleLineArray = value => {
	if ( !Array.isArray( value ) ) return false
	if ( value.length === 0 ) return true
	const first = value[0]
	return typeof first === 'number' || isPointTuple( first ) || isPointObject( first )
}

// A typed array is one line whatever its element type. Read as a batch, its numbers
// would each be an empty line, and the geometry would draw nothing without a word.
const isSingleLineInput = input => isTypedArray( input ) || input instanceof BufferGeometry || isSingleLineArray( input )

const validateGeometryOptions = options => {
	if ( options.lineWidth !== undefined ) {
		const lineWidth = Number( options.lineWidth )
		if ( !Number.isFinite( lineWidth ) || !Number.isFinite( Math.fround( lineWidth ) ) || lineWidth < 0 ) {
			throw new Error( '[MeshLineGeometry] lineWidth must be a Float32-representable non-negative number' )
		}
	}
	if ( options.widthCallback != null && typeof options.widthCallback !== 'function' ) {
		throw new Error( '[MeshLineGeometry] widthCallback must be a function or null' )
	}
	if ( options.smoothSharpBendsAlpha !== undefined ) {
		const alpha = Number( options.smoothSharpBendsAlpha )
		if ( !Number.isFinite( alpha ) || alpha < 0 || alpha > 0.5 ) {
			throw new Error( '[MeshLineGeometry] smoothSharpBendsAlpha must be finite and within [0, 0.5]' )
		}
	}
	if ( options.smoothSharpBendsThreshold !== undefined ) {
		const threshold = Number( options.smoothSharpBendsThreshold )
		if ( !Number.isFinite( threshold ) || threshold < -1 || threshold > 1 ) {
			throw new Error( '[MeshLineGeometry] smoothSharpBendsThreshold must be finite and within [-1, 1]' )
		}
	}
}

const pointsEqual = ( line, a, b ) => {
	return line[a] === line[b] && line[a + 1] === line[b + 1] && line[a + 2] === line[b + 2]
}

const positionRangePointsEqual = ( line, range, startPoint, endPoint, a, b ) => {
	const aSource = a >= startPoint && a < endPoint
		? ( a - startPoint ) * 3
		: a * 3
	const bSource = b >= startPoint && b < endPoint
		? ( b - startPoint ) * 3
		: b * 3
	const aArray = a >= startPoint && a < endPoint ? range : line
	const bArray = b >= startPoint && b < endPoint ? range : line
	return (
		aArray[aSource] === bArray[bSource] &&
		aArray[aSource + 1] === bArray[bSource + 1] &&
		aArray[aSource + 2] === bArray[bSource + 2]
	)
}

const validatePositionRangeTopology = ( line, range, startPoint, sourcePointCount, isLooped ) => {
	const endPoint = startPoint + range.length / 3
	const firstEdge = Math.max( 1, startPoint )
	const lastEdge = Math.min( sourcePointCount - 1, endPoint )
	for ( let edge = firstEdge; edge <= lastEdge; edge++ ) {
		if ( positionRangePointsEqual( line, range, startPoint, endPoint, edge - 1, edge ) ) {
			throw new Error( `[MeshLine] setPositionRange() would create duplicate consecutive points at ${edge - 1} and ${edge}; use setPositions() to rebuild canonical topology` )
		}
	}
	if (
		isLooped &&
		( startPoint === 0 || endPoint === sourcePointCount ) &&
		positionRangePointsEqual( line, range, startPoint, endPoint, sourcePointCount - 1, 0 )
	) {
		throw new Error( '[MeshLine] setPositionRange() would collapse the closing segment; use setPositions() to rebuild canonical topology' )
	}
}

const writeBuildWidths = ( widths, lineProgress, widthCallback, numPoints, isLooped, lineIdx, lineVertexOffset ) => {
	let lineMaxWidth = 1
	const regularEnd = isLooped ? numPoints - 1 : numPoints
	for ( let i = 0, vo = lineVertexOffset; i < regularEnd; i++, vo += 4 ) {
		const rawWidth = widthCallback( lineProgress[i], i, lineIdx )
		const w = Math.abs( rawWidth )
		if ( !( w <= 3.4028234663852886e+38 ) ) {
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIdx}` )
		}
		if ( w > lineMaxWidth ) lineMaxWidth = w
		widths[vo] = w
		widths[vo + 1] = w
		widths[vo + 2] = w
		widths[vo + 3] = w
	}
	if ( isLooped && numPoints > 0 ) {
		const last = numPoints - 1
		const vo = lineVertexOffset + last * 4
		const w = Math.abs( widthCallback( 0, 0, lineIdx ) )
		if ( !( w <= 3.4028234663852886e+38 ) ) {
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${last} of line ${lineIdx}` )
		}
		if ( w > lineMaxWidth ) lineMaxWidth = w
		widths[vo] = w
		widths[vo + 1] = w
		widths[vo + 2] = w
		widths[vo + 3] = w
	}
	return lineMaxWidth
}

// Points a fused writer wrote before widthCallback rejected the line, by a
// non-finite width or a throw, so a rollback restores just those (range edits
// keep theirs in progressState). Loops record it as the rejection leaves,
// since a store per point slows them.
let lastWrittenWidthsPoints = 0

const writeBuildWidthsAndProgressNormalized = (
	widths,
	progressArray,
	lineProgress,
	invTotalLength,
	widthCallback,
	numPoints,
	isLooped,
	lineIdx,
	lineVertexOffset
) => {
	let lineMaxWidth = 1
	const last = numPoints - 1
	lastWrittenWidthsPoints = 0
	const w0 = Math.abs( widthCallback( 0, 0, lineIdx ) )
	if ( !( w0 <= 3.4028234663852886e+38 ) ) {
		throw new Error( `[MeshLine] widthCallback returned a non-finite value at point 0 of line ${lineIdx}` )
	}
	if ( w0 > lineMaxWidth ) lineMaxWidth = w0
	progressArray[lineVertexOffset] = 0
	progressArray[lineVertexOffset + 1] = 0
	progressArray[lineVertexOffset + 2] = 0
	progressArray[lineVertexOffset + 3] = 0
	widths[lineVertexOffset] = w0
	widths[lineVertexOffset + 1] = w0
	widths[lineVertexOffset + 2] = w0
	widths[lineVertexOffset + 3] = w0

	for ( let i = 1, vo = lineVertexOffset + 4; i < last; i++, vo += 4 ) {
		const p = Math.fround( lineProgress[i] * invTotalLength )
		let w
		try {
			w = Math.abs( widthCallback( p, i, lineIdx ) )
		} catch ( error ) {
			lastWrittenWidthsPoints = i
			throw error
		}
		if ( !( w <= 3.4028234663852886e+38 ) ) {
			lastWrittenWidthsPoints = i
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIdx}` )
		}
		if ( w > lineMaxWidth ) lineMaxWidth = w
		progressArray[vo] = p
		progressArray[vo + 1] = p
		progressArray[vo + 2] = p
		progressArray[vo + 3] = p
		widths[vo] = w
		widths[vo + 1] = w
		widths[vo + 2] = w
		widths[vo + 3] = w
	}

	const lastVo = lineVertexOffset + last * 4
	lastWrittenWidthsPoints = last
	const lastW = isLooped
		? Math.abs( widthCallback( 0, 0, lineIdx ) )
		: Math.abs( widthCallback( 1, last, lineIdx ) )
	if ( !( lastW <= 3.4028234663852886e+38 ) ) {
		throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${last} of line ${lineIdx}` )
	}
	if ( lastW > lineMaxWidth ) lineMaxWidth = lastW
	progressArray[lastVo] = 1
	progressArray[lastVo + 1] = 1
	progressArray[lastVo + 2] = 1
	progressArray[lastVo + 3] = 1
	widths[lastVo] = lastW
	widths[lastVo + 1] = lastW
	widths[lastVo + 2] = lastW
	widths[lastVo + 3] = lastW
	lastWrittenWidthsPoints = numPoints
	return lineMaxWidth
}

const evaluateLineWidths = ( widths, lineProgress, widthCallback, numPoints, isLooped, lineIdx ) => {
	let lineMaxWidth = 1
	const regularEnd = isLooped ? numPoints - 1 : numPoints
	for ( let i = 0; i < regularEnd; i++ ) {
		const rawWidth = widthCallback( lineProgress[i], i, lineIdx )
		const width = Math.abs( rawWidth )
		if ( !( width <= 3.4028234663852886e+38 ) ) {
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIdx}` )
		}
		widths[i] = width
		if ( width > lineMaxWidth ) lineMaxWidth = width
	}
	if ( isLooped && numPoints > 0 ) {
		const last = numPoints - 1
		const width = Math.abs( widthCallback( 0, 0, lineIdx ) )
		if ( !( width <= 3.4028234663852886e+38 ) ) {
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${last} of line ${lineIdx}` )
		}
		widths[last] = width
		if ( width > lineMaxWidth ) lineMaxWidth = width
	}
	return lineMaxWidth
}

const MAX_POOLED_BILLBOARD_SEGMENTS_16 = 16383
const MAX_POOLED_BILLBOARD_SEGMENTS_32 = 262144
let billboardQuadTemplate16 = null
let billboardQuadTemplate32 = null

const getBillboardQuadTemplate16 = segmentCount => {
	if ( segmentCount <= 0 || segmentCount > MAX_POOLED_BILLBOARD_SEGMENTS_16 ) return null
	const pool = billboardQuadTemplate16
	const currentSegments = pool ? pool.length / 6 : 0
	if ( currentSegments >= segmentCount ) return pool.subarray( 0, segmentCount * 6 )
	let nextSegments = currentSegments === 0 ? Math.max( segmentCount, 64 ) : Math.max( currentSegments << 1, 1024 )
	while ( nextSegments < segmentCount ) nextSegments <<= 1
	if ( nextSegments > MAX_POOLED_BILLBOARD_SEGMENTS_16 ) nextSegments = MAX_POOLED_BILLBOARD_SEGMENTS_16
	const next = new Uint16Array( nextSegments * 6 )
	const view = next.subarray( 0, segmentCount * 6 )
	if ( pool ) next.set( pool )
	billboardQuadTemplate16 = next
	for ( let s = currentSegments, o = currentSegments * 4, idx = currentSegments * 6; s < nextSegments; s++, o += 4, idx += 6 ) {
		next[idx] = o + 2
		next[idx + 1] = o + 3
		next[idx + 2] = o + 4
		next[idx + 3] = o + 4
		next[idx + 4] = o + 3
		next[idx + 5] = o + 5
	}
	return view
}

const getBillboardQuadTemplate32 = segmentCount => {
	if ( segmentCount <= 0 || segmentCount > MAX_POOLED_BILLBOARD_SEGMENTS_32 ) return null
	const pool = billboardQuadTemplate32
	const currentSegments = pool ? pool.length / 6 : 0
	if ( currentSegments >= segmentCount ) return pool.subarray( 0, segmentCount * 6 )
	let nextSegments = currentSegments === 0 ? Math.max( segmentCount, 64 ) : Math.max( currentSegments << 1, 16384 )
	while ( nextSegments < segmentCount ) nextSegments <<= 1
	if ( nextSegments > MAX_POOLED_BILLBOARD_SEGMENTS_32 ) nextSegments = MAX_POOLED_BILLBOARD_SEGMENTS_32
	const next = new Uint32Array( nextSegments * 6 )
	const view = next.subarray( 0, segmentCount * 6 )
	if ( pool ) next.set( pool )
	billboardQuadTemplate32 = next
	for ( let s = currentSegments, o = currentSegments * 4, idx = currentSegments * 6; s < nextSegments; s++, o += 4, idx += 6 ) {
		next[idx] = o + 2
		next[idx + 1] = o + 3
		next[idx + 2] = o + 4
		next[idx + 3] = o + 4
		next[idx + 4] = o + 3
		next[idx + 5] = o + 5
	}
	return view
}

const writeLineIndices16 = ( indices, indexOffset, vertexIndex, numPoints, bevelJoins, isLooped ) => {
	const segmentCount = numPoints - 1
	if ( segmentCount > 0 ) {
		const template = vertexIndex === 0 ? getBillboardQuadTemplate16( segmentCount ) : null
		if ( template ) {
			indices.set( template, indexOffset )
			indexOffset += template.length
		} else {
			for ( let i = 0, o = vertexIndex; i < segmentCount; i++, o += 4, indexOffset += 6 ) {
				indices[indexOffset] = o + 2
				indices[indexOffset + 1] = o + 3
				indices[indexOffset + 2] = o + 4
				indices[indexOffset + 3] = o + 4
				indices[indexOffset + 4] = o + 3
				indices[indexOffset + 5] = o + 5
			}
		}
	}
	if ( bevelJoins ) {
		const firstJoin = isLooped ? 0 : 1
		for ( let i = firstJoin, o = vertexIndex + firstJoin * 4; i < segmentCount; i++, o += 4, indexOffset += 6 ) {
			indices[indexOffset] = o
			indices[indexOffset + 1] = o + 1
			indices[indexOffset + 2] = o + 2
			indices[indexOffset + 3] = o + 2
			indices[indexOffset + 4] = o + 1
			indices[indexOffset + 5] = o + 3
		}
	}
	return indexOffset
}

const writeLineIndices32 = ( indices, indexOffset, vertexIndex, numPoints, bevelJoins, isLooped ) => {
	const segmentCount = numPoints - 1
	if ( segmentCount > 0 ) {
		const template = vertexIndex === 0 ? getBillboardQuadTemplate32( segmentCount ) : null
		if ( template ) {
			indices.set( template, indexOffset )
			indexOffset += template.length
		} else {
			for ( let i = 0, o = vertexIndex; i < segmentCount; i++, o += 4, indexOffset += 6 ) {
				indices[indexOffset] = o + 2
				indices[indexOffset + 1] = o + 3
				indices[indexOffset + 2] = o + 4
				indices[indexOffset + 3] = o + 4
				indices[indexOffset + 4] = o + 3
				indices[indexOffset + 5] = o + 5
			}
		}
	}
	if ( bevelJoins ) {
		const firstJoin = isLooped ? 0 : 1
		for ( let i = firstJoin, o = vertexIndex + firstJoin * 4; i < segmentCount; i++, o += 4, indexOffset += 6 ) {
			indices[indexOffset] = o
			indices[indexOffset + 1] = o + 1
			indices[indexOffset + 2] = o + 2
			indices[indexOffset + 3] = o + 2
			indices[indexOffset + 4] = o + 1
			indices[indexOffset + 5] = o + 3
		}
	}
	return indexOffset
}

const writeLineIndices = ( indices, indexOffset, vertexIndex, numPoints, bevelJoins, isLooped ) => {
	return indices instanceof Uint32Array
		? writeLineIndices32( indices, indexOffset, vertexIndex, numPoints, bevelJoins, isLooped )
		: writeLineIndices16( indices, indexOffset, vertexIndex, numPoints, bevelJoins, isLooped )
}

let lastScanMinX = 0
let lastScanMinY = 0
let lastScanMinZ = 0
let lastScanMaxX = 0
let lastScanMaxY = 0
let lastScanMaxZ = 0
let lastSanitizedTotalLength = 0

const scanLineBoundsAndProgress = ( line, pointCount, progressTarget ) => {
	let prevX = line[0], prevY = line[1], prevZ = line[2]
	if ( !( prevX - prevX === 0 && prevY - prevY === 0 && prevZ - prevZ === 0 ) ) return -1
	progressTarget[0] = 0
	let minX = prevX, minY = prevY, minZ = prevZ
	let maxX = prevX, maxY = prevY, maxZ = prevZ
	let totalLength = 0
	for ( let i = 1, sourceOffset = 3; i < pointCount; i++, sourceOffset += 3 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( !( distSq > 0 && distSq < Infinity ) ) return -1
		minX = Math.min( minX, x )
		maxX = Math.max( maxX, x )
		minY = Math.min( minY, y )
		maxY = Math.max( maxY, y )
		minZ = Math.min( minZ, z )
		maxZ = Math.max( maxZ, z )
		totalLength += Math.sqrt( distSq )
		progressTarget[i] = totalLength
		prevX = x
		prevY = y
		prevZ = z
	}
	lastScanMinX = minX
	lastScanMinY = minY
	lastScanMinZ = minZ
	lastScanMaxX = maxX
	lastScanMaxY = maxY
	lastScanMaxZ = maxZ
	return totalLength
}

const scanLineProgressOnly = ( line, pointCount, progressTarget ) => {
	let prevX = line[0], prevY = line[1], prevZ = line[2]
	if ( !( prevX - prevX === 0 && prevY - prevY === 0 && prevZ - prevZ === 0 ) ) return -1
	progressTarget[0] = 0
	let totalLength = 0
	for ( let i = 1, sourceOffset = 3; i < pointCount; i++, sourceOffset += 3 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( !( distSq > 0 && distSq < Infinity ) ) return -1
		totalLength += Math.sqrt( distSq )
		progressTarget[i] = totalLength
		prevX = x
		prevY = y
		prevZ = z
	}
	return totalLength
}

const scanLineBoundsOnly = ( line, pointCount ) => {
	let prevX = line[0], prevY = line[1], prevZ = line[2]
	if ( !( prevX - prevX === 0 && prevY - prevY === 0 && prevZ - prevZ === 0 ) ) return false
	let minX = prevX, minY = prevY, minZ = prevZ
	let maxX = prevX, maxY = prevY, maxZ = prevZ
	for ( let i = 1, sourceOffset = 3; i < pointCount; i++, sourceOffset += 3 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( !( distSq > 0 && distSq < Infinity ) ) return false
		minX = Math.min( minX, x )
		maxX = Math.max( maxX, x )
		minY = Math.min( minY, y )
		maxY = Math.max( maxY, y )
		minZ = Math.min( minZ, z )
		maxZ = Math.max( maxZ, z )
		prevX = x
		prevY = y
		prevZ = z
	}
	lastScanMinX = minX
	lastScanMinY = minY
	lastScanMinZ = minZ
	lastScanMaxX = maxX
	lastScanMaxY = maxY
	lastScanMaxZ = maxZ
	return true
}

const scanLineValidOnly = ( line, pointCount ) => {
	let prevX = line[0], prevY = line[1], prevZ = line[2]
	if ( !( prevX - prevX === 0 && prevY - prevY === 0 && prevZ - prevZ === 0 ) ) return false
	for ( let i = 1, sourceOffset = 3; i < pointCount; i++, sourceOffset += 3 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( !( distSq > 0 && distSq < Infinity ) ) return false
		prevX = x
		prevY = y
		prevZ = z
	}
	return true
}

const sanitizeLinePoints = ( line, bounds = null, progressTarget = null, closedSeam = false, deferNormalization = false ) => {
	lastSanitizedTotalLength = 0
	const pointCount = Math.floor( line.length / 3 )
	const expectedProgressCount = closedSeam ? pointCount + 1 : pointCount
	const writeProgress = progressTarget?.length === expectedProgressCount

	// The Float32Array path is the dynamic-update hot path. Validate first and
	// return it directly when no compaction is necessary, avoiding a full-size
	// temporary allocation on every frame.
	if ( line.length % 3 === 0 ) {
		if ( pointCount === 0 ) {
			if ( bounds ) {
				bounds[0] = bounds[1] = bounds[2] = Infinity
				bounds[3] = bounds[4] = bounds[5] = -Infinity
			}
			return line
		}
		if ( bounds && writeProgress ) {
			let totalLength = scanLineBoundsAndProgress( line, pointCount, progressTarget )
			if ( totalLength >= 0 ) {
				bounds[0] = lastScanMinX; bounds[1] = lastScanMinY; bounds[2] = lastScanMinZ
				bounds[3] = lastScanMaxX; bounds[4] = lastScanMaxY; bounds[5] = lastScanMaxZ
				if ( closedSeam ) {
					const lastIdx = ( pointCount - 1 ) * 3
					const dx = line[0] - line[lastIdx]
					const dy = line[1] - line[lastIdx + 1]
					const dz = line[2] - line[lastIdx + 2]
					const seamDistSq = dx * dx + dy * dy + dz * dz
					if ( !( seamDistSq > 0 && seamDistSq < Infinity ) ) return line
					totalLength += Math.sqrt( seamDistSq )
					progressTarget[pointCount] = totalLength
				}
				if ( deferNormalization && totalLength > 0 && totalLength < Infinity ) {
					lastSanitizedTotalLength = totalLength
					progressTarget[expectedProgressCount - 1] = 1
				} else {
					normalizeLineProgress( progressTarget, expectedProgressCount, totalLength )
				}
				return line
			}
		} else if ( writeProgress ) {
			let totalLength = scanLineProgressOnly( line, pointCount, progressTarget )
			if ( totalLength >= 0 ) {
				if ( closedSeam ) {
					const lastIdx = ( pointCount - 1 ) * 3
					const dx = line[0] - line[lastIdx]
					const dy = line[1] - line[lastIdx + 1]
					const dz = line[2] - line[lastIdx + 2]
					const seamDistSq = dx * dx + dy * dy + dz * dz
					if ( !( seamDistSq > 0 && seamDistSq < Infinity ) ) return line
					totalLength += Math.sqrt( seamDistSq )
					progressTarget[pointCount] = totalLength
				}
				if ( deferNormalization && totalLength > 0 && totalLength < Infinity ) {
					lastSanitizedTotalLength = totalLength
					progressTarget[expectedProgressCount - 1] = 1
				} else {
					normalizeLineProgress( progressTarget, expectedProgressCount, totalLength )
				}
				return line
			}
		} else if ( bounds ) {
			if ( scanLineBoundsOnly( line, pointCount ) ) {
				bounds[0] = lastScanMinX; bounds[1] = lastScanMinY; bounds[2] = lastScanMinZ
				bounds[3] = lastScanMaxX; bounds[4] = lastScanMaxY; bounds[5] = lastScanMaxZ
				return line
			}
		} else {
			if ( scanLineValidOnly( line, pointCount ) ) return line
		}
	}

	const result = new Float32Array( pointCount * 3 )
	let offset = 0
	if ( bounds ) {
		bounds[0] = bounds[1] = bounds[2] = Infinity
		bounds[3] = bounds[4] = bounds[5] = -Infinity
	}

	for ( let i = 0; i < pointCount; i++ ) {
		const sourceOffset = i * 3
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) {
			continue
		}

		if ( offset > 0 && result[offset - 3] === x && result[offset - 2] === y && result[offset - 1] === z ) {
			continue
		}

		result[offset++] = x
		result[offset++] = y
		result[offset++] = z
		if ( bounds ) {
			if ( x < bounds[0] ) bounds[0] = x
			if ( y < bounds[1] ) bounds[1] = y
			if ( z < bounds[2] ) bounds[2] = z
			if ( x > bounds[3] ) bounds[3] = x
			if ( y > bounds[4] ) bounds[4] = y
			if ( z > bounds[5] ) bounds[5] = z
		}
	}

	return result.slice( 0, offset )
}

const removeClosingPoint = line => {
	let length = line.length
	while ( length >= 6 && pointsEqual( line, 0, length - 3 ) ) {
		length -= 3
	}
	return length === line.length ? line : line.subarray( 0, length )
}

// Empties a spare container set, keeping only closing-point copies no longer
// than the drawn line at their index.
const releaseSpareLines = ( prepared, drawn ) => {
	if ( !prepared ) return
	prepared.lines.length = 0
	prepared.loops.length = 0
	prepared.sourceIndices.length = 0
	const seams = prepared.loopedScratch
	if ( !seams ) return
	if ( seams.length > drawn.length ) seams.length = drawn.length
	for ( let i = 0; i < seams.length; i++ ) {
		if ( seams[i]?.length > drawn[i].length ) seams[i] = undefined
	}
}

const appendClosingPoint = ( line, reuse = null ) => {
	const targetLen = line.length + 3
	const looped = reuse && reuse.length === targetLen && reuse.buffer !== line.buffer
		? reuse
		: new Float32Array( targetLen )
	looped.set( line )
	looped[line.length] = line[0]
	looped[line.length + 1] = line[1]
	looped[line.length + 2] = line[2]
	return looped
}

const prepareLinesInput = ( input, options, target = null, collectBounds = false, progressTargets = null, deferProgressNormalization = false ) => {
	const prepared = target || { lines: [], loops: [], sourceIndices: [] }
	const lines = prepared.lines
	const loops = prepared.loops
	const sourceIndices = prepared.sourceIndices
	lines.length = 0
	loops.length = 0
	sourceIndices.length = 0
	const boundsList = collectBounds ? ( prepared.bounds ||= [] ) : null
	const progressReady = progressTargets ? ( prepared.progressReady ||= [] ) : null
	const progressTotals = deferProgressNormalization ? ( prepared.progressTotals ||= [] ) : null
	if ( !deferProgressNormalization && prepared.progressTotals ) prepared.progressTotals.length = 0
	const loopedScratch = target ? ( prepared.loopedScratch ||= [] ) : null
	const smooth = options.smoothSharpBends === true && !options.gpuPositionNode
	const dotThreshold = options.smoothSharpBendsThreshold ?? -0.5
	const alpha = options.smoothSharpBendsAlpha ?? 0.001
	const singleLine = isSingleLineInput( input )
	const sourceCount = singleLine ? 1 : ( input?.length ?? 0 )
	const syntheticSeams = !options.gpuPositionNode

	for ( let i = 0; i < sourceCount; i++ ) {
		const points = singleLine ? input : input[i]
		if ( !points || points.length === 0 ) continue

		const requestedLoop = typeof options.closed === 'boolean' ? options.closed : ( options.closed?.[i] ?? false )
		const outputIndex = lines.length
		const lineBounds = boundsList ? ( boundsList[outputIndex] || new Float64Array( 6 ) ) : null
		const converted = toFloat32( points )
		const pointCount = Math.floor( converted.length / 3 )
		const fastClosedSeam = !!(
			requestedLoop &&
			syntheticSeams &&
			!smooth &&
			pointCount >= 3 &&
			converted.length === pointCount * 3 &&
			!pointsEqual( converted, 0, ( pointCount - 1 ) * 3 )
		)
		const canPrepareProgress = !!( progressTargets && !smooth && ( !requestedLoop || fastClosedSeam || !syntheticSeams ) && pointCount >= 2 )
		const expectedProgressCount = fastClosedSeam ? pointCount + 1 : pointCount
		let progressTarget = progressTargets?.[outputIndex] || null
		if ( canPrepareProgress ) {
			if ( !progressTarget || progressTarget.length !== expectedProgressCount ) {
				progressTarget = new Float32Array( expectedProgressCount )
			}
		}
		let line = sanitizeLinePoints(
			converted,
			lineBounds,
			canPrepareProgress ? progressTarget : null,
			fastClosedSeam,
			deferProgressNormalization
		)
		const rawTotalLength = lastSanitizedTotalLength
		let hasPreparedProgress = !!(
			canPrepareProgress &&
			progressTarget &&
			line === converted &&
			( !fastClosedSeam || progressTarget[pointCount] === 1 )
		)
		if ( requestedLoop && !fastClosedSeam ) line = removeClosingPoint( line )
		let isLooped = !!requestedLoop && line.length >= 9

		if ( smooth && line.length >= 9 ) {
			line = sanitizeLinePoints( subdivideSharpBends( line, isLooped, dotThreshold, alpha ), lineBounds )
			hasPreparedProgress = false
			if ( requestedLoop ) line = removeClosingPoint( line )
			isLooped = !!requestedLoop && line.length >= 9
		}

		if ( line.length < 6 ) continue
		if ( isLooped && syntheticSeams ) {
			line = appendClosingPoint( line, loopedScratch?.[outputIndex] )
			if ( loopedScratch ) loopedScratch[outputIndex] = line
		}

		lines.push( line )
		loops.push( isLooped )
		sourceIndices.push( i )
		if ( boundsList ) boundsList[outputIndex] = lineBounds
		if ( hasPreparedProgress ) progressTargets[outputIndex] = progressTarget
		if ( progressReady ) progressReady[outputIndex] = hasPreparedProgress
		if ( progressTotals ) progressTotals[outputIndex] = hasPreparedProgress ? rawTotalLength : 0
	}
	if ( boundsList ) boundsList.length = lines.length
	if ( progressReady ) progressReady.length = lines.length
	if ( progressTotals ) progressTotals.length = lines.length
	if ( loopedScratch ) loopedScratch.length = lines.length

	return prepared
}

// Rebuild source after a setPositionRange() edit. The edit lands in the stored
// line: the caller's array, a shorter view of it when a closing point was
// dropped, or a copy for converted input and closed loops. The source stays
// while it holds the edited points: the stored ones, or the caller's array
// with the closing point it was given, which still copies point 0 unless an
// edit starts there. Otherwise it moves to the stored points without their
// synthetic seam. A caller's batch becomes a copy that changes only that line,
// keeping the others as given and every line at its caller index, so per-line
// `closed` flags still match. Later edits update that copy in place.
const rangeEditSource = ( source, copiedSource, line, sourceIndex, pointsLength, startPoint ) => {
	const singleLine = isSingleLineInput( source )
	const sourceLine = singleLine ? source : source[sourceIndex]
	if ( sourceLine?.buffer === line.buffer && ( sourceLine.length === pointsLength || startPoint > 0 ) ) return source
	const points = pointsLength < line.length ? line.subarray( 0, pointsLength ) : line
	if ( singleLine ) return points
	const batch = source === copiedSource ? source : Array.from( source )
	batch[sourceIndex] = points
	return batch
}

const computeLineProgress = ( line, procedural, target = null ) => {
	const pointCount = line.length / 3
	const result = target?.length === pointCount ? target : new Float32Array( pointCount )
	result[0] = 0
	if ( pointCount < 2 ) return result

	if ( procedural ) {
		const step = 1 / ( pointCount - 1 )
		for ( let i = 1; i < pointCount - 1; i++ ) result[i] = i * step
		result[pointCount - 1] = 1
		return result
	}

	let totalLength = 0
	let prevX = line[0]
	let prevY = line[1]
	let prevZ = line[2]
	for ( let i = 1, offset = 3; i < pointCount; i++, offset += 3 ) {
		const x = line[offset]
		const y = line[offset + 1]
		const z = line[offset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		totalLength += Math.sqrt( dx * dx + dy * dy + dz * dz )
		result[i] = totalLength
		prevX = x
		prevY = y
		prevZ = z
	}

	normalizeLineProgress( result, pointCount, totalLength )
	return result
}

const buildLineArcCache = ( line, pointCount, segLengths, result ) => {
	let totalLength = 0
	let prevX = line[0]
	let prevY = line[1]
	let prevZ = line[2]
	for ( let i = 1, offset = 3; i < pointCount; i++, offset += 3 ) {
		const x = line[offset]
		const y = line[offset + 1]
		const z = line[offset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const segLen = Math.sqrt( dx * dx + dy * dy + dz * dz )
		segLengths[i] = segLen
		totalLength += segLen
		result[i] = totalLength
		prevX = x
		prevY = y
		prevZ = z
	}
	return totalLength
}

const normalizeCachedProgress = ( segLengths, result, last, invTotalLength ) => {
	let acc = 0
	let i = 1
	const end4 = last - 3
	for ( ; i < end4; i += 4 ) {
		const s0 = segLengths[i]
		const s1 = segLengths[i + 1]
		const s2 = segLengths[i + 2]
		const s3 = segLengths[i + 3]
		const s01 = s0 + s1
		const s23 = s2 + s3
		const a0 = acc + s0
		const a1 = acc + s01
		const a2 = a1 + s2
		acc = a1 + s23
		result[i] = a0 * invTotalLength
		result[i + 1] = a1 * invTotalLength
		result[i + 2] = a2 * invTotalLength
		result[i + 3] = acc * invTotalLength
	}
	for ( ; i < last; i++ ) {
		acc += segLengths[i]
		result[i] = acc * invTotalLength
	}
	return acc
}

const normalizeCachedProgressFallback = ( segLengths, result, last ) => {
	const step = 1 / last
	let acc = 0
	for ( let i = 1; i < last; i++ ) {
		acc += segLengths[i]
		result[i] = i * step
	}
	return acc
}

const finalizeLineArcCacheProgress = ( cache, result, last ) => {
	const segLengths = cache.segLengths
	const totalLength = cache.totalLength
	result[0] = 0
	result[last] = 1
	const acc = ( totalLength <= 0 || !Number.isFinite( totalLength ) )
		? normalizeCachedProgressFallback( segLengths, result, last )
		: normalizeCachedProgress( segLengths, result, last, 1 / totalLength )
	cache.totalLength = acc + segLengths[last]
}

const arcCacheStateScratch = { cache: null, normalizedInPlace: false, result: null }
let lastStreamedAcc = 0
let lastStreamedPrevProg = 0
let lastStreamedPrevStep = 0

const rebuildLineArcCache = ( line, pointCount, result, caches, lineIndex ) => {
	const existing = lineIndex < caches.length ? caches[lineIndex] : null
	const segLengths = existing?.segLengths?.length >= pointCount ? existing.segLengths : new Float64Array( pointCount )
	const totalLength = buildLineArcCache( line, pointCount, segLengths, result )
	const nextCache = existing || { pointCount: 0, segLengths: null, totalLength: 0, valid: false }
	nextCache.pointCount = pointCount
	nextCache.segLengths = segLengths
	nextCache.totalLength = totalLength
	nextCache.valid = true
	caches[lineIndex] = nextCache
	normalizeLineProgress( result, pointCount, totalLength )
	arcCacheStateScratch.cache = nextCache
	arcCacheStateScratch.normalizedInPlace = true
	arcCacheStateScratch.result = result
	return arcCacheStateScratch
}

const updateLineArcCacheRange = ( line, startPoint, endPoint, hasSyntheticSeam, target, caches, lineIndex ) => {
	const pointCount = line.length / 3
	const result = target?.length === pointCount ? target : new Float32Array( pointCount )
	result[0] = 0
	if ( pointCount < 2 ) {
		arcCacheStateScratch.cache = null
		arcCacheStateScratch.normalizedInPlace = true
		arcCacheStateScratch.result = result
		return arcCacheStateScratch
	}

	const cache = lineIndex < caches.length ? caches[lineIndex] : null
	const last = pointCount - 1
	if ( !cache || !cache.valid || cache.pointCount !== pointCount ) {
		return rebuildLineArcCache( line, pointCount, result, caches, lineIndex )
	}

	const segLengths = cache.segLengths
	let totalLength = cache.totalLength
	const firstSeg = Math.max( 1, startPoint )
	const lastSeg = Math.min( last, endPoint )
	let prevX = line[( firstSeg - 1 ) * 3]
	let prevY = line[( firstSeg - 1 ) * 3 + 1]
	let prevZ = line[( firstSeg - 1 ) * 3 + 2]
	for ( let i = firstSeg, offset = firstSeg * 3; i <= lastSeg; i++, offset += 3 ) {
		const x = line[offset]
		const y = line[offset + 1]
		const z = line[offset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const segLen = Math.sqrt( dx * dx + dy * dy + dz * dz )
		totalLength += segLen - segLengths[i]
		segLengths[i] = segLen
		prevX = x
		prevY = y
		prevZ = z
	}
	if ( hasSyntheticSeam && startPoint === 0 && lastSeg < last ) {
		const offset = last * 3
		const dx = line[offset] - line[offset - 3]
		const dy = line[offset + 1] - line[offset - 2]
		const dz = line[offset + 2] - line[offset - 1]
		const segLen = Math.sqrt( dx * dx + dy * dy + dz * dz )
		totalLength += segLen - segLengths[last]
		segLengths[last] = segLen
	}

	cache.totalLength = totalLength
	arcCacheStateScratch.cache = cache
	arcCacheStateScratch.normalizedInPlace = false
	arcCacheStateScratch.result = result
	return arcCacheStateScratch
}

const normalizeCachedProgressAndEvaluateWidthsInterior = (
	segLengths,
	progressArray,
	widthArray,
	widthCallback,
	last,
	lineIdx,
	vertexOffset,
	invTotalLength,
	lineMaxWidth,
	progressState
) => {
	let acc = 0
	for ( let i = 1, pOffset = vertexOffset + 4; i < last; i++, pOffset += 4 ) {
		acc += segLengths[i]
		const p = Math.fround( acc * invTotalLength )
		let w
		try {
			w = Math.abs( widthCallback( p, i, lineIdx ) )
		} catch ( error ) {
			progressState.writtenPoints = i
			throw error
		}
		if ( !( w <= 3.4028234663852886e+38 ) ) {
			progressState.writtenPoints = i
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIdx}` )
		}
		widthArray[pOffset] = w
		widthArray[pOffset + 1] = w
		widthArray[pOffset + 2] = w
		widthArray[pOffset + 3] = w
		if ( w > lineMaxWidth ) lineMaxWidth = w
		progressArray[pOffset] = p
		progressArray[pOffset + 1] = p
		progressArray[pOffset + 2] = p
		progressArray[pOffset + 3] = p
	}
	lastStreamedAcc = acc
	return lineMaxWidth
}

const normalizeCachedProgressAndEvaluateWidths = (
	segLengths,
	progressArray,
	widthArray,
	widthCallback,
	numPoints,
	isLooped,
	lineIdx,
	vertexOffset,
	invTotalLength,
	cache,
	progressState
) => {
	let lineMaxWidth = 1
	const last = numPoints - 1
	const regularEnd = isLooped ? last : numPoints

	progressState.writtenPoints = 0
	const w0 = Math.abs( widthCallback( 0, 0, lineIdx ) )
	if ( !( w0 <= 3.4028234663852886e+38 ) ) {
		throw new Error( `[MeshLine] widthCallback returned a non-finite value at point 0 of line ${lineIdx}` )
	}
	widthArray[vertexOffset] = w0
	widthArray[vertexOffset + 1] = w0
	widthArray[vertexOffset + 2] = w0
	widthArray[vertexOffset + 3] = w0
	if ( w0 > lineMaxWidth ) lineMaxWidth = w0
	progressArray[vertexOffset] = 0
	progressArray[vertexOffset + 1] = 0
	progressArray[vertexOffset + 2] = 0
	progressArray[vertexOffset + 3] = 0
	progressState.writtenPoints = 1

	lineMaxWidth = normalizeCachedProgressAndEvaluateWidthsInterior(
		segLengths,
		progressArray,
		widthArray,
		widthCallback,
		last,
		lineIdx,
		vertexOffset,
		invTotalLength,
		lineMaxWidth,
		progressState
	)

	if ( last > 0 ) {
		const lastOffset = vertexOffset + last * 4
		progressState.writtenPoints = last
		const wLast = Math.abs( isLooped ? widthCallback( 0, 0, lineIdx ) : widthCallback( 1, regularEnd - 1, lineIdx ) )
		if ( !( wLast <= 3.4028234663852886e+38 ) ) {
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${last} of line ${lineIdx}` )
		}
		widthArray[lastOffset] = wLast
		widthArray[lastOffset + 1] = wLast
		widthArray[lastOffset + 2] = wLast
		widthArray[lastOffset + 3] = wLast
		if ( wLast > lineMaxWidth ) lineMaxWidth = wLast
		progressArray[lastOffset] = 1
		progressArray[lastOffset + 1] = 1
		progressArray[lastOffset + 2] = 1
		progressArray[lastOffset + 3] = 1
		progressState.writtenPoints = numPoints
	}

	cache.totalLength = lastStreamedAcc + segLengths[last]
	return lineMaxWidth
}

const writeNormalizedCachedProgressInterior = ( segLengths, progressArray, last, invTotalLength, vertexOffset ) => {
	let acc = 0
	for ( let i = 1, pOffset = vertexOffset + 4; i < last; i++, pOffset += 4 ) {
		acc += segLengths[i]
		const p = Math.fround( acc * invTotalLength )
		progressArray[pOffset] = p
		progressArray[pOffset + 1] = p
		progressArray[pOffset + 2] = p
		progressArray[pOffset + 3] = p
	}
	lastStreamedAcc = acc
}

const writeNormalizedCachedProgressLineUpdate = ( segLengths, progressArray, last, invTotalLength, vertexOffset, cache ) => {
	const lastOffset = vertexOffset + last * 4
	progressArray[vertexOffset] = 0
	progressArray[vertexOffset + 1] = 0
	progressArray[vertexOffset + 2] = 0
	progressArray[vertexOffset + 3] = 0
	progressArray[lastOffset] = 1
	progressArray[lastOffset + 1] = 1
	progressArray[lastOffset + 2] = 1
	progressArray[lastOffset + 3] = 1
	writeNormalizedCachedProgressInterior( segLengths, progressArray, last, invTotalLength, vertexOffset )
	cache.totalLength = lastStreamedAcc + segLengths[last]
}

const writeNormalizedCachedProgressAndUVInterior = ( segLengths, progressArray, uvArray, last, invTotalLength, vertexOffset ) => {
	let acc = 0
	for ( let i = 1, pOffset = vertexOffset + 4, uvOffset = vertexOffset * 2 + 8; i < last; i++, pOffset += 4, uvOffset += 8 ) {
		acc += segLengths[i]
		const p = Math.fround( acc * invTotalLength )
		progressArray[pOffset] = p
		progressArray[pOffset + 1] = p
		progressArray[pOffset + 2] = p
		progressArray[pOffset + 3] = p
		uvArray[uvOffset] = p
		uvArray[uvOffset + 2] = p
		uvArray[uvOffset + 4] = p
		uvArray[uvOffset + 6] = p
	}
	lastStreamedAcc = acc
}

const writeNormalizedCachedProgressAndUVLineUpdate = ( segLengths, progressArray, uvArray, last, invTotalLength, vertexOffset, cache ) => {
	const firstPOffset = vertexOffset
	const lastPOffset = firstPOffset + last * 4
	const firstUvOffset = vertexOffset * 2
	const lastUvOffset = firstUvOffset + last * 8
	progressArray[firstPOffset] = 0
	progressArray[firstPOffset + 1] = 0
	progressArray[firstPOffset + 2] = 0
	progressArray[firstPOffset + 3] = 0
	uvArray[firstUvOffset] = 0
	uvArray[firstUvOffset + 2] = 0
	uvArray[firstUvOffset + 4] = 0
	uvArray[firstUvOffset + 6] = 0
	progressArray[lastPOffset] = 1
	progressArray[lastPOffset + 1] = 1
	progressArray[lastPOffset + 2] = 1
	progressArray[lastPOffset + 3] = 1
	uvArray[lastUvOffset] = 1
	uvArray[lastUvOffset + 2] = 1
	uvArray[lastUvOffset + 4] = 1
	uvArray[lastUvOffset + 6] = 1
	writeNormalizedCachedProgressAndUVInterior( segLengths, progressArray, uvArray, last, invTotalLength, vertexOffset )
	cache.totalLength = lastStreamedAcc + segLengths[last]
}

const writeNormalizedCachedProgressAndEndpointInterior = (
	segLengths,
	progressArray,
	endpointArray,
	last,
	invTotalLength,
	firstPOffset,
	firstEOffset,
	firstCurProg,
	firstNextStep
) => {
	let acc = segLengths[1]
	let prevProg = firstCurProg
	let previousStep = firstNextStep
	for ( let k = 2, pOffset = firstPOffset + 4, eOffset = firstEOffset + 16; k < last; k++, pOffset += 4, eOffset += 16 ) {
		acc += segLengths[k]
		const curProg = Math.fround( acc * invTotalLength )
		const nextStep = curProg - prevProg
		progressArray[pOffset] = prevProg
		progressArray[pOffset + 1] = prevProg
		progressArray[pOffset + 2] = prevProg
		progressArray[pOffset + 3] = prevProg
		endpointArray[eOffset + 2] = previousStep; endpointArray[eOffset + 3] = nextStep
		endpointArray[eOffset + 6] = previousStep; endpointArray[eOffset + 7] = nextStep
		endpointArray[eOffset + 10] = previousStep; endpointArray[eOffset + 11] = nextStep
		endpointArray[eOffset + 14] = previousStep; endpointArray[eOffset + 15] = nextStep
		previousStep = nextStep
		prevProg = curProg
	}
	lastStreamedAcc = acc
	lastStreamedPrevProg = prevProg
	lastStreamedPrevStep = previousStep
}

const writeNormalizedCachedProgressAndEndpointMetadataUpdate = (
	segLengths,
	progressArray,
	endpointArray,
	last,
	invTotalLength,
	isLooped,
	vertexOffset,
	cache
) => {
	const firstPOffset = vertexOffset
	const lastPOffset = firstPOffset + last * 4
	const firstEOffset = vertexOffset * 4
	const lastEOffset = firstEOffset + last * 16
	if ( last === 1 ) {
		progressArray[firstPOffset] = 0; progressArray[firstPOffset + 1] = 0
		progressArray[firstPOffset + 2] = 0; progressArray[firstPOffset + 3] = 0
		endpointArray[firstEOffset + 2] = 0; endpointArray[firstEOffset + 3] = 1
		endpointArray[firstEOffset + 6] = 0; endpointArray[firstEOffset + 7] = 1
		endpointArray[firstEOffset + 10] = 0; endpointArray[firstEOffset + 11] = 1
		endpointArray[firstEOffset + 14] = 0; endpointArray[firstEOffset + 15] = 1
		progressArray[lastPOffset] = 1; progressArray[lastPOffset + 1] = 1
		progressArray[lastPOffset + 2] = 1; progressArray[lastPOffset + 3] = 1
		endpointArray[lastEOffset + 2] = 1; endpointArray[lastEOffset + 3] = 0
		endpointArray[lastEOffset + 6] = 1; endpointArray[lastEOffset + 7] = 0
		endpointArray[lastEOffset + 10] = 1; endpointArray[lastEOffset + 11] = 0
		endpointArray[lastEOffset + 14] = 1; endpointArray[lastEOffset + 15] = 0
		cache.totalLength = segLengths[1]
		return
	}

	const firstCurProg = Math.fround( segLengths[1] * invTotalLength )
	const firstNextStep = firstCurProg > 0 ? firstCurProg : 0
	writeNormalizedCachedProgressAndEndpointInterior(
		segLengths,
		progressArray,
		endpointArray,
		last,
		invTotalLength,
		firstPOffset,
		firstEOffset,
		firstCurProg,
		firstNextStep
	)

	const prevProg = lastStreamedPrevProg
	const previousStep = lastStreamedPrevStep
	const nextStep = 1 > prevProg ? 1 - prevProg : 0
	const prevPOffset = lastPOffset - 4
	const prevEOffset = lastEOffset - 16
	progressArray[prevPOffset] = prevProg
	progressArray[prevPOffset + 1] = prevProg
	progressArray[prevPOffset + 2] = prevProg
	progressArray[prevPOffset + 3] = prevProg
	endpointArray[prevEOffset + 2] = previousStep; endpointArray[prevEOffset + 3] = nextStep
	endpointArray[prevEOffset + 6] = previousStep; endpointArray[prevEOffset + 7] = nextStep
	endpointArray[prevEOffset + 10] = previousStep; endpointArray[prevEOffset + 11] = nextStep
	endpointArray[prevEOffset + 14] = previousStep; endpointArray[prevEOffset + 15] = nextStep

	const firstPrevStep = isLooped ? Math.max( 0, 1 - prevProg ) : 0
	progressArray[firstPOffset] = 0
	progressArray[firstPOffset + 1] = 0
	progressArray[firstPOffset + 2] = 0
	progressArray[firstPOffset + 3] = 0
	endpointArray[firstEOffset + 2] = firstPrevStep; endpointArray[firstEOffset + 3] = firstNextStep
	endpointArray[firstEOffset + 6] = firstPrevStep; endpointArray[firstEOffset + 7] = firstNextStep
	endpointArray[firstEOffset + 10] = firstPrevStep; endpointArray[firstEOffset + 11] = firstNextStep
	endpointArray[firstEOffset + 14] = firstPrevStep; endpointArray[firstEOffset + 15] = firstNextStep

	const lastNextStep = isLooped ? Math.max( 0, firstCurProg ) : 0
	progressArray[lastPOffset] = 1
	progressArray[lastPOffset + 1] = 1
	progressArray[lastPOffset + 2] = 1
	progressArray[lastPOffset + 3] = 1
	endpointArray[lastEOffset + 2] = nextStep; endpointArray[lastEOffset + 3] = lastNextStep
	endpointArray[lastEOffset + 6] = nextStep; endpointArray[lastEOffset + 7] = lastNextStep
	endpointArray[lastEOffset + 10] = nextStep; endpointArray[lastEOffset + 11] = lastNextStep
	endpointArray[lastEOffset + 14] = nextStep; endpointArray[lastEOffset + 15] = lastNextStep

	cache.totalLength = lastStreamedAcc + segLengths[last]
}

const normalizeLineProgress = ( result, pointCount, totalLength ) => {
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	result[last] = 1
	if ( totalLength <= 0 || !Number.isFinite( totalLength ) ) {
		const step = 1 / last
		for ( let i = 1; i < last; i++ ) result[i] = i * step
	} else {
		const invTotalLength = 1 / totalLength
		for ( let i = 1; i < last; i++ ) result[i] *= invTotalLength
	}
}

const fillPattern4 = ( array, a, b, c, d ) => {
	const len = array.length
	if ( len < 4 ) return
	array[0] = a
	array[1] = b
	array[2] = c
	array[3] = d
	let filled = 4
	while ( filled < len ) {
		const next = filled << 1
		array.copyWithin( filled, 0, next <= len ? filled : len - filled )
		filled = next
	}
}

const writeColorLine = ( colors, colorSource, colorStart, numPoints, isLooped, vertexOffset ) => {
	const lastLoopedPoint = isLooped ? numPoints - 1 : -1
	const sourceLen = colorSource.length
	for ( let i = 0, vo = vertexOffset * 3; i < numPoints; i++, vo += 12 ) {
		const sourceIndex = i === lastLoopedPoint ? 0 : i
		const colorIndex = colorStart + sourceIndex
		const o = colorIndex * 3
		if ( sourceLen >= o + 3 ) {
			const r = colorSource[o]
			const g = colorSource[o + 1]
			const b = colorSource[o + 2]
			if ( !Number.isFinite( r ) || !Number.isFinite( g ) || !Number.isFinite( b ) ) {
				throw new Error( `[MeshLine] vertexColors contains a non-finite value at point ${colorIndex}` )
			}
			colors[vo] = r; colors[vo + 1] = g; colors[vo + 2] = b
			colors[vo + 3] = r; colors[vo + 4] = g; colors[vo + 5] = b
			colors[vo + 6] = r; colors[vo + 7] = g; colors[vo + 8] = b
			colors[vo + 9] = r; colors[vo + 10] = g; colors[vo + 11] = b
		} else {
			colors[vo] = 0; colors[vo + 1] = 0; colors[vo + 2] = 0
			colors[vo + 3] = 0; colors[vo + 4] = 0; colors[vo + 5] = 0
			colors[vo + 6] = 0; colors[vo + 7] = 0; colors[vo + 8] = 0
			colors[vo + 9] = 0; colors[vo + 10] = 0; colors[vo + 11] = 0
		}
	}
}

const markAttributeFullUpdate = attribute => {
	const fullRange = attribute._meshLineFullUpdateRange || { start: 0, count: 0 }
	fullRange.start = 0
	fullRange.count = usedLengthOf( attribute )
	attribute._meshLineFullUpdateRange = fullRange
	attribute.updateRanges[0] = fullRange
	attribute.updateRanges.length = 1
	attribute.needsUpdate = true
}

const markAttributeUpdateRange = ( attribute, start, count ) => {
	if ( !attribute || count <= 0 ) return
	if ( start <= 0 && start + count >= usedLengthOf( attribute ) ) {
		markAttributeFullUpdate( attribute )
		return
	}
	const ranges = attribute.updateRanges
	let rangeStart = start
	let rangeEnd = start + count
	let mergedTarget = null
	for ( let i = ranges.length - 1; i >= 0; i-- ) {
		const current = ranges[i]
		const currentEnd = current.start + current.count
		if ( rangeEnd < current.start || rangeStart > currentEnd ) continue
		rangeStart = Math.min( rangeStart, current.start )
		rangeEnd = Math.max( rangeEnd, currentEnd )
		if ( !mergedTarget && current !== attribute._meshLineFullUpdateRange ) {
			mergedTarget = current
		} else {
			ranges.splice( i, 1 )
		}
	}
	if ( rangeStart === 0 && rangeEnd === usedLengthOf( attribute ) ) {
		if ( mergedTarget ) {
			const idx = ranges.indexOf( mergedTarget )
			if ( idx !== -1 ) ranges.splice( idx, 1 )
		}
		const fullRange = attribute._meshLineFullUpdateRange || { start: 0, count: 0 }
		fullRange.start = 0
		fullRange.count = usedLengthOf( attribute )
		attribute._meshLineFullUpdateRange = fullRange
		ranges.push( fullRange )
	} else if ( mergedTarget ) {
		mergedTarget.start = rangeStart
		mergedTarget.count = rangeEnd - rangeStart
	} else {
		attribute.addUpdateRange( rangeStart, rangeEnd - rangeStart )
	}
	// Always bump the version. A buffer's first upload sends the whole array but
	// leaves `updateRanges` untouched, so "ranges still pending" does not mean an
	// upload is already scheduled; skipping the bump froze every later edit.
	attribute.needsUpdate = true
}

const writePositionRange = ( array, line, vertexOffset, startPoint, endPoint ) => {
	for ( let i = startPoint, sourceOffset = startPoint * 3, targetOffset = ( vertexOffset + startPoint * 4 ) * 3; i < endPoint; i++, sourceOffset += 3, targetOffset += 12 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		array[targetOffset] = x; array[targetOffset + 1] = y; array[targetOffset + 2] = z
		array[targetOffset + 3] = x; array[targetOffset + 4] = y; array[targetOffset + 5] = z
		array[targetOffset + 6] = x; array[targetOffset + 7] = y; array[targetOffset + 8] = z
		array[targetOffset + 9] = x; array[targetOffset + 10] = y; array[targetOffset + 11] = z
	}
}

const writeNeighborRange = ( line, isLooped, previous, next, vertexOffset, startPoint, endPoint ) => {
	if ( !previous && !next ) return
	const pointCount = line.length / 3
	const lastPoint = pointCount - 1
	const loopedStartOffset = ( pointCount - 2 ) * 3
	for (
		let i = startPoint, sourceOffset = startPoint * 3, targetOffset = ( vertexOffset + startPoint * 4 ) * 3;
		i < endPoint;
		i++, sourceOffset += 3, targetOffset += 12
	) {
		if ( previous ) {
			const previousOffset = i > 0
				? sourceOffset - 3
				: ( isLooped ? loopedStartOffset : sourceOffset )
			const x = line[previousOffset]
			const y = line[previousOffset + 1]
			const z = line[previousOffset + 2]
			previous[targetOffset] = x; previous[targetOffset + 1] = y; previous[targetOffset + 2] = z
			previous[targetOffset + 3] = x; previous[targetOffset + 4] = y; previous[targetOffset + 5] = z
			previous[targetOffset + 6] = x; previous[targetOffset + 7] = y; previous[targetOffset + 8] = z
			previous[targetOffset + 9] = x; previous[targetOffset + 10] = y; previous[targetOffset + 11] = z
		}
		if ( next ) {
			const nextOffset = i < lastPoint
				? sourceOffset + 3
				: ( isLooped ? 3 : sourceOffset )
			const x = line[nextOffset]
			const y = line[nextOffset + 1]
			const z = line[nextOffset + 2]
			next[targetOffset] = x; next[targetOffset + 1] = y; next[targetOffset + 2] = z
			next[targetOffset + 3] = x; next[targetOffset + 4] = y; next[targetOffset + 5] = z
			next[targetOffset + 6] = x; next[targetOffset + 7] = y; next[targetOffset + 8] = z
			next[targetOffset + 9] = x; next[targetOffset + 10] = y; next[targetOffset + 11] = z
		}
	}
}

const markNeighborUpdateRanges = ( previous, next, vertexOffset, startPoint, endPoint ) => {
	const start = ( vertexOffset + startPoint * 4 ) * 3
	const count = ( endPoint - startPoint ) * 12
	markAttributeUpdateRange( previous, start, count )
	markAttributeUpdateRange( next, start, count )
}

const writePositionAndNeighborRanges = (
	line,
	isLooped,
	hasSyntheticSeam,
	startPoint,
	endPoint,
	rangePointCount,
	sourcePointCount,
	storedPointCount,
	lineVertexOffset,
	positionAttr,
	previousAttr,
	nextAttr
) => {
	writePositionRange( positionAttr.array, line, lineVertexOffset, startPoint, endPoint )
	markAttributeUpdateRange( positionAttr, ( lineVertexOffset + startPoint * 4 ) * 3, rangePointCount * 12 )
	if ( hasSyntheticSeam && startPoint === 0 ) {
		writePositionRange( positionAttr.array, line, lineVertexOffset, sourcePointCount, sourcePointCount + 1 )
		markAttributeUpdateRange( positionAttr, ( lineVertexOffset + sourcePointCount * 4 ) * 3, 12 )
	}

	const neighborStart = Math.max( 0, startPoint - 1 )
	const neighborEnd = Math.min( storedPointCount, endPoint + 1 )
	writeNeighborRange( line, isLooped, previousAttr?.array, nextAttr?.array, lineVertexOffset, neighborStart, neighborEnd )
	markNeighborUpdateRanges( previousAttr, nextAttr, lineVertexOffset, neighborStart, neighborEnd )
	const wrappedPreviousIndex = storedPointCount - 2
	const touchesWrappedNeighbor = isLooped && (
		startPoint === 0 ||
		( startPoint <= 1 && endPoint > 1 ) ||
		( startPoint <= wrappedPreviousIndex && endPoint > wrappedPreviousIndex )
	)
	if ( touchesWrappedNeighbor ) {
		const tailStart = Math.max( 0, storedPointCount - 2 )
		writeNeighborRange( line, isLooped, previousAttr?.array, nextAttr?.array, lineVertexOffset, 0, Math.min( 2, storedPointCount ) )
		writeNeighborRange( line, isLooped, previousAttr?.array, nextAttr?.array, lineVertexOffset, tailStart, storedPointCount )
		markNeighborUpdateRanges( previousAttr, nextAttr, lineVertexOffset, 0, Math.min( 2, storedPointCount ) )
		markNeighborUpdateRanges( previousAttr, nextAttr, lineVertexOffset, tailStart, storedPointCount )
	}
}

const updatePositionRangeDerivedAttributes = (
	geometry,
	line,
	range,
	startPoint,
	endPoint,
	sourcePointCount,
	storedPointCount,
	isLooped,
	hasSyntheticSeam,
	proceduralProgress,
	needsArcProgress,
	callbackCanReject,
	lineIndex,
	lineVertexOffset,
	positionAttr,
	previousAttr,
	nextAttr,
	progressAttr,
	uvAttr,
	widthAttr,
	endpointAttr,
	widthCallback
) => {
	let restoreRange = null
	if ( callbackCanReject ) {
		geometry._lineWidthScratch ||= []
		geometry._partialRestoreScratch = geometry._partialRestoreScratch?.length >= range.length
			? geometry._partialRestoreScratch
			: new Float32Array( range.length )
		restoreRange = geometry._partialRestoreScratch.subarray( 0, range.length )
		restoreRange.set( line.subarray( startPoint * 3, endPoint * 3 ) )
	}

	line.set( range, startPoint * 3 )
	if ( hasSyntheticSeam && startPoint === 0 ) {
		line.set( line.subarray( 0, 3 ), sourcePointCount * 3 )
	}

	let lineProgress = geometry._lineProgress[lineIndex]
	let preparedWidths = null
	let lineMaxWidth = geometry._lineMaxWidths[lineIndex] ?? 1
	let arcCacheState = null
	let progressWrittenInTry = false
	let widthsWrittenInTry = false
	const progressState = { writtenPoints: 0 }
	const updateEndpoints = Boolean( endpointAttr?.itemSize === 4 )

	try {
		if ( needsArcProgress ) {
			geometry._lineArcCaches ||= []
			arcCacheState = updateLineArcCacheRange(
				line,
				startPoint,
				endPoint,
				hasSyntheticSeam,
				lineProgress,
				geometry._lineArcCaches,
				lineIndex
			)
			lineProgress = arcCacheState.result
			geometry._lineProgress[lineIndex] = lineProgress
		} else if ( proceduralProgress && !lineProgress ) {
			lineProgress = computeLineProgress( line, true, lineProgress )
			geometry._lineProgress[lineIndex] = lineProgress
		}

		if ( callbackCanReject ) {
			const cache = arcCacheState?.cache
			if (
				arcCacheState &&
				!arcCacheState.normalizedInPlace &&
				cache.totalLength > 0 &&
				Number.isFinite( cache.totalLength ) &&
				progressAttr &&
				!uvAttr &&
				!updateEndpoints
			) {
				progressWrittenInTry = true
				widthsWrittenInTry = true
				lineMaxWidth = normalizeCachedProgressAndEvaluateWidths(
					cache.segLengths,
					progressAttr.array,
					widthAttr.array,
					widthCallback,
					storedPointCount,
					isLooped,
					lineIndex,
					lineVertexOffset,
					1 / cache.totalLength,
					cache,
					progressState
				)
			} else {
				preparedWidths = geometry._lineWidthScratch[lineIndex]?.length === storedPointCount
					? geometry._lineWidthScratch[lineIndex]
					: new Float32Array( storedPointCount )
				geometry._lineWidthScratch[lineIndex] = preparedWidths
				if ( arcCacheState && !arcCacheState.normalizedInPlace ) {
					finalizeLineArcCacheProgress( cache, lineProgress, storedPointCount - 1 )
					arcCacheState.normalizedInPlace = true
				}
				lineMaxWidth = evaluateLineWidths( preparedWidths, lineProgress, widthCallback, storedPointCount, isLooped, lineIndex )
			}
		}
	} catch ( error ) {
		geometry._rawLineBoundsValid = false
		if ( geometry._lineArcCaches?.[lineIndex] ) geometry._lineArcCaches[lineIndex].valid = false
		if ( restoreRange ) {
			line.set( restoreRange, startPoint * 3 )
			if ( hasSyntheticSeam && startPoint === 0 ) line.set( line.subarray( 0, 3 ), sourcePointCount * 3 )
			if ( needsArcProgress ) {
				const cache = arcCacheState?.cache
				let restoredProgress = lineProgress
				if ( cache?.segLengths?.length >= storedPointCount ) {
					restoredProgress = restoredProgress?.length === storedPointCount ? restoredProgress : new Float32Array( storedPointCount )
					cache.totalLength = buildLineArcCache( line, storedPointCount, cache.segLengths, restoredProgress )
					cache.pointCount = storedPointCount
					cache.valid = true
					finalizeLineArcCacheProgress( cache, restoredProgress, storedPointCount - 1 )
				} else {
					restoredProgress = computeLineProgress( line, false, lineProgress )
				}
				geometry._lineProgress[lineIndex] = restoredProgress
				if ( progressWrittenInTry && progressAttr ) {
					writeScalarLine( progressAttr.array, restoredProgress, lineVertexOffset )
				}
				if ( widthsWrittenInTry && widthAttr && progressState.writtenPoints > 0 ) {
					const widthArray = widthAttr.array
					const regularEnd = isLooped ? storedPointCount - 1 : storedPointCount
					const limit = Math.min( progressState.writtenPoints, regularEnd )
					for ( let i = 0, vo = lineVertexOffset; i < limit; i++, vo += 4 ) {
						const w = Math.abs( widthCallback( restoredProgress[i], i, lineIndex ) )
						widthArray[vo] = w
						widthArray[vo + 1] = w
						widthArray[vo + 2] = w
						widthArray[vo + 3] = w
					}
				}
			}
		}
		throw error
	}

	writePositionAndNeighborRanges(
		line,
		isLooped,
		hasSyntheticSeam,
		startPoint,
		endPoint,
		endPoint - startPoint,
		sourcePointCount,
		storedPointCount,
		lineVertexOffset,
		positionAttr,
		previousAttr,
		nextAttr
	)

	if ( needsArcProgress ) {
		const cache = arcCacheState?.cache
		const canStreamFromCache = !!(
			arcCacheState &&
			!arcCacheState.normalizedInPlace &&
			cache.totalLength > 0 &&
			Number.isFinite( cache.totalLength )
		)
		const lastPoint = storedPointCount - 1
		if ( progressWrittenInTry ) {
			markAttributeUpdateRange( progressAttr, lineVertexOffset, storedPointCount * 4 )
		} else if ( canStreamFromCache && progressAttr && uvAttr && !updateEndpoints ) {
			writeNormalizedCachedProgressAndUVLineUpdate(
				cache.segLengths,
				progressAttr.array,
				uvAttr.array,
				lastPoint,
				1 / cache.totalLength,
				lineVertexOffset,
				cache
			)
			markAttributeUpdateRange( progressAttr, lineVertexOffset, storedPointCount * 4 )
			markAttributeUpdateRange( uvAttr, lineVertexOffset * 2, storedPointCount * 8 )
		} else if ( canStreamFromCache && progressAttr && updateEndpoints && !uvAttr ) {
			writeNormalizedCachedProgressAndEndpointMetadataUpdate(
				cache.segLengths,
				progressAttr.array,
				endpointAttr.array,
				lastPoint,
				1 / cache.totalLength,
				isLooped,
				lineVertexOffset,
				cache
			)
			markAttributeUpdateRange( progressAttr, lineVertexOffset, storedPointCount * 4 )
			markAttributeUpdateRange( endpointAttr, lineVertexOffset * 4, storedPointCount * 16 )
		} else if ( canStreamFromCache && progressAttr && !uvAttr && !updateEndpoints ) {
			writeNormalizedCachedProgressLineUpdate(
				cache.segLengths,
				progressAttr.array,
				lastPoint,
				1 / cache.totalLength,
				lineVertexOffset,
				cache
			)
			markAttributeUpdateRange( progressAttr, lineVertexOffset, storedPointCount * 4 )
		} else {
			if ( arcCacheState && !arcCacheState.normalizedInPlace ) {
				finalizeLineArcCacheProgress( cache, lineProgress, lastPoint )
			}
			if ( progressAttr && uvAttr ) {
				writeProgressAndUVLineUpdate( progressAttr.array, uvAttr.array, lineProgress, lineVertexOffset )
				markAttributeUpdateRange( progressAttr, lineVertexOffset, storedPointCount * 4 )
				markAttributeUpdateRange( uvAttr, lineVertexOffset * 2, storedPointCount * 8 )
				if ( updateEndpoints ) {
					writeEndpointMetadataUpdate( endpointAttr.array, lineProgress, isLooped, lineVertexOffset )
					markAttributeUpdateRange( endpointAttr, lineVertexOffset * 4, storedPointCount * 16 )
				}
			} else if ( progressAttr && updateEndpoints ) {
				writeProgressAndEndpointMetadataUpdate( progressAttr.array, endpointAttr.array, lineProgress, isLooped, lineVertexOffset )
				markAttributeUpdateRange( progressAttr, lineVertexOffset, storedPointCount * 4 )
				markAttributeUpdateRange( endpointAttr, lineVertexOffset * 4, storedPointCount * 16 )
			} else {
				if ( progressAttr ) {
					writeScalarLine( progressAttr.array, lineProgress, lineVertexOffset )
					markAttributeUpdateRange( progressAttr, lineVertexOffset, storedPointCount * 4 )
				}
				if ( uvAttr ) {
					writeUVLineUpdate( uvAttr.array, lineProgress, lineVertexOffset )
					markAttributeUpdateRange( uvAttr, lineVertexOffset * 2, storedPointCount * 8 )
				}
				if ( updateEndpoints ) {
					writeEndpointMetadataUpdate( endpointAttr.array, lineProgress, isLooped, lineVertexOffset )
					markAttributeUpdateRange( endpointAttr, lineVertexOffset * 4, storedPointCount * 16 )
				}
			}
		}
	}

	if ( widthsWrittenInTry || preparedWidths ) {
		if ( preparedWidths ) {
			writeScalarLine( widthAttr.array, preparedWidths, lineVertexOffset )
		}
		markAttributeUpdateRange( widthAttr, lineVertexOffset, storedPointCount * 4 )
		geometry._lineMaxWidths[lineIndex] = lineMaxWidth
		geometry._maxWidthMultiplier = 1
		for ( let i = 0; i < geometry._lineMaxWidths.length; i++ ) {
			const maxW = geometry._lineMaxWidths[i] ?? 1
			if ( maxW > geometry._maxWidthMultiplier ) geometry._maxWidthMultiplier = maxW
		}
	}
}

const writeScalarLine = ( array, values, vertexOffset ) => {
	for ( let i = 0, targetOffset = vertexOffset; i < values.length; i++, targetOffset += 4 ) {
		const v = values[i]
		array[targetOffset] = v
		array[targetOffset + 1] = v
		array[targetOffset + 2] = v
		array[targetOffset + 3] = v
	}
}

const writeScalarLineNormalized = ( array, values, invTotalLength, vertexOffset ) => {
	const pointCount = values.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	const lastOffset = vertexOffset + last * 4
	array[vertexOffset] = 0
	array[vertexOffset + 1] = 0
	array[vertexOffset + 2] = 0
	array[vertexOffset + 3] = 0
	array[lastOffset] = 1
	array[lastOffset + 1] = 1
	array[lastOffset + 2] = 1
	array[lastOffset + 3] = 1
	for ( let i = 1, targetOffset = vertexOffset + 4; i < last; i++, targetOffset += 4 ) {
		const v = Math.fround( values[i] * invTotalLength )
		array[targetOffset] = v
		array[targetOffset + 1] = v
		array[targetOffset + 2] = v
		array[targetOffset + 3] = v
	}
}

const writeTwoScalarLines = ( arrayA, valuesA, arrayB, valuesB, vertexOffset ) => {
	for ( let i = 0, targetOffset = vertexOffset; i < valuesA.length; i++, targetOffset += 4 ) {
		const a = valuesA[i]
		const b = valuesB[i]
		arrayA[targetOffset] = a
		arrayA[targetOffset + 1] = a
		arrayA[targetOffset + 2] = a
		arrayA[targetOffset + 3] = a
		arrayB[targetOffset] = b
		arrayB[targetOffset + 1] = b
		arrayB[targetOffset + 2] = b
		arrayB[targetOffset + 3] = b
	}
}

const writeUVLine = ( array, progress, vertexOffset ) => {
	for ( let i = 0, targetOffset = vertexOffset * 2; i < progress.length; i++, targetOffset += 8 ) {
		const value = progress[i]
		array[targetOffset] = value
		array[targetOffset + 1] = 0
		array[targetOffset + 2] = value
		array[targetOffset + 3] = 1
		array[targetOffset + 4] = value
		array[targetOffset + 5] = 0
		array[targetOffset + 6] = value
		array[targetOffset + 7] = 1
	}
}

const writeUVLineUpdate = ( array, progress, vertexOffset ) => {
	for ( let i = 0, targetOffset = vertexOffset * 2; i < progress.length; i++, targetOffset += 8 ) {
		const value = progress[i]
		array[targetOffset] = value
		array[targetOffset + 2] = value
		array[targetOffset + 4] = value
		array[targetOffset + 6] = value
	}
}

const writeUVLineNormalized = ( array, progress, invTotalLength, vertexOffset ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	const firstOffset = vertexOffset * 2
	const lastOffset = firstOffset + last * 8
	array[firstOffset] = 0; array[firstOffset + 1] = 0
	array[firstOffset + 2] = 0; array[firstOffset + 3] = 1
	array[firstOffset + 4] = 0; array[firstOffset + 5] = 0
	array[firstOffset + 6] = 0; array[firstOffset + 7] = 1
	array[lastOffset] = 1; array[lastOffset + 1] = 0
	array[lastOffset + 2] = 1; array[lastOffset + 3] = 1
	array[lastOffset + 4] = 1; array[lastOffset + 5] = 0
	array[lastOffset + 6] = 1; array[lastOffset + 7] = 1
	for ( let i = 1, targetOffset = firstOffset + 8; i < last; i++, targetOffset += 8 ) {
		const value = Math.fround( progress[i] * invTotalLength )
		array[targetOffset] = value; array[targetOffset + 1] = 0
		array[targetOffset + 2] = value; array[targetOffset + 3] = 1
		array[targetOffset + 4] = value; array[targetOffset + 5] = 0
		array[targetOffset + 6] = value; array[targetOffset + 7] = 1
	}
}

const writeUVLineUpdateNormalized = ( array, progress, invTotalLength, vertexOffset ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	const firstOffset = vertexOffset * 2
	const lastOffset = firstOffset + last * 8
	array[firstOffset] = 0
	array[firstOffset + 2] = 0
	array[firstOffset + 4] = 0
	array[firstOffset + 6] = 0
	array[lastOffset] = 1
	array[lastOffset + 2] = 1
	array[lastOffset + 4] = 1
	array[lastOffset + 6] = 1
	for ( let i = 1, targetOffset = firstOffset + 8; i < last; i++, targetOffset += 8 ) {
		const value = Math.fround( progress[i] * invTotalLength )
		array[targetOffset] = value
		array[targetOffset + 2] = value
		array[targetOffset + 4] = value
		array[targetOffset + 6] = value
	}
}

const writeProgressAndUVLine = ( progressArray, uvArray, progress, vertexOffset ) => {
	for ( let i = 0, pOffset = vertexOffset, uvOffset = vertexOffset * 2; i < progress.length; i++, pOffset += 4, uvOffset += 8 ) {
		const value = progress[i]
		progressArray[pOffset] = value
		progressArray[pOffset + 1] = value
		progressArray[pOffset + 2] = value
		progressArray[pOffset + 3] = value
		uvArray[uvOffset] = value
		uvArray[uvOffset + 1] = 0
		uvArray[uvOffset + 2] = value
		uvArray[uvOffset + 3] = 1
		uvArray[uvOffset + 4] = value
		uvArray[uvOffset + 5] = 0
		uvArray[uvOffset + 6] = value
		uvArray[uvOffset + 7] = 1
	}
}

const writeProgressAndUVLineNormalized = ( progressArray, uvArray, progress, invTotalLength, vertexOffset ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	const firstPOffset = vertexOffset
	const lastPOffset = firstPOffset + last * 4
	const firstUvOffset = vertexOffset * 2
	const lastUvOffset = firstUvOffset + last * 8
	progressArray[firstPOffset] = 0
	progressArray[firstPOffset + 1] = 0
	progressArray[firstPOffset + 2] = 0
	progressArray[firstPOffset + 3] = 0
	uvArray[firstUvOffset] = 0; uvArray[firstUvOffset + 1] = 0
	uvArray[firstUvOffset + 2] = 0; uvArray[firstUvOffset + 3] = 1
	uvArray[firstUvOffset + 4] = 0; uvArray[firstUvOffset + 5] = 0
	uvArray[firstUvOffset + 6] = 0; uvArray[firstUvOffset + 7] = 1
	progressArray[lastPOffset] = 1
	progressArray[lastPOffset + 1] = 1
	progressArray[lastPOffset + 2] = 1
	progressArray[lastPOffset + 3] = 1
	uvArray[lastUvOffset] = 1; uvArray[lastUvOffset + 1] = 0
	uvArray[lastUvOffset + 2] = 1; uvArray[lastUvOffset + 3] = 1
	uvArray[lastUvOffset + 4] = 1; uvArray[lastUvOffset + 5] = 0
	uvArray[lastUvOffset + 6] = 1; uvArray[lastUvOffset + 7] = 1
	for ( let i = 1, pOffset = firstPOffset + 4, uvOffset = firstUvOffset + 8; i < last; i++, pOffset += 4, uvOffset += 8 ) {
		const value = Math.fround( progress[i] * invTotalLength )
		progressArray[pOffset] = value
		progressArray[pOffset + 1] = value
		progressArray[pOffset + 2] = value
		progressArray[pOffset + 3] = value
		uvArray[uvOffset] = value; uvArray[uvOffset + 1] = 0
		uvArray[uvOffset + 2] = value; uvArray[uvOffset + 3] = 1
		uvArray[uvOffset + 4] = value; uvArray[uvOffset + 5] = 0
		uvArray[uvOffset + 6] = value; uvArray[uvOffset + 7] = 1
	}
}

const writeProgressAndUVLineUpdate = ( progressArray, uvArray, progress, vertexOffset ) => {
	for ( let i = 0, pOffset = vertexOffset, uvOffset = vertexOffset * 2; i < progress.length; i++, pOffset += 4, uvOffset += 8 ) {
		const value = progress[i]
		progressArray[pOffset] = value
		progressArray[pOffset + 1] = value
		progressArray[pOffset + 2] = value
		progressArray[pOffset + 3] = value
		uvArray[uvOffset] = value
		uvArray[uvOffset + 2] = value
		uvArray[uvOffset + 4] = value
		uvArray[uvOffset + 6] = value
	}
}

const writeProgressAndUVLineUpdateNormalized = ( progressArray, uvArray, progress, invTotalLength, vertexOffset ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	const firstPOffset = vertexOffset
	const lastPOffset = firstPOffset + last * 4
	const firstUvOffset = vertexOffset * 2
	const lastUvOffset = firstUvOffset + last * 8
	progressArray[firstPOffset] = 0
	progressArray[firstPOffset + 1] = 0
	progressArray[firstPOffset + 2] = 0
	progressArray[firstPOffset + 3] = 0
	uvArray[firstUvOffset] = 0
	uvArray[firstUvOffset + 2] = 0
	uvArray[firstUvOffset + 4] = 0
	uvArray[firstUvOffset + 6] = 0
	progressArray[lastPOffset] = 1
	progressArray[lastPOffset + 1] = 1
	progressArray[lastPOffset + 2] = 1
	progressArray[lastPOffset + 3] = 1
	uvArray[lastUvOffset] = 1
	uvArray[lastUvOffset + 2] = 1
	uvArray[lastUvOffset + 4] = 1
	uvArray[lastUvOffset + 6] = 1
	for ( let i = 1, pOffset = firstPOffset + 4, uvOffset = firstUvOffset + 8; i < last; i++, pOffset += 4, uvOffset += 8 ) {
		const value = Math.fround( progress[i] * invTotalLength )
		progressArray[pOffset] = value
		progressArray[pOffset + 1] = value
		progressArray[pOffset + 2] = value
		progressArray[pOffset + 3] = value
		uvArray[uvOffset] = value
		uvArray[uvOffset + 2] = value
		uvArray[uvOffset + 4] = value
		uvArray[uvOffset + 6] = value
	}
}

const writePositionsQuadRange = ( line, srcStart, srcEnd, positions, targetStart ) => {
	for ( let sourceOffset = srcStart, targetOffset = targetStart; sourceOffset < srcEnd; sourceOffset += 3, targetOffset += 12 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		positions[targetOffset] = x; positions[targetOffset + 1] = y; positions[targetOffset + 2] = z
		positions[targetOffset + 3] = x; positions[targetOffset + 4] = y; positions[targetOffset + 5] = z
		positions[targetOffset + 6] = x; positions[targetOffset + 7] = y; positions[targetOffset + 8] = z
		positions[targetOffset + 9] = x; positions[targetOffset + 10] = y; positions[targetOffset + 11] = z
	}
}

const writeValidPositionsQuadRange = ( line, srcStart, srcEnd, positions, targetStart ) => {
	let prevX = line[srcStart - 3]
	let prevY = line[srcStart - 2]
	let prevZ = line[srcStart - 1]
	for ( let sourceOffset = srcStart, targetOffset = targetStart; sourceOffset < srcEnd; sourceOffset += 3, targetOffset += 12 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( !( distSq > 0 && distSq < Infinity ) ) return false
		positions[targetOffset] = x; positions[targetOffset + 1] = y; positions[targetOffset + 2] = z
		positions[targetOffset + 3] = x; positions[targetOffset + 4] = y; positions[targetOffset + 5] = z
		positions[targetOffset + 6] = x; positions[targetOffset + 7] = y; positions[targetOffset + 8] = z
		positions[targetOffset + 9] = x; positions[targetOffset + 10] = y; positions[targetOffset + 11] = z
		prevX = x
		prevY = y
		prevZ = z
	}
	return true
}

const writeValidPositionsQuadRangeWithBounds = ( line, srcStart, srcEnd, positions, targetStart ) => {
	let prevX = line[srcStart - 3]
	let prevY = line[srcStart - 2]
	let prevZ = line[srcStart - 1]
	let minX = lastScanMinX; let maxX = lastScanMaxX
	let minY = lastScanMinY; let maxY = lastScanMaxY
	let minZ = lastScanMinZ; let maxZ = lastScanMaxZ
	for ( let sourceOffset = srcStart, targetOffset = targetStart; sourceOffset < srcEnd; sourceOffset += 3, targetOffset += 12 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( !( distSq > 0 && distSq < Infinity ) ) return false
		minX = Math.min( minX, x )
		maxX = Math.max( maxX, x )
		minY = Math.min( minY, y )
		maxY = Math.max( maxY, y )
		minZ = Math.min( minZ, z )
		maxZ = Math.max( maxZ, z )
		positions[targetOffset] = x; positions[targetOffset + 1] = y; positions[targetOffset + 2] = z
		positions[targetOffset + 3] = x; positions[targetOffset + 4] = y; positions[targetOffset + 5] = z
		positions[targetOffset + 6] = x; positions[targetOffset + 7] = y; positions[targetOffset + 8] = z
		positions[targetOffset + 9] = x; positions[targetOffset + 10] = y; positions[targetOffset + 11] = z
		prevX = x
		prevY = y
		prevZ = z
	}
	lastScanMinX = minX; lastScanMaxX = maxX
	lastScanMinY = minY; lastScanMaxY = maxY
	lastScanMinZ = minZ; lastScanMaxZ = maxZ
	return true
}

const writeValidPositionsAndProgressQuadRange = ( line, srcStart, srcEnd, positions, targetStart, progress, accIn ) => {
	let prevX = line[srcStart - 3]
	let prevY = line[srcStart - 2]
	let prevZ = line[srcStart - 1]
	let acc = accIn
	for ( let sourceOffset = srcStart, targetOffset = targetStart, pIndex = srcStart / 3; sourceOffset < srcEnd; sourceOffset += 3, targetOffset += 12, pIndex++ ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( !( distSq > 0 && distSq < Infinity ) ) return -1
		acc += Math.sqrt( distSq )
		progress[pIndex] = acc
		positions[targetOffset] = x; positions[targetOffset + 1] = y; positions[targetOffset + 2] = z
		positions[targetOffset + 3] = x; positions[targetOffset + 4] = y; positions[targetOffset + 5] = z
		positions[targetOffset + 6] = x; positions[targetOffset + 7] = y; positions[targetOffset + 8] = z
		positions[targetOffset + 9] = x; positions[targetOffset + 10] = y; positions[targetOffset + 11] = z
		prevX = x
		prevY = y
		prevZ = z
	}
	return acc
}

const writeValidPositionsBoundsAndProgressQuadRange = ( line, srcStart, srcEnd, positions, targetStart, progress, accIn ) => {
	let prevX = line[srcStart - 3]
	let prevY = line[srcStart - 2]
	let prevZ = line[srcStart - 1]
	let acc = accIn
	let minX = lastScanMinX; let maxX = lastScanMaxX
	let minY = lastScanMinY; let maxY = lastScanMaxY
	let minZ = lastScanMinZ; let maxZ = lastScanMaxZ
	for ( let sourceOffset = srcStart, targetOffset = targetStart, pIndex = srcStart / 3; sourceOffset < srcEnd; sourceOffset += 3, targetOffset += 12, pIndex++ ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const dx = x - prevX
		const dy = y - prevY
		const dz = z - prevZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( !( distSq > 0 && distSq < Infinity ) ) return -1
		minX = Math.min( minX, x )
		maxX = Math.max( maxX, x )
		minY = Math.min( minY, y )
		maxY = Math.max( maxY, y )
		minZ = Math.min( minZ, z )
		maxZ = Math.max( maxZ, z )
		acc += Math.sqrt( distSq )
		progress[pIndex] = acc
		positions[targetOffset] = x; positions[targetOffset + 1] = y; positions[targetOffset + 2] = z
		positions[targetOffset + 3] = x; positions[targetOffset + 4] = y; positions[targetOffset + 5] = z
		positions[targetOffset + 6] = x; positions[targetOffset + 7] = y; positions[targetOffset + 8] = z
		positions[targetOffset + 9] = x; positions[targetOffset + 10] = y; positions[targetOffset + 11] = z
		prevX = x
		prevY = y
		prevZ = z
	}
	lastScanMinX = minX; lastScanMaxX = maxX
	lastScanMinY = minY; lastScanMaxY = maxY
	lastScanMinZ = minZ; lastScanMaxZ = maxZ
	return acc
}

const POSITION_CHUNK_POINTS = 4096

const writePositionAndNeighbors = ( line, isLooped, positions, previous, next, vertexOffset ) => {
	const pointCount = line.length / 3
	if ( pointCount < 2 ) return vertexOffset
	const nextVertexOffset = vertexOffset + pointCount * 4
	const baseOffset = vertexOffset * 3
	const lastOffset = baseOffset + ( pointCount - 1 ) * 12

	const prevLineOffset = isLooped ? ( pointCount - 2 ) * 3 : 0
	const px = line[prevLineOffset]
	const py = line[prevLineOffset + 1]
	const pz = line[prevLineOffset + 2]
	previous[baseOffset] = px; previous[baseOffset + 1] = py; previous[baseOffset + 2] = pz
	previous[baseOffset + 3] = px; previous[baseOffset + 4] = py; previous[baseOffset + 5] = pz
	previous[baseOffset + 6] = px; previous[baseOffset + 7] = py; previous[baseOffset + 8] = pz
	previous[baseOffset + 9] = px; previous[baseOffset + 10] = py; previous[baseOffset + 11] = pz

	const nextLineOffset = isLooped ? 3 : ( pointCount - 1 ) * 3
	const nx = line[nextLineOffset]
	const ny = line[nextLineOffset + 1]
	const nz = line[nextLineOffset + 2]
	next[lastOffset] = nx; next[lastOffset + 1] = ny; next[lastOffset + 2] = nz
	next[lastOffset + 3] = nx; next[lastOffset + 4] = ny; next[lastOffset + 5] = nz
	next[lastOffset + 6] = nx; next[lastOffset + 7] = ny; next[lastOffset + 8] = nz
	next[lastOffset + 9] = nx; next[lastOffset + 10] = ny; next[lastOffset + 11] = nz

	if ( pointCount > POSITION_CHUNK_POINTS ) {
		for ( let pStart = 0; pStart < pointCount; pStart += POSITION_CHUNK_POINTS ) {
			const pEnd = Math.min( pStart + POSITION_CHUNK_POINTS, pointCount )
			const dstStart = baseOffset + pStart * 12
			const dstEnd = baseOffset + pEnd * 12
			writePositionsQuadRange( line, pStart * 3, pEnd * 3, positions, dstStart )
			if ( pStart === 0 ) {
				previous.set( positions.subarray( baseOffset, dstEnd - 12 ), baseOffset + 12 )
				next.set( positions.subarray( baseOffset + 12, dstEnd ), baseOffset )
			} else {
				previous.set( positions.subarray( dstStart - 12, dstEnd - 12 ), dstStart )
				next.set( positions.subarray( dstStart, dstEnd ), dstStart - 12 )
			}
		}
	} else {
		writePositionsQuadRange( line, 0, pointCount * 3, positions, baseOffset )
		previous.set( positions.subarray( baseOffset, lastOffset ), baseOffset + 12 )
		next.set( positions.subarray( baseOffset + 12, lastOffset + 12 ), baseOffset )
	}

	return nextVertexOffset
}

const writeOpenValidPositionAndNeighbors = ( line, positions, previous, next, vertexOffset = 0 ) => {
	const pointCount = line.length / 3
	if ( pointCount < 2 ) return false
	const baseOffset = vertexOffset * 3
	const lastOffset = baseOffset + ( pointCount - 1 ) * 12
	const lastLineOffset = ( pointCount - 1 ) * 3

	const firstX = line[0]
	const firstY = line[1]
	const firstZ = line[2]
	const lastX = line[lastLineOffset]
	const lastY = line[lastLineOffset + 1]
	const lastZ = line[lastLineOffset + 2]
	if ( !Number.isFinite( firstX + firstY + firstZ + lastX + lastY + lastZ ) ) return false

	positions[baseOffset] = firstX; positions[baseOffset + 1] = firstY; positions[baseOffset + 2] = firstZ
	positions[baseOffset + 3] = firstX; positions[baseOffset + 4] = firstY; positions[baseOffset + 5] = firstZ
	positions[baseOffset + 6] = firstX; positions[baseOffset + 7] = firstY; positions[baseOffset + 8] = firstZ
	positions[baseOffset + 9] = firstX; positions[baseOffset + 10] = firstY; positions[baseOffset + 11] = firstZ

	previous[baseOffset] = firstX; previous[baseOffset + 1] = firstY; previous[baseOffset + 2] = firstZ
	previous[baseOffset + 3] = firstX; previous[baseOffset + 4] = firstY; previous[baseOffset + 5] = firstZ
	previous[baseOffset + 6] = firstX; previous[baseOffset + 7] = firstY; previous[baseOffset + 8] = firstZ
	previous[baseOffset + 9] = firstX; previous[baseOffset + 10] = firstY; previous[baseOffset + 11] = firstZ

	next[lastOffset] = lastX; next[lastOffset + 1] = lastY; next[lastOffset + 2] = lastZ
	next[lastOffset + 3] = lastX; next[lastOffset + 4] = lastY; next[lastOffset + 5] = lastZ
	next[lastOffset + 6] = lastX; next[lastOffset + 7] = lastY; next[lastOffset + 8] = lastZ
	next[lastOffset + 9] = lastX; next[lastOffset + 10] = lastY; next[lastOffset + 11] = lastZ

	if ( pointCount > POSITION_CHUNK_POINTS ) {
		for ( let pStart = 0; pStart < pointCount; pStart += POSITION_CHUNK_POINTS ) {
			const pEnd = Math.min( pStart + POSITION_CHUNK_POINTS, pointCount )
			const srcStart = pStart === 0 ? 3 : pStart * 3
			const srcEnd = pEnd * 3
			const dstStart = baseOffset + pStart * 12
			const dstEnd = baseOffset + pEnd * 12
			if ( !writeValidPositionsQuadRange( line, srcStart, srcEnd, positions, pStart === 0 ? baseOffset + 12 : dstStart ) ) {
				return false
			}
			if ( pStart === 0 ) {
				previous.set( positions.subarray( baseOffset, dstEnd - 12 ), baseOffset + 12 )
				next.set( positions.subarray( baseOffset + 12, dstEnd ), baseOffset )
			} else {
				previous.set( positions.subarray( dstStart - 12, dstEnd - 12 ), dstStart )
				next.set( positions.subarray( dstStart, dstEnd ), dstStart - 12 )
			}
		}
	} else {
		if ( !writeValidPositionsQuadRange( line, 3, pointCount * 3, positions, baseOffset + 12 ) ) {
			return false
		}
		previous.set( positions.subarray( baseOffset, lastOffset ), baseOffset + 12 )
		next.set( positions.subarray( baseOffset + 12, lastOffset + 12 ), baseOffset )
	}

	return true
}

const writeOpenValidPositionNeighborsAndBounds = ( line, positions, previous, next, vertexOffset = 0 ) => {
	const pointCount = line.length / 3
	if ( pointCount < 2 ) return false
	const baseOffset = vertexOffset * 3
	const lastOffset = baseOffset + ( pointCount - 1 ) * 12
	const lastLineOffset = ( pointCount - 1 ) * 3

	const firstX = line[0]
	const firstY = line[1]
	const firstZ = line[2]
	const lastX = line[lastLineOffset]
	const lastY = line[lastLineOffset + 1]
	const lastZ = line[lastLineOffset + 2]
	if ( !Number.isFinite( firstX + firstY + firstZ + lastX + lastY + lastZ ) ) return false

	lastScanMinX = firstX; lastScanMaxX = firstX
	lastScanMinY = firstY; lastScanMaxY = firstY
	lastScanMinZ = firstZ; lastScanMaxZ = firstZ

	positions[baseOffset] = firstX; positions[baseOffset + 1] = firstY; positions[baseOffset + 2] = firstZ
	positions[baseOffset + 3] = firstX; positions[baseOffset + 4] = firstY; positions[baseOffset + 5] = firstZ
	positions[baseOffset + 6] = firstX; positions[baseOffset + 7] = firstY; positions[baseOffset + 8] = firstZ
	positions[baseOffset + 9] = firstX; positions[baseOffset + 10] = firstY; positions[baseOffset + 11] = firstZ

	previous[baseOffset] = firstX; previous[baseOffset + 1] = firstY; previous[baseOffset + 2] = firstZ
	previous[baseOffset + 3] = firstX; previous[baseOffset + 4] = firstY; previous[baseOffset + 5] = firstZ
	previous[baseOffset + 6] = firstX; previous[baseOffset + 7] = firstY; previous[baseOffset + 8] = firstZ
	previous[baseOffset + 9] = firstX; previous[baseOffset + 10] = firstY; previous[baseOffset + 11] = firstZ

	next[lastOffset] = lastX; next[lastOffset + 1] = lastY; next[lastOffset + 2] = lastZ
	next[lastOffset + 3] = lastX; next[lastOffset + 4] = lastY; next[lastOffset + 5] = lastZ
	next[lastOffset + 6] = lastX; next[lastOffset + 7] = lastY; next[lastOffset + 8] = lastZ
	next[lastOffset + 9] = lastX; next[lastOffset + 10] = lastY; next[lastOffset + 11] = lastZ

	if ( pointCount > POSITION_CHUNK_POINTS ) {
		for ( let pStart = 0; pStart < pointCount; pStart += POSITION_CHUNK_POINTS ) {
			const pEnd = Math.min( pStart + POSITION_CHUNK_POINTS, pointCount )
			const srcStart = pStart === 0 ? 3 : pStart * 3
			const srcEnd = pEnd * 3
			const dstStart = baseOffset + pStart * 12
			const dstEnd = baseOffset + pEnd * 12
			if ( !writeValidPositionsQuadRangeWithBounds( line, srcStart, srcEnd, positions, pStart === 0 ? baseOffset + 12 : dstStart ) ) {
				return false
			}
			if ( pStart === 0 ) {
				previous.set( positions.subarray( baseOffset, dstEnd - 12 ), baseOffset + 12 )
				next.set( positions.subarray( baseOffset + 12, dstEnd ), baseOffset )
			} else {
				previous.set( positions.subarray( dstStart - 12, dstEnd - 12 ), dstStart )
				next.set( positions.subarray( dstStart, dstEnd ), dstStart - 12 )
			}
		}
	} else {
		if ( !writeValidPositionsQuadRangeWithBounds( line, 3, pointCount * 3, positions, baseOffset + 12 ) ) {
			return false
		}
		previous.set( positions.subarray( baseOffset, lastOffset ), baseOffset + 12 )
		next.set( positions.subarray( 12 + baseOffset, lastOffset + 12 ), baseOffset )
	}

	return true
}

const writeOpenValidPositionNeighborsAndProgress = ( line, positions, previous, next, lineProgress ) => {
	const pointCount = line.length / 3
	if ( pointCount < 2 ) return 0
	const lastOffset = ( pointCount - 1 ) * 12
	const lastLineOffset = ( pointCount - 1 ) * 3

	const firstX = line[0]
	const firstY = line[1]
	const firstZ = line[2]
	const lastX = line[lastLineOffset]
	const lastY = line[lastLineOffset + 1]
	const lastZ = line[lastLineOffset + 2]
	if ( !Number.isFinite( firstX + firstY + firstZ + lastX + lastY + lastZ ) ) return 0

	lineProgress[0] = 0

	positions[0] = firstX; positions[1] = firstY; positions[2] = firstZ
	positions[3] = firstX; positions[4] = firstY; positions[5] = firstZ
	positions[6] = firstX; positions[7] = firstY; positions[8] = firstZ
	positions[9] = firstX; positions[10] = firstY; positions[11] = firstZ

	previous[0] = firstX; previous[1] = firstY; previous[2] = firstZ
	previous[3] = firstX; previous[4] = firstY; previous[5] = firstZ
	previous[6] = firstX; previous[7] = firstY; previous[8] = firstZ
	previous[9] = firstX; previous[10] = firstY; previous[11] = firstZ

	next[lastOffset] = lastX; next[lastOffset + 1] = lastY; next[lastOffset + 2] = lastZ
	next[lastOffset + 3] = lastX; next[lastOffset + 4] = lastY; next[lastOffset + 5] = lastZ
	next[lastOffset + 6] = lastX; next[lastOffset + 7] = lastY; next[lastOffset + 8] = lastZ
	next[lastOffset + 9] = lastX; next[lastOffset + 10] = lastY; next[lastOffset + 11] = lastZ

	let acc = 0
	if ( pointCount > POSITION_CHUNK_POINTS ) {
		for ( let pStart = 0; pStart < pointCount; pStart += POSITION_CHUNK_POINTS ) {
			const pEnd = Math.min( pStart + POSITION_CHUNK_POINTS, pointCount )
			const srcStart = pStart === 0 ? 3 : pStart * 3
			const srcEnd = pEnd * 3
			const dstStart = pStart * 12
			const dstEnd = pEnd * 12
			acc = writeValidPositionsAndProgressQuadRange(
				line,
				srcStart,
				srcEnd,
				positions,
				pStart === 0 ? 12 : dstStart,
				lineProgress,
				acc
			)
			if ( acc < 0 ) return 0
			if ( pStart === 0 ) {
				previous.set( positions.subarray( 0, dstEnd - 12 ), 12 )
				next.set( positions.subarray( 12, dstEnd ), 0 )
			} else {
				previous.set( positions.subarray( dstStart - 12, dstEnd - 12 ), dstStart )
				next.set( positions.subarray( dstStart, dstEnd ), dstStart - 12 )
			}
		}
	} else {
		acc = writeValidPositionsAndProgressQuadRange( line, 3, pointCount * 3, positions, 12, lineProgress, 0 )
		if ( acc < 0 ) return 0
		previous.set( positions.subarray( 0, lastOffset ), 12 )
		next.set( positions.subarray( 12, lastOffset + 12 ), 0 )
	}

	return acc
}

const writeOpenValidPositionNeighborsBoundsAndProgress = ( line, positions, previous, next, lineProgress ) => {
	const pointCount = line.length / 3
	if ( pointCount < 2 ) return 0
	const lastOffset = ( pointCount - 1 ) * 12
	const lastLineOffset = ( pointCount - 1 ) * 3

	const firstX = line[0]
	const firstY = line[1]
	const firstZ = line[2]
	const lastX = line[lastLineOffset]
	const lastY = line[lastLineOffset + 1]
	const lastZ = line[lastLineOffset + 2]
	if ( !Number.isFinite( firstX + firstY + firstZ + lastX + lastY + lastZ ) ) return 0

	lastScanMinX = firstX; lastScanMaxX = firstX
	lastScanMinY = firstY; lastScanMaxY = firstY
	lastScanMinZ = firstZ; lastScanMaxZ = firstZ
	lineProgress[0] = 0

	positions[0] = firstX; positions[1] = firstY; positions[2] = firstZ
	positions[3] = firstX; positions[4] = firstY; positions[5] = firstZ
	positions[6] = firstX; positions[7] = firstY; positions[8] = firstZ
	positions[9] = firstX; positions[10] = firstY; positions[11] = firstZ

	previous[0] = firstX; previous[1] = firstY; previous[2] = firstZ
	previous[3] = firstX; previous[4] = firstY; previous[5] = firstZ
	previous[6] = firstX; previous[7] = firstY; previous[8] = firstZ
	previous[9] = firstX; previous[10] = firstY; previous[11] = firstZ

	next[lastOffset] = lastX; next[lastOffset + 1] = lastY; next[lastOffset + 2] = lastZ
	next[lastOffset + 3] = lastX; next[lastOffset + 4] = lastY; next[lastOffset + 5] = lastZ
	next[lastOffset + 6] = lastX; next[lastOffset + 7] = lastY; next[lastOffset + 8] = lastZ
	next[lastOffset + 9] = lastX; next[lastOffset + 10] = lastY; next[lastOffset + 11] = lastZ

	let acc = 0
	if ( pointCount > POSITION_CHUNK_POINTS ) {
		for ( let pStart = 0; pStart < pointCount; pStart += POSITION_CHUNK_POINTS ) {
			const pEnd = Math.min( pStart + POSITION_CHUNK_POINTS, pointCount )
			const srcStart = pStart === 0 ? 3 : pStart * 3
			const srcEnd = pEnd * 3
			const dstStart = pStart * 12
			const dstEnd = pEnd * 12
			acc = writeValidPositionsBoundsAndProgressQuadRange(
				line,
				srcStart,
				srcEnd,
				positions,
				pStart === 0 ? 12 : dstStart,
				lineProgress,
				acc
			)
			if ( acc < 0 ) return 0
			if ( pStart === 0 ) {
				previous.set( positions.subarray( 0, dstEnd - 12 ), 12 )
				next.set( positions.subarray( 12, dstEnd ), 0 )
			} else {
				previous.set( positions.subarray( dstStart - 12, dstEnd - 12 ), dstStart )
				next.set( positions.subarray( dstStart, dstEnd ), dstStart - 12 )
			}
		}
	} else {
		acc = writeValidPositionsBoundsAndProgressQuadRange( line, 3, pointCount * 3, positions, 12, lineProgress, 0 )
		if ( acc < 0 ) return 0
		previous.set( positions.subarray( 0, lastOffset ), 12 )
		next.set( positions.subarray( 12, lastOffset + 12 ), 0 )
	}

	return acc
}

const writeEndpointMetadata = ( array, progress, isLooped, vertexOffset, freshZeroedOpen = false ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	const loopValue = isLooped ? 1 : 0
	let offset = vertexOffset * 4
	const lastOffset = offset + last * 16
	let prevProg = progress[0]
	let curProg = progress[1]
	let previousStep = isLooped && pointCount > 2 ? Math.max( 0, 1 - progress[pointCount - 2] ) : 0
	let nextStep = curProg > prevProg ? curProg - prevProg : 0

	const openStart = isLooped ? 0 : -1
	array[offset] = openStart; array[offset + 4] = openStart; array[offset + 8] = openStart; array[offset + 12] = openStart
	if ( !freshZeroedOpen ) {
		array[offset + 1] = loopValue; array[offset + 5] = loopValue; array[offset + 9] = loopValue; array[offset + 13] = loopValue
	}
	array[offset + 2] = previousStep; array[offset + 3] = nextStep
	array[offset + 6] = previousStep; array[offset + 7] = nextStep
	array[offset + 10] = previousStep; array[offset + 11] = nextStep
	array[offset + 14] = previousStep; array[offset + 15] = nextStep

	const lastPrevProg = progress[last - 1]
	const lastCurProg = progress[last]
	const lastPrevStep = lastCurProg > lastPrevProg ? lastCurProg - lastPrevProg : 0
	const lastNextStep = isLooped && pointCount > 2 ? Math.max( 0, progress[1] ) : 0
	const openEnd = isLooped ? 0 : 1
	array[lastOffset] = openEnd; array[lastOffset + 4] = openEnd; array[lastOffset + 8] = openEnd; array[lastOffset + 12] = openEnd
	if ( !freshZeroedOpen ) {
		array[lastOffset + 1] = loopValue; array[lastOffset + 5] = loopValue; array[lastOffset + 9] = loopValue; array[lastOffset + 13] = loopValue
	}
	array[lastOffset + 2] = lastPrevStep; array[lastOffset + 3] = lastNextStep
	array[lastOffset + 6] = lastPrevStep; array[lastOffset + 7] = lastNextStep
	array[lastOffset + 10] = lastPrevStep; array[lastOffset + 11] = lastNextStep
	array[lastOffset + 14] = lastPrevStep; array[lastOffset + 15] = lastNextStep

	offset += 16
	if ( freshZeroedOpen ) {
		for ( let i = 1; i < last; i++, offset += 16 ) {
			previousStep = nextStep
			prevProg = curProg
			curProg = progress[i + 1]
			nextStep = curProg > prevProg ? curProg - prevProg : 0
			array[offset + 2] = previousStep; array[offset + 3] = nextStep
			array[offset + 6] = previousStep; array[offset + 7] = nextStep
			array[offset + 10] = previousStep; array[offset + 11] = nextStep
			array[offset + 14] = previousStep; array[offset + 15] = nextStep
		}
	} else {
		for ( let i = 1; i < last; i++, offset += 16 ) {
			previousStep = nextStep
			prevProg = curProg
			curProg = progress[i + 1]
			nextStep = curProg > prevProg ? curProg - prevProg : 0
			array[offset] = 0; array[offset + 1] = loopValue; array[offset + 2] = previousStep; array[offset + 3] = nextStep
			array[offset + 4] = 0; array[offset + 5] = loopValue; array[offset + 6] = previousStep; array[offset + 7] = nextStep
			array[offset + 8] = 0; array[offset + 9] = loopValue; array[offset + 10] = previousStep; array[offset + 11] = nextStep
			array[offset + 12] = 0; array[offset + 13] = loopValue; array[offset + 14] = previousStep; array[offset + 15] = nextStep
		}
	}
}

const writeEndpointMetadataUpdate = ( array, progress, isLooped, vertexOffset ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	let offset = vertexOffset * 4
	const lastOffset = offset + last * 16
	let prevProg = progress[0]
	let curProg = progress[1]
	let previousStep = isLooped && pointCount > 2 ? Math.max( 0, 1 - progress[pointCount - 2] ) : 0
	let nextStep = curProg > prevProg ? curProg - prevProg : 0

	array[offset + 2] = previousStep; array[offset + 3] = nextStep
	array[offset + 6] = previousStep; array[offset + 7] = nextStep
	array[offset + 10] = previousStep; array[offset + 11] = nextStep
	array[offset + 14] = previousStep; array[offset + 15] = nextStep

	const lastPrevProg = progress[last - 1]
	const lastCurProg = progress[last]
	const lastPrevStep = lastCurProg > lastPrevProg ? lastCurProg - lastPrevProg : 0
	const lastNextStep = isLooped && pointCount > 2 ? Math.max( 0, progress[1] ) : 0
	array[lastOffset + 2] = lastPrevStep; array[lastOffset + 3] = lastNextStep
	array[lastOffset + 6] = lastPrevStep; array[lastOffset + 7] = lastNextStep
	array[lastOffset + 10] = lastPrevStep; array[lastOffset + 11] = lastNextStep
	array[lastOffset + 14] = lastPrevStep; array[lastOffset + 15] = lastNextStep

	offset += 16
	for ( let i = 1; i < last; i++, offset += 16 ) {
		previousStep = nextStep
		prevProg = curProg
		curProg = progress[i + 1]
		nextStep = curProg > prevProg ? curProg - prevProg : 0
		array[offset + 2] = previousStep; array[offset + 3] = nextStep
		array[offset + 6] = previousStep; array[offset + 7] = nextStep
		array[offset + 10] = previousStep; array[offset + 11] = nextStep
		array[offset + 14] = previousStep; array[offset + 15] = nextStep
	}
}

const writeEndpointMetadataUpdateNormalizedInterior = ( array, progress, invTotalLength, penultimate, startOffset, curProg, nextStep ) => {
	let prevProg = curProg
	let previousStep = nextStep
	for ( let i = 1, offset = startOffset; i < penultimate; i++, offset += 16 ) {
		const nextProg = Math.fround( progress[i + 1] * invTotalLength )
		const step = nextProg - prevProg
		array[offset + 2] = previousStep; array[offset + 3] = step
		array[offset + 6] = previousStep; array[offset + 7] = step
		array[offset + 10] = previousStep; array[offset + 11] = step
		array[offset + 14] = previousStep; array[offset + 15] = step
		previousStep = step
		prevProg = nextProg
	}
	lastStreamedPrevStep = previousStep
}

const writeEndpointMetadataUpdateNormalized = ( array, progress, invTotalLength, isLooped, vertexOffset ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	const offset = vertexOffset * 4
	const lastOffset = offset + last * 16
	const curProg = last === 1 ? 1 : Math.fround( progress[1] * invTotalLength )
	const secondLastProg = last > 1 ? Math.fround( progress[last - 1] * invTotalLength ) : 0
	const previousStep = isLooped && pointCount > 2 ? Math.max( 0, 1 - secondLastProg ) : 0
	const nextStep = curProg > 0 ? curProg : 0

	array[offset + 2] = previousStep; array[offset + 3] = nextStep
	array[offset + 6] = previousStep; array[offset + 7] = nextStep
	array[offset + 10] = previousStep; array[offset + 11] = nextStep
	array[offset + 14] = previousStep; array[offset + 15] = nextStep

	const lastPrevStep = 1 > secondLastProg ? 1 - secondLastProg : 0
	const lastNextStep = isLooped && pointCount > 2 ? Math.max( 0, curProg ) : 0
	array[lastOffset + 2] = lastPrevStep; array[lastOffset + 3] = lastNextStep
	array[lastOffset + 6] = lastPrevStep; array[lastOffset + 7] = lastNextStep
	array[lastOffset + 10] = lastPrevStep; array[lastOffset + 11] = lastNextStep
	array[lastOffset + 14] = lastPrevStep; array[lastOffset + 15] = lastNextStep

	if ( last > 1 ) {
		const penultimate = last - 1
		writeEndpointMetadataUpdateNormalizedInterior( array, progress, invTotalLength, penultimate, offset + 16, curProg, nextStep )
		const penOffset = lastOffset - 16
		const penPrevStep = lastStreamedPrevStep
		array[penOffset + 2] = penPrevStep; array[penOffset + 3] = lastPrevStep
		array[penOffset + 6] = penPrevStep; array[penOffset + 7] = lastPrevStep
		array[penOffset + 10] = penPrevStep; array[penOffset + 11] = lastPrevStep
		array[penOffset + 14] = penPrevStep; array[penOffset + 15] = lastPrevStep
	}
}

const writeProgressAndEndpointMetadataUpdate = ( progressArray, endpointArray, progress, isLooped, vertexOffset ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	let pOffset = vertexOffset
	const lastPOffset = pOffset + last * 4
	let eOffset = vertexOffset * 4
	const lastEOffset = eOffset + last * 16
	let prevProg = progress[0]
	let curProg = progress[1]
	let previousStep = isLooped && pointCount > 2 ? Math.max( 0, 1 - progress[pointCount - 2] ) : 0
	let nextStep = curProg > prevProg ? curProg - prevProg : 0

	progressArray[pOffset] = prevProg
	progressArray[pOffset + 1] = prevProg
	progressArray[pOffset + 2] = prevProg
	progressArray[pOffset + 3] = prevProg
	endpointArray[eOffset + 2] = previousStep; endpointArray[eOffset + 3] = nextStep
	endpointArray[eOffset + 6] = previousStep; endpointArray[eOffset + 7] = nextStep
	endpointArray[eOffset + 10] = previousStep; endpointArray[eOffset + 11] = nextStep
	endpointArray[eOffset + 14] = previousStep; endpointArray[eOffset + 15] = nextStep

	const lastPrevProg = progress[last - 1]
	const lastCurProg = progress[last]
	const lastPrevStep = lastCurProg > lastPrevProg ? lastCurProg - lastPrevProg : 0
	const lastNextStep = isLooped && pointCount > 2 ? Math.max( 0, curProg ) : 0
	progressArray[lastPOffset] = lastCurProg
	progressArray[lastPOffset + 1] = lastCurProg
	progressArray[lastPOffset + 2] = lastCurProg
	progressArray[lastPOffset + 3] = lastCurProg
	endpointArray[lastEOffset + 2] = lastPrevStep; endpointArray[lastEOffset + 3] = lastNextStep
	endpointArray[lastEOffset + 6] = lastPrevStep; endpointArray[lastEOffset + 7] = lastNextStep
	endpointArray[lastEOffset + 10] = lastPrevStep; endpointArray[lastEOffset + 11] = lastNextStep
	endpointArray[lastEOffset + 14] = lastPrevStep; endpointArray[lastEOffset + 15] = lastNextStep

	pOffset += 4
	eOffset += 16
	for ( let i = 1; i < last; i++, pOffset += 4, eOffset += 16 ) {
		previousStep = nextStep
		prevProg = curProg
		curProg = progress[i + 1]
		nextStep = curProg > prevProg ? curProg - prevProg : 0
		progressArray[pOffset] = prevProg
		progressArray[pOffset + 1] = prevProg
		progressArray[pOffset + 2] = prevProg
		progressArray[pOffset + 3] = prevProg
		endpointArray[eOffset + 2] = previousStep; endpointArray[eOffset + 3] = nextStep
		endpointArray[eOffset + 6] = previousStep; endpointArray[eOffset + 7] = nextStep
		endpointArray[eOffset + 10] = previousStep; endpointArray[eOffset + 11] = nextStep
		endpointArray[eOffset + 14] = previousStep; endpointArray[eOffset + 15] = nextStep
	}
}

const writeProgressAndEndpointMetadataUpdateNormalizedInterior = (
	progressArray,
	endpointArray,
	progress,
	invTotalLength,
	penultimate,
	startPOffset,
	startEOffset,
	curProg,
	nextStep
) => {
	let prevProg = curProg
	let previousStep = nextStep
	for ( let i = 1, pOffset = startPOffset, eOffset = startEOffset; i < penultimate; i++, pOffset += 4, eOffset += 16 ) {
		const nextProg = Math.fround( progress[i + 1] * invTotalLength )
		const step = nextProg - prevProg
		progressArray[pOffset] = prevProg
		progressArray[pOffset + 1] = prevProg
		progressArray[pOffset + 2] = prevProg
		progressArray[pOffset + 3] = prevProg
		endpointArray[eOffset + 2] = previousStep; endpointArray[eOffset + 3] = step
		endpointArray[eOffset + 6] = previousStep; endpointArray[eOffset + 7] = step
		endpointArray[eOffset + 10] = previousStep; endpointArray[eOffset + 11] = step
		endpointArray[eOffset + 14] = previousStep; endpointArray[eOffset + 15] = step
		previousStep = step
		prevProg = nextProg
	}
	lastStreamedPrevProg = prevProg
	lastStreamedPrevStep = previousStep
}

const writeProgressAndEndpointMetadataUpdateNormalized = ( progressArray, endpointArray, progress, invTotalLength, isLooped, vertexOffset ) => {
	const pointCount = progress.length
	if ( pointCount < 2 ) return
	const last = pointCount - 1
	const pOffset = vertexOffset
	const lastPOffset = pOffset + last * 4
	const eOffset = vertexOffset * 4
	const lastEOffset = eOffset + last * 16
	const curProg = last === 1 ? 1 : Math.fround( progress[1] * invTotalLength )
	const secondLastProg = last > 1 ? Math.fround( progress[last - 1] * invTotalLength ) : 0
	const previousStep = isLooped && pointCount > 2 ? Math.max( 0, 1 - secondLastProg ) : 0
	const nextStep = curProg > 0 ? curProg : 0

	progressArray[pOffset] = 0
	progressArray[pOffset + 1] = 0
	progressArray[pOffset + 2] = 0
	progressArray[pOffset + 3] = 0
	endpointArray[eOffset + 2] = previousStep; endpointArray[eOffset + 3] = nextStep
	endpointArray[eOffset + 6] = previousStep; endpointArray[eOffset + 7] = nextStep
	endpointArray[eOffset + 10] = previousStep; endpointArray[eOffset + 11] = nextStep
	endpointArray[eOffset + 14] = previousStep; endpointArray[eOffset + 15] = nextStep

	const lastPrevStep = 1 > secondLastProg ? 1 - secondLastProg : 0
	const lastNextStep = isLooped && pointCount > 2 ? Math.max( 0, curProg ) : 0
	progressArray[lastPOffset] = 1
	progressArray[lastPOffset + 1] = 1
	progressArray[lastPOffset + 2] = 1
	progressArray[lastPOffset + 3] = 1
	endpointArray[lastEOffset + 2] = lastPrevStep; endpointArray[lastEOffset + 3] = lastNextStep
	endpointArray[lastEOffset + 6] = lastPrevStep; endpointArray[lastEOffset + 7] = lastNextStep
	endpointArray[lastEOffset + 10] = lastPrevStep; endpointArray[lastEOffset + 11] = lastNextStep
	endpointArray[lastEOffset + 14] = lastPrevStep; endpointArray[lastEOffset + 15] = lastNextStep

	if ( last > 1 ) {
		const penultimate = last - 1
		writeProgressAndEndpointMetadataUpdateNormalizedInterior(
			progressArray,
			endpointArray,
			progress,
			invTotalLength,
			penultimate,
			pOffset + 4,
			eOffset + 16,
			curProg,
			nextStep
		)
		const penPOffset = lastPOffset - 4
		const penEOffset = lastEOffset - 16
		const penProg = lastStreamedPrevProg
		const penPrevStep = lastStreamedPrevStep
		progressArray[penPOffset] = penProg
		progressArray[penPOffset + 1] = penProg
		progressArray[penPOffset + 2] = penProg
		progressArray[penPOffset + 3] = penProg
		endpointArray[penEOffset + 2] = penPrevStep; endpointArray[penEOffset + 3] = lastPrevStep
		endpointArray[penEOffset + 6] = penPrevStep; endpointArray[penEOffset + 7] = lastPrevStep
		endpointArray[penEOffset + 10] = penPrevStep; endpointArray[penEOffset + 11] = lastPrevStep
		endpointArray[penEOffset + 14] = penPrevStep; endpointArray[penEOffset + 15] = lastPrevStep
	}
}

const writeScalarPoint = ( array, vertexIndex, value ) => {
	array[vertexIndex] = value
	array[vertexIndex + 1] = value
	array[vertexIndex + 2] = value
	array[vertexIndex + 3] = value
}

const writeUVPoint = ( array, vertexIndex, progress ) => {
	const offset = vertexIndex * 2
	array[offset] = progress
	array[offset + 1] = 0
	array[offset + 2] = progress
	array[offset + 3] = 1
	array[offset + 4] = progress
	array[offset + 5] = 0
	array[offset + 6] = progress
	array[offset + 7] = 1
}

export default MeshLineGeometry
