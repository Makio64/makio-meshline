import { BufferAttribute, BufferGeometry, Matrix4, Vector2, Vector3 } from 'three'

export class MeshLineGeometry extends BufferGeometry {
	constructor( pts, widthCb, loop ) {
		super()
		this.type = 'MeshLine'
		this.isMeshLine = true

		this.widthCallback = t => 1
		this.closeLoop = false
		this._points = null
		this._attrs = {}
		this._isMultiLine = false
		this._lineCount = 0
		this._lines = [] // Store individual line arrays for multi-line mode
		if ( pts ) {
			this.setPoints( pts, widthCb, loop )
		}
	}

	// set new points, optional width callback and loop flag
	setPoints( pts, widthCb = this.widthCallback, loop = false ) {
		let arr = toFloat32( pts )
		this.closeLoop = loop && arr.length >= 3
		if ( this.closeLoop ) {
			const newArr = new Float32Array( arr.length + 3 )
			newArr.set( arr )
			newArr[arr.length] = arr[0]     // x
			newArr[arr.length + 1] = arr[1] // y
			newArr[arr.length + 2] = arr[2] // z
			arr = newArr
		}
		this._points = arr
		this._isMultiLine = false
		this._lineCount = arr.length > 0 ? 1 : 0
		this._lines = [] // Clear multi-line data
		this.widthCallback = widthCb
		this.build()
	}

	// set multiple lines from an array of point arrays
	setLines( linesArray, widthCb = this.widthCallback, loops = false ) {
		if ( !Array.isArray( linesArray ) || linesArray.length === 0 ) {
			this.setPoints( [], widthCb, false )
			return
		}

		// Convert each line to Float32Array and store separately
		const convertedLines = []
		const lineLoops = Array.isArray( loops ) ? loops : new Array( linesArray.length ).fill( loops )

		for ( let i = 0; i < linesArray.length; i++ ) {
			const pts = linesArray[i]
			if ( !pts || pts.length === 0 ) continue

			let arr = toFloat32( pts )
			const shouldLoop = lineLoops[i] && arr.length >= 9 // Need at least 3 points (9 values) for a loop

			if ( shouldLoop ) {
				const newArr = new Float32Array( arr.length + 3 )
				newArr.set( arr )
				newArr[arr.length] = arr[0]     // x
				newArr[arr.length + 1] = arr[1] // y
				newArr[arr.length + 2] = arr[2] // z
				arr = newArr
			}

			convertedLines.push( arr )
		}

		if ( convertedLines.length === 0 ) {
			this.setPoints( [], widthCb, false )
			return
		}

		// Store the lines separately
		this._lines = convertedLines
		this._isMultiLine = true
		this._lineCount = convertedLines.length
		this._points = new Float32Array() // Clear single line data
		this.widthCallback = widthCb
		this.closeLoop = false // Multi-lines handle their own loops individually
		this.buildMultiLine()
	}

	// get xyz triplet from flat array at index i
	getPoint( pts, i ) {
		const o = i * 3
		return [pts[o], pts[o + 1], pts[o + 2]]
	}

	// compute reflection of point a over b: 2a - b
	reflect( a, b ) {
		return [
			2 * a[0] - b[0],
			2 * a[1] - b[1],
			2 * a[2] - b[2]
		]
	}

	// Build initial "previous" points for first segment
	buildInitialPrevious( pts, numPoints ) {
		if ( this.closeLoop ) {
			// Use second-to-last point (before the duplicate closing point)
			const [x, y, z] = this.getPoint( pts, numPoints - 2 )
			return new Float32Array( [x, y, z, x, y, z] )
		} else {
			// Extrapolate backwards from first two points
			const firstPoint = this.getPoint( pts, 0 )
			const secondPoint = this.getPoint( pts, 1 )
			const [x, y, z] = this.reflect( firstPoint, secondPoint )
			return new Float32Array( [x, y, z, x, y, z] )
		}
	}

