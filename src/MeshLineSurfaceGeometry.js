import { Box3, BufferAttribute, BufferGeometry, Sphere, StaticDrawUsage, StreamDrawUsage } from 'three/webgpu'

const EPSILON = 1e-10
const DUPLICATE_EPSILON = 1e-12
const REVERSAL_SPLIT_ANGLE = Math.PI / 180
const REVERSAL_SPLIT_DOT = -Math.cos( REVERSAL_SPLIT_ANGLE )
const CLIPPED_INNER_MARGIN = 1e-4
const SURFACE_ATTRIBUTE_NAMES = new Set( ['position', 'normal', 'tangent', 'uv', 'progress', 'side'] )

// Three r186-r187 keep a replaced vertex or index buffer on the GPU until a JS
// GC collects its attribute, and renderer.info.memory never drops. Rebuilds
// free the buffers they drop through the renderer that last drew the surface.
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

// A dynamic surface whose vertex count changes keeps buffers with room to grow:
// round joins re-tessellate as the path bends, and new GPU buffers every frame
// cost far more than the surface itself. The first build and any exact fit stay
// exact, so only a count that really changes pays for headroom, and a count far
// below the capacity gives it back.
const CAPACITY_GROWTH = 1.5
const CAPACITY_SHRINK = 4
const resolveCapacity = ( current, needed ) => {
	if ( current === 0 || current === needed ) return needed
	if ( current > needed && current <= needed * CAPACITY_SHRINK ) return current
	return Math.ceil( needed * CAPACITY_GROWTH )
}

const DEFAULT_SURFACE_OPTIONS = {
	frame: 'transport',
	up: [0, 1, 0],
	bank: 0,
	uvMode: 'distance',
	uvScale: 1,
}

const DEFAULT_JOIN_OPTIONS = {
	type: 'miter',
	limit: 4,
	segments: 8,
	inner: 'exact',
}

const DEFAULT_CAP_OPTIONS = {
	type: 'butt',
	segments: 8,
}

/**
 * CPU correctness-oracle geometry for camera-independent ribbons and roads.
 *
 * Ordinary miter/butt paths retain a compact two-vertices-per-path-row strip.
 * Bevels, round joins, caps, over-limit miters, and reversals opt into a
 * variable-topology pass only when the requested shape actually needs it.
 */
export class MeshLineSurfaceGeometry extends BufferGeometry {

	constructor( options = null ) {
		super()
		this.type = 'MeshLineSurfaceGeometry'
		this.isMeshLineSurfaceGeometry = true
		this._lines = []
		this._surfaceLines = []
		this._lineRanges = []
		this._renderer = null
		this._clearedDrawRange = null
		this._vertexCount = 0
		this._indexCount = 0

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
	 * Vertices in use. A dynamic surface keeps its buffers when its vertex count
	 * changes, so `attributes.position.count` can be a larger capacity.
	 * @type {number}
	 */
	get vertexCount() {
		return this._vertexCount
	}

	/**
	 * Indices in use. Past them, a buffer with spare capacity holds zeros:
	 * degenerate triangles that draw nothing.
	 * @type {number}
	 */
	get indexCount() {
		return this._indexCount
	}

	// A copy holds the same buffers, spare capacity included.
	copy( source ) {
		super.copy( source )
		this._vertexCount = source._vertexCount ?? source.attributes?.position?.count ?? 0
		this._indexCount = source._indexCount ?? source.index?.count ?? 0
		return this
	}

	dispose() {
		this._renderer = null
		super.dispose()
	}

	/**
	 * Build the complete surface from one or more centerline paths.
	 * @param {object} options
	 */
	buildLine( options = {} ) {
		const previousOptions = this.options ?? {}
		const lines = options.lines !== undefined ? options.lines : ( options.points !== undefined ? options.points : previousOptions.lines )
		const surface = {
			...DEFAULT_SURFACE_OPTIONS,
			...( previousOptions.surface || {} ),
			...( options.surface || {} ),
		}
		const joinInput = options.join !== undefined ? options.join : previousOptions.join
		const join = typeof joinInput === 'string'
			? { ...DEFAULT_JOIN_OPTIONS, type: joinInput }
			: {
				...DEFAULT_JOIN_OPTIONS,
				...( typeof previousOptions.join === 'object' ? previousOptions.join : {} ),
				...( typeof options.join === 'object' ? options.join : {} ),
			}
		if ( join.type === 'simple' ) join.type = 'miter'
		const capInput = options.cap !== undefined ? options.cap : previousOptions.cap
		const cap = typeof capInput === 'string'
			? { ...DEFAULT_CAP_OPTIONS, type: capInput }
			: {
				...DEFAULT_CAP_OPTIONS,
				...( typeof previousOptions.cap === 'object' ? previousOptions.cap : {} ),
				...( typeof options.cap === 'object' ? options.cap : {} ),
			}

		const nextOptions = {
			closed: false,
			lineWidth: 0.3,
			widthCallback: null,
			...previousOptions,
			...options,
			lines,
			surface,
			join,
			cap,
		}
		validateOptions( nextOptions, surface, join, cap )
		this.options = nextOptions

		if ( lines === undefined ) return
		try {
			this.setLines( lines )
		} catch ( error ) {
			// A rejected build keeps the options of the last accepted one.
			this.options = previousOptions
			throw error
		}
	}

	/**
	 * Replace the source centerlines and rebuild all derived surface attributes.
	 * @param {import('./index.d.ts').MultiLinePoints | ArrayLike<number>} lines
	 * @param {boolean | boolean[]} [closed] - Optional per-line or global loop flag
	 */
	setLines( lines, closed = undefined ) {
		if ( lines == null ) throw new Error( '[MeshLineSurfaceGeometry] Lines data required' )

		const inputs = normalizeLinesInput( lines )
		if ( inputs.length === 0 ) throw new Error( '[MeshLineSurfaceGeometry] At least one line is required' )

		// `lines` and `closed` reach the options only once the build accepts them.
		const closedOption = ( closed !== undefined ? closed : this.options?.closed ) ?? false
		// A rejected build emptied the draw range in clearGeometry(): unless the
		// caller set another since, the next accepted one draws the saved range.
		const cleared = this._clearedDrawRange
		const singleLine = inputs.length === 1
		if ( singleLine ) {
			const isClosed0 = Array.isArray( closedOption ) ? !!closedOption[0] : !!closedOption
			const input0 = inputs[0]
			if (
				!isClosed0 &&
				( input0 instanceof Float32Array || input0 instanceof Float64Array ) &&
				input0.length >= 6 &&
				input0.length % 3 === 0
			) {
				if ( this.tryBuildSingleOpenSurface( input0, input0 instanceof Float32Array ) ) {
					this.options.lines = lines
					if ( closed !== undefined ) this.options.closed = closed
					if ( cleared && this.drawRange.count === 0 ) this.setDrawRange( cleared.start, cleared.count )
					this._clearedDrawRange = null
					return
				}
			}
		}
		const prepared = new Array( inputs.length )

		for ( let i = 0; i < inputs.length; i++ ) {
			const isClosed = Array.isArray( closedOption ) ? !!closedOption[i] : !!closedOption
			const input = inputs[i]
			const minLen = isClosed ? 9 : 6
			if ( ( input instanceof Float32Array || input instanceof Float64Array ) && input.length >= minLen && input.length % 3 === 0 ) {
				prepared[i] = {
					points: input,
					closed: isClosed,
					isFloat32Input: input instanceof Float32Array,
					maxCoordMagnitude: -1,
				}
			} else {
				prepared[i] = prepareLine( input, isClosed, i )
			}
		}

		try {
			const linePoints = new Array( prepared.length )
			const surfaceLines = new Array( prepared.length )
			for ( let lineIndex = 0; lineIndex < prepared.length; lineIndex++ ) {
				const line = prepared[lineIndex]
				surfaceLines[lineIndex] = buildSurfaceLine(
					line,
					lineIndex,
					this.options,
					singleLine
				)
				linePoints[lineIndex] = line.points
			}
			this._lines = linePoints
			this._surfaceLines = surfaceLines

			this.build()
		} catch ( error ) {
			this._lines = []
			this._surfaceLines = []
			this._lineRanges = []
			this.clearGeometry()
			throw error
		}
		this.options.lines = lines
		if ( closed !== undefined ) this.options.closed = closed
		if ( cleared && this.drawRange.count === 0 ) this.setDrawRange( cleared.start, cleared.count )
		this._clearedDrawRange = null
	}

	clearGeometry() {
		for ( const [name, attribute] of Object.entries( this.attributes ) ) {
			this.deleteAttribute( name )
			if ( SURFACE_ATTRIBUTE_NAMES.has( name ) ) releaseAttribute( this._renderer, attribute )
		}
		releaseAttribute( this._renderer, this.index )
		this.setIndex( null )
		if ( !this._clearedDrawRange || this.drawRange.count !== 0 ) {
			this._clearedDrawRange = { start: this.drawRange.start, count: this.drawRange.count }
		}
		this.setDrawRange( 0, 0 )
		this.boundingBox = null
		this.boundingSphere = null
		this._vertexCount = 0
		this._indexCount = 0
	}

	/**
	 * Surface frames and joins depend on the complete path, so updates rebuild
	 * the derived attributes. This intentionally mirrors the MeshLineGeometry
	 * method name while keeping the CPU implementation deterministic.
	 * @param {import('./index.d.ts').MultiLinePoints | ArrayLike<number>} lines
	 */
	setPositions( lines ) {
		this.setLines( lines )
	}

	setUsage( usage, name = null ) {
		for ( const [attributeName, attribute] of Object.entries( this.attributes ) ) {
			if ( ( name != null && attributeName !== name ) || attribute.usage === usage ) continue
			this.setAttribute( attributeName, attribute.clone().setUsage( usage ) )
			releaseAttribute( this._renderer, attribute )
		}
	}

	/**
	 * Copy the built `position`, `uv`, `normal`, and `index` buffers into another
	 * geometry object — either a Three.js `BufferGeometry` or a `@makio/mini3`
	 * `Geometry` (`setAttribute( name, array, itemSize )` in canonical `position`,
	 * `uv`, `normal` order + `setIndex( array )`).
	 * @param {object} targetGeometry
	 * @returns {object} `targetGeometry`
	 */
	copyToGeometry( targetGeometry ) {
		if ( !targetGeometry || typeof targetGeometry.setAttribute !== 'function' ) {
			throw new TypeError( '[MeshLineSurfaceGeometry] copyToGeometry requires a geometry with setAttribute()' )
		}
		if ( !this.getAttribute( 'uv' ) && this._surfaceLines.length > 0 ) {
			this.buildLine( { needsUV: true } )
		}
		const positionAttr = this.getAttribute( 'position' )
		const uvAttr = this.getAttribute( 'uv' )
		const normalAttr = this.getAttribute( 'normal' )
		const indexAttr = this.getIndex()

		// Only what is in use: a dynamic surface may hold spare capacity.
		const used = attribute => attribute.array.slice( 0, this._vertexCount * attribute.itemSize )
		const usedIndex = indexAttr ? indexAttr.array.slice( 0, this._indexCount ) : null

		if ( targetGeometry.isBufferGeometry ) {
			const copy = attribute => new BufferAttribute( used( attribute ), attribute.itemSize, attribute.normalized ).setUsage( attribute.usage )
			if ( positionAttr ) targetGeometry.setAttribute( 'position', copy( positionAttr ) )
			if ( uvAttr ) targetGeometry.setAttribute( 'uv', copy( uvAttr ) )
			if ( normalAttr ) targetGeometry.setAttribute( 'normal', copy( normalAttr ) )
			if ( usedIndex ) targetGeometry.setIndex( new BufferAttribute( usedIndex, 1 ).setUsage( indexAttr.usage ) )
			return targetGeometry
		}

		// @makio/mini3 Geometry (canonical attribute order: position, uv, normal)
		if ( positionAttr ) targetGeometry.setAttribute( 'position', used( positionAttr ), 3 )
		if ( uvAttr ) targetGeometry.setAttribute( 'uv', used( uvAttr ), 2 )
		if ( normalAttr ) targetGeometry.setAttribute( 'normal', used( normalAttr ), 3 )
		if ( usedIndex && typeof targetGeometry.setIndex === 'function' ) targetGeometry.setIndex( usedIndex )
		return targetGeometry
	}

	// `usedLength` is the part of `array` this build wrote: the rest of a buffer
	// with spare capacity is never drawn, so it is never uploaded either.
	setOrUpdateAttribute( name, array, itemSize, usage = StaticDrawUsage, usedLength = array.length ) {
		const existing = this.getAttribute( name )
		if ( existing && existing.itemSize === itemSize && existing.array.length === array.length && existing.array.constructor === array.constructor && existing.usage === usage ) {
			if ( existing.array !== array ) existing.copyArray( array )
			existing.clearUpdateRanges()
			if ( usedLength < array.length ) existing.addUpdateRange( 0, usedLength )
			existing.needsUpdate = true
			return
		}

		this.setAttribute( name, new BufferAttribute( array, itemSize ).setUsage( usage ) )
		releaseAttribute( this._renderer, existing )
	}

	// Buffer sizes for a build that needs `count` vertices or indices: exact for
	// a static surface, the kept capacity or a grown one for a dynamic surface.
	_resolveVertexCapacity( count, usage ) {
		if ( usage === StaticDrawUsage ) return count
		const position = this.getAttribute( 'position' )
		return resolveCapacity( position?.usage === usage ? position.count : 0, count )
	}

	_resolveIndexCapacity( count, IndexArray, usage ) {
		if ( usage === StaticDrawUsage ) return count
		const index = this.getIndex()
		return resolveCapacity( index?.array.constructor === IndexArray ? index.array.length : 0, count )
	}

	// Install the index of a finished build. Indices past the ones in use stay
	// zero, so the spare capacity of a dynamic surface is degenerate triangles.
	_commitIndex( indices, existingIndex, indexCount, changed ) {
		if ( existingIndex && existingIndex.array === indices ) {
			if ( this._indexCount > indexCount ) {
				indices.fill( 0, indexCount, this._indexCount )
				changed = true
			}
			if ( changed ) existingIndex.needsUpdate = true
		} else {
			this.setIndex( new BufferAttribute( indices, 1 ) )
			releaseAttribute( this._renderer, existingIndex )
		}
		this._indexCount = indexCount
	}

	getReusableAttributeArray( name, ArrayType, length, itemSize, usage ) {
		const existing = this.getAttribute( name )
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

	/** Build packed attributes and indices for all prepared lines. */
	build() {
		const usage = this.options.usage ?? ( this.options.dynamic === true ? StreamDrawUsage : StaticDrawUsage )
		const surface = this.options.surface || DEFAULT_SURFACE_OPTIONS
		const needsTangents = !!( this.options.needsTangents || surface.normalMap )
		const needsUV = !!(
			this.options.needsUV ||
			this.options.map ||
			this.options.alphaMap ||
			surface.normalMap ||
			surface.roughnessMap ||
			surface.metalnessMap
		)
		const needsProgress = !!this.options.needsProgress
		const needsSide = !!this.options.needsSide
		let totalVertices = 0
		let totalIndices = 0

		for ( const line of this._surfaceLines ) {
			totalVertices += line.topology
				? line.topology.vertexCount
				: line.rowCount * 2 + ( line.capTopology?.vertexCount || 0 )
			totalIndices += line.topology
				? line.topology.indexCount
				: ( line.rowCount - 1 ) * 6 + ( line.capTopology?.indexCount || 0 )
		}

		let vertexCapacity = this._resolveVertexCapacity( totalVertices, usage )
		let IndexArray = vertexCapacity > 65535 ? Uint32Array : Uint16Array
		let positions = this.getReusableAttributeArray( 'position', Float32Array, vertexCapacity * 3, 3, usage )
		let normals = this.getReusableAttributeArray( 'normal', Float32Array, vertexCapacity * 3, 3, usage )
		const tangents = needsTangents ? this.getReusableAttributeArray( 'tangent', Float32Array, vertexCapacity * 4, 4, usage ) : null
		const uvs = needsUV ? this.getReusableAttributeArray( 'uv', Float32Array, vertexCapacity * 2, 2, usage ) : null
		const progress = needsProgress ? this.getReusableAttributeArray( 'progress', Float32Array, vertexCapacity, 1, usage ) : null
		const sides = needsSide ? this.getReusableAttributeArray( 'side', Float32Array, vertexCapacity, 1, usage ) : null
		const existingIndex = this.getIndex()
		let indexCapacity = this._resolveIndexCapacity( totalIndices, IndexArray, usage )
		let reusedIndex = !!( existingIndex && existingIndex.array.constructor === IndexArray && existingIndex.array.length === indexCapacity )
		let indices = reusedIndex
			? existingIndex.array
			: new IndexArray( indexCapacity )
		const forceRewriteIndex = !!this._forceRewriteIndex
		this._forceRewriteIndex = false
		let trackIndexChanges = reusedIndex && !forceRewriteIndex
		indexWriteChanged = !reusedIndex || forceRewriteIndex

		const bounds = boundsScratch
		bounds[0] = Infinity
		bounds[1] = Infinity
		bounds[2] = Infinity
		bounds[3] = -Infinity
		bounds[4] = -Infinity
		bounds[5] = -Infinity

		if ( this._surfaceLines.length === 1 && this._surfaceLines[0].topology?.directStream ) {
			const line0 = this._surfaceLines[0]
			const singleTopoSegments0 = line0.pointCount - 1
			const skipBaseQuads0 = reusedIndex &&
				this._canonicalTopoSegments === singleTopoSegments0 &&
				this._canonicalTopoIndexType === IndexArray
			const streamedIndexCount = emitDirectStreamVariableLine(
				line0, positions, normals, indices, bounds, skipBaseQuads0
			)
			if ( streamedIndexCount >= 0 ) {
				if ( trackIndexChanges ) indexWriteChanged = true
				bounds[0] = lastBoundsMinX; bounds[1] = lastBoundsMinY; bounds[2] = lastBoundsMinZ
				bounds[3] = lastBoundsMaxX; bounds[4] = lastBoundsMaxY; bounds[5] = lastBoundsMaxZ
				this._lineRanges = [
					{
						lineIndex: 0,
						closed: false,
						pointCount: line0.pointCount,
						rowStart: 0,
						rowCount: line0.rowCount,
						vertexStart: 0,
						vertexCount: totalVertices,
						seamVertexStart: null,
						indexStart: 0,
						indexCount: streamedIndexCount,
						totalLength: line0.totalLength,
					},
				]
				this._canonicalCompactRows = 0
				this._canonicalCompactIndexType = null
				this._canonicalTopoSegments = singleTopoSegments0
				this._canonicalTopoIndexType = IndexArray
				this._commitBuild( totalVertices, usage, positions, normals, tangents, uvs, progress, sides )
				this._commitIndex( indices, existingIndex, streamedIndexCount, indexWriteChanged )
				this.updateBounds( positions, bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5], totalVertices * 3 )
				return
			}
			materializeDirectStreamFallback( line0, 0, this.options )
			totalVertices = line0.topology
				? line0.topology.vertexCount
				: line0.rowCount * 2 + ( line0.capTopology?.vertexCount || 0 )
			totalIndices = line0.topology
				? line0.topology.indexCount
				: ( line0.rowCount - 1 ) * 6 + ( line0.capTopology?.indexCount || 0 )
			vertexCapacity = this._resolveVertexCapacity( totalVertices, usage )
			IndexArray = vertexCapacity > 65535 ? Uint32Array : Uint16Array
			if ( positions.length !== vertexCapacity * 3 ) {
				positions = this.getReusableAttributeArray( 'position', Float32Array, vertexCapacity * 3, 3, usage )
				normals = this.getReusableAttributeArray( 'normal', Float32Array, vertexCapacity * 3, 3, usage )
			}
			indexCapacity = this._resolveIndexCapacity( totalIndices, IndexArray, usage )
			reusedIndex = !!( existingIndex && existingIndex.array.constructor === IndexArray && existingIndex.array.length === indexCapacity )
			indices = reusedIndex ? existingIndex.array : new IndexArray( indexCapacity )
			trackIndexChanges = false
			indexWriteChanged = true
			this._canonicalTopoSegments = 0
			this._canonicalTopoIndexType = null
			bounds[0] = Infinity; bounds[1] = Infinity; bounds[2] = Infinity
			bounds[3] = -Infinity; bounds[4] = -Infinity; bounds[5] = -Infinity
		}

		const singleCanonicalCompact = this._surfaceLines.length === 1 &&
			!this._surfaceLines[0].topology &&
			this._surfaceLines[0].fastCanonicalQuads
		const singleCompactRows = singleCanonicalCompact ? this._surfaceLines[0].rowCount : 0
		const skipCompactIndexWrite = singleCanonicalCompact &&
			reusedIndex &&
			this._canonicalCompactRows === singleCompactRows &&
			this._canonicalCompactIndexType === IndexArray
		const singleCanonicalTopoUnaliased = this._surfaceLines.length === 1 &&
			!!this._surfaceLines[0].topology &&
			!this._surfaceLines[0].topology.pairVertices &&
			!this._surfaceLines[0].topology.hasAliases &&
			this._surfaceLines[0].fastCanonicalQuads
		const singleTopoSegments = singleCanonicalTopoUnaliased
			? ( this._surfaceLines[0].closed ? this._surfaceLines[0].pointCount : this._surfaceLines[0].pointCount - 1 )
			: 0
		const skipTopoBaseQuadWrite = singleCanonicalTopoUnaliased &&
			reusedIndex &&
			this._canonicalTopoSegments === singleTopoSegments &&
			this._canonicalTopoIndexType === IndexArray

		this._lineRanges = []
		let rowOffset = 0
		let vertexOffset = 0
		let indexOffset = 0

		for ( let lineIndex = 0; lineIndex < this._surfaceLines.length; lineIndex++ ) {
			const line = this._surfaceLines[lineIndex]
			const vertexStart = vertexOffset
			const indexStart = indexOffset
			let lineVertexCount
			if ( line.topology ) {
				lineVertexCount = line.topology.vertexCount
				indexOffset = emitVariableTopologyLine(
					line, lineIndex, vertexStart, indexOffset,
					positions, normals, tangents, uvs, progress, sides, indices, bounds,
					trackIndexChanges && !indexWriteChanged, skipTopoBaseQuadWrite
				)
			} else {
				lineVertexCount = line.rowCount * 2 + ( line.capTopology?.vertexCount || 0 )
				indexOffset = emitCompactStripLine(
					line, lineIndex, vertexStart, indexOffset,
					positions, normals, tangents, uvs, progress, sides, indices, bounds, trackIndexChanges && !indexWriteChanged, skipCompactIndexWrite
				)
			}

			this._lineRanges.push( {
				lineIndex,
				closed: line.closed,
				pointCount: line.pointCount,
				rowStart: rowOffset,
				rowCount: line.rowCount,
				vertexStart,
				vertexCount: lineVertexCount,
				seamVertexStart: line.closed
					? vertexStart + ( line.topology ? line.topology.seamPair[0] : ( line.rowCount - 1 ) * 2 )
					: null,
				indexStart,
				indexCount: indexOffset - indexStart,
				totalLength: line.totalLength,
			} )

			rowOffset += line.rowCount
			vertexOffset += lineVertexCount
		}

		this._canonicalCompactRows = singleCompactRows
		this._canonicalCompactIndexType = singleCanonicalCompact ? IndexArray : null
		this._canonicalTopoSegments = singleTopoSegments
		this._canonicalTopoIndexType = singleCanonicalTopoUnaliased ? IndexArray : null
		this._commitBuild( totalVertices, usage, positions, normals, tangents, uvs, progress, sides )
		this._commitIndex( indices, existingIndex, totalIndices, indexWriteChanged )
		this.updateBounds( positions, bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5], totalVertices * 3 )
	}

	// Install the attributes of a finished build that wrote `vertexCount` vertices.
	_commitBuild( vertexCount, usage, positions, normals, tangents, uvs, progress, sides ) {
		this._vertexCount = vertexCount
		this.setOrUpdateAttribute( 'position', positions, 3, usage, vertexCount * 3 )
		this.setOrUpdateAttribute( 'normal', normals, 3, usage, vertexCount * 3 )
		this.commitOptionalAttribute( 'tangent', tangents, 4, usage, vertexCount * 4 )
		this.commitOptionalAttribute( 'uv', uvs, 2, usage, vertexCount * 2 )
		this.commitOptionalAttribute( 'progress', progress, 1, usage, vertexCount )
		this.commitOptionalAttribute( 'side', sides, 1, usage, vertexCount )
	}

	commitOptionalAttribute( name, array, itemSize, usage, usedLength ) {
		if ( array ) {
			this.setOrUpdateAttribute( name, array, itemSize, usage, usedLength )
		} else if ( this.getAttribute( name ) ) {
			releaseAttribute( this._renderer, this.getAttribute( name ) )
			this.deleteAttribute( name )
		}
	}

	computeBoundingBox() {
		if ( !this.attributes.position && this._ownerLine && !this._ownerLine._built && !this._ownerLine._building ) {
			this._ownerLine.ensureBuilt()
			if ( this.boundingBox ) return
		}
		if ( this._computeUsedBounds() ) return
		super.computeBoundingBox()
	}

	computeBoundingSphere() {
		if ( !this.attributes.position && this._ownerLine && !this._ownerLine._built && !this._ownerLine._building ) {
			this._ownerLine.ensureBuilt()
			if ( this.boundingSphere ) return
		}
		if ( this._computeUsedBounds() ) return
		super.computeBoundingSphere()
	}

	// Bounds of the vertices in use, when the position buffer holds more: three's
	// own scan would include the unused ones.
	_computeUsedBounds() {
		const position = this.attributes.position
		if ( !position || this._vertexCount === 0 || this._vertexCount >= position.count ) return false
		const positions = position.array
		const length = this._vertexCount * 3
		let minX = Infinity, minY = Infinity, minZ = Infinity
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
		for ( let offset = 0; offset < length; offset += 3 ) {
			const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2]
			if ( x < minX ) minX = x
			if ( x > maxX ) maxX = x
			if ( y < minY ) minY = y
			if ( y > maxY ) maxY = y
			if ( z < minZ ) minZ = z
			if ( z > maxZ ) maxZ = z
		}
		this.updateBounds( positions, minX, minY, minZ, maxX, maxY, maxZ, length )
		return true
	}

	updateBounds( positions, minX, minY, minZ, maxX, maxY, maxZ, usedLength = positions.length ) {
		if ( !this.boundingBox ) this.boundingBox = new Box3()
		this.boundingBox.min.set( minX, minY, minZ )
		this.boundingBox.max.set( maxX, maxY, maxZ )

		if ( !this.boundingSphere ) this.boundingSphere = new Sphere()
		const centerX = ( minX + maxX ) * 0.5
		const centerY = ( minY + maxY ) * 0.5
		const centerZ = ( minZ + maxZ ) * 0.5
		this.boundingSphere.center.set( centerX, centerY, centerZ )
		this.boundingSphere.radius = Math.sqrt( computeMaxRadiusSq( positions, centerX, centerY, centerZ, usedLength ) )
	}

	tryBuildSingleOpenSurface( points, isFloat32Input ) {
		const options = this.options
		const surface = options.surface || DEFAULT_SURFACE_OPTIONS
		const join = options.join || DEFAULT_JOIN_OPTIONS
		const cap = options.cap || DEFAULT_CAP_OPTIONS
		const halfWidth = ( options.lineWidth ?? 0.3 ) * 0.5
		if ( options.widthCallback || !( halfWidth > 0 && halfWidth < Infinity ) ) return false
		if ( !( surface.bank === 0 || surface.bank == null ) ) return false
		const needsTangents = !!( options.needsTangents || surface.normalMap )
		const needsProgress = !!options.needsProgress
		const needsSide = !!options.needsSide
		if ( needsTangents || needsProgress || needsSide ) return false
		const needsUV = !!(
			options.needsUV ||
			options.map ||
			options.alphaMap ||
			surface.normalMap ||
			surface.roughnessMap ||
			surface.metalnessMap
		)
		if ( needsUV && surface.uvMode !== 'distance' ) return false

		const pointCount = points.length / 3
		const segmentCount = pointCount - 1
		const usage = options.usage ?? ( options.dynamic === true ? StreamDrawUsage : StaticDrawUsage )
		const existingIndex = this.getIndex()

		if ( join.type === 'miter' ) {
			const probePoints = pointCount < 3 ? pointCount : 3
			const probeUvs = needsUV ? singlePassProbeUvs : null
			if ( !singlePassMiterWarmedUp ) {
				singlePassMiterWarmedUp = true
				for ( let w = 0; w < 8; w++ ) {
					emitSinglePassOpenMiterSurface(
						points, probePoints, isFloat32Input, halfWidth, surface, join.limit,
						singlePassProbePositions, singlePassProbeNormals, probeUvs
					)
				}
			}
			const probeLen = emitSinglePassOpenMiterSurface(
				points, probePoints, isFloat32Input, halfWidth, surface, join.limit,
				singlePassProbePositions, singlePassProbeNormals, probeUvs
			)
			if ( probeLen > 0 ) {
				const capVertexCount = cap.type === 'butt' ? 0 : ( cap.type === 'square' ? 4 : cap.segments * 2 )
				const capIndexCount = cap.type === 'butt' ? 0 : ( cap.type === 'square' ? 12 : cap.segments * 6 )
				const totalVertices = pointCount * 2 + capVertexCount
				const totalIndices = segmentCount * 6 + capIndexCount
				const vertexCapacity = this._resolveVertexCapacity( totalVertices, usage )
				const IndexArray = vertexCapacity > 65535 ? Uint32Array : Uint16Array
				const positions = this.getReusableAttributeArray( 'position', Float32Array, vertexCapacity * 3, 3, usage )
				const normals = this.getReusableAttributeArray( 'normal', Float32Array, vertexCapacity * 3, 3, usage )
				const uvs = needsUV ? this.getReusableAttributeArray( 'uv', Float32Array, vertexCapacity * 2, 2, usage ) : null
				const totalLength = emitSinglePassOpenMiterSurface(
					points, pointCount, isFloat32Input, halfWidth, surface, join.limit, positions, normals, uvs
				)
				if ( totalLength > 0 ) {
					const indexCapacity = this._resolveIndexCapacity( totalIndices, IndexArray, usage )
					const reusedIndex = !!( existingIndex && existingIndex.array.constructor === IndexArray && existingIndex.array.length === indexCapacity )
					const indices = reusedIndex ? existingIndex.array : new IndexArray( indexCapacity )
					const skipCompactIndexWrite = reusedIndex &&
						this._canonicalCompactRows === pointCount &&
						this._canonicalCompactIndexType === IndexArray
					indexWriteChanged = !reusedIndex
					let indexOffset = writeCompactIndices(
						indices, 0, positions, normals, 0, pointCount,
						reusedIndex, true, skipCompactIndexWrite
					)
					let capTopology = null
					const bounds = boundsScratch
					bounds[0] = lastBoundsMinX; bounds[1] = lastBoundsMinY; bounds[2] = lastBoundsMinZ
					bounds[3] = lastBoundsMaxX; bounds[4] = lastBoundsMaxY; bounds[5] = lastBoundsMaxZ
					if ( cap.type !== 'butt' ) {
						singlePassCapPath.points = points
						singlePassCapPath.pointCount = pointCount
						singlePassCapPath.segmentCount = segmentCount
						singlePassCapPath.totalLength = totalLength
						singlePassCapNeeds.uvs = needsUV
						capTopology = buildCompactCapTopology(
							singlePassCapPath, singlePassCapFrame, singlePassEndOffsets,
							halfWidth, surface, cap, singlePassCapNeeds, true
						)
						indexOffset = emitCompactCaps(
							capTopology, 0, 0, pointCount * 2,
							positions, normals, null, uvs, null, null, indices, indexOffset, bounds,
							reusedIndex && !indexWriteChanged, true
						)
					}
					this._lines = [points]
					this._surfaceLines = [
						{
							points,
							closed: false,
							isFloat32Input,
							fastFloat32Safe: true,
							fastUvSafe: true,
							fastCanonicalQuads: true,
							pointCount,
							rowCount: pointCount,
							totalLength,
							topology: null,
							capTopology,
						},
					]
					this._lineRanges = [
						{
							lineIndex: 0,
							closed: false,
							pointCount,
							rowStart: 0,
							rowCount: pointCount,
							vertexStart: 0,
							vertexCount: totalVertices,
							seamVertexStart: null,
							indexStart: 0,
							indexCount: indexOffset,
							totalLength,
						},
					]
					this._canonicalCompactRows = pointCount
					this._canonicalCompactIndexType = IndexArray
					this._canonicalTopoSegments = 0
					this._canonicalTopoIndexType = null
					this._commitBuild( totalVertices, usage, positions, normals, null, uvs, null, null )
					this._commitIndex( indices, existingIndex, indexOffset, indexWriteChanged )
					this.updateBounds( positions, bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5], totalVertices * 3 )
					return true
				}
				return false
			}
		}

		if (
			!needsUV &&
			cap.type === 'butt' &&
			pointCount >= 3
		) {
			const totalVertices = segmentCount * 4
			const totalIndices = segmentCount * 6 + ( pointCount - 2 ) * 3
			const vertexCapacity = this._resolveVertexCapacity( totalVertices, usage )
			const IndexArray = vertexCapacity > 65535 ? Uint32Array : Uint16Array
			const probeIndices = vertexCapacity > 65535 ? singlePassProbeIndices32 : singlePassProbeIndices16
			if ( !singlePassVariableWarmedUp ) {
				singlePassVariableWarmedUp = true
				for ( let w = 0; w < 64; w++ ) {
					emitSinglePassOpenVariableSurface(
						points, 3, isFloat32Input, halfWidth, surface, join,
						singlePassProbePositions, singlePassProbeNormals, probeIndices, true
					)
				}
			}
			const probeLen = emitSinglePassOpenVariableSurface(
				points, 3, isFloat32Input, halfWidth, surface, join,
				singlePassProbePositions, singlePassProbeNormals, probeIndices, true
			)
			if ( probeLen > 0 ) {
				const positions = this.getReusableAttributeArray( 'position', Float32Array, vertexCapacity * 3, 3, usage )
				const normals = this.getReusableAttributeArray( 'normal', Float32Array, vertexCapacity * 3, 3, usage )
				const indexCapacity = this._resolveIndexCapacity( totalIndices, IndexArray, usage )
				const reusedIndex = !!( existingIndex && existingIndex.array.constructor === IndexArray && existingIndex.array.length === indexCapacity )
				const indices = reusedIndex ? existingIndex.array : new IndexArray( indexCapacity )
				const skipBaseQuads = reusedIndex &&
					this._canonicalTopoSegments === segmentCount &&
					this._canonicalTopoIndexType === IndexArray
				const totalLength = emitSinglePassOpenVariableSurface(
					points, pointCount, isFloat32Input, halfWidth, surface, join, positions, normals, indices, skipBaseQuads
				)
				if ( totalLength > 0 ) {
					this._lines = [points]
					this._surfaceLines = [
						{
							points,
							closed: false,
							isFloat32Input,
							fastFloat32Safe: true,
							fastUvSafe: true,
							fastCanonicalQuads: true,
							pointCount,
							rowCount: pointCount,
							totalLength,
							topology: {
								directUnaliased: true,
								directStream: true,
								hasAliases: false,
								pairVertices: null,
								vertexCount: totalVertices,
								indexCount: totalIndices,
								seamPair: null,
							},
							capTopology: null,
						},
					]
					this._lineRanges = [
						{
							lineIndex: 0,
							closed: false,
							pointCount,
							rowStart: 0,
							rowCount: pointCount,
							vertexStart: 0,
							vertexCount: totalVertices,
							seamVertexStart: null,
							indexStart: 0,
							indexCount: totalIndices,
							totalLength,
						},
					]
					this._canonicalCompactRows = 0
					this._canonicalCompactIndexType = null
					this._canonicalTopoSegments = segmentCount
					this._canonicalTopoIndexType = IndexArray
					this._commitBuild( totalVertices, usage, positions, normals, null, null, null, null )
					this._commitIndex( indices, existingIndex, totalIndices, true )
					this.updateBounds( positions, lastBoundsMinX, lastBoundsMinY, lastBoundsMinZ, lastBoundsMaxX, lastBoundsMaxY, lastBoundsMaxZ, totalVertices * 3 )
					return true
				}
				this._canonicalTopoSegments = 0
				this._canonicalTopoIndexType = null
				if ( reusedIndex ) this._forceRewriteIndex = true
			}
		}

		return false
	}

}

