import { Box3, BufferAttribute, BufferGeometry, Sphere, StaticDrawUsage, StreamDrawUsage, Vector2, Vector3 } from 'three/webgpu'

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

		this.options = {
			needsPositions: true,
			needsPrevious: true,
			needsNext: true,
			needsUV: false,
			needsSide: true,
			needsProgress: true,
			needsWidth: false,
			needsVertexColor: false,
			verbose: false,
			...options
		}

		this.widthCallback = this.options.widthCallback || null
		this._attrs = {}
		this._lineCount = 0
		this._lines = [] // Store individual line arrays for multi-line mode
		this._lineLoops = [] // Store loop flag for each line
		this.boundingBoxes = [] // Bounding box for each line
		if ( this.options.lines ) {
			this.setLines( this.options.lines )
		}
	}

	/**
	 * Set one or more polylines and rebuild all geometry buffers.
	 * @param {import('./index.d.ts').MultiLinePoints} lines
	 */
	setLines( lines ) {

		if ( !lines ) throw new Error( '[MeshLine] Lines data required' )

		// If lines is not an array, convert it to an array
		if ( !Array.isArray( lines ) ) {
			lines = [lines]
		}

		// Handle `closed` as boolean or array
		// If it's a single boolean, we use it for all lines
		// If it's an array, we use it per-line
		const isSingleLoop = typeof this.options.closed === 'boolean'
		const lineLoops = this.options.closed
		const actualLoops = isSingleLoop ? null : []

		// Convert each line to Float32Array and store separately
		const convertedLines = []

		// Skip CPU-side corner subdivision when GPU positions drive the line:
		// the CPU array is a straight-line template whose point count controls
		// the vertex/progress grid, and a `closed: true` straight line reads as
		// a hairpin at both endpoints to the subdivision pass. Subdividing would
		// shift the progress mapping that the GPU node samples against.
		const smooth = this.options.smoothSharpBends !== false && !this.options.gpuPositionNode
		const dotThreshold = this.options.smoothSharpBendsThreshold ?? -0.5
		const alpha = this.options.smoothSharpBendsAlpha ?? 0.001

		for ( let i = 0; i < lines.length; i++ ) {
			const pts = lines[i]
			if ( !pts || pts.length === 0 ) continue

			let arr = toFloat32( pts )
			// Get loop value either from single boolean or from array
			const loopValue = isSingleLoop ? lineLoops : ( lineLoops?.[i] ?? false )
			const shouldLoop = loopValue && arr.length >= 9 // Need at least 3 points (9 values) for a loop

			if ( smooth ) {
				arr = subdivideSharpBends( arr, shouldLoop, dotThreshold, alpha )
			}

			if ( shouldLoop ) {
				const newArr = new Float32Array( arr.length + 3 )
				newArr.set( arr )
				newArr[arr.length] = arr[0]     // x
				newArr[arr.length + 1] = arr[1] // y
				newArr[arr.length + 2] = arr[2] // z
				arr = newArr
			}

			convertedLines.push( arr )
			if ( !isSingleLoop ) {
				actualLoops.push( shouldLoop )
			}
		}

		// Store the lines separately
		this._lines = convertedLines
		// Store loops as single boolean or array
		this._lineLoops = isSingleLoop ? lineLoops : actualLoops
		this._isSingleLoopValue = isSingleLoop
		this._lineCount = convertedLines.length

		this.build()
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
		for ( const [attrName, attr] of Object.entries( this._attrs ) ) {
			if ( name == null || attrName === name ) {
				attr.setUsage( usage )
			}
		}
	}

	// build geometry for multiple lines from separate line arrays
	build() {
		const lines = this._lines
		const lineLoops = this._lineLoops
		if ( !lines || lines.length === 0 ) return
		this._maxWidthMultiplier = 1

		const usage = this.options.usage ?? ( this.options.gpuPositionNode ? StaticDrawUsage : StreamDrawUsage )

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
		let positions, previous, next, sides, widths, uvs, progress, colors
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
		if ( this.options.needsProgress ) {
			progress = new Float32Array( totalVertices )
		}
		if ( this.options.needsVertexColor && this.options.vertexColors ) {
			colors = new Float32Array( totalVertices * 3 )
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
			const isLooped = this._isSingleLoopValue ? lineLoops : lineLoops[lineIdx]
			const numPoints = line.length / 3
			if ( numPoints < 2 ) continue

			const tStep = numPoints > 1 ? 1 / ( numPoints - 1 ) : 0

			// Build this line's vertices
			for ( let i = 0; i < numPoints; i++ ) {
				const o = i * 3
				const x = line[o]
				const y = line[o + 1]
				const z = line[o + 2]
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
					this._maxWidthMultiplier = Math.max( this._maxWidthMultiplier, Math.abs( w ) )
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

				// progress
				if ( progress ) {
					progress[vertexOffset] = t
					progress[vertexOffset + 1] = t
				}

				// colors - expects Float32Array or flat array of RGB values
				if ( colors && this.options.vertexColors ) {
					const vc = this.options.vertexColors
					if ( vc instanceof Float32Array || ( Array.isArray( vc ) && typeof vc[0] === 'number' ) ) {
						if ( vc.length > i * 3 ) {
							const o = i * 3, vo = vertexOffset * 3
							colors[vo] = colors[vo + 3] = vc[o]
							colors[vo + 1] = colors[vo + 4] = vc[o + 1]
							colors[vo + 2] = colors[vo + 5] = vc[o + 2]
						}
					}
				}

				// previous
				let prevX, prevY, prevZ
				if ( i === 0 ) {
					// First point
					if ( isLooped ) {
						// Use second-to-last point (before the duplicate closing point)
						const po = ( numPoints - 2 ) * 3
						prevX = line[po]
						prevY = line[po + 1]
						prevZ = line[po + 2]
					} else {
						// Extrapolate backwards
						if ( numPoints > 1 ) {
							const x1 = line[3], y1 = line[4], z1 = line[5]
							prevX = 2 * x - x1
							prevY = 2 * y - y1
							prevZ = 2 * z - z1
						} else {
							prevX = x
							prevY = y
							prevZ = z
						}
					}
				} else {
					const po = ( i - 1 ) * 3
					prevX = line[po]
					prevY = line[po + 1]
					prevZ = line[po + 2]
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
							nextX = line[3]
							nextY = line[4]
							nextZ = line[5]
						} else {
							// Extrapolate forwards
							if ( numPoints > 1 ) {
								const po = ( numPoints - 2 ) * 3
								const x1 = line[po], y1 = line[po + 1], z1 = line[po + 2]
								nextX = 2 * x - x1
								nextY = 2 * y - y1
								nextZ = 2 * z - z1
							} else {
								nextX = x
								nextY = y
								nextZ = z
							}
						}
					} else {
						const po = ( i + 1 ) * 3
						nextX = line[po]
						nextY = line[po + 1]
						nextZ = line[po + 2]
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
			this.setOrUpdateAttribute( 'position', positions, 3, usage )
		}
		if ( previous ) {
			this.setOrUpdateAttribute( 'previous', previous, 3, usage )
		}
		if ( next ) {
			this.setOrUpdateAttribute( 'next', next, 3, usage )
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
		if ( progress ) {
			this.setOrUpdateAttribute( 'progress', progress, 1 )
		}
		if ( colors ) {
			this.setOrUpdateAttribute( 'vertexColor', colors, 3 )
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

		if ( this.options.frustumCulled !== false ) {
			this.computeBoundingBoxes()
			this.computeBoundingSphere()
		} else {
			this.boundingBoxes = []
			this.boundingBox = null
			this.boundingSphere = null
		}

		// Verbose logging
		if ( this.options.verbose ) {
			const attrs = Object.keys( this._attrs )
			console.log( `[MeshLine] geometry built with attributes: ${attrs.join( ', ' )}` )
		}
	}

	computeBoundingBoxes() {
		if ( !this._lines || this._lines.length === 0 ) return
		const padding = this.getBoundingPadding()
		this.boundingBoxes = this._lines.map( ( line, idx ) => {
			const box = ( this.boundingBoxes[idx] || new Box3() ).setFromArray( line )
			if ( padding > 0 ) box.expandByScalar( padding )
			return box
		} )
	}

	getBoundingPadding() {
		if ( this.options?.sizeAttenuation === false ) return 0
		const lineWidth = Number( this.options?.lineWidth ?? 0 )
		if ( !Number.isFinite( lineWidth ) || lineWidth <= 0 ) return 0
		const miterLimit = Number( this.options?.miterLimit ?? 4 )
		const maxWidth = Number( this._maxWidthMultiplier ?? 1 )
		return lineWidth * Math.max( 1, miterLimit ) * 0.5 * Math.max( 1, maxWidth )
	}

	computeBoundingBox() {
		if ( !this.boundingBoxes || this.boundingBoxes.length === 0 ) return
		if ( !this.boundingBox ) this.boundingBox = new Box3()
		if ( !this.boundingBoxes.length ) {
			this.boundingBox?.makeEmpty()
			return
		}
		this.boundingBox.copy( this.boundingBoxes[0] )
		for ( let i = 1; i < this.boundingBoxes.length; i++ ) {
			this.boundingBox.union( this.boundingBoxes[i] )
		}
	}

	computeBoundingSphere() {
		if ( !this.boundingBox ) this.computeBoundingBox()
		if ( !this.boundingSphere ) this.boundingSphere = new Sphere()
		this.boundingBox?.getBoundingSphere( this.boundingSphere )
	}

	/**
	 * Release GPU resources and internal attribute references.
	 */
	dispose() {
		this._attrs = {}
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

		// Handle single line input for backward compatibility
		if ( !Array.isArray( pts ) || ( pts.length > 0 && typeof pts[0] === 'number' ) || pts instanceof Float32Array ) {
			pts = [pts]
		}

		// Convert all inputs to Float32Array and apply the same prep pipeline that
		// setLines() used: subdivide sharp bends, then append the loop duplicate.
		// Matching lengths with the stored lines then implies matching topology.
		// Skip CPU-side corner subdivision when GPU positions drive the line:
		// the CPU array is a straight-line template whose point count controls
		// the vertex/progress grid, and a `closed: true` straight line reads as
		// a hairpin at both endpoints to the subdivision pass. Subdividing would
		// shift the progress mapping that the GPU node samples against.
		const smooth = this.options.smoothSharpBends !== false && !this.options.gpuPositionNode
		const dotThreshold = this.options.smoothSharpBendsThreshold ?? -0.5
		const alpha = this.options.smoothSharpBendsAlpha ?? 0.001
		const newLines = pts.map( ( line, i ) => {
			let arr = toFloat32( line )
			const isLooped = this._isSingleLoopValue ? this._lineLoops : ( this._lineLoops?.[i] ?? false )
			if ( smooth ) {
				arr = subdivideSharpBends( arr, isLooped, dotThreshold, alpha )
			}
			if ( isLooped && arr.length >= 9 ) {
				const looped = new Float32Array( arr.length + 3 )
				looped.set( arr )
				looped[arr.length] = arr[0]
				looped[arr.length + 1] = arr[1]
				looped[arr.length + 2] = arr[2]
				arr = looped
			}
			return arr
		} )

		// Validate we have the same number of lines
		if ( newLines.length !== this._lines.length ) {
			// Fallback to full rebuild if line count changes
			this.setLines( pts )
			return
		}

		// Validate each line has the same number of points
		for ( let i = 0; i < newLines.length; i++ ) {
			if ( newLines[i].length !== this._lines[i].length ) {
				// Fallback to full rebuild if any line changes size
				this.setLines( pts )
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
			const isLooped = this._isSingleLoopValue ? this._lineLoops : this._lineLoops[lineIdx]
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
								px = 2 * x - x1
								py = 2 * y - y1
								pz = 2 * z - z1
							} else {
								px = x; py = y; pz = z
							}
						}
					} else {
						const po = ( i - 1 ) * 3
						px = line[po]
						py = line[po + 1]
						pz = line[po + 2]
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
								const po = ( numPoints - 2 ) * 3
								const x1 = line[po], y1 = line[po + 1], z1 = line[po + 2]
								nx = 2 * x - x1
								ny = 2 * y - y1
								nz = 2 * z - z1
							} else {
								nx = x; ny = y; nz = z
							}
						}
					} else {
						const po = ( i + 1 ) * 3
						nx = line[po]
						ny = line[po + 1]
						nz = line[po + 2]
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
let warnedNonFloat32 = false

const toFloat32 = pts => {
	if ( pts instanceof Float32Array ) {
		return pts
	}

	if ( !warnedNonFloat32 ) {
		console.warn( `[MeshLine] Use Float32Array for positions to avoid array conversion & get optimal performance` )
		warnedNonFloat32 = true
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
		} else {
			// Invalid points are skipped but warning for the user
			console.warn( `[MeshLine] Invalid point: ${p}` )
		}
	}

	// If we skipped some points, return a correctly sized array
	return offset === result.length ? result : result.subarray( 0, offset )
}

export default MeshLineGeometry