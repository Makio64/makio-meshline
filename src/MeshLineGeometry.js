import { BufferAttribute, BufferGeometry, Vector2, Vector3, Box3, Sphere, StreamDrawUsage, StaticDrawUsage } from 'three/webgpu'

export class MeshLineGeometry extends BufferGeometry {
	constructor() {
		super()
		this.type = 'MeshLine'
		this.isMeshLine = true
	}

	buildLine( options ) {

		this.options = {
			needsPositions: true,
			needsPrevious: true,
			needsNext: true,
			needsUV: false,
			needsSide: true,
			needsCounter: true,
			needsWidth: false,
			verbose: false,
			...options
		}

		this.widthCallback = options.widthCallback || null
		this.closeLoop = false
		this._points = null
		this._attrs = {}
		this._lineCount = 0
		this._lines = [] // Store individual line arrays for multi-line mode
		this._lineLoops = [] // Store loop flag for each line
		this.boundingBoxes = [] // Bounding box for each line
		if ( options.lines ) {
			this.setLines( options.lines )
		}
	}

	// set multiple lines from an array of points arrays
	setLines( lines ) {

		// If lines is not an array, convert it to an array
		if ( !Array.isArray( lines ) ) {
			lines = [lines]
		}

		// convert isClose to an array if needed
		const lineLoops = Array.isArray( this.options.isClose ) ? this.options.isClose : new Array( lines.length ).fill( this.options.isClose )
		const actualLoops = [] 

		// Convert each line to Float32Array and store separately
		const convertedLines = []

		for ( let i = 0; i < lines.length; i++ ) {
			const pts = lines[i]
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
			actualLoops.push( shouldLoop )
		}

		// Store the lines separately
		this._lines = convertedLines
		this._lineLoops = actualLoops
		this._lineCount = convertedLines.length
		this._points = new Float32Array() // Clear single line data
		this.closeLoop = false // Multi-lines handle their own loops individually

		this.build()
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
	setOrUpdateAttribute( name, array, itemSize, usage = StaticDrawUsage ) {
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
			attr.setUsage( usage )
			this._attrs[name] = attr
			this.setAttribute( name, attr )
		}
	}

	setUsage( usage, name = null ) {
		for ( const attr of Object.values( this._attrs ) ) {
			if ( name == null || attr.name === name ) {
				attr.setUsage( usage )
			}
		}
	}