const boundsScratch = new Float64Array( 6 )
let lastBoundsMinX = 0
let lastBoundsMinY = 0
let lastBoundsMinZ = 0
let lastBoundsMaxX = 0
let lastBoundsMaxY = 0
let lastBoundsMaxZ = 0

let compactIndexTemplate16 = new Uint16Array( 0 )
let compactIndexTemplate32 = new Uint32Array( 0 )
let topoQuadTemplate16 = new Uint16Array( 0 )
let topoQuadTemplate32 = new Uint32Array( 0 )

function getCompactIndexTemplate16( segmentCount ) {
	const indexCount = segmentCount * 6
	const current = compactIndexTemplate16
	if ( current.length >= indexCount ) return current.subarray( 0, indexCount )
	const oldSegments = Math.floor( current.length / 6 )
	const capSegments = oldSegments === 0 ? Math.max( segmentCount, 64 ) : Math.max( segmentCount, oldSegments * 2, 1024 )
	const next = new Uint16Array( capSegments * 6 )
	const view = next.subarray( 0, indexCount )
	const oldLen = current.length
	if ( oldLen > 0 ) next.set( current )
	if ( capSegments * 6 <= MAX_POOLED_SCRATCH_LENGTH ) compactIndexTemplate16 = next
	for ( let segment = oldSegments, left0 = segment * 2, offset = oldLen; segment < capSegments; segment++, left0 += 2, offset += 6 ) {
		const right0 = left0 + 1
		const left1 = left0 + 2
		next[offset] = left0
		next[offset + 1] = left1
		next[offset + 2] = right0
		next[offset + 3] = right0
		next[offset + 4] = left1
		next[offset + 5] = left0 + 3
	}
	return view
}

function getCompactIndexTemplate32( segmentCount ) {
	const indexCount = segmentCount * 6
	const current = compactIndexTemplate32
	if ( current.length >= indexCount ) return current.subarray( 0, indexCount )
	const oldSegments = Math.floor( current.length / 6 )
	const capSegments = oldSegments === 0 ? Math.max( segmentCount, 64 ) : Math.max( segmentCount, oldSegments * 2, 1024 )
	const next = new Uint32Array( capSegments * 6 )
	const view = next.subarray( 0, indexCount )
	const oldLen = current.length
	if ( oldLen > 0 ) next.set( current )
	if ( capSegments * 6 <= MAX_POOLED_SCRATCH_LENGTH ) compactIndexTemplate32 = next
	for ( let segment = oldSegments, left0 = segment * 2, offset = oldLen; segment < capSegments; segment++, left0 += 2, offset += 6 ) {
		const right0 = left0 + 1
		const left1 = left0 + 2
		next[offset] = left0
		next[offset + 1] = left1
		next[offset + 2] = right0
		next[offset + 3] = right0
		next[offset + 4] = left1
		next[offset + 5] = left0 + 3
	}
	return view
}

function getCompactIndexTemplate( isUint32, segmentCount ) {
	return isUint32 ? getCompactIndexTemplate32( segmentCount ) : getCompactIndexTemplate16( segmentCount )
}

function getTopoQuadTemplate16( segmentCount ) {
	const indexCount = segmentCount * 6
	const current = topoQuadTemplate16
	if ( current.length >= indexCount ) return current.subarray( 0, indexCount )
	const oldSegments = Math.floor( current.length / 6 )
	const capSegments = oldSegments === 0 ? Math.max( segmentCount, 64 ) : Math.max( segmentCount, oldSegments * 2, 1024 )
	const next = new Uint16Array( capSegments * 6 )
	const view = next.subarray( 0, indexCount )
	const oldLen = current.length
	if ( oldLen > 0 ) next.set( current )
	if ( capSegments * 6 <= MAX_POOLED_SCRATCH_LENGTH ) topoQuadTemplate16 = next
	for ( let segment = oldSegments, left0 = segment * 4, offset = oldLen; segment < capSegments; segment++, left0 += 4, offset += 6 ) {
		const right0 = left0 + 1
		const left1 = left0 + 2
		next[offset] = left0
		next[offset + 1] = left1
		next[offset + 2] = right0
		next[offset + 3] = right0
		next[offset + 4] = left1
		next[offset + 5] = left0 + 3
	}
	return view
}

function getTopoQuadTemplate32( segmentCount ) {
	const indexCount = segmentCount * 6
	const current = topoQuadTemplate32
	if ( current.length >= indexCount ) return current.subarray( 0, indexCount )
	const oldSegments = Math.floor( current.length / 6 )
	const capSegments = oldSegments === 0 ? Math.max( segmentCount, 64 ) : Math.max( segmentCount, oldSegments * 2, 1024 )
	const next = new Uint32Array( capSegments * 6 )
	const view = next.subarray( 0, indexCount )
	const oldLen = current.length
	if ( oldLen > 0 ) next.set( current )
	if ( capSegments * 6 <= MAX_POOLED_SCRATCH_LENGTH ) topoQuadTemplate32 = next
	for ( let segment = oldSegments, left0 = segment * 4, offset = oldLen; segment < capSegments; segment++, left0 += 4, offset += 6 ) {
		const right0 = left0 + 1
		const left1 = left0 + 2
		next[offset] = left0
		next[offset + 1] = left1
		next[offset + 2] = right0
		next[offset + 3] = right0
		next[offset + 4] = left1
		next[offset + 5] = left0 + 3
	}
	return view
}

function getTopoQuadTemplate( isUint32, segmentCount ) {
	return isUint32 ? getTopoQuadTemplate32( segmentCount ) : getTopoQuadTemplate16( segmentCount )
}

function computeMaxRadiusSq( positions, centerX, centerY, centerZ, len = positions.length ) {
	const rem = len % 12
	let maxRadiusSquared = 0
	let offset = 0
	for ( ; offset < rem; offset += 3 ) {
		const dx = positions[offset] - centerX
		const dy = positions[offset + 1] - centerY
		const dz = positions[offset + 2] - centerZ
		const d = dx * dx + dy * dy + dz * dz
		if ( d > maxRadiusSquared ) maxRadiusSquared = d
	}
	for ( ; offset < len; offset += 12 ) {
		const dx0 = positions[offset] - centerX, dy0 = positions[offset + 1] - centerY, dz0 = positions[offset + 2] - centerZ
		const d0 = dx0 * dx0 + dy0 * dy0 + dz0 * dz0

		const dx1 = positions[offset + 3] - centerX, dy1 = positions[offset + 4] - centerY, dz1 = positions[offset + 5] - centerZ
		const d1 = dx1 * dx1 + dy1 * dy1 + dz1 * dz1

		const dx2 = positions[offset + 6] - centerX, dy2 = positions[offset + 7] - centerY, dz2 = positions[offset + 8] - centerZ
		const d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2

		const dx3 = positions[offset + 9] - centerX, dy3 = positions[offset + 10] - centerY, dz3 = positions[offset + 11] - centerZ
		const d3 = dx3 * dx3 + dy3 * dy3 + dz3 * dz3

		const m01 = d0 > d1 ? d0 : d1
		const m23 = d2 > d3 ? d2 : d3
		const m = m01 > m23 ? m01 : m23
		if ( m > maxRadiusSquared ) maxRadiusSquared = m
	}
	return maxRadiusSquared
}

function copyTopoPositionsAndBounds( positions, topoPositions, vertexStart, lineVertexCount, lineIndex, bounds, fastFloat32Safe ) {
	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]
	if ( fastFloat32Safe ) {
		for ( let localVertex = 0, local3 = 0, positionOffset = vertexStart * 3; localVertex < lineVertexCount; localVertex++, local3 += 3, positionOffset += 3 ) {
			const px = Math.fround( topoPositions[local3] )
			const py = Math.fround( topoPositions[local3 + 1] )
			const pz = Math.fround( topoPositions[local3 + 2] )
			positions[positionOffset] = px
			positions[positionOffset + 1] = py
			positions[positionOffset + 2] = pz
			minX = Math.min( minX, px )
			maxX = Math.max( maxX, px )
			minY = Math.min( minY, py )
			maxY = Math.max( maxY, py )
			minZ = Math.min( minZ, pz )
			maxZ = Math.max( maxZ, pz )
		}
	} else {
		for ( let localVertex = 0, local3 = 0, positionOffset = vertexStart * 3; localVertex < lineVertexCount; localVertex++, local3 += 3, positionOffset += 3 ) {
			const px = Math.fround( topoPositions[local3] )
			const py = Math.fround( topoPositions[local3 + 1] )
			const pz = Math.fround( topoPositions[local3 + 2] )
			positions[positionOffset] = px
			positions[positionOffset + 1] = py
			positions[positionOffset + 2] = pz
			if ( !( px - px === 0 && py - py === 0 && pz - pz === 0 ) ) {
				throw new Error( `[MeshLineSurfaceGeometry] Position overflow at vertex ${localVertex} of line ${lineIndex}` )
			}
			minX = Math.min( minX, px )
			maxX = Math.max( maxX, px )
			minY = Math.min( minY, py )
			maxY = Math.max( maxY, py )
			minZ = Math.min( minZ, pz )
			maxZ = Math.max( maxZ, pz )
		}
	}
	bounds[0] = minX; bounds[1] = minY; bounds[2] = minZ
	bounds[3] = maxX; bounds[4] = maxY; bounds[5] = maxZ
}

function copyTopoTangents( tangents, topoTangents, vertexStart, lineVertexCount ) {
	for ( let localVertex = 0, local3 = 0, tangentOffset = vertexStart * 4; localVertex < lineVertexCount; localVertex++, local3 += 3, tangentOffset += 4 ) {
		tangents[tangentOffset] = topoTangents[local3]
		tangents[tangentOffset + 1] = topoTangents[local3 + 1]
		tangents[tangentOffset + 2] = topoTangents[local3 + 2]
		tangents[tangentOffset + 3] = 1
	}
}