	// Build final "next" points for last segment
	buildFinalNext( pts, numPoints ) {
		if ( this.closeLoop ) {
			// Use second point (the first real point after the closing duplicate)
			const [x, y, z] = this.getPoint( pts, 1 )
			return new Float32Array( [x, y, z, x, y, z] )
		} else {
			// Extrapolate forwards from last two points
			const lastPoint = this.getPoint( pts, numPoints - 1 )
			const secondLastPoint = this.getPoint( pts, numPoints - 2 )
			const [x, y, z] = this.reflect( lastPoint, secondLastPoint )
			return new Float32Array( [x, y, z, x, y, z] )
		}
	}

	// Helper to set or update buffer attribute efficiently
	setOrUpdateAttribute( name, array, itemSize ) {
		const existing = this._attrs[name]

		// Check if we can reuse existing attribute (same total size)
		if ( existing && existing.array.length === array.length ) {
			existing.copyArray( array )
			existing.needsUpdate = true
		} else {
			// Create new attribute
			if ( existing ) {
				this.deleteAttribute( name )
			}
			const attr = new BufferAttribute( array, itemSize )
			this._attrs[name] = attr
			this.setAttribute( name, attr )
		}
	}

	// build/update all geometry attributes and index
	build() {
		const pts = this._points
		const numPoints = pts.length / 3
		const tStep = numPoints > 1 ? 1 / ( numPoints - 1 ) : 0

		// Initialize Float32Arrays
		const positions = new Float32Array( numPoints * 3 * 2 )
		const previous = new Float32Array( ( numPoints + 1 ) * 3 * 2 ) // +1 for initPrev/appendNext
		const next = new Float32Array(  ( numPoints + 1 ) * 3 * 2 ) // +1 for initPrev/appendNext
		const sides = new Float32Array( numPoints * 2 )
		const widths = new Float32Array( numPoints * 2 )
		const uvs = new Float32Array( numPoints * 2 * 2 )
		const counters = new Float32Array( numPoints * 2 )
		const indices = new Uint16Array( ( numPoints - 1 ) * 6 )

		let posIdx = 0
		let prevIdx = 0
		let nextIdx = 0
		let sideIdx = 0
		let widthIdx = 0
		let uvIdx = 0
		let counterIdx = 0
		let indicesIdx = 0

		// Set initial previous positions
		const initPrevArr = this.buildInitialPrevious( pts, numPoints )
		previous.set( initPrevArr, prevIdx )
		prevIdx += initPrevArr.length

		for ( let i = 0; i < numPoints; i++ ) {
			const [x, y, z] = this.getPoint( pts, i )
			const t = tStep * i

			// positions
			positions[posIdx++] = x
			positions[posIdx++] = y
			positions[posIdx++] = z
			positions[posIdx++] = x
			positions[posIdx++] = y
			positions[posIdx++] = z

			// counters
			counters[counterIdx++] = t
			counters[counterIdx++] = t

			// sides
			sides[sideIdx++] = 1
			sides[sideIdx++] = -1

			// widths
			const w = this.widthCallback( t )
			widths[widthIdx++] = w
			widths[widthIdx++] = w

			// uvs
			uvs[uvIdx++] = t
			uvs[uvIdx++] = 0
			uvs[uvIdx++] = t
			uvs[uvIdx++] = 1

			if ( i < numPoints - 1 ) {
				// previous (for all but the first point)
				previous[prevIdx++] = x
				previous[prevIdx++] = y
				previous[prevIdx++] = z
				previous[prevIdx++] = x
				previous[prevIdx++] = y
				previous[prevIdx++] = z

				// indices
				const o = i * 2
				indices[indicesIdx++] = o
				indices[indicesIdx++] = o + 1
				indices[indicesIdx++] = o + 2
				indices[indicesIdx++] = o + 2
				indices[indicesIdx++] = o + 1
				indices[indicesIdx++] = o + 3
			}

			if ( i > 0 ) {
				// next (for all but the last point)
				next[nextIdx++] = x
				next[nextIdx++] = y
				next[nextIdx++] = z
				next[nextIdx++] = x
				next[nextIdx++] = y
				next[nextIdx++] = z
			}
		}

		// Set final next positions
		const appendNextArr = this.buildFinalNext( pts, numPoints )
		next.set( appendNextArr, nextIdx )

		this.setOrUpdateAttribute( 'position', positions, 3 )
		this.setOrUpdateAttribute( 'previous', previous, 3 )
		this.setOrUpdateAttribute( 'next', next, 3 )
		this.setOrUpdateAttribute( 'side', sides, 1 )
		this.setOrUpdateAttribute( 'width', widths, 1 )
		this.setOrUpdateAttribute( 'uv', uvs, 2 )
		this.setOrUpdateAttribute( 'counters', counters, 1 )

		const indexAttr = new BufferAttribute( indices, 1 )
		const oldIndex = this.getIndex()
		if ( oldIndex && oldIndex.count === indexAttr.count ) {
			oldIndex.copyArray( indices )
			oldIndex.needsUpdate = true
		} else {
			this.setIndex( indexAttr )
		}

		this.computeBoundingSphere()
		this.computeBoundingBox()
	}