	// build geometry for multiple lines from separate line arrays
	build() {
		const lines = this._lines
		const lineLoops = this._lineLoops
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
		let positions, previous, next, sides, widths, uvs, counters
		if ( this.options.needsPositions ) {
			positions = new Float32Array( totalVertices * 3 )
		}
		if ( this.options.needsPrevious ) {
			previous = new Float32Array( totalVertices * 3 )
		}
		if ( this.options.needsNext ) {
			next = new Float32Array( totalVertices * 3 )
		}
		if ( this.options.needsSide ) {
			sides = new Float32Array( totalVertices )
		}
		if ( this.options.needsWidth ) {
			widths = new Float32Array( totalVertices )
		}
		if ( this.options.needsUV ) {
			uvs = new Float32Array( totalVertices * 2 )
		}
		if ( this.options.needsCounter ) {
			counters = new Float32Array( totalVertices )
		}

		// Use 32-bit indices if we exceed the 16-bit limit (65 535)
		// This prevents index overflow that can lead to wrongly connected segments
		// when drawing very large or detailed geometries.
		const IndicesArray = ( totalVertices > 65535 ) ? Uint32Array : Uint16Array
		const indices = new IndicesArray( totalIndices )

		let vertexOffset = 0
		let indexOffset = 0
		let vertexIndex = 0

		// Process each line separately
		for ( let lineIdx = 0; lineIdx < lines.length; lineIdx++ ) {
			const line = lines[lineIdx]
			const isLooped = lineLoops[lineIdx]
			const numPoints = line.length / 3
			if ( numPoints < 2 ) continue

			const tStep = numPoints > 1 ? 1 / ( numPoints - 1 ) : 0

			// Build this line's vertices
			for ( let i = 0; i < numPoints; i++ ) {
				const [x, y, z] = this.getPoint( line, i )
				const t = tStep * i

				// positions (2 vertices per point)
				if ( positions ) {
					positions[vertexOffset * 3] = x
					positions[vertexOffset * 3 + 1] = y
					positions[vertexOffset * 3 + 2] = z
					positions[vertexOffset * 3 + 3] = x
					positions[vertexOffset * 3 + 4] = y
					positions[vertexOffset * 3 + 5] = z
				}

				// sides - which side of the line is the vertex on
				if ( sides ) {
					sides[vertexOffset] = 1
					sides[vertexOffset + 1] = -1
				}

				// widths
				if ( widths ) {
					const w = this.widthCallback ? this.widthCallback( t ) : 1
					widths[vertexOffset] = w
					widths[vertexOffset + 1] = w
				}

				// uvs
				if ( uvs ) {
					uvs[vertexOffset * 2] = t
					uvs[vertexOffset * 2 + 1] = 0
					uvs[vertexOffset * 2 + 2] = t
					uvs[vertexOffset * 2 + 3] = 1
				}

				// counters 
				if ( counters ) {
					counters[vertexOffset] = t
					counters[vertexOffset + 1] = t
				}

				// previous
				let prevX, prevY, prevZ
				if ( i === 0 ) {
					// First point
					if ( isLooped ) {
						// Use second-to-last point (before the duplicate closing point)
						const [px, py, pz] = this.getPoint( line, numPoints - 2 )
						prevX = px
						prevY = py
						prevZ = pz
					} else {
						// Extrapolate backwards
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
					}
				} else {
					const [px, py, pz] = this.getPoint( line, i - 1 )
					prevX = px
					prevY = py
					prevZ = pz
				}

				if ( previous ) {
					previous[vertexOffset * 3] = prevX
					previous[vertexOffset * 3 + 1] = prevY
					previous[vertexOffset * 3 + 2] = prevZ
					previous[vertexOffset * 3 + 3] = prevX
					previous[vertexOffset * 3 + 4] = prevY
					previous[vertexOffset * 3 + 5] = prevZ
				}

				// next
				if ( next ) {
					let nextX, nextY, nextZ
					if ( i === numPoints - 1 ) {
						// Last point
						if ( isLooped ) {
							// Use second point (the first real point after the closing duplicate)
							const [nx, ny, nz] = this.getPoint( line, 1 )
							nextX = nx
							nextY = ny
							nextZ = nz
						} else {
							// Extrapolate forwards
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
				}
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
		if ( positions ) {
			this.setOrUpdateAttribute( 'position', positions, 3, this.options.usage || this.options.gpuPositionNode ? StaticDrawUsage : StreamDrawUsage )
		}
		if ( previous ) {
			this.setOrUpdateAttribute( 'previous', previous, 3, this.options.usage || this.options.gpuPositionNode ? StaticDrawUsage : StreamDrawUsage )
		}
		if ( next ) {
			this.setOrUpdateAttribute( 'next', next, 3, this.options.usage || this.options.gpuPositionNode ? StaticDrawUsage : StreamDrawUsage )
		}
		if ( sides ) {
			this.setOrUpdateAttribute( 'side', sides, 1 )
		}
		if ( widths ) {
			this.setOrUpdateAttribute( 'width', widths, 1 )
		}
		if ( uvs ) {
			this.setOrUpdateAttribute( 'uv', uvs, 2 )
		}
		if ( counters ) {
			this.setOrUpdateAttribute( 'counters', counters, 1 )
		}

		// Set indices
		const indexAttr = new BufferAttribute( indices, 1 )
		const oldIndex = this.getIndex()
		if ( oldIndex && oldIndex.count === indexAttr.count ) {
			oldIndex.copyArray( indices )
			oldIndex.needsUpdate = true
		} else {
			this.setIndex( indexAttr )
		}

		this.computeBoundingBoxes()
		this.computeBoundingSphere()
		this.computeBoundingBox()

		// Verbose logging
		if ( this.options.verbose ) {
			const attrs = Object.keys( this._attrs )
			console.log( `[MeshLine] geometry built with attributes: ${attrs.join( ', ' )}` )
		}
	}

	computeBoundingBoxes() {
		if ( !this._lines || this._lines.length === 0 ) return
		this.boundingBoxes = this._lines.map( ( line, idx ) =>
			( this.boundingBoxes[idx] || new Box3() ).setFromArray( line )
		)
	}
	
	computeBoundingBox() {
		if ( !this.boundingBoxes || this.boundingBoxes.length === 0 ) return
		if ( !this.boundingBox ) this.boundingBox = new Box3()
		if ( !this.boundingBoxes.length ) {
			this.boundingBox?.makeEmpty()
			return
		}
		this.boundingBox.copy( this.boundingBoxes[0] )
		for ( const box of this.boundingBoxes.slice( 1 ) ) {
			this.boundingBox.union( box )
		}
	}

	computeBoundingSphere() {
		if ( !this.boundingBox ) this.computeBoundingBox()
		if ( !this.boundingSphere ) this.boundingSphere = new Sphere()
		this.boundingBox?.getBoundingSphere( this.boundingSphere )
	}

	// release GPU resources and attributes
	dispose() {
		this._attrs = {}
		super.dispose()
	}

	// Update the positions of an existing line without rebuilding attributes
	// Update the positions of existing lines without rebuilding attributes
	setPositions( pts, updateBounding = false ) {
		if ( !pts ) return

		// Handle single line input for backward compatibility
		if ( !Array.isArray( pts ) || ( pts.length > 0 && typeof pts[0] === 'number' ) || pts instanceof Float32Array ) {
			pts = [pts]
		}

		// Convert all inputs to Float32Array
		const newLines = pts.map( line => toFloat32( line ) )

		// Validate we have the same number of lines
		if ( newLines.length !== this._lines.length ) {
			// Fallback to full rebuild if line count changes
			this.setLines( newLines )
			return
		}

		// Validate each line has the same number of points
		for ( let i = 0; i < newLines.length; i++ ) {
			if ( newLines[i].length !== this._lines[i].length ) {
			// Fallback to full rebuild if any line changes size
				this.setLines( newLines )
				return
			}
		}

		// Get attributes
		const positionAttr = this.getAttribute( 'position' )

		if ( !positionAttr ) {
			this.setLines( newLines )
			return
		}
		const previousAttr = this.getAttribute( 'previous' )
		const nextAttr = this.getAttribute( 'next' )

		const positionsArray = positionAttr.array
		const prevArray = previousAttr ? previousAttr.array : null
		const nextArray = nextAttr ? nextAttr.array : null

		// Process each line
		let globalVertexIndex = 0

		for ( let lineIdx = 0; lineIdx < newLines.length; lineIdx++ ) {
			const line = newLines[lineIdx]
			const isLooped = this._lineLoops[lineIdx]
			const numPoints = line.length / 3

			for ( let i = 0; i < numPoints; i++ ) {
				const o = i * 3
				const x = line[o]
				const y = line[o + 1]
				const z = line[o + 2]

				this.writePair( positionsArray, globalVertexIndex, x, y, z )

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
						// Extrapolate backwards
							if ( numPoints > 1 ) {
								const x1 = line[3], y1 = line[4], z1 = line[5]
								const refl = this.reflect( [x, y, z], [x1, y1, z1] )
								px = refl[0]; py = refl[1]; pz = refl[2]
							} else {
								px = x; py = y; pz = z
							}
						}
					} else {
						px = line[o - 3]
						py = line[o - 2]
						pz = line[o - 1]
					}
					this.writePair( prevArray, globalVertexIndex, px, py, pz )
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
						// Extrapolate forwards
							if ( numPoints > 1 ) {
								const x1 = line[o - 3], y1 = line[o - 2], z1 = line[o - 1]
								const refl = this.reflect( [x, y, z], [x1, y1, z1] )
								nx = refl[0]; ny = refl[1]; nz = refl[2]
							} else {
								nx = x; ny = y; nz = z
							}
						}
					} else {
						nx = line[o + 3]
						ny = line[o + 4]
						nz = line[o + 5]
					}
					this.writePair( nextArray, globalVertexIndex, nx, ny, nz )
				}

				// IMPORTANT: Increment by 2 because each point creates 2 vertices
				globalVertexIndex += 2
			}
		}