function copyTopoUvs( uvs, topoUvs, vertexStart, lineVertexCount, lineIndex, fastUvSafe ) {
	if ( fastUvSafe && topoUvs instanceof Float32Array ) {
		uvs.set( topoUvs.subarray( 0, lineVertexCount * 2 ), vertexStart * 2 )
		return
	}
	for ( let localVertex = 0, local2 = 0, uvOffset = vertexStart * 2; localVertex < lineVertexCount; localVertex++, local2 += 2, uvOffset += 2 ) {
		const u = topoUvs[local2]
		if ( !( u <= 3.4028234663852886e+38 && u >= -3.4028234663852886e+38 ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] UV overflow at vertex ${localVertex} of line ${lineIndex}; increase surface.uvScale` )
		}
		uvs[uvOffset] = u
		uvs[uvOffset + 1] = topoUvs[local2 + 1]
	}
}

function validateTopoRows( positions, topoPositions, pairVertices, halfWidths, constantHalfWidth, vertexStart, pointCount, segmentCount, lineIndex ) {
	if ( !pairVertices && constantHalfWidth !== null ) {
		for ( let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++ ) {
			const endPoint = segmentIndex + 1 === pointCount ? 0 : segmentIndex + 1
			const base = segmentIndex * 4
			const slSource = base * 3
			const srSource = slSource + 3
			const elSource = slSource + 6
			const erSource = slSource + 9
			const vBase = ( vertexStart + base ) * 3
			assertRepresentableSurfaceRow(
				positions, vBase, vBase + 3,
				topoPositions[slSource], topoPositions[slSource + 1], topoPositions[slSource + 2],
				topoPositions[srSource], topoPositions[srSource + 1], topoPositions[srSource + 2],
				constantHalfWidth, lineIndex, segmentIndex
			)
			assertRepresentableSurfaceRow(
				positions, vBase + 6, vBase + 9,
				topoPositions[elSource], topoPositions[elSource + 1], topoPositions[elSource + 2],
				topoPositions[erSource], topoPositions[erSource + 1], topoPositions[erSource + 2],
				constantHalfWidth, lineIndex, endPoint
			)
		}
		return
	}
	let prevEndLeft = -1
	let prevEndRight = -1
	let prevEndWidth = -1
	for ( let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++ ) {
		const startPoint = segmentIndex
		const endPoint = segmentIndex + 1 === pointCount ? 0 : segmentIndex + 1
		const startWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[startPoint]
		const endWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[endPoint]
		const base = segmentIndex * 4
		const startLeft = pairVertices ? pairVertices[base] : base
		const startRight = pairVertices ? pairVertices[base + 1] : base + 1
		const endLeft = pairVertices ? pairVertices[base + 2] : base + 2
		const endRight = pairVertices ? pairVertices[base + 3] : base + 3
		if ( startLeft !== prevEndLeft || startRight !== prevEndRight || startWidth !== prevEndWidth ) {
			const slSource = startLeft * 3
			const srSource = startRight * 3
			assertRepresentableSurfaceRow(
				positions, ( vertexStart + startLeft ) * 3, ( vertexStart + startRight ) * 3,
				topoPositions[slSource], topoPositions[slSource + 1], topoPositions[slSource + 2],
				topoPositions[srSource], topoPositions[srSource + 1], topoPositions[srSource + 2],
				startWidth, lineIndex, startPoint
			)
		}
		const elSource = endLeft * 3
		const erSource = endRight * 3
		assertRepresentableSurfaceRow(
			positions, ( vertexStart + endLeft ) * 3, ( vertexStart + endRight ) * 3,
			topoPositions[elSource], topoPositions[elSource + 1], topoPositions[elSource + 2],
			topoPositions[erSource], topoPositions[erSource + 1], topoPositions[erSource + 2],
			endWidth, lineIndex, endPoint
		)
		prevEndLeft = endLeft
		prevEndRight = endRight
		prevEndWidth = endWidth
	}
}

function writeTopoBaseQuads( indices, indexOffset, positions, normals, pairVertices, vertexStart, segmentCount, trackChanges, fastCanonicalQuads, skipWrite = false ) {
	if ( skipWrite ) return indexOffset + segmentCount * 6
	let changed = 0
	if ( fastCanonicalQuads ) {
		if ( !pairVertices ) {
			if ( !trackChanges ) {
				if ( vertexStart === 0 ) {
					indices.set( getTopoQuadTemplate( indices instanceof Uint32Array, segmentCount ), indexOffset )
					return indexOffset + segmentCount * 6
				}
				for ( let segment = 0, left0 = vertexStart; segment < segmentCount; segment++, left0 += 4, indexOffset += 6 ) {
					const right0 = left0 + 1
					const left1 = left0 + 2
					indices[indexOffset] = left0
					indices[indexOffset + 1] = left1
					indices[indexOffset + 2] = right0
					indices[indexOffset + 3] = right0
					indices[indexOffset + 4] = left1
					indices[indexOffset + 5] = left0 + 3
				}
				return indexOffset
			}
			for ( let segment = 0, left0 = vertexStart; segment < segmentCount; segment++, left0 += 4, indexOffset += 6 ) {
				const right0 = left0 + 1
				const left1 = left0 + 2
				const right1 = left0 + 3
				changed |= ( indices[indexOffset] ^ left0 ) | ( indices[indexOffset + 1] ^ left1 ) | ( indices[indexOffset + 2] ^ right0 ) |
					( indices[indexOffset + 3] ^ right0 ) | ( indices[indexOffset + 4] ^ left1 ) | ( indices[indexOffset + 5] ^ right1 )
				indices[indexOffset] = left0
				indices[indexOffset + 1] = left1
				indices[indexOffset + 2] = right0
				indices[indexOffset + 3] = right0
				indices[indexOffset + 4] = left1
				indices[indexOffset + 5] = right1
			}
		} else if ( !trackChanges ) {
			for ( let segment = 0, base = 0; segment < segmentCount; segment++, base += 4, indexOffset += 6 ) {
				const left0 = vertexStart + pairVertices[base]
				const right0 = vertexStart + pairVertices[base + 1]
				const left1 = vertexStart + pairVertices[base + 2]
				const right1 = vertexStart + pairVertices[base + 3]
				indices[indexOffset] = left0
				indices[indexOffset + 1] = left1
				indices[indexOffset + 2] = right0
				indices[indexOffset + 3] = right0
				indices[indexOffset + 4] = left1
				indices[indexOffset + 5] = right1
			}
			return indexOffset
		} else {
			for ( let segment = 0, base = 0; segment < segmentCount; segment++, base += 4, indexOffset += 6 ) {
				const left0 = vertexStart + pairVertices[base]
				const right0 = vertexStart + pairVertices[base + 1]
				const left1 = vertexStart + pairVertices[base + 2]
				const right1 = vertexStart + pairVertices[base + 3]
				changed |= ( indices[indexOffset] ^ left0 ) | ( indices[indexOffset + 1] ^ left1 ) | ( indices[indexOffset + 2] ^ right0 ) |
					( indices[indexOffset + 3] ^ right0 ) | ( indices[indexOffset + 4] ^ left1 ) | ( indices[indexOffset + 5] ^ right1 )
				indices[indexOffset] = left0
				indices[indexOffset + 1] = left1
				indices[indexOffset + 2] = right0
				indices[indexOffset + 3] = right0
				indices[indexOffset + 4] = left1
				indices[indexOffset + 5] = right1
			}
		}
		if ( changed !== 0 ) indexWriteChanged = true
		return indexOffset
	}
	if ( !pairVertices ) {
		let left0 = vertexStart
		let pOffset = left0 * 3
		for ( let segment = 0; segment < segmentCount; segment++, left0 += 4, pOffset += 12 ) {
			const right0 = left0 + 1
			const left1 = left0 + 2
			const right1 = left0 + 3
			const l0x = positions[pOffset], l0y = positions[pOffset + 1], l0z = positions[pOffset + 2]
			const r0x = positions[pOffset + 3], r0y = positions[pOffset + 4], r0z = positions[pOffset + 5]
			const l1x = positions[pOffset + 6], l1y = positions[pOffset + 7], l1z = positions[pOffset + 8]
			const r1x = positions[pOffset + 9], r1y = positions[pOffset + 10], r1z = positions[pOffset + 11]
			const n0x = normals[pOffset], n0y = normals[pOffset + 1], n0z = normals[pOffset + 2]
			const n1x = normals[pOffset + 6], n1y = normals[pOffset + 7], n1z = normals[pOffset + 8]
			const sumNx = n0x + n1x, sumNy = n0y + n1y, sumNz = n0z + n1z

			const ab1x = l1x - l0x, ab1y = l1y - l0y, ab1z = l1z - l0z
			const ac1x = r0x - l0x, ac1y = r0y - l0y, ac1z = r0z - l0z
			const fn1x = ab1y * ac1z - ab1z * ac1y
			const fn1y = ab1z * ac1x - ab1x * ac1z
			const fn1z = ab1x * ac1y - ab1y * ac1x
			const flip1 = fn1x * ( sumNx + n0x ) + fn1y * ( sumNy + n0y ) + fn1z * ( sumNz + n0z ) < 0
			const s1 = flip1 ? right0 : left1
			const t1 = flip1 ? left1 : right0

			const ab2x = l1x - r0x, ab2y = l1y - r0y, ab2z = l1z - r0z
			const ac2x = r1x - r0x, ac2y = r1y - r0y, ac2z = r1z - r0z
			const fn2x = ab2y * ac2z - ab2z * ac2y
			const fn2y = ab2z * ac2x - ab2x * ac2z
			const fn2z = ab2x * ac2y - ab2y * ac2x
			const flip2 = fn2x * ( sumNx + n1x ) + fn2y * ( sumNy + n1y ) + fn2z * ( sumNz + n1z ) < 0
			const s2 = flip2 ? right1 : left1
			const t2 = flip2 ? left1 : right1

			if ( trackChanges ) {
				changed |= ( indices[indexOffset] ^ left0 ) | ( indices[indexOffset + 1] ^ s1 ) | ( indices[indexOffset + 2] ^ t1 ) |
					( indices[indexOffset + 3] ^ right0 ) | ( indices[indexOffset + 4] ^ s2 ) | ( indices[indexOffset + 5] ^ t2 )
			}
			indices[indexOffset] = left0
			indices[indexOffset + 1] = s1
			indices[indexOffset + 2] = t1
			indices[indexOffset + 3] = right0
			indices[indexOffset + 4] = s2
			indices[indexOffset + 5] = t2
			indexOffset += 6
		}
	} else {
		for ( let segment = 0, base = 0; segment < segmentCount; segment++, base += 4 ) {
			const left0 = vertexStart + pairVertices[base]
			const right0 = vertexStart + pairVertices[base + 1]
			const left1 = vertexStart + pairVertices[base + 2]
			const right1 = vertexStart + pairVertices[base + 3]
			const l0o = left0 * 3, r0o = right0 * 3, l1o = left1 * 3, r1o = right1 * 3
			const l0x = positions[l0o], l0y = positions[l0o + 1], l0z = positions[l0o + 2]
			const r0x = positions[r0o], r0y = positions[r0o + 1], r0z = positions[r0o + 2]
			const l1x = positions[l1o], l1y = positions[l1o + 1], l1z = positions[l1o + 2]
			const r1x = positions[r1o], r1y = positions[r1o + 1], r1z = positions[r1o + 2]
			const n0x = normals[l0o], n0y = normals[l0o + 1], n0z = normals[l0o + 2]
			const n1x = normals[l1o], n1y = normals[l1o + 1], n1z = normals[l1o + 2]
			const sumNx = n0x + n1x, sumNy = n0y + n1y, sumNz = n0z + n1z

			const ab1x = l1x - l0x, ab1y = l1y - l0y, ab1z = l1z - l0z
			const ac1x = r0x - l0x, ac1y = r0y - l0y, ac1z = r0z - l0z
			const fn1x = ab1y * ac1z - ab1z * ac1y
			const fn1y = ab1z * ac1x - ab1x * ac1z
			const fn1z = ab1x * ac1y - ab1y * ac1x
			const flip1 = fn1x * ( sumNx + n0x ) + fn1y * ( sumNy + n0y ) + fn1z * ( sumNz + n0z ) < 0
			const s1 = flip1 ? right0 : left1
			const t1 = flip1 ? left1 : right0

			const ab2x = l1x - r0x, ab2y = l1y - r0y, ab2z = l1z - r0z
			const ac2x = r1x - r0x, ac2y = r1y - r0y, ac2z = r1z - r0z
			const fn2x = ab2y * ac2z - ab2z * ac2y
			const fn2y = ab2z * ac2x - ab2x * ac2z
			const fn2z = ab2x * ac2y - ab2y * ac2x
			const flip2 = fn2x * ( sumNx + n1x ) + fn2y * ( sumNy + n1y ) + fn2z * ( sumNz + n1z ) < 0
			const s2 = flip2 ? right1 : left1
			const t2 = flip2 ? left1 : right1

			if ( trackChanges ) {
				changed |= ( indices[indexOffset] ^ left0 ) | ( indices[indexOffset + 1] ^ s1 ) | ( indices[indexOffset + 2] ^ t1 ) |
					( indices[indexOffset + 3] ^ right0 ) | ( indices[indexOffset + 4] ^ s2 ) | ( indices[indexOffset + 5] ^ t2 )
			}
			indices[indexOffset] = left0
			indices[indexOffset + 1] = s1
			indices[indexOffset + 2] = t1
			indices[indexOffset + 3] = right0
			indices[indexOffset + 4] = s2
			indices[indexOffset + 5] = t2
			indexOffset += 6
		}
	}
	if ( changed !== 0 ) indexWriteChanged = true
	return indexOffset
}

function writeTopoExtraIndices( indices, indexOffset, positions, normals, topoIndices, topoIndexCount, vertexStart, trackChanges, fastCanonicalQuads = false ) {
	if ( topoIndexCount === 0 ) return indexOffset
	if ( fastCanonicalQuads ) {
		if ( !trackChanges ) {
			if ( vertexStart === 0 && indices instanceof Uint32Array ) {
				indices.set( topoIndices.subarray( 0, topoIndexCount ), indexOffset )
				return indexOffset + topoIndexCount
			}
			for ( let localIndex = 0; localIndex < topoIndexCount; localIndex++, indexOffset++ ) {
				indices[indexOffset] = vertexStart + topoIndices[localIndex]
			}
			return indexOffset
		}
		let changed = 0
		for ( let localIndex = 0; localIndex < topoIndexCount; localIndex++, indexOffset++ ) {
			const v = vertexStart + topoIndices[localIndex]
			changed |= indices[indexOffset] ^ v
			indices[indexOffset] = v
		}
		if ( changed !== 0 ) indexWriteChanged = true
		return indexOffset
	}
	let changed = 0
	for ( let localIndex = 0; localIndex < topoIndexCount; localIndex += 3 ) {
		const a = vertexStart + topoIndices[localIndex]
		const b = vertexStart + topoIndices[localIndex + 1]
		const c = vertexStart + topoIndices[localIndex + 2]
		const aOffset = a * 3
		const bOffset = b * 3
		const cOffset = c * 3
		const ax = positions[aOffset], ay = positions[aOffset + 1], az = positions[aOffset + 2]
		const abX = positions[bOffset] - ax
		const abY = positions[bOffset + 1] - ay
		const abZ = positions[bOffset + 2] - az
		const acX = positions[cOffset] - ax
		const acY = positions[cOffset + 1] - ay
		const acZ = positions[cOffset + 2] - az
		const faceNormalX = abY * acZ - abZ * acY
		const faceNormalY = abZ * acX - abX * acZ
		const faceNormalZ = abX * acY - abY * acX
		// Every extra join/cap triangle has all 3 vertices at the same pointIndex
		// sharing the exact same normal, so `normals[aOffset..+2]` has the same
		// direction as the 3-vertex sum without 6 extra array loads and additions.
		const flip = faceNormalX * normals[aOffset] + faceNormalY * normals[aOffset + 1] + faceNormalZ * normals[aOffset + 2] < 0
		const second = flip ? c : b
		const third = flip ? b : c
		if ( trackChanges ) {
			changed |= ( indices[indexOffset] ^ a ) | ( indices[indexOffset + 1] ^ second ) | ( indices[indexOffset + 2] ^ third )
		}
		indices[indexOffset] = a
		indices[indexOffset + 1] = second
		indices[indexOffset + 2] = third
		indexOffset += 3
	}
	if ( changed !== 0 ) indexWriteChanged = true
	return indexOffset
}

function emitDirectUnaliasedVariableLine(
	line, positions, normals, indices, bounds, trackChanges, skipTopoBaseQuadWrite
) {
	const topo = line.topology
	const points = line.points
	const normalsSource = line.normals
	const halfWidths = line.halfWidths
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const pointCount = line.pointCount
	const segmentCount = pointCount - 1
	const segmentStartSides = joinScratch.segmentStartSides
	const segmentEndSides = joinScratch.segmentEndSides
	const joinData = topo.joinData

	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]

	const w0 = constantHalfWidth !== null ? constantHalfWidth : halfWidths[0]
	const swx = segmentStartSides[0] * w0
	const swy = segmentStartSides[1] * w0
	const swz = segmentStartSides[2] * w0
	const sx = points[0], sy = points[1], sz = points[2]
	const p0x = Math.fround( sx - swx ), p0y = Math.fround( sy - swy ), p0z = Math.fround( sz - swz )
	const p1x = Math.fround( sx + swx ), p1y = Math.fround( sy + swy ), p1z = Math.fround( sz + swz )
	positions[0] = p0x; positions[1] = p0y; positions[2] = p0z
	positions[3] = p1x; positions[4] = p1y; positions[5] = p1z
	const n0x = normalsSource[0], n0y = normalsSource[1], n0z = normalsSource[2]
	normals[0] = n0x; normals[1] = n0y; normals[2] = n0z
	normals[3] = n0x; normals[4] = n0y; normals[5] = n0z
	minX = Math.min( minX, Math.min( p0x, p1x ) ); maxX = Math.max( maxX, Math.max( p0x, p1x ) )
	minY = Math.min( minY, Math.min( p0y, p1y ) ); maxY = Math.max( maxY, Math.max( p0y, p1y ) )
	minZ = Math.min( minZ, Math.min( p0z, p1z ) ); maxZ = Math.max( maxZ, Math.max( p0z, p1z ) )

	const lastSegIndex = segmentCount - 1
	const lastSeg3 = lastSegIndex * 3
	const lastPt3 = ( pointCount - 1 ) * 3
	const wLast = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointCount - 1]
	const ewx = segmentEndSides[lastSeg3] * wLast
	const ewy = segmentEndSides[lastSeg3 + 1] * wLast
	const ewz = segmentEndSides[lastSeg3 + 2] * wLast
	const ex = points[lastPt3], ey = points[lastPt3 + 1], ez = points[lastPt3 + 2]
	const posBase = ( lastSegIndex * 4 + 2 ) * 3
	const p2x = Math.fround( ex - ewx ), p2y = Math.fround( ey - ewy ), p2z = Math.fround( ez - ewz )
	const p3x = Math.fround( ex + ewx ), p3y = Math.fround( ey + ewy ), p3z = Math.fround( ez + ewz )
	positions[posBase] = p2x; positions[posBase + 1] = p2y; positions[posBase + 2] = p2z
	positions[posBase + 3] = p3x; positions[posBase + 4] = p3y; positions[posBase + 5] = p3z
	const nLx = normalsSource[lastPt3], nLy = normalsSource[lastPt3 + 1], nLz = normalsSource[lastPt3 + 2]
	normals[posBase] = nLx; normals[posBase + 1] = nLy; normals[posBase + 2] = nLz
	normals[posBase + 3] = nLx; normals[posBase + 4] = nLy; normals[posBase + 5] = nLz
	minX = Math.min( minX, Math.min( p2x, p3x ) ); maxX = Math.max( maxX, Math.max( p2x, p3x ) )
	minY = Math.min( minY, Math.min( p2y, p3y ) ); maxY = Math.max( maxY, Math.max( p2y, p3y ) )
	minZ = Math.min( minZ, Math.min( p2z, p3z ) ); maxZ = Math.max( maxZ, Math.max( p2z, p3z ) )

	let indexOffset = segmentCount * 6

	for (
		let pointIndex = 1, incomingEnd0 = 2, ie0 = 6, pointOffset = 3, inSide3 = 0, info = JOIN_STRIDE;
		pointIndex < pointCount - 1;
		pointIndex++, incomingEnd0 += 4, ie0 += 12, pointOffset += 3, inSide3 += 3, info += JOIN_STRIDE, indexOffset += 3
	) {
		const centerX = points[pointOffset]
		const centerY = points[pointOffset + 1]
		const centerZ = points[pointOffset + 2]
		const nx = normalsSource[pointOffset]
		const ny = normalsSource[pointOffset + 1]
		const nz = normalsSource[pointOffset + 2]
		normals[ie0] = nx; normals[ie0 + 1] = ny; normals[ie0 + 2] = nz
		normals[ie0 + 3] = nx; normals[ie0 + 4] = ny; normals[ie0 + 5] = nz
		normals[ie0 + 6] = nx; normals[ie0 + 7] = ny; normals[ie0 + 8] = nz
		normals[ie0 + 9] = nx; normals[ie0 + 10] = ny; normals[ie0 + 11] = nz

		const width = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointIndex]
		const positiveTurn = joinData[info + JOIN_ANGLE] > 0
		const turnBit = positiveTurn ? 1 : 0
		const innerBias = turnBit * 3
		const outerBias = 3 - innerBias
		const outerWidth = positiveTurn ? -width : width
		const innerScale = -outerWidth * joinData[info + JOIN_SCALE]
		const innerX = Math.fround( centerX + joinData[info + JOIN_MITER] * innerScale )
		const innerY = Math.fround( centerY + joinData[info + JOIN_MITER + 1] * innerScale )
		const innerZ = Math.fround( centerZ + joinData[info + JOIN_MITER + 2] * innerScale )
		const inOuterX = Math.fround( centerX + segmentEndSides[inSide3] * outerWidth )
		const inOuterY = Math.fround( centerY + segmentEndSides[inSide3 + 1] * outerWidth )
		const inOuterZ = Math.fround( centerZ + segmentEndSides[inSide3 + 2] * outerWidth )
		const outOuterX = Math.fround( centerX + segmentStartSides[pointOffset] * outerWidth )
		const outOuterY = Math.fround( centerY + segmentStartSides[pointOffset + 1] * outerWidth )
		const outOuterZ = Math.fround( centerZ + segmentStartSides[pointOffset + 2] * outerWidth )

		const inOutIdx = ie0 + outerBias
		const inInIdx = ie0 + innerBias
		const outOutIdx = ie0 + 6 + outerBias
		const outInIdx = ie0 + 6 + innerBias
		positions[inOutIdx] = inOuterX; positions[inOutIdx + 1] = inOuterY; positions[inOutIdx + 2] = inOuterZ
		positions[inInIdx] = innerX; positions[inInIdx + 1] = innerY; positions[inInIdx + 2] = innerZ
		positions[outOutIdx] = outOuterX; positions[outOutIdx + 1] = outOuterY; positions[outOutIdx + 2] = outOuterZ
		positions[outInIdx] = innerX; positions[outInIdx + 1] = innerY; positions[outInIdx + 2] = innerZ

		minX = Math.min( minX, Math.min( innerX, Math.min( inOuterX, outOuterX ) ) )
		maxX = Math.max( maxX, Math.max( innerX, Math.max( inOuterX, outOuterX ) ) )
		minY = Math.min( minY, Math.min( innerY, Math.min( inOuterY, outOuterY ) ) )
		maxY = Math.max( maxY, Math.max( innerY, Math.max( inOuterY, outOuterY ) ) )
		minZ = Math.min( minZ, Math.min( innerZ, Math.min( inOuterZ, outOuterZ ) ) )
		maxZ = Math.max( maxZ, Math.max( innerZ, Math.max( inOuterZ, outOuterZ ) ) )

		indices[indexOffset] = incomingEnd0 + turnBit
		indices[indexOffset + 1] = incomingEnd0 + outerBias
		indices[indexOffset + 2] = incomingEnd0 + 1 + turnBit
	}

	writeTopoBaseQuads(
		indices, 0, positions, normals, null,
		0, segmentCount, trackChanges, true, skipTopoBaseQuadWrite
	)

	if ( !line.isFloat32Input ) assertFloat32PathSegments( points, false, 0 )

	lastBoundsMinX = minX; lastBoundsMinY = minY; lastBoundsMinZ = minZ
	lastBoundsMaxX = maxX; lastBoundsMaxY = maxY; lastBoundsMaxZ = maxZ
	return indexOffset
}

function emitDirectAliasedVariableLine( line, positions, normals, indices, bounds ) {
	const topo = line.topology
	const points = line.points
	const normalsSource = line.normals
	const halfWidths = line.halfWidths
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const pointCount = line.pointCount
	const segmentCount = pointCount - 1
	const segmentStartSides = joinScratch.segmentStartSides
	const segmentEndSides = joinScratch.segmentEndSides
	const joinData = topo.joinData
	const isMiterJoin = topo.joinType === 'miter'
	const joinLimit = topo.joinLimit

	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]

	const w0 = constantHalfWidth !== null ? constantHalfWidth : halfWidths[0]
	const swx = segmentStartSides[0] * w0
	const swy = segmentStartSides[1] * w0
	const swz = segmentStartSides[2] * w0
	const sx = points[0], sy = points[1], sz = points[2]
	const p0x = Math.fround( sx - swx ), p0y = Math.fround( sy - swy ), p0z = Math.fround( sz - swz )
	const p1x = Math.fround( sx + swx ), p1y = Math.fround( sy + swy ), p1z = Math.fround( sz + swz )
	positions[0] = p0x; positions[1] = p0y; positions[2] = p0z
	positions[6] = p1x; positions[7] = p1y; positions[8] = p1z
	const n0x = normalsSource[0], n0y = normalsSource[1], n0z = normalsSource[2]
	normals[0] = n0x; normals[1] = n0y; normals[2] = n0z
	normals[6] = n0x; normals[7] = n0y; normals[8] = n0z
	minX = Math.min( minX, Math.min( p0x, p1x ) ); maxX = Math.max( maxX, Math.max( p0x, p1x ) )
	minY = Math.min( minY, Math.min( p0y, p1y ) ); maxY = Math.max( maxY, Math.max( p0y, p1y ) )
	minZ = Math.min( minZ, Math.min( p0z, p1z ) ); maxZ = Math.max( maxZ, Math.max( p0z, p1z ) )

	indices[0] = 0; indices[1] = 1; indices[2] = 2
	indices[3] = 2; indices[4] = 1; indices[5] = 3

	let prevEndLeft = 1
	let prevEndRight = 3
	let nextVertex = 4
	let quadIndexOffset = 6
	let extraIndexOffset = segmentCount * 6

	for (
		let pointIndex = 1, pointOffset = 3, inSide3 = 0, info = JOIN_STRIDE;
		pointIndex < pointCount - 1;
		pointIndex++, pointOffset += 3, inSide3 += 3, info += JOIN_STRIDE, quadIndexOffset += 6
	) {
		const centerX = points[pointOffset]
		const centerY = points[pointOffset + 1]
		const centerZ = points[pointOffset + 2]
		const nx = normalsSource[pointOffset]
		const ny = normalsSource[pointOffset + 1]
		const nz = normalsSource[pointOffset + 2]
		const width = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointIndex]
		const angle = joinData[info + JOIN_ANGLE]
		const scale = joinData[info + JOIN_SCALE]
		const pel3 = prevEndLeft * 3
		const per3 = prevEndRight * 3

		if ( angle === 0 || ( isMiterJoin && scale <= joinLimit ) ) {
			let mx, my, mz
			if ( angle === 0 ) {
				mx = segmentEndSides[inSide3] * width
				my = segmentEndSides[inSide3 + 1] * width
				mz = segmentEndSides[inSide3 + 2] * width
			} else {
				const ws = width * scale
				mx = joinData[info + JOIN_MITER] * ws
				my = joinData[info + JOIN_MITER + 1] * ws
				mz = joinData[info + JOIN_MITER + 2] * ws
			}
			const lx = Math.fround( centerX - mx ), ly = Math.fround( centerY - my ), lz = Math.fround( centerZ - mz )
			const rx = Math.fround( centerX + mx ), ry = Math.fround( centerY + my ), rz = Math.fround( centerZ + mz )
			positions[pel3] = lx; positions[pel3 + 1] = ly; positions[pel3 + 2] = lz
			positions[per3] = rx; positions[per3 + 1] = ry; positions[per3 + 2] = rz
			normals[pel3] = nx; normals[pel3 + 1] = ny; normals[pel3 + 2] = nz
			normals[per3] = nx; normals[per3 + 1] = ny; normals[per3 + 2] = nz
			minX = Math.min( minX, Math.min( lx, rx ) ); maxX = Math.max( maxX, Math.max( lx, rx ) )
			minY = Math.min( minY, Math.min( ly, ry ) ); maxY = Math.max( maxY, Math.max( ly, ry ) )
			minZ = Math.min( minZ, Math.min( lz, rz ) ); maxZ = Math.max( maxZ, Math.max( lz, rz ) )

			const curEndLeft = nextVertex
			const curEndRight = nextVertex + 1
			nextVertex += 2
			indices[quadIndexOffset] = prevEndLeft
			indices[quadIndexOffset + 1] = curEndLeft
			indices[quadIndexOffset + 2] = prevEndRight
			indices[quadIndexOffset + 3] = prevEndRight
			indices[quadIndexOffset + 4] = curEndLeft
			indices[quadIndexOffset + 5] = curEndRight
			prevEndLeft = curEndLeft
			prevEndRight = curEndRight
			continue
		}

		const curStartLeft = nextVertex
		const curEndLeft = nextVertex + 1
		const curStartRight = nextVertex + 2
		const curEndRight = nextVertex + 3
		nextVertex += 4
		const csl3 = curStartLeft * 3
		const csr3 = curStartRight * 3
		normals[pel3] = nx; normals[pel3 + 1] = ny; normals[pel3 + 2] = nz
		normals[per3] = nx; normals[per3 + 1] = ny; normals[per3 + 2] = nz
		normals[csl3] = nx; normals[csl3 + 1] = ny; normals[csl3 + 2] = nz
		normals[csr3] = nx; normals[csr3 + 1] = ny; normals[csr3 + 2] = nz

		const positiveTurn = angle > 0
		const outerWidth = positiveTurn ? -width : width
		const innerScale = -outerWidth * scale
		const innerX = Math.fround( centerX + joinData[info + JOIN_MITER] * innerScale )
		const innerY = Math.fround( centerY + joinData[info + JOIN_MITER + 1] * innerScale )
		const innerZ = Math.fround( centerZ + joinData[info + JOIN_MITER + 2] * innerScale )
		const inOuterX = Math.fround( centerX + segmentEndSides[inSide3] * outerWidth )
		const inOuterY = Math.fround( centerY + segmentEndSides[inSide3 + 1] * outerWidth )
		const inOuterZ = Math.fround( centerZ + segmentEndSides[inSide3 + 2] * outerWidth )
		const outOuterX = Math.fround( centerX + segmentStartSides[pointOffset] * outerWidth )
		const outOuterY = Math.fround( centerY + segmentStartSides[pointOffset + 1] * outerWidth )
		const outOuterZ = Math.fround( centerZ + segmentStartSides[pointOffset + 2] * outerWidth )

		if ( positiveTurn ) {
			positions[pel3] = inOuterX; positions[pel3 + 1] = inOuterY; positions[pel3 + 2] = inOuterZ
			positions[per3] = innerX; positions[per3 + 1] = innerY; positions[per3 + 2] = innerZ
			positions[csl3] = outOuterX; positions[csl3 + 1] = outOuterY; positions[csl3 + 2] = outOuterZ
			positions[csr3] = innerX; positions[csr3 + 1] = innerY; positions[csr3 + 2] = innerZ
			indices[extraIndexOffset] = prevEndRight
			indices[extraIndexOffset + 1] = prevEndLeft
			indices[extraIndexOffset + 2] = curStartLeft
		} else {
			positions[pel3] = innerX; positions[pel3 + 1] = innerY; positions[pel3 + 2] = innerZ
			positions[per3] = inOuterX; positions[per3 + 1] = inOuterY; positions[per3 + 2] = inOuterZ
			positions[csl3] = innerX; positions[csl3 + 1] = innerY; positions[csl3 + 2] = innerZ
			positions[csr3] = outOuterX; positions[csr3 + 1] = outOuterY; positions[csr3 + 2] = outOuterZ
			indices[extraIndexOffset] = prevEndLeft
			indices[extraIndexOffset + 1] = curStartRight
			indices[extraIndexOffset + 2] = prevEndRight
		}
		extraIndexOffset += 3

		minX = Math.min( minX, Math.min( innerX, Math.min( inOuterX, outOuterX ) ) )
		maxX = Math.max( maxX, Math.max( innerX, Math.max( inOuterX, outOuterX ) ) )
		minY = Math.min( minY, Math.min( innerY, Math.min( inOuterY, outOuterY ) ) )
		maxY = Math.max( maxY, Math.max( innerY, Math.max( inOuterY, outOuterY ) ) )
		minZ = Math.min( minZ, Math.min( innerZ, Math.min( inOuterZ, outOuterZ ) ) )
		maxZ = Math.max( maxZ, Math.max( innerZ, Math.max( inOuterZ, outOuterZ ) ) )

		indices[quadIndexOffset] = curStartLeft
		indices[quadIndexOffset + 1] = curEndLeft
		indices[quadIndexOffset + 2] = curStartRight
		indices[quadIndexOffset + 3] = curStartRight
		indices[quadIndexOffset + 4] = curEndLeft
		indices[quadIndexOffset + 5] = curEndRight
		prevEndLeft = curEndLeft
		prevEndRight = curEndRight
	}

	const lastSegIndex = segmentCount - 1
	const lastSeg3 = lastSegIndex * 3
	const lastPt3 = ( pointCount - 1 ) * 3
	const wLast = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointCount - 1]
	const ewx = segmentEndSides[lastSeg3] * wLast
	const ewy = segmentEndSides[lastSeg3 + 1] * wLast
	const ewz = segmentEndSides[lastSeg3 + 2] * wLast
	const ex = points[lastPt3], ey = points[lastPt3 + 1], ez = points[lastPt3 + 2]
	const pel3 = prevEndLeft * 3
	const per3 = prevEndRight * 3
	const p2x = Math.fround( ex - ewx ), p2y = Math.fround( ey - ewy ), p2z = Math.fround( ez - ewz )
	const p3x = Math.fround( ex + ewx ), p3y = Math.fround( ey + ewy ), p3z = Math.fround( ez + ewz )
	positions[pel3] = p2x; positions[pel3 + 1] = p2y; positions[pel3 + 2] = p2z
	positions[per3] = p3x; positions[per3 + 1] = p3y; positions[per3 + 2] = p3z
	const nLx = normalsSource[lastPt3], nLy = normalsSource[lastPt3 + 1], nLz = normalsSource[lastPt3 + 2]
	normals[pel3] = nLx; normals[pel3 + 1] = nLy; normals[pel3 + 2] = nLz
	normals[per3] = nLx; normals[per3 + 1] = nLy; normals[per3 + 2] = nLz
	minX = Math.min( minX, Math.min( p2x, p3x ) ); maxX = Math.max( maxX, Math.max( p2x, p3x ) )
	minY = Math.min( minY, Math.min( p2y, p3y ) ); maxY = Math.max( maxY, Math.max( p2y, p3y ) )
	minZ = Math.min( minZ, Math.min( p2z, p3z ) ); maxZ = Math.max( maxZ, Math.max( p2z, p3z ) )

	if ( !line.isFloat32Input ) assertFloat32PathSegments( points, false, 0 )

	lastBoundsMinX = minX; lastBoundsMinY = minY; lastBoundsMinZ = minZ
	lastBoundsMaxX = maxX; lastBoundsMaxY = maxY; lastBoundsMaxZ = maxZ
	return extraIndexOffset
}

const singlePassEndNormals = new Float64Array( 6 )
const singlePassEndDirections = new Float64Array( 6 )
const singlePassEndOffsets = new Float64Array( 6 )
const singlePassProbePositions = new Float32Array( 24 )
const singlePassProbeNormals = new Float32Array( 24 )
const singlePassProbeUvs = new Float32Array( 16 )
const singlePassProbeIndices16 = new Uint16Array( 15 )
const singlePassProbeIndices32 = new Uint32Array( 15 )
let singlePassMiterWarmedUp = false
let singlePassVariableWarmedUp = false
const singlePassCapFrame = { normals: singlePassEndNormals, endNormalOffset: 3 }
const singlePassCapPath = {
	points: null,
	pointCount: 0,
	segmentCount: 0,
	totalLength: 0,
	segmentDirections: singlePassEndDirections,
	endDirectionOffset: 3,
	tangents: null,
	progress: null,
}
const singlePassCapNeeds = { tangents: false, uvs: false, progress: false, sides: false }

function emitSinglePassOpenMiterSurface( points, pointCount, isFloat32Input, halfWidth, surface, joinLimit, positions, normals, uvs ) {
	const openSegments = pointCount - 1
	const epsSq = EPSILON * EPSILON
	const safeRatio = 0.45
	const fixedUp = surface.frame === 'fixed-up'
	const up = normalizeVector( readVectorLike( surface.up, 'surface.up' ) )
	const upX = up[0], upY = up[1], upZ = up[2]
	const invUvScale = uvs ? 1 / surface.uvScale : 0

	let nxPt = points[0], nyPt = points[1], nzPt = points[2]
	let prevX = points[3], prevY = points[4], prevZ = points[5]
	let dx = Math.abs( nxPt ), dy = Math.abs( nyPt ), dz = Math.abs( nzPt )
	let outX = Math.abs( prevX ), outY = Math.abs( prevY ), outZ = Math.abs( prevZ )
	let maxMag = Math.max(
		dx > dy ? ( dx > dz ? dx : dz ) : ( dy > dz ? dy : dz ),
		outX > outY ? ( outX > outZ ? outX : outZ ) : ( outY > outZ ? outY : outZ )
	)
	dx = prevX - nxPt; dy = prevY - nyPt; dz = prevZ - nzPt
	let curSegLen = dx * dx + dy * dy + dz * dz
	if ( !( curSegLen > 1e-300 && curSegLen < Infinity ) ) return -1
	curSegLen = Math.sqrt( curSegLen )
	let scale = 1 / curSegLen
	let inX = dx * scale, inY = dy * scale, inZ = dz * scale
	let minLen = curSegLen
	let totalLength = curSegLen
	let prevSafeLen = curSegLen * safeRatio

	seedNormalScalar( frameCandidateScratch, inX, inY, inZ, upX, upY, upZ )
	writeOrthonormalFrameScalar( singlePassEndNormals, 0, inX, inY, inZ, frameCandidateScratch[0], frameCandidateScratch[1], frameCandidateScratch[2] )
	let prevNormalX = singlePassEndNormals[0]
	let prevNormalY = singlePassEndNormals[1]
	let prevNormalZ = singlePassEndNormals[2]
	let prevTangentX = inX, prevTangentY = inY, prevTangentZ = inZ

	singlePassEndDirections[0] = inX
	singlePassEndDirections[1] = inY
	singlePassEndDirections[2] = inZ
	let miterX = prevNormalY * inZ - prevNormalZ * inY
	let miterY = prevNormalZ * inX - prevNormalX * inZ
	let miterZ = prevNormalX * inY - prevNormalY * inX
	singlePassEndOffsets[0] = miterX
	singlePassEndOffsets[1] = miterY
	singlePassEndOffsets[2] = miterZ

	dx = miterX * halfWidth; dy = miterY * halfWidth; dz = miterZ * halfWidth
	let lpx = Math.fround( nxPt - dx ), lpy = Math.fround( nyPt - dy ), lpz = Math.fround( nzPt - dz )
	let rpx = Math.fround( nxPt + dx ), rpy = Math.fround( nyPt + dy ), rpz = Math.fround( nzPt + dz )
	positions[0] = lpx; positions[1] = lpy; positions[2] = lpz
	positions[3] = rpx; positions[4] = rpy; positions[5] = rpz
	normals[0] = prevNormalX; normals[1] = prevNormalY; normals[2] = prevNormalZ
	normals[3] = prevNormalX; normals[4] = prevNormalY; normals[5] = prevNormalZ
	if ( uvs ) {
		uvs[0] = 0; uvs[1] = 0; uvs[2] = 0; uvs[3] = 1
	}
	let minX = Math.min( lpx, rpx ), maxX = Math.max( lpx, rpx )
	let minY = Math.min( lpy, rpy ), maxY = Math.max( lpy, rpy )
	let minZ = Math.min( lpz, rpz ), maxZ = Math.max( lpz, rpz )

	let maxScale = 0
	let maxFiniteScale = Math.SQRT2
	let tanX = 0, tanY = 0, tanZ = 0
	let normalX = 0, normalY = 0, normalZ = 0
	let c = 0, q = 0, lsSq = 0

	for (
		let i = 1, pointOffset = 3, posOffset = 6, uvOffset = 4;
		i < openSegments;
		i++, pointOffset += 3, posOffset += 6, uvOffset += 4
	) {
		const curDist = totalLength
		nxPt = points[pointOffset + 3]
		nyPt = points[pointOffset + 4]
		nzPt = points[pointOffset + 5]
		dx = Math.abs( nxPt ); dy = Math.abs( nyPt ); dz = Math.abs( nzPt )
		c = dx > dy ? ( dx > dz ? dx : dz ) : ( dy > dz ? dy : dz )
		if ( c > maxMag ) maxMag = c

		dx = nxPt - prevX
		dy = nyPt - prevY
		dz = nzPt - prevZ
		lsSq = dx * dx + dy * dy + dz * dz
		if ( !( lsSq > 1e-300 && lsSq < Infinity ) ) return -1
		curSegLen = Math.sqrt( lsSq )
		if ( curSegLen < minLen ) minLen = curSegLen
		totalLength += curSegLen
		scale = 1 / curSegLen
		outX = dx * scale
		outY = dy * scale
		outZ = dz * scale

		tanX = inX + outX
		tanY = inY + outY
		tanZ = inZ + outZ
		lsSq = tanX * tanX + tanY * tanY + tanZ * tanZ
		if ( lsSq <= epsSq ) return -1
		scale = 1 / Math.sqrt( lsSq )
		tanX *= scale
		tanY *= scale
		tanZ *= scale

		if ( !fixedUp ) {
			c = prevTangentX * tanX + prevTangentY * tanY + prevTangentZ * tanZ
			if ( !( c > -0.999999 ) ) return -1
			q = ( tanX * prevNormalX + tanY * prevNormalY + tanZ * prevNormalZ ) / ( 1 + c )
			dx = prevNormalX - ( prevTangentX + tanX ) * q
			dy = prevNormalY - ( prevTangentY + tanY ) * q
			dz = prevNormalZ - ( prevTangentZ + tanZ ) * q
			c = tanX * dx + tanY * dy + tanZ * dz
			dx -= tanX * c
			dy -= tanY * c
			dz -= tanZ * c
			scale = 1.5 - 0.5 * ( dx * dx + dy * dy + dz * dz )
			normalX = dx * scale
			normalY = dy * scale
			normalZ = dz * scale
		} else {
			c = tanX * upX + tanY * upY + tanZ * upZ
			dx = upX - tanX * c
			dy = upY - tanY * c
			dz = upZ - tanZ * c
			lsSq = dx * dx + dy * dy + dz * dz
			if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
			q = Math.sqrt( lsSq )
			scale = ( dx * prevNormalX + dy * prevNormalY + dz * prevNormalZ < 0 ) ? -1 / q : 1 / q
			dx *= scale; dy *= scale; dz *= scale
			c = tanX * dx + tanY * dy + tanZ * dz
			dx -= tanX * c; dy -= tanY * c; dz -= tanZ * c
			lsSq = dx * dx + dy * dy + dz * dz
			if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
			scale = lsSq > 0.999999 && lsSq < 1.000001 ? 1.5 - 0.5 * lsSq : 1 / Math.sqrt( lsSq )
			normalX = dx * scale
			normalY = dy * scale
			normalZ = dz * scale
		}
		prevNormalX = normalX; prevNormalY = normalY; prevNormalZ = normalZ
		prevTangentX = tanX; prevTangentY = tanY; prevTangentZ = tanZ

		miterX = normalY * tanZ - normalZ * tanY
		miterY = normalZ * tanX - normalX * tanZ
		miterZ = normalX * tanY - normalY * tanX
		c = tanX * outX + tanY * outY + tanZ * outZ
		q = 0.5 * ( ( outX - inX ) * miterX + ( outY - inY ) * miterY + ( outZ - inZ ) * miterZ )
		inX = outX; inY = outY; inZ = outZ

		dx = c * c
		dy = q * q
		lsSq = dx + dy
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
		if ( dx - dy <= REVERSAL_SPLIT_DOT * lsSq ) return -1
		dz = Math.sqrt( lsSq )
		if ( c <= EPSILON * dz ) return -1

		const invC = 1 / c
		scale = dz * invC
		if ( scale > maxFiniteScale ) maxFiniteScale = scale
		const curSafeLen = curSegLen * safeRatio
		const absQ = Math.abs( q )
		if ( !( dx > dy && 2 * c * absQ <= 1e-8 * lsSq ) ) {
			if ( scale > joinLimit ) return -1
			if ( absQ * invC * halfWidth > prevSafeLen || absQ * invC * halfWidth > curSafeLen ) return -1
			if ( scale > maxScale ) maxScale = scale
		}
		prevSafeLen = curSafeLen

		dx = ( miterX * scale ) * halfWidth
		dy = ( miterY * scale ) * halfWidth
		dz = ( miterZ * scale ) * halfWidth
		lpx = Math.fround( prevX - dx ); lpy = Math.fround( prevY - dy ); lpz = Math.fround( prevZ - dz )
		rpx = Math.fround( prevX + dx ); rpy = Math.fround( prevY + dy ); rpz = Math.fround( prevZ + dz )
		positions[posOffset] = lpx; positions[posOffset + 1] = lpy; positions[posOffset + 2] = lpz
		positions[posOffset + 3] = rpx; positions[posOffset + 4] = rpy; positions[posOffset + 5] = rpz
		normals[posOffset] = normalX; normals[posOffset + 1] = normalY; normals[posOffset + 2] = normalZ
		normals[posOffset + 3] = normalX; normals[posOffset + 4] = normalY; normals[posOffset + 5] = normalZ
		if ( uvs ) {
			c = curDist * invUvScale
			uvs[uvOffset] = c; uvs[uvOffset + 1] = 0; uvs[uvOffset + 2] = c; uvs[uvOffset + 3] = 1
		}
		minX = Math.min( minX, Math.min( lpx, rpx ) ); maxX = Math.max( maxX, Math.max( lpx, rpx ) )
		minY = Math.min( minY, Math.min( lpy, rpy ) ); maxY = Math.max( maxY, Math.max( lpy, rpy ) )
		minZ = Math.min( minZ, Math.min( lpz, rpz ) ); maxZ = Math.max( maxZ, Math.max( lpz, rpz ) )
		prevX = nxPt; prevY = nyPt; prevZ = nzPt
	}

	if ( !fixedUp ) {
		c = prevTangentX * inX + prevTangentY * inY + prevTangentZ * inZ
		if ( !( c > -0.999999 ) ) return -1
		q = ( inX * prevNormalX + inY * prevNormalY + inZ * prevNormalZ ) / ( 1 + c )
		dx = prevNormalX - ( prevTangentX + inX ) * q
		dy = prevNormalY - ( prevTangentY + inY ) * q
		dz = prevNormalZ - ( prevTangentZ + inZ ) * q
		c = inX * dx + inY * dy + inZ * dz
		dx -= inX * c; dy -= inY * c; dz -= inZ * c
		scale = 1.5 - 0.5 * ( dx * dx + dy * dy + dz * dz )
		normalX = dx * scale; normalY = dy * scale; normalZ = dz * scale
	} else {
		c = inX * upX + inY * upY + inZ * upZ
		dx = upX - inX * c; dy = upY - inY * c; dz = upZ - inZ * c
		lsSq = dx * dx + dy * dy + dz * dz
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
		q = Math.sqrt( lsSq )
		scale = ( dx * prevNormalX + dy * prevNormalY + dz * prevNormalZ < 0 ) ? -1 / q : 1 / q
		dx *= scale; dy *= scale; dz *= scale
		c = inX * dx + inY * dy + inZ * dz
		dx -= inX * c; dy -= inY * c; dz -= inZ * c
		lsSq = dx * dx + dy * dy + dz * dz
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
		scale = lsSq > 0.999999 && lsSq < 1.000001 ? 1.5 - 0.5 * lsSq : 1 / Math.sqrt( lsSq )
		normalX = dx * scale; normalY = dy * scale; normalZ = dz * scale
	}

	singlePassEndNormals[3] = normalX
	singlePassEndNormals[4] = normalY
	singlePassEndNormals[5] = normalZ
	singlePassEndDirections[3] = inX
	singlePassEndDirections[4] = inY
	singlePassEndDirections[5] = inZ
	miterX = normalY * inZ - normalZ * inY
	miterY = normalZ * inX - normalX * inZ
	miterZ = normalX * inY - normalY * inX
	singlePassEndOffsets[3] = miterX
	singlePassEndOffsets[4] = miterY
	singlePassEndOffsets[5] = miterZ

	const lastPosOffset = openSegments * 6
	dx = miterX * halfWidth; dy = miterY * halfWidth; dz = miterZ * halfWidth
	lpx = Math.fround( prevX - dx ); lpy = Math.fround( prevY - dy ); lpz = Math.fround( prevZ - dz )
	rpx = Math.fround( prevX + dx ); rpy = Math.fround( prevY + dy ); rpz = Math.fround( prevZ + dz )
	positions[lastPosOffset] = lpx; positions[lastPosOffset + 1] = lpy; positions[lastPosOffset + 2] = lpz
	positions[lastPosOffset + 3] = rpx; positions[lastPosOffset + 4] = rpy; positions[lastPosOffset + 5] = rpz
	normals[lastPosOffset] = normalX; normals[lastPosOffset + 1] = normalY; normals[lastPosOffset + 2] = normalZ
	normals[lastPosOffset + 3] = normalX; normals[lastPosOffset + 4] = normalY; normals[lastPosOffset + 5] = normalZ
	if ( uvs ) {
		const lastUvOffset = openSegments * 4
		c = totalLength * invUvScale
		uvs[lastUvOffset] = c; uvs[lastUvOffset + 1] = 0; uvs[lastUvOffset + 2] = c; uvs[lastUvOffset + 3] = 1
	}
	minX = Math.min( minX, Math.min( lpx, rpx ) ); maxX = Math.max( maxX, Math.max( lpx, rpx ) )
	minY = Math.min( minY, Math.min( lpy, rpy ) ); maxY = Math.max( maxY, Math.max( lpy, rpy ) )
	minZ = Math.min( minZ, Math.min( lpz, rpz ) ); maxZ = Math.max( maxZ, Math.max( lpz, rpz ) )

	if ( maxScale > 16 ) return -1
	c = maxMag * Number.EPSILON * 4
	q = c > DUPLICATE_EPSILON ? c : DUPLICATE_EPSILON
	if ( !( maxMag < Infinity && minLen > q && totalLength > 0 && totalLength < Infinity ) ) return -1
	c = maxMag + halfWidth * maxFiniteScale
	if ( !( c <= 1e30 && halfWidth >= c * 2e-6 && ( isFloat32Input || minLen >= maxMag * 1e-5 ) ) ) return -1
	if ( uvs ) {
		c = ( totalLength + halfWidth ) * invUvScale
		if ( !( c <= 3.4028234663852886e+38 && c >= -3.4028234663852886e+38 ) ) return -1
	}
	if ( !isFloat32Input && pointCount * 3 === points.length ) assertFloat32PathSegments( points, false, 0 )

	lastBoundsMinX = minX; lastBoundsMinY = minY; lastBoundsMinZ = minZ
	lastBoundsMaxX = maxX; lastBoundsMaxY = maxY; lastBoundsMaxZ = maxZ
	return totalLength
}

function emitSinglePassOpenVariableSurface( points, pointCount, isFloat32Input, halfWidth, surface, join, positions, normals, indices, skipTopoBaseQuadWrite ) {
	const segmentCount = pointCount - 1
	const epsSq = EPSILON * EPSILON
	const safeRatio = 0.45
	const fixedUp = surface.frame === 'fixed-up'
	const up = normalizeVector( readVectorLike( surface.up, 'surface.up' ) )
	const upX = up[0], upY = up[1], upZ = up[2]
	const joinType = join.type
	const joinLimit = join.limit
	const joinSegments = join.segments
	const minVariableScale = joinType === 'miter' ? joinLimit : -1
	const singleSegCos = joinType === 'round' ? Math.cos( Math.PI / joinSegments ) + 1e-12 : -2

	let nxPt = points[0], nyPt = points[1], nzPt = points[2]
	let prevX = points[3], prevY = points[4], prevZ = points[5]
	let dx = Math.abs( nxPt ), dy = Math.abs( nyPt ), dz = Math.abs( nzPt )
	let outDirX = Math.abs( prevX ), outDirY = Math.abs( prevY ), outDirZ = Math.abs( prevZ )
	let maxMag = Math.max(
		dx > dy ? ( dx > dz ? dx : dz ) : ( dy > dz ? dy : dz ),
		outDirX > outDirY ? ( outDirX > outDirZ ? outDirX : outDirZ ) : ( outDirY > outDirZ ? outDirY : outDirZ )
	)
	dx = prevX - nxPt; dy = prevY - nyPt; dz = prevZ - nzPt
	let curSegLen = dx * dx + dy * dy + dz * dz
	if ( !( curSegLen > 1e-300 && curSegLen < Infinity ) ) return -1
	curSegLen = Math.sqrt( curSegLen )
	let scale = 1 / curSegLen
	let inDirX = dx * scale, inDirY = dy * scale, inDirZ = dz * scale
	let minLen = curSegLen
	let totalLength = curSegLen
	let prevSegLen = curSegLen

	seedNormalScalar( frameCandidateScratch, inDirX, inDirY, inDirZ, upX, upY, upZ )
	writeOrthonormalFrameScalar( singlePassEndNormals, 0, inDirX, inDirY, inDirZ, frameCandidateScratch[0], frameCandidateScratch[1], frameCandidateScratch[2] )
	let prevNormalX = singlePassEndNormals[0]
	let prevNormalY = singlePassEndNormals[1]
	let prevNormalZ = singlePassEndNormals[2]
	let prevTangentX = inDirX, prevTangentY = inDirY, prevTangentZ = inDirZ

	let miterX = prevNormalY * inDirZ - prevNormalZ * inDirY
	let miterY = prevNormalZ * inDirX - prevNormalX * inDirZ
	let miterZ = prevNormalX * inDirY - prevNormalY * inDirX
	let lsSq = miterX * miterX + miterY * miterY + miterZ * miterZ
	if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
	scale = halfWidth / Math.sqrt( lsSq )
	dx = miterX * scale; dy = miterY * scale; dz = miterZ * scale
	let innerX = Math.fround( nxPt - dx ), innerY = Math.fround( nyPt - dy ), innerZ = Math.fround( nzPt - dz )
	let inOuterX = Math.fround( nxPt + dx ), inOuterY = Math.fround( nyPt + dy ), inOuterZ = Math.fround( nzPt + dz )
	positions[0] = innerX; positions[1] = innerY; positions[2] = innerZ
	positions[3] = inOuterX; positions[4] = inOuterY; positions[5] = inOuterZ
	normals[0] = prevNormalX; normals[1] = prevNormalY; normals[2] = prevNormalZ
	normals[3] = prevNormalX; normals[4] = prevNormalY; normals[5] = prevNormalZ
	let minX = Math.min( innerX, inOuterX ), maxX = Math.max( innerX, inOuterX )
	let minY = Math.min( innerY, inOuterY ), maxY = Math.max( innerY, inOuterY )
	let minZ = Math.min( innerZ, inOuterZ ), maxZ = Math.max( innerZ, inOuterZ )

	let indexOffset = segmentCount * 6
	let maxFiniteScale = Math.SQRT2
	let tanX = 0, tanY = 0, tanZ = 0
	let nx = 0, ny = 0, nz = 0
	let c = 0, q = 0

	for (
		let pointIndex = 1, incomingEnd0 = 2, ie0 = 6, pointOffset = 3;
		pointIndex < segmentCount;
		pointIndex++, incomingEnd0 += 4, ie0 += 12, pointOffset += 3, indexOffset += 3
	) {
		nxPt = points[pointOffset + 3]
		nyPt = points[pointOffset + 4]
		nzPt = points[pointOffset + 5]
		dx = Math.abs( nxPt ); dy = Math.abs( nyPt ); dz = Math.abs( nzPt )
		c = dx > dy ? ( dx > dz ? dx : dz ) : ( dy > dz ? dy : dz )
		if ( c > maxMag ) maxMag = c

		dx = nxPt - prevX
		dy = nyPt - prevY
		dz = nzPt - prevZ
		lsSq = dx * dx + dy * dy + dz * dz
		if ( !( lsSq > 1e-300 && lsSq < Infinity ) ) return -1
		curSegLen = Math.sqrt( lsSq )
		if ( curSegLen < minLen ) minLen = curSegLen
		totalLength += curSegLen
		scale = 1 / curSegLen
		outDirX = dx * scale
		outDirY = dy * scale
		outDirZ = dz * scale

		tanX = inDirX + outDirX
		tanY = inDirY + outDirY
		tanZ = inDirZ + outDirZ
		lsSq = tanX * tanX + tanY * tanY + tanZ * tanZ
		if ( lsSq <= epsSq ) return -1
		scale = 1 / Math.sqrt( lsSq )
		tanX *= scale
		tanY *= scale
		tanZ *= scale

		if ( !fixedUp ) {
			c = prevTangentX * tanX + prevTangentY * tanY + prevTangentZ * tanZ
			if ( !( c > -0.999999 ) ) return -1
			q = ( tanX * prevNormalX + tanY * prevNormalY + tanZ * prevNormalZ ) / ( 1 + c )
			dx = prevNormalX - ( prevTangentX + tanX ) * q
			dy = prevNormalY - ( prevTangentY + tanY ) * q
			dz = prevNormalZ - ( prevTangentZ + tanZ ) * q
			c = tanX * dx + tanY * dy + tanZ * dz
			dx -= tanX * c
			dy -= tanY * c
			dz -= tanZ * c
			scale = 1.5 - 0.5 * ( dx * dx + dy * dy + dz * dz )
			nx = dx * scale
			ny = dy * scale
			nz = dz * scale
		} else {
			c = tanX * upX + tanY * upY + tanZ * upZ
			dx = upX - tanX * c
			dy = upY - tanY * c
			dz = upZ - tanZ * c
			lsSq = dx * dx + dy * dy + dz * dz
			if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
			q = Math.sqrt( lsSq )
			scale = ( dx * prevNormalX + dy * prevNormalY + dz * prevNormalZ < 0 ) ? -1 / q : 1 / q
			dx *= scale; dy *= scale; dz *= scale
			c = tanX * dx + tanY * dy + tanZ * dz
			dx -= tanX * c; dy -= tanY * c; dz -= tanZ * c
			lsSq = dx * dx + dy * dy + dz * dz
			if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
			scale = lsSq > 0.999999 && lsSq < 1.000001 ? 1.5 - 0.5 * lsSq : 1 / Math.sqrt( lsSq )
			nx = dx * scale
			ny = dy * scale
			nz = dz * scale
		}
		prevNormalX = nx; prevNormalY = ny; prevNormalZ = nz
		prevTangentX = tanX; prevTangentY = tanY; prevTangentZ = tanZ

		miterX = ny * tanZ - nz * tanY
		miterY = nz * tanX - nx * tanZ
		miterZ = nx * tanY - ny * tanX
		c = tanX * outDirX + tanY * outDirY + tanZ * outDirZ
		q = 0.5 * (
			( outDirX - inDirX ) * miterX +
			( outDirY - inDirY ) * miterY +
			( outDirZ - inDirZ ) * miterZ
		)
		inDirX = outDirX; inDirY = outDirY; inDirZ = outDirZ
		lsSq = c * c + q * q
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
		dz = Math.sqrt( lsSq )
		if ( !( c > EPSILON * dz ) ) return -1
		const invLsC = 1 / ( dz * c )
		const invLs = c * invLsC
		const invC = dz * invLsC
		const cNorm = c * invLs
		const qNorm = q * invLs
		const cosine = cNorm * cNorm - qNorm * qNorm
		const sine = 2 * cNorm * qNorm
		if ( cosine <= REVERSAL_SPLIT_DOT || ( cosine > 0 && Math.abs( sine ) <= 1e-8 ) || cosine < singleSegCos ) return -1
		scale = dz * invC
		if ( scale > 16 || scale <= minVariableScale ) return -1
		dx = Math.abs( q ) * invC * halfWidth
		if ( dx > prevSegLen * safeRatio || dx > curSegLen * safeRatio ) return -1
		prevSegLen = curSegLen
		if ( scale > maxFiniteScale ) maxFiniteScale = scale

		normals[ie0] = nx; normals[ie0 + 1] = ny; normals[ie0 + 2] = nz
		normals[ie0 + 3] = nx; normals[ie0 + 4] = ny; normals[ie0 + 5] = nz
		normals[ie0 + 6] = nx; normals[ie0 + 7] = ny; normals[ie0 + 8] = nz
		normals[ie0 + 9] = nx; normals[ie0 + 10] = ny; normals[ie0 + 11] = nz

		const turnBit = sine > 0 ? 1 : 0
		const innerBias = turnBit * 3
		const outerBias = 3 - innerBias
		const outerWidth = sine > 0 ? -halfWidth : halfWidth
		const innerScale = -outerWidth * scale
		innerX = Math.fround( prevX + miterX * innerScale )
		innerY = Math.fround( prevY + miterY * innerScale )
		innerZ = Math.fround( prevZ + miterZ * innerScale )
		dx = miterX * cNorm; dy = miterY * cNorm; dz = miterZ * cNorm
		const qtX = tanX * qNorm, qtY = tanY * qNorm, qtZ = tanZ * qNorm
		inOuterX = Math.fround( prevX + ( dx + qtX ) * outerWidth )
		inOuterY = Math.fround( prevY + ( dy + qtY ) * outerWidth )
		inOuterZ = Math.fround( prevZ + ( dz + qtZ ) * outerWidth )
		const outOuterX = Math.fround( prevX + ( dx - qtX ) * outerWidth )
		const outOuterY = Math.fround( prevY + ( dy - qtY ) * outerWidth )
		const outOuterZ = Math.fround( prevZ + ( dz - qtZ ) * outerWidth )
		prevX = nxPt; prevY = nyPt; prevZ = nzPt

		const inOutIdx = ie0 + outerBias
		const inInIdx = ie0 + innerBias
		const outOutIdx = ie0 + 6 + outerBias
		const outInIdx = ie0 + 6 + innerBias
		positions[inOutIdx] = inOuterX; positions[inOutIdx + 1] = inOuterY; positions[inOutIdx + 2] = inOuterZ
		positions[inInIdx] = innerX; positions[inInIdx + 1] = innerY; positions[inInIdx + 2] = innerZ
		positions[outOutIdx] = outOuterX; positions[outOutIdx + 1] = outOuterY; positions[outOutIdx + 2] = outOuterZ
		positions[outInIdx] = innerX; positions[outInIdx + 1] = innerY; positions[outInIdx + 2] = innerZ

		minX = Math.min( minX, Math.min( innerX, Math.min( inOuterX, outOuterX ) ) )
		maxX = Math.max( maxX, Math.max( innerX, Math.max( inOuterX, outOuterX ) ) )
		minY = Math.min( minY, Math.min( innerY, Math.min( inOuterY, outOuterY ) ) )
		maxY = Math.max( maxY, Math.max( innerY, Math.max( inOuterY, outOuterY ) ) )
		minZ = Math.min( minZ, Math.min( innerZ, Math.min( inOuterZ, outOuterZ ) ) )
		maxZ = Math.max( maxZ, Math.max( innerZ, Math.max( inOuterZ, outOuterZ ) ) )

		indices[indexOffset] = incomingEnd0 + turnBit
		indices[indexOffset + 1] = incomingEnd0 + outerBias
		indices[indexOffset + 2] = incomingEnd0 + 1 + turnBit
	}

	if ( !fixedUp ) {
		c = prevTangentX * inDirX + prevTangentY * inDirY + prevTangentZ * inDirZ
		if ( !( c > -0.999999 ) ) return -1
		q = ( inDirX * prevNormalX + inDirY * prevNormalY + inDirZ * prevNormalZ ) / ( 1 + c )
		dx = prevNormalX - ( prevTangentX + inDirX ) * q
		dy = prevNormalY - ( prevTangentY + inDirY ) * q
		dz = prevNormalZ - ( prevTangentZ + inDirZ ) * q
		c = inDirX * dx + inDirY * dy + inDirZ * dz
		dx -= inDirX * c; dy -= inDirY * c; dz -= inDirZ * c
		scale = 1.5 - 0.5 * ( dx * dx + dy * dy + dz * dz )
		nx = dx * scale; ny = dy * scale; nz = dz * scale
	} else {
		c = inDirX * upX + inDirY * upY + inDirZ * upZ
		dx = upX - inDirX * c; dy = upY - inDirY * c; dz = upZ - inDirZ * c
		lsSq = dx * dx + dy * dy + dz * dz
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
		q = Math.sqrt( lsSq )
		scale = ( dx * prevNormalX + dy * prevNormalY + dz * prevNormalZ < 0 ) ? -1 / q : 1 / q
		dx *= scale; dy *= scale; dz *= scale
		c = inDirX * dx + inDirY * dy + inDirZ * dz
		dx -= inDirX * c; dy -= inDirY * c; dz -= inDirZ * c
		lsSq = dx * dx + dy * dy + dz * dz
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
		scale = lsSq > 0.999999 && lsSq < 1.000001 ? 1.5 - 0.5 * lsSq : 1 / Math.sqrt( lsSq )
		nx = dx * scale; ny = dy * scale; nz = dz * scale
	}

	miterX = ny * inDirZ - nz * inDirY
	miterY = nz * inDirX - nx * inDirZ
	miterZ = nx * inDirY - ny * inDirX
	lsSq = miterX * miterX + miterY * miterY + miterZ * miterZ
	if ( !( lsSq > epsSq && lsSq < Infinity ) ) return -1
	scale = halfWidth / Math.sqrt( lsSq )
	dx = miterX * scale; dy = miterY * scale; dz = miterZ * scale
	const posBase = ( ( segmentCount - 1 ) * 4 + 2 ) * 3
	innerX = Math.fround( prevX - dx ); innerY = Math.fround( prevY - dy ); innerZ = Math.fround( prevZ - dz )
	inOuterX = Math.fround( prevX + dx ); inOuterY = Math.fround( prevY + dy ); inOuterZ = Math.fround( prevZ + dz )
	positions[posBase] = innerX; positions[posBase + 1] = innerY; positions[posBase + 2] = innerZ
	positions[posBase + 3] = inOuterX; positions[posBase + 4] = inOuterY; positions[posBase + 5] = inOuterZ
	normals[posBase] = nx; normals[posBase + 1] = ny; normals[posBase + 2] = nz
	normals[posBase + 3] = nx; normals[posBase + 4] = ny; normals[posBase + 5] = nz
	minX = Math.min( minX, Math.min( innerX, inOuterX ) ); maxX = Math.max( maxX, Math.max( innerX, inOuterX ) )
	minY = Math.min( minY, Math.min( innerY, inOuterY ) ); maxY = Math.max( maxY, Math.max( innerY, inOuterY ) )
	minZ = Math.min( minZ, Math.min( innerZ, inOuterZ ) ); maxZ = Math.max( maxZ, Math.max( innerZ, inOuterZ ) )

	c = maxMag * Number.EPSILON * 4
	q = c > DUPLICATE_EPSILON ? c : DUPLICATE_EPSILON
	if ( !( maxMag < Infinity && minLen > q && totalLength > 0 && totalLength < Infinity ) ) return -1
	c = maxMag + halfWidth * maxFiniteScale
	if ( !( c <= 1e30 && halfWidth >= c * 2e-6 && ( isFloat32Input || minLen >= maxMag * 1e-5 ) ) ) return -1
	if ( !isFloat32Input && pointCount * 3 === points.length ) assertFloat32PathSegments( points, false, 0 )

	writeTopoBaseQuads(
		indices, 0, positions, normals, null,
		0, segmentCount, false, true, skipTopoBaseQuadWrite
	)

	lastBoundsMinX = minX; lastBoundsMinY = minY; lastBoundsMinZ = minZ
	lastBoundsMaxX = maxX; lastBoundsMaxY = maxY; lastBoundsMaxZ = maxZ
	return totalLength
}

function canDirectUnaliasedFirstJoin( path, frame, maxHalfWidth, join ) {
	if ( path.pointCount < 3 ) return false
	const directions = path.segmentDirections
	const normals = frame.normals
	const tangents = path.tangents
	const inDirX = directions[0], inDirY = directions[1], inDirZ = directions[2]
	const outDirX = directions[3], outDirY = directions[4], outDirZ = directions[5]
	const nx = normals[3], ny = normals[4], nz = normals[5]
	const tx = tangents[3], ty = tangents[4], tz = tangents[5]
	const miterX = ny * tz - nz * ty
	const miterY = nz * tx - nx * tz
	const miterZ = nx * ty - ny * tx
	const c = tx * outDirX + ty * outDirY + tz * outDirZ
	const q = 0.5 * (
		( outDirX - inDirX ) * miterX +
		( outDirY - inDirY ) * miterY +
		( outDirZ - inDirZ ) * miterZ
	)
	const lsSq = c * c + q * q
	if ( !( lsSq > EPSILON * EPSILON && lsSq < Infinity ) ) return false
	const ls = Math.sqrt( lsSq )
	if ( !( c > EPSILON * ls ) ) return false
	const invLsC = 1 / ( ls * c )
	const invLs = c * invLsC
	const invC = ls * invLsC
	const cNorm = c * invLs
	const qNorm = q * invLs
	const cosine = cNorm * cNorm - qNorm * qNorm
	const sine = 2 * cNorm * qNorm
	const absSine = Math.abs( sine )
	const singleSegCos = join.type === 'round' ? Math.cos( Math.PI / join.segments ) + 1e-12 : -2
	if ( cosine <= REVERSAL_SPLIT_DOT || ( cosine > 0 && absSine <= 1e-8 ) || cosine < singleSegCos ) return false
	const scale = ls * invC
	if ( scale > 16 || ( join.type === 'miter' && scale <= join.limit ) ) return false
	const insetLen = Math.abs( q ) * invC * maxHalfWidth
	const segmentLengths = path.segmentLengths
	return insetLen <= segmentLengths[0] * 0.45 && insetLen <= segmentLengths[1] * 0.45
}

function emitDirectStreamVariableLine( line, positions, normals, indices, bounds, skipTopoBaseQuadWrite ) {
	const topo = line.topology
	const path = topo.path
	const frame = topo.frame
	const join = topo.join
	const points = line.points
	const normalsSource = frame.normals
	const tangents = path.tangents
	const directions = path.segmentDirections
	const segmentLengths = path.segmentLengths
	const halfWidths = line.halfWidths
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const maxHalfWidth = topo.maxHalfWidth
	const pointCount = line.pointCount
	const segmentCount = pointCount - 1
	const epsSq = EPSILON * EPSILON
	const safeRatio = 0.45
	const isMiterJoin = join.type === 'miter'
	const joinLimit = join.limit
	const singleSegCos = join.type === 'round' ? Math.cos( Math.PI / join.segments ) + 1e-12 : -2

	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]

	const n0x = normalsSource[0], n0y = normalsSource[1], n0z = normalsSource[2]
	const d0x = directions[0], d0y = directions[1], d0z = directions[2]
	const s0x = n0y * d0z - n0z * d0y
	const s0y = n0z * d0x - n0x * d0z
	const s0z = n0x * d0y - n0y * d0x
	const s0LenSq = s0x * s0x + s0y * s0y + s0z * s0z
	if ( !( s0LenSq > epsSq && s0LenSq < Infinity ) ) {
		throw new Error( '[MeshLineSurfaceGeometry] Surface frame is parallel to a path segment' )
	}
	const w0Scale = ( constantHalfWidth !== null ? constantHalfWidth : halfWidths[0] ) / Math.sqrt( s0LenSq )
	const swx = s0x * w0Scale, swy = s0y * w0Scale, swz = s0z * w0Scale
	const sx = points[0], sy = points[1], sz = points[2]
	const p0x = Math.fround( sx - swx ), p0y = Math.fround( sy - swy ), p0z = Math.fround( sz - swz )
	const p1x = Math.fround( sx + swx ), p1y = Math.fround( sy + swy ), p1z = Math.fround( sz + swz )
	positions[0] = p0x; positions[1] = p0y; positions[2] = p0z
	positions[3] = p1x; positions[4] = p1y; positions[5] = p1z
	normals[0] = n0x; normals[1] = n0y; normals[2] = n0z
	normals[3] = n0x; normals[4] = n0y; normals[5] = n0z
	minX = Math.min( minX, Math.min( p0x, p1x ) ); maxX = Math.max( maxX, Math.max( p0x, p1x ) )
	minY = Math.min( minY, Math.min( p0y, p1y ) ); maxY = Math.max( maxY, Math.max( p0y, p1y ) )
	minZ = Math.min( minZ, Math.min( p0z, p1z ) ); maxZ = Math.max( maxZ, Math.max( p0z, p1z ) )

	const lastSegIndex = segmentCount - 1
	const lastSeg3 = lastSegIndex * 3
	const lastPt3 = ( pointCount - 1 ) * 3
	const nLx = normalsSource[lastPt3], nLy = normalsSource[lastPt3 + 1], nLz = normalsSource[lastPt3 + 2]
	const dLx = directions[lastSeg3], dLy = directions[lastSeg3 + 1], dLz = directions[lastSeg3 + 2]
	const sLx = nLy * dLz - nLz * dLy
	const sLy = nLz * dLx - nLx * dLz
	const sLz = nLx * dLy - nLy * dLx
	const sLLenSq = sLx * sLx + sLy * sLy + sLz * sLz
	if ( !( sLLenSq > epsSq && sLLenSq < Infinity ) ) {
		throw new Error( '[MeshLineSurfaceGeometry] Surface frame is parallel to a path segment' )
	}
	const wLastScale = ( constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointCount - 1] ) / Math.sqrt( sLLenSq )
	const ewx = sLx * wLastScale, ewy = sLy * wLastScale, ewz = sLz * wLastScale
	const ex = points[lastPt3], ey = points[lastPt3 + 1], ez = points[lastPt3 + 2]
	const posBase = ( lastSegIndex * 4 + 2 ) * 3
	const p2x = Math.fround( ex - ewx ), p2y = Math.fround( ey - ewy ), p2z = Math.fround( ez - ewz )
	const p3x = Math.fround( ex + ewx ), p3y = Math.fround( ey + ewy ), p3z = Math.fround( ez + ewz )
	positions[posBase] = p2x; positions[posBase + 1] = p2y; positions[posBase + 2] = p2z
	positions[posBase + 3] = p3x; positions[posBase + 4] = p3y; positions[posBase + 5] = p3z
	normals[posBase] = nLx; normals[posBase + 1] = nLy; normals[posBase + 2] = nLz
	normals[posBase + 3] = nLx; normals[posBase + 4] = nLy; normals[posBase + 5] = nLz
	minX = Math.min( minX, Math.min( p2x, p3x ) ); maxX = Math.max( maxX, Math.max( p2x, p3x ) )
	minY = Math.min( minY, Math.min( p2y, p3y ) ); maxY = Math.max( maxY, Math.max( p2y, p3y ) )
	minZ = Math.min( minZ, Math.min( p2z, p3z ) ); maxZ = Math.max( maxZ, Math.max( p2z, p3z ) )

	let indexOffset = segmentCount * 6

	let inDirX = d0x, inDirY = d0y, inDirZ = d0z
	let prevSegLen = segmentLengths[0]
	let maxFiniteScale = Math.SQRT2

	for (
		let pointIndex = 1, incomingEnd0 = 2, ie0 = 6, pointOffset = 3;
		pointIndex < pointCount - 1;
		pointIndex++, incomingEnd0 += 4, ie0 += 12, pointOffset += 3, indexOffset += 3
	) {
		const outDirX = directions[pointOffset]
		const outDirY = directions[pointOffset + 1]
		const outDirZ = directions[pointOffset + 2]
		const curSegLen = segmentLengths[pointIndex]
		const nx = normalsSource[pointOffset]
		const ny = normalsSource[pointOffset + 1]
		const nz = normalsSource[pointOffset + 2]
		const tanX = tangents[pointOffset]
		const tanY = tangents[pointOffset + 1]
		const tanZ = tangents[pointOffset + 2]
		const miterX = ny * tanZ - nz * tanY
		const miterY = nz * tanX - nx * tanZ
		const miterZ = nx * tanY - ny * tanX

		const c = tanX * outDirX + tanY * outDirY + tanZ * outDirZ
		const q = 0.5 * (
			( outDirX - inDirX ) * miterX +
			( outDirY - inDirY ) * miterY +
			( outDirZ - inDirZ ) * miterZ
		)
		inDirX = outDirX; inDirY = outDirY; inDirZ = outDirZ
		const lsSq = c * c + q * q
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) {
			throw new Error( '[MeshLineSurfaceGeometry] Surface frame is parallel to a path segment' )
		}
		const ls = Math.sqrt( lsSq )
		if ( !( c > EPSILON * ls ) ) return -1
		const invLsC = 1 / ( ls * c )
		const invLs = c * invLsC
		const invC = ls * invLsC
		const cNorm = c * invLs
		const qNorm = q * invLs
		const cosine = cNorm * cNorm - qNorm * qNorm
		const sine = 2 * cNorm * qNorm
		const absSine = Math.abs( sine )
		if ( cosine <= REVERSAL_SPLIT_DOT || ( cosine > 0 && absSine <= 1e-8 ) || cosine < singleSegCos ) return -1
		const scale = ls * invC
		if ( scale > 16 || ( isMiterJoin && scale <= joinLimit ) ) return -1
		const insetLen = Math.abs( q ) * invC * maxHalfWidth
		if ( insetLen > prevSegLen * safeRatio || insetLen > curSegLen * safeRatio ) return -1
		prevSegLen = curSegLen
		if ( scale > maxFiniteScale ) maxFiniteScale = scale

		const cmX = miterX * cNorm
		const cmY = miterY * cNorm
		const cmZ = miterZ * cNorm
		const qtX = tanX * qNorm
		const qtY = tanY * qNorm
		const qtZ = tanZ * qNorm

		const centerX = points[pointOffset]
		const centerY = points[pointOffset + 1]
		const centerZ = points[pointOffset + 2]
		normals[ie0] = nx; normals[ie0 + 1] = ny; normals[ie0 + 2] = nz
		normals[ie0 + 3] = nx; normals[ie0 + 4] = ny; normals[ie0 + 5] = nz
		normals[ie0 + 6] = nx; normals[ie0 + 7] = ny; normals[ie0 + 8] = nz
		normals[ie0 + 9] = nx; normals[ie0 + 10] = ny; normals[ie0 + 11] = nz

		const width = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointIndex]
		const positiveTurn = sine > 0
		const turnBit = positiveTurn ? 1 : 0
		const innerBias = turnBit * 3
		const outerBias = 3 - innerBias
		const outerWidth = positiveTurn ? -width : width
		const innerScale = -outerWidth * scale
		const innerX = Math.fround( centerX + miterX * innerScale )
		const innerY = Math.fround( centerY + miterY * innerScale )
		const innerZ = Math.fround( centerZ + miterZ * innerScale )
		const inOuterX = Math.fround( centerX + ( cmX + qtX ) * outerWidth )
		const inOuterY = Math.fround( centerY + ( cmY + qtY ) * outerWidth )
		const inOuterZ = Math.fround( centerZ + ( cmZ + qtZ ) * outerWidth )
		const outOuterX = Math.fround( centerX + ( cmX - qtX ) * outerWidth )
		const outOuterY = Math.fround( centerY + ( cmY - qtY ) * outerWidth )
		const outOuterZ = Math.fround( centerZ + ( cmZ - qtZ ) * outerWidth )

		const inOutIdx = ie0 + outerBias
		const inInIdx = ie0 + innerBias
		const outOutIdx = ie0 + 6 + outerBias
		const outInIdx = ie0 + 6 + innerBias
		positions[inOutIdx] = inOuterX; positions[inOutIdx + 1] = inOuterY; positions[inOutIdx + 2] = inOuterZ
		positions[inInIdx] = innerX; positions[inInIdx + 1] = innerY; positions[inInIdx + 2] = innerZ
		positions[outOutIdx] = outOuterX; positions[outOutIdx + 1] = outOuterY; positions[outOutIdx + 2] = outOuterZ
		positions[outInIdx] = innerX; positions[outInIdx + 1] = innerY; positions[outInIdx + 2] = innerZ

		minX = Math.min( minX, Math.min( innerX, Math.min( inOuterX, outOuterX ) ) )
		maxX = Math.max( maxX, Math.max( innerX, Math.max( inOuterX, outOuterX ) ) )
		minY = Math.min( minY, Math.min( innerY, Math.min( inOuterY, outOuterY ) ) )
		maxY = Math.max( maxY, Math.max( innerY, Math.max( inOuterY, outOuterY ) ) )
		minZ = Math.min( minZ, Math.min( innerZ, Math.min( inOuterZ, outOuterZ ) ) )
		maxZ = Math.max( maxZ, Math.max( innerZ, Math.max( inOuterZ, outOuterZ ) ) )

		indices[indexOffset] = incomingEnd0 + turnBit
		indices[indexOffset + 1] = incomingEnd0 + outerBias
		indices[indexOffset + 2] = incomingEnd0 + 1 + turnBit
	}

	const maxVertexMag = topo.maxCoordMagnitude + maxHalfWidth * maxFiniteScale
	if ( !( maxVertexMag <= 1e30 && topo.minHalfWidth >= maxVertexMag * 2e-6 ) ) return -1
	if ( !line.isFloat32Input ) assertFloat32PathSegments( points, false, 0 )

	writeTopoBaseQuads(
		indices, 0, positions, normals, null,
		0, segmentCount, false, true, skipTopoBaseQuadWrite
	)

	lastBoundsMinX = minX; lastBoundsMinY = minY; lastBoundsMinZ = minZ
	lastBoundsMaxX = maxX; lastBoundsMaxY = maxY; lastBoundsMaxZ = maxZ
	return indexOffset
}

function materializeDirectStreamFallback( line, lineIndex, options ) {
	const topo = line.topology
	const { path, frame, topologyNeeds, minHalfWidth, maxHalfWidth, maxCoordMagnitude } = topo
	const joinData = computeJoinInfos( path, frame, maxHalfWidth, options.join )
	const innerFactors = resolveInnerJoinFootprints( path, joinData, line.halfWidths, maxHalfWidth, options.join, lineIndex )
	const topologyMode = getVariableTopologyMode( path, options.join, options.cap )
	let offsets = null
	if ( topologyMode !== 'full' ) {
		offsets = computeOffsets( path, frame, joinData, true )
	}
	const maxVertexMag = maxCoordMagnitude + maxHalfWidth * lastJoinMaxFiniteScale
	const fastFloat32Safe = minHalfWidth > 0 && maxVertexMag <= 1e30 && minHalfWidth >= maxVertexMag * 2e-6 &&
		( line.isFloat32Input || path.minSegmentLength >= maxCoordMagnitude * 1e-5 )
	const fastCanonicalQuads = fastFloat32Safe &&
		!path.hasCusps &&
		!lastJoinHasSplit &&
		!lastFootprintClipped &&
		lastFootprintCanonicalSafe &&
		lastJoinMaxScale <= 16 &&
		( typeof options.surface.bank === 'number' || options.surface.bank == null )
	line.fastFloat32Safe = fastFloat32Safe
	line.fastCanonicalQuads = fastCanonicalQuads
	line.offsets = offsets
	if ( topologyMode === 'full' ) {
		if ( fastCanonicalQuads && !lastJoinHasMultiSegRound ) {
			const segmentCount = path.segmentCount
			const lastSegOffset = ( segmentCount - 1 ) * 3
			writeSegmentSide( joinScratch.segmentStartSides, 0, frame.normals, 0, path.segmentDirections, 0 )
			writeSegmentSide( joinScratch.segmentEndSides, lastSegOffset, frame.normals, ( path.pointCount - 1 ) * 3, path.segmentDirections, lastSegOffset )
			const aliasedCount = lastJoinHasAliased ? lastJoinAliasedCount : 0
			line.topology = {
				directUnaliased: true,
				hasAliases: lastJoinHasAliased,
				joinType: options.join.type,
				joinLimit: options.join.limit,
				joinData,
				innerFactors,
				positions: null,
				normals: null,
				tangents: null,
				uvs: null,
				progress: null,
				sides: null,
				extraIndices: null,
				extraIndexCount: 0,
				pairVertices: null,
				vertexCount: segmentCount * 4 - aliasedCount * 2,
				indexCount: segmentCount * 6 + ( path.pointCount - 2 - aliasedCount ) * 3,
				seamPair: null,
			}
		} else {
			line.topology = buildVariableTopology( path, frame, line.halfWidths, options.surface, options.join, options.cap, topologyNeeds, innerFactors, joinData, true )
		}
	} else {
		line.topology = null
	}
	line.capTopology = topologyMode === 'caps'
		? buildCompactCapTopology( path, frame, offsets, line.halfWidths, options.surface, options.cap, topologyNeeds, true )
		: null
}

function emitVariableTopologyLine(
	line, lineIndex, vertexStart, indexOffset,
	positions, normals, tangents, uvs, progress, sides, indices, bounds, trackChanges, skipTopoBaseQuadWrite = false
) {
	const topo = line.topology
	if ( topo.directUnaliased ) {
		if ( trackChanges ) indexWriteChanged = true
		const nextOffset = topo.hasAliases
			? emitDirectAliasedVariableLine( line, positions, normals, indices, bounds )
			: emitDirectUnaliasedVariableLine( line, positions, normals, indices, bounds, false, skipTopoBaseQuadWrite )
		bounds[0] = lastBoundsMinX; bounds[1] = lastBoundsMinY; bounds[2] = lastBoundsMinZ
		bounds[3] = lastBoundsMaxX; bounds[4] = lastBoundsMaxY; bounds[5] = lastBoundsMaxZ
		return nextOffset
	}
	const lineVertexCount = topo.vertexCount
	const halfWidths = line.halfWidths
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const pointCount = line.pointCount
	const segmentCount = line.closed ? pointCount : pointCount - 1

	normals.set( topo.normals.subarray( 0, lineVertexCount * 3 ), vertexStart * 3 )
	copyTopoPositionsAndBounds( positions, topo.positions, vertexStart, lineVertexCount, lineIndex, bounds, line.fastFloat32Safe )
	if ( tangents ) copyTopoTangents( tangents, topo.tangents, vertexStart, lineVertexCount )
	if ( uvs ) copyTopoUvs( uvs, topo.uvs, vertexStart, lineVertexCount, lineIndex, line.fastUvSafe )
	if ( progress ) progress.set( topo.progress.subarray( 0, lineVertexCount ), vertexStart )
	if ( sides ) sides.set( topo.sides.subarray( 0, lineVertexCount ), vertexStart )

	if ( !line.fastFloat32Safe ) {
		validateTopoRows(
			positions, topo.positions, topo.pairVertices,
			halfWidths, constantHalfWidth, vertexStart, pointCount, segmentCount, lineIndex
		)
	}
	if ( !line.isFloat32Input ) assertFloat32PathSegments( line.points, line.closed, lineIndex )

	indexOffset = writeTopoBaseQuads(
		indices, indexOffset, positions, normals, topo.pairVertices,
		vertexStart, segmentCount, trackChanges, line.fastCanonicalQuads, skipTopoBaseQuadWrite
	)
	return writeTopoExtraIndices(
		indices, indexOffset, positions, normals, topo.extraIndices, topo.extraIndexCount,
		vertexStart, trackChanges && !indexWriteChanged, line.fastCanonicalQuads
	)
}

function emitCompactRows( line, lineIndex, vertexStart, positions, normals, tangents, uvs, progress, sides, bounds ) {
	const linePoints = line.points
	const lineOffsets = line.offsets
	const lineNormals = line.normals
	const halfWidths = line.halfWidths
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const pointCount = line.pointCount
	const rowCount = line.rowCount
	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]

	if ( line.fastFloat32Safe && !tangents && !uvs && !progress && !sides ) {
		for ( let row = 0; row < rowCount; row++ ) {
			const sourceIndex = row === pointCount ? 0 : row
			const pointOffset = sourceIndex * 3
			const centerX = linePoints[pointOffset]
			const centerY = linePoints[pointOffset + 1]
			const centerZ = linePoints[pointOffset + 2]
			const halfWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[sourceIndex]
			const ox = lineOffsets[pointOffset] * halfWidth
			const oy = lineOffsets[pointOffset + 1] * halfWidth
			const oz = lineOffsets[pointOffset + 2] * halfWidth
			const leftPosition = ( vertexStart + row * 2 ) * 3
			const rightPosition = leftPosition + 3

			const lpx = Math.fround( centerX - ox )
			const lpy = Math.fround( centerY - oy )
			const lpz = Math.fround( centerZ - oz )
			const rpx = Math.fround( centerX + ox )
			const rpy = Math.fround( centerY + oy )
			const rpz = Math.fround( centerZ + oz )
			positions[leftPosition] = lpx
			positions[leftPosition + 1] = lpy
			positions[leftPosition + 2] = lpz
			positions[rightPosition] = rpx
			positions[rightPosition + 1] = rpy
			positions[rightPosition + 2] = rpz

			minX = Math.min( minX, Math.min( lpx, rpx ) )
			maxX = Math.max( maxX, Math.max( lpx, rpx ) )
			minY = Math.min( minY, Math.min( lpy, rpy ) )
			maxY = Math.max( maxY, Math.max( lpy, rpy ) )
			minZ = Math.min( minZ, Math.min( lpz, rpz ) )
			maxZ = Math.max( maxZ, Math.max( lpz, rpz ) )

			const nx = lineNormals[pointOffset]
			const ny = lineNormals[pointOffset + 1]
			const nz = lineNormals[pointOffset + 2]
			normals[leftPosition] = nx
			normals[leftPosition + 1] = ny
			normals[leftPosition + 2] = nz
			normals[rightPosition] = nx
			normals[rightPosition + 1] = ny
			normals[rightPosition + 2] = nz
		}
		lastBoundsMinX = minX; lastBoundsMinY = minY; lastBoundsMinZ = minZ
		lastBoundsMaxX = maxX; lastBoundsMaxY = maxY; lastBoundsMaxZ = maxZ
		return
	}

	const lineTangents = line.tangents
	const lineProgress = line.progress
	const lineDistances = line.distances
	const stretchUV = line.uvMode === 'stretch'
	const invUvScale = 1 / line.uvScale
	const fastFloat32Safe = line.fastFloat32Safe
	const fastUvSafe = line.fastUvSafe

	for ( let row = 0; row < rowCount; row++ ) {
		const sourceIndex = row === pointCount ? 0 : row
		const pointOffset = sourceIndex * 3
		const centerX = linePoints[pointOffset]
		const centerY = linePoints[pointOffset + 1]
		const centerZ = linePoints[pointOffset + 2]
		const offsetX = lineOffsets[pointOffset]
		const offsetY = lineOffsets[pointOffset + 1]
		const offsetZ = lineOffsets[pointOffset + 2]
		const halfWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[sourceIndex]
		const vertex = vertexStart + row * 2
		const leftPosition = vertex * 3
		const rightPosition = leftPosition + 3
		const leftX = centerX - offsetX * halfWidth
		const leftY = centerY - offsetY * halfWidth
		const leftZ = centerZ - offsetZ * halfWidth
		const rightX = centerX + offsetX * halfWidth
		const rightY = centerY + offsetY * halfWidth
		const rightZ = centerZ + offsetZ * halfWidth

		positions[leftPosition] = leftX
		positions[leftPosition + 1] = leftY
		positions[leftPosition + 2] = leftZ
		positions[rightPosition] = rightX
		positions[rightPosition + 1] = rightY
		positions[rightPosition + 2] = rightZ
		const lpx = positions[leftPosition]
		const lpy = positions[leftPosition + 1]
		const lpz = positions[leftPosition + 2]
		const rpx = positions[rightPosition]
		const rpy = positions[rightPosition + 1]
		const rpz = positions[rightPosition + 2]
		if ( !fastFloat32Safe ) {
			assertRepresentableSurfaceRow(
				positions, leftPosition, rightPosition,
				leftX, leftY, leftZ, rightX, rightY, rightZ,
				halfWidth, lineIndex, row
			)
		}

		minX = Math.min( minX, Math.min( lpx, rpx ) )
		maxX = Math.max( maxX, Math.max( lpx, rpx ) )
		minY = Math.min( minY, Math.min( lpy, rpy ) )
		maxY = Math.max( maxY, Math.max( lpy, rpy ) )
		minZ = Math.min( minZ, Math.min( lpz, rpz ) )
		maxZ = Math.max( maxZ, Math.max( lpz, rpz ) )

		const nx = lineNormals[pointOffset]
		const ny = lineNormals[pointOffset + 1]
		const nz = lineNormals[pointOffset + 2]
		normals[leftPosition] = nx
		normals[leftPosition + 1] = ny
		normals[leftPosition + 2] = nz
		normals[rightPosition] = nx
		normals[rightPosition + 1] = ny
		normals[rightPosition + 2] = nz

		if ( tangents ) writePair4( tangents, vertex, lineTangents[pointOffset], lineTangents[pointOffset + 1], lineTangents[pointOffset + 2], 1 )
		if ( uvs ) {
			const u = row === pointCount
				? line.seamU
				: ( stretchUV ? lineProgress[sourceIndex] : lineDistances[sourceIndex] * invUvScale )
			if ( !fastUvSafe && !( u <= 3.4028234663852886e+38 && u >= -3.4028234663852886e+38 ) ) {
				throw new Error( `[MeshLineSurfaceGeometry] UV overflow at row ${row} of line ${lineIndex}; increase surface.uvScale` )
			}
			const uvo = vertex * 2
			uvs[uvo] = u
			uvs[uvo + 1] = 0
			uvs[uvo + 2] = u
			uvs[uvo + 3] = 1
		}
		if ( progress ) {
			const rowProgress = row === pointCount ? 1 : lineProgress[sourceIndex]
			progress[vertex] = rowProgress
			progress[vertex + 1] = rowProgress
		}
		if ( sides ) {
			sides[vertex] = -1
			sides[vertex + 1] = 1
		}
	}
	lastBoundsMinX = minX; lastBoundsMinY = minY; lastBoundsMinZ = minZ
	lastBoundsMaxX = maxX; lastBoundsMaxY = maxY; lastBoundsMaxZ = maxZ
}

function writeCompactIndices( indices, indexOffset, positions, normals, vertexStart, rowCount, trackChanges, fastCanonicalQuads, skipWrite ) {
	if ( rowCount < 2 ) return indexOffset
	const segmentCount = rowCount - 1
	if ( skipWrite ) return indexOffset + segmentCount * 6
	if ( fastCanonicalQuads ) {
		if ( !trackChanges ) {
			if ( vertexStart === 0 ) {
				indices.set( getCompactIndexTemplate( indices instanceof Uint32Array, segmentCount ), indexOffset )
				return indexOffset + segmentCount * 6
			}
			for ( let segment = 0, left0 = vertexStart; segment < segmentCount; segment++, left0 += 2, indexOffset += 6 ) {
				const right0 = left0 + 1
				const left1 = left0 + 2
				indices[indexOffset] = left0
				indices[indexOffset + 1] = left1
				indices[indexOffset + 2] = right0
				indices[indexOffset + 3] = right0
				indices[indexOffset + 4] = left1
				indices[indexOffset + 5] = left0 + 3
			}
			return indexOffset
		}
		let changed = 0
		for ( let segment = 0, left0 = vertexStart; segment < segmentCount; segment++, left0 += 2, indexOffset += 6 ) {
			const right0 = left0 + 1
			const left1 = left0 + 2
			const right1 = left0 + 3
			changed |= ( indices[indexOffset] ^ left0 ) | ( indices[indexOffset + 1] ^ left1 ) | ( indices[indexOffset + 2] ^ right0 ) |
				( indices[indexOffset + 3] ^ right0 ) | ( indices[indexOffset + 4] ^ left1 ) | ( indices[indexOffset + 5] ^ right1 )
			indices[indexOffset] = left0
			indices[indexOffset + 1] = left1
			indices[indexOffset + 2] = right0
			indices[indexOffset + 3] = right0
			indices[indexOffset + 4] = left1
			indices[indexOffset + 5] = right1
		}
		if ( changed !== 0 ) indexWriteChanged = true
		return indexOffset
	}
	let left0 = vertexStart
	let right0 = left0 + 1
	let pOffset = left0 * 3
	let l0x = positions[pOffset], l0y = positions[pOffset + 1], l0z = positions[pOffset + 2]
	let r0x = positions[pOffset + 3], r0y = positions[pOffset + 4], r0z = positions[pOffset + 5]
	let n0x = normals[pOffset], n0y = normals[pOffset + 1], n0z = normals[pOffset + 2]
	let changed = 0
	for ( let segment = 0; segment < segmentCount; segment++ ) {
		const left1 = left0 + 2
		const right1 = left0 + 3
		pOffset += 6
		const l1x = positions[pOffset], l1y = positions[pOffset + 1], l1z = positions[pOffset + 2]
		const r1x = positions[pOffset + 3], r1y = positions[pOffset + 4], r1z = positions[pOffset + 5]
		const n1x = normals[pOffset], n1y = normals[pOffset + 1], n1z = normals[pOffset + 2]
		let enx = n0x + n1x
		let eny = n0y + n1y
		let enz = n0z + n1z
		if ( enx * enx + eny * eny + enz * enz <= EPSILON * EPSILON ) {
			enx = n0x
			eny = n0y
			enz = n0z
		}
		const ab1x = l1x - l0x, ab1y = l1y - l0y, ab1z = l1z - l0z
		const ac1x = r0x - l0x, ac1y = r0y - l0y, ac1z = r0z - l0z
		const fn1x = ab1y * ac1z - ab1z * ac1y
		const fn1y = ab1z * ac1x - ab1x * ac1z
		const fn1z = ab1x * ac1y - ab1y * ac1x
		const flip1 = fn1x * enx + fn1y * eny + fn1z * enz < 0
		const s1 = flip1 ? right0 : left1
		const t1 = flip1 ? left1 : right0

		const ab2x = l1x - r0x, ab2y = l1y - r0y, ab2z = l1z - r0z
		const ac2x = r1x - r0x, ac2y = r1y - r0y, ac2z = r1z - r0z
		const fn2x = ab2y * ac2z - ab2z * ac2y
		const fn2y = ab2z * ac2x - ab2x * ac2z
		const fn2z = ab2x * ac2y - ab2y * ac2x
		const flip2 = fn2x * enx + fn2y * eny + fn2z * enz < 0
		const s2 = flip2 ? right1 : left1
		const t2 = flip2 ? left1 : right1

		if ( trackChanges ) {
			changed |= ( indices[indexOffset] ^ left0 ) | ( indices[indexOffset + 1] ^ s1 ) | ( indices[indexOffset + 2] ^ t1 ) |
				( indices[indexOffset + 3] ^ right0 ) | ( indices[indexOffset + 4] ^ s2 ) | ( indices[indexOffset + 5] ^ t2 )
		}
		indices[indexOffset] = left0
		indices[indexOffset + 1] = s1
		indices[indexOffset + 2] = t1
		indices[indexOffset + 3] = right0
		indices[indexOffset + 4] = s2
		indices[indexOffset + 5] = t2
		indexOffset += 6

		left0 = left1
		right0 = right1
		l0x = l1x; l0y = l1y; l0z = l1z
		r0x = r1x; r0y = r1y; r0z = r1z
		n0x = n1x; n0y = n1y; n0z = n1z
	}
	if ( changed !== 0 ) indexWriteChanged = true
	return indexOffset
}

function emitCompactCaps(
	capTopology, lineIndex, vertexStart, bodyVertexCount,
	positions, normals, tangents, uvs, progress, sides, indices, indexOffset, bounds, trackChanges, fastCanonicalQuads = false
) {
	const capVertexCount = capTopology.vertexCount
	const capPositions = capTopology.positions
	const capNormals = capTopology.normals
	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]
	for ( let extraVertex = 0, source3 = 0, vertex = vertexStart + bodyVertexCount; extraVertex < capVertexCount; extraVertex++, source3 += 3, vertex++ ) {
		const target3 = vertex * 3
		const px = Math.fround( capPositions[source3] )
		const py = Math.fround( capPositions[source3 + 1] )
		const pz = Math.fround( capPositions[source3 + 2] )
		positions[target3] = px
		positions[target3 + 1] = py
		positions[target3 + 2] = pz
		if ( !( px - px === 0 && py - py === 0 && pz - pz === 0 ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Position overflow at cap vertex ${extraVertex} of line ${lineIndex}` )
		}
		normals[target3] = capNormals[source3]
		normals[target3 + 1] = capNormals[source3 + 1]
		normals[target3 + 2] = capNormals[source3 + 2]
		if ( tangents ) {
			const target4 = vertex * 4
			tangents[target4] = capTopology.tangents[source3]
			tangents[target4 + 1] = capTopology.tangents[source3 + 1]
			tangents[target4 + 2] = capTopology.tangents[source3 + 2]
			tangents[target4 + 3] = 1
		}
		if ( uvs ) {
			const target2 = vertex * 2
			const source2 = extraVertex * 2
			const u = capTopology.uvs[source2]
			if ( !Number.isFinite( Math.fround( u ) ) ) {
				throw new Error( `[MeshLineSurfaceGeometry] UV overflow at cap vertex ${extraVertex} of line ${lineIndex}; increase surface.uvScale` )
			}
			uvs[target2] = u
			uvs[target2 + 1] = capTopology.uvs[source2 + 1]
		}
		if ( progress ) progress[vertex] = capTopology.progress[extraVertex]
		if ( sides ) sides[vertex] = capTopology.sides[extraVertex]
		minX = Math.min( minX, px )
		maxX = Math.max( maxX, px )
		minY = Math.min( minY, py )
		maxY = Math.max( maxY, py )
		minZ = Math.min( minZ, pz )
		maxZ = Math.max( maxZ, pz )
	}
	bounds[0] = minX; bounds[1] = minY; bounds[2] = minZ
	bounds[3] = maxX; bounds[4] = maxY; bounds[5] = maxZ

	return writeTopoExtraIndices(
		indices, indexOffset, positions, normals,
		capTopology.indices, capTopology.indexCount, vertexStart, trackChanges, fastCanonicalQuads
	)
}

