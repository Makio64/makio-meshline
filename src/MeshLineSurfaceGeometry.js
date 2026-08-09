import { Box3, BufferAttribute, BufferGeometry, Sphere, StaticDrawUsage, StreamDrawUsage } from 'three/webgpu'

const EPSILON = 1e-10
const DUPLICATE_EPSILON = 1e-12
const REVERSAL_SPLIT_ANGLE = Math.PI / 180
const REVERSAL_SPLIT_DOT = -Math.cos( REVERSAL_SPLIT_ANGLE )

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
		const lines = options.lines !== undefined ? options.lines : previousOptions.lines
		const surface = {
			...DEFAULT_SURFACE_OPTIONS,
			...( previousOptions.surface || {} ),
			...( options.surface || {} ),
		}
		const join = {
			...DEFAULT_JOIN_OPTIONS,
			...( previousOptions.join || {} ),
			...( options.join || {} ),
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
	 */
	setLines( lines ) {
		if ( lines == null ) throw new Error( '[MeshLineSurfaceGeometry] Lines data required' )

		const inputs = normalizeLinesInput( lines )
		if ( inputs.length === 0 ) throw new Error( '[MeshLineSurfaceGeometry] At least one line is required' )

		const closedOption = this.options?.closed ?? false
		const prepared = []

		for ( let i = 0; i < inputs.length; i++ ) {
			const closed = Array.isArray( closedOption ) ? !!closedOption[i] : !!closedOption
			prepared.push( prepareLine( inputs[i], closed, i ) )
		}

		this.options.lines = lines
		try {
			this._lines = prepared.map( line => line.points )
			this._surfaceLines = prepared.map( ( line, lineIndex ) => buildSurfaceLine(
				line,
				lineIndex,
				this.options
			) )

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
		const indices = existingIndex && existingIndex.array.constructor === IndexArray && existingIndex.array.length === totalIndices
			? existingIndex.array
			: new IndexArray( totalIndices )

		this._lineRanges = []
		let rowOffset = 0
		let vertexOffset = 0
		let indexOffset = 0
		let minX = Infinity
		let minY = Infinity
		let minZ = Infinity
		let maxX = -Infinity
		let maxY = -Infinity
		let maxZ = -Infinity

		for ( let lineIndex = 0; lineIndex < this._surfaceLines.length; lineIndex++ ) {
			const line = this._surfaceLines[lineIndex]
			const vertexStart = vertexOffset
			const indexStart = indexOffset
			let lineVertexCount
			if ( line.topology ) {
				lineVertexCount = line.topology.vertexCount
				for ( let localVertex = 0; localVertex < lineVertexCount; localVertex++ ) {
					const vertex = vertexStart + localVertex
					const local3 = localVertex * 3
					const positionOffset = vertex * 3
					const x = line.topology.positions[local3]
					const y = line.topology.positions[local3 + 1]
					const z = line.topology.positions[local3 + 2]
					positions[positionOffset] = x
					positions[positionOffset + 1] = y
					positions[positionOffset + 2] = z
					if ( !Number.isFinite( positions[positionOffset] ) || !Number.isFinite( positions[positionOffset + 1] ) || !Number.isFinite( positions[positionOffset + 2] ) ) {
						throw new Error( `[MeshLineSurfaceGeometry] Position overflow at vertex ${localVertex} of line ${lineIndex}` )
					}

					normals[positionOffset] = line.topology.normals[local3]
					normals[positionOffset + 1] = line.topology.normals[local3 + 1]
					normals[positionOffset + 2] = line.topology.normals[local3 + 2]
					if ( tangents ) {
						const tangentOffset = vertex * 4
						tangents[tangentOffset] = line.topology.tangents[local3]
						tangents[tangentOffset + 1] = line.topology.tangents[local3 + 1]
						tangents[tangentOffset + 2] = line.topology.tangents[local3 + 2]
						tangents[tangentOffset + 3] = 1
					}
					if ( uvs ) {
						const uvOffset = vertex * 2
						const u = line.topology.uvs[localVertex * 2]
						if ( !Number.isFinite( Math.fround( u ) ) ) {
							throw new Error( `[MeshLineSurfaceGeometry] UV overflow at vertex ${localVertex} of line ${lineIndex}; increase surface.uvScale` )
						}
						uvs[uvOffset] = u
						uvs[uvOffset + 1] = line.topology.uvs[localVertex * 2 + 1]
					}
					if ( progress ) progress[vertex] = line.topology.progress[localVertex]
					if ( sides ) sides[vertex] = line.topology.sides[localVertex]

					minX = Math.min( minX, positions[positionOffset] )
					minY = Math.min( minY, positions[positionOffset + 1] )
					minZ = Math.min( minZ, positions[positionOffset + 2] )
					maxX = Math.max( maxX, positions[positionOffset] )
					maxY = Math.max( maxY, positions[positionOffset + 1] )
					maxZ = Math.max( maxZ, positions[positionOffset + 2] )
				}

				for ( let pairOffset = 0; pairOffset < line.topology.widthPairs.length; pairOffset += 4 ) {
					const leftIndex = line.topology.widthPairs[pairOffset]
					const rightIndex = line.topology.widthPairs[pairOffset + 1]
					const left = vertexStart + leftIndex
					const right = vertexStart + rightIndex
					const leftSource = leftIndex * 3
					const rightSource = rightIndex * 3
					assertRepresentableSurfaceRow(
						positions, left * 3, right * 3,
						line.topology.positions[leftSource], line.topology.positions[leftSource + 1], line.topology.positions[leftSource + 2],
						line.topology.positions[rightSource], line.topology.positions[rightSource + 1], line.topology.positions[rightSource + 2],
						line.topology.widthPairs[pairOffset + 2], lineIndex, line.topology.widthPairs[pairOffset + 3]
					)
				}
				assertFloat32PathSegments( line.points, line.closed, lineIndex )

				for ( let localIndex = 0; localIndex < line.topology.indices.length; localIndex += 3 ) {
					const a = vertexStart + line.topology.indices[localIndex]
					const b = vertexStart + line.topology.indices[localIndex + 1]
					const c = vertexStart + line.topology.indices[localIndex + 2]
					const aNormal = a * 3
					const bNormal = b * 3
					const cNormal = c * 3
					indexOffset = writeOrientedTriangle(
						indices, indexOffset, positions, a, b, c,
						normals[aNormal] + normals[bNormal] + normals[cNormal],
						normals[aNormal + 1] + normals[bNormal + 1] + normals[cNormal + 1],
						normals[aNormal + 2] + normals[bNormal + 2] + normals[cNormal + 2]
					)
				}
			} else {
				lineVertexCount = line.rowCount * 2 + ( line.capTopology?.vertexCount || 0 )
				for ( let row = 0; row < line.rowCount; row++ ) {
					const sourceIndex = row === line.pointCount ? 0 : row
					const pointOffset = sourceIndex * 3
					const centerX = line.points[pointOffset]
					const centerY = line.points[pointOffset + 1]
					const centerZ = line.points[pointOffset + 2]
					const offsetX = line.offsets[pointOffset]
					const offsetY = line.offsets[pointOffset + 1]
					const offsetZ = line.offsets[pointOffset + 2]
					const halfWidth = typeof line.halfWidths === 'number' ? line.halfWidths : line.halfWidths[sourceIndex]
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

					minX = Math.min( minX, positions[leftPosition], positions[rightPosition] )
					minY = Math.min( minY, positions[leftPosition + 1], positions[rightPosition + 1] )
					minZ = Math.min( minZ, positions[leftPosition + 2], positions[rightPosition + 2] )
					maxX = Math.max( maxX, positions[leftPosition], positions[rightPosition] )
					maxY = Math.max( maxY, positions[leftPosition + 1], positions[rightPosition + 1] )
					maxZ = Math.max( maxZ, positions[leftPosition + 2], positions[rightPosition + 2] )

					writePair3( normals, vertex, line.normals[pointOffset], line.normals[pointOffset + 1], line.normals[pointOffset + 2] )
					if ( tangents ) writePair4( tangents, vertex, line.tangents[pointOffset], line.tangents[pointOffset + 1], line.tangents[pointOffset + 2], 1 )
					const rowProgress = row === line.pointCount ? 1 : line.progress[sourceIndex]
					if ( uvs ) {
						const u = row === line.pointCount
							? line.seamU
							: ( line.uvMode === 'stretch' ? line.progress[sourceIndex] : line.distances[sourceIndex] / line.uvScale )
						if ( !Number.isFinite( Math.fround( u ) ) ) {
							throw new Error( `[MeshLineSurfaceGeometry] UV overflow at row ${row} of line ${lineIndex}; increase surface.uvScale` )
						}
						uvs[vertex * 2] = u
						uvs[vertex * 2 + 1] = 0
						uvs[vertex * 2 + 2] = u
						uvs[vertex * 2 + 3] = 1
					}
					if ( progress ) {
						progress[vertex] = rowProgress
						progress[vertex + 1] = rowProgress
					}
					if ( sides ) {
						sides[vertex] = -1
						sides[vertex + 1] = 1
					}
				}

				for ( let segment = 0; segment < line.rowCount - 1; segment++ ) {
					const left0 = vertexStart + segment * 2
					const right0 = left0 + 1
					const left1 = left0 + 2
					const right1 = left0 + 3
					const normalOffset0 = left0 * 3
					const normalOffset1 = left1 * 3
					let expectedNormalX = normals[normalOffset0] + normals[normalOffset1]
					let expectedNormalY = normals[normalOffset0 + 1] + normals[normalOffset1 + 1]
					let expectedNormalZ = normals[normalOffset0 + 2] + normals[normalOffset1 + 2]
					if ( Math.hypot( expectedNormalX, expectedNormalY, expectedNormalZ ) <= EPSILON ) {
						expectedNormalX = normals[normalOffset0]
						expectedNormalY = normals[normalOffset0 + 1]
						expectedNormalZ = normals[normalOffset0 + 2]
					}
					indexOffset = writeOrientedTriangle( indices, indexOffset, positions, left0, left1, right0, expectedNormalX, expectedNormalY, expectedNormalZ )
					indexOffset = writeOrientedTriangle( indices, indexOffset, positions, right0, left1, right1, expectedNormalX, expectedNormalY, expectedNormalZ )
				}

				if ( line.capTopology ) {
					const bodyVertexCount = line.rowCount * 2
					for ( let extraVertex = 0; extraVertex < line.capTopology.vertexCount; extraVertex++ ) {
						const vertex = vertexStart + bodyVertexCount + extraVertex
						const source3 = extraVertex * 3
						const target3 = vertex * 3
						positions[target3] = line.capTopology.positions[source3]
						positions[target3 + 1] = line.capTopology.positions[source3 + 1]
						positions[target3 + 2] = line.capTopology.positions[source3 + 2]
						if ( !Number.isFinite( positions[target3] ) || !Number.isFinite( positions[target3 + 1] ) || !Number.isFinite( positions[target3 + 2] ) ) {
							throw new Error( `[MeshLineSurfaceGeometry] Position overflow at cap vertex ${extraVertex} of line ${lineIndex}` )
						}
						normals[target3] = line.capTopology.normals[source3]
						normals[target3 + 1] = line.capTopology.normals[source3 + 1]
						normals[target3 + 2] = line.capTopology.normals[source3 + 2]
						if ( tangents ) {
							const target4 = vertex * 4
							tangents[target4] = line.capTopology.tangents[source3]
							tangents[target4 + 1] = line.capTopology.tangents[source3 + 1]
							tangents[target4 + 2] = line.capTopology.tangents[source3 + 2]
							tangents[target4 + 3] = 1
						}
						if ( uvs ) {
							const target2 = vertex * 2
							const source2 = extraVertex * 2
							const u = line.capTopology.uvs[source2]
							if ( !Number.isFinite( Math.fround( u ) ) ) {
								throw new Error( `[MeshLineSurfaceGeometry] UV overflow at cap vertex ${extraVertex} of line ${lineIndex}; increase surface.uvScale` )
							}
							uvs[target2] = u
							uvs[target2 + 1] = line.capTopology.uvs[source2 + 1]
						}
						if ( progress ) progress[vertex] = line.capTopology.progress[extraVertex]
						if ( sides ) sides[vertex] = line.capTopology.sides[extraVertex]
						minX = Math.min( minX, positions[target3] )
						minY = Math.min( minY, positions[target3 + 1] )
						minZ = Math.min( minZ, positions[target3 + 2] )
						maxX = Math.max( maxX, positions[target3] )
						maxY = Math.max( maxY, positions[target3 + 1] )
						maxZ = Math.max( maxZ, positions[target3 + 2] )
					}
					for ( let capIndex = 0; capIndex < line.capTopology.indices.length; capIndex += 3 ) {
						const a = vertexStart + line.capTopology.indices[capIndex]
						const b = vertexStart + line.capTopology.indices[capIndex + 1]
						const c = vertexStart + line.capTopology.indices[capIndex + 2]
						const aNormal = a * 3
						const bNormal = b * 3
						const cNormal = c * 3
						indexOffset = writeOrientedTriangle(
							indices, indexOffset, positions, a, b, c,
							normals[aNormal] + normals[bNormal] + normals[cNormal],
							normals[aNormal + 1] + normals[bNormal + 1] + normals[cNormal + 1],
							normals[aNormal + 2] + normals[bNormal + 2] + normals[cNormal + 2]
						)
					}
				}
				assertFloat32PathSegments( line.points, line.closed, lineIndex )
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
			existingIndex.needsUpdate = true
		} else {
			this.setIndex( new BufferAttribute( indices, 1 ) )
		}
		this.updateBounds( positions, minX, minY, minZ, maxX, maxY, maxZ )
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
		const center = this.boundingSphere.center
		center.set(
			( minX + maxX ) * 0.5,
			( minY + maxY ) * 0.5,
			( minZ + maxZ ) * 0.5
		)

		let maxRadiusSquared = 0
		for ( let offset = 0; offset < positions.length; offset += 3 ) {
			const dx = positions[offset] - center.x
			const dy = positions[offset + 1] - center.y
			const dz = positions[offset + 2] - center.z
			maxRadiusSquared = Math.max( maxRadiusSquared, dx * dx + dy * dy + dz * dz )
		}
		this.boundingSphere.radius = Math.sqrt( maxRadiusSquared )
	}

}

function buildSurfaceLine( line, lineIndex, options ) {
	const { points, closed } = line
	const pointCount = points.length / 3
	const path = computePathData( points, closed )
	const frame = computeFrames( path, options.surface, lineIndex )
	const halfWidths = computeHalfWidths( path.progress, options, lineIndex )
	const offsets = computeOffsets( path, frame, options.join )
	const topologyNeeds = {
		tangents: !!( options.needsTangents || options.surface.normalMap ),
		uvs: !!(
			options.needsUV || options.map || options.alphaMap || options.surface.normalMap ||
			options.surface.roughnessMap || options.surface.metalnessMap
		),
		progress: !!options.needsProgress,
		sides: !!options.needsSide,
	}
	const topologyMode = getVariableTopologyMode( path, frame, options.join, options.cap )
	const topology = topologyMode === 'full'
		? buildVariableTopology( path, frame, halfWidths, options.surface, options.join, options.cap, topologyNeeds, lineIndex )
		: null
	const capTopology = topologyMode === 'caps'
		? buildCompactCapTopology( path, frame, offsets, halfWidths, options.surface, options.cap, topologyNeeds )
		: null

	return {
		points,
		closed,
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

function getVariableTopologyMode( path, frame, join, cap ) {
	for ( let pointIndex = 0; pointIndex < path.pointCount; pointIndex++ ) {
		const hasJoin = path.closed || ( pointIndex > 0 && pointIndex < path.pointCount - 1 )
		if ( !hasJoin ) continue
		if ( path.cusps[pointIndex] ) return 'full'
		const info = computeJoinInfo( path, frame, pointIndex )
		if ( info.split ) return 'full'
		if ( Math.abs( info.angle ) <= 1e-8 ) continue
		if ( join.type !== 'miter' || info.scale > join.limit ) return 'full'
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

function buildVariableTopology( path, frame, halfWidths, surface, join, cap, needs, lineIndex ) {
	const positions = []
	const normals = []
	const tangents = needs.tangents ? [] : null
	const uvs = needs.uvs ? [] : null
	const progress = needs.progress ? [] : null
	const sides = needs.sides ? [] : null
	const indices = []
	const widthPairs = []
	let aliases = null
	const segments = new Array( path.segmentCount )
	const splits = new Uint8Array( path.pointCount )
	const segmentStartInset = new Float64Array( path.segmentCount )
	const segmentEndInset = new Float64Array( path.segmentCount )
	const segmentStartInsetSide = new Int8Array( path.segmentCount )
	const segmentEndInsetSide = new Int8Array( path.segmentCount )
	let hasAliases = false

	const getHalfWidth = pointIndex => typeof halfWidths === 'number' ? halfWidths : halfWidths[pointIndex]
	const getU = ( pointIndex, seam = false ) => {
		if ( seam ) return surface.uvMode === 'stretch' ? 1 : path.totalLength / surface.uvScale
		return surface.uvMode === 'stretch' ? path.progress[pointIndex] : path.distances[pointIndex] / surface.uvScale
	}
	const emitVertex = ( pointIndex, x, y, z, side, u = getU( pointIndex ), vertexProgress = path.progress[pointIndex] ) => {
		const vertex = positions.length / 3
		const pointOffset = pointIndex * 3
		positions.push( x, y, z )
		normals.push( frame.normals[pointOffset], frame.normals[pointOffset + 1], frame.normals[pointOffset + 2] )
		if ( tangents ) tangents.push( path.tangents[pointOffset], path.tangents[pointOffset + 1], path.tangents[pointOffset + 2] )
		if ( uvs ) uvs.push( u, clamp( ( side + 1 ) * 0.5, 0, 1 ) )
		if ( progress ) progress.push( vertexProgress )
		if ( sides ) sides.push( clamp( side, -1, 1 ) )
		if ( aliases ) aliases.push( vertex )
		return vertex
	}
	const setVertexPosition = ( vertex, x, y, z ) => {
		const offset = vertex * 3
		positions[offset] = x
		positions[offset + 1] = y
		positions[offset + 2] = z
	}
	const aliasJoinRows = ( incoming, outgoing ) => {
		if ( !aliases ) aliases = Array.from( { length: positions.length / 3 }, ( _, vertex ) => vertex )
		aliases[outgoing.start[0]] = incoming.end[0]
		aliases[outgoing.start[1]] = incoming.end[1]
		hasAliases = true
	}

	for ( let segmentIndex = 0; segmentIndex < path.segmentCount; segmentIndex++ ) {
		const startPoint = segmentIndex
		const endPoint = segmentIndex + 1 === path.pointCount ? 0 : segmentIndex + 1
		const startOffset = startPoint * 3
		const endOffset = endPoint * 3
		const directionOffset = segmentIndex * 3
		const startSide = computeSegmentSide( frame.normals, startOffset, path.segmentDirections, directionOffset )
		const endSide = computeSegmentSide( frame.normals, endOffset, path.segmentDirections, directionOffset )
		const startWidth = getHalfWidth( startPoint )
		const endWidth = getHalfWidth( endPoint )
		const seamEnd = path.closed && endPoint === 0
		const startU = getU( startPoint )
		const endU = getU( endPoint, seamEnd )
		const endProgress = seamEnd ? 1 : path.progress[endPoint]

		const startLeft = emitVertex(
			startPoint,
			path.points[startOffset] - startSide[0] * startWidth,
			path.points[startOffset + 1] - startSide[1] * startWidth,
			path.points[startOffset + 2] - startSide[2] * startWidth,
			-1, startU
		)
		const startRight = emitVertex(
			startPoint,
			path.points[startOffset] + startSide[0] * startWidth,
			path.points[startOffset + 1] + startSide[1] * startWidth,
			path.points[startOffset + 2] + startSide[2] * startWidth,
			1, startU
		)
		const endLeft = emitVertex(
			endPoint,
			path.points[endOffset] - endSide[0] * endWidth,
			path.points[endOffset + 1] - endSide[1] * endWidth,
			path.points[endOffset + 2] - endSide[2] * endWidth,
			-1, endU, endProgress
		)
		const endRight = emitVertex(
			endPoint,
			path.points[endOffset] + endSide[0] * endWidth,
			path.points[endOffset + 1] + endSide[1] * endWidth,
			path.points[endOffset + 2] + endSide[2] * endWidth,
			1, endU, endProgress
		)

		segments[segmentIndex] = {
			direction: [
				path.segmentDirections[directionOffset],
				path.segmentDirections[directionOffset + 1],
				path.segmentDirections[directionOffset + 2],
			],
			startSide,
			endSide,
			start: [startLeft, startRight],
			end: [endLeft, endRight],
		}
		widthPairs.push(
			startLeft, startRight, startWidth, startPoint,
			endLeft, endRight, endWidth, endPoint
		)
		indices.push( startLeft, endLeft, startRight, startRight, endLeft, endRight )
	}

	for ( let pointIndex = 0; pointIndex < path.pointCount; pointIndex++ ) {
		const hasJoin = path.closed || ( pointIndex > 0 && pointIndex < path.pointCount - 1 )
		if ( !hasJoin ) continue
		const incomingIndex = ( pointIndex - 1 + path.segmentCount ) % path.segmentCount
		const outgoingIndex = pointIndex % path.segmentCount
		const incoming = segments[incomingIndex]
		const outgoing = segments[outgoingIndex]
		const info = computeJoinInfoFromSides( frame, pointIndex, incoming.endSide, outgoing.startSide )

		if ( path.cusps[pointIndex] || info.split ) {
			splits[pointIndex] = 1
			continue
		}
		const seamJoin = path.closed && pointIndex === 0
		if ( Math.abs( info.angle ) <= 1e-8 ) {
			if ( !seamJoin ) aliasJoinRows( incoming, outgoing )
			continue
		}

		const pointOffset = pointIndex * 3
		const centerX = path.points[pointOffset]
		const centerY = path.points[pointOffset + 1]
		const centerZ = path.points[pointOffset + 2]
		const width = getHalfWidth( pointIndex )
		const turnSign = info.angle > 0 ? 1 : -1
		const innerOffset = reserveExactJoinFootprint(
			path, info, width, turnSign,
			incomingIndex, outgoingIndex,
			segmentStartInset, segmentEndInset,
			segmentStartInsetSide, segmentEndInsetSide,
			lineIndex, pointIndex
		)
		if ( join.type === 'miter' && info.scale <= join.limit ) {
			for ( const coordinateSide of [-1, 1] ) {
				const x = centerX + info.miter[0] * width * info.scale * coordinateSide
				const y = centerY + info.miter[1] * width * info.scale * coordinateSide
				const z = centerZ + info.miter[2] * width * info.scale * coordinateSide
				setVertexPosition( incoming.end[( coordinateSide + 1 ) / 2], x, y, z )
				setVertexPosition( outgoing.start[( coordinateSide + 1 ) / 2], x, y, z )
			}
			if ( !seamJoin ) aliasJoinRows( incoming, outgoing )
			continue
		}

		const innerSlot = turnSign > 0 ? 1 : 0
		const outerSlot = 1 - innerSlot
		const innerX = centerX + innerOffset[0]
		const innerY = centerY + innerOffset[1]
		const innerZ = centerZ + innerOffset[2]
		setVertexPosition( incoming.end[innerSlot], innerX, innerY, innerZ )
		setVertexPosition( outgoing.start[innerSlot], innerX, innerY, innerZ )

		if ( seamJoin ) {
			emitSeamJoin(
				positions, indices, emitVertex,
				pointIndex, incoming, outgoing, innerSlot, outerSlot,
				centerX, centerY, centerZ, innerX, innerY, innerZ, info, join,
				getU( 0, true )
			)
		} else if ( join.type === 'round' ) {
			const segmentCount = getRoundJoinSegmentCount( info.angle, join.segments )
			if ( segmentCount === 1 ) {
				indices.push( incoming.end[innerSlot], incoming.end[outerSlot], outgoing.start[outerSlot] )
			} else {
				emitRoundJoin(
					positions, indices, emitVertex,
					pointIndex, incoming, outgoing, innerSlot, outerSlot,
					centerX, centerY, centerZ, info, segmentCount
				)
			}
		} else {
			indices.push( incoming.end[innerSlot], incoming.end[outerSlot], outgoing.start[outerSlot] )
		}
	}

	if ( !path.closed ) {
		emitCap( false, 0, segments[0], path, frame, getHalfWidth( 0 ), surface, cap, positions, indices, emitVertex )
		emitCap( true, path.pointCount - 1, segments[path.segmentCount - 1], path, frame, getHalfWidth( path.pointCount - 1 ), surface, cap, positions, indices, emitVertex )
	}
	for ( let pointIndex = 0; pointIndex < path.pointCount; pointIndex++ ) {
		if ( !splits[pointIndex] ) continue
		const incomingIndex = ( pointIndex - 1 + path.segmentCount ) % path.segmentCount
		const outgoingIndex = pointIndex % path.segmentCount
		emitCap( true, pointIndex, segments[incomingIndex], path, frame, getHalfWidth( pointIndex ), surface, cap, positions, indices, emitVertex, true )
		emitCap( false, pointIndex, segments[outgoingIndex], path, frame, getHalfWidth( pointIndex ), surface, cap, positions, indices, emitVertex, true )
	}

	return finalizeVariableTopology( {
		positions, normals, tangents, uvs, progress, sides, indices, widthPairs, aliases,
		seamPair: path.closed ? segments[path.segmentCount - 1].end : null,
	}, hasAliases )
}

function reserveExactJoinFootprint(
	path, info, width, turnSign,
	incomingIndex, outgoingIndex,
	segmentStartInset, segmentEndInset,
	segmentStartInsetSide, segmentEndInsetSide,
	lineIndex, pointIndex
) {
	const signedScale = width * info.scale * turnSign
	const innerOffset = [
		info.miter[0] * signedScale,
		info.miter[1] * signedScale,
		info.miter[2] * signedScale,
	]
	segmentEndInset[incomingIndex] = Math.max( 0, -dotVector( innerOffset, info.incomingDirection ) )
	segmentStartInset[outgoingIndex] = Math.max( 0, dotVector( innerOffset, info.outgoingDirection ) )
	segmentEndInsetSide[incomingIndex] = turnSign
	segmentStartInsetSide[outgoingIndex] = turnSign

	for ( const segmentIndex of incomingIndex === outgoingIndex ? [incomingIndex] : [incomingIndex, outgoingIndex] ) {
		const sameSide = segmentStartInsetSide[segmentIndex] !== 0 &&
			segmentStartInsetSide[segmentIndex] === segmentEndInsetSide[segmentIndex]
		const required = sameSide
			? segmentStartInset[segmentIndex] + segmentEndInset[segmentIndex]
			: Math.max( segmentStartInset[segmentIndex], segmentEndInset[segmentIndex] )
		const available = path.segmentLengths[segmentIndex]
		const tolerance = Math.max( EPSILON, available * 1e-12 )
		if ( required > available + tolerance ) {
			throw new Error(
				`[MeshLineSurfaceGeometry] Exact inner join at point ${pointIndex} of line ${lineIndex} requires ${required} units on segment ${segmentIndex}, but only ${available} are available; lengthen or split the centerline, or reduce lineWidth`
			)
		}
	}

	return innerOffset
}

function finalizeVariableTopology( topology, hasAliases ) {
	if ( !hasAliases ) {
		return {
			positions: new Float64Array( topology.positions ),
			normals: new Float64Array( topology.normals ),
			tangents: topology.tangents ? new Float64Array( topology.tangents ) : null,
			uvs: topology.uvs ? new Float64Array( topology.uvs ) : null,
			progress: topology.progress ? new Float64Array( topology.progress ) : null,
			sides: topology.sides ? new Float64Array( topology.sides ) : null,
			indices: new Uint32Array( topology.indices ),
			widthPairs: topology.widthPairs,
			vertexCount: topology.positions.length / 3,
			indexCount: topology.indices.length,
			seamPair: topology.seamPair,
		}
	}

	const resolveAlias = vertex => {
		let result = vertex
		while ( topology.aliases[result] !== result ) result = topology.aliases[result]
		return result
	}
	const remap = new Int32Array( topology.aliases.length ).fill( -1 )
	const used = []
	const indices = new Uint32Array( topology.indices.length )
	for ( let offset = 0; offset < topology.indices.length; offset++ ) {
		const source = resolveAlias( topology.indices[offset] )
		if ( remap[source] === -1 ) {
			remap[source] = used.length
			used.push( source )
		}
		indices[offset] = remap[source]
	}

	const compact = ( source, itemSize ) => {
		if ( !source ) return null
		const target = new Float64Array( used.length * itemSize )
		for ( let targetVertex = 0; targetVertex < used.length; targetVertex++ ) {
			const sourceOffset = used[targetVertex] * itemSize
			const targetOffset = targetVertex * itemSize
			for ( let component = 0; component < itemSize; component++ ) {
				target[targetOffset + component] = source[sourceOffset + component]
			}
		}
		return target
	}
	const widthPairs = []
	for ( let pairOffset = 0; pairOffset < topology.widthPairs.length; pairOffset += 4 ) {
		const left = remap[resolveAlias( topology.widthPairs[pairOffset] )]
		const right = remap[resolveAlias( topology.widthPairs[pairOffset + 1] )]
		if ( left < 0 || right < 0 ) continue
		widthPairs.push( left, right, topology.widthPairs[pairOffset + 2], topology.widthPairs[pairOffset + 3] )
	}
	const seamPair = topology.seamPair
		? topology.seamPair.map( vertex => remap[resolveAlias( vertex )] )
		: null

	return {
		positions: compact( topology.positions, 3 ),
		normals: compact( topology.normals, 3 ),
		tangents: compact( topology.tangents, 3 ),
		uvs: compact( topology.uvs, 2 ),
		progress: compact( topology.progress, 1 ),
		sides: compact( topology.sides, 1 ),
		indices,
		widthPairs,
		vertexCount: used.length,
		indexCount: indices.length,
		seamPair,
	}
}

function computeSegmentSide( normals, normalOffset, directions, directionOffset ) {
	const normalX = normals[normalOffset]
	const normalY = normals[normalOffset + 1]
	const normalZ = normals[normalOffset + 2]
	const directionX = directions[directionOffset]
	const directionY = directions[directionOffset + 1]
	const directionZ = directions[directionOffset + 2]
	let sideX = normalY * directionZ - normalZ * directionY
	let sideY = normalZ * directionX - normalX * directionZ
	let sideZ = normalX * directionY - normalY * directionX
	const length = Math.hypot( sideX, sideY, sideZ )
	if ( !Number.isFinite( length ) || length <= EPSILON ) {
		throw new Error( '[MeshLineSurfaceGeometry] Surface frame is parallel to a path segment' )
	}
	const inverseLength = 1 / length
	sideX *= inverseLength
	sideY *= inverseLength
	sideZ *= inverseLength
	return [sideX, sideY, sideZ]
}

function computeJoinInfo( path, frame, pointIndex ) {
	const incomingIndex = ( pointIndex - 1 + path.segmentCount ) % path.segmentCount
	const outgoingIndex = pointIndex % path.segmentCount
	const pointOffset = pointIndex * 3
	return computeJoinInfoFromSides(
		frame, pointIndex,
		computeSegmentSide( frame.normals, pointOffset, path.segmentDirections, incomingIndex * 3 ),
		computeSegmentSide( frame.normals, pointOffset, path.segmentDirections, outgoingIndex * 3 )
	)
}

function computeJoinInfoFromSides( frame, pointIndex, incomingSide, outgoingSide ) {
	const offset = pointIndex * 3
	const normal = [frame.normals[offset], frame.normals[offset + 1], frame.normals[offset + 2]]
	const incomingDirection = crossVector( incomingSide, normal )
	const outgoingDirection = crossVector( outgoingSide, normal )
	const directionCross = crossVector( incomingDirection, outgoingDirection )
	const sine = dotVector( directionCross, normal )
	const cosine = clamp( dotVector( incomingDirection, outgoingDirection ), -1, 1 )
	const angle = Math.atan2( sine, cosine )
	let miterX = incomingSide[0] + outgoingSide[0]
	let miterY = incomingSide[1] + outgoingSide[1]
	let miterZ = incomingSide[2] + outgoingSide[2]
	const miterLength = Math.hypot( miterX, miterY, miterZ )

	if ( miterLength <= EPSILON || cosine <= REVERSAL_SPLIT_DOT ) {
		return {
			angle,
			scale: Infinity,
			split: true,
			normal,
			miter: incomingSide,
			incomingDirection,
			outgoingDirection,
		}
	}

	const inverseMiterLength = 1 / miterLength
	miterX *= inverseMiterLength
	miterY *= inverseMiterLength
	miterZ *= inverseMiterLength
	const denominator = Math.abs( miterX * outgoingSide[0] + miterY * outgoingSide[1] + miterZ * outgoingSide[2] )
	const scale = denominator > EPSILON ? 1 / denominator : Infinity
	return {
		angle,
		scale,
		split: !Number.isFinite( scale ),
		normal,
		miter: [miterX, miterY, miterZ],
		incomingDirection,
		outgoingDirection,
	}
}

function emitRoundJoin(
	positions, indices, emitVertex,
	pointIndex, incoming, outgoing, innerSlot, outerSlot,
	centerX, centerY, centerZ, info, segmentCount
) {
	const pivot = incoming.end[innerSlot]
	const outerStart = incoming.end[outerSlot]
	const outerEnd = outgoing.start[outerSlot]
	const sourceStart = outerStart * 3
	const startRadial = [
		positions[sourceStart] - centerX,
		positions[sourceStart + 1] - centerY,
		positions[sourceStart + 2] - centerZ,
	]
	const arc = [outerStart]
	for ( let segment = 1; segment < segmentCount; segment++ ) {
		const radial = rotateVectorAroundAxis( startRadial, info.normal, info.angle * segment / segmentCount )
		arc.push( emitVertex(
			pointIndex,
			centerX + radial[0], centerY + radial[1], centerZ + radial[2],
			outerSlot === 0 ? -1 : 1
		) )
	}
	arc.push( outerEnd )
	for ( let segment = 0; segment < arc.length - 1; segment++ ) {
		indices.push( pivot, arc[segment], arc[segment + 1] )
	}
}

function emitSeamJoin(
	positions, indices, emitVertex,
	pointIndex, incoming, outgoing, innerSlot, outerSlot,
	centerX, centerY, centerZ, innerX, innerY, innerZ, info, join, seamU
) {
	const startOffset = incoming.end[outerSlot] * 3
	const endOffset = outgoing.start[outerSlot] * 3
	const pivot = emitVertex( pointIndex, innerX, innerY, innerZ, innerSlot === 0 ? -1 : 1, seamU, 1 )
	const outerSide = outerSlot === 0 ? -1 : 1
	const outerStart = emitVertex(
		pointIndex,
		positions[startOffset], positions[startOffset + 1], positions[startOffset + 2],
		outerSide, seamU, 1
	)
	const arc = [outerStart]
	if ( join.type === 'round' ) {
		const segmentCount = getRoundJoinSegmentCount( info.angle, join.segments )
		const startRadial = [
			positions[startOffset] - centerX,
			positions[startOffset + 1] - centerY,
			positions[startOffset + 2] - centerZ,
		]
		for ( let segment = 1; segment < segmentCount; segment++ ) {
			const radial = rotateVectorAroundAxis( startRadial, info.normal, info.angle * segment / segmentCount )
			arc.push( emitVertex(
				pointIndex,
				centerX + radial[0], centerY + radial[1], centerZ + radial[2],
				outerSide, seamU, 1
			) )
		}
	}
	arc.push( emitVertex(
		pointIndex,
		positions[endOffset], positions[endOffset + 1], positions[endOffset + 2],
		outerSide, seamU, 1
	) )
	for ( let segment = 0; segment < arc.length - 1; segment++ ) {
		indices.push( pivot, arc[segment], arc[segment + 1] )
	}
}

function getRoundJoinSegmentCount( angle, halfTurnBudget ) {
	return Math.max( 1, Math.ceil( Math.abs( angle ) / Math.PI * halfTurnBudget ) )
}

function emitCap(
	isEnd, pointIndex, segment, path, frame, width, surface, cap,
	positions, indices, emitVertex, internal = false
) {
	if ( cap.type === 'butt' ) return
	const pair = isEnd ? segment.end : segment.start
	const directionSign = isEnd ? 1 : -1
	const direction = segment.direction
	const side = isEnd ? segment.endSide : segment.startSide
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
		const leftOffset = pair[0] * 3
		const rightOffset = pair[1] * 3
		const left = emitVertex(
			pointIndex,
			positions[leftOffset] + direction[0] * width * directionSign,
			positions[leftOffset + 1] + direction[1] * width * directionSign,
			positions[leftOffset + 2] + direction[2] * width * directionSign,
			-1, u, endpointProgress
		)
		const right = emitVertex(
			pointIndex,
			positions[rightOffset] + direction[0] * width * directionSign,
			positions[rightOffset + 1] + direction[1] * width * directionSign,
			positions[rightOffset + 2] + direction[2] * width * directionSign,
			1, u, endpointProgress
		)
		if ( isEnd ) indices.push( pair[0], left, pair[1], pair[1], left, right )
		else indices.push( left, pair[0], right, right, pair[0], pair[1] )
		return
	}

	const pivot = emitVertex( pointIndex, centerX, centerY, centerZ, 0, baseU, endpointProgress )
	const leftOffset = pair[0] * 3
	const startRadial = [
		positions[leftOffset] - centerX,
		positions[leftOffset + 1] - centerY,
		positions[leftOffset + 2] - centerZ,
	]
	const sweep = isEnd ? Math.PI : -Math.PI
	const arc = [pair[0]]
	const normal = [frame.normals[pointOffset], frame.normals[pointOffset + 1], frame.normals[pointOffset + 2]]
	for ( let capSegment = 1; capSegment < cap.segments; capSegment++ ) {
		const radial = rotateVectorAroundAxis( startRadial, normal, sweep * capSegment / cap.segments )
		const sideCoordinate = width > EPSILON ? dotVector( radial, side ) / width : 0
		const longitudinal = dotVector( radial, direction )
		const u = surface.uvMode === 'distance' ? baseU + longitudinal / surface.uvScale : baseU
		arc.push( emitVertex(
			pointIndex,
			centerX + radial[0], centerY + radial[1], centerZ + radial[2],
			sideCoordinate, u, endpointProgress
		) )
	}
	arc.push( pair[1] )
	for ( let capSegment = 0; capSegment < arc.length - 1; capSegment++ ) {
		indices.push( pivot, arc[capSegment], arc[capSegment + 1] )
	}
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

function computePathData( points, closed ) {
	const pointCount = points.length / 3
	const segmentCount = closed ? pointCount : pointCount - 1
	const segmentDirections = new Float64Array( segmentCount * 3 )
	const segmentLengths = new Float64Array( segmentCount )
	const distances = new Float64Array( pointCount )
	const progress = new Float64Array( pointCount )
	const tangents = new Float64Array( pointCount * 3 )
	const cusps = new Uint8Array( pointCount )

	let totalLength = 0
	let closingLength = 0
	for ( let i = 0; i < segmentCount; i++ ) {
		const next = i + 1 === pointCount ? 0 : i + 1
		const offset = i * 3
		const nextOffset = next * 3
		const dx = points[nextOffset] - points[offset]
		const dy = points[nextOffset + 1] - points[offset + 1]
		const dz = points[nextOffset + 2] - points[offset + 2]
		const length = Math.hypot( dx, dy, dz )

		if ( !Number.isFinite( length ) || length <= 0 ) {
			throw new Error( `[MeshLineSurfaceGeometry] Degenerate segment at index ${i}` )
		}

		segmentDirections[offset] = dx / length
		segmentDirections[offset + 1] = dy / length
		segmentDirections[offset + 2] = dz / length
		segmentLengths[i] = length

		if ( i < pointCount - 1 ) {
			totalLength += length
			distances[i + 1] = totalLength
		} else {
			closingLength = length
		}
	}

	if ( closed ) totalLength += closingLength
	if ( !Number.isFinite( totalLength ) || totalLength <= 0 ) {
		throw new Error( '[MeshLineSurfaceGeometry] Line length must be greater than zero' )
	}

	for ( let i = 0; i < pointCount; i++ ) {
		if ( !closed && i === 0 ) {
			tangents[0] = segmentDirections[0]
			tangents[1] = segmentDirections[1]
			tangents[2] = segmentDirections[2]
		} else if ( !closed && i === pointCount - 1 ) {
			const directionOffset = ( pointCount - 2 ) * 3
			tangents[i * 3] = segmentDirections[directionOffset]
			tangents[i * 3 + 1] = segmentDirections[directionOffset + 1]
			tangents[i * 3 + 2] = segmentDirections[directionOffset + 2]
		} else {
			const incomingIndex = ( i - 1 + segmentCount ) % segmentCount
			const outgoingIndex = i % segmentCount
			const incomingOffset = incomingIndex * 3
			const outgoingOffset = outgoingIndex * 3
			const sumX = segmentDirections[incomingOffset] + segmentDirections[outgoingOffset]
			const sumY = segmentDirections[incomingOffset + 1] + segmentDirections[outgoingOffset + 1]
			const sumZ = segmentDirections[incomingOffset + 2] + segmentDirections[outgoingOffset + 2]
			const sumLength = Math.hypot( sumX, sumY, sumZ )
			const tangentOffset = i * 3

			if ( sumLength <= EPSILON ) {
				// A zero-radius 180-degree reversal has no unique bisector. Keep a
				// deterministic outgoing tangent and force the bounded join fallback.
				tangents[tangentOffset] = segmentDirections[outgoingOffset]
				tangents[tangentOffset + 1] = segmentDirections[outgoingOffset + 1]
				tangents[tangentOffset + 2] = segmentDirections[outgoingOffset + 2]
				cusps[i] = 1
			} else {
				const inverseLength = 1 / sumLength
				tangents[tangentOffset] = sumX * inverseLength
				tangents[tangentOffset + 1] = sumY * inverseLength
				tangents[tangentOffset + 2] = sumZ * inverseLength
			}
		}

		progress[i] = distances[i] / totalLength
	}

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
		totalLength,
	}
}

function computeFrames( path, surface, lineIndex ) {
	const normals = new Float64Array( path.pointCount * 3 )
	const sides = new Float64Array( path.pointCount * 3 )
	const up = normalizeVector( readVectorLike( surface.up, 'surface.up' ) )
	const candidate = new Float64Array( 3 )

	for ( let i = 0; i < path.pointCount; i++ ) {
		const offset = i * 3
		const tangentX = path.tangents[offset]
		const tangentY = path.tangents[offset + 1]
		const tangentZ = path.tangents[offset + 2]

		if ( i === 0 ) {
			seedNormalScalar( candidate, tangentX, tangentY, tangentZ, up[0], up[1], up[2] )
		} else if ( surface.frame === 'fixed-up' ) {
			const previousNormalX = normals[offset - 3]
			const previousNormalY = normals[offset - 2]
			const previousNormalZ = normals[offset - 1]
			if ( !projectNormalScalar( candidate, tangentX, tangentY, tangentZ, up[0], up[1], up[2] ) ) {
				if ( !projectNormalScalar( candidate, tangentX, tangentY, tangentZ, previousNormalX, previousNormalY, previousNormalZ ) ) {
					seedNormalScalar( candidate, tangentX, tangentY, tangentZ, up[0], up[1], up[2] )
				}
			}
			if ( candidate[0] * previousNormalX + candidate[1] * previousNormalY + candidate[2] * previousNormalZ < 0 ) {
				candidate[0] = -candidate[0]
				candidate[1] = -candidate[1]
				candidate[2] = -candidate[2]
			}
		} else {
			transportNormalScalar(
				candidate,
				normals[offset - 3], normals[offset - 2], normals[offset - 1],
				path.tangents[offset - 3], path.tangents[offset - 2], path.tangents[offset - 1],
				tangentX, tangentY, tangentZ
			)
		}

		writeOrthonormalFrameScalar(
			normals, sides, offset,
			tangentX, tangentY, tangentZ,
			candidate[0], candidate[1], candidate[2]
		)
	}

	if ( path.closed && surface.frame === 'transport' ) {
		const lastOffset = ( path.pointCount - 1 ) * 3
		transportNormalScalar(
			candidate,
			normals[lastOffset], normals[lastOffset + 1], normals[lastOffset + 2],
			path.tangents[lastOffset], path.tangents[lastOffset + 1], path.tangents[lastOffset + 2],
			path.tangents[0], path.tangents[1], path.tangents[2]
		)
		const endNormals = new Float64Array( 3 )
		const endSides = new Float64Array( 3 )
		writeOrthonormalFrameScalar(
			endNormals, endSides, 0,
			path.tangents[0], path.tangents[1], path.tangents[2],
			candidate[0], candidate[1], candidate[2]
		)
		const crossX = endNormals[1] * normals[2] - endNormals[2] * normals[1]
		const crossY = endNormals[2] * normals[0] - endNormals[0] * normals[2]
		const crossZ = endNormals[0] * normals[1] - endNormals[1] * normals[0]
		const residual = Math.atan2(
			path.tangents[0] * crossX + path.tangents[1] * crossY + path.tangents[2] * crossZ,
			clamp( endNormals[0] * normals[0] + endNormals[1] * normals[1] + endNormals[2] * normals[2], -1, 1 )
		)

		for ( let i = 1; i < path.pointCount; i++ ) {
			const offset = i * 3
			rotateVectorAroundAxisScalar(
				candidate,
				normals[offset], normals[offset + 1], normals[offset + 2],
				path.tangents[offset], path.tangents[offset + 1], path.tangents[offset + 2],
				residual * path.progress[i]
			)
			writeOrthonormalFrameScalar(
				normals, sides, offset,
				path.tangents[offset], path.tangents[offset + 1], path.tangents[offset + 2],
				candidate[0], candidate[1], candidate[2]
			)
		}
	}

	const constantBank = typeof surface.bank === 'number' ? surface.bank : null
	if ( constantBank === null || Math.abs( constantBank ) > EPSILON ) {
		for ( let i = 0; i < path.pointCount; i++ ) {
			const offset = i * 3
			const angle = constantBank ?? resolveBank( surface.bank, path.progress[i], i, lineIndex )
			if ( Math.abs( angle ) <= EPSILON ) continue

			rotateVectorAroundAxisScalar(
				candidate,
				normals[offset], normals[offset + 1], normals[offset + 2],
				path.tangents[offset], path.tangents[offset + 1], path.tangents[offset + 2],
				angle
			)
			writeOrthonormalFrameScalar(
				normals, sides, offset,
				path.tangents[offset], path.tangents[offset + 1], path.tangents[offset + 2],
				candidate[0], candidate[1], candidate[2]
			)
		}
	}

	return { normals, sides }
}

function computeHalfWidths( progress, options, lineIndex ) {
	const baseWidth = options.lineWidth ?? 0.3
	if ( !options.widthCallback ) return baseWidth * 0.5

	const halfWidths = new Float64Array( progress.length )

	for ( let i = 0; i < progress.length; i++ ) {
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

function computeOffsets( path, frame, join ) {
	const offsets = new Float64Array( path.pointCount * 3 )
	const useMiter = join.type === 'miter'

	for ( let i = 0; i < path.pointCount; i++ ) {
		const offset = i * 3
		const fallbackX = frame.sides[offset]
		const fallbackY = frame.sides[offset + 1]
		const fallbackZ = frame.sides[offset + 2]
		let resultX = fallbackX
		let resultY = fallbackY
		let resultZ = fallbackZ
		const hasJoin = path.closed || ( i > 0 && i < path.pointCount - 1 )

		if ( useMiter && hasJoin && path.cusps[i] === 0 ) {
			const incomingIndex = ( i - 1 + path.segmentCount ) % path.segmentCount
			const outgoingIndex = i % path.segmentCount
			const incomingOffset = incomingIndex * 3
			const outgoingOffset = outgoingIndex * 3
			const normalX = frame.normals[offset]
			const normalY = frame.normals[offset + 1]
			const normalZ = frame.normals[offset + 2]
			const incomingDirectionX = path.segmentDirections[incomingOffset]
			const incomingDirectionY = path.segmentDirections[incomingOffset + 1]
			const incomingDirectionZ = path.segmentDirections[incomingOffset + 2]
			const outgoingDirectionX = path.segmentDirections[outgoingOffset]
			const outgoingDirectionY = path.segmentDirections[outgoingOffset + 1]
			const outgoingDirectionZ = path.segmentDirections[outgoingOffset + 2]
			let incomingSideX = normalY * incomingDirectionZ - normalZ * incomingDirectionY
			let incomingSideY = normalZ * incomingDirectionX - normalX * incomingDirectionZ
			let incomingSideZ = normalX * incomingDirectionY - normalY * incomingDirectionX
			let outgoingSideX = normalY * outgoingDirectionZ - normalZ * outgoingDirectionY
			let outgoingSideY = normalZ * outgoingDirectionX - normalX * outgoingDirectionZ
			let outgoingSideZ = normalX * outgoingDirectionY - normalY * outgoingDirectionX
			const incomingLength = Math.hypot( incomingSideX, incomingSideY, incomingSideZ )
			const outgoingLength = Math.hypot( outgoingSideX, outgoingSideY, outgoingSideZ )

			if ( incomingLength > EPSILON && outgoingLength > EPSILON ) {
				incomingSideX /= incomingLength
				incomingSideY /= incomingLength
				incomingSideZ /= incomingLength
				outgoingSideX /= outgoingLength
				outgoingSideY /= outgoingLength
				outgoingSideZ /= outgoingLength
				let miterX = incomingSideX + outgoingSideX
				let miterY = incomingSideY + outgoingSideY
				let miterZ = incomingSideZ + outgoingSideZ
				const miterLength = Math.hypot( miterX, miterY, miterZ )

				if ( miterLength > EPSILON ) {
					miterX /= miterLength
					miterY /= miterLength
					miterZ /= miterLength
					if ( miterX * fallbackX + miterY * fallbackY + miterZ * fallbackZ < 0 ) {
						miterX = -miterX
						miterY = -miterY
						miterZ = -miterZ
					}
					const denominator = Math.abs( miterX * outgoingSideX + miterY * outgoingSideY + miterZ * outgoingSideZ )
					const scale = denominator > EPSILON ? 1 / denominator : Infinity

					if ( Number.isFinite( scale ) && scale <= join.limit ) {
						resultX = miterX * scale
						resultY = miterY * scale
						resultZ = miterZ * scale
					}
				}
			}
		}

		offsets[offset] = resultX
		offsets[offset + 1] = resultY
		offsets[offset + 2] = resultZ
	}

	return offsets
}

function prepareLine( input, closed, lineIndex ) {
	const raw = toFloat64( input, lineIndex )
	if ( raw.length % 3 !== 0 ) {
		throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} must contain complete XYZ triples` )
	}
	if ( raw.length < 6 ) {
		throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} requires at least two points` )
	}

	const epsilon = getDuplicateEpsilon( raw )
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

	return { points, closed }
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
	const length = Math.hypot( normalX, normalY, normalZ )
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
	const sinAngle = Math.hypot( axisX, axisY, axisZ )

	if ( sinAngle <= EPSILON ) {
		target[0] = normalX
		target[1] = normalY
		target[2] = normalZ
		return
	}

	const inverseAxisLength = 1 / sinAngle
	const unitAxisX = axisX * inverseAxisLength
	const unitAxisY = axisY * inverseAxisLength
	const unitAxisZ = axisZ * inverseAxisLength
	const cosAngle = clamp(
		fromTangentX * toTangentX + fromTangentY * toTangentY + fromTangentZ * toTangentZ,
		-1, 1
	)
	const crossX = unitAxisY * normalZ - unitAxisZ * normalY
	const crossY = unitAxisZ * normalX - unitAxisX * normalZ
	const crossZ = unitAxisX * normalY - unitAxisY * normalX
	const dot = unitAxisX * normalX + unitAxisY * normalY + unitAxisZ * normalZ
	const inverseCosine = 1 - cosAngle
	// `axisRaw` already carries sin( angle ) and both tangents are normalized,
	// so using the dot/cross values directly avoids three transcendental calls
	// without changing Rodrigues' rotation.
	target[0] = normalX * cosAngle + crossX * sinAngle + unitAxisX * dot * inverseCosine
	target[1] = normalY * cosAngle + crossY * sinAngle + unitAxisY * dot * inverseCosine
	target[2] = normalZ * cosAngle + crossZ * sinAngle + unitAxisZ * dot * inverseCosine
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
	normals, sides, offset,
	tangentX, tangentY, tangentZ,
	normalHintX, normalHintY, normalHintZ
) {
	let projection = tangentX * normalHintX + tangentY * normalHintY + tangentZ * normalHintZ
	let normalX = normalHintX - tangentX * projection
	let normalY = normalHintY - tangentY * projection
	let normalZ = normalHintZ - tangentZ * projection
	let normalLength = Math.hypot( normalX, normalY, normalZ )

	if ( normalLength <= EPSILON ) {
		projection = tangentY
		normalX = -tangentX * projection
		normalY = 1 - tangentY * projection
		normalZ = -tangentZ * projection
		normalLength = Math.hypot( normalX, normalY, normalZ )

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
			normalLength = Math.hypot( normalX, normalY, normalZ )
		}
	}
	if ( !Number.isFinite( normalLength ) || normalLength <= EPSILON ) {
		throw new Error( '[MeshLineSurfaceGeometry] Cannot normalize a degenerate vector' )
	}
	const initialInverseNormalLength = 1 / normalLength
	normalX *= initialInverseNormalLength
	normalY *= initialInverseNormalLength
	normalZ *= initialInverseNormalLength

	let sideX = normalY * tangentZ - normalZ * tangentY
	let sideY = normalZ * tangentX - normalX * tangentZ
	let sideZ = normalX * tangentY - normalY * tangentX
	const sideLength = Math.hypot( sideX, sideY, sideZ )
	if ( !Number.isFinite( sideLength ) || sideLength <= EPSILON ) {
		throw new Error( '[MeshLineSurfaceGeometry] Cannot normalize a degenerate vector' )
	}
	const inverseSideLength = 1 / sideLength
	sideX *= inverseSideLength
	sideY *= inverseSideLength
	sideZ *= inverseSideLength

	normalX = tangentY * sideZ - tangentZ * sideY
	normalY = tangentZ * sideX - tangentX * sideZ
	normalZ = tangentX * sideY - tangentY * sideX
	normalLength = Math.hypot( normalX, normalY, normalZ )
	if ( !Number.isFinite( normalLength ) || normalLength <= EPSILON ) {
		throw new Error( '[MeshLineSurfaceGeometry] Cannot normalize a degenerate vector' )
	}
	const inverseNormalLength = 1 / normalLength
	normalX *= inverseNormalLength
	normalY *= inverseNormalLength
	normalZ *= inverseNormalLength

	normals[offset] = normalX
	normals[offset + 1] = normalY
	normals[offset + 2] = normalZ
	sides[offset] = sideX
	sides[offset + 1] = sideY
	sides[offset + 2] = sideZ
}

function writeOrientedTriangle( indices, indexOffset, positions, a, b, c, expectedNormalX, expectedNormalY, expectedNormalZ ) {
	const aOffset = a * 3
	const bOffset = b * 3
	const cOffset = c * 3
	const abX = positions[bOffset] - positions[aOffset]
	const abY = positions[bOffset + 1] - positions[aOffset + 1]
	const abZ = positions[bOffset + 2] - positions[aOffset + 2]
	const acX = positions[cOffset] - positions[aOffset]
	const acY = positions[cOffset + 1] - positions[aOffset + 1]
	const acZ = positions[cOffset + 2] - positions[aOffset + 2]
	const faceNormalX = abY * acZ - abZ * acY
	const faceNormalY = abZ * acX - abX * acZ
	const faceNormalZ = abX * acY - abY * acX
	const orientation = faceNormalX * expectedNormalX + faceNormalY * expectedNormalY + faceNormalZ * expectedNormalZ

	indices[indexOffset++] = a
	if ( orientation < 0 ) {
		indices[indexOffset++] = c
		indices[indexOffset++] = b
	} else {
		indices[indexOffset++] = b
		indices[indexOffset++] = c
	}

	return indexOffset
}

function writePair3( array, vertex, x, y, z ) {
	const offset = vertex * 3
	array[offset] = x
	array[offset + 1] = y
	array[offset + 2] = z
	array[offset + 3] = x
	array[offset + 4] = y
	array[offset + 5] = z
}

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

function toFloat64( input, lineIndex ) {
	if ( input instanceof BufferGeometry ) {
		const attribute = input.getAttribute( 'position' )
		if ( !attribute ) throw new Error( `[MeshLineSurfaceGeometry] Line ${lineIndex} BufferGeometry has no position attribute` )
		const result = new Float64Array( attribute.count * 3 )
		for ( let i = 0; i < attribute.count; i++ ) {
			result[i * 3] = attribute.getX( i )
			result[i * 3 + 1] = attribute.getY( i )
			result[i * 3 + 2] = attribute.getZ( i )
		}
		return validateFinitePoints( result, lineIndex )
	}

	if ( ArrayBuffer.isView( input ) || ( Array.isArray( input ) && typeof input[0] === 'number' ) ) {
		return validateFinitePoints( new Float64Array( input ), lineIndex )
	}

	if ( !Array.isArray( input ) ) {
		throw new Error( `[MeshLineSurfaceGeometry] Unsupported line input at index ${lineIndex}` )
	}

	const result = new Float64Array( input.length * 3 )
	for ( let i = 0; i < input.length; i++ ) {
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

		if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Invalid point ${i} in line ${lineIndex}` )
		}

		result[i * 3] = x
		result[i * 3 + 1] = y
		result[i * 3 + 2] = z
	}

	return result
}

function validateFinitePoints( points, lineIndex ) {
	for ( let i = 0; i < points.length; i++ ) {
		if ( !Number.isFinite( points[i] ) ) {
			throw new Error( `[MeshLineSurfaceGeometry] Non-finite coordinate ${i} in line ${lineIndex}` )
		}
	}
	return points
}

function compactConsecutivePoints( points, epsilon ) {
	let output = null
	let length = 3

	for ( let offset = 3; offset < points.length; offset += 3 ) {
		const source = output || points
		if ( pointsEqual( source, length - 3, points, offset, epsilon ) ) {
			if ( output === null ) {
				output = new Float64Array( points.length )
				output.set( points.subarray( 0, offset ) )
				length = offset
			}
			continue
		}
		if ( output ) {
			output[length] = points[offset]
			output[length + 1] = points[offset + 1]
			output[length + 2] = points[offset + 2]
		}
		length += 3
	}

	if ( output === null ) return points
	return length === output.length ? output : output.slice( 0, length )
}

function getDuplicateEpsilon( points ) {
	let maxMagnitude = 0
	for ( let i = 0; i < points.length; i++ ) {
		maxMagnitude = Math.max( maxMagnitude, Math.abs( points[i] ) )
	}

	// Track double-precision representability, not the overall path span. A
	// diagonal-relative epsilon can erase a legitimate short segment merely
	// because another segment is very long.
	return Math.max( DUPLICATE_EPSILON, maxMagnitude * Number.EPSILON * 4 )
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
	if (
		!Number.isFinite( left32X ) || !Number.isFinite( left32Y ) || !Number.isFinite( left32Z ) ||
		!Number.isFinite( right32X ) || !Number.isFinite( right32Y ) || !Number.isFinite( right32Z )
	) {
		throw new Error( `[MeshLineSurfaceGeometry] Position overflow at row ${row} of line ${lineIndex}` )
	}

	if ( halfWidth <= 0 ) return
	const requestedWidth = Math.hypot(
		rightX - leftX,
		rightY - leftY,
		rightZ - leftZ
	)
	const representedWidth = Math.hypot(
		right32X - left32X,
		right32Y - left32Y,
		right32Z - left32Z
	)
	const relativeError = requestedWidth > 0
		? Math.abs( representedWidth - requestedWidth ) / requestedWidth
		: Infinity

	if ( !Number.isFinite( representedWidth ) || relativeError > 0.125 ) {
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
		if ( Math.hypot( dx, dy, dz ) <= EPSILON ) {
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
	return Math.hypot( vector[0], vector[1], vector[2] )
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
