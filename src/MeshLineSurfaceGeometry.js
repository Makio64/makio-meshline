import { Box3, BufferAttribute, BufferGeometry, Sphere, StaticDrawUsage, StreamDrawUsage } from 'three/webgpu'

const EPSILON = 1e-10
const DUPLICATE_EPSILON = 1e-12
const REVERSAL_SPLIT_ANGLE = Math.PI / 180
const REVERSAL_SPLIT_DOT = -Math.cos( REVERSAL_SPLIT_ANGLE )
const CLIPPED_INNER_MARGIN = 1e-4

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

		if ( options ) this.buildLine( options )
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

		if ( lines !== undefined ) this.setLines( lines )
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

		if ( closed !== undefined ) this.options.closed = closed
		const closedOption = this.options?.closed ?? false
		const singleLine = inputs.length === 1
		const prepared = new Array( inputs.length )

		for ( let i = 0; i < inputs.length; i++ ) {
			const isClosed = Array.isArray( closedOption ) ? !!closedOption[i] : !!closedOption
			prepared[i] = prepareLine( inputs[i], isClosed, i, this._lines[i] )
		}

		this.options.lines = lines
		try {
			const linePoints = new Array( prepared.length )
			const surfaceLines = new Array( prepared.length )
			for ( let lineIndex = 0; lineIndex < prepared.length; lineIndex++ ) {
				const line = prepared[lineIndex]
				linePoints[lineIndex] = line.points
				surfaceLines[lineIndex] = buildSurfaceLine(
					line,
					lineIndex,
					this.options,
					singleLine
				)
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
	}

	clearGeometry() {
		for ( const name of Object.keys( this.attributes ) ) this.deleteAttribute( name )
		this.setIndex( null )
		this.setDrawRange( 0, 0 )
		this.boundingBox = null
		this.boundingSphere = null
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
		}
	}

	setOrUpdateAttribute( name, array, itemSize, usage = StaticDrawUsage ) {
		const existing = this.getAttribute( name )
		if ( existing && existing.itemSize === itemSize && existing.array.length === array.length && existing.array.constructor === array.constructor && existing.usage === usage ) {
			if ( existing.array !== array ) existing.copyArray( array )
			existing.needsUpdate = true
			return
		}

		this.setAttribute( name, new BufferAttribute( array, itemSize ).setUsage( usage ) )
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

		const IndexArray = totalVertices > 65535 ? Uint32Array : Uint16Array
		const positions = this.getReusableAttributeArray( 'position', Float32Array, totalVertices * 3, 3, usage )
		const normals = this.getReusableAttributeArray( 'normal', Float32Array, totalVertices * 3, 3, usage )
		const tangents = needsTangents ? this.getReusableAttributeArray( 'tangent', Float32Array, totalVertices * 4, 4, usage ) : null
		const uvs = needsUV ? this.getReusableAttributeArray( 'uv', Float32Array, totalVertices * 2, 2, usage ) : null
		const progress = needsProgress ? this.getReusableAttributeArray( 'progress', Float32Array, totalVertices, 1, usage ) : null
		const sides = needsSide ? this.getReusableAttributeArray( 'side', Float32Array, totalVertices, 1, usage ) : null
		const existingIndex = this.getIndex()
		const reusedIndex = !!( existingIndex && existingIndex.array.constructor === IndexArray && existingIndex.array.length === totalIndices )
		const indices = reusedIndex
			? existingIndex.array
			: new IndexArray( totalIndices )
		indexWriteChanged = !reusedIndex

		this._lineRanges = []
		let rowOffset = 0
		let vertexOffset = 0
		let indexOffset = 0
		const bounds = boundsScratch
		bounds[0] = Infinity
		bounds[1] = Infinity
		bounds[2] = Infinity
		bounds[3] = -Infinity
		bounds[4] = -Infinity
		bounds[5] = -Infinity

		for ( let lineIndex = 0; lineIndex < this._surfaceLines.length; lineIndex++ ) {
			const line = this._surfaceLines[lineIndex]
			const vertexStart = vertexOffset
			const indexStart = indexOffset
			let lineVertexCount
			if ( line.topology ) {
				lineVertexCount = line.topology.vertexCount
				indexOffset = emitVariableTopologyLine(
					line, lineIndex, vertexStart, indexOffset,
					positions, normals, tangents, uvs, progress, sides, indices, bounds
				)
			} else {
				lineVertexCount = line.rowCount * 2 + ( line.capTopology?.vertexCount || 0 )
				indexOffset = emitCompactStripLine(
					line, lineIndex, vertexStart, indexOffset,
					positions, normals, tangents, uvs, progress, sides, indices, bounds
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

		this.setOrUpdateAttribute( 'position', positions, 3, usage )
		this.setOrUpdateAttribute( 'normal', normals, 3, usage )
		this.commitOptionalAttribute( 'tangent', tangents, 4, usage )
		this.commitOptionalAttribute( 'uv', uvs, 2, usage )
		this.commitOptionalAttribute( 'progress', progress, 1, usage )
		this.commitOptionalAttribute( 'side', sides, 1, usage )
		if ( existingIndex && existingIndex.array === indices ) {
			if ( indexWriteChanged ) existingIndex.needsUpdate = true
		} else {
			this.setIndex( new BufferAttribute( indices, 1 ) )
		}
		this.updateBounds( positions, bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5] )
	}

	commitOptionalAttribute( name, array, itemSize, usage ) {
		if ( array ) {
			this.setOrUpdateAttribute( name, array, itemSize, usage )
		} else if ( this.getAttribute( name ) ) {
			this.deleteAttribute( name )
		}
	}

	updateBounds( positions, minX, minY, minZ, maxX, maxY, maxZ ) {
		if ( !this.boundingBox ) this.boundingBox = new Box3()
		this.boundingBox.min.set( minX, minY, minZ )
		this.boundingBox.max.set( maxX, maxY, maxZ )

		if ( !this.boundingSphere ) this.boundingSphere = new Sphere()
		const centerX = ( minX + maxX ) * 0.5
		const centerY = ( minY + maxY ) * 0.5
		const centerZ = ( minZ + maxZ ) * 0.5
		this.boundingSphere.center.set( centerX, centerY, centerZ )
		this.boundingSphere.radius = Math.sqrt( computeMaxRadiusSq( positions, centerX, centerY, centerZ ) )
	}

}

const boundsScratch = new Float64Array( 6 )

function computeMaxRadiusSq( positions, centerX, centerY, centerZ ) {
	let maxRadiusSquared = 0
	for ( let offset = 0; offset < positions.length; offset += 3 ) {
		const dx = positions[offset] - centerX
		const dy = positions[offset + 1] - centerY
		const dz = positions[offset + 2] - centerZ
		const distSq = dx * dx + dy * dy + dz * dz
		if ( distSq > maxRadiusSquared ) maxRadiusSquared = distSq
	}
	return maxRadiusSquared
}

function copyTopoPositionsAndBounds( positions, topoPositions, vertexStart, lineVertexCount, lineIndex, bounds ) {
	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]
	for ( let localVertex = 0, local3 = 0, positionOffset = vertexStart * 3; localVertex < lineVertexCount; localVertex++, local3 += 3, positionOffset += 3 ) {
		positions[positionOffset] = topoPositions[local3]
		positions[positionOffset + 1] = topoPositions[local3 + 1]
		positions[positionOffset + 2] = topoPositions[local3 + 2]
		const px = positions[positionOffset]
		const py = positions[positionOffset + 1]
		const pz = positions[positionOffset + 2]
		if ( !( px - px === 0 && py - py === 0 && pz - pz === 0 ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Position overflow at vertex ${localVertex} of line ${lineIndex}` )
		}
		if ( px < minX ) bounds[0] = minX = px
		if ( px > maxX ) bounds[3] = maxX = px
		if ( py < minY ) bounds[1] = minY = py
		if ( py > maxY ) bounds[4] = maxY = py
		if ( pz < minZ ) bounds[2] = minZ = pz
		if ( pz > maxZ ) bounds[5] = maxZ = pz
	}
}

function copyTopoTangents( tangents, topoTangents, vertexStart, lineVertexCount ) {
	for ( let localVertex = 0, local3 = 0, tangentOffset = vertexStart * 4; localVertex < lineVertexCount; localVertex++, local3 += 3, tangentOffset += 4 ) {
		tangents[tangentOffset] = topoTangents[local3]
		tangents[tangentOffset + 1] = topoTangents[local3 + 1]
		tangents[tangentOffset + 2] = topoTangents[local3 + 2]
		tangents[tangentOffset + 3] = 1
	}
}

function copyTopoUvs( uvs, topoUvs, vertexStart, lineVertexCount, lineIndex ) {
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

function writeTopoIndices16( indices, indexOffset, positions, normals, topoIndices, topoIndexCount, vertexStart ) {
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
		const enx = normals[aOffset] + normals[bOffset] + normals[cOffset]
		const eny = normals[aOffset + 1] + normals[bOffset + 1] + normals[cOffset + 1]
		const enz = normals[aOffset + 2] + normals[bOffset + 2] + normals[cOffset + 2]
		const flip = faceNormalX * enx + faceNormalY * eny + faceNormalZ * enz < 0
		const second = flip ? c : b
		const third = flip ? b : c
		changed |= ( indices[indexOffset] ^ a ) | ( indices[indexOffset + 1] ^ second ) | ( indices[indexOffset + 2] ^ third )
		indices[indexOffset] = a
		indices[indexOffset + 1] = second
		indices[indexOffset + 2] = third
		indexOffset += 3
	}
	return changed
}

function writeTopoIndices32( indices, indexOffset, positions, normals, topoIndices, topoIndexCount, vertexStart ) {
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
		const enx = normals[aOffset] + normals[bOffset] + normals[cOffset]
		const eny = normals[aOffset + 1] + normals[bOffset + 1] + normals[cOffset + 1]
		const enz = normals[aOffset + 2] + normals[bOffset + 2] + normals[cOffset + 2]
		const flip = faceNormalX * enx + faceNormalY * eny + faceNormalZ * enz < 0
		const second = flip ? c : b
		const third = flip ? b : c
		changed |= ( indices[indexOffset] ^ a ) | ( indices[indexOffset + 1] ^ second ) | ( indices[indexOffset + 2] ^ third )
		indices[indexOffset] = a
		indices[indexOffset + 1] = second
		indices[indexOffset + 2] = third
		indexOffset += 3
	}
	return changed
}

function writeTopoIndices( indices, indexOffset, positions, normals, topoIndices, topoIndexCount, vertexStart ) {
	const changed = indices instanceof Uint32Array
		? writeTopoIndices32( indices, indexOffset, positions, normals, topoIndices, topoIndexCount, vertexStart )
		: writeTopoIndices16( indices, indexOffset, positions, normals, topoIndices, topoIndexCount, vertexStart )
	if ( changed !== 0 ) indexWriteChanged = true
	return indexOffset + topoIndexCount
}

function emitVariableTopologyLine(
	line, lineIndex, vertexStart, indexOffset,
	positions, normals, tangents, uvs, progress, sides, indices, bounds
) {
	const topo = line.topology
	const lineVertexCount = topo.vertexCount
	const halfWidths = line.halfWidths
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const pointCount = line.pointCount
	const segmentCount = line.closed ? pointCount : pointCount - 1

	normals.set( topo.normals.subarray( 0, lineVertexCount * 3 ), vertexStart * 3 )
	copyTopoPositionsAndBounds( positions, topo.positions, vertexStart, lineVertexCount, lineIndex, bounds )
	if ( tangents ) copyTopoTangents( tangents, topo.tangents, vertexStart, lineVertexCount )
	if ( uvs ) copyTopoUvs( uvs, topo.uvs, vertexStart, lineVertexCount, lineIndex )
	if ( progress ) progress.set( topo.progress.subarray( 0, lineVertexCount ), vertexStart )
	if ( sides ) sides.set( topo.sides.subarray( 0, lineVertexCount ), vertexStart )

	validateTopoRows(
		positions, topo.positions, topo.pairVertices,
		halfWidths, constantHalfWidth, vertexStart, pointCount, segmentCount, lineIndex
	)
	if ( !line.isFloat32Input ) assertFloat32PathSegments( line.points, line.closed, lineIndex )

	return writeTopoIndices( indices, indexOffset, positions, normals, topo.indices, topo.indexCount, vertexStart )
}

function emitCompactRows( line, lineIndex, vertexStart, positions, normals, tangents, uvs, progress, sides, bounds ) {
	const linePoints = line.points
	const lineOffsets = line.offsets
	const lineNormals = line.normals
	const lineTangents = line.tangents
	const lineProgress = line.progress
	const lineDistances = line.distances
	const halfWidths = line.halfWidths
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const stretchUV = line.uvMode === 'stretch'
	const invUvScale = 1 / line.uvScale
	const pointCount = line.pointCount
	const rowCount = line.rowCount
	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]

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
		assertRepresentableSurfaceRow(
			positions, leftPosition, rightPosition,
			leftX, leftY, leftZ, rightX, rightY, rightZ,
			halfWidth, lineIndex, row
		)

		const lpx = positions[leftPosition], lpy = positions[leftPosition + 1], lpz = positions[leftPosition + 2]
		const rpx = positions[rightPosition], rpy = positions[rightPosition + 1], rpz = positions[rightPosition + 2]
		if ( lpx < minX ) bounds[0] = minX = lpx
		if ( rpx < minX ) bounds[0] = minX = rpx
		if ( lpy < minY ) bounds[1] = minY = lpy
		if ( rpy < minY ) bounds[1] = minY = rpy
		if ( lpz < minZ ) bounds[2] = minZ = lpz
		if ( rpz < minZ ) bounds[2] = minZ = rpz
		if ( lpx > maxX ) bounds[3] = maxX = lpx
		if ( rpx > maxX ) bounds[3] = maxX = rpx
		if ( lpy > maxY ) bounds[4] = maxY = lpy
		if ( rpy > maxY ) bounds[4] = maxY = rpy
		if ( lpz > maxZ ) bounds[5] = maxZ = lpz
		if ( rpz > maxZ ) bounds[5] = maxZ = rpz

		const nx = lineNormals[pointOffset]
		const ny = lineNormals[pointOffset + 1]
		const nz = lineNormals[pointOffset + 2]
		normals[leftPosition] = normals[rightPosition] = nx
		normals[leftPosition + 1] = normals[rightPosition + 1] = ny
		normals[leftPosition + 2] = normals[rightPosition + 2] = nz

		if ( tangents ) writePair4( tangents, vertex, lineTangents[pointOffset], lineTangents[pointOffset + 1], lineTangents[pointOffset + 2], 1 )
		if ( uvs ) {
			const u = row === pointCount
				? line.seamU
				: ( stretchUV ? lineProgress[sourceIndex] : lineDistances[sourceIndex] * invUvScale )
			if ( !( u <= 3.4028234663852886e+38 && u >= -3.4028234663852886e+38 ) ) {
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
}

function writeCompactIndices16( indices, indexOffset, positions, normals, vertexStart, rowCount ) {
	if ( rowCount < 2 ) return 0
	let left0 = vertexStart
	let right0 = left0 + 1
	let pOffset = left0 * 3
	let l0x = positions[pOffset], l0y = positions[pOffset + 1], l0z = positions[pOffset + 2]
	let r0x = positions[pOffset + 3], r0y = positions[pOffset + 4], r0z = positions[pOffset + 5]
	let n0x = normals[pOffset], n0y = normals[pOffset + 1], n0z = normals[pOffset + 2]
	let changed = 0
	for ( let segment = 0; segment < rowCount - 1; segment++ ) {
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

		changed |= ( indices[indexOffset] ^ left0 ) | ( indices[indexOffset + 1] ^ s1 ) | ( indices[indexOffset + 2] ^ t1 ) |
			( indices[indexOffset + 3] ^ right0 ) | ( indices[indexOffset + 4] ^ s2 ) | ( indices[indexOffset + 5] ^ t2 )
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
	return changed
}

function writeCompactIndices32( indices, indexOffset, positions, normals, vertexStart, rowCount ) {
	if ( rowCount < 2 ) return 0
	let left0 = vertexStart
	let right0 = left0 + 1
	let pOffset = left0 * 3
	let l0x = positions[pOffset], l0y = positions[pOffset + 1], l0z = positions[pOffset + 2]
	let r0x = positions[pOffset + 3], r0y = positions[pOffset + 4], r0z = positions[pOffset + 5]
	let n0x = normals[pOffset], n0y = normals[pOffset + 1], n0z = normals[pOffset + 2]
	let changed = 0
	for ( let segment = 0; segment < rowCount - 1; segment++ ) {
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

		changed |= ( indices[indexOffset] ^ left0 ) | ( indices[indexOffset + 1] ^ s1 ) | ( indices[indexOffset + 2] ^ t1 ) |
			( indices[indexOffset + 3] ^ right0 ) | ( indices[indexOffset + 4] ^ s2 ) | ( indices[indexOffset + 5] ^ t2 )
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
	return changed
}

function writeCompactIndices( indices, indexOffset, positions, normals, vertexStart, rowCount ) {
	const changed = indices instanceof Uint32Array
		? writeCompactIndices32( indices, indexOffset, positions, normals, vertexStart, rowCount )
		: writeCompactIndices16( indices, indexOffset, positions, normals, vertexStart, rowCount )
	if ( changed !== 0 ) indexWriteChanged = true
	return indexOffset + ( rowCount - 1 ) * 6
}

function emitCompactCaps(
	capTopology, lineIndex, vertexStart, bodyVertexCount,
	positions, normals, tangents, uvs, progress, sides, indices, indexOffset, bounds
) {
	let minX = bounds[0], minY = bounds[1], minZ = bounds[2]
	let maxX = bounds[3], maxY = bounds[4], maxZ = bounds[5]
	for ( let extraVertex = 0; extraVertex < capTopology.vertexCount; extraVertex++ ) {
		const vertex = vertexStart + bodyVertexCount + extraVertex
		const source3 = extraVertex * 3
		const target3 = vertex * 3
		positions[target3] = capTopology.positions[source3]
		positions[target3 + 1] = capTopology.positions[source3 + 1]
		positions[target3 + 2] = capTopology.positions[source3 + 2]
		const px = positions[target3], py = positions[target3 + 1], pz = positions[target3 + 2]
		if ( !Number.isFinite( px ) || !Number.isFinite( py ) || !Number.isFinite( pz ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Position overflow at cap vertex ${extraVertex} of line ${lineIndex}` )
		}
		normals[target3] = capTopology.normals[source3]
		normals[target3 + 1] = capTopology.normals[source3 + 1]
		normals[target3 + 2] = capTopology.normals[source3 + 2]
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
		if ( px < minX ) minX = px
		if ( py < minY ) minY = py
		if ( pz < minZ ) minZ = pz
		if ( px > maxX ) maxX = px
		if ( py > maxY ) maxY = py
		if ( pz > maxZ ) maxZ = pz
	}
	bounds[0] = minX; bounds[1] = minY; bounds[2] = minZ
	bounds[3] = maxX; bounds[4] = maxY; bounds[5] = maxZ

	return writeTopoIndices(
		indices, indexOffset, positions, normals,
		capTopology.indices, capTopology.indices.length, vertexStart
	)
}