function emitCompactStripLine(
	line, lineIndex, vertexStart, indexOffset,
	positions, normals, tangents, uvs, progress, sides, indices, bounds, trackChanges, skipCompactIndexWrite = false
) {
	emitCompactRows( line, lineIndex, vertexStart, positions, normals, tangents, uvs, progress, sides, bounds )
	bounds[0] = lastBoundsMinX; bounds[1] = lastBoundsMinY; bounds[2] = lastBoundsMinZ
	bounds[3] = lastBoundsMaxX; bounds[4] = lastBoundsMaxY; bounds[5] = lastBoundsMaxZ
	indexOffset = writeCompactIndices( indices, indexOffset, positions, normals, vertexStart, line.rowCount, trackChanges, line.fastCanonicalQuads, skipCompactIndexWrite )
	if ( line.capTopology ) {
		indexOffset = emitCompactCaps(
			line.capTopology, lineIndex, vertexStart, line.rowCount * 2,
			positions, normals, tangents, uvs, progress, sides, indices, indexOffset, bounds,
			trackChanges && !indexWriteChanged, line.fastCanonicalQuads
		)
	}
	if ( !line.isFloat32Input ) assertFloat32PathSegments( line.points, line.closed, lineIndex )
	return indexOffset
}

function buildSurfaceLine( line, lineIndex, options, usePooledLineArrays = false ) {
	const topologyNeeds = {
		tangents: !!( options.needsTangents || options.surface.normalMap ),
		uvs: !!(
			options.needsUV || options.map || options.alphaMap || options.surface.normalMap ||
			options.surface.roughnessMap || options.surface.metalnessMap
		),
		progress: !!options.needsProgress,
		sides: !!options.needsSide,
	}
	const needsProgressArray = !!(
		topologyNeeds.progress ||
		( topologyNeeds.uvs && options.surface.uvMode === 'stretch' ) ||
		( line.closed && options.surface.frame !== 'fixed-up' ) ||
		typeof options.surface.bank === 'function' ||
		typeof options.widthCallback === 'function'
	)
	const needsDistancesArray = !!(
		needsProgressArray ||
		( topologyNeeds.uvs && options.surface.uvMode === 'distance' )
	)
	let path = computePathData( line.points, line.closed, usePooledLineArrays, needsDistancesArray, needsProgressArray, line.maxCoordMagnitude < 0 )
	if ( !path ) {
		const prepared = prepareLine( line.points, line.closed, lineIndex )
		line.points = prepared.points
		line.maxCoordMagnitude = prepared.maxCoordMagnitude
		path = computePathData( line.points, line.closed, usePooledLineArrays, needsDistancesArray, needsProgressArray, false )
	} else if ( line.maxCoordMagnitude < 0 ) {
		line.maxCoordMagnitude = lastMaxCoordMagnitude
	}
	const { points, closed, isFloat32Input, maxCoordMagnitude } = line
	const pointCount = path.pointCount
	const frame = computeFrames( path, options.surface, lineIndex, usePooledLineArrays )
	const halfWidths = computeHalfWidths( path.progress, options, lineIndex, pointCount, usePooledLineArrays )
	const minHalfWidth = typeof halfWidths === 'number' ? halfWidths : lastMinHalfWidth
	const maxHalfWidth = typeof halfWidths === 'number' ? halfWidths : lastMaxHalfWidth
	let offsets = options.join.type === 'miter' && !path.hasCusps
		? computeCompactMiterOffsets( path, frame, maxHalfWidth, options.join.limit, usePooledLineArrays )
		: null
	let joinData = null
	let innerFactors = null
	let topologyMode = null
	let directStream = false
	if ( offsets ) {
		topologyMode = !path.closed && options.cap.type !== 'butt' ? 'caps' : null
	} else if (
		usePooledLineArrays &&
		!path.closed &&
		!path.hasCusps &&
		options.cap.type === 'butt' &&
		!topologyNeeds.tangents &&
		!topologyNeeds.uvs &&
		!topologyNeeds.progress &&
		!topologyNeeds.sides &&
		( typeof options.surface.bank === 'number' || options.surface.bank == null ) &&
		minHalfWidth > 0 &&
		( isFloat32Input || path.minSegmentLength >= maxCoordMagnitude * 1e-5 ) &&
		canDirectUnaliasedFirstJoin( path, frame, maxHalfWidth, options.join )
	) {
		directStream = true
		topologyMode = 'full'
		lastJoinHasSplit = false
		lastJoinHasAliased = false
		lastJoinHasMultiSegRound = false
		lastFootprintClipped = false
		lastFootprintCanonicalSafe = true
		lastJoinMaxScale = 1
		lastJoinMaxFiniteScale = Math.SQRT2
	} else {
		joinData = computeJoinInfos( path, frame, maxHalfWidth, options.join )
		innerFactors = resolveInnerJoinFootprints( path, joinData, halfWidths, maxHalfWidth, options.join, lineIndex )
		topologyMode = getVariableTopologyMode( path, options.join, options.cap )
		if ( topologyMode !== 'full' ) {
			offsets = computeOffsets( path, frame, joinData, usePooledLineArrays )
		}
	}
	const maxVertexMag = maxCoordMagnitude + maxHalfWidth * lastJoinMaxFiniteScale
	const fastFloat32Safe = minHalfWidth > 0 && maxVertexMag <= 1e30 && minHalfWidth >= maxVertexMag * 2e-6 &&
		( isFloat32Input || path.minSegmentLength >= maxCoordMagnitude * 1e-5 )
	const maxUv = options.surface.uvMode === 'stretch' ? 1 : ( path.totalLength + maxHalfWidth ) / options.surface.uvScale
	const fastUvSafe = maxUv <= 3.4028234663852886e+38 && maxUv >= -3.4028234663852886e+38
	const fastCanonicalQuads = fastFloat32Safe &&
		!path.hasCusps &&
		!lastJoinHasSplit &&
		!lastFootprintClipped &&
		lastFootprintCanonicalSafe &&
		lastJoinMaxScale <= 16 &&
		( typeof options.surface.bank === 'number' || options.surface.bank == null )

	let topology = null
	if ( topologyMode === 'full' ) {
		if ( directStream && fastCanonicalQuads ) {
			const segmentCount = path.segmentCount
			topology = {
				directUnaliased: true,
				directStream: true,
				path,
				frame,
				join: options.join,
				topologyNeeds,
				minHalfWidth,
				maxHalfWidth,
				maxCoordMagnitude,
				positions: null,
				normals: null,
				tangents: null,
				uvs: null,
				progress: null,
				sides: null,
				extraIndices: null,
				extraIndexCount: 0,
				pairVertices: null,
				vertexCount: segmentCount * 4,
				indexCount: segmentCount * 6 + ( pointCount - 2 ) * 3,
				seamPair: null,
			}
		} else if (
			usePooledLineArrays &&
			fastCanonicalQuads &&
			!path.closed &&
			options.cap.type === 'butt' &&
			!lastJoinHasMultiSegRound &&
			!topologyNeeds.tangents &&
			!topologyNeeds.uvs &&
			!topologyNeeds.progress &&
			!topologyNeeds.sides
		) {
			const segmentCount = path.segmentCount
			const lastSegOffset = ( segmentCount - 1 ) * 3
			writeSegmentSide( joinScratch.segmentStartSides, 0, frame.normals, 0, path.segmentDirections, 0 )
			writeSegmentSide( joinScratch.segmentEndSides, lastSegOffset, frame.normals, ( pointCount - 1 ) * 3, path.segmentDirections, lastSegOffset )
			const aliasedCount = lastJoinHasAliased ? lastJoinAliasedCount : 0
			topology = {
				directUnaliased: true,
				hasAliases: lastJoinHasAliased,
				joinType: options.join.type,
				joinLimit: options.join.limit,
				joinData,
				innerFactors,
				positions: null,
				normals: null,
				tangents: null,
				uvs: null,
				progress: null,
				sides: null,
				extraIndices: null,
				extraIndexCount: 0,
				pairVertices: null,
				vertexCount: segmentCount * 4 - aliasedCount * 2,
				indexCount: segmentCount * 6 + ( pointCount - 2 - aliasedCount ) * 3,
				seamPair: null,
			}
		} else {
			topology = buildVariableTopology( path, frame, halfWidths, options.surface, options.join, options.cap, topologyNeeds, innerFactors, joinData, usePooledLineArrays )
		}
	}
	const capTopology = topologyMode === 'caps'
		? buildCompactCapTopology( path, frame, offsets, halfWidths, options.surface, options.cap, topologyNeeds, usePooledLineArrays )
		: null

	return {
		points,
		closed,
		isFloat32Input,
		fastFloat32Safe,
		fastUvSafe,
		fastCanonicalQuads,
		pointCount,
		rowCount: pointCount + ( closed ? 1 : 0 ),
		totalLength: path.totalLength,
		progress: path.progress,
		distances: path.distances,
		uvMode: options.surface.uvMode,
		uvScale: options.surface.uvScale,
		seamU: options.surface.uvMode === 'stretch' ? 1 : path.totalLength / options.surface.uvScale,
		tangents: path.tangents,
		normals: frame.normals,
		offsets,
		halfWidths,
		topology,
		capTopology,
	}
}