		// Mark attributes as needing update
		positionAttr.needsUpdate = true
		if ( previousAttr ) previousAttr.needsUpdate = true
		if ( nextAttr ) nextAttr.needsUpdate = true

		// Update cached lines
		this._lines = newLines

		// Update bounding volumes if requested
		if ( updateBounding ) {
			this.computeBoundingBoxes()
			this.computeBoundingBox()
			this.computeBoundingSphere()
		}
	}

	writePair = ( arr, vertIdx, x, y, z ) => {
		const offset = vertIdx * 3
		arr[offset] = x
		arr[offset + 1] = y
		arr[offset + 2] = z
		arr[offset + 3] = x
		arr[offset + 4] = y
		arr[offset + 5] = z
	}

}

//------------------------------------------------------ HELPERS
// normalize various point inputs into a Float32Array
const toFloat32 = pts => {
	if ( pts instanceof Float32Array ) {
		return pts
	}

	console.warn( `[MeshLine] Use Float32Array for positions to avoid array conversion & get optimal performance` )

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
		} else {
		// Invalid points are skipped but warning for the user
			console.warn( `[MeshLine] Invalid point: ${p}` )
		}
	}

	// If we skipped some points, return a correctly sized array
	return offset === result.length ? result : result.slice( 0, offset )
}