function emitCompactStripLine(
	line, lineIndex, vertexStart, indexOffset,
	positions, normals, tangents, uvs, progress, sides, indices, bounds
) {
	emitCompactRows( line, lineIndex, vertexStart, positions, normals, tangents, uvs, progress, sides, bounds )
	indexOffset = writeCompactIndices( indices, indexOffset, positions, normals, vertexStart, line.rowCount )
	if ( line.capTopology ) {
		indexOffset = emitCompactCaps(
			line.capTopology, lineIndex, vertexStart, line.rowCount * 2,
			positions, normals, tangents, uvs, progress, sides, indices, indexOffset, bounds
		)
	}
	if ( !line.isFloat32Input ) assertFloat32PathSegments( line.points, line.closed, lineIndex )
	return indexOffset
}

function buildSurfaceLine( line, lineIndex, options, usePooledLineArrays = false ) {
	const { points, closed, isFloat32Input } = line
	const pointCount = points.length / 3
	const path = computePathData( points, closed, usePooledLineArrays )
	const frame = computeFrames( path, options.surface, lineIndex, usePooledLineArrays )
	const halfWidths = computeHalfWidths( path.progress, options, lineIndex, pointCount )
	const joinData = computeJoinInfos( path, frame, options.join.type === 'round' )
	const innerFactors = resolveInnerJoinFootprints( path, joinData, halfWidths, options.join, lineIndex )
	const topologyNeeds = {
		tangents: !!( options.needsTangents || options.surface.normalMap ),
		uvs: !!(
			options.needsUV || options.map || options.alphaMap || options.surface.normalMap ||
			options.surface.roughnessMap || options.surface.metalnessMap
		),
		progress: !!options.needsProgress,
		sides: !!options.needsSide,
	}
	const topologyMode = getVariableTopologyMode( path, joinData, options.join, options.cap, innerFactors )
	const offsets = topologyMode === 'full'
		? null
		: computeOffsets( path, frame, joinData, usePooledLineArrays )
	const topology = topologyMode === 'full'
		? buildVariableTopology( path, frame, halfWidths, options.surface, options.join, options.cap, topologyNeeds, innerFactors, joinData, usePooledLineArrays )
		: null
	const capTopology = topologyMode === 'caps'
		? buildCompactCapTopology( path, frame, offsets, halfWidths, options.surface, options.cap, topologyNeeds )
		: null

	return {
		points,
		closed,
		isFloat32Input,
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

function getVariableTopologyMode( path, joinData, join, cap, innerFactors ) {
	const first = path.closed ? 0 : 1
	const last = path.closed ? path.pointCount : path.pointCount - 1
	const isMiter = join.type === 'miter'
	const limit = join.limit
	for ( let pointIndex = first; pointIndex < last; pointIndex++ ) {
		if ( path.cusps[pointIndex] ) return 'full'
		const info = pointIndex * JOIN_STRIDE
		if ( joinData[info + JOIN_SPLIT] ) return 'full'
		if ( joinData[info + JOIN_ANGLE] === 0 ) continue
		if ( innerFactors && innerFactors[pointIndex] < 1 ) return 'full'
		if ( !isMiter || joinData[info + JOIN_SCALE] > limit ) return 'full'
	}

	return !path.closed && cap.type !== 'butt' ? 'caps' : null
}

function buildCompactCapTopology( path, frame, offsets, halfWidths, surface, cap, needs ) {
	const positions = []
	const normals = []
	const tangents = needs.tangents ? [] : null
	const uvs = needs.uvs ? [] : null
	const progress = needs.progress ? [] : null
	const sides = needs.sides ? [] : null
	const indices = []
	const bodyVertexCount = path.pointCount * 2
	const getHalfWidth = pointIndex => typeof halfWidths === 'number' ? halfWidths : halfWidths[pointIndex]
	const emitVertex = ( pointIndex, x, y, z, side, u = surface.uvMode === 'stretch' ? path.progress[pointIndex] : path.distances[pointIndex] / surface.uvScale, vertexProgress = path.progress[pointIndex] ) => {
		const vertex = bodyVertexCount + positions.length / 3
		const offset = pointIndex * 3
		positions.push( x, y, z )
		normals.push( frame.normals[offset], frame.normals[offset + 1], frame.normals[offset + 2] )
		if ( tangents ) tangents.push( path.tangents[offset], path.tangents[offset + 1], path.tangents[offset + 2] )
		if ( uvs ) uvs.push( u, clamp( ( side + 1 ) * 0.5, 0, 1 ) )
		if ( progress ) progress.push( vertexProgress )
		if ( sides ) sides.push( clamp( side, -1, 1 ) )
		return vertex
	}

	const emitEndpoint = isEnd => {
		const pointIndex = isEnd ? path.pointCount - 1 : 0
		const offset = pointIndex * 3
		const directionOffset = ( isEnd ? path.segmentCount - 1 : 0 ) * 3
		const direction = [
			path.segmentDirections[directionOffset],
			path.segmentDirections[directionOffset + 1],
			path.segmentDirections[directionOffset + 2],
		]
		const side = computeSegmentSide( frame.normals, offset, path.segmentDirections, directionOffset )
		const halfWidth = getHalfWidth( pointIndex )
		const pair = isEnd ? [bodyVertexCount - 2, bodyVertexCount - 1] : [0, 1]
		const centerX = path.points[offset]
		const centerY = path.points[offset + 1]
		const centerZ = path.points[offset + 2]
		const baseU = surface.uvMode === 'stretch' ? path.progress[pointIndex] : path.distances[pointIndex] / surface.uvScale
		const directionSign = isEnd ? 1 : -1
		const left = [
			centerX - offsets[offset] * halfWidth,
			centerY - offsets[offset + 1] * halfWidth,
			centerZ - offsets[offset + 2] * halfWidth,
		]
		const right = [
			centerX + offsets[offset] * halfWidth,
			centerY + offsets[offset + 1] * halfWidth,
			centerZ + offsets[offset + 2] * halfWidth,
		]

		if ( cap.type === 'square' ) {
			const u = surface.uvMode === 'distance' ? baseU + directionSign * halfWidth / surface.uvScale : baseU
			const capLeft = emitVertex(
				pointIndex,
				left[0] + direction[0] * halfWidth * directionSign,
				left[1] + direction[1] * halfWidth * directionSign,
				left[2] + direction[2] * halfWidth * directionSign,
				-1, u
			)
			const capRight = emitVertex(
				pointIndex,
				right[0] + direction[0] * halfWidth * directionSign,
				right[1] + direction[1] * halfWidth * directionSign,
				right[2] + direction[2] * halfWidth * directionSign,
				1, u
			)
			if ( isEnd ) indices.push( pair[0], capLeft, pair[1], pair[1], capLeft, capRight )
			else indices.push( capLeft, pair[0], capRight, capRight, pair[0], pair[1] )
			return
		}

		const pivot = emitVertex( pointIndex, centerX, centerY, centerZ, 0, baseU )
		const startRadial = [left[0] - centerX, left[1] - centerY, left[2] - centerZ]
		const normal = [frame.normals[offset], frame.normals[offset + 1], frame.normals[offset + 2]]
		const sweep = isEnd ? Math.PI : -Math.PI
		const arc = [pair[0]]
		for ( let segment = 1; segment < cap.segments; segment++ ) {
			const radial = rotateVectorAroundAxis( startRadial, normal, sweep * segment / cap.segments )
			const sideCoordinate = halfWidth > EPSILON ? dotVector( radial, side ) / halfWidth : 0
			const longitudinal = dotVector( radial, direction )
			const u = surface.uvMode === 'distance' ? baseU + longitudinal / surface.uvScale : baseU
			arc.push( emitVertex(
				pointIndex,
				centerX + radial[0], centerY + radial[1], centerZ + radial[2],
				sideCoordinate, u
			) )
		}
		arc.push( pair[1] )
		for ( let segment = 0; segment < arc.length - 1; segment++ ) indices.push( pivot, arc[segment], arc[segment + 1] )
	}

	emitEndpoint( false )
	emitEndpoint( true )
	return {
		positions: new Float64Array( positions ),
		normals: new Float64Array( normals ),
		tangents: tangents ? new Float64Array( tangents ) : null,
		uvs: uvs ? new Float64Array( uvs ) : null,
		progress: progress ? new Float64Array( progress ) : null,
		sides: sides ? new Float64Array( sides ) : null,
		indices: new Uint32Array( indices ),
		vertexCount: positions.length / 3,
		indexCount: indices.length,
	}
}

function growTypedBuffer( current, nextLength, scratchName, usePooled ) {
	if ( usePooled && nextLength <= MAX_POOLED_SCRATCH_LENGTH ) {
		const next = new current.constructor( Math.min( MAX_POOLED_SCRATCH_LENGTH, Math.max( nextLength, current.length * 2 ) ) )
		next.set( current )
		joinScratch[scratchName] = next
		return next
	}
	const next = new current.constructor( Math.max( nextLength, current.length * 2 ) )
	next.set( current )
	return next
}

function acquireTopoBuffer( scratchName, length, usePooled ) {
	return usePooled
		? acquireScratch( scratchName, length )
		: new joinScratch[scratchName].constructor( length )
}

function initIdentityAliases( aliases, baseVertices ) {
	for ( let v = 0; v < baseVertices; v++ ) aliases[v] = v
}

function emitBaseSegmentVertices(
	path, frame, segmentStartSides, segmentEndSides,
	halfWidths, constantHalfWidth, stretchUV, invUvScale, seamEndU,
	positions, normals, tangents, uvs, progress, sides, indices
) {
	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	const points = path.points
	const normalsSource = frame.normals
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
		normals[posBase] = normals[posBase + 3] = snx
		normals[posBase + 1] = normals[posBase + 4] = sny
		normals[posBase + 2] = normals[posBase + 5] = snz
		normals[posBase + 6] = normals[posBase + 9] = enx
		normals[posBase + 7] = normals[posBase + 10] = eny
		normals[posBase + 8] = normals[posBase + 11] = enz

		if ( tangents ) {
			const stx = tangentsSource[startOffset]
			const sty = tangentsSource[startOffset + 1]
			const stz = tangentsSource[startOffset + 2]
			const etx = tangentsSource[endOffset]
			const ety = tangentsSource[endOffset + 1]
			const etz = tangentsSource[endOffset + 2]
			tangents[posBase] = tangents[posBase + 3] = stx
			tangents[posBase + 1] = tangents[posBase + 4] = sty
			tangents[posBase + 2] = tangents[posBase + 5] = stz
			tangents[posBase + 6] = tangents[posBase + 9] = etx
			tangents[posBase + 7] = tangents[posBase + 10] = ety
			tangents[posBase + 8] = tangents[posBase + 11] = etz
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

		const idxBase = segmentIndex * 6
		indices[idxBase] = startLeft
		indices[idxBase + 1] = endLeft
		indices[idxBase + 2] = startRight
		indices[idxBase + 3] = startRight
		indices[idxBase + 4] = endLeft
		indices[idxBase + 5] = endRight
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
	const nextCap = Math.max( needed, state.vertexCapacity * 2 )
	state.vertexCapacity = nextCap
	state.positions = growTypedBuffer( state.positions, nextCap * 3, 'topoPositions', usePooled )
	state.normals = growTypedBuffer( state.normals, nextCap * 3, 'topoNormals', usePooled )
	if ( state.tangents ) state.tangents = growTypedBuffer( state.tangents, nextCap * 3, 'topoTangents', usePooled )
	if ( state.uvs ) state.uvs = growTypedBuffer( state.uvs, nextCap * 2, 'topoUvs', usePooled )
	if ( state.progress ) state.progress = growTypedBuffer( state.progress, nextCap, 'topoProgress', usePooled )
	if ( state.sides ) state.sides = growTypedBuffer( state.sides, nextCap, 'topoSides', usePooled )
}

function topoEnsureIndexCapacity( state, needed ) {
	if ( needed <= state.indexCapacity ) return
	const nextCap = Math.max( needed, state.indexCapacity * 2 )
	state.indexCapacity = nextCap
	state.indices = growTypedBuffer( state.indices, nextCap, 'topoIndices', state.usePooled )
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

function topoEmitVertex(
	state, pointIndex, x, y, z, side,
	u = state.stretchUV ? state.progressSource[pointIndex] : state.distancesSource[pointIndex] * state.invUvScale,
	vertexProgress = state.progressSource[pointIndex]
) {
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
		uvs[v2] = u
		uvs[v2 + 1] = clamp( ( side + 1 ) * 0.5, 0, 1 )
	}
	if ( state.progress ) state.progress[vertex] = vertexProgress
	if ( state.sides ) state.sides[vertex] = clamp( side, -1, 1 )
	return vertex
}

function topoAliasJoinRows( state, baseVertices, incomingEnd0, incomingEnd1, outgoingStart0, outgoingStart1 ) {
	let aliases = state.aliases
	if ( !aliases ) {
		aliases = acquireScratch( 'topoAliases', baseVertices )
		initIdentityAliases( aliases, baseVertices )
		state.aliases = aliases
	}
	aliases[outgoingStart0] = incomingEnd0
	aliases[outgoingStart1] = incomingEnd1
	state.hasAliases = true
}

function emitVariableJoins(
	path, frame, halfWidths, constantHalfWidth, seamEndU,
	join, innerFactors, joinData, baseVertices, state
) {
	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	const points = path.points
	const normalsSource = frame.normals
	const cusps = path.cusps
	const closed = path.closed
	const firstJoinPoint = closed ? 0 : 1
	const lastJoinPoint = closed ? pointCount : pointCount - 1
	const isMiterJoin = join.type === 'miter'
	const isRoundJoin = join.type === 'round'
	const joinLimit = join.limit
	const joinSegments = join.segments

	for ( let pointIndex = firstJoinPoint; pointIndex < lastJoinPoint; pointIndex++ ) {
		const incomingIndex = pointIndex === 0 ? segmentCount - 1 : pointIndex - 1
		const outgoingIndex = pointIndex
		const incomingEnd0 = incomingIndex * 4 + 2
		const incomingEnd1 = incomingEnd0 + 1
		const outgoingStart0 = outgoingIndex * 4
		const outgoingStart1 = outgoingStart0 + 1
		const info = pointIndex * JOIN_STRIDE

		// Cusps carry no resolved join frame; they split like reversals.
		if ( cusps[pointIndex] || joinData[info + JOIN_SPLIT] ) {
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
		const scale = joinData[info + JOIN_SCALE]
		const seamJoin = closed && pointIndex === 0
		if ( angle === 0 ) {
			if ( !seamJoin ) topoAliasJoinRows( state, baseVertices, incomingEnd0, incomingEnd1, outgoingStart0, outgoingStart1 )
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
			if ( !seamJoin ) topoAliasJoinRows( state, baseVertices, incomingEnd0, incomingEnd1, outgoingStart0, outgoingStart1 )
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
			const roundSegs = getRoundJoinSegmentCount( angle, joinSegments )
			if ( roundSegs === 1 ) {
				topoPushTriangle( state, incomingInner, incomingOuter, outgoingOuter )
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
			topoPushTriangle( state, incomingInner, incomingOuter, outgoingOuter )
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
	const vertexCapacity = baseVertices +
		( join.type === 'round' ? Math.min( pointCount, 64 ) * join.segments : 0 ) +
		( path.closed ? join.segments + 4 : 0 ) +
		( cap.type !== 'butt' ? ( cap.segments + 2 ) * 4 : 0 )
	const indexCapacity = segmentCount * 6 + pointCount * 3 +
		( join.type === 'round' ? Math.min( pointCount, 64 ) * join.segments * 3 : 0 ) +
		( path.closed ? ( join.segments + 2 ) * 3 : 0 ) +
		( cap.type !== 'butt' ? cap.segments * 12 : 0 )

	const positions = acquireTopoBuffer( 'topoPositions', vertexCapacity * 3, usePooledLineArrays )
	const normals = acquireTopoBuffer( 'topoNormals', vertexCapacity * 3, usePooledLineArrays )
	const tangents = needs.tangents ? acquireTopoBuffer( 'topoTangents', vertexCapacity * 3, usePooledLineArrays ) : null
	const uvs = needs.uvs ? acquireTopoBuffer( 'topoUvs', vertexCapacity * 2, usePooledLineArrays ) : null
	const progress = needs.progress ? acquireTopoBuffer( 'topoProgress', vertexCapacity, usePooledLineArrays ) : null
	const sides = needs.sides ? acquireTopoBuffer( 'topoSides', vertexCapacity, usePooledLineArrays ) : null
	const indices = acquireTopoBuffer( 'topoIndices', indexCapacity, usePooledLineArrays )

	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null
	const stretchUV = surface.uvMode === 'stretch'
	const invUvScale = 1 / surface.uvScale
	const seamEndU = stretchUV ? 1 : path.totalLength * invUvScale

	emitBaseSegmentVertices(
		path, frame, segmentStartSides, segmentEndSides,
		halfWidths, constantHalfWidth, stretchUV, invUvScale, seamEndU,
		positions, normals, tangents, uvs, progress, sides, indices
	)

	topoState.positions = positions
	topoState.normals = normals
	topoState.tangents = tangents
	topoState.uvs = uvs
	topoState.progress = progress
	topoState.sides = sides
	topoState.indices = indices
	topoState.vertexCount = baseVertices
	topoState.vertexCapacity = vertexCapacity
	topoState.indexCount = segmentCount * 6
	topoState.indexCapacity = indexCapacity
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

	emitVariableJoins(
		path, frame, halfWidths, constantHalfWidth, seamEndU,
		join, innerFactors, joinData, baseVertices, topoState
	)

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
		topoState.vertexCount, topoState.indexCount, baseVertices,
		topoState.aliases, topoState.hasAliases,
		path.closed, usePooledLineArrays
	)
}

// Flat per-point join frames. Each join row is resolved once and shared by the
// inner-footprint, topology-mode, and variable-topology passes. Flat storage
// keeps long paths from allocating (and GC-promoting) small vectors per point.
const JOIN_STRIDE = 8
const JOIN_ANGLE = 0
const JOIN_SCALE = 1
const JOIN_SPLIT = 2
const JOIN_INSET = 3
const JOIN_MITER = 4
const segmentSideScratch = new Float64Array( 3 )
const roundRadialScratch = new Float64Array( 3 )

// Join frames, inner footprints, and single-line topology buffers never outlive
// `build()`, and no user callback runs while they are live, so one pool serves
// every line of every geometry instead of reallocating per build.
const MAX_POOLED_SCRATCH_LENGTH = 1 << 20
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
	compactOffsets: new Float64Array( 0 ),
	topoPositions: new Float64Array( 0 ),
	topoNormals: new Float32Array( 0 ),
	topoTangents: new Float64Array( 0 ),
	topoUvs: new Float64Array( 0 ),
	topoProgress: new Float32Array( 0 ),
	topoSides: new Float32Array( 0 ),
	topoIndices: new Uint32Array( 0 ),
	topoAliases: new Int32Array( 0 ),
	topoSplits: new Uint8Array( 0 ),
	topoRemap: new Int32Array( 0 ),
	topoUsed: new Int32Array( 0 ),
	topoPairVertices: new Int32Array( 0 ),
	topoCompactPositions: new Float64Array( 0 ),
	topoCompactNormals: new Float32Array( 0 ),
	topoCompactTangents: new Float64Array( 0 ),
	topoCompactUvs: new Float64Array( 0 ),
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

function computeJoinInfos( path, frame, needExactAngle = false ) {
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
	const needAtan2 = needExactAngle || path.closed
	for ( let pointIndex = first; pointIndex < last; pointIndex++ ) {
		const info = pointIndex * JOIN_STRIDE
		if ( path.cusps[pointIndex] ) {
			data[info + JOIN_INSET] = 0
			continue
		}
		writeJoinInfo( data, info, path, frame.normals, pointIndex, segmentStartSides, segmentEndSides, needAtan2 )
	}
	return data
}

function resolveInnerJoinFootprints( path, joinData, halfWidths, join, lineIndex ) {
	const pointCount = path.pointCount
	const segmentCount = path.segmentCount
	const constantHalfWidth = typeof halfWidths === 'number' ? halfWidths : null

	if ( join.inner === 'clip' ) {
		const factors = acquireScratch( 'footprints', pointCount ).subarray( 0, pointCount )
		factors.fill( 1 )
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
				}
			} else {
				if ( startReq > available ) {
					const scale = available / startReq
					if ( scale < factors[start] ) factors[start] = scale
				}
				if ( endReq > available ) {
					const scale = available / endReq
					if ( scale < factors[end] ) factors[end] = scale
				}
			}
		}

		return factors
	}

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

function remapTopologyIndices( indices, indexCount, baseVertices, aliases, remap, used, outIndices ) {
	let usedCount = 0
	for ( let offset = 0; offset < indexCount; offset++ ) {
		const rawVertex = indices[offset]
		const source = rawVertex < baseVertices ? aliases[rawVertex] : rawVertex
		let mapped = remap[source]
		if ( mapped === -1 ) {
			mapped = usedCount
			remap[source] = usedCount
			used[usedCount++] = source
		}
		outIndices[offset] = mapped
	}
	return usedCount
}

function compactPositionsAndNormals( used, usedCount, positions, normals, outPositions, outNormals ) {
	for ( let targetVertex = 0, targetOffset = 0; targetVertex < usedCount; targetVertex++, targetOffset += 3 ) {
		const sourceOffset = used[targetVertex] * 3
		outPositions[targetOffset] = positions[sourceOffset]
		outPositions[targetOffset + 1] = positions[sourceOffset + 1]
		outPositions[targetOffset + 2] = positions[sourceOffset + 2]
		outNormals[targetOffset] = normals[sourceOffset]
		outNormals[targetOffset + 1] = normals[sourceOffset + 1]
		outNormals[targetOffset + 2] = normals[sourceOffset + 2]
	}
}

function compactTangents( used, usedCount, tangents, outTangents ) {
	for ( let targetVertex = 0, targetOffset = 0; targetVertex < usedCount; targetVertex++, targetOffset += 3 ) {
		const sourceOffset = used[targetVertex] * 3
		outTangents[targetOffset] = tangents[sourceOffset]
		outTangents[targetOffset + 1] = tangents[sourceOffset + 1]
		outTangents[targetOffset + 2] = tangents[sourceOffset + 2]
	}
}

function compactUvs( used, usedCount, uvs, outUvs ) {
	for ( let targetVertex = 0, targetOffset = 0; targetVertex < usedCount; targetVertex++, targetOffset += 2 ) {
		const sourceOffset = used[targetVertex] * 2
		outUvs[targetOffset] = uvs[sourceOffset]
		outUvs[targetOffset + 1] = uvs[sourceOffset + 1]
	}
}

function compactScalars( used, usedCount, source, target ) {
	for ( let targetVertex = 0; targetVertex < usedCount; targetVertex++ ) {
		target[targetVertex] = source[used[targetVertex]]
	}
}

function buildPairVertices( pairVertices, remap, aliases, baseVertices ) {
	for ( let k = 0; k < baseVertices; k++ ) {
		pairVertices[k] = remap[aliases[k]]
	}
}

function finalizeVariableTopology(
	positions, normals, tangents, uvs, progress, sides, indices,
	vertexCount, indexCount, baseVertices, aliases, hasAliases,
	closed, usePooledLineArrays
) {
	if ( !hasAliases ) {
		const sliceOrView = ( array, count ) => {
			if ( !array ) return null
			return usePooledLineArrays ? array.subarray( 0, count ) : array.slice( 0, count )
		}
		return {
			positions: sliceOrView( positions, vertexCount * 3 ),
			normals: sliceOrView( normals, vertexCount * 3 ),
			tangents: sliceOrView( tangents, vertexCount * 3 ),
			uvs: sliceOrView( uvs, vertexCount * 2 ),
			progress: sliceOrView( progress, vertexCount ),
			sides: sliceOrView( sides, vertexCount ),
			indices: sliceOrView( indices, indexCount ),
			pairVertices: null,
			vertexCount,
			indexCount,
			seamPair: closed ? [baseVertices - 2, baseVertices - 1] : null,
		}
	}

	const remap = acquireScratch( 'topoRemap', vertexCount )
	remap.fill( -1, 0, vertexCount )
	const used = acquireScratch( 'topoUsed', vertexCount )
	const outIndices = acquireTopoBuffer( 'topoCompactIndices', indexCount, usePooledLineArrays )
	const usedCount = remapTopologyIndices( indices, indexCount, baseVertices, aliases, remap, used, outIndices )

	const outPositions = acquireTopoBuffer( 'topoCompactPositions', usedCount * 3, usePooledLineArrays )
	const outNormals = acquireTopoBuffer( 'topoCompactNormals', usedCount * 3, usePooledLineArrays )
	compactPositionsAndNormals( used, usedCount, positions, normals, outPositions, outNormals )

	let outTangents = null
	if ( tangents ) {
		outTangents = acquireTopoBuffer( 'topoCompactTangents', usedCount * 3, usePooledLineArrays )
		compactTangents( used, usedCount, tangents, outTangents )
	}

	let outUvs = null
	if ( uvs ) {
		outUvs = acquireTopoBuffer( 'topoCompactUvs', usedCount * 2, usePooledLineArrays )
		compactUvs( used, usedCount, uvs, outUvs )
	}

	let outProgress = null
	if ( progress ) {
		outProgress = acquireTopoBuffer( 'topoCompactProgress', usedCount, usePooledLineArrays )
		compactScalars( used, usedCount, progress, outProgress )
	}

	let outSides = null
	if ( sides ) {
		outSides = acquireTopoBuffer( 'topoCompactSides', usedCount, usePooledLineArrays )
		compactScalars( used, usedCount, sides, outSides )
	}

	const pairVertices = acquireTopoBuffer( 'topoPairVertices', baseVertices, usePooledLineArrays )
	buildPairVertices( pairVertices, remap, aliases, baseVertices )

	const seamPair = closed
		? [pairVertices[baseVertices - 2], pairVertices[baseVertices - 1]]
		: null

	return {
		positions: outPositions,
		normals: outNormals,
		tangents: outTangents,
		uvs: outUvs,
		progress: outProgress,
		sides: outSides,
		indices: outIndices,
		pairVertices,
		vertexCount: usedCount,
		indexCount,
		seamPair,
	}
}

function computeSegmentSide( normals, normalOffset, directions, directionOffset ) {
	writeSegmentSide( segmentSideScratch, 0, normals, normalOffset, directions, directionOffset )
	return [segmentSideScratch[0], segmentSideScratch[1], segmentSideScratch[2]]
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

/**
 * Resolve one join row into `target[targetOffset .. + JOIN_STRIDE]`: turn angle
 * (or signed sine when radian angle is unused), miter scale, split flag, unit
 * longitudinal inset, and unit miter (the incoming side when split). Also
 * writes the incident segment end/start sides into `segmentEndSides` and
 * `segmentStartSides`.
 */
function writeJoinInfo( target, targetOffset, path, normals, pointIndex, segmentStartSides, segmentEndSides, needExactAngle = false ) {
	const incomingIndex = pointIndex === 0 ? path.segmentCount - 1 : pointIndex - 1
	const outgoingIndex = pointIndex
	const offset = pointIndex * 3
	const incomingSideOffset = incomingIndex * 3
	const outgoingSideOffset = outgoingIndex * 3
	writeSegmentSide( segmentEndSides, incomingSideOffset, normals, offset, path.segmentDirections, incomingSideOffset )
	writeSegmentSide( segmentStartSides, outgoingSideOffset, normals, offset, path.segmentDirections, outgoingSideOffset )
	const incomingSideX = segmentEndSides[incomingSideOffset]
	const incomingSideY = segmentEndSides[incomingSideOffset + 1]
	const incomingSideZ = segmentEndSides[incomingSideOffset + 2]
	const outgoingSideX = segmentStartSides[outgoingSideOffset]
	const outgoingSideY = segmentStartSides[outgoingSideOffset + 1]
	const outgoingSideZ = segmentStartSides[outgoingSideOffset + 2]
	const normalX = normals[offset]
	const normalY = normals[offset + 1]
	const normalZ = normals[offset + 2]
	const crossX = incomingSideY * outgoingSideZ - incomingSideZ * outgoingSideY
	const crossY = incomingSideZ * outgoingSideX - incomingSideX * outgoingSideZ
	const crossZ = incomingSideX * outgoingSideY - incomingSideY * outgoingSideX
	const sine = crossX * normalX + crossY * normalY + crossZ * normalZ
	const cosine = clamp( incomingSideX * outgoingSideX + incomingSideY * outgoingSideY + incomingSideZ * outgoingSideZ, -1, 1 )
	let miterX = incomingSideX + outgoingSideX
	let miterY = incomingSideY + outgoingSideY
	let miterZ = incomingSideZ + outgoingSideZ
	const miterLength = hypot3( miterX, miterY, miterZ )
	let scale = Infinity
	let split = 1
	let unitInset = 0
	const isFlat = cosine > 0 && Math.abs( sine ) <= 1e-8

	if ( miterLength <= EPSILON || cosine <= REVERSAL_SPLIT_DOT ) {
		miterX = incomingSideX
		miterY = incomingSideY
		miterZ = incomingSideZ
	} else {
		const inverseMiterLength = 1 / miterLength
		miterX *= inverseMiterLength
		miterY *= inverseMiterLength
		miterZ *= inverseMiterLength
		const denominator = Math.abs( miterX * outgoingSideX + miterY * outgoingSideY + miterZ * outgoingSideZ )
		if ( denominator > EPSILON ) {
			scale = 1 / denominator
			split = 0
			if ( !isFlat ) unitInset = Math.abs( sine ) * inverseMiterLength * scale
		}
	}

	target[targetOffset + JOIN_ANGLE] = isFlat ? 0 : ( needExactAngle ? Math.atan2( sine, cosine ) : sine )
	target[targetOffset + JOIN_SCALE] = scale
	target[targetOffset + JOIN_SPLIT] = split
	target[targetOffset + JOIN_INSET] = unitInset
	target[targetOffset + JOIN_MITER] = miterX
	target[targetOffset + JOIN_MITER + 1] = miterY
	target[targetOffset + JOIN_MITER + 2] = miterZ
}

function emitRoundJoin(
	state,
	pointIndex, pivot, outerStart, outerEnd, outerSlot,
	centerX, centerY, centerZ, angle, normalX, normalY, normalZ, segmentCount
) {
	const positions = state.positions
	const sourceStart = outerStart * 3
	const startRadialX = positions[sourceStart] - centerX
	const startRadialY = positions[sourceStart + 1] - centerY
	const startRadialZ = positions[sourceStart + 2] - centerZ
	const outerSide = outerSlot === 0 ? -1 : 1
	const radial = roundRadialScratch
	let prevVertex = outerStart
	for ( let segment = 1; segment < segmentCount; segment++ ) {
		rotateVectorAroundAxisScalar(
			radial,
			startRadialX, startRadialY, startRadialZ,
			normalX, normalY, normalZ,
			angle * segment / segmentCount
		)
		const nextVertex = topoEmitVertex(
			state, pointIndex,
			centerX + radial[0], centerY + radial[1], centerZ + radial[2],
			outerSide
		)
		topoPushTriangle( state, pivot, prevVertex, nextVertex )
		prevVertex = nextVertex
	}
	topoPushTriangle( state, pivot, prevVertex, outerEnd )
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
	let prevVertex = topoEmitVertex(
		state, pointIndex,
		startPosX, startPosY, startPosZ,
		outerSide, seamU, 1
	)
	if ( join.type === 'round' ) {
		const segmentCount = getRoundJoinSegmentCount( angle, join.segments )
		const startRadialX = startPosX - centerX
		const startRadialY = startPosY - centerY
		const startRadialZ = startPosZ - centerZ
		const radial = roundRadialScratch
		for ( let segment = 1; segment < segmentCount; segment++ ) {
			rotateVectorAroundAxisScalar(
				radial,
				startRadialX, startRadialY, startRadialZ,
				normalX, normalY, normalZ,
				angle * segment / segmentCount
			)
			const nextVertex = topoEmitVertex(
				state, pointIndex,
				centerX + radial[0], centerY + radial[1], centerZ + radial[2],
				outerSide, seamU, 1
			)
			topoPushTriangle( state, pivot, prevVertex, nextVertex )
			prevVertex = nextVertex
		}
	}
	const endVertex = topoEmitVertex(
		state, pointIndex,
		endPosX, endPosY, endPosZ,
		outerSide, seamU, 1
	)
	topoPushTriangle( state, pivot, prevVertex, endVertex )
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
	const baseU = seamEndpoint
		? ( surface.uvMode === 'stretch' ? 1 : path.totalLength / surface.uvScale )
		: ( surface.uvMode === 'stretch' ? path.progress[pointIndex] : path.distances[pointIndex] / surface.uvScale )
	const endpointProgress = seamEndpoint ? 1 : path.progress[pointIndex]

	if ( cap.type === 'square' ) {
		const u = surface.uvMode === 'distance' ? baseU + directionSign * width / surface.uvScale : baseU
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

	const leftOffset = pairLeft * 3
	const startRadialX = positions[leftOffset] - centerX
	const startRadialY = positions[leftOffset + 1] - centerY
	const startRadialZ = positions[leftOffset + 2] - centerZ
	const pivot = topoEmitVertex( state, pointIndex, centerX, centerY, centerZ, 0, baseU, endpointProgress )
	const sweep = isEnd ? Math.PI : -Math.PI
	const normalX = frame.normals[pointOffset]
	const normalY = frame.normals[pointOffset + 1]
	const normalZ = frame.normals[pointOffset + 2]
	const radial = roundRadialScratch
	let prevVertex = pairLeft
	for ( let capSegment = 1; capSegment < cap.segments; capSegment++ ) {
		rotateVectorAroundAxisScalar(
			radial,
			startRadialX, startRadialY, startRadialZ,
			normalX, normalY, normalZ,
			sweep * capSegment / cap.segments
		)
		const rx = radial[0]
		const ry = radial[1]
		const rz = radial[2]
		const sideCoordinate = width > EPSILON ? ( rx * sideX + ry * sideY + rz * sideZ ) / width : 0
		const longitudinal = rx * dirX + ry * dirY + rz * dirZ
		const u = surface.uvMode === 'distance' ? baseU + longitudinal / surface.uvScale : baseU
		const nextVertex = topoEmitVertex(
			state, pointIndex,
			centerX + rx, centerY + ry, centerZ + rz,
			sideCoordinate, u, endpointProgress
		)
		topoPushTriangle( state, pivot, prevVertex, nextVertex )
		prevVertex = nextVertex
	}
	topoPushTriangle( state, pivot, prevVertex, pairRight )
}

function rotateVectorAroundAxis( vector, axis, angle ) {
	const cosine = Math.cos( angle )
	const sine = Math.sin( angle )
	const cross = crossVector( axis, vector )
	const dot = dotVector( axis, vector )
	const inverseCosine = 1 - cosine
	return [
		vector[0] * cosine + cross[0] * sine + axis[0] * dot * inverseCosine,
		vector[1] * cosine + cross[1] * sine + axis[1] * dot * inverseCosine,
		vector[2] * cosine + cross[2] * sine + axis[2] * dot * inverseCosine,
	]
}

function crossVector( a, b ) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	]
}

function dotVector( a, b ) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
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

function computeSegmentMetrics( points, pointCount, segmentCount, segmentDirections, segmentLengths, distances ) {
	distances[0] = 0
	let totalLength = 0
	for ( let i = 0; i < segmentCount; i++ ) {
		const next = i + 1 === pointCount ? 0 : i + 1
		const offset = i * 3
		const nextOffset = next * 3
		const dx = points[nextOffset] - points[offset]
		const dy = points[nextOffset + 1] - points[offset + 1]
		const dz = points[nextOffset + 2] - points[offset + 2]
		const length = hypot3( dx, dy, dz )

		if ( !( length > 0 && length < Infinity ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Degenerate segment at index ${i}` )
		}

		const invLength = 1 / length
		segmentDirections[offset] = dx * invLength
		segmentDirections[offset + 1] = dy * invLength
		segmentDirections[offset + 2] = dz * invLength
		segmentLengths[i] = length
		totalLength += length

		if ( i < pointCount - 1 ) {
			distances[i + 1] = totalLength
		}
	}

	return totalLength
}

function computePathTangentsAndProgress(
	segmentDirections, distances, tangents, progress, cusps,
	pointCount, segmentCount, closed, invTotalLength
) {
	let hasCusps = false
	if ( !closed ) {
		tangents[0] = segmentDirections[0]
		tangents[1] = segmentDirections[1]
		tangents[2] = segmentDirections[2]
		progress[0] = 0

		const lastPoint = pointCount - 1
		const lastTangentOffset = lastPoint * 3
		const lastDirOffset = ( pointCount - 2 ) * 3
		tangents[lastTangentOffset] = segmentDirections[lastDirOffset]
		tangents[lastTangentOffset + 1] = segmentDirections[lastDirOffset + 1]
		tangents[lastTangentOffset + 2] = segmentDirections[lastDirOffset + 2]
		progress[lastPoint] = distances[lastPoint] * invTotalLength

		for ( let i = 1; i < lastPoint; i++ ) {
			const incomingOffset = ( i - 1 ) * 3
			const outgoingOffset = i * 3
			const sumX = segmentDirections[incomingOffset] + segmentDirections[outgoingOffset]
			const sumY = segmentDirections[incomingOffset + 1] + segmentDirections[outgoingOffset + 1]
			const sumZ = segmentDirections[incomingOffset + 2] + segmentDirections[outgoingOffset + 2]
			const sumLength = hypot3( sumX, sumY, sumZ )

			if ( sumLength <= EPSILON ) {
				tangents[outgoingOffset] = segmentDirections[outgoingOffset]
				tangents[outgoingOffset + 1] = segmentDirections[outgoingOffset + 1]
				tangents[outgoingOffset + 2] = segmentDirections[outgoingOffset + 2]
				cusps[i] = 1
				hasCusps = true
			} else {
				const inverseLength = 1 / sumLength
				tangents[outgoingOffset] = sumX * inverseLength
				tangents[outgoingOffset + 1] = sumY * inverseLength
				tangents[outgoingOffset + 2] = sumZ * inverseLength
			}
			progress[i] = distances[i] * invTotalLength
		}
	} else {
		for ( let i = 0; i < pointCount; i++ ) {
			const incomingIndex = i === 0 ? segmentCount - 1 : i - 1
			const incomingOffset = incomingIndex * 3
			const outgoingOffset = i * 3
			const sumX = segmentDirections[incomingOffset] + segmentDirections[outgoingOffset]
			const sumY = segmentDirections[incomingOffset + 1] + segmentDirections[outgoingOffset + 1]
			const sumZ = segmentDirections[incomingOffset + 2] + segmentDirections[outgoingOffset + 2]
			const sumLength = hypot3( sumX, sumY, sumZ )

			if ( sumLength <= EPSILON ) {
				tangents[outgoingOffset] = segmentDirections[outgoingOffset]
				tangents[outgoingOffset + 1] = segmentDirections[outgoingOffset + 1]
				tangents[outgoingOffset + 2] = segmentDirections[outgoingOffset + 2]
				cusps[i] = 1
				hasCusps = true
			} else {
				const inverseLength = 1 / sumLength
				tangents[outgoingOffset] = sumX * inverseLength
				tangents[outgoingOffset + 1] = sumY * inverseLength
				tangents[outgoingOffset + 2] = sumZ * inverseLength
			}
			progress[i] = distances[i] * invTotalLength
		}
	}
	return hasCusps
}

function computePathData( points, closed, usePooledLineArrays = false ) {
	const pointCount = points.length / 3
	const segmentCount = closed ? pointCount : pointCount - 1
	const segmentDirections = acquireScratch( 'segmentDirections', segmentCount * 3 )
	const segmentLengths = acquireScratch( 'segmentLengths', segmentCount )
	const distances = usePooledLineArrays
		? acquireScratch( 'pathDistances', pointCount )
		: new Float64Array( pointCount )
	const progress = usePooledLineArrays
		? acquireScratch( 'pathProgress', pointCount )
		: new Float64Array( pointCount )
	const tangents = usePooledLineArrays
		? acquireScratch( 'pathTangents', pointCount * 3 )
		: new Float64Array( pointCount * 3 )
	const cusps = acquireScratch( 'cusps', pointCount )
	cusps.fill( 0, 0, pointCount )

	const totalLength = computeSegmentMetrics(
		points, pointCount, segmentCount,
		segmentDirections, segmentLengths, distances
	)
	if ( !( totalLength > 0 && totalLength < Infinity ) ) {
		throw new Error( '[MeshLineSurfaceGeometry] Line length must be greater than zero' )
	}
	const hasCusps = computePathTangentsAndProgress(
		segmentDirections, distances, tangents, progress, cusps,
		pointCount, segmentCount, closed, 1 / totalLength
	)

	return {
		points,
		closed,
		pointCount,
		segmentCount,
		segmentDirections,
		segmentLengths,
		distances,
		progress,
		tangents,
		cusps,
		hasCusps,
		totalLength,
	}
}

function computeFixedUpNormals( normals, tangents, pointCount, upX, upY, upZ ) {
	const candidate = frameCandidateScratch
	for ( let i = 1; i < pointCount; i++ ) {
		const offset = i * 3
		const tangentX = tangents[offset]
		const tangentY = tangents[offset + 1]
		const tangentZ = tangents[offset + 2]
		const previousNormalX = normals[offset - 3]
		const previousNormalY = normals[offset - 2]
		const previousNormalZ = normals[offset - 1]
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
	}
}

function computeTransportNormals( normals, tangents, pointCount ) {
	const candidate = frameCandidateScratch
	for ( let i = 1; i < pointCount; i++ ) {
		const offset = i * 3
		const tangentX = tangents[offset]
		const tangentY = tangents[offset + 1]
		const tangentZ = tangents[offset + 2]
		transportNormalScalar(
			candidate,
			normals[offset - 3], normals[offset - 2], normals[offset - 1],
			tangents[offset - 3], tangents[offset - 2], tangents[offset - 1],
			tangentX, tangentY, tangentZ
		)
		writeOrthonormalFrameScalar(
			normals, offset,
			tangentX, tangentY, tangentZ,
			candidate[0], candidate[1], candidate[2]
		)
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
		const angle = constantBank ?? resolveBank( bank, progress[i], i, lineIndex )
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

function computeHalfWidths( progress, options, lineIndex, pointCount = progress.length ) {
	const baseWidth = options.lineWidth ?? 0.3
	if ( !options.widthCallback ) return baseWidth * 0.5

	const halfWidths = new Float64Array( pointCount )

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
	}

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
	let points = compactConsecutivePoints( raw, epsilon )

	if ( closed && points.length >= 6 && pointsEqual(
		points, 0, points, points.length - 3, epsilon
	) ) {
		points = points.slice( 0, points.length - 3 )
	}

	const pointCount = points.length / 3
	const minimum = closed ? 3 : 2
	if ( pointCount < minimum ) {
		throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} requires at least ${minimum} distinct points` )
	}

	return { points, closed, isFloat32Input }
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

function copyFloat32ToFloat64( input, result, length, lineIndex ) {
	let maxMagnitude = 0
	for ( let i = 0; i < length; i++ ) {
		const v = input[i]
		const abs = Math.abs( v )
		if ( !( abs < Infinity ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${i} in line ${lineIndex}` )
		}
		result[i] = v
		if ( abs > maxMagnitude ) maxMagnitude = abs
	}
	return maxMagnitude
}

function copyFloat64ToFloat64( input, result, length, lineIndex ) {
	let maxMagnitude = 0
	for ( let i = 0; i < length; i++ ) {
		const v = input[i]
		const abs = Math.abs( v )
		if ( !( abs < Infinity ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${i} in line ${lineIndex}` )
		}
		result[i] = v
		if ( abs > maxMagnitude ) maxMagnitude = abs
	}
	return maxMagnitude
}

function copyArrayLikeToFloat64( input, result, length, lineIndex ) {
	let maxMagnitude = 0
	for ( let i = 0; i < length; i++ ) {
		const v = input[i]
		const abs = Math.abs( v )
		if ( !( abs < Infinity ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${i} in line ${lineIndex}` )
		}
		result[i] = v
		if ( abs > maxMagnitude ) maxMagnitude = abs
	}
	return maxMagnitude
}

function toFloat64( input, lineIndex, reusable = null ) {
	if ( input instanceof Float32Array ) {
		const length = input.length
		const result = reusable && reusable.length === length ? reusable : new Float64Array( length )
		lastToFloat64MaxMagnitude = copyFloat32ToFloat64( input, result, length, lineIndex )
		return result
	}
	if ( input instanceof Float64Array ) {
		const length = input.length
		const result = reusable && reusable.length === length ? reusable : new Float64Array( length )
		lastToFloat64MaxMagnitude = copyFloat64ToFloat64( input, result, length, lineIndex )
		return result
	}
	if ( ArrayBuffer.isView( input ) || ( Array.isArray( input ) && typeof input[0] === 'number' ) ) {
		const length = input.length
		const result = reusable && reusable.length === length ? reusable : new Float64Array( length )
		lastToFloat64MaxMagnitude = copyArrayLikeToFloat64( input, result, length, lineIndex )
		return result
	}

	let maxMagnitude = 0

	if ( input instanceof BufferGeometry ) {
		const attribute = input.getAttribute( 'position' )
		if ( !attribute ) throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} BufferGeometry has no position attribute` )
		const count = attribute.count
		const length = count * 3
		const result = reusable && reusable.length === length ? reusable : new Float64Array( length )
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
	const result = reusable && reusable.length === length ? reusable : new Float64Array( length )
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