function getVariableTopologyMode( path, join, cap ) {
	if ( path.hasCusps || lastJoinHasSplit || lastFootprintClipped ) return 'full'
	if ( lastJoinMaxScale > 0 && ( join.type !== 'miter' || lastJoinMaxScale > join.limit ) ) return 'full'
	return !path.closed && cap.type !== 'butt' ? 'caps' : null
}

function buildCompactCapTopology( path, frame, offsets, halfWidths, surface, cap, needs, usePooledLineArrays = false ) {
	const isSquare = cap.type === 'square'
	const capSegments = cap.segments
	const vertexCount = isSquare ? 4 : capSegments * 2
	const indexCount = isSquare ? 12 : capSegments * 6
	const positions = acquireTopoBuffer( 'capPositions', vertexCount * 3, usePooledLineArrays )
	const normals = acquireTopoBuffer( 'capNormals', vertexCount * 3, usePooledLineArrays )
	const tangents = needs.tangents ? acquireTopoBuffer( 'capTangents', vertexCount * 3, usePooledLineArrays ) : null
	const uvs = needs.uvs ? acquireTopoBuffer( 'capUvs', vertexCount * 2, usePooledLineArrays ) : null
	const progress = needs.progress ? acquireTopoBuffer( 'capProgress', vertexCount, usePooledLineArrays ) : null
	const sides = needs.sides ? acquireTopoBuffer( 'capSides', vertexCount, usePooledLineArrays ) : null
	const indices = acquireTopoBuffer( 'capIndices', indexCount, usePooledLineArrays )
	const bodyVertexCount = path.pointCount * 2
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const frameNormals = frame.normals
	const pathTangents = path.tangents
	const pathPoints = path.points
	const segmentDirections = path.segmentDirections
	let vCursor = 0
	let iCursor = 0

	const emitVertex = ( pointIndex, x, y, z, side, u, vertexProgress ) => {
		const localVertex = vCursor++
		const v3 = localVertex * 3
		const offset = pointIndex * 3
		const normalOffset = pointIndex === 0 ? 0 : ( frame.endNormalOffset ?? offset )
		positions[v3] = x
		positions[v3 + 1] = y
		positions[v3 + 2] = z
		normals[v3] = frameNormals[normalOffset]
		normals[v3 + 1] = frameNormals[normalOffset + 1]
		normals[v3 + 2] = frameNormals[normalOffset + 2]
		if ( tangents ) {
			tangents[v3] = pathTangents[offset]
			tangents[v3 + 1] = pathTangents[offset + 1]
			tangents[v3 + 2] = pathTangents[offset + 2]
		}
		if ( uvs ) {
			const v2 = localVertex * 2
			uvs[v2] = u
			uvs[v2 + 1] = clamp( ( side + 1 ) * 0.5, 0, 1 )
		}
		if ( progress ) progress[localVertex] = vertexProgress
		if ( sides ) sides[localVertex] = clamp( side, -1, 1 )
		return bodyVertexCount + localVertex
	}

	for ( let endStep = 0; endStep < 2; endStep++ ) {
		const isEnd = endStep === 1
		const pointIndex = isEnd ? path.pointCount - 1 : 0
		const offset = pointIndex * 3
		const normalOffset = isEnd ? ( frame.endNormalOffset ?? offset ) : 0
		const directionOffset = isEnd ? ( path.endDirectionOffset ?? ( path.segmentCount - 1 ) * 3 ) : 0
		const dirX = segmentDirections[directionOffset]
		const dirY = segmentDirections[directionOffset + 1]
		const dirZ = segmentDirections[directionOffset + 2]
		writeSegmentSide( segmentSideScratch, 0, frameNormals, normalOffset, segmentDirections, directionOffset )
		const sideX = segmentSideScratch[0]
		const sideY = segmentSideScratch[1]
		const sideZ = segmentSideScratch[2]
		const halfWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointIndex]
		const pair0 = isEnd ? bodyVertexCount - 2 : 0
		const pair1 = pair0 + 1
		const centerX = pathPoints[offset]
		const centerY = pathPoints[offset + 1]
		const centerZ = pathPoints[offset + 2]
		const baseU = uvs
			? ( surface.uvMode === 'stretch' ? path.progress[pointIndex] : ( isEnd ? path.totalLength : 0 ) / surface.uvScale )
			: 0
		const endpointProgress = progress ? ( isEnd ? 1 : 0 ) : 0
		const directionSign = isEnd ? 1 : -1
		const offX = offsets[normalOffset] * halfWidth
		const offY = offsets[normalOffset + 1] * halfWidth
		const offZ = offsets[normalOffset + 2] * halfWidth
		const leftX = centerX - offX
		const leftY = centerY - offY
		const leftZ = centerZ - offZ
		const rightX = centerX + offX
		const rightY = centerY + offY
		const rightZ = centerZ + offZ

		if ( isSquare ) {
			const u = uvs && surface.uvMode === 'distance' ? baseU + directionSign * halfWidth / surface.uvScale : baseU
			const capLeft = emitVertex(
				pointIndex,
				leftX + dirX * halfWidth * directionSign,
				leftY + dirY * halfWidth * directionSign,
				leftZ + dirZ * halfWidth * directionSign,
				-1, u, endpointProgress
			)
			const capRight = emitVertex(
				pointIndex,
				rightX + dirX * halfWidth * directionSign,
				rightY + dirY * halfWidth * directionSign,
				rightZ + dirZ * halfWidth * directionSign,
				1, u, endpointProgress
			)
			if ( isEnd ) {
				indices[iCursor] = pair0; indices[iCursor + 1] = capLeft; indices[iCursor + 2] = pair1
				indices[iCursor + 3] = pair1; indices[iCursor + 4] = capLeft; indices[iCursor + 5] = capRight
			} else {
				indices[iCursor] = capLeft; indices[iCursor + 1] = pair0; indices[iCursor + 2] = capRight
				indices[iCursor + 3] = capRight; indices[iCursor + 4] = pair0; indices[iCursor + 5] = pair1
			}
			iCursor += 6
			continue
		}

		const pivot = emitVertex( pointIndex, centerX, centerY, centerZ, 0, baseU, endpointProgress )
		const startRadialX = leftX - centerX
		const startRadialY = leftY - centerY
		const startRadialZ = leftZ - centerZ
		const normalX = frameNormals[normalOffset]
		const normalY = frameNormals[normalOffset + 1]
		const normalZ = frameNormals[normalOffset + 2]
		const crossX = normalY * startRadialZ - normalZ * startRadialY
		const crossY = normalZ * startRadialX - normalX * startRadialZ
		const crossZ = normalX * startRadialY - normalY * startRadialX
		const dot = normalX * startRadialX + normalY * startRadialY + normalZ * startRadialZ
		const axisDotX = normalX * dot
		const axisDotY = normalY * dot
		const axisDotZ = normalZ * dot
		const radX = startRadialX - axisDotX
		const radY = startRadialY - axisDotY
		const radZ = startRadialZ - axisDotZ
		const capTrig = getHalfTurnTrigTable( capSegments )
		const invHalfWidth = halfWidth > EPSILON ? 1 / halfWidth : 0
		const distanceUv = uvs && surface.uvMode === 'distance'
		const invUvScale = distanceUv ? 1 / surface.uvScale : 0
		let prevVertex = pair0
		for ( let segment = 1, trigOffset = 2; segment < capSegments; segment++, trigOffset += 2 ) {
			const cosine = capTrig[trigOffset]
			const sine = isEnd ? capTrig[trigOffset + 1] : -capTrig[trigOffset + 1]
			const rx = axisDotX + radX * cosine + crossX * sine
			const ry = axisDotY + radY * cosine + crossY * sine
			const rz = axisDotZ + radZ * cosine + crossZ * sine
			const sideCoordinate = ( rx * sideX + ry * sideY + rz * sideZ ) * invHalfWidth
			const u = distanceUv ? baseU + ( rx * dirX + ry * dirY + rz * dirZ ) * invUvScale : baseU
			const nextVertex = emitVertex(
				pointIndex,
				centerX + rx, centerY + ry, centerZ + rz,
				sideCoordinate, u, endpointProgress
			)
			if ( isEnd ) {
				indices[iCursor] = pivot; indices[iCursor + 1] = prevVertex; indices[iCursor + 2] = nextVertex
			} else {
				indices[iCursor] = pivot; indices[iCursor + 1] = nextVertex; indices[iCursor + 2] = prevVertex
			}
			iCursor += 3
			prevVertex = nextVertex
		}
		if ( isEnd ) {
			indices[iCursor] = pivot; indices[iCursor + 1] = prevVertex; indices[iCursor + 2] = pair1
		} else {
			indices[iCursor] = pivot; indices[iCursor + 1] = pair1; indices[iCursor + 2] = prevVertex
		}
		iCursor += 3
	}

	return {
		positions,
		normals,
		tangents,
		uvs,
		progress,
		sides,
		indices,
		vertexCount,
		indexCount,
	}
}

function growTypedBuffer( current, nextLength, scratchName, usePooled, liveLength = current.length ) {
	if ( current.length >= nextLength ) return current
	if ( usePooled && nextLength <= MAX_POOLED_SCRATCH_LENGTH ) {
		const next = new current.constructor( Math.min( MAX_POOLED_SCRATCH_LENGTH, Math.max( nextLength, current.length * 2 ) ) )
		if ( liveLength > 0 ) next.set( current.subarray( 0, liveLength ) )
		joinScratch[scratchName] = next
		return next
	}
	const next = new current.constructor( Math.max( nextLength, current.length * 2 ) )
	if ( liveLength > 0 ) next.set( current.subarray( 0, liveLength ) )
	return next
}

function acquireTopoBuffer( scratchName, length, usePooled ) {
	return usePooled
		? acquireScratch( scratchName, length )
		: new joinScratch[scratchName].constructor( length )
}

function emitBaseSegmentVertices(
	path, frame, segmentStartSides, segmentEndSides,
	halfWidths, constantHalfWidth, stretchUV, invUvScale, seamEndU,
	positions, normals, tangents, uvs, progress, sides
) {
	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	const points = path.points
	const normalsSource = frame.normals

	if ( !tangents && !uvs && !progress && !sides ) {
		let sx = points[0], sy = points[1], sz = points[2]
		let snx = normalsSource[0], sny = normalsSource[1], snz = normalsSource[2]
		let startWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[0]
		for ( let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++ ) {
			const endPoint = segmentIndex + 1 === pointCount ? 0 : segmentIndex + 1
			const endOffset = endPoint * 3
			const sideOffset = segmentIndex * 3

			const swx = segmentStartSides[sideOffset] * startWidth
			const swy = segmentStartSides[sideOffset + 1] * startWidth
			const swz = segmentStartSides[sideOffset + 2] * startWidth

			const endWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[endPoint]
			const ewx = segmentEndSides[sideOffset] * endWidth
			const ewy = segmentEndSides[sideOffset + 1] * endWidth
			const ewz = segmentEndSides[sideOffset + 2] * endWidth

			const posBase = segmentIndex * 12
			positions[posBase] = sx - swx
			positions[posBase + 1] = sy - swy
			positions[posBase + 2] = sz - swz
			positions[posBase + 3] = sx + swx
			positions[posBase + 4] = sy + swy
			positions[posBase + 5] = sz + swz

			const ex = points[endOffset]
			const ey = points[endOffset + 1]
			const ez = points[endOffset + 2]
			positions[posBase + 6] = ex - ewx
			positions[posBase + 7] = ey - ewy
			positions[posBase + 8] = ez - ewz
			positions[posBase + 9] = ex + ewx
			positions[posBase + 10] = ey + ewy
			positions[posBase + 11] = ez + ewz

			const enx = normalsSource[endOffset]
			const eny = normalsSource[endOffset + 1]
			const enz = normalsSource[endOffset + 2]
			normals[posBase] = normals[posBase + 3] = snx
			normals[posBase + 1] = normals[posBase + 4] = sny
			normals[posBase + 2] = normals[posBase + 5] = snz
			normals[posBase + 6] = normals[posBase + 9] = enx
			normals[posBase + 7] = normals[posBase + 10] = eny
			normals[posBase + 8] = normals[posBase + 11] = enz

			sx = ex; sy = ey; sz = ez
			snx = enx; sny = eny; snz = enz
			startWidth = endWidth
		}
		return
	}

	const tangentsSource = path.tangents
	const progressSource = path.progress
	const distancesSource = path.distances

	for ( let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++ ) {
		const startPoint = segmentIndex
		const endPoint = segmentIndex + 1 === pointCount ? 0 : segmentIndex + 1
		const startOffset = startPoint * 3
		const endOffset = endPoint * 3
		const sideOffset = segmentIndex * 3

		const startSideX = segmentStartSides[sideOffset]
		const startSideY = segmentStartSides[sideOffset + 1]
		const startSideZ = segmentStartSides[sideOffset + 2]
		const endSideX = segmentEndSides[sideOffset]
		const endSideY = segmentEndSides[sideOffset + 1]
		const endSideZ = segmentEndSides[sideOffset + 2]

		const startWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[startPoint]
		const endWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[endPoint]
		const seamEnd = path.closed && endPoint === 0

		const startLeft = segmentIndex * 4
		const startRight = startLeft + 1
		const endLeft = startLeft + 2
		const endRight = startLeft + 3
		const posBase = startLeft * 3

		const sx = points[startOffset]
		const sy = points[startOffset + 1]
		const sz = points[startOffset + 2]
		const swx = startSideX * startWidth
		const swy = startSideY * startWidth
		const swz = startSideZ * startWidth
		positions[posBase] = sx - swx
		positions[posBase + 1] = sy - swy
		positions[posBase + 2] = sz - swz
		positions[posBase + 3] = sx + swx
		positions[posBase + 4] = sy + swy
		positions[posBase + 5] = sz + swz

		const ex = points[endOffset]
		const ey = points[endOffset + 1]
		const ez = points[endOffset + 2]
		const ewx = endSideX * endWidth
		const ewy = endSideY * endWidth
		const ewz = endSideZ * endWidth
		positions[posBase + 6] = ex - ewx
		positions[posBase + 7] = ey - ewy
		positions[posBase + 8] = ez - ewz
		positions[posBase + 9] = ex + ewx
		positions[posBase + 10] = ey + ewy
		positions[posBase + 11] = ez + ewz

		const snx = normalsSource[startOffset]
		const sny = normalsSource[startOffset + 1]
		const snz = normalsSource[startOffset + 2]
		const enx = normalsSource[endOffset]
		const eny = normalsSource[endOffset + 1]
		const enz = normalsSource[endOffset + 2]
		normals[posBase] = snx; normals[posBase + 1] = sny; normals[posBase + 2] = snz
		normals[posBase + 3] = snx; normals[posBase + 4] = sny; normals[posBase + 5] = snz
		normals[posBase + 6] = enx; normals[posBase + 7] = eny; normals[posBase + 8] = enz
		normals[posBase + 9] = enx; normals[posBase + 10] = eny; normals[posBase + 11] = enz

		if ( tangents ) {
			const stx = tangentsSource[startOffset]
			const sty = tangentsSource[startOffset + 1]
			const stz = tangentsSource[startOffset + 2]
			const etx = tangentsSource[endOffset]
			const ety = tangentsSource[endOffset + 1]
			const etz = tangentsSource[endOffset + 2]
			tangents[posBase] = stx; tangents[posBase + 1] = sty; tangents[posBase + 2] = stz
			tangents[posBase + 3] = stx; tangents[posBase + 4] = sty; tangents[posBase + 5] = stz
			tangents[posBase + 6] = etx; tangents[posBase + 7] = ety; tangents[posBase + 8] = etz
			tangents[posBase + 9] = etx; tangents[posBase + 10] = ety; tangents[posBase + 11] = etz
		}
		if ( uvs ) {
			const startU = stretchUV ? progressSource[startPoint] : distancesSource[startPoint] * invUvScale
			const endU = seamEnd ? seamEndU : ( stretchUV ? progressSource[endPoint] : distancesSource[endPoint] * invUvScale )
			const uvBase = startLeft * 2
			uvs[uvBase] = startU
			uvs[uvBase + 1] = 0
			uvs[uvBase + 2] = startU
			uvs[uvBase + 3] = 1
			uvs[uvBase + 4] = endU
			uvs[uvBase + 5] = 0
			uvs[uvBase + 6] = endU
			uvs[uvBase + 7] = 1
		}
		if ( progress ) {
			const startP = progressSource[startPoint]
			const endP = seamEnd ? 1 : progressSource[endPoint]
			progress[startLeft] = startP
			progress[startRight] = startP
			progress[endLeft] = endP
			progress[endRight] = endP
		}
		if ( sides ) {
			sides[startLeft] = -1
			sides[startRight] = 1
			sides[endLeft] = -1
			sides[endRight] = 1
		}
	}
}

const topoState = {
	positions: null,
	normals: null,
	tangents: null,
	uvs: null,
	progress: null,
	sides: null,
	indices: null,
	vertexCount: 0,
	vertexCapacity: 0,
	indexCount: 0,
	indexCapacity: 0,
	aliases: null,
	hasAliases: false,
	splits: null,
	usePooled: false,
	stretchUV: false,
	invUvScale: 1,
	normalsSource: null,
	tangentsSource: null,
	progressSource: null,
	distancesSource: null,
}

function topoEnsureVertexCapacity( state, needed ) {
	if ( needed <= state.vertexCapacity ) return
	const usePooled = state.usePooled
	const liveVertices = state.vertexCount
	const nextCap = Math.max( needed, state.vertexCapacity * 2 )
	state.positions = growTypedBuffer( state.positions, nextCap * 3, 'topoPositions', usePooled, liveVertices * 3 )
	state.normals = growTypedBuffer( state.normals, nextCap * 3, 'topoNormals', usePooled, liveVertices * 3 )
	if ( state.tangents ) state.tangents = growTypedBuffer( state.tangents, nextCap * 3, 'topoTangents', usePooled, liveVertices * 3 )
	if ( state.uvs ) state.uvs = growTypedBuffer( state.uvs, nextCap * 2, 'topoUvs', usePooled, liveVertices * 2 )
	if ( state.progress ) state.progress = growTypedBuffer( state.progress, nextCap, 'topoProgress', usePooled, liveVertices )
	if ( state.sides ) state.sides = growTypedBuffer( state.sides, nextCap, 'topoSides', usePooled, liveVertices )
	state.vertexCapacity = Math.floor( state.positions.length / 3 )
}

function topoEnsureIndexCapacity( state, needed ) {
	if ( needed <= state.indexCapacity ) return
	const nextCap = Math.max( needed, state.indexCapacity * 2 )
	state.indices = growTypedBuffer( state.indices, nextCap, 'topoIndices', state.usePooled, state.indexCount )
	state.indexCapacity = state.indices.length
}

function topoPushTriangle( state, a, b, c ) {
	const count = state.indexCount
	if ( count + 3 > state.indexCapacity ) topoEnsureIndexCapacity( state, count + 3 )
	const indices = state.indices
	indices[count] = a
	indices[count + 1] = b
	indices[count + 2] = c
	state.indexCount = count + 3
}

function topoEmitVertex( state, pointIndex, x, y, z, side, u, vertexProgress ) {
	const vertex = state.vertexCount
	if ( vertex + 1 > state.vertexCapacity ) topoEnsureVertexCapacity( state, vertex + 1 )
	state.vertexCount = vertex + 1
	const pointOffset = pointIndex * 3
	const v3 = vertex * 3
	const positions = state.positions
	const normals = state.normals
	const normalsSource = state.normalsSource
	positions[v3] = x
	positions[v3 + 1] = y
	positions[v3 + 2] = z
	normals[v3] = normalsSource[pointOffset]
	normals[v3 + 1] = normalsSource[pointOffset + 1]
	normals[v3 + 2] = normalsSource[pointOffset + 2]
	if ( state.tangents ) {
		const tangents = state.tangents
		const tangentsSource = state.tangentsSource
		tangents[v3] = tangentsSource[pointOffset]
		tangents[v3 + 1] = tangentsSource[pointOffset + 1]
		tangents[v3 + 2] = tangentsSource[pointOffset + 2]
	}
	if ( state.uvs ) {
		const v2 = vertex * 2
		const uvs = state.uvs
		const resolvedU = u !== undefined
			? u
			: ( state.stretchUV ? state.progressSource[pointIndex] : state.distancesSource[pointIndex] * state.invUvScale )
		uvs[v2] = resolvedU
		uvs[v2 + 1] = clamp( ( side + 1 ) * 0.5, 0, 1 )
	}
	if ( state.progress ) {
		state.progress[vertex] = vertexProgress !== undefined ? vertexProgress : state.progressSource[pointIndex]
	}
	if ( state.sides ) state.sides[vertex] = clamp( side, -1, 1 )
	return vertex
}

function topoAliasJoinRows( state, pointCount, pointIndex ) {
	let aliases = state.aliases
	if ( !aliases ) {
		aliases = acquireScratch( 'topoAliases', pointCount )
		aliases.fill( 0, 0, pointCount )
		state.aliases = aliases
	}
	aliases[pointIndex] = 1
	state.hasAliases = true
}