	// build geometry for multiple lines from separate line arrays
	buildMultiLine() {
		const lines = this._lines
		if ( !lines || lines.length === 0 ) return

		// Calculate total vertices and indices needed
		let totalVertices = 0
		let totalIndices = 0

		for ( const line of lines ) {
			const numPoints = line.length / 3
			if ( numPoints >= 2 ) {
				totalVertices += numPoints * 2
				totalIndices += ( numPoints - 1 ) * 6
			}
		}

		if ( totalVertices === 0 ) return

		// Initialize arrays
		const positions = new Float32Array( totalVertices * 3 )
		const previous = new Float32Array( totalVertices * 3 )
		const next = new Float32Array( totalVertices * 3 )
		const sides = new Float32Array( totalVertices )
		const widths = new Float32Array( totalVertices )
		const uvs = new Float32Array( totalVertices * 2 )
		const counters = new Float32Array( totalVertices )
		const indices = new Uint16Array( totalIndices )

		let vertexOffset = 0
		let indexOffset = 0
		let vertexIndex = 0

		// Process each line separately
		for ( const line of lines ) {
			const numPoints = line.length / 3
			if ( numPoints < 2 ) continue

			const tStep = numPoints > 1 ? 1 / ( numPoints - 1 ) : 0

			// Build this line's vertices
			for ( let i = 0; i < numPoints; i++ ) {
				const [x, y, z] = this.getPoint( line, i )
				const t = tStep * i

				// positions (2 vertices per point)
				positions[vertexOffset * 3] = x
				positions[vertexOffset * 3 + 1] = y
				positions[vertexOffset * 3 + 2] = z
				positions[vertexOffset * 3 + 3] = x
				positions[vertexOffset * 3 + 4] = y
				positions[vertexOffset * 3 + 5] = z

				// sides
				sides[vertexOffset] = 1
				sides[vertexOffset + 1] = -1

				// widths
				const w = this.widthCallback( t )
				widths[vertexOffset] = w
				widths[vertexOffset + 1] = w

				// uvs
				uvs[vertexOffset * 2] = t
				uvs[vertexOffset * 2 + 1] = 0
				uvs[vertexOffset * 2 + 2] = t
				uvs[vertexOffset * 2 + 3] = 1

				// counters
				counters[vertexOffset] = t
				counters[vertexOffset + 1] = t

				// previous
				let prevX, prevY, prevZ
				if ( i === 0 ) {
					// First point: extrapolate backwards or use second point
					if ( numPoints > 1 ) {
						const [x1, y1, z1] = this.getPoint( line, 1 )
						const reflected = this.reflect( [x, y, z], [x1, y1, z1] )
						prevX = reflected[0]
						prevY = reflected[1]
						prevZ = reflected[2]
					} else {
						prevX = x
						prevY = y
						prevZ = z
					}
				} else {
					const [px, py, pz] = this.getPoint( line, i - 1 )
					prevX = px
					prevY = py
					prevZ = pz
				}

				previous[vertexOffset * 3] = prevX
				previous[vertexOffset * 3 + 1] = prevY
				previous[vertexOffset * 3 + 2] = prevZ
				previous[vertexOffset * 3 + 3] = prevX
				previous[vertexOffset * 3 + 4] = prevY
				previous[vertexOffset * 3 + 5] = prevZ

				// next
				let nextX, nextY, nextZ
				if ( i === numPoints - 1 ) {
					// Last point: extrapolate forwards or use second-to-last point
					if ( numPoints > 1 ) {
						const [x1, y1, z1] = this.getPoint( line, numPoints - 2 )
						const reflected = this.reflect( [x, y, z], [x1, y1, z1] )
						nextX = reflected[0]
						nextY = reflected[1]
						nextZ = reflected[2]
					} else {
						nextX = x
						nextY = y
						nextZ = z
					}
				} else {
					const [nx, ny, nz] = this.getPoint( line, i + 1 )
					nextX = nx
					nextY = ny
					nextZ = nz
				}

				next[vertexOffset * 3] = nextX
				next[vertexOffset * 3 + 1] = nextY
				next[vertexOffset * 3 + 2] = nextZ
				next[vertexOffset * 3 + 3] = nextX
				next[vertexOffset * 3 + 4] = nextY
				next[vertexOffset * 3 + 5] = nextZ

				vertexOffset += 2
			}

			// Build indices for this line
			for ( let i = 0; i < numPoints - 1; i++ ) {
				const o = vertexIndex + i * 2
				indices[indexOffset++] = o
				indices[indexOffset++] = o + 1
				indices[indexOffset++] = o + 2
				indices[indexOffset++] = o + 2
				indices[indexOffset++] = o + 1
				indices[indexOffset++] = o + 3
			}

			vertexIndex += numPoints * 2
		}

		// Set attributes
		this.setOrUpdateAttribute( 'position', positions, 3 )
		this.setOrUpdateAttribute( 'previous', previous, 3 )
		this.setOrUpdateAttribute( 'next', next, 3 )
		this.setOrUpdateAttribute( 'side', sides, 1 )
		this.setOrUpdateAttribute( 'width', widths, 1 )
		this.setOrUpdateAttribute( 'uv', uvs, 2 )
		this.setOrUpdateAttribute( 'counters', counters, 1 )

		// Set indices
		const indexAttr = new BufferAttribute( indices, 1 )
		const oldIndex = this.getIndex()
		if ( oldIndex && oldIndex.count === indexAttr.count ) {
			oldIndex.copyArray( indices )
			oldIndex.needsUpdate = true
		} else {
			this.setIndex( indexAttr )
		}

		this.computeBoundingSphere()
		this.computeBoundingBox()
	}

	// release GPU resources and attributes
	dispose() {
		this._attrs = {}
		super.dispose()
	}

	// getters / setters at bottom
	get points() { return this._points }
	set points( v ) { this.setPoints( v ) }
}

//------------------------------------------------------ HELPERS
// normalize various point inputs into a Float32Array
const toFloat32 = pts => {
	if ( pts instanceof Float32Array ) {
		return pts
	}

	if ( pts instanceof BufferGeometry ) {
		return pts.getAttribute( 'position' ).array
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
		}
		// Invalid points are skipped
	}

	// If we skipped some points, return a correctly sized array
	return offset === result.length ? result : result.slice( 0, offset )
}
