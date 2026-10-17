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
		if ( options ) this.buildLine( options )
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
			smoothSharpBends: false,
			verbose: false,
			...previousOptions,
			...options,
			lines,
		}
		validateGeometryOptions( nextOptions )
		this.options = nextOptions

		this.widthCallback = this.options.widthCallback || null
		// Keep existing attributes across `buildLine()` so same-sized rebuilds can
		// update their buffers in place. Optional managed attributes are reconciled
		// in `build()`; custom attributes remain untouched.
		this._attrs ||= {}
		this._lineCount = 0
		this._lines = [] // Store individual line arrays for multi-line mode
		this._rawLineBoundsValid = false
		this._lineLoops = [] // Store loop flag for each line
		this._lineSourceIndices = [] // Caller batch index of each stored line
		this._lineProgress ||= []
		this._lineArcCaches = null
		this.boundingBoxes ||= [] // Bounding box for each line
		if ( lines !== undefined ) this.setLines( lines )
		else this.clearGeometry()
	}

	/**
	 * Set one or more polylines and rebuild all geometry buffers.
	 * @param {import('./index.d.ts').MultiLinePoints} lines
	 * @param {boolean | boolean[]} [closed] - Optional per-line or global loop flag
	 */
	setLines( lines, closed = undefined ) {

		if ( !lines ) throw new Error( '[MeshLine] Lines data required' )

		this.options.lines = lines
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
		const prepared = prepareLinesInput(
			lines,
			this.options,
			null,
			this.options.frustumCulled !== false,
			needsArcProgress ? this._lineProgress : null
		)

		this._lines = prepared.lines
		this._rawLineBoundsValid = false
		if ( this._lineArcCaches ) {
			for ( let i = 0; i < this._lineArcCaches.length; i++ ) {
				if ( this._lineArcCaches[i] ) this._lineArcCaches[i].valid = false
			}
		}
		this._lineLoops = prepared.loops
		this._lineSourceIndices = prepared.sourceIndices
		this._preparedBounds = prepared.bounds || null
		this._preparedProgressReady = prepared.progressReady || null
		this._isSingleLoopValue = false
		this._lineCount = prepared.lines.length

		try {
			this.build()
		} catch ( error ) {
			this._lines = []
			this._lineLoops = []
			this._lineSourceIndices = []
			this._lineCount = 0
			this._preparedBounds = null
			this._preparedProgressReady = null
			this.clearGeometry()
			throw error
		}
	}

	// Helper to set or update buffer attribute efficiently
	setOrUpdateAttribute( name, array, itemSize, usage = StaticDrawUsage ) {
		const existing = this._attrs[name]

		// Check if we can reuse existing attribute (same total size)
		if ( existing && existing.itemSize === itemSize && existing.array.length === array.length && existing.array.constructor === array.constructor && existing.usage === usage ) {
			if ( existing.array !== array ) existing.copyArray( array )
			markAttributeFullUpdate( existing )
		} else {
			// Create new attribute
			if ( existing ) {
				this.deleteAttribute( name )
			}
			const attr = new BufferAttribute( array, itemSize )
			attr.setUsage( usage )
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

	setUsage( usage, name = null ) {
		for ( const [attrName, attr] of Object.entries( this._attrs ) ) {
			if ( ( name != null && attrName !== name ) || attr.usage === usage ) continue
			const replacement = attr.clone().setUsage( usage )
			this._attrs[attrName] = replacement
			this.setAttribute( attrName, replacement )
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
		if ( this._bevelJoins !== bevelJoins ) topologyMatches = false
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
			positions = this.getReusableArray( 'position', Float32Array, totalVertices * 3, 3, usage )
		}
		if ( this.options.needsPrevious ) {
			previous = this.getReusableArray( 'previous', Float32Array, totalVertices * 3, 3, usage )
		}
		if ( this.options.needsNext ) {
			next = this.getReusableArray( 'next', Float32Array, totalVertices * 3, 3, usage )
		}
		if ( this.options.needsSide ) {
			sides = this.getReusableArray( 'side', Float32Array, totalVertices, 1, usage )
		}
		const reuseSides = !!( topologyMatches && sides && sides === this._attrs.side?.array )
		// Pack incident-body ownership in the sign and side in the magnitude.
		// Unlike vertexIndex-derived bits, this survives toNonIndexed().
		joinRoles = this.getReusableArray( 'joinRole', Float32Array, totalVertices, 1, usage )
		const reuseJoinRoles = !!( topologyMatches && joinRoles === this._attrs.joinRole?.array )
		if ( this.options.needsWidth ) {
			widths = this.getReusableArray( 'width', Float32Array, totalVertices, 1, usage )
		}
		if ( this.options.needsUV ) {
			uvs = this.getReusableArray( 'uv', Float32Array, totalVertices * 2, 2, usage )
		}
		const reuseUVs = !!( topologyMatches && uvs && uvs === this._attrs.uv?.array )
		if ( this.options.needsProgress ) {
			progress = this.getReusableArray( 'progress', Float32Array, totalVertices, 1, usage )
		}
		if ( needsEndpointMetadata ) {
			endpoints = this.getReusableArray( 'endpoint', Float32Array, totalVertices * 4, 4, usage )
		}
		if ( this.options.needsVertexColor && this.options.vertexColors ) {
			colors = this.getReusableArray( 'vertexColor', Float32Array, totalVertices * 3, 3, usage )
		}

		const managedAttributes = {
			position: positions,
			previous,
			next,
			side: sides,
			joinRole: joinRoles,
			width: widths,
			uv: uvs,
			progress,
			endpoint: endpoints,
			vertexColor: colors,
		}
		for ( const [name, array] of Object.entries( managedAttributes ) ) {
			if ( array || !this._attrs[name] ) continue
			this.deleteAttribute( name )
			delete this._attrs[name]
		}

		if ( sides && !reuseSides ) {
			fillPattern4( sides, 1, -1, 1, -1 )
		}
		if ( !reuseJoinRoles ) {
			fillPattern4( joinRoles, -1, -2, 1, 2 )
		}

		// Use 32-bit indices if we exceed the 16-bit limit (65 535)
		// This prevents index overflow that can lead to wrongly connected segments
		// when drawing very large or detailed geometries.
		const IndicesArray = ( totalVertices > 65535 ) ? Uint32Array : Uint16Array
		const oldIndex = this.getIndex()
		const reuseIndex = !!(
			oldIndex &&
			oldIndex.itemSize === 1 &&
			oldIndex.array.length === totalIndices &&
			oldIndex.array.constructor === IndicesArray
		)
		const reuseConnectivity = reuseIndex && topologyMatches && oldIndex === this._meshLineIndex
		const indices = reuseIndex ? oldIndex.array : new IndicesArray( totalIndices )

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

			const lineProgress = needsLineProgress
				? ( ( !proceduralProgress && preparedProgressReady?.[lineIdx] && this._lineProgress[lineIdx] )
					? this._lineProgress[lineIdx]
					: computeLineProgress( line, proceduralProgress, this._lineProgress[lineIdx] ) )
				: null
			this._lineProgress[lineIdx] = lineProgress
			let lineMaxWidth = 1

			if ( widths ) {
				if ( widthCallback ) {
					lineMaxWidth = writeBuildWidths( widths, lineProgress, widthCallback, numPoints, isLooped, lineIdx, lineVertexOffset )
					if ( lineMaxWidth > this._maxWidthMultiplier ) this._maxWidthMultiplier = lineMaxWidth
				} else {
					widths.fill( 1, lineVertexOffset, lineVertexOffset + numPoints * 4 )
				}
			}

			if ( colorSource ) {
				writeColorLine( colors, colorSource, colorStart, numPoints, isLooped, lineVertexOffset )
			}

			if ( positions && previous && next ) {
				vertexOffset = writePositionAndNeighbors( line, isLooped, positions, previous, next, lineVertexOffset )
			} else {
				if ( positions ) writePositionRange( positions, line, lineVertexOffset, 0, numPoints )
				if ( previous || next ) writeNeighborRange( line, isLooped, previous, next, lineVertexOffset, 0, numPoints )
				vertexOffset = lineVertexOffset + numPoints * 4
			}

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
		if ( positions ) {
			this.setOrUpdateAttribute( 'position', positions, 3, usage )
		}
		if ( previous ) {
			this.setOrUpdateAttribute( 'previous', previous, 3, usage )
		}
		if ( next ) {
			this.setOrUpdateAttribute( 'next', next, 3, usage )
		}
		if ( sides && !reuseSides ) {
			this.setOrUpdateAttribute( 'side', sides, 1, usage )
		}
		if ( !reuseJoinRoles ) {
			this.setOrUpdateAttribute( 'joinRole', joinRoles, 1, usage )
		}
		if ( widths ) {
			this.setOrUpdateAttribute( 'width', widths, 1, usage )
		}
		if ( uvs ) {
			this.setOrUpdateAttribute( 'uv', uvs, 2, usage )
		}
		if ( progress ) {
			this.setOrUpdateAttribute( 'progress', progress, 1, usage )
		}
		if ( endpoints ) {
			this.setOrUpdateAttribute( 'endpoint', endpoints, 4, usage )
		}
		if ( colors ) {
			this.setOrUpdateAttribute( 'vertexColor', colors, 3, usage )
		}

		// Set indices
		if ( reuseIndex ) {
			if ( !reuseConnectivity ) markAttributeFullUpdate( oldIndex )
		} else {
			this.setIndex( new BufferAttribute( indices, 1 ) )
		}
		this._meshLineIndex = this.getIndex()
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

		this.setDrawRange( 0, Infinity )

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
			if ( this._attrs[name] === attribute ) delete this._attrs[name]
		}
	}

	clearGeometry() {
		for ( const name of Object.keys( this.attributes ) ) {
			this.deleteAttribute( name )
		}
		this.setIndex( null )
		this._attrs = {}
		this._lineProgress = []
		this._lineArcCaches = null
		this._lineWidthScratch = []
		this._lineMaxWidths = []
		this._linePointCounts = []
		this._linePointCountsScratch = []
		this._lineIndexCounts = []
		this._lineVertexOffsets = []
		this._meshLineIndex = null
		this._updatePrepared = null
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
		for ( let idx = 0; idx < this._lines.length; idx++ ) {
			const box = boxes[idx] || new Box3()
			const raw = rawBounds[idx] ||= new Float64Array( 6 )
			if ( !reuseRawBounds ) {
				const bounds = preparedBounds?.[idx]
				if ( bounds ) {
					raw.set( bounds )
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
			box.min.set( raw[0], raw[1], raw[2] )
			box.max.set( raw[3], raw[4], raw[5] )
			if ( padding > 0 ) box.expandByScalar( padding )
			boxes[idx] = box
			if ( idx === 0 ) this.boundingBox.copy( box )
			else this.boundingBox.union( box )
		}
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
		if ( !this.boundingBox ) this.boundingBox = new Box3()
		this.boundingBox.makeEmpty()
		if ( !this.boundingBoxes || this.boundingBoxes.length === 0 ) return
		this.boundingBox.copy( this.boundingBoxes[0] )
		for ( let i = 1; i < this.boundingBoxes.length; i++ ) {
			this.boundingBox.union( this.boundingBoxes[i] )
		}
	}

	computeBoundingSphere( boundingBoxReady = false ) {
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
		this._lineIndexCounts = []
		this._lineVertexOffsets = []
		this._meshLineIndex = null
		this._updatePrepared = null
		this._preparedBounds = null
		this._preparedProgressReady = null
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

		this._updatePrepared ||= { lines: [], loops: [], sourceIndices: [] }
		const prepared = prepareLinesInput(
			pts,
			this.options,
			this._updatePrepared,
			updateBounding,
			progressChanged ? this._lineProgress : null
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
		const widthCallback = this.widthCallback
		const widthChanged = !!( widthArray && widthCallback )
		if ( widthArray ) {
			this._maxWidthMultiplier = 1
			this._lineWidthScratch ||= []
		}

		// Evaluate every callback before mutating live GPU attributes. If a user
		// callback rejects an update, the previously rendered geometry stays valid.
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
			let lineMaxWidth = 1

			if ( !widthChanged ) {
				this._lineMaxWidths[lineIdx] = lineMaxWidth
				continue
			}
			const widths = this._lineWidthScratch[lineIdx]?.length === numPoints
				? this._lineWidthScratch[lineIdx]
				: new Float32Array( numPoints )
			this._lineWidthScratch[lineIdx] = widths
			lineMaxWidth = evaluateLineWidths( widths, lineProgress, widthCallback, numPoints, isLooped, lineIdx )
			if ( lineMaxWidth > this._maxWidthMultiplier ) this._maxWidthMultiplier = lineMaxWidth
			this._lineMaxWidths[lineIdx] = lineMaxWidth
		}
		if ( widthArray ) this._lineWidthScratch.length = widthChanged ? newLines.length : 0
		this._lineMaxWidths.length = newLines.length

		// Process each line
		let globalVertexIndex = 0

		for ( let lineIdx = 0; lineIdx < newLines.length; lineIdx++ ) {
			const line = newLines[lineIdx]
			const isLooped = newLoops[lineIdx]
			const numPoints = line.length / 3
			const lineProgress = this._lineProgress[lineIdx]
			const lineWidths = widthChanged ? this._lineWidthScratch[lineIdx] : null
			const lineVertexOffset = globalVertexIndex

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
				// per array beats interleaving every output stream per point.
				if ( progressChanged ) {
					if ( progressArray ) writeScalarLine( progressArray, lineProgress, lineVertexOffset )
					if ( uvArray ) writeUVLineUpdate( uvArray, lineProgress, lineVertexOffset )
				}
				if ( widthChanged ) writeScalarLine( widthArray, lineWidths, lineVertexOffset )
				if ( endpointArray && endpointAttr.itemSize === 4 && progressChanged ) {
					writeEndpointMetadataUpdate( endpointArray, lineProgress, isLooped, lineVertexOffset )
				}
				continue
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
		const previousLines = this._lines
		const previousLoops = this._lineLoops
		const previousSourceIndices = this._lineSourceIndices
		this._lines = newLines
		this._rawLineBoundsValid = false
		if ( this._lineArcCaches ) {
			for ( let i = 0; i < this._lineArcCaches.length; i++ ) {
				if ( this._lineArcCaches[i] ) this._lineArcCaches[i].valid = false
			}
		}
		this._lineLoops = newLoops
		this._lineSourceIndices = prepared.sourceIndices
		this._updatePrepared.lines = previousLines
		this._updatePrepared.loops = previousLoops
		this._updatePrepared.sourceIndices = previousSourceIndices
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
		let restoreRange = null

		if ( callbackCanReject ) {
			this._lineWidthScratch ||= []
			this._partialRestoreScratch = this._partialRestoreScratch?.length >= range.length
				? this._partialRestoreScratch
				: new Float32Array( range.length )
			restoreRange = this._partialRestoreScratch.subarray( 0, range.length )
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
					if ( nx < minX ) minX = nx
					else if ( nx > maxX ) maxX = nx
					if ( ny < minY ) minY = ny
					else if ( ny > maxY ) maxY = ny
					if ( nz < minZ ) minZ = nz
					else if ( nz > maxZ ) maxZ = nz
				}
				raw[0] = minX; raw[1] = minY; raw[2] = minZ
				raw[3] = maxX; raw[4] = maxY; raw[5] = maxZ
			} else {
				this._rawLineBoundsValid = false
			}
		} else {
			this._rawLineBoundsValid = false
		}

		line.set( range, startPoint * 3 )
		if ( hasSyntheticSeam && startPoint === 0 ) {
			line.set( line.subarray( 0, 3 ), sourcePointCount * 3 )
		}

		let lineProgress = this._lineProgress[lineIndex]
		let preparedWidths = null
		let lineMaxWidth = this._lineMaxWidths[lineIndex] ?? 1
		try {
			if ( needsArcProgress ) {
				this._lineArcCaches ||= []
				lineProgress = updateLineProgressRange(
					line,
					startPoint,
					endPoint,
					hasSyntheticSeam,
					lineProgress,
					this._lineArcCaches,
					lineIndex
				)
				this._lineProgress[lineIndex] = lineProgress
			} else if ( proceduralProgress && !lineProgress ) {
				lineProgress = computeLineProgress( line, true, lineProgress )
				this._lineProgress[lineIndex] = lineProgress
			} else if ( this._lineArcCaches?.[lineIndex] ) {
				this._lineArcCaches[lineIndex].valid = false
			}

			if ( callbackCanReject ) {
				preparedWidths = this._lineWidthScratch[lineIndex]?.length === storedPointCount
					? this._lineWidthScratch[lineIndex]
					: new Float32Array( storedPointCount )
				this._lineWidthScratch[lineIndex] = preparedWidths
				lineMaxWidth = evaluateLineWidths( preparedWidths, lineProgress, widthCallback, storedPointCount, isLooped, lineIndex )
			}
		} catch ( error ) {
			this._rawLineBoundsValid = false
			if ( this._lineArcCaches?.[lineIndex] ) this._lineArcCaches[lineIndex].valid = false
			if ( restoreRange ) {
				line.set( restoreRange, startPoint * 3 )
				if ( hasSyntheticSeam && startPoint === 0 ) line.set( line.subarray( 0, 3 ), sourcePointCount * 3 )
				if ( needsArcProgress ) this._lineProgress[lineIndex] = computeLineProgress( line, false, lineProgress )
			}
			throw error
		}

		let lineVertexOffset = this._lineVertexOffsets?.[lineIndex]
		if ( lineVertexOffset === undefined ) {
			lineVertexOffset = 0
			for ( let i = 0; i < lineIndex; i++ ) lineVertexOffset += this._lines[i].length / 3 * 4
		}

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

		if ( needsArcProgress ) {
			if ( progressAttr ) {
				writeScalarLine( progressAttr.array, lineProgress, lineVertexOffset )
				markAttributeUpdateRange( progressAttr, lineVertexOffset, storedPointCount * 4 )
			}
			if ( uvAttr ) {
				writeUVLineUpdate( uvAttr.array, lineProgress, lineVertexOffset )
				markAttributeUpdateRange( uvAttr, lineVertexOffset * 2, storedPointCount * 8 )
			}
			if ( endpointAttr?.itemSize === 4 ) {
				writeEndpointMetadataUpdate( endpointAttr.array, lineProgress, isLooped, lineVertexOffset )
				markAttributeUpdateRange( endpointAttr, lineVertexOffset * 4, storedPointCount * 16 )
			}
		}

		if ( preparedWidths ) {
			writeScalarLine( widthAttr.array, preparedWidths, lineVertexOffset )
			markAttributeUpdateRange( widthAttr, lineVertexOffset, storedPointCount * 4 )
			this._lineMaxWidths[lineIndex] = lineMaxWidth
			this._maxWidthMultiplier = 1
			for ( let i = 0; i < this._lineMaxWidths.length; i++ ) {
				const maxW = this._lineMaxWidths[i] ?? 1
				if ( maxW > this._maxWidthMultiplier ) this._maxWidthMultiplier = maxW
			}
		}

		this.options.lines = rangeEditSource(
			this.options.lines,
			this._lines,
			this._lineLoops,
			this._lineSourceIndices,
			lineIndex,
			!this.options.gpuPositionNode
		)

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
	if ( ArrayBuffer.isView( pts ) && !( pts instanceof DataView ) ) {
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

const isSingleLineInput = input => input instanceof Float32Array || input instanceof BufferGeometry || isSingleLineArray( input )

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
	const lastLoopedPoint = isLooped ? numPoints - 1 : -1
	for ( let i = 0, vo = lineVertexOffset; i < numPoints; i++, vo += 4 ) {
		const sourceIndex = i === lastLoopedPoint ? 0 : i
		const sourceProgress = sourceIndex === 0 ? 0 : lineProgress[i]
		const rawWidth = widthCallback( sourceProgress, sourceIndex, lineIdx )
		const w = Math.abs( rawWidth )
		if ( !( w <= 3.4028234663852886e+38 ) ) {
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIdx}` )
		}
		if ( w > lineMaxWidth ) lineMaxWidth = w
		widths[vo] = widths[vo + 1] = widths[vo + 2] = widths[vo + 3] = w
	}
	return lineMaxWidth
}

const evaluateLineWidths = ( widths, lineProgress, widthCallback, numPoints, isLooped, lineIdx ) => {
	let lineMaxWidth = 1
	const lastLoopedPoint = isLooped ? numPoints - 1 : -1
	for ( let i = 0; i < numPoints; i++ ) {
		const sourceIndex = i === lastLoopedPoint ? 0 : i
		const progress = sourceIndex === 0 ? 0 : lineProgress[i]
		const rawWidth = widthCallback( progress, sourceIndex, lineIdx )
		const width = Math.abs( rawWidth )
		if ( !( width <= 3.4028234663852886e+38 ) ) {
			throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIdx}` )
		}
		widths[i] = width
		if ( width > lineMaxWidth ) lineMaxWidth = width
	}
	return lineMaxWidth
}

const writeLineIndices16 = ( indices, indexOffset, vertexIndex, numPoints, bevelJoins, isLooped ) => {
	for ( let i = 0, o = vertexIndex; i < numPoints - 1; i++, o += 4, indexOffset += 6 ) {
		indices[indexOffset] = o + 2
		indices[indexOffset + 1] = o + 3
		indices[indexOffset + 2] = o + 4
		indices[indexOffset + 3] = o + 4
		indices[indexOffset + 4] = o + 3
		indices[indexOffset + 5] = o + 5
	}
	if ( bevelJoins ) {
		const firstJoin = isLooped ? 0 : 1
		for ( let i = firstJoin, o = vertexIndex + firstJoin * 4; i < numPoints - 1; i++, o += 4, indexOffset += 6 ) {
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
	for ( let i = 0, o = vertexIndex; i < numPoints - 1; i++, o += 4, indexOffset += 6 ) {
		indices[indexOffset] = o + 2
		indices[indexOffset + 1] = o + 3
		indices[indexOffset + 2] = o + 4
		indices[indexOffset + 3] = o + 4
		indices[indexOffset + 4] = o + 3
		indices[indexOffset + 5] = o + 5
	}
	if ( bevelJoins ) {
		const firstJoin = isLooped ? 0 : 1
		for ( let i = firstJoin, o = vertexIndex + firstJoin * 4; i < numPoints - 1; i++, o += 4, indexOffset += 6 ) {
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

const scanLineBoundsAndProgress = ( line, pointCount, bounds, progressTarget ) => {
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
		if ( x < minX ) minX = x
		if ( x > maxX ) maxX = x
		if ( y < minY ) minY = y
		if ( y > maxY ) maxY = y
		if ( z < minZ ) minZ = z
		if ( z > maxZ ) maxZ = z
		totalLength += Math.sqrt( distSq )
		progressTarget[i] = totalLength
		prevX = x
		prevY = y
		prevZ = z
	}
	bounds[0] = minX
	bounds[1] = minY
	bounds[2] = minZ
	bounds[3] = maxX
	bounds[4] = maxY
	bounds[5] = maxZ
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

const scanLineBoundsOnly = ( line, pointCount, bounds ) => {
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
		if ( x < minX ) minX = x
		if ( x > maxX ) maxX = x
		if ( y < minY ) minY = y
		if ( y > maxY ) maxY = y
		if ( z < minZ ) minZ = z
		if ( z > maxZ ) maxZ = z
		prevX = x
		prevY = y
		prevZ = z
	}
	bounds[0] = minX
	bounds[1] = minY
	bounds[2] = minZ
	bounds[3] = maxX
	bounds[4] = maxY
	bounds[5] = maxZ
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

const sanitizeLinePoints = ( line, bounds = null, progressTarget = null ) => {
	const pointCount = Math.floor( line.length / 3 )
	const writeProgress = progressTarget?.length === pointCount

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
			const totalLength = scanLineBoundsAndProgress( line, pointCount, bounds, progressTarget )
			if ( totalLength >= 0 ) {
				normalizeLineProgress( progressTarget, pointCount, totalLength )
				return line
			}
		} else if ( writeProgress ) {
			const totalLength = scanLineProgressOnly( line, pointCount, progressTarget )
			if ( totalLength >= 0 ) {
				normalizeLineProgress( progressTarget, pointCount, totalLength )
				return line
			}
		} else if ( bounds ) {
			if ( scanLineBoundsOnly( line, pointCount, bounds ) ) return line
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

const appendClosingPoint = line => {
	const looped = new Float32Array( line.length + 3 )
	looped.set( line )
	looped[line.length] = line[0]
	looped[line.length + 1] = line[1]
	looped[line.length + 2] = line[2]
	return looped
}

const prepareLinesInput = ( input, options, target = null, collectBounds = false, progressTargets = null ) => {
	const prepared = target || { lines: [], loops: [], sourceIndices: [] }
	const lines = prepared.lines
	const loops = prepared.loops
	const sourceIndices = prepared.sourceIndices
	lines.length = 0
	loops.length = 0
	sourceIndices.length = 0
	const boundsList = collectBounds ? ( prepared.bounds ||= [] ) : null
	const progressReady = progressTargets ? ( prepared.progressReady ||= [] ) : null
	const smooth = options.smoothSharpBends === true && !options.gpuPositionNode
	const dotThreshold = options.smoothSharpBendsThreshold ?? -0.5
	const alpha = options.smoothSharpBendsAlpha ?? 0.001
	const singleLine = isSingleLineInput( input )
	const sourceCount = singleLine ? 1 : ( input?.length ?? 0 )

	for ( let i = 0; i < sourceCount; i++ ) {
		const points = singleLine ? input : input[i]
		if ( !points || points.length === 0 ) continue

		const requestedLoop = typeof options.closed === 'boolean' ? options.closed : ( options.closed?.[i] ?? false )
		const outputIndex = lines.length
		const lineBounds = boundsList ? ( boundsList[outputIndex] || new Float64Array( 6 ) ) : null
		const converted = toFloat32( points )
		const pointCount = Math.floor( converted.length / 3 )
		let progressTarget = progressTargets?.[outputIndex] || null
		if ( progressTargets && !requestedLoop && !smooth && pointCount >= 2 ) {
			if ( !progressTarget || progressTarget.length !== pointCount ) {
				progressTarget = new Float32Array( pointCount )
			}
		}
		let line = sanitizeLinePoints(
			converted,
			lineBounds,
			!requestedLoop && !smooth ? progressTarget : null
		)
		let hasPreparedProgress = !!(
			progressTarget &&
			line === converted &&
			progressTarget.length === line.length / 3 &&
			!requestedLoop &&
			!smooth
		)
		if ( requestedLoop ) line = removeClosingPoint( line )
		let isLooped = !!requestedLoop && line.length >= 9

		if ( smooth && line.length >= 9 ) {
			line = sanitizeLinePoints( subdivideSharpBends( line, isLooped, dotThreshold, alpha ), lineBounds )
			hasPreparedProgress = false
			if ( requestedLoop ) line = removeClosingPoint( line )
			isLooped = !!requestedLoop && line.length >= 9
		}

		if ( line.length < 6 ) continue
		if ( isLooped && !options.gpuPositionNode ) line = appendClosingPoint( line )

		lines.push( line )
		loops.push( isLooped )
		sourceIndices.push( i )
		if ( boundsList ) boundsList[outputIndex] = lineBounds
		if ( hasPreparedProgress ) progressTargets[outputIndex] = progressTarget
		if ( progressReady ) progressReady[outputIndex] = hasPreparedProgress
	}
	if ( boundsList ) boundsList.length = lines.length
	if ( progressReady ) progressReady.length = lines.length

	return prepared
}

// Rebuild source after a setPositionRange() edit. The edit lands in the stored
// line, which copies the caller's array for converted input and closed loops.
// Unless the source already shares the edited line's memory, it moves to the
// stored points without their synthetic seams. A batch becomes a copy that
// keeps each stored line at its caller index, dropped empty or degenerate
// lines included, so per-line `closed` flags still match.
const rangeEditSource = ( source, lines, loops, sourceIndices, lineIndex, syntheticSeams ) => {
	const singleLine = isSingleLineInput( source )
	const sourceLine = singleLine ? source : source[sourceIndices[lineIndex]]
	if ( sourceLine?.buffer === lines[lineIndex].buffer ) return source
	const sourcePoints = ( line, i ) => syntheticSeams && loops[i] ? line.subarray( 0, line.length - 3 ) : line
	if ( singleLine ) return sourcePoints( lines[lineIndex], lineIndex )
	const batch = Array.from( source )
	for ( let i = 0; i < lines.length; i++ ) batch[sourceIndices[i]] = sourcePoints( lines[i], i )
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
	for ( let i = 1; i < last; i++ ) {
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

const updateLineProgressRange = ( line, startPoint, endPoint, hasSyntheticSeam, target, caches, lineIndex ) => {
	const pointCount = line.length / 3
	const result = target?.length === pointCount ? target : new Float32Array( pointCount )
	result[0] = 0
	if ( pointCount < 2 ) return result

	const cache = lineIndex < caches.length ? caches[lineIndex] : null
	const last = pointCount - 1
	if ( !cache || !cache.valid || cache.pointCount !== pointCount ) {
		const segLengths = cache?.segLengths?.length >= pointCount ? cache.segLengths : new Float64Array( pointCount )
		const totalLength = buildLineArcCache( line, pointCount, segLengths, result )
		caches[lineIndex] = { pointCount, segLengths, totalLength, valid: true }
		normalizeLineProgress( result, pointCount, totalLength )
		return result
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

	result[last] = 1
	const acc = ( totalLength <= 0 || !Number.isFinite( totalLength ) )
		? normalizeCachedProgressFallback( segLengths, result, last )
		: normalizeCachedProgress( segLengths, result, last, 1 / totalLength )
	cache.totalLength = acc + segLengths[last]
	return result
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
			colors[vo] = colors[vo + 3] = colors[vo + 6] = colors[vo + 9] = r
			colors[vo + 1] = colors[vo + 4] = colors[vo + 7] = colors[vo + 10] = g
			colors[vo + 2] = colors[vo + 5] = colors[vo + 8] = colors[vo + 11] = b
		} else {
			colors[vo] = colors[vo + 3] = colors[vo + 6] = colors[vo + 9] = 0
			colors[vo + 1] = colors[vo + 4] = colors[vo + 7] = colors[vo + 10] = 0
			colors[vo + 2] = colors[vo + 5] = colors[vo + 8] = colors[vo + 11] = 0
		}
	}
}

const markAttributeFullUpdate = attribute => {
	const fullRange = attribute._meshLineFullUpdateRange || { start: 0, count: 0 }
	fullRange.start = 0
	fullRange.count = attribute.array.length
	attribute._meshLineFullUpdateRange = fullRange
	attribute.updateRanges[0] = fullRange
	attribute.updateRanges.length = 1
	attribute.needsUpdate = true
}

const markAttributeUpdateRange = ( attribute, start, count ) => {
	if ( !attribute || count <= 0 ) return
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
	if ( rangeStart === 0 && rangeEnd === attribute.array.length ) {
		if ( mergedTarget ) {
			const idx = ranges.indexOf( mergedTarget )
			if ( idx !== -1 ) ranges.splice( idx, 1 )
		}
		const fullRange = attribute._meshLineFullUpdateRange || { start: 0, count: attribute.array.length }
		fullRange.start = 0
		fullRange.count = attribute.array.length
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
		array[targetOffset] = array[targetOffset + 3] = array[targetOffset + 6] = array[targetOffset + 9] = x
		array[targetOffset + 1] = array[targetOffset + 4] = array[targetOffset + 7] = array[targetOffset + 10] = y
		array[targetOffset + 2] = array[targetOffset + 5] = array[targetOffset + 8] = array[targetOffset + 11] = z
	}
}

const writeNeighborRange = ( line, isLooped, previous, next, vertexOffset, startPoint, endPoint ) => {
	if ( !previous && !next ) return
	const pointCount = line.length / 3
	for ( let i = startPoint; i < endPoint; i++ ) {
		const sourceOffset = i * 3
		const targetOffset = ( vertexOffset + i * 4 ) * 3
		if ( previous ) {
			const previousOffset = i > 0
				? sourceOffset - 3
				: ( isLooped ? ( pointCount - 2 ) * 3 : sourceOffset )
			const x = line[previousOffset]
			const y = line[previousOffset + 1]
			const z = line[previousOffset + 2]
			previous[targetOffset] = previous[targetOffset + 3] = previous[targetOffset + 6] = previous[targetOffset + 9] = x
			previous[targetOffset + 1] = previous[targetOffset + 4] = previous[targetOffset + 7] = previous[targetOffset + 10] = y
			previous[targetOffset + 2] = previous[targetOffset + 5] = previous[targetOffset + 8] = previous[targetOffset + 11] = z
		}
		if ( next ) {
			const nextOffset = i < pointCount - 1
				? sourceOffset + 3
				: ( isLooped ? 3 : sourceOffset )
			const x = line[nextOffset]
			const y = line[nextOffset + 1]
			const z = line[nextOffset + 2]
			next[targetOffset] = next[targetOffset + 3] = next[targetOffset + 6] = next[targetOffset + 9] = x
			next[targetOffset + 1] = next[targetOffset + 4] = next[targetOffset + 7] = next[targetOffset + 10] = y
			next[targetOffset + 2] = next[targetOffset + 5] = next[targetOffset + 8] = next[targetOffset + 11] = z
		}
	}
}

const markNeighborUpdateRanges = ( previous, next, vertexOffset, startPoint, endPoint ) => {
	const start = ( vertexOffset + startPoint * 4 ) * 3
	const count = ( endPoint - startPoint ) * 12
	markAttributeUpdateRange( previous, start, count )
	markAttributeUpdateRange( next, start, count )
}

const writeScalarLine = ( array, values, vertexOffset ) => {
	for ( let i = 0, targetOffset = vertexOffset; i < values.length; i++, targetOffset += 4 ) {
		array[targetOffset] = array[targetOffset + 1] = array[targetOffset + 2] = array[targetOffset + 3] = values[i]
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
		array[targetOffset] = array[targetOffset + 2] = array[targetOffset + 4] = array[targetOffset + 6] = value
	}
}

const writePositionsQuad = ( line, pointCount, positions, baseOffset ) => {
	for ( let sourceOffset = 0, endOffset = pointCount * 3, targetOffset = baseOffset; sourceOffset < endOffset; sourceOffset += 3, targetOffset += 12 ) {
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		positions[targetOffset] = positions[targetOffset + 3] = positions[targetOffset + 6] = positions[targetOffset + 9] = x
		positions[targetOffset + 1] = positions[targetOffset + 4] = positions[targetOffset + 7] = positions[targetOffset + 10] = y
		positions[targetOffset + 2] = positions[targetOffset + 5] = positions[targetOffset + 8] = positions[targetOffset + 11] = z
	}
}

const writePositionAndNeighbors = ( line, isLooped, positions, previous, next, vertexOffset ) => {
	const pointCount = line.length / 3
	if ( pointCount < 2 ) return vertexOffset
	const baseOffset = vertexOffset * 3
	const lastOffset = baseOffset + ( pointCount - 1 ) * 12

	writePositionsQuad( line, pointCount, positions, baseOffset )

	previous.set( positions.subarray( baseOffset, lastOffset ), baseOffset + 12 )
	const prevSourceOffset = isLooped ? lastOffset - 12 : baseOffset
	previous[baseOffset] = previous[baseOffset + 3] = previous[baseOffset + 6] = previous[baseOffset + 9] = positions[prevSourceOffset]
	previous[baseOffset + 1] = previous[baseOffset + 4] = previous[baseOffset + 7] = previous[baseOffset + 10] = positions[prevSourceOffset + 1]
	previous[baseOffset + 2] = previous[baseOffset + 5] = previous[baseOffset + 8] = previous[baseOffset + 11] = positions[prevSourceOffset + 2]

	next.set( positions.subarray( baseOffset + 12, lastOffset + 12 ), baseOffset )
	const nextSourceOffset = isLooped ? baseOffset + 12 : lastOffset
	next[lastOffset] = next[lastOffset + 3] = next[lastOffset + 6] = next[lastOffset + 9] = positions[nextSourceOffset]
	next[lastOffset + 1] = next[lastOffset + 4] = next[lastOffset + 7] = next[lastOffset + 10] = positions[nextSourceOffset + 1]
	next[lastOffset + 2] = next[lastOffset + 5] = next[lastOffset + 8] = next[lastOffset + 11] = positions[nextSourceOffset + 2]

	return vertexOffset + pointCount * 4
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
	array[offset] = array[offset + 4] = array[offset + 8] = array[offset + 12] = openStart
	if ( !freshZeroedOpen ) {
		array[offset + 1] = array[offset + 5] = array[offset + 9] = array[offset + 13] = loopValue
	}
	array[offset + 2] = array[offset + 6] = array[offset + 10] = array[offset + 14] = previousStep
	array[offset + 3] = array[offset + 7] = array[offset + 11] = array[offset + 15] = nextStep

	const lastPrevProg = progress[last - 1]
	const lastCurProg = progress[last]
	const lastPrevStep = lastCurProg > lastPrevProg ? lastCurProg - lastPrevProg : 0
	const lastNextStep = isLooped && pointCount > 2 ? Math.max( 0, progress[1] ) : 0
	const openEnd = isLooped ? 0 : 1
	array[lastOffset] = array[lastOffset + 4] = array[lastOffset + 8] = array[lastOffset + 12] = openEnd
	if ( !freshZeroedOpen ) {
		array[lastOffset + 1] = array[lastOffset + 5] = array[lastOffset + 9] = array[lastOffset + 13] = loopValue
	}
	array[lastOffset + 2] = array[lastOffset + 6] = array[lastOffset + 10] = array[lastOffset + 14] = lastPrevStep
	array[lastOffset + 3] = array[lastOffset + 7] = array[lastOffset + 11] = array[lastOffset + 15] = lastNextStep

	offset += 16
	if ( freshZeroedOpen ) {
		for ( let i = 1; i < last; i++, offset += 16 ) {
			previousStep = nextStep
			prevProg = curProg
			curProg = progress[i + 1]
			nextStep = curProg > prevProg ? curProg - prevProg : 0
			array[offset + 2] = array[offset + 6] = array[offset + 10] = array[offset + 14] = previousStep
			array[offset + 3] = array[offset + 7] = array[offset + 11] = array[offset + 15] = nextStep
		}
	} else {
		for ( let i = 1; i < last; i++, offset += 16 ) {
			previousStep = nextStep
			prevProg = curProg
			curProg = progress[i + 1]
			nextStep = curProg > prevProg ? curProg - prevProg : 0
			array[offset] = array[offset + 4] = array[offset + 8] = array[offset + 12] = 0
			array[offset + 1] = array[offset + 5] = array[offset + 9] = array[offset + 13] = loopValue
			array[offset + 2] = array[offset + 6] = array[offset + 10] = array[offset + 14] = previousStep
			array[offset + 3] = array[offset + 7] = array[offset + 11] = array[offset + 15] = nextStep
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

	array[offset + 2] = array[offset + 6] = array[offset + 10] = array[offset + 14] = previousStep
	array[offset + 3] = array[offset + 7] = array[offset + 11] = array[offset + 15] = nextStep

	const lastPrevProg = progress[last - 1]
	const lastCurProg = progress[last]
	const lastPrevStep = lastCurProg > lastPrevProg ? lastCurProg - lastPrevProg : 0
	const lastNextStep = isLooped && pointCount > 2 ? Math.max( 0, progress[1] ) : 0
	array[lastOffset + 2] = array[lastOffset + 6] = array[lastOffset + 10] = array[lastOffset + 14] = lastPrevStep
	array[lastOffset + 3] = array[lastOffset + 7] = array[lastOffset + 11] = array[lastOffset + 15] = lastNextStep

	offset += 16
	for ( let i = 1; i < last; i++, offset += 16 ) {
		previousStep = nextStep
		prevProg = curProg
		curProg = progress[i + 1]
		nextStep = curProg > prevProg ? curProg - prevProg : 0
		array[offset + 2] = array[offset + 6] = array[offset + 10] = array[offset + 14] = previousStep
		array[offset + 3] = array[offset + 7] = array[offset + 11] = array[offset + 15] = nextStep
	}
}

const writeScalarPoint = ( array, vertexIndex, value ) => {
	array[vertexIndex] = array[vertexIndex + 1] = array[vertexIndex + 2] = array[vertexIndex + 3] = value
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