function emitFusedVariableSegmentVerticesAndJoins(
	path, frame, segmentStartSides, segmentEndSides,
	halfWidths, constantHalfWidth, seamEndU,
	join, innerFactors, joinData, baseVertices, state
) {
	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	const points = path.points
	const normalsSource = frame.normals
	const closed = path.closed
	const positions = state.positions
	const normals = state.normals

	if ( !closed ) {
		const w0 = constantHalfWidth !== null ? constantHalfWidth : halfWidths[0]
		const swx = segmentStartSides[0] * w0
		const swy = segmentStartSides[1] * w0
		const swz = segmentStartSides[2] * w0
		const sx = points[0], sy = points[1], sz = points[2]
		positions[0] = sx - swx
		positions[1] = sy - swy
		positions[2] = sz - swz
		positions[3] = sx + swx
		positions[4] = sy + swy
		positions[5] = sz + swz
		const snx = normalsSource[0], sny = normalsSource[1], snz = normalsSource[2]
		normals[0] = snx; normals[1] = sny; normals[2] = snz
		normals[3] = snx; normals[4] = sny; normals[5] = snz

		const lastSegIndex = segmentCount - 1
		const lastSeg3 = lastSegIndex * 3
		const lastPt3 = ( pointCount - 1 ) * 3
		const wLast = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointCount - 1]
		const ewx = segmentEndSides[lastSeg3] * wLast
		const ewy = segmentEndSides[lastSeg3 + 1] * wLast
		const ewz = segmentEndSides[lastSeg3 + 2] * wLast
		const ex = points[lastPt3], ey = points[lastPt3 + 1], ez = points[lastPt3 + 2]
		const posBase = ( lastSegIndex * 4 + 2 ) * 3
		positions[posBase] = ex - ewx
		positions[posBase + 1] = ey - ewy
		positions[posBase + 2] = ez - ewz
		positions[posBase + 3] = ex + ewx
		positions[posBase + 4] = ey + ewy
		positions[posBase + 5] = ez + ewz
		const enx = normalsSource[lastPt3], eny = normalsSource[lastPt3 + 1], enz = normalsSource[lastPt3 + 2]
		normals[posBase] = enx; normals[posBase + 1] = eny; normals[posBase + 2] = enz
		normals[posBase + 3] = enx; normals[posBase + 4] = eny; normals[posBase + 5] = enz
	}

	const firstJoinPoint = closed ? 0 : 1
	const lastJoinPoint = closed ? pointCount : pointCount - 1
	const isMiterJoin = join.type === 'miter'
	const isRoundJoin = join.type === 'round'
	const joinLimit = join.limit
	const angleToSegments = join.segments / Math.PI

	for ( let pointIndex = firstJoinPoint; pointIndex < lastJoinPoint; pointIndex++ ) {
		const incomingIndex = pointIndex === 0 ? segmentCount - 1 : pointIndex - 1
		const outgoingIndex = pointIndex
		const incomingEnd0 = incomingIndex * 4 + 2
		const incomingEnd1 = incomingEnd0 + 1
		const outgoingStart0 = outgoingIndex * 4
		const outgoingStart1 = outgoingStart0 + 1
		const ie0 = incomingEnd0 * 3
		const os0 = outgoingStart0 * 3
		const pointOffset = pointIndex * 3
		const centerX = points[pointOffset]
		const centerY = points[pointOffset + 1]
		const centerZ = points[pointOffset + 2]
		const nx = normalsSource[pointOffset]
		const ny = normalsSource[pointOffset + 1]
		const nz = normalsSource[pointOffset + 2]
		normals[ie0] = nx; normals[ie0 + 1] = ny; normals[ie0 + 2] = nz
		normals[ie0 + 3] = nx; normals[ie0 + 4] = ny; normals[ie0 + 5] = nz
		normals[os0] = nx; normals[os0 + 1] = ny; normals[os0 + 2] = nz
		normals[os0 + 3] = nx; normals[os0 + 4] = ny; normals[os0 + 5] = nz

		const width = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointIndex]
		const info = pointIndex * JOIN_STRIDE
		const angle = joinData[info + JOIN_ANGLE]
		const seamJoin = closed && pointIndex === 0

		if ( angle === 0 ) {
			const inSide3 = incomingIndex * 3
			const ewx = segmentEndSides[inSide3] * width
			const ewy = segmentEndSides[inSide3 + 1] * width
			const ewz = segmentEndSides[inSide3 + 2] * width
			const lx = centerX - ewx, ly = centerY - ewy, lz = centerZ - ewz
			const rx = centerX + ewx, ry = centerY + ewy, rz = centerZ + ewz
			positions[ie0] = lx; positions[ie0 + 1] = ly; positions[ie0 + 2] = lz
			positions[ie0 + 3] = rx; positions[ie0 + 4] = ry; positions[ie0 + 5] = rz
			if ( seamJoin ) {
				const outSide3 = outgoingIndex * 3
				const swx = segmentStartSides[outSide3] * width
				const swy = segmentStartSides[outSide3 + 1] * width
				const swz = segmentStartSides[outSide3 + 2] * width
				positions[os0] = centerX - swx; positions[os0 + 1] = centerY - swy; positions[os0 + 2] = centerZ - swz
				positions[os0 + 3] = centerX + swx; positions[os0 + 4] = centerY + swy; positions[os0 + 5] = centerZ + swz
			} else {
				positions[os0] = lx; positions[os0 + 1] = ly; positions[os0 + 2] = lz
				positions[os0 + 3] = rx; positions[os0 + 4] = ry; positions[os0 + 5] = rz
				topoAliasJoinRows( state, pointCount, pointIndex )
			}
			continue
		}

		const scale = joinData[info + JOIN_SCALE]
		const innerFactor = innerFactors ? innerFactors[pointIndex] : 1
		if ( isMiterJoin && scale <= joinLimit && innerFactor === 1 ) {
			const ws = width * scale
			const mx = joinData[info + JOIN_MITER] * ws
			const my = joinData[info + JOIN_MITER + 1] * ws
			const mz = joinData[info + JOIN_MITER + 2] * ws
			const lx = centerX - mx, ly = centerY - my, lz = centerZ - mz
			const rx = centerX + mx, ry = centerY + my, rz = centerZ + mz
			positions[ie0] = lx; positions[ie0 + 1] = ly; positions[ie0 + 2] = lz
			positions[os0] = lx; positions[os0 + 1] = ly; positions[os0 + 2] = lz
			positions[ie0 + 3] = rx; positions[ie0 + 4] = ry; positions[ie0 + 5] = rz
			positions[os0 + 3] = rx; positions[os0 + 4] = ry; positions[os0 + 5] = rz
			if ( !seamJoin ) topoAliasJoinRows( state, pointCount, pointIndex )
			continue
		}

		const positiveTurn = angle > 0
		const turnBit = positiveTurn ? 1 : 0
		const turnSign = positiveTurn ? 1 : -1
		const innerSlot = turnBit
		const outerSlot = 1 - turnBit
		const innerBias = turnBit * 3
		const outerBias = 3 - innerBias
		const incomingInner = incomingEnd0 + innerSlot
		const incomingOuter = incomingEnd0 + outerSlot
		const outgoingOuter = outgoingStart0 + outerSlot
		const innerScale = width * scale * turnSign * innerFactor
		const innerX = centerX + joinData[info + JOIN_MITER] * innerScale
		const innerY = centerY + joinData[info + JOIN_MITER + 1] * innerScale
		const innerZ = centerZ + joinData[info + JOIN_MITER + 2] * innerScale
		const inSide3 = incomingIndex * 3
		const outSide3 = outgoingIndex * 3
		const outerWidth = positiveTurn ? -width : width
		const inOutIdx = ie0 + outerBias
		const inInIdx = ie0 + innerBias
		const outOutIdx = os0 + outerBias
		const outInIdx = os0 + innerBias
		positions[inOutIdx] = centerX + segmentEndSides[inSide3] * outerWidth
		positions[inOutIdx + 1] = centerY + segmentEndSides[inSide3 + 1] * outerWidth
		positions[inOutIdx + 2] = centerZ + segmentEndSides[inSide3 + 2] * outerWidth
		positions[inInIdx] = innerX
		positions[inInIdx + 1] = innerY
		positions[inInIdx + 2] = innerZ
		positions[outOutIdx] = centerX + segmentStartSides[outSide3] * outerWidth
		positions[outOutIdx + 1] = centerY + segmentStartSides[outSide3 + 1] * outerWidth
		positions[outOutIdx + 2] = centerZ + segmentStartSides[outSide3 + 2] * outerWidth
		positions[outInIdx] = innerX
		positions[outInIdx + 1] = innerY
		positions[outInIdx + 2] = innerZ

		if ( seamJoin ) {
			emitSeamJoin(
				state,
				pointIndex, incomingOuter, outgoingOuter, innerSlot, outerSlot,
				centerX, centerY, centerZ, innerX, innerY, innerZ,
				angle, nx, ny, nz,
				join, seamEndU
			)
		} else if ( isRoundJoin ) {
			const roundSegs = Math.ceil( Math.abs( angle ) * angleToSegments ) || 1
			if ( roundSegs <= 1 ) {
				const count = state.indexCount
				if ( count + 3 > state.indexCapacity ) topoEnsureIndexCapacity( state, count + 3 )
				const indices = state.indices
				indices[count] = incomingInner
				indices[count + 1] = turnSign > 0 ? incomingOuter : outgoingOuter
				indices[count + 2] = turnSign > 0 ? outgoingOuter : incomingOuter
				state.indexCount = count + 3
			} else {
				emitRoundJoin(
					state,
					pointIndex, incomingInner, incomingOuter, outgoingOuter, outerSlot,
					centerX, centerY, centerZ, angle,
					nx, ny, nz,
					roundSegs
				)
			}
		} else {
			const count = state.indexCount
			if ( count + 3 > state.indexCapacity ) topoEnsureIndexCapacity( state, count + 3 )
			const indices = state.indices
			indices[count] = incomingInner
			indices[count + 1] = turnSign > 0 ? incomingOuter : outgoingOuter
			indices[count + 2] = turnSign > 0 ? outgoingOuter : incomingOuter
			state.indexCount = count + 3
		}
	}
}

function emitVariableJoins(
	path, frame, halfWidths, constantHalfWidth, seamEndU,
	join, innerFactors, joinData, baseVertices, state
) {
	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	const points = path.points
	const normalsSource = frame.normals
	const hasCusps = path.hasCusps
	const cusps = path.cusps
	const closed = path.closed
	const firstJoinPoint = closed ? 0 : 1
	const lastJoinPoint = closed ? pointCount : pointCount - 1
	const isMiterJoin = join.type === 'miter'
	const isRoundJoin = join.type === 'round'
	const joinLimit = join.limit
	const angleToSegments = join.segments / Math.PI

	for ( let pointIndex = firstJoinPoint; pointIndex < lastJoinPoint; pointIndex++ ) {
		const incomingIndex = pointIndex === 0 ? segmentCount - 1 : pointIndex - 1
		const outgoingIndex = pointIndex
		const incomingEnd0 = incomingIndex * 4 + 2
		const incomingEnd1 = incomingEnd0 + 1
		const outgoingStart0 = outgoingIndex * 4
		const outgoingStart1 = outgoingStart0 + 1
		const info = pointIndex * JOIN_STRIDE

		const scale = joinData[info + JOIN_SCALE]
		// Cusps carry no resolved join frame; they split like reversals.
		if ( ( hasCusps && cusps[pointIndex] ) || scale === Infinity ) {
			let splits = state.splits
			if ( !splits ) {
				splits = acquireScratch( 'topoSplits', pointCount )
				splits.fill( 0, 0, pointCount )
				state.splits = splits
			}
			splits[pointIndex] = 1
			continue
		}
		const angle = joinData[info + JOIN_ANGLE]
		const seamJoin = closed && pointIndex === 0
		if ( angle === 0 ) {
			if ( !seamJoin ) topoAliasJoinRows( state, pointCount, pointIndex )
			continue
		}

		const pointOffset = pointIndex * 3
		const centerX = points[pointOffset]
		const centerY = points[pointOffset + 1]
		const centerZ = points[pointOffset + 2]
		const width = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointIndex]
		const turnSign = angle > 0 ? 1 : -1
		const innerFactor = innerFactors ? innerFactors[pointIndex] : 1
		const positions = state.positions
		if ( isMiterJoin && scale <= joinLimit && innerFactor === 1 ) {
			const ws = width * scale
			const mx = joinData[info + JOIN_MITER] * ws
			const my = joinData[info + JOIN_MITER + 1] * ws
			const mz = joinData[info + JOIN_MITER + 2] * ws
			const lx = centerX - mx, ly = centerY - my, lz = centerZ - mz
			const rx = centerX + mx, ry = centerY + my, rz = centerZ + mz
			const ie0 = incomingEnd0 * 3
			const os0 = outgoingStart0 * 3
			positions[ie0] = lx; positions[ie0 + 1] = ly; positions[ie0 + 2] = lz
			positions[os0] = lx; positions[os0 + 1] = ly; positions[os0 + 2] = lz
			positions[ie0 + 3] = rx; positions[ie0 + 4] = ry; positions[ie0 + 5] = rz
			positions[os0 + 3] = rx; positions[os0 + 4] = ry; positions[os0 + 5] = rz
			if ( !seamJoin ) topoAliasJoinRows( state, pointCount, pointIndex )
			continue
		}

		const innerSlot = turnSign > 0 ? 1 : 0
		const outerSlot = 1 - innerSlot
		const innerScale = width * scale * turnSign * innerFactor
		const innerX = centerX + joinData[info + JOIN_MITER] * innerScale
		const innerY = centerY + joinData[info + JOIN_MITER + 1] * innerScale
		const innerZ = centerZ + joinData[info + JOIN_MITER + 2] * innerScale
		const incomingInner = incomingEnd0 + innerSlot
		const incomingOuter = incomingEnd0 + outerSlot
		const outgoingInner = outgoingStart0 + innerSlot
		const outgoingOuter = outgoingStart0 + outerSlot
		const ii3 = incomingInner * 3
		const oi3 = outgoingInner * 3
		positions[ii3] = innerX; positions[ii3 + 1] = innerY; positions[ii3 + 2] = innerZ
		positions[oi3] = innerX; positions[oi3 + 1] = innerY; positions[oi3 + 2] = innerZ

		if ( seamJoin ) {
			emitSeamJoin(
				state,
				pointIndex, incomingOuter, outgoingOuter, innerSlot, outerSlot,
				centerX, centerY, centerZ, innerX, innerY, innerZ,
				angle, normalsSource[pointOffset], normalsSource[pointOffset + 1], normalsSource[pointOffset + 2],
				join, seamEndU
			)
		} else if ( isRoundJoin ) {
			const roundSegs = Math.ceil( Math.abs( angle ) * angleToSegments ) || 1
			if ( roundSegs <= 1 ) {
				const count = state.indexCount
				if ( count + 3 > state.indexCapacity ) topoEnsureIndexCapacity( state, count + 3 )
				const indices = state.indices
				indices[count] = incomingInner
				indices[count + 1] = turnSign > 0 ? incomingOuter : outgoingOuter
				indices[count + 2] = turnSign > 0 ? outgoingOuter : incomingOuter
				state.indexCount = count + 3
			} else {
				emitRoundJoin(
					state,
					pointIndex, incomingInner, incomingOuter, outgoingOuter, outerSlot,
					centerX, centerY, centerZ, angle,
					normalsSource[pointOffset], normalsSource[pointOffset + 1], normalsSource[pointOffset + 2],
					roundSegs
				)
			}
		} else {
			const count = state.indexCount
			if ( count + 3 > state.indexCapacity ) topoEnsureIndexCapacity( state, count + 3 )
			const indices = state.indices
			indices[count] = incomingInner
			indices[count + 1] = turnSign > 0 ? incomingOuter : outgoingOuter
			indices[count + 2] = turnSign > 0 ? outgoingOuter : incomingOuter
			state.indexCount = count + 3
		}
	}
}

function buildVariableTopology( path, frame, halfWidths, surface, join, cap, needs, innerFactors, joinData, usePooledLineArrays = false ) {
	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	const segmentStartSides = joinScratch.segmentStartSides
	const segmentEndSides = joinScratch.segmentEndSides

	if ( !path.hasCusps ) {
		if ( !path.closed ) {
			writeSegmentSide( segmentStartSides, 0, frame.normals, 0, path.segmentDirections, 0 )
			const lastSegOffset = ( segmentCount - 1 ) * 3
			writeSegmentSide( segmentEndSides, lastSegOffset, frame.normals, ( pointCount - 1 ) * 3, path.segmentDirections, lastSegOffset )
		}
	} else {
		for ( let pointIndex = 0; pointIndex < pointCount; pointIndex++ ) {
			const hasJoin = path.closed || ( pointIndex > 0 && pointIndex < pointCount - 1 )
			if ( hasJoin && !path.cusps[pointIndex] ) continue
			const pointOffset = pointIndex * 3
			if ( path.closed || pointIndex > 0 ) {
				const incomingIndex = ( pointIndex - 1 + segmentCount ) % segmentCount
				writeSegmentSide( segmentEndSides, incomingIndex * 3, frame.normals, pointOffset, path.segmentDirections, incomingIndex * 3 )
			}
			if ( path.closed || pointIndex < pointCount - 1 ) {
				const outgoingIndex = pointIndex % segmentCount
				writeSegmentSide( segmentStartSides, outgoingIndex * 3, frame.normals, pointOffset, path.segmentDirections, outgoingIndex * 3 )
			}
		}
	}

	const baseVertices = segmentCount * 4
	const requestedVertexCapacity = baseVertices +
		( join.type === 'round' ? Math.min( pointCount, 64 ) * join.segments : 0 ) +
		( path.closed ? join.segments + 4 : 0 ) +
		( cap.type !== 'butt' ? ( cap.segments + 2 ) * 4 : 0 )
	const requestedIndexCapacity = pointCount * 3 +
		( join.type === 'round' ? Math.min( pointCount, 64 ) * join.segments * 3 : 0 ) +
		( path.closed ? ( join.segments + 2 ) * 3 : 0 ) +
		( cap.type !== 'butt' ? cap.segments * 12 : 0 )

	const positions = acquireTopoBuffer( 'topoPositions', requestedVertexCapacity * 3, usePooledLineArrays )
	const normals = acquireTopoBuffer( 'topoNormals', requestedVertexCapacity * 3, usePooledLineArrays )
	const tangents = needs.tangents ? acquireTopoBuffer( 'topoTangents', requestedVertexCapacity * 3, usePooledLineArrays ) : null
	const uvs = needs.uvs ? acquireTopoBuffer( 'topoUvs', requestedVertexCapacity * 2, usePooledLineArrays ) : null
	const progress = needs.progress ? acquireTopoBuffer( 'topoProgress', requestedVertexCapacity, usePooledLineArrays ) : null
	const sides = needs.sides ? acquireTopoBuffer( 'topoSides', requestedVertexCapacity, usePooledLineArrays ) : null
	const indices = acquireTopoBuffer( 'topoIndices', requestedIndexCapacity, usePooledLineArrays )

	let vertexCapacity = Math.min( Math.floor( positions.length / 3 ), Math.floor( normals.length / 3 ) )
	if ( tangents ) vertexCapacity = Math.min( vertexCapacity, Math.floor( tangents.length / 3 ) )
	if ( uvs ) vertexCapacity = Math.min( vertexCapacity, Math.floor( uvs.length / 2 ) )
	if ( progress ) vertexCapacity = Math.min( vertexCapacity, progress.length )
	if ( sides ) vertexCapacity = Math.min( vertexCapacity, sides.length )

	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const stretchUV = surface.uvMode === 'stretch'
	const invUvScale = 1 / surface.uvScale
	const seamEndU = stretchUV ? 1 : path.totalLength * invUvScale

	topoState.positions = positions
	topoState.normals = normals
	topoState.tangents = tangents
	topoState.uvs = uvs
	topoState.progress = progress
	topoState.sides = sides
	topoState.indices = indices
	topoState.vertexCount = baseVertices
	topoState.vertexCapacity = vertexCapacity
	topoState.indexCount = 0
	topoState.indexCapacity = indices.length
	topoState.aliases = null
	topoState.hasAliases = false
	topoState.splits = null
	topoState.usePooled = usePooledLineArrays
	topoState.stretchUV = stretchUV
	topoState.invUvScale = invUvScale
	topoState.normalsSource = frame.normals
	topoState.tangentsSource = path.tangents
	topoState.progressSource = path.progress
	topoState.distancesSource = path.distances

	if ( !path.hasCusps && !lastJoinHasSplit && !tangents && !uvs && !progress && !sides ) {
		emitFusedVariableSegmentVerticesAndJoins(
			path, frame, segmentStartSides, segmentEndSides,
			halfWidths, constantHalfWidth, seamEndU,
			join, innerFactors, joinData, baseVertices, topoState
		)
	} else {
		emitBaseSegmentVertices(
			path, frame, segmentStartSides, segmentEndSides,
			halfWidths, constantHalfWidth, stretchUV, invUvScale, seamEndU,
			positions, normals, tangents, uvs, progress, sides
		)
		emitVariableJoins(
			path, frame, halfWidths, constantHalfWidth, seamEndU,
			join, innerFactors, joinData, baseVertices, topoState
		)
	}

	if ( !path.closed && cap.type !== 'butt' ) {
		const w0 = constantHalfWidth !== null ? constantHalfWidth : halfWidths[0]
		const wLast = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointCount - 1]
		emitCap( false, 0, 0, path, frame, w0, surface, cap, topoState )
		emitCap( true, pointCount - 1, segmentCount - 1, path, frame, wLast, surface, cap, topoState )
	}
	if ( topoState.splits && cap.type !== 'butt' ) {
		const splits = topoState.splits
		for ( let pointIndex = 0; pointIndex < pointCount; pointIndex++ ) {
			if ( !splits[pointIndex] ) continue
			const incomingIndex = ( pointIndex - 1 + segmentCount ) % segmentCount
			const outgoingIndex = pointIndex % segmentCount
			const w = constantHalfWidth !== null ? constantHalfWidth : halfWidths[pointIndex]
			emitCap( true, pointIndex, incomingIndex, path, frame, w, surface, cap, topoState, true )
			emitCap( false, pointIndex, outgoingIndex, path, frame, w, surface, cap, topoState, true )
		}
	}

	return finalizeVariableTopology(
		topoState.positions, topoState.normals, topoState.tangents, topoState.uvs,
		topoState.progress, topoState.sides, topoState.indices,
		topoState.vertexCount, topoState.indexCount, segmentCount, baseVertices,
		topoState.aliases, topoState.hasAliases,
		path.closed, usePooledLineArrays
	)
}

// Flat per-point join frames. Each join row is resolved once and shared by the
// inner-footprint, topology-mode, and variable-topology passes. Flat storage
// keeps long paths from allocating (and GC-promoting) small vectors per point.
const JOIN_STRIDE = 6
const JOIN_ANGLE = 0
const JOIN_SCALE = 1
const JOIN_INSET = 2
const JOIN_MITER = 3
const segmentSideScratch = new Float64Array( 3 )

// Join frames, inner footprints, and single-line topology buffers never outlive
// `build()`, and no user callback runs while they are live, so one pool serves
// every line of every geometry instead of reallocating per build.
const MAX_POOLED_SCRATCH_LENGTH = 1 << 21
const joinScratch = {
	data: new Float64Array( 0 ),
	footprints: new Float64Array( 0 ),
	segmentDirections: new Float64Array( 0 ),
	segmentLengths: new Float64Array( 0 ),
	segmentStartSides: new Float64Array( 0 ),
	segmentEndSides: new Float64Array( 0 ),
	cusps: new Uint8Array( 0 ),
	frameNormals: new Float64Array( 0 ),
	pathDistances: new Float64Array( 0 ),
	pathProgress: new Float64Array( 0 ),
	pathTangents: new Float64Array( 0 ),
	halfWidths: new Float64Array( 0 ),
	compactOffsets: new Float64Array( 0 ),
	capPositions: new Float64Array( 0 ),
	capNormals: new Float32Array( 0 ),
	capTangents: new Float64Array( 0 ),
	capUvs: new Float32Array( 0 ),
	capProgress: new Float32Array( 0 ),
	capSides: new Float32Array( 0 ),
	capIndices: new Uint32Array( 0 ),
	topoPositions: new Float64Array( 0 ),
	topoNormals: new Float32Array( 0 ),
	topoTangents: new Float64Array( 0 ),
	topoUvs: new Float32Array( 0 ),
	topoProgress: new Float32Array( 0 ),
	topoSides: new Float32Array( 0 ),
	topoIndices: new Uint32Array( 0 ),
	topoAliases: new Uint8Array( 0 ),
	topoSplits: new Uint8Array( 0 ),
	topoUsed: new Int32Array( 0 ),
	topoPairVertices: new Int32Array( 0 ),
	topoCompactPositions: new Float64Array( 0 ),
	topoCompactNormals: new Float32Array( 0 ),
	topoCompactTangents: new Float64Array( 0 ),
	topoCompactUvs: new Float32Array( 0 ),
	topoCompactProgress: new Float32Array( 0 ),
	topoCompactSides: new Float32Array( 0 ),
	topoCompactIndices: new Uint32Array( 0 ),
}
const frameCandidateScratch = new Float64Array( 3 )
const frameEndNormalsScratch = new Float64Array( 3 )

function acquireScratch( name, length ) {
	const current = joinScratch[name]
	if ( current.length >= length ) return current
	if ( length > MAX_POOLED_SCRATCH_LENGTH ) return new current.constructor( length )
	const next = new current.constructor( Math.min( MAX_POOLED_SCRATCH_LENGTH, Math.max( length, current.length * 2 ) ) )
	joinScratch[name] = next
	return next
}

let lastJoinHasSplit = false
let lastJoinHasAliased = false
let lastJoinAliasedCount = 0
let lastJoinHasMultiSegRound = false
let lastJoinMaxScale = 0
let lastJoinMaxFiniteScale = Math.SQRT2
let lastJoinMaxUnitInset = 0
let lastFootprintClipped = false
let lastFootprintCanonicalSafe = true
let lastMinHalfWidth = 0
let lastMaxHalfWidth = 0

function computeCompactMiterOffsets( path, frame, maxHalfWidth, joinLimit, usePooledLineArrays ) {
	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	let offsets = null
	const normals = frame.normals
	const tangents = path.tangents
	const directions = path.segmentDirections
	const segmentLengths = path.segmentLengths
	const first = path.closed ? 0 : 1
	const last = path.closed ? pointCount : pointCount - 1
	const safeRatio = 0.45
	const epsSq = EPSILON * EPSILON
	let maxScale = 0
	let maxFiniteScale = Math.SQRT2
	let maxUnitInset = 0
	const initInIndex = first === 0 ? segmentCount - 1 : first - 1
	const initInOffset = initInIndex * 3
	let inDirX = directions[initInOffset]
	let inDirY = directions[initInOffset + 1]
	let inDirZ = directions[initInOffset + 2]
	let prevSafeLen = segmentLengths[initInIndex] * safeRatio

	lastJoinHasSplit = false
	lastJoinHasAliased = false
	lastJoinHasMultiSegRound = false
	lastFootprintClipped = false
	lastFootprintCanonicalSafe = true

	for ( let pointIndex = first; pointIndex < last; pointIndex++ ) {
		const offset = pointIndex * 3
		const normalX = normals[offset]
		const normalY = normals[offset + 1]
		const normalZ = normals[offset + 2]
		const tanX = tangents[offset]
		const tanY = tangents[offset + 1]
		const tanZ = tangents[offset + 2]
		const miterX = normalY * tanZ - normalZ * tanY
		const miterY = normalZ * tanX - normalX * tanZ
		const miterZ = normalX * tanY - normalY * tanX

		const outDirX = directions[offset]
		const outDirY = directions[offset + 1]
		const outDirZ = directions[offset + 2]
		const c = tanX * outDirX + tanY * outDirY + tanZ * outDirZ
		const q = 0.5 * (
			( outDirX - inDirX ) * miterX +
			( outDirY - inDirY ) * miterY +
			( outDirZ - inDirZ ) * miterZ
		)
		inDirX = outDirX; inDirY = outDirY; inDirZ = outDirZ

		const cSq = c * c
		const qSq = q * q
		const lsSq = cSq + qSq
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) {
			throw new Error( '[MeshLineSurfaceGeometry] Surface frame is parallel to a path segment' )
		}
		if ( cSq - qSq <= REVERSAL_SPLIT_DOT * lsSq ) return null
		const ls = Math.sqrt( lsSq )
		if ( c <= EPSILON * ls ) return null

		const invC = 1 / c
		const scale = ls * invC
		if ( scale > maxFiniteScale ) maxFiniteScale = scale

		const curSafeLen = segmentLengths[pointIndex] * safeRatio
		const absQ = Math.abs( q )
		const isFlat = cSq > qSq && 2 * c * absQ <= 1e-8 * lsSq
		if ( !isFlat ) {
			if ( scale > joinLimit ) return null
			const unitInset = absQ * invC
			const insetLen = unitInset * maxHalfWidth
			if ( insetLen > prevSafeLen || insetLen > curSafeLen ) {
				return null
			}
			if ( unitInset > maxUnitInset ) maxUnitInset = unitInset
			if ( scale > maxScale ) maxScale = scale
		}
		prevSafeLen = curSafeLen

		if ( !offsets ) {
			offsets = usePooledLineArrays
				? acquireScratch( 'compactOffsets', pointCount * 3 )
				: new Float64Array( pointCount * 3 )
		}
		offsets[offset] = miterX * scale
		offsets[offset + 1] = miterY * scale
		offsets[offset + 2] = miterZ * scale
	}

	if ( !offsets ) {
		offsets = usePooledLineArrays
			? acquireScratch( 'compactOffsets', pointCount * 3 )
			: new Float64Array( pointCount * 3 )
	}
	if ( !path.closed ) {
		offsets[0] = normals[1] * tangents[2] - normals[2] * tangents[1]
		offsets[1] = normals[2] * tangents[0] - normals[0] * tangents[2]
		offsets[2] = normals[0] * tangents[1] - normals[1] * tangents[0]
		const lastOffset = ( pointCount - 1 ) * 3
		offsets[lastOffset] = normals[lastOffset + 1] * tangents[lastOffset + 2] - normals[lastOffset + 2] * tangents[lastOffset + 1]
		offsets[lastOffset + 1] = normals[lastOffset + 2] * tangents[lastOffset] - normals[lastOffset] * tangents[lastOffset + 2]
		offsets[lastOffset + 2] = normals[lastOffset] * tangents[lastOffset + 1] - normals[lastOffset + 1] * tangents[lastOffset]
	}

	lastJoinMaxScale = maxScale
	lastJoinMaxFiniteScale = maxFiniteScale
	lastJoinMaxUnitInset = maxUnitInset
	return offsets
}

function computeJoinInfos( path, frame, maxHalfWidth = 0, join = DEFAULT_JOIN_OPTIONS ) {
	const pointCount = path.pointCount
	const data = acquireScratch( 'data', pointCount * JOIN_STRIDE )
	const segmentStartSides = acquireScratch( 'segmentStartSides', path.segmentCount * 3 )
	const segmentEndSides = acquireScratch( 'segmentEndSides', path.segmentCount * 3 )
	if ( !path.closed ) {
		data[JOIN_INSET] = 0
		data[( pointCount - 1 ) * JOIN_STRIDE + JOIN_INSET] = 0
	}
	const first = path.closed ? 0 : 1
	const last = path.closed ? pointCount : pointCount - 1
	const isMiterJoin = join.type === 'miter'
	const isRoundJoin = join.type === 'round'
	const joinLimit = join.limit
	const singleSegCos = isRoundJoin ? Math.cos( Math.PI / join.segments ) + 1e-12 : -2
	const hasCusps = path.hasCusps
	const cusps = path.cusps
	const normals = frame.normals
	const tangents = path.tangents
	const directions = path.segmentDirections
	const segmentLengths = path.segmentLengths
	const segmentCount = path.segmentCount
	const safeRatio = 0.45
	const epsSq = EPSILON * EPSILON
	let hasSplit = false
	let hasAliased = false
	let aliasedCount = 0
	let hasMultiSegRound = false
	let maxScale = 0
	let maxFiniteScale = Math.SQRT2
	let maxUnitInset = 0
	let canonicalSafe = true
	const initInIndex = first === 0 ? segmentCount - 1 : first - 1
	const initInOffset = initInIndex * 3
	let inDirX = directions[initInOffset]
	let inDirY = directions[initInOffset + 1]
	let inDirZ = directions[initInOffset + 2]
	let prevSegLen = segmentLengths[initInIndex]

	for ( let pointIndex = first; pointIndex < last; pointIndex++ ) {
		const info = pointIndex * JOIN_STRIDE
		const offset = pointIndex * 3
		const outDirX = directions[offset]
		const outDirY = directions[offset + 1]
		const outDirZ = directions[offset + 2]
		const curSegLen = segmentLengths[pointIndex]
		if ( hasCusps && cusps[pointIndex] ) {
			inDirX = outDirX; inDirY = outDirY; inDirZ = outDirZ
			prevSegLen = curSegLen
			data[info + JOIN_INSET] = 0
			canonicalSafe = false
			continue
		}
		const incomingIndex = pointIndex === 0 ? segmentCount - 1 : pointIndex - 1
		const incomingSideOffset = incomingIndex * 3
		const normalX = normals[offset]
		const normalY = normals[offset + 1]
		const normalZ = normals[offset + 2]
		const tanX = tangents[offset]
		const tanY = tangents[offset + 1]
		const tanZ = tangents[offset + 2]
		let miterX = normalY * tanZ - normalZ * tanY
		let miterY = normalZ * tanX - normalX * tanZ
		let miterZ = normalX * tanY - normalY * tanX

		const c = tanX * outDirX + tanY * outDirY + tanZ * outDirZ
		const q = 0.5 * (
			( outDirX - inDirX ) * miterX +
			( outDirY - inDirY ) * miterY +
			( outDirZ - inDirZ ) * miterZ
		)
		inDirX = outDirX; inDirY = outDirY; inDirZ = outDirZ
		const cSq = c * c
		const qSq = q * q
		const lsSq = cSq + qSq
		if ( !( lsSq > epsSq && lsSq < Infinity ) ) {
			throw new Error( '[MeshLineSurfaceGeometry] Surface frame is parallel to a path segment' )
		}
		const ls = Math.sqrt( lsSq )
		let invLs, invC
		if ( c > EPSILON * ls ) {
			const invLsC = 1 / ( ls * c )
			invLs = c * invLsC
			invC = ls * invLsC
		} else {
			invLs = 1 / ls
			invC = 0
		}

		const cNorm = c * invLs
		const qNorm = q * invLs
		const cmX = miterX * cNorm
		const cmY = miterY * cNorm
		const cmZ = miterZ * cNorm
		const qtX = tanX * qNorm
		const qtY = tanY * qNorm
		const qtZ = tanZ * qNorm

		const incomingSideX = cmX + qtX
		const incomingSideY = cmY + qtY
		const incomingSideZ = cmZ + qtZ
		segmentEndSides[incomingSideOffset] = incomingSideX
		segmentEndSides[incomingSideOffset + 1] = incomingSideY
		segmentEndSides[incomingSideOffset + 2] = incomingSideZ

		segmentStartSides[offset] = cmX - qtX
		segmentStartSides[offset + 1] = cmY - qtY
		segmentStartSides[offset + 2] = cmZ - qtZ

		const cosine = cNorm * cNorm - qNorm * qNorm
		const sine = 2 * cNorm * qNorm
		const absSine = Math.abs( sine )
		const isFlat = cosine > 0 && absSine <= 1e-8
		let scale = Infinity
		let unitInset = 0

		if ( invC === 0 || cosine <= REVERSAL_SPLIT_DOT ) {
			miterX = incomingSideX
			miterY = incomingSideY
			miterZ = incomingSideZ
			hasSplit = true
			canonicalSafe = false
		} else {
			scale = ls * invC
			if ( scale > maxFiniteScale ) maxFiniteScale = scale
			if ( isFlat ) {
				hasAliased = true
				if ( pointIndex > 0 ) aliasedCount++
			} else {
				const withinMiterLimit = scale <= joinLimit
				if ( isMiterJoin && withinMiterLimit ) {
					hasAliased = true
					if ( pointIndex > 0 ) aliasedCount++
				}
				unitInset = Math.abs( q ) * invC
				if ( unitInset > maxUnitInset ) maxUnitInset = unitInset
				if ( scale > maxScale ) maxScale = scale
				if ( canonicalSafe ) {
					const insetLen = unitInset * maxHalfWidth
					if ( insetLen > prevSegLen * safeRatio || insetLen > curSegLen * safeRatio ) {
						canonicalSafe = false
					}
				}
			}
		}
		prevSegLen = curSegLen

		// For round joins, |\sin(\theta)| < |\theta|, so whenever `cosine >= singleSegCos`
		// (`|\theta| < \pi / segments`), storing `sine` instead of `Math.atan2( sine, cosine )`
		// yields the exact same `roundSegs = 1` and `turnSign` without an `atan2` call.
		const belowSingleSegCos = cosine < singleSegCos || pointIndex === 0
		const exactAngleNeeded = isRoundJoin && belowSingleSegCos
		if ( exactAngleNeeded ) hasMultiSegRound = true
		data[info + JOIN_ANGLE] = isFlat ? 0 : ( exactAngleNeeded ? Math.atan2( sine, cosine ) : sine )
		data[info + JOIN_SCALE] = scale
		data[info + JOIN_INSET] = unitInset
		data[info + JOIN_MITER] = miterX
		data[info + JOIN_MITER + 1] = miterY
		data[info + JOIN_MITER + 2] = miterZ
	}

	lastJoinHasSplit = hasSplit
	lastJoinHasAliased = hasAliased
	lastJoinAliasedCount = aliasedCount
	lastJoinHasMultiSegRound = hasMultiSegRound
	lastJoinMaxScale = maxScale
	lastJoinMaxFiniteScale = maxFiniteScale
	lastJoinMaxUnitInset = maxUnitInset
	lastFootprintCanonicalSafe = canonicalSafe
	return data
}

function resolveInnerJoinFootprints( path, joinData, halfWidths, maxHalfWidth, join, lineIndex ) {
	lastFootprintClipped = false
	if ( lastJoinMaxUnitInset === 0 || maxHalfWidth === 0 || lastFootprintCanonicalSafe ) return null

	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null

	if ( join.inner === 'clip' ) {
		if ( 2 * lastJoinMaxUnitInset * maxHalfWidth <= path.minSegmentLength * ( 1 - CLIPPED_INNER_MARGIN ) ) {
			return null
		}
		const factors = acquireScratch( 'footprints', pointCount ).subarray( 0, pointCount )
		factors.fill( 1 )
		let clipped = false
		// Keep every individual footprint strictly inside its adjacent leg, and
		// share available length proportionally when consecutive same-sign turns
		// consume the same body edge.
		for ( let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++ ) {
			const start = segmentIndex
			const end = segmentIndex + 1 === pointCount ? 0 : segmentIndex + 1
			const startInfo = start * JOIN_STRIDE
			const endInfo = end * JOIN_STRIDE
			const startUnitInset = joinData[startInfo + JOIN_INSET]
			const endUnitInset = joinData[endInfo + JOIN_INSET]
			if ( startUnitInset === 0 && endUnitInset === 0 ) continue
			const available = path.segmentLengths[segmentIndex] * ( 1 - CLIPPED_INNER_MARGIN )
			const startWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[start]
			const endWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[end]
			const startReq = startUnitInset * startWidth
			const endReq = endUnitInset * endWidth
			if ( startReq > 0 && endReq > 0 && ( joinData[startInfo + JOIN_ANGLE] > 0 ) === ( joinData[endInfo + JOIN_ANGLE] > 0 ) ) {
				const required = startReq + endReq
				if ( required > available ) {
					const scale = available / required
					if ( scale < factors[start] ) factors[start] = scale
					if ( scale < factors[end] ) factors[end] = scale
					clipped = true
				}
			} else {
				if ( startReq > available ) {
					const scale = available / startReq
					if ( scale < factors[start] ) factors[start] = scale
					clipped = true
				}
				if ( endReq > available ) {
					const scale = available / endReq
					if ( scale < factors[end] ) factors[end] = scale
					clipped = true
				}
			}
		}

		lastFootprintClipped = clipped
		return clipped ? factors : null
	}

	if ( 2 * lastJoinMaxUnitInset * maxHalfWidth <= path.minSegmentLength ) return null

	for ( let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++ ) {
		const start = segmentIndex
		const end = segmentIndex + 1 === pointCount ? 0 : segmentIndex + 1
		const startInfo = start * JOIN_STRIDE
		const endInfo = end * JOIN_STRIDE
		const startUnitInset = joinData[startInfo + JOIN_INSET]
		const endUnitInset = joinData[endInfo + JOIN_INSET]
		if ( startUnitInset === 0 && endUnitInset === 0 ) continue
		const startWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[start]
		const endWidth = constantHalfWidth !== null ? constantHalfWidth : halfWidths[end]
		const startReq = startUnitInset * startWidth
		const endReq = endUnitInset * endWidth
		const sameSide = startReq > 0 && endReq > 0 && ( joinData[startInfo + JOIN_ANGLE] > 0 ) === ( joinData[endInfo + JOIN_ANGLE] > 0 )
		const required = sameSide
			? startReq + endReq
			: ( startReq > endReq ? startReq : endReq )
		const available = path.segmentLengths[segmentIndex]
		const scaledTol = available * 1e-12
		const tolerance = scaledTol > EPSILON ? scaledTol : EPSILON
		if ( required > available + tolerance ) {
			const pointIndex = endUnitInset > 0 ? end : start
			throw new Error(
				`[MeshLineSurfaceGeometry] Exact inner join at point ${pointIndex} of line ${lineIndex} requires ${required} units on segment ${segmentIndex}, but only ${available} are available; lengthen or split the centerline, reduce lineWidth, or use join.inner 'clip'`
			)
		}
	}

	return null
}

function remapBaseAndExtraIndices( extraIndices, extraIndexCount, baseVertices, aliases, used, pairVertices, outExtraIndices ) {
	pairVertices[0] = 0
	pairVertices[2] = 1
	pairVertices[1] = 2
	pairVertices[3] = 3
	used[0] = 0
	used[1] = 2
	used[2] = 1
	used[3] = 3
	let usedBaseCount = 4
	for ( let base = 4, pointIndex = 1; base < baseVertices; base += 4, pointIndex++ ) {
		if ( aliases[pointIndex] ) {
			pairVertices[base] = pairVertices[base - 2]
			pairVertices[base + 2] = usedBaseCount
			used[usedBaseCount++] = base + 2
			pairVertices[base + 1] = pairVertices[base - 1]
			pairVertices[base + 3] = usedBaseCount
			used[usedBaseCount++] = base + 3
		} else {
			pairVertices[base] = usedBaseCount
			used[usedBaseCount++] = base
			pairVertices[base + 2] = usedBaseCount
			used[usedBaseCount++] = base + 2
			pairVertices[base + 1] = usedBaseCount
			used[usedBaseCount++] = base + 1
			pairVertices[base + 3] = usedBaseCount
			used[usedBaseCount++] = base + 3
		}
	}

	// Every extra vertex (`rawVertex >= baseVertices`) emitted by `topoEmitVertex`
	// is referenced in `extraIndices` in strictly ascending order (`baseVertices .. vertexCount - 1`),
	// so its compacted index is always `rawVertex + ( usedBaseCount - baseVertices )`
	// with zero `remap` lookups.
	const extraShift = usedBaseCount - baseVertices
	for ( let offset = 0; offset < extraIndexCount; offset++ ) {
		const rawVertex = extraIndices[offset]
		outExtraIndices[offset] = rawVertex < baseVertices ? pairVertices[rawVertex] : rawVertex + extraShift
	}
	return usedBaseCount
}

function compactPositionsAndNormals( used, usedBaseCount, baseVertices, vertexCount, positions, normals, outPositions, outNormals ) {
	for ( let targetVertex = 0, targetOffset = 0; targetVertex < usedBaseCount; targetVertex++, targetOffset += 3 ) {
		const sourceOffset = used[targetVertex] * 3
		outPositions[targetOffset] = positions[sourceOffset]
		outPositions[targetOffset + 1] = positions[sourceOffset + 1]
		outPositions[targetOffset + 2] = positions[sourceOffset + 2]
		outNormals[targetOffset] = normals[sourceOffset]
		outNormals[targetOffset + 1] = normals[sourceOffset + 1]
		outNormals[targetOffset + 2] = normals[sourceOffset + 2]
	}
	if ( vertexCount > baseVertices ) {
		const start3 = baseVertices * 3
		const end3 = vertexCount * 3
		const dst3 = usedBaseCount * 3
		outPositions.set( positions.subarray( start3, end3 ), dst3 )
		outNormals.set( normals.subarray( start3, end3 ), dst3 )
	}
}

function compactTangents( used, usedBaseCount, baseVertices, vertexCount, tangents, outTangents ) {
	for ( let targetVertex = 0, targetOffset = 0; targetVertex < usedBaseCount; targetVertex++, targetOffset += 3 ) {
		const sourceOffset = used[targetVertex] * 3
		outTangents[targetOffset] = tangents[sourceOffset]
		outTangents[targetOffset + 1] = tangents[sourceOffset + 1]
		outTangents[targetOffset + 2] = tangents[sourceOffset + 2]
	}
	if ( vertexCount > baseVertices ) {
		outTangents.set( tangents.subarray( baseVertices * 3, vertexCount * 3 ), usedBaseCount * 3 )
	}
}

function compactUvs( used, usedBaseCount, baseVertices, vertexCount, uvs, outUvs ) {
	for ( let targetVertex = 0, targetOffset = 0; targetVertex < usedBaseCount; targetVertex++, targetOffset += 2 ) {
		const sourceOffset = used[targetVertex] * 2
		outUvs[targetOffset] = uvs[sourceOffset]
		outUvs[targetOffset + 1] = uvs[sourceOffset + 1]
	}
	if ( vertexCount > baseVertices ) {
		outUvs.set( uvs.subarray( baseVertices * 2, vertexCount * 2 ), usedBaseCount * 2 )
	}
}

function compactScalars( used, usedBaseCount, baseVertices, vertexCount, source, target ) {
	for ( let targetVertex = 0; targetVertex < usedBaseCount; targetVertex++ ) {
		target[targetVertex] = source[used[targetVertex]]
	}
	if ( vertexCount > baseVertices ) {
		target.set( source.subarray( baseVertices, vertexCount ), usedBaseCount )
	}
}

function finalizeVariableTopology(
	positions, normals, tangents, uvs, progress, sides, extraIndices,
	vertexCount, extraIndexCount, segmentCount, baseVertices, aliases, hasAliases,
	closed, usePooledLineArrays
) {
	const indexCount = segmentCount * 6 + extraIndexCount
	if ( !hasAliases ) {
		const sliceOrView = ( array, count ) => {
			if ( !array ) return null
			return usePooledLineArrays ? array.subarray( 0, count ) : array.slice( 0, count )
		}
		return {
			directUnaliased: false,
			joinData: null,
			innerFactors: null,
			positions: sliceOrView( positions, vertexCount * 3 ),
			normals: sliceOrView( normals, vertexCount * 3 ),
			tangents: sliceOrView( tangents, vertexCount * 3 ),
			uvs: sliceOrView( uvs, vertexCount * 2 ),
			progress: sliceOrView( progress, vertexCount ),
			sides: sliceOrView( sides, vertexCount ),
			extraIndices: sliceOrView( extraIndices, extraIndexCount ),
			extraIndexCount,
			pairVertices: null,
			vertexCount,
			indexCount,
			seamPair: closed ? [baseVertices - 2, baseVertices - 1] : null,
		}
	}

	const used = acquireScratch( 'topoUsed', baseVertices )
	const pairVertices = acquireTopoBuffer( 'topoPairVertices', baseVertices, usePooledLineArrays )
	const outExtraIndices = acquireTopoBuffer( 'topoCompactIndices', extraIndexCount, usePooledLineArrays )
	const usedBaseCount = remapBaseAndExtraIndices( extraIndices, extraIndexCount, baseVertices, aliases, used, pairVertices, outExtraIndices )
	const usedCount = usedBaseCount + ( vertexCount - baseVertices )

	const outPositions = acquireTopoBuffer( 'topoCompactPositions', usedCount * 3, usePooledLineArrays )
	const outNormals = acquireTopoBuffer( 'topoCompactNormals', usedCount * 3, usePooledLineArrays )
	compactPositionsAndNormals( used, usedBaseCount, baseVertices, vertexCount, positions, normals, outPositions, outNormals )

	let outTangents = null
	if ( tangents ) {
		outTangents = acquireTopoBuffer( 'topoCompactTangents', usedCount * 3, usePooledLineArrays )
		compactTangents( used, usedBaseCount, baseVertices, vertexCount, tangents, outTangents )
	}

	let outUvs = null
	if ( uvs ) {
		outUvs = acquireTopoBuffer( 'topoCompactUvs', usedCount * 2, usePooledLineArrays )
		compactUvs( used, usedBaseCount, baseVertices, vertexCount, uvs, outUvs )
	}

	let outProgress = null
	if ( progress ) {
		outProgress = acquireTopoBuffer( 'topoCompactProgress', usedCount, usePooledLineArrays )
		compactScalars( used, usedBaseCount, baseVertices, vertexCount, progress, outProgress )
	}

	let outSides = null
	if ( sides ) {
		outSides = acquireTopoBuffer( 'topoCompactSides', usedCount, usePooledLineArrays )
		compactScalars( used, usedBaseCount, baseVertices, vertexCount, sides, outSides )
	}

	const seamPair = closed
		? [pairVertices[baseVertices - 2], pairVertices[baseVertices - 1]]
		: null

	return {
		directUnaliased: false,
		joinData: null,
		innerFactors: null,
		positions: outPositions,
		normals: outNormals,
		tangents: outTangents,
		uvs: outUvs,
		progress: outProgress,
		sides: outSides,
		extraIndices: outExtraIndices,
		extraIndexCount,
		pairVertices,
		vertexCount: usedCount,
		indexCount,
		seamPair,
	}
}

function writeSegmentSide( target, targetOffset, normals, normalOffset, directions, directionOffset ) {
	const normalX = normals[normalOffset]
	const normalY = normals[normalOffset + 1]
	const normalZ = normals[normalOffset + 2]
	const directionX = directions[directionOffset]
	const directionY = directions[directionOffset + 1]
	const directionZ = directions[directionOffset + 2]
	let sideX = normalY * directionZ - normalZ * directionY
	let sideY = normalZ * directionX - normalX * directionZ
	let sideZ = normalX * directionY - normalY * directionX
	const length = hypot3( sideX, sideY, sideZ )
	if ( !Number.isFinite( length ) || length <= EPSILON ) {
		throw new Error( '[MeshLineSurfaceGeometry] Surface frame is parallel to a path segment' )
	}
	const inverseLength = 1 / length
	sideX *= inverseLength
	sideY *= inverseLength
	sideZ *= inverseLength
	target[targetOffset] = sideX
	target[targetOffset + 1] = sideY
	target[targetOffset + 2] = sideZ
}

const halfTurnTrigTables = new Map()

function getHalfTurnTrigTable( segments ) {
	let table = halfTurnTrigTables.get( segments )
	if ( table ) return table
	table = new Float64Array( segments * 2 )
	const step = Math.PI / segments
	for ( let s = 1, offset = 2; s < segments; s++, offset += 2 ) {
		const angle = step * s
		table[offset] = Math.cos( angle )
		table[offset + 1] = Math.sin( angle )
	}
	if ( segments <= 256 ) halfTurnTrigTables.set( segments, table )
	return table
}

function emitRoundJoin(
	state,
	pointIndex, pivot, outerStart, outerEnd, outerSlot,
	centerX, centerY, centerZ, angle, normalX, normalY, normalZ, segmentCount
) {
	if ( state.vertexCount + segmentCount - 1 > state.vertexCapacity ) {
		topoEnsureVertexCapacity( state, state.vertexCount + segmentCount - 1 )
	}
	if ( state.indexCount + segmentCount * 3 > state.indexCapacity ) {
		topoEnsureIndexCapacity( state, state.indexCount + segmentCount * 3 )
	}
	const positions = state.positions
	const sourceStart = outerStart * 3
	const startRadialX = positions[sourceStart] - centerX
	const startRadialY = positions[sourceStart + 1] - centerY
	const startRadialZ = positions[sourceStart + 2] - centerZ
	const crossX = normalY * startRadialZ - normalZ * startRadialY
	const crossY = normalZ * startRadialX - normalX * startRadialZ
	const crossZ = normalX * startRadialY - normalY * startRadialX
	const dot = normalX * startRadialX + normalY * startRadialY + normalZ * startRadialZ
	const axisDotX = normalX * dot
	const axisDotY = normalY * dot
	const axisDotZ = normalZ * dot
	const baseX = centerX + axisDotX
	const baseY = centerY + axisDotY
	const baseZ = centerZ + axisDotZ
	const radX = startRadialX - axisDotX
	const radY = startRadialY - axisDotY
	const radZ = startRadialZ - axisDotZ
	const outerSide = outerSlot === 0 ? -1 : 1
	const positiveTurn = angle > 0
	const stepDelta = angle / segmentCount
	const stepCos = Math.cos( stepDelta )
	const stepSin = Math.sin( stepDelta )
	let cosine = stepCos
	let sine = stepSin
	let prevVertex = outerStart
	for ( let segment = 1; segment < segmentCount; segment++ ) {
		const nextVertex = topoEmitVertex(
			state, pointIndex,
			baseX + radX * cosine + crossX * sine,
			baseY + radY * cosine + crossY * sine,
			baseZ + radZ * cosine + crossZ * sine,
			outerSide
		)
		if ( positiveTurn ) topoPushTriangle( state, pivot, prevVertex, nextVertex )
		else topoPushTriangle( state, pivot, nextVertex, prevVertex )
		prevVertex = nextVertex
		const nextCos = cosine * stepCos - sine * stepSin
		sine = sine * stepCos + cosine * stepSin
		cosine = nextCos
	}
	if ( positiveTurn ) topoPushTriangle( state, pivot, prevVertex, outerEnd )
	else topoPushTriangle( state, pivot, outerEnd, prevVertex )
}

function emitSeamJoin(
	state,
	pointIndex, incomingOuter, outgoingOuter, innerSlot, outerSlot,
	centerX, centerY, centerZ, innerX, innerY, innerZ, angle, normalX, normalY, normalZ, join, seamU
) {
	const positions = state.positions
	const startOffset = incomingOuter * 3
	const endOffset = outgoingOuter * 3
	const startPosX = positions[startOffset]
	const startPosY = positions[startOffset + 1]
	const startPosZ = positions[startOffset + 2]
	const endPosX = positions[endOffset]
	const endPosY = positions[endOffset + 1]
	const endPosZ = positions[endOffset + 2]
	const pivot = topoEmitVertex( state, pointIndex, innerX, innerY, innerZ, innerSlot === 0 ? -1 : 1, seamU, 1 )
	const outerSide = outerSlot === 0 ? -1 : 1
	const positiveTurn = angle > 0
	let prevVertex = topoEmitVertex(
		state, pointIndex,
		startPosX, startPosY, startPosZ,
		outerSide, seamU, 1
	)
	if ( join.type === 'round' ) {
		const segmentCount = getRoundJoinSegmentCount( angle, join.segments )
		if ( state.vertexCount + segmentCount > state.vertexCapacity ) {
			topoEnsureVertexCapacity( state, state.vertexCount + segmentCount )
		}
		if ( state.indexCount + segmentCount * 3 > state.indexCapacity ) {
			topoEnsureIndexCapacity( state, state.indexCount + segmentCount * 3 )
		}
		const startRadialX = startPosX - centerX
		const startRadialY = startPosY - centerY
		const startRadialZ = startPosZ - centerZ
		const crossX = normalY * startRadialZ - normalZ * startRadialY
		const crossY = normalZ * startRadialX - normalX * startRadialZ
		const crossZ = normalX * startRadialY - normalY * startRadialX
		const dot = normalX * startRadialX + normalY * startRadialY + normalZ * startRadialZ
		const axisDotX = normalX * dot
		const axisDotY = normalY * dot
		const axisDotZ = normalZ * dot
		const baseX = centerX + axisDotX
		const baseY = centerY + axisDotY
		const baseZ = centerZ + axisDotZ
		const radX = startRadialX - axisDotX
		const radY = startRadialY - axisDotY
		const radZ = startRadialZ - axisDotZ
		const stepDelta = angle / segmentCount
		const stepCos = Math.cos( stepDelta )
		const stepSin = Math.sin( stepDelta )
		let cosine = stepCos
		let sine = stepSin
		for ( let segment = 1; segment < segmentCount; segment++ ) {
			const nextVertex = topoEmitVertex(
				state, pointIndex,
				baseX + radX * cosine + crossX * sine,
				baseY + radY * cosine + crossY * sine,
				baseZ + radZ * cosine + crossZ * sine,
				outerSide, seamU, 1
			)
			if ( positiveTurn ) topoPushTriangle( state, pivot, prevVertex, nextVertex )
			else topoPushTriangle( state, pivot, nextVertex, prevVertex )
			prevVertex = nextVertex
			const nextCos = cosine * stepCos - sine * stepSin
			sine = sine * stepCos + cosine * stepSin
			cosine = nextCos
		}
	}
	const endVertex = topoEmitVertex(
		state, pointIndex,
		endPosX, endPosY, endPosZ,
		outerSide, seamU, 1
	)
	if ( positiveTurn ) topoPushTriangle( state, pivot, prevVertex, endVertex )
	else topoPushTriangle( state, pivot, endVertex, prevVertex )
}

function getRoundJoinSegmentCount( angle, halfTurnBudget ) {
	return Math.max( 1, Math.ceil( Math.abs( angle ) / Math.PI * halfTurnBudget ) )
}

function emitCap(
	isEnd, pointIndex, segmentIndex, path, frame, width, surface, cap,
	state, internal = false
) {
	if ( cap.type === 'butt' ) return
	const positions = state.positions
	const pairLeft = isEnd ? segmentIndex * 4 + 2 : segmentIndex * 4
	const pairRight = pairLeft + 1
	const directionSign = isEnd ? 1 : -1
	const seg3 = segmentIndex * 3
	const dirX = path.segmentDirections[seg3]
	const dirY = path.segmentDirections[seg3 + 1]
	const dirZ = path.segmentDirections[seg3 + 2]
	const sideSource = isEnd ? joinScratch.segmentEndSides : joinScratch.segmentStartSides
	const sideX = sideSource[seg3]
	const sideY = sideSource[seg3 + 1]
	const sideZ = sideSource[seg3 + 2]
	const pointOffset = pointIndex * 3
	const centerX = path.points[pointOffset]
	const centerY = path.points[pointOffset + 1]
	const centerZ = path.points[pointOffset + 2]
	const seamEndpoint = internal && path.closed && pointIndex === 0 && isEnd
	const baseU = state.uvs
		? ( seamEndpoint
			? ( surface.uvMode === 'stretch' ? 1 : path.totalLength / surface.uvScale )
			: ( surface.uvMode === 'stretch' ? path.progress[pointIndex] : path.distances[pointIndex] / surface.uvScale ) )
		: 0
	const endpointProgress = state.progress ? ( seamEndpoint ? 1 : path.progress[pointIndex] ) : 0

	if ( cap.type === 'square' ) {
		const u = state.uvs && surface.uvMode === 'distance' ? baseU + directionSign * width / surface.uvScale : baseU
		const leftOffset = pairLeft * 3
		const rightOffset = pairRight * 3
		const lpx = positions[leftOffset]
		const lpy = positions[leftOffset + 1]
		const lpz = positions[leftOffset + 2]
		const rpx = positions[rightOffset]
		const rpy = positions[rightOffset + 1]
		const rpz = positions[rightOffset + 2]
		const stepX = dirX * width * directionSign
		const stepY = dirY * width * directionSign
		const stepZ = dirZ * width * directionSign
		const left = topoEmitVertex(
			state, pointIndex,
			lpx + stepX, lpy + stepY, lpz + stepZ,
			-1, u, endpointProgress
		)
		const right = topoEmitVertex(
			state, pointIndex,
			rpx + stepX, rpy + stepY, rpz + stepZ,
			1, u, endpointProgress
		)
		if ( isEnd ) {
			topoPushTriangle( state, pairLeft, left, pairRight )
			topoPushTriangle( state, pairRight, left, right )
		} else {
			topoPushTriangle( state, left, pairLeft, right )
			topoPushTriangle( state, right, pairLeft, pairRight )
		}
		return
	}

	const capSegments = cap.segments
	if ( state.vertexCount + capSegments > state.vertexCapacity ) {
		topoEnsureVertexCapacity( state, state.vertexCount + capSegments )
	}
	if ( state.indexCount + capSegments * 3 > state.indexCapacity ) {
		topoEnsureIndexCapacity( state, state.indexCount + capSegments * 3 )
	}
	const leftOffset = pairLeft * 3
	const startRadialX = positions[leftOffset] - centerX
	const startRadialY = positions[leftOffset + 1] - centerY
	const startRadialZ = positions[leftOffset + 2] - centerZ
	const pivot = topoEmitVertex( state, pointIndex, centerX, centerY, centerZ, 0, baseU, endpointProgress )
	const normalX = frame.normals[pointOffset]
	const normalY = frame.normals[pointOffset + 1]
	const normalZ = frame.normals[pointOffset + 2]
	const crossX = normalY * startRadialZ - normalZ * startRadialY
	const crossY = normalZ * startRadialX - normalX * startRadialZ
	const crossZ = normalX * startRadialY - normalY * startRadialX
	const dot = normalX * startRadialX + normalY * startRadialY + normalZ * startRadialZ
	const axisDotX = normalX * dot
	const axisDotY = normalY * dot
	const axisDotZ = normalZ * dot
	const radX = startRadialX - axisDotX
	const radY = startRadialY - axisDotY
	const radZ = startRadialZ - axisDotZ
	const capTrig = getHalfTurnTrigTable( capSegments )
	const invWidth = width > EPSILON ? 1 / width : 0
	const distanceUv = state.uvs && surface.uvMode === 'distance'
	const invUvScale = distanceUv ? 1 / surface.uvScale : 0
	let prevVertex = pairLeft
	for ( let capSegment = 1, trigOffset = 2; capSegment < capSegments; capSegment++, trigOffset += 2 ) {
		const cosine = capTrig[trigOffset]
		const sine = isEnd ? capTrig[trigOffset + 1] : -capTrig[trigOffset + 1]
		const rx = axisDotX + radX * cosine + crossX * sine
		const ry = axisDotY + radY * cosine + crossY * sine
		const rz = axisDotZ + radZ * cosine + crossZ * sine
		const sideCoordinate = ( rx * sideX + ry * sideY + rz * sideZ ) * invWidth
		const u = distanceUv ? baseU + ( rx * dirX + ry * dirY + rz * dirZ ) * invUvScale : baseU
		const nextVertex = topoEmitVertex(
			state, pointIndex,
			centerX + rx, centerY + ry, centerZ + rz,
			sideCoordinate, u, endpointProgress
		)
		if ( isEnd ) topoPushTriangle( state, pivot, prevVertex, nextVertex )
		else topoPushTriangle( state, pivot, nextVertex, prevVertex )
		prevVertex = nextVertex
	}
	if ( isEnd ) topoPushTriangle( state, pivot, prevVertex, pairRight )
	else topoPushTriangle( state, pivot, pairRight, prevVertex )
}

/**
 * Three-component `Math.hypot` without the variadic builtin call. V8's builtin
 * allocates an argument array per call, which dominated the frame, offset, and
 * join passes on long paths. This follows the same algorithm step for step
 * (max-normalized Kahan sum, then `sqrt( sum ) * max`), so results stay
 * bit-identical to V8's `Math.hypot` and are deterministic across engines.
 */
function hypot3( x, y, z ) {
	const sumSq = x * x + y * y + z * z
	if ( sumSq > 1e-300 && sumSq < Infinity ) return Math.sqrt( sumSq )
	if ( sumSq === 0 ) return 0
	const absX = Math.abs( x )
	const absY = Math.abs( y )
	const absZ = Math.abs( z )
	if ( absX === Infinity || absY === Infinity || absZ === Infinity ) return Infinity
	if ( absX !== absX || absY !== absY || absZ !== absZ ) return NaN
	const max = Math.max( absX, absY, absZ )
	if ( max === 0 ) return 0
	const normalizedX = absX / max
	const normalizedY = absY / max
	const normalizedZ = absZ / max
	return Math.sqrt( normalizedX * normalizedX + normalizedY * normalizedY + normalizedZ * normalizedZ ) * max
}

let lastMinSegmentLength = Infinity
let lastPathHasCusps = false
let lastMaxCoordMagnitude = 0

function computeSegmentMetricsAndTangents(
	points, pointCount,
	segmentDirections, segmentLengths, distances, tangents, cusps,
	allowFallback = false
) {
	if ( distances ) distances[0] = 0
	const openSegments = pointCount - 1
	const p0x = points[0], p0y = points[1], p0z = points[2]
	let prevX = points[3], prevY = points[4], prevZ = points[5]
	const ax0 = Math.abs( p0x ), ay0 = Math.abs( p0y ), az0 = Math.abs( p0z )
	const ax1 = Math.abs( prevX ), ay1 = Math.abs( prevY ), az1 = Math.abs( prevZ )
	let maxMag = Math.max(
		ax0 > ay0 ? ( ax0 > az0 ? ax0 : az0 ) : ( ay0 > az0 ? ay0 : az0 ),
		ax1 > ay1 ? ( ax1 > az1 ? ax1 : az1 ) : ( ay1 > az1 ? ay1 : az1 )
	)
	const dx0 = prevX - p0x
	const dy0 = prevY - p0y
	const dz0 = prevZ - p0z
	const len0Sq = dx0 * dx0 + dy0 * dy0 + dz0 * dz0
	const len0 = ( len0Sq > 1e-300 && len0Sq < Infinity ) ? Math.sqrt( len0Sq ) : hypot3( dx0, dy0, dz0 )
	if ( !( len0 > 0 && len0 < Infinity ) ) {
		if ( allowFallback ) return -1
		throw new Error( '[MeshLineSurfaceGeometry] Degenerate segment at index 0' )
	}
	const invLen0 = 1 / len0
	const firstX = dx0 * invLen0
	const firstY = dy0 * invLen0
	const firstZ = dz0 * invLen0
	segmentDirections[0] = firstX
	segmentDirections[1] = firstY
	segmentDirections[2] = firstZ
	tangents[0] = firstX
	tangents[1] = firstY
	tangents[2] = firstZ
	segmentLengths[0] = len0
	let minLen = len0
	let totalLength = len0
	if ( distances ) distances[1] = totalLength

	let inX = firstX, inY = firstY, inZ = firstZ
	let hasCusps = false
	const epsSq = EPSILON * EPSILON

	for ( let i = 1, offset = 3; i < openSegments; i++, offset += 3 ) {
		const nextOffset = offset + 3
		const nx = points[nextOffset]
		const ny = points[nextOffset + 1]
		const nz = points[nextOffset + 2]
		const ax = Math.abs( nx ), ay = Math.abs( ny ), az = Math.abs( nz )
		const ptMag = ax > ay ? ( ax > az ? ax : az ) : ( ay > az ? ay : az )
		if ( ptMag > maxMag ) maxMag = ptMag
		const dx = nx - prevX
		const dy = ny - prevY
		const dz = nz - prevZ
		const lenSq = dx * dx + dy * dy + dz * dz
		const length = ( lenSq > 1e-300 && lenSq < Infinity ) ? Math.sqrt( lenSq ) : hypot3( dx, dy, dz )

		if ( !( length > 0 && length < Infinity ) ) {
			if ( allowFallback ) return -1
			throw new Error( `[MeshLineSurfaceGeometry] Degenerate segment at index ${i}` )
		}

		const invLength = 1 / length
		const outX = dx * invLength
		const outY = dy * invLength
		const outZ = dz * invLength
		segmentDirections[offset] = outX
		segmentDirections[offset + 1] = outY
		segmentDirections[offset + 2] = outZ
		segmentLengths[i] = length
		if ( length < minLen ) minLen = length
		totalLength += length
		if ( distances ) distances[i + 1] = totalLength

		const sumX = inX + outX
		const sumY = inY + outY
		const sumZ = inZ + outZ
		const sumLenSq = sumX * sumX + sumY * sumY + sumZ * sumZ
		if ( sumLenSq <= epsSq ) {
			tangents[offset] = outX
			tangents[offset + 1] = outY
			tangents[offset + 2] = outZ
			if ( !hasCusps ) {
				cusps.fill( 0, 0, pointCount )
				hasCusps = true
			}
			cusps[i] = 1
		} else {
			const inverseSum = 1 / Math.sqrt( sumLenSq )
			tangents[offset] = sumX * inverseSum
			tangents[offset + 1] = sumY * inverseSum
			tangents[offset + 2] = sumZ * inverseSum
		}

		inX = outX; inY = outY; inZ = outZ
		prevX = nx; prevY = ny; prevZ = nz
	}

	lastMaxCoordMagnitude = maxMag
	lastMinSegmentLength = minLen
	lastPathHasCusps = hasCusps
	return totalLength
}

function closeSegmentMetricsAndTangents(
	points, pointCount,
	segmentDirections, segmentLengths, tangents, cusps,
	totalLength, allowFallback
) {
	const i = pointCount - 1
	const offset = i * 3
	const dx = points[0] - points[offset]
	const dy = points[1] - points[offset + 1]
	const dz = points[2] - points[offset + 2]
	const lenSq = dx * dx + dy * dy + dz * dz
	const length = ( lenSq > 1e-300 && lenSq < Infinity ) ? Math.sqrt( lenSq ) : hypot3( dx, dy, dz )

	if ( !( length > 0 && length < Infinity ) ) {
		if ( allowFallback ) return -1
		throw new Error( `[MeshLineSurfaceGeometry] Degenerate segment at index ${i}` )
	}

	const invLength = 1 / length
	const outX = dx * invLength
	const outY = dy * invLength
	const outZ = dz * invLength
	segmentDirections[offset] = outX
	segmentDirections[offset + 1] = outY
	segmentDirections[offset + 2] = outZ
	segmentLengths[i] = length
	if ( length < lastMinSegmentLength ) lastMinSegmentLength = length
	totalLength += length

	const epsSq = EPSILON * EPSILON
	const prevSegOffset = offset - 3
	const inX = segmentDirections[prevSegOffset]
	const inY = segmentDirections[prevSegOffset + 1]
	const inZ = segmentDirections[prevSegOffset + 2]
	const sumLastX = inX + outX
	const sumLastY = inY + outY
	const sumLastZ = inZ + outZ
	const sumLastLenSq = sumLastX * sumLastX + sumLastY * sumLastY + sumLastZ * sumLastZ
	if ( sumLastLenSq <= epsSq ) {
		tangents[offset] = outX
		tangents[offset + 1] = outY
		tangents[offset + 2] = outZ
		if ( !lastPathHasCusps ) {
			cusps.fill( 0, 0, pointCount )
			lastPathHasCusps = true
		}
		cusps[i] = 1
	} else {
		const invLast = 1 / Math.sqrt( sumLastLenSq )
		tangents[offset] = sumLastX * invLast
		tangents[offset + 1] = sumLastY * invLast
		tangents[offset + 2] = sumLastZ * invLast
	}

	const firstX = segmentDirections[0]
	const firstY = segmentDirections[1]
	const firstZ = segmentDirections[2]
	const sum0X = outX + firstX
	const sum0Y = outY + firstY
	const sum0Z = outZ + firstZ
	const sum0LenSq = sum0X * sum0X + sum0Y * sum0Y + sum0Z * sum0Z
	if ( sum0LenSq <= epsSq ) {
		tangents[0] = firstX
		tangents[1] = firstY
		tangents[2] = firstZ
		if ( !lastPathHasCusps ) {
			cusps.fill( 0, 0, pointCount )
			lastPathHasCusps = true
		}
		cusps[0] = 1
	} else {
		const inv0 = 1 / Math.sqrt( sum0LenSq )
		tangents[0] = sum0X * inv0
		tangents[1] = sum0Y * inv0
		tangents[2] = sum0Z * inv0
	}

	return totalLength
}

function computePathData( points, closed, usePooledLineArrays = false, needsDistancesArray = true, needsProgressArray = true, allowFallback = false ) {
	const pointCount = points.length / 3
	const segmentCount = closed ? pointCount : pointCount - 1
	const segmentDirections = acquireScratch( 'segmentDirections', segmentCount * 3 )
	const segmentLengths = acquireScratch( 'segmentLengths', segmentCount )
	const distances = needsDistancesArray
		? ( usePooledLineArrays ? acquireScratch( 'pathDistances', pointCount ) : new Float64Array( pointCount ) )
		: null
	const progress = needsProgressArray
		? ( usePooledLineArrays ? acquireScratch( 'pathProgress', pointCount ) : new Float64Array( pointCount ) )
		: null
	const tangents = usePooledLineArrays
		? acquireScratch( 'pathTangents', pointCount * 3 )
		: new Float64Array( pointCount * 3 )
	const cusps = acquireScratch( 'cusps', pointCount )

	let totalLength = computeSegmentMetricsAndTangents(
		points, pointCount,
		segmentDirections, segmentLengths, distances, tangents, cusps,
		allowFallback
	)
	if ( allowFallback && totalLength < 0 ) return null
	if ( closed ) {
		totalLength = closeSegmentMetricsAndTangents(
			points, pointCount,
			segmentDirections, segmentLengths, tangents, cusps,
			totalLength, allowFallback
		)
		if ( allowFallback && totalLength < 0 ) return null
	} else {
		const lastSegOffset = ( pointCount - 2 ) * 3
		const lastTangentOffset = ( pointCount - 1 ) * 3
		tangents[lastTangentOffset] = segmentDirections[lastSegOffset]
		tangents[lastTangentOffset + 1] = segmentDirections[lastSegOffset + 1]
		tangents[lastTangentOffset + 2] = segmentDirections[lastSegOffset + 2]
	}
	if ( allowFallback ) {
		const scaledEps = lastMaxCoordMagnitude * Number.EPSILON * 4
		const epsilon = scaledEps > DUPLICATE_EPSILON ? scaledEps : DUPLICATE_EPSILON
		if ( !( lastMaxCoordMagnitude < Infinity ) || lastMinSegmentLength <= epsilon ) return null
	}
	if ( !( totalLength > 0 && totalLength < Infinity ) ) {
		throw new Error( '[MeshLineSurfaceGeometry] Line length must be greater than zero' )
	}
	if ( progress ) {
		const invTotalLength = 1 / totalLength
		progress[0] = 0
		for ( let i = 1; i < pointCount; i++ ) {
			progress[i] = distances[i] * invTotalLength
		}
	}

	return {
		points,
		closed,
		pointCount,
		segmentCount,
		segmentDirections,
		segmentLengths,
		minSegmentLength: lastMinSegmentLength,
		distances,
		progress,
		tangents,
		cusps,
		hasCusps: lastPathHasCusps,
		totalLength,
	}
}

function computeFixedUpNormals( normals, tangents, pointCount, upX, upY, upZ ) {
	const candidate = frameCandidateScratch
	const epsSq = EPSILON * EPSILON
	let previousNormalX = normals[0]
	let previousNormalY = normals[1]
	let previousNormalZ = normals[2]
	for ( let i = 1, offset = 3; i < pointCount; i++, offset += 3 ) {
		const tangentX = tangents[offset]
		const tangentY = tangents[offset + 1]
		const tangentZ = tangents[offset + 2]
		const proj = tangentX * upX + tangentY * upY + tangentZ * upZ
		const cx = upX - tangentX * proj
		const cy = upY - tangentY * proj
		const cz = upZ - tangentZ * proj
		const cLenSq = cx * cx + cy * cy + cz * cz
		if ( cLenSq > epsSq && cLenSq < Infinity ) {
			const cLen = Math.sqrt( cLenSq )
			const invCLen = ( cx * previousNormalX + cy * previousNormalY + cz * previousNormalZ < 0 ) ? -1 / cLen : 1 / cLen
			const hintX = cx * invCLen
			const hintY = cy * invCLen
			const hintZ = cz * invCLen
			const proj2 = tangentX * hintX + tangentY * hintY + tangentZ * hintZ
			const nx = hintX - tangentX * proj2
			const ny = hintY - tangentY * proj2
			const nz = hintZ - tangentZ * proj2
			const nLenSq = nx * nx + ny * ny + nz * nz
			if ( nLenSq > epsSq && nLenSq < Infinity ) {
				const invNLen = nLenSq > 0.999999 && nLenSq < 1.000001 ? 1.5 - 0.5 * nLenSq : 1 / Math.sqrt( nLenSq )
				previousNormalX = nx * invNLen
				previousNormalY = ny * invNLen
				previousNormalZ = nz * invNLen
				normals[offset] = previousNormalX
				normals[offset + 1] = previousNormalY
				normals[offset + 2] = previousNormalZ
				continue
			}
		}
		if ( !projectNormalScalar( candidate, tangentX, tangentY, tangentZ, upX, upY, upZ ) ) {
			if ( !projectNormalScalar( candidate, tangentX, tangentY, tangentZ, previousNormalX, previousNormalY, previousNormalZ ) ) {
				seedNormalScalar( candidate, tangentX, tangentY, tangentZ, upX, upY, upZ )
			}
		}
		if ( candidate[0] * previousNormalX + candidate[1] * previousNormalY + candidate[2] * previousNormalZ < 0 ) {
			candidate[0] = -candidate[0]
			candidate[1] = -candidate[1]
			candidate[2] = -candidate[2]
		}
		writeOrthonormalFrameScalar(
			normals, offset,
			tangentX, tangentY, tangentZ,
			candidate[0], candidate[1], candidate[2]
		)
		previousNormalX = normals[offset]
		previousNormalY = normals[offset + 1]
		previousNormalZ = normals[offset + 2]
	}
}

function computeTransportNormals( normals, tangents, pointCount ) {
	const epsSq = EPSILON * EPSILON
	let prevNormalX = normals[0], prevNormalY = normals[1], prevNormalZ = normals[2]
	let prevTangentX = tangents[0], prevTangentY = tangents[1], prevTangentZ = tangents[2]
	for ( let i = 1, offset = 3; i < pointCount; i++, offset += 3 ) {
		const tangentX = tangents[offset]
		const tangentY = tangents[offset + 1]
		const tangentZ = tangents[offset + 2]
		const rawDot = prevTangentX * tangentX + prevTangentY * tangentY + prevTangentZ * tangentZ
		if ( rawDot > -0.999999 ) {
			const k = ( tangentX * prevNormalX + tangentY * prevNormalY + tangentZ * prevNormalZ ) / ( 1 + rawDot )
			const candX = prevNormalX - ( prevTangentX + tangentX ) * k
			const candY = prevNormalY - ( prevTangentY + tangentY ) * k
			const candZ = prevNormalZ - ( prevTangentZ + tangentZ ) * k
			const projection = tangentX * candX + tangentY * candY + tangentZ * candZ
			const normalX = candX - tangentX * projection
			const normalY = candY - tangentY * projection
			const normalZ = candZ - tangentZ * projection
			const invLen = 1.5 - 0.5 * ( normalX * normalX + normalY * normalY + normalZ * normalZ )
			prevNormalX = normalX * invLen
			prevNormalY = normalY * invLen
			prevNormalZ = normalZ * invLen
			normals[offset] = prevNormalX
			normals[offset + 1] = prevNormalY
			normals[offset + 2] = prevNormalZ
			prevTangentX = tangentX
			prevTangentY = tangentY
			prevTangentZ = tangentZ
			continue
		}
		const axisX = prevTangentY * tangentZ - prevTangentZ * tangentY
		const axisY = prevTangentZ * tangentX - prevTangentX * tangentZ
		const axisZ = prevTangentX * tangentY - prevTangentY * tangentX
		const sinAngleSq = axisX * axisX + axisY * axisY + axisZ * axisZ
		let candX = prevNormalX
		let candY = prevNormalY
		let candZ = prevNormalZ
		if ( sinAngleSq > epsSq ) {
			const cosAngle = rawDot < -1 ? -1 : rawDot
			const crossX = axisY * prevNormalZ - axisZ * prevNormalY
			const crossY = axisZ * prevNormalX - axisX * prevNormalZ
			const crossZ = axisX * prevNormalY - axisY * prevNormalX
			const axisScale = ( axisX * prevNormalX + axisY * prevNormalY + axisZ * prevNormalZ ) * ( 1 - cosAngle ) / sinAngleSq
			candX = prevNormalX * cosAngle + crossX + axisX * axisScale
			candY = prevNormalY * cosAngle + crossY + axisY * axisScale
			candZ = prevNormalZ * cosAngle + crossZ + axisZ * axisScale
		}
		const projection = tangentX * candX + tangentY * candY + tangentZ * candZ
		const normalX = candX - tangentX * projection
		const normalY = candY - tangentY * projection
		const normalZ = candZ - tangentZ * projection
		const normalLenSq = normalX * normalX + normalY * normalY + normalZ * normalZ
		if ( normalLenSq > epsSq && normalLenSq < Infinity ) {
			const invLen = 1 / Math.sqrt( normalLenSq )
			prevNormalX = normalX * invLen
			prevNormalY = normalY * invLen
			prevNormalZ = normalZ * invLen
			normals[offset] = prevNormalX
			normals[offset + 1] = prevNormalY
			normals[offset + 2] = prevNormalZ
		} else {
			writeOrthonormalFrameScalar(
				normals, offset,
				tangentX, tangentY, tangentZ,
				candX, candY, candZ
			)
			prevNormalX = normals[offset]
			prevNormalY = normals[offset + 1]
			prevNormalZ = normals[offset + 2]
		}
		prevTangentX = tangentX
		prevTangentY = tangentY
		prevTangentZ = tangentZ
	}
}

function closeTransportNormals( normals, tangents, progress, pointCount ) {
	const candidate = frameCandidateScratch
	const lastOffset = ( pointCount - 1 ) * 3
	transportNormalScalar(
		candidate,
		normals[lastOffset], normals[lastOffset + 1], normals[lastOffset + 2],
		tangents[lastOffset], tangents[lastOffset + 1], tangents[lastOffset + 2],
		tangents[0], tangents[1], tangents[2]
	)
	const endNormals = frameEndNormalsScratch
	writeOrthonormalFrameScalar(
		endNormals, 0,
		tangents[0], tangents[1], tangents[2],
		candidate[0], candidate[1], candidate[2]
	)
	const crossX = endNormals[1] * normals[2] - endNormals[2] * normals[1]
	const crossY = endNormals[2] * normals[0] - endNormals[0] * normals[2]
	const crossZ = endNormals[0] * normals[1] - endNormals[1] * normals[0]
	const residual = Math.atan2(
		tangents[0] * crossX + tangents[1] * crossY + tangents[2] * crossZ,
		clamp( endNormals[0] * normals[0] + endNormals[1] * normals[1] + endNormals[2] * normals[2], -1, 1 )
	)

	for ( let i = 1; i < pointCount; i++ ) {
		const offset = i * 3
		rotateVectorAroundAxisScalar(
			candidate,
			normals[offset], normals[offset + 1], normals[offset + 2],
			tangents[offset], tangents[offset + 1], tangents[offset + 2],
			residual * progress[i]
		)
		writeOrthonormalFrameScalar(
			normals, offset,
			tangents[offset], tangents[offset + 1], tangents[offset + 2],
			candidate[0], candidate[1], candidate[2]
		)
	}
}

function applyFrameBanking( normals, tangents, progress, pointCount, bank, constantBank, lineIndex ) {
	const candidate = frameCandidateScratch
	for ( let i = 0; i < pointCount; i++ ) {
		const offset = i * 3
		const angle = constantBank ?? resolveBank( bank, progress ? progress[i] : 0, i, lineIndex )
		if ( Math.abs( angle ) <= EPSILON ) continue

		rotateVectorAroundAxisScalar(
			candidate,
			normals[offset], normals[offset + 1], normals[offset + 2],
			tangents[offset], tangents[offset + 1], tangents[offset + 2],
			angle
		)
		writeOrthonormalFrameScalar(
			normals, offset,
			tangents[offset], tangents[offset + 1], tangents[offset + 2],
			candidate[0], candidate[1], candidate[2]
		)
	}
}

function computeFrames( path, surface, lineIndex, usePooledLineArrays = false ) {
	const normals = usePooledLineArrays
		? acquireScratch( 'frameNormals', path.pointCount * 3 )
		: new Float64Array( path.pointCount * 3 )
	const up = normalizeVector( readVectorLike( surface.up, 'surface.up' ) )
	const upX = up[0]
	const upY = up[1]
	const upZ = up[2]
	const candidate = frameCandidateScratch
	const tangents = path.tangents
	const pointCount = path.pointCount

	seedNormalScalar( candidate, tangents[0], tangents[1], tangents[2], upX, upY, upZ )
	writeOrthonormalFrameScalar(
		normals, 0,
		tangents[0], tangents[1], tangents[2],
		candidate[0], candidate[1], candidate[2]
	)

	if ( surface.frame === 'fixed-up' ) {
		computeFixedUpNormals( normals, tangents, pointCount, upX, upY, upZ )
	} else {
		computeTransportNormals( normals, tangents, pointCount )
		if ( path.closed ) {
			closeTransportNormals( normals, tangents, path.progress, pointCount )
		}
	}

	const constantBank = typeof surface.bank === 'number' ? surface.bank : null
	if ( constantBank === null || Math.abs( constantBank ) > EPSILON ) {
		applyFrameBanking( normals, tangents, path.progress, pointCount, surface.bank, constantBank, lineIndex )
	}

	return { normals }
}

function computeHalfWidths( progress, options, lineIndex, pointCount, usePooledLineArrays = false ) {
	const baseWidth = options.lineWidth ?? 0.3
	if ( !options.widthCallback ) return baseWidth * 0.5

	const halfWidths = usePooledLineArrays
		? acquireScratch( 'halfWidths', pointCount )
		: new Float64Array( pointCount )
	let minW = Infinity
	let maxW = 0

	for ( let i = 0; i < pointCount; i++ ) {
		const multiplier = options.widthCallback( progress[i], i, lineIndex )

		if ( !Number.isFinite( multiplier ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] widthCallback returned a non-finite value at point ${i}` )
		}

		const halfWidth = Math.abs( baseWidth * multiplier ) * 0.5
		if ( !Number.isFinite( halfWidth ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Width overflow at point ${i} of line ${lineIndex}` )
		}
		halfWidths[i] = halfWidth
		if ( halfWidth < minW ) minW = halfWidth
		if ( halfWidth > maxW ) maxW = halfWidth
	}

	lastMinHalfWidth = minW
	lastMaxHalfWidth = maxW
	return halfWidths
}

function computeOffsets( path, frame, joinData, usePooledLineArrays = false ) {
	const pointCount = path.pointCount
	const offsets = usePooledLineArrays
		? acquireScratch( 'compactOffsets', pointCount * 3 )
		: new Float64Array( pointCount * 3 )
	const normals = frame.normals
	const tangents = path.tangents
	const firstJoin = path.closed ? 0 : 1
	const lastJoin = path.closed ? pointCount : pointCount - 1

	if ( !path.closed ) {
		offsets[0] = normals[1] * tangents[2] - normals[2] * tangents[1]
		offsets[1] = normals[2] * tangents[0] - normals[0] * tangents[2]
		offsets[2] = normals[0] * tangents[1] - normals[1] * tangents[0]
		const last = ( pointCount - 1 ) * 3
		offsets[last] = normals[last + 1] * tangents[last + 2] - normals[last + 2] * tangents[last + 1]
		offsets[last + 1] = normals[last + 2] * tangents[last] - normals[last] * tangents[last + 2]
		offsets[last + 2] = normals[last] * tangents[last + 1] - normals[last + 1] * tangents[last]
	}

	for ( let i = firstJoin; i < lastJoin; i++ ) {
		const offset = i * 3
		const info = i * JOIN_STRIDE
		const scale = joinData[info + JOIN_SCALE]
		offsets[offset] = joinData[info + JOIN_MITER] * scale
		offsets[offset + 1] = joinData[info + JOIN_MITER + 1] * scale
		offsets[offset + 2] = joinData[info + JOIN_MITER + 2] * scale
	}

	return offsets
}

let lastToFloat64MaxMagnitude = 0
let lastToFloat64MinDistSq = 0

function prepareLine( input, closed, lineIndex, reusable = null ) {
	const isFloat32Input = input instanceof Float32Array
	const raw = toFloat64( input, lineIndex, reusable )
	if ( raw.length % 3 !== 0 ) {
		throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} must contain complete XYZ triples` )
	}
	if ( raw.length < 6 ) {
		throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} requires at least two points` )
	}

	const scaledEps = lastToFloat64MaxMagnitude * Number.EPSILON * 4
	const epsilon = scaledEps > DUPLICATE_EPSILON ? scaledEps : DUPLICATE_EPSILON
	let points = lastToFloat64MinDistSq > epsilon * epsilon
		? raw
		: compactConsecutivePoints( raw, epsilon )

	if ( closed && points.length >= 6 && pointsEqual(
		points, 0, points, points.length - 3, epsilon
	) ) {
		points = points.subarray( 0, points.length - 3 )
	}

	const pointCount = points.length / 3
	const minimum = closed ? 3 : 2
	if ( pointCount < minimum ) {
		throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} requires at least ${minimum} distinct points` )
	}

	return { points, closed, isFloat32Input, maxCoordMagnitude: lastToFloat64MaxMagnitude }
}

function validateOptions( options, surface, join, cap ) {
	const lineWidth = options.lineWidth ?? 0.3
	if ( !Number.isFinite( lineWidth ) || !Number.isFinite( Math.fround( lineWidth ) ) || lineWidth < 0 ) {
		throw new Error( '[MeshLineSurfaceGeometry] lineWidth must be a Float32-representable non-negative number' )
	}
	if ( options.widthCallback != null && typeof options.widthCallback !== 'function' ) {
		throw new Error( '[MeshLineSurfaceGeometry] widthCallback must be a function or null' )
	}
	if ( surface.frame !== 'transport' && surface.frame !== 'fixed-up' ) {
		throw new Error( `[MeshLineSurfaceGeometry] Unsupported frame mode: ${surface.frame}` )
	}
	if ( surface.uvMode !== 'distance' && surface.uvMode !== 'stretch' ) {
		throw new Error( `[MeshLineSurfaceGeometry] Unsupported UV mode: ${surface.uvMode}` )
	}
	if ( !Number.isFinite( surface.uvScale ) || surface.uvScale <= 0 ) {
		throw new Error( '[MeshLineSurfaceGeometry] surface.uvScale must be greater than zero' )
	}
	if ( !['miter', 'bevel', 'round'].includes( join.type ) ) {
		throw new Error( `[MeshLineSurfaceGeometry] Unsupported join type: ${join.type}` )
	}
	if ( !Number.isFinite( join.limit ) || join.limit < 1 ) {
		throw new Error( '[MeshLineSurfaceGeometry] join.limit must be finite and at least 1' )
	}
	if ( !Number.isInteger( join.segments ) || join.segments < 1 ) {
		throw new Error( '[MeshLineSurfaceGeometry] join.segments must be a positive integer' )
	}
	if ( join.inner !== 'exact' && join.inner !== 'clip' ) {
		throw new Error( `[MeshLineSurfaceGeometry] Unsupported inner join policy: ${join.inner}` )
	}
	if ( !['butt', 'square', 'round'].includes( cap.type ) ) {
		throw new Error( `[MeshLineSurfaceGeometry] Unsupported cap type: ${cap.type}` )
	}
	if ( !Number.isInteger( cap.segments ) || cap.segments < 1 ) {
		throw new Error( '[MeshLineSurfaceGeometry] cap.segments must be a positive integer' )
	}
	if ( cap.type === 'round' && cap.segments < 2 ) {
		throw new Error( '[MeshLineSurfaceGeometry] Round caps require cap.segments of at least 2' )
	}
	readVectorLike( surface.up, 'surface.up' )
}

function resolveBank( bank, progress, index, lineIndex ) {
	let value = 0

	if ( typeof bank === 'function' ) {
		value = bank( progress, index, lineIndex )
	} else if ( typeof bank === 'number' ) {
		value = bank
	} else if ( ArrayBuffer.isView( bank ) ) {
		value = bank[index] ?? 0
	} else if ( Array.isArray( bank ) ) {
		const values = Array.isArray( bank[0] ) || ArrayBuffer.isView( bank[0] )
			? bank[lineIndex]
			: bank
		value = values?.[index] ?? 0
	} else if ( bank != null ) {
		throw new Error( '[MeshLineSurfaceGeometry] surface.bank must be a number, array, or function' )
	}

	if ( !Number.isFinite( value ) ) {
		throw new Error( `[MeshLineSurfaceGeometry] surface.bank returned a non-finite value at point ${index}` )
	}

	return value
}

function projectNormalScalar( target, tangentX, tangentY, tangentZ, referenceX, referenceY, referenceZ ) {
	const projection = tangentX * referenceX + tangentY * referenceY + tangentZ * referenceZ
	const normalX = referenceX - tangentX * projection
	const normalY = referenceY - tangentY * projection
	const normalZ = referenceZ - tangentZ * projection
	const length = hypot3( normalX, normalY, normalZ )
	if ( length <= EPSILON ) return false
	const inverseLength = 1 / length
	target[0] = normalX * inverseLength
	target[1] = normalY * inverseLength
	target[2] = normalZ * inverseLength
	return true
}

function seedNormalScalar( target, tangentX, tangentY, tangentZ, upX, upY, upZ ) {
	if ( projectNormalScalar( target, tangentX, tangentY, tangentZ, upX, upY, upZ ) ) return

	const absX = Math.abs( tangentX )
	const absY = Math.abs( tangentY )
	const absZ = Math.abs( tangentZ )
	if ( absX <= absY && absX <= absZ ) {
		projectNormalScalar( target, tangentX, tangentY, tangentZ, 1, 0, 0 )
	} else if ( absY <= absZ ) {
		projectNormalScalar( target, tangentX, tangentY, tangentZ, 0, 1, 0 )
	} else {
		projectNormalScalar( target, tangentX, tangentY, tangentZ, 0, 0, 1 )
	}
}

function transportNormalScalar(
	target,
	normalX, normalY, normalZ,
	fromTangentX, fromTangentY, fromTangentZ,
	toTangentX, toTangentY, toTangentZ
) {
	const axisX = fromTangentY * toTangentZ - fromTangentZ * toTangentY
	const axisY = fromTangentZ * toTangentX - fromTangentX * toTangentZ
	const axisZ = fromTangentX * toTangentY - fromTangentY * toTangentX
	const sinAngleSq = axisX * axisX + axisY * axisY + axisZ * axisZ

	if ( sinAngleSq <= EPSILON * EPSILON ) {
		target[0] = normalX
		target[1] = normalY
		target[2] = normalZ
		return
	}

	const cosAngle = clamp(
		fromTangentX * toTangentX + fromTangentY * toTangentY + fromTangentZ * toTangentZ,
		-1, 1
	)
	const crossX = axisY * normalZ - axisZ * normalY
	const crossY = axisZ * normalX - axisX * normalZ
	const crossZ = axisX * normalY - axisY * normalX
	const axisScale = ( axisX * normalX + axisY * normalY + axisZ * normalZ ) * ( 1 - cosAngle ) / sinAngleSq
	// `axis` has length sin( angle ), so `unitAxis × normal * sin( angle )` is
	// simply `axis × normal` and `( unitAxis · normal ) * unitAxis` divides by
	// `sinAngleSq` without needing `sqrt`.
	target[0] = normalX * cosAngle + crossX + axisX * axisScale
	target[1] = normalY * cosAngle + crossY + axisY * axisScale
	target[2] = normalZ * cosAngle + crossZ + axisZ * axisScale
}

function rotateVectorAroundAxisScalar(
	target,
	vectorX, vectorY, vectorZ,
	axisX, axisY, axisZ,
	angle
) {
	const cosine = Math.cos( angle )
	const sine = Math.sin( angle )
	const crossX = axisY * vectorZ - axisZ * vectorY
	const crossY = axisZ * vectorX - axisX * vectorZ
	const crossZ = axisX * vectorY - axisY * vectorX
	const dot = axisX * vectorX + axisY * vectorY + axisZ * vectorZ
	const inverseCosine = 1 - cosine
	target[0] = vectorX * cosine + crossX * sine + axisX * dot * inverseCosine
	target[1] = vectorY * cosine + crossY * sine + axisY * dot * inverseCosine
	target[2] = vectorZ * cosine + crossZ * sine + axisZ * dot * inverseCosine
}

function writeOrthonormalFrameScalar(
	normals, offset,
	tangentX, tangentY, tangentZ,
	normalHintX, normalHintY, normalHintZ
) {
	let projection = tangentX * normalHintX + tangentY * normalHintY + tangentZ * normalHintZ
	let normalX = normalHintX - tangentX * projection
	let normalY = normalHintY - tangentY * projection
	let normalZ = normalHintZ - tangentZ * projection
	let normalLength = hypot3( normalX, normalY, normalZ )

	if ( normalLength <= EPSILON ) {
		projection = tangentY
		normalX = -tangentX * projection
		normalY = 1 - tangentY * projection
		normalZ = -tangentZ * projection
		normalLength = hypot3( normalX, normalY, normalZ )

		if ( normalLength <= EPSILON ) {
			const absX = Math.abs( tangentX )
			const absY = Math.abs( tangentY )
			const absZ = Math.abs( tangentZ )
			let referenceX = 0
			let referenceY = 0
			let referenceZ = 0
			if ( absX <= absY && absX <= absZ ) referenceX = 1
			else if ( absY <= absZ ) referenceY = 1
			else referenceZ = 1
			projection = tangentX * referenceX + tangentY * referenceY + tangentZ * referenceZ
			normalX = referenceX - tangentX * projection
			normalY = referenceY - tangentY * projection
			normalZ = referenceZ - tangentZ * projection
			normalLength = hypot3( normalX, normalY, normalZ )
		}
	}
	if ( !Number.isFinite( normalLength ) || normalLength <= EPSILON ) {
		throw new Error( '[MeshLineSurfaceGeometry] Cannot normalize a degenerate vector' )
	}
	const inverseNormalLength = 1 / normalLength
	normals[offset] = normalX * inverseNormalLength
	normals[offset + 1] = normalY * inverseNormalLength
	normals[offset + 2] = normalZ * inverseNormalLength
}

let indexWriteChanged = false

function writePair4( array, vertex, x, y, z, w ) {
	const offset = vertex * 4
	array[offset] = x
	array[offset + 1] = y
	array[offset + 2] = z
	array[offset + 3] = w
	array[offset + 4] = x
	array[offset + 5] = y
	array[offset + 6] = z
	array[offset + 7] = w
}

function readVectorLike( value, label ) {
	let vector
	if ( Array.isArray( value ) || ArrayBuffer.isView( value ) ) {
		vector = [value[0], value[1], value[2]]
	} else if ( value && typeof value === 'object' ) {
		vector = [value.x, value.y, value.z]
	} else {
		throw new Error( `[MeshLineSurfaceGeometry] ${label} must be a 3D vector` )
	}

	if ( vector.some( component => !Number.isFinite( component ) ) || vectorLength( vector ) <= EPSILON ) {
		throw new Error( `[MeshLineSurfaceGeometry] ${label} must be a finite non-zero 3D vector` )
	}

	return vector
}

function scanFlatPoints( input, length, lineIndex ) {
	if ( length >= 6 && length % 3 === 0 ) {
		let prevX = input[0], prevY = input[1], prevZ = input[2]
		const ax0 = Math.abs( prevX ), ay0 = Math.abs( prevY ), az0 = Math.abs( prevZ )
		if ( !( ax0 < Infinity && ay0 < Infinity && az0 < Infinity ) ) {
			for ( let j = 0; j < 3; j++ ) {
				if ( !( Math.abs( input[j] ) < Infinity ) ) {
					throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${j} in line ${lineIndex}` )
				}
			}
		}
		let maxMagnitude = Math.max( ax0, Math.max( ay0, az0 ) )
		let minDistSq = Infinity
		for ( let i = 3; i < length; i += 3 ) {
			const x = input[i], y = input[i + 1], z = input[i + 2]
			const ax = Math.abs( x ), ay = Math.abs( y ), az = Math.abs( z )
			if ( !( ax < Infinity && ay < Infinity && az < Infinity ) ) {
				for ( let j = i; j < i + 3; j++ ) {
					if ( !( Math.abs( input[j] ) < Infinity ) ) {
						throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${j} in line ${lineIndex}` )
					}
				}
			}
			maxMagnitude = Math.max( maxMagnitude, Math.max( ax, Math.max( ay, az ) ) )
			const dx = prevX - x, dy = prevY - y, dz = prevZ - z
			minDistSq = Math.min( minDistSq, dx * dx + dy * dy + dz * dz )
			prevX = x; prevY = y; prevZ = z
		}
		lastToFloat64MinDistSq = minDistSq
		return maxMagnitude
	}

	let maxMagnitude = 0
	for ( let i = 0; i < length; i++ ) {
		const abs = Math.abs( input[i] )
		if ( !( abs < Infinity ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${i} in line ${lineIndex}` )
		}
		maxMagnitude = Math.max( maxMagnitude, abs )
	}
	lastToFloat64MinDistSq = 0
	return maxMagnitude
}

function copyFlatPointsToFloat64( input, result, length, lineIndex ) {
	if ( length >= 6 && length % 3 === 0 ) {
		let prevX = input[0], prevY = input[1], prevZ = input[2]
		const ax0 = Math.abs( prevX ), ay0 = Math.abs( prevY ), az0 = Math.abs( prevZ )
		if ( !( ax0 < Infinity && ay0 < Infinity && az0 < Infinity ) ) {
			for ( let j = 0; j < 3; j++ ) {
				if ( !( Math.abs( input[j] ) < Infinity ) ) {
					throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${j} in line ${lineIndex}` )
				}
			}
		}
		result[0] = prevX; result[1] = prevY; result[2] = prevZ
		let maxMagnitude = Math.max( ax0, Math.max( ay0, az0 ) )
		let minDistSq = Infinity
		for ( let i = 3; i < length; i += 3 ) {
			const x = input[i], y = input[i + 1], z = input[i + 2]
			const ax = Math.abs( x ), ay = Math.abs( y ), az = Math.abs( z )
			if ( !( ax < Infinity && ay < Infinity && az < Infinity ) ) {
				for ( let j = i; j < i + 3; j++ ) {
					if ( !( Math.abs( input[j] ) < Infinity ) ) {
						throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${j} in line ${lineIndex}` )
					}
				}
			}
			result[i] = x; result[i + 1] = y; result[i + 2] = z
			maxMagnitude = Math.max( maxMagnitude, Math.max( ax, Math.max( ay, az ) ) )
			const dx = prevX - x, dy = prevY - y, dz = prevZ - z
			minDistSq = Math.min( minDistSq, dx * dx + dy * dy + dz * dz )
			prevX = x; prevY = y; prevZ = z
		}
		lastToFloat64MinDistSq = minDistSq
		return maxMagnitude
	}

	let maxMagnitude = 0
	for ( let i = 0; i < length; i++ ) {
		const v = input[i]
		const abs = Math.abs( v )
		if ( !( abs < Infinity ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${i} in line ${lineIndex}` )
		}
		result[i] = v
		maxMagnitude = Math.max( maxMagnitude, abs )
	}
	lastToFloat64MinDistSq = 0
	return maxMagnitude
}

function toFloat64( input, lineIndex, reusable = null ) {
	if ( input instanceof Float32Array || input instanceof Float64Array ) {
		lastToFloat64MaxMagnitude = scanFlatPoints( input, input.length, lineIndex )
		return input
	}
	if (
		ArrayBuffer.isView( input ) ||
		( Array.isArray( input ) && typeof input[0] === 'number' )
	) {
		const length = input.length
		const result = reusable instanceof Float64Array && reusable.length === length ? reusable : new Float64Array( length )
		lastToFloat64MaxMagnitude = copyFlatPointsToFloat64( input, result, length, lineIndex )
		return result
	}

	lastToFloat64MinDistSq = 0
	let maxMagnitude = 0

	if ( input instanceof BufferGeometry ) {
		const attribute = input.getAttribute( 'position' )
		if ( !attribute ) throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} BufferGeometry has no position attribute` )
		const count = attribute.count
		const length = count * 3
		const result = reusable instanceof Float64Array && reusable.length === length ? reusable : new Float64Array( length )
		for ( let i = 0, offset = 0; i < count; i++, offset += 3 ) {
			const x = attribute.getX( i )
			const y = attribute.getY( i )
			const z = attribute.getZ( i )
			result[offset] = x
			result[offset + 1] = y
			result[offset + 2] = z
		}
		for ( let i = 0; i < result.length; i++ ) {
			const abs = Math.abs( result[i] )
			if ( !( abs < Infinity ) ) {
				throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${i} in line ${lineIndex}` )
			}
			if ( abs > maxMagnitude ) maxMagnitude = abs
		}
		lastToFloat64MaxMagnitude = maxMagnitude
		return result
	}

	if ( !Array.isArray( input ) ) {
		throw new Error( `[MeshLineSurfaceGeometry] Unsupported line input at index ${lineIndex}` )
	}

	const length = input.length * 3
	const result = reusable instanceof Float64Array && reusable.length === length ? reusable : new Float64Array( length )
	for ( let i = 0, offset = 0; i < input.length; i++, offset += 3 ) {
		const point = input[i]
		let x, y, z

		if ( Array.isArray( point ) || ArrayBuffer.isView( point ) ) {
			x = point[0]
			y = point[1]
			z = point[2] ?? 0
		} else if ( point && typeof point === 'object' ) {
			x = point.x
			y = point.y
			z = point.z ?? 0
		}

		const absX = Math.abs( x )
		const absY = Math.abs( y )
		const absZ = Math.abs( z )
		if ( !( absX < Infinity && absY < Infinity && absZ < Infinity ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Invalid point ${i} in line ${lineIndex}` )
		}

		result[offset] = x
		result[offset + 1] = y
		result[offset + 2] = z
		if ( absX > maxMagnitude ) maxMagnitude = absX
		if ( absY > maxMagnitude ) maxMagnitude = absY
		if ( absZ > maxMagnitude ) maxMagnitude = absZ
	}

	lastToFloat64MaxMagnitude = maxMagnitude
	return result
}

function compactConsecutivePoints( points, epsilon ) {
	const epsilonSq = epsilon * epsilon
	let output = null
	let length = 3
	let prevX = points[0]
	let prevY = points[1]
	let prevZ = points[2]

	for ( let offset = 3; offset < points.length; offset += 3 ) {
		const x = points[offset]
		const y = points[offset + 1]
		const z = points[offset + 2]
		const dx = prevX - x
		const dy = prevY - y
		const dz = prevZ - z
		if ( dx * dx + dy * dy + dz * dz <= epsilonSq ) {
			if ( output === null ) {
				output = new Float64Array( points.length )
				output.set( points.subarray( 0, offset ) )
				length = offset
			}
			continue
		}
		if ( output !== null ) {
			output[length] = x
			output[length + 1] = y
			output[length + 2] = z
		}
		prevX = x
		prevY = y
		prevZ = z
		length += 3
	}

	if ( output === null ) return points
	return length === output.length ? output : output.slice( 0, length )
}

function assertRepresentableSurfaceRow(
	positions, leftOffset, rightOffset,
	leftX, leftY, leftZ, rightX, rightY, rightZ,
	halfWidth, lineIndex, row
) {
	const left32X = positions[leftOffset]
	const left32Y = positions[leftOffset + 1]
	const left32Z = positions[leftOffset + 2]
	const right32X = positions[rightOffset]
	const right32Y = positions[rightOffset + 1]
	const right32Z = positions[rightOffset + 2]
	if ( halfWidth <= 0 ) {
		if (
			!Number.isFinite( left32X ) || !Number.isFinite( left32Y ) || !Number.isFinite( left32Z ) ||
			!Number.isFinite( right32X ) || !Number.isFinite( right32Y ) || !Number.isFinite( right32Z )
		) {
			throw new Error( `[MeshLineSurfaceGeometry] Position overflow at row ${row} of line ${lineIndex}` )
		}
		return
	}

	const requestedX = rightX - leftX
	const requestedY = rightY - leftY
	const requestedZ = rightZ - leftZ
	const representedX = right32X - left32X
	const representedY = right32Y - left32Y
	const representedZ = right32Z - left32Z
	const requestedWidthSq = requestedX * requestedX + requestedY * requestedY + requestedZ * requestedZ
	const representedWidthSq = representedX * representedX + representedY * representedY + representedZ * representedZ
	// 0.875^2 = 0.765625 and 1.125^2 = 1.265625 are exact binary floats, so
	// comparing squared widths matches `|repr - req| / req > 0.125` without two
	// `Math.sqrt` calls per row.
	if ( !( representedWidthSq >= requestedWidthSq * 0.765625 && representedWidthSq <= requestedWidthSq * 1.265625 && requestedWidthSq > 0 ) ) {
		if (
			!Number.isFinite( left32X ) || !Number.isFinite( left32Y ) || !Number.isFinite( left32Z ) ||
			!Number.isFinite( right32X ) || !Number.isFinite( right32Y ) || !Number.isFinite( right32Z )
		) {
			throw new Error( `[MeshLineSurfaceGeometry] Position overflow at row ${row} of line ${lineIndex}` )
		}
		throw new Error(
			`[MeshLineSurfaceGeometry] Float32 precision would deform row ${row} of line ${lineIndex}; rebase the path near the local origin`
		)
	}
}

function assertFloat32PathSegments( points, closed, lineIndex ) {
	const pointCount = points.length / 3
	const segmentCount = closed ? pointCount : pointCount - 1
	for ( let segment = 0; segment < segmentCount; segment++ ) {
		const next = segment + 1 === pointCount ? 0 : segment + 1
		const offset = segment * 3
		const nextOffset = next * 3
		const dx = Math.fround( points[nextOffset] ) - Math.fround( points[offset] )
		const dy = Math.fround( points[nextOffset + 1] ) - Math.fround( points[offset + 1] )
		const dz = Math.fround( points[nextOffset + 2] ) - Math.fround( points[offset + 2] )
		if ( dx * dx + dy * dy + dz * dz <= EPSILON * EPSILON ) {
			throw new Error(
				`[MeshLineSurfaceGeometry] Float32 precision would collapse segment ${segment} of line ${lineIndex}; rebase the path near the local origin`
			)
		}
	}
}

function pointsEqual( a, aOffset, b, bOffset, epsilon ) {
	const dx = a[aOffset] - b[bOffset]
	const dy = a[aOffset + 1] - b[bOffset + 1]
	const dz = a[aOffset + 2] - b[bOffset + 2]
	return dx * dx + dy * dy + dz * dz <= epsilon * epsilon
}

function normalizeLinesInput( lines ) {
	if ( lines instanceof BufferGeometry || ArrayBuffer.isView( lines ) ) return [lines]
	if ( !Array.isArray( lines ) ) throw new Error( '[MeshLineSurfaceGeometry] Unsupported lines input' )
	if ( lines.length === 0 ) return []
	if ( typeof lines[0] === 'number' || isPointLike( lines[0] ) ) return [lines]
	return lines
}

function isPointLike( value ) {
	if ( ArrayBuffer.isView( value ) ) return value.length >= 2 && value.length <= 4
	if ( Array.isArray( value ) ) {
		return value.length >= 2 && value.length <= 4 && typeof value[0] === 'number' && typeof value[1] === 'number'
	}
	return !!value && typeof value === 'object' && Number.isFinite( value.x ) && Number.isFinite( value.y )
}

function scaleVector( vector, scale ) {
	return [vector[0] * scale, vector[1] * scale, vector[2] * scale]
}

function vectorLength( vector ) {
	return hypot3( vector[0], vector[1], vector[2] )
}

function normalizeVector( vector ) {
	const length = vectorLength( vector )
	if ( !Number.isFinite( length ) || length <= EPSILON ) {
		throw new Error( '[MeshLineSurfaceGeometry] Cannot normalize a degenerate vector' )
	}
	return scaleVector( vector, 1 / length )
}

function clamp( value, min, max ) {
	return Math.max( min, Math.min( max, value ) )
}

export default MeshLineSurfaceGeometry
