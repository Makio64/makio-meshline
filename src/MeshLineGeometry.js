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
		const lines = options.lines !== undefined ? options.lines : previousOptions.lines

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
		this._lineLoops = [] // Store loop flag for each line
		this._lineProgress ||= []
		this.boundingBoxes = [] // Bounding box for each line
		if ( lines !== undefined ) this.setLines( lines )
		else this.clearGeometry()
	}

	/**
	 * Set one or more polylines and rebuild all geometry buffers.
	 * @param {import('./index.d.ts').MultiLinePoints} lines
	 */
	setLines( lines ) {

		if ( !lines ) throw new Error( '[MeshLine] Lines data required' )

		this.options.lines = lines
		const prepared = prepareLinesInput( lines, this.options, null, this.options.frustumCulled !== false )

		this._lines = prepared.lines
		this._lineLoops = prepared.loops
		this._preparedBounds = prepared.bounds || null
		this._isSingleLoopValue = false
		this._lineCount = prepared.lines.length

		try {
			this.build()
		} catch ( error ) {
			this._lines = []
			this._lineLoops = []
			this._lineCount = 0
			this._preparedBounds = null
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
		const bevelJoins = this.options.join?.type === 'bevel'
		if ( this._bevelJoins !== bevelJoins ) topologyMatches = false
		this._bevelJoins = bevelJoins
		this._lineIndexCounts = this._lineIndexCounts || []

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
		const reuseJoinRoles = topologyMatches && joinRoles === this._attrs.joinRole?.array
		if ( this.options.needsWidth ) {
			widths = this.getReusableArray( 'width', Float32Array, totalVertices, 1, usage )
		}
		if ( this.options.needsUV ) {
			uvs = this.getReusableArray( 'uv', Float32Array, totalVertices * 2, 2, usage )
		}
		if ( this.options.needsProgress ) {
			progress = this.getReusableArray( 'progress', Float32Array, totalVertices, 1, usage )
		}
		if ( needsEndpointMetadata ) {
			endpoints = this.getReusableArray( 'endpoint', Float32Array, totalVertices * 4, 4, usage )
		}
		if ( this.options.needsVertexColor && this.options.vertexColors ) {
			colors = this.getReusableArray( 'vertexColor', Float32Array, totalVertices * 3, 3, usage )
			colors.fill( 0 )
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

		let vertexOffset = 0
		let indexOffset = 0
		let vertexIndex = 0

		// Process each line separately
		for ( let lineIdx = 0; lineIdx < lines.length; lineIdx++ ) {
			const line = lines[lineIdx]
			const isLooped = lineLoops[lineIdx]
			const numPoints = line.length / 3
			if ( numPoints < 2 ) continue
			const lineVertexOffset = vertexOffset

			const lineProgress = needsLineProgress
				? computeLineProgress( line, !!this.options.gpuPositionNode, this._lineProgress[lineIdx] )
				: null
			this._lineProgress[lineIdx] = lineProgress
			let lineMaxWidth = 1

			// Build this line's vertices
			for ( let i = 0; i < numPoints; i++ ) {
				const o = i * 3
				const x = line[o]
				const y = line[o + 1]
				const z = line[o + 2]
				const t = lineProgress ? lineProgress[i] : 0
				const sourceIndex = isLooped && i === numPoints - 1 ? 0 : i
				const sourceProgress = sourceIndex === 0 ? 0 : t

				// Four vertices per point: incoming +/-, then outgoing +/-.
				if ( positions ) {
					positions[vertexOffset * 3] = x
					positions[vertexOffset * 3 + 1] = y
					positions[vertexOffset * 3 + 2] = z
					positions[vertexOffset * 3 + 3] = x
					positions[vertexOffset * 3 + 4] = y
					positions[vertexOffset * 3 + 5] = z
					positions[vertexOffset * 3 + 6] = x
					positions[vertexOffset * 3 + 7] = y
					positions[vertexOffset * 3 + 8] = z
					positions[vertexOffset * 3 + 9] = x
					positions[vertexOffset * 3 + 10] = y
					positions[vertexOffset * 3 + 11] = z
				}

				// sides - which side of the line is the vertex on
				if ( sides && !reuseSides ) {
					sides[vertexOffset] = 1
					sides[vertexOffset + 1] = -1
					sides[vertexOffset + 2] = 1
					sides[vertexOffset + 3] = -1
				}
				if ( !reuseJoinRoles ) {
					joinRoles[vertexOffset] = -1
					joinRoles[vertexOffset + 1] = -2
					joinRoles[vertexOffset + 2] = 1
					joinRoles[vertexOffset + 3] = 2
				}

				// widths
				if ( widths ) {
					const rawWidth = this.widthCallback ? this.widthCallback( sourceProgress, sourceIndex, lineIdx ) : 1
					if ( !Number.isFinite( rawWidth ) || !Number.isFinite( Math.fround( Math.abs( rawWidth ) ) ) ) {
						throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIdx}` )
					}
					const w = Math.abs( rawWidth )
					this._maxWidthMultiplier = Math.max( this._maxWidthMultiplier, Math.abs( w ) )
					lineMaxWidth = Math.max( lineMaxWidth, w )
					widths[vertexOffset] = w
					widths[vertexOffset + 1] = w
					widths[vertexOffset + 2] = w
					widths[vertexOffset + 3] = w
				}

				// uvs
				if ( uvs ) {
					uvs[vertexOffset * 2] = t
					uvs[vertexOffset * 2 + 1] = 0
					uvs[vertexOffset * 2 + 2] = t
					uvs[vertexOffset * 2 + 3] = 1
					uvs[vertexOffset * 2 + 4] = t
					uvs[vertexOffset * 2 + 5] = 0
					uvs[vertexOffset * 2 + 6] = t
					uvs[vertexOffset * 2 + 7] = 1
				}

				// progress
				if ( progress ) {
					progress[vertexOffset] = t
					progress[vertexOffset + 1] = t
					progress[vertexOffset + 2] = t
					progress[vertexOffset + 3] = t
				}

				// colors - expects Float32Array or flat array of RGB values
				if ( colors && this.options.vertexColors ) {
					const vc = this.options.vertexColors
					if ( vc instanceof Float32Array || ( Array.isArray( vc ) && typeof vc[0] === 'number' ) ) {
						if ( vc.length >= sourceIndex * 3 + 3 ) {
							const o = sourceIndex * 3, vo = vertexOffset * 3
							if ( !Number.isFinite( vc[o] ) || !Number.isFinite( vc[o + 1] ) || !Number.isFinite( vc[o + 2] ) ) {
								throw new Error( `[MeshLine] vertexColors contains a non-finite value at point ${sourceIndex}` )
							}
							colors[vo] = colors[vo + 3] = colors[vo + 6] = colors[vo + 9] = vc[o]
							colors[vo + 1] = colors[vo + 4] = colors[vo + 7] = colors[vo + 10] = vc[o + 1]
							colors[vo + 2] = colors[vo + 5] = colors[vo + 8] = colors[vo + 11] = vc[o + 2]
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
						// Explicit endpoint metadata makes extrapolation unnecessary. Reuse
						// the endpoint itself so extreme finite coordinates cannot overflow.
						prevX = x
						prevY = y
						prevZ = z
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
					previous[vertexOffset * 3 + 6] = prevX
					previous[vertexOffset * 3 + 7] = prevY
					previous[vertexOffset * 3 + 8] = prevZ
					previous[vertexOffset * 3 + 9] = prevX
					previous[vertexOffset * 3 + 10] = prevY
					previous[vertexOffset * 3 + 11] = prevZ
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
							// See the matching start-point policy above.
							nextX = x
							nextY = y
							nextZ = z
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
					next[vertexOffset * 3 + 6] = nextX
					next[vertexOffset * 3 + 7] = nextY
					next[vertexOffset * 3 + 8] = nextZ
					next[vertexOffset * 3 + 9] = nextX
					next[vertexOffset * 3 + 10] = nextY
					next[vertexOffset * 3 + 11] = nextZ
				}
				vertexOffset += 4
			}

			if ( endpoints ) {
				writeEndpointMetadata( endpoints, lineProgress, isLooped, lineVertexOffset )
			}
			this._lineMaxWidths[lineIdx] = lineMaxWidth

			// Connectivity is a pure function of each line's point count, loop flag
			// and join type. Preserve the index buffer when that topology is
			// unchanged, even if attributes or source positions are rebuilt.
			if ( !reuseConnectivity ) {
				for ( let i = 0; i < numPoints - 1; i++ ) {
					const o = vertexIndex + i * 4
					indices[indexOffset++] = o + 2
					indices[indexOffset++] = o + 3
					indices[indexOffset++] = o + 4
					indices[indexOffset++] = o + 4
					indices[indexOffset++] = o + 3
					indices[indexOffset++] = o + 5
				}
				if ( bevelJoins ) {
					// Bridge each point's incoming cross-section to its outgoing one.
					// The two rows coincide while the miter holds, so both triangles
					// are exactly zero-area then; past the miter limit they separate
					// and this fills the notch. The four corners are two antipodal
					// pairs about the join, making the pair a bowtie: the triangles
					// always wind oppositely and FrontSide keeps exactly the one
					// covering the outer notch, whichever way the corner turns.
					const firstJoin = isLooped ? 0 : 1
					for ( let i = firstJoin; i < numPoints - 1; i++ ) {
						const o = vertexIndex + i * 4
						indices[indexOffset++] = o
						indices[indexOffset++] = o + 1
						indices[indexOffset++] = o + 2
						indices[indexOffset++] = o + 2
						indices[indexOffset++] = o + 1
						indices[indexOffset++] = o + 3
					}
				}
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
		this._lineWidthScratch = []
		this._lineMaxWidths = []
		this._linePointCounts = []
		this._linePointCountsScratch = []
		this._lineIndexCounts = []
		this._meshLineIndex = null
		this._updatePrepared = null
		this._preparedBounds = null
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
		for ( let idx = 0; idx < this._lines.length; idx++ ) {
			const box = boxes[idx] || new Box3()
			const bounds = preparedBounds?.[idx]
			if ( bounds ) {
				box.min.set( bounds[0], bounds[1], bounds[2] )
				box.max.set( bounds[3], bounds[4], bounds[5] )
			} else {
				box.setFromArray( this._lines[idx] )
			}
			if ( padding > 0 ) box.expandByScalar( padding )
			boxes[idx] = box
			if ( idx === 0 ) this.boundingBox.copy( box )
			else this.boundingBox.union( box )
		}
		boxes.length = this._lines.length
		this.boundingBoxes = boxes
	}

	getBoundingPadding() {
		if ( this.options?.sizeAttenuation === false ) return 0
		const lineWidth = Number( this.options?.lineWidth ?? 0 )
		if ( !Number.isFinite( lineWidth ) || lineWidth <= 0 ) return 0
		const requestedMiterLimit = Number( this.options?.miterLimit ?? 4 )
		const miterLimit = Number.isFinite( requestedMiterLimit ) ? Math.max( 1, Math.min( requestedMiterLimit, 1e6 ) ) : 4
		const maxWidth = Number( this._maxWidthMultiplier ?? 1 )
		return lineWidth * Math.max( 1, miterLimit ) * 0.5 * Math.max( 1, maxWidth )
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
		this._lineLoops = []
		this._lineProgress = []
		this._lineWidthScratch = []
		this._lineMaxWidths = []
		this._linePointCounts = []
		this._linePointCountsScratch = []
		this._lineIndexCounts = []
		this._meshLineIndex = null
		this._updatePrepared = null
		this._preparedBounds = null
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

		this._updatePrepared ||= { lines: [], loops: [] }
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

		// Validate each line has the same number of points
		for ( let i = 0; i < newLines.length; i++ ) {
			if ( newLines[i].length !== this._lines[i].length ) {
				// Fallback to full rebuild if any line changes size
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
		const widthChanged = !!( widthArray && this.widthCallback )
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
			for ( let i = 0; i < numPoints; i++ ) {
				const sourceIndex = isLooped && i === numPoints - 1 ? 0 : i
				const progress = sourceIndex === 0 ? 0 : lineProgress[i]
				const rawWidth = this.widthCallback ? this.widthCallback( progress, sourceIndex, lineIdx ) : 1
				if ( !Number.isFinite( rawWidth ) || !Number.isFinite( Math.fround( Math.abs( rawWidth ) ) ) ) {
					throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIdx}` )
				}
				const width = Math.abs( rawWidth )
				widths[i] = width
				lineMaxWidth = Math.max( lineMaxWidth, width )
				this._maxWidthMultiplier = Math.max( this._maxWidthMultiplier, width )
			}
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
			const hasDerivedAttributes = ( progressChanged && ( progressArray || uvArray ) ) || widthChanged

			if ( prevArray && nextArray && !hasDerivedAttributes ) {
				globalVertexIndex = writePositionAndNeighbors(
					line,
					isLooped,
					positionsArray,
					prevArray,
					nextArray,
					globalVertexIndex
				)
				if ( endpointArray && endpointAttr.itemSize === 4 && progressChanged ) {
					writeEndpointMetadata( endpointArray, lineProgress, isLooped, lineVertexOffset )
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
				writeEndpointMetadata( endpointArray, lineProgress, isLooped, lineVertexOffset )
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
		this._lines = newLines
		this._lineLoops = newLoops
		this._updatePrepared.lines = previousLines
		this._updatePrepared.loops = previousLoops

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
		const needsArcProgress = !proceduralProgress && !!(
			progressAttr ||
			uvAttr ||
			this.widthCallback ||
			endpointAttr?.itemSize === 4
		)
		const callbackCanReject = !!( widthAttr && this.widthCallback )
		let restoreRange = null

		if ( callbackCanReject ) {
			this._lineWidthScratch ||= []
			this._partialRestoreScratch = this._partialRestoreScratch?.length >= range.length
				? this._partialRestoreScratch
				: new Float32Array( range.length )
			restoreRange = this._partialRestoreScratch.subarray( 0, range.length )
			restoreRange.set( line.subarray( startPoint * 3, endPoint * 3 ) )
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
				lineProgress = computeLineProgress( line, false, lineProgress )
				this._lineProgress[lineIndex] = lineProgress
			} else if ( proceduralProgress && !lineProgress ) {
				lineProgress = computeLineProgress( line, true, lineProgress )
				this._lineProgress[lineIndex] = lineProgress
			}

			if ( callbackCanReject ) {
				preparedWidths = this._lineWidthScratch[lineIndex]?.length === storedPointCount
					? this._lineWidthScratch[lineIndex]
					: new Float32Array( storedPointCount )
				this._lineWidthScratch[lineIndex] = preparedWidths
				lineMaxWidth = 1
				for ( let i = 0; i < storedPointCount; i++ ) {
					const sourceIndex = isLooped && i === storedPointCount - 1 ? 0 : i
					const progress = sourceIndex === 0 ? 0 : lineProgress[i]
					const rawWidth = this.widthCallback( progress, sourceIndex, lineIndex )
					if ( !Number.isFinite( rawWidth ) || !Number.isFinite( Math.fround( Math.abs( rawWidth ) ) ) ) {
						throw new Error( `[MeshLine] widthCallback returned a non-finite value at point ${i} of line ${lineIndex}` )
					}
					const width = Math.abs( rawWidth )
					preparedWidths[i] = width
					lineMaxWidth = Math.max( lineMaxWidth, width )
				}
			}
		} catch ( error ) {
			if ( restoreRange ) {
				line.set( restoreRange, startPoint * 3 )
				if ( hasSyntheticSeam && startPoint === 0 ) line.set( line.subarray( 0, 3 ), sourcePointCount * 3 )
				if ( needsArcProgress ) this._lineProgress[lineIndex] = computeLineProgress( line, false, lineProgress )
			}
			throw error
		}

		let lineVertexOffset = 0
		for ( let i = 0; i < lineIndex; i++ ) lineVertexOffset += this._lines[i].length / 3 * 4

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
				writeUVLine( uvAttr.array, lineProgress, lineVertexOffset )
				markAttributeUpdateRange( uvAttr, lineVertexOffset * 2, storedPointCount * 8 )
			}
			if ( endpointAttr?.itemSize === 4 ) {
				writeEndpointMetadata( endpointAttr.array, lineProgress, isLooped, lineVertexOffset )
				markAttributeUpdateRange( endpointAttr, lineVertexOffset * 4, storedPointCount * 16 )
			}
		}

		if ( preparedWidths ) {
			writeScalarLine( widthAttr.array, preparedWidths, lineVertexOffset )
			markAttributeUpdateRange( widthAttr, lineVertexOffset, storedPointCount * 4 )
			this._lineMaxWidths[lineIndex] = lineMaxWidth
			this._maxWidthMultiplier = 1
			for ( let i = 0; i < this._lineMaxWidths.length; i++ ) {
				this._maxWidthMultiplier = Math.max( this._maxWidthMultiplier, this._lineMaxWidths[i] ?? 1 )
			}
		}

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

const sanitizeLinePoints = ( line, bounds = null, progressTarget = null ) => {
	const pointCount = Math.floor( line.length / 3 )
	let changed = line.length % 3 !== 0
	const writeProgress = progressTarget?.length === pointCount
	let totalLength = 0
	if ( writeProgress ) progressTarget[0] = 0
	if ( bounds ) {
		bounds[0] = bounds[1] = bounds[2] = Infinity
		bounds[3] = bounds[4] = bounds[5] = -Infinity
	}

	// The Float32Array path is the dynamic-update hot path. Validate first and
	// return it directly when no compaction is necessary, avoiding a full-size
	// temporary allocation on every frame.
	for ( let i = 0; i < pointCount && !changed; i++ ) {
		const sourceOffset = i * 3
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) {
			changed = true
		} else if ( i > 0 && pointsEqual( line, sourceOffset - 3, sourceOffset ) ) {
			changed = true
		} else {
			if ( bounds ) {
				if ( x < bounds[0] ) bounds[0] = x
				if ( y < bounds[1] ) bounds[1] = y
				if ( z < bounds[2] ) bounds[2] = z
				if ( x > bounds[3] ) bounds[3] = x
				if ( y > bounds[4] ) bounds[4] = y
				if ( z > bounds[5] ) bounds[5] = z
			}
			if ( writeProgress && i > 0 ) {
				const dx = x - line[sourceOffset - 3]
				const dy = y - line[sourceOffset - 2]
				const dz = z - line[sourceOffset - 1]
				totalLength += Math.sqrt( dx * dx + dy * dy + dz * dz )
				progressTarget[i] = totalLength
			}
		}
	}

	if ( !changed ) {
		if ( writeProgress ) normalizeLineProgress( progressTarget, pointCount, totalLength )
		return line
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
			changed = true
			continue
		}

		if ( offset > 0 && result[offset - 3] === x && result[offset - 2] === y && result[offset - 1] === z ) {
			changed = true
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
	const prepared = target || { lines: [], loops: [] }
	const lines = prepared.lines
	const loops = prepared.loops
	lines.length = 0
	loops.length = 0
	const boundsList = collectBounds ? ( prepared.bounds ||= [] ) : null
	const progressReady = progressTargets ? ( prepared.progressReady ||= [] ) : null
	const smooth = options.smoothSharpBends === true && !options.gpuPositionNode
	const dotThreshold = options.smoothSharpBendsThreshold ?? -0.5
	const alpha = options.smoothSharpBendsAlpha ?? 0.001
	const singleLine = input instanceof Float32Array || input instanceof BufferGeometry || isSingleLineArray( input )
	const sourceCount = singleLine ? 1 : ( input?.length ?? 0 )

	for ( let i = 0; i < sourceCount; i++ ) {
		const points = singleLine ? input : input[i]
		if ( !points || points.length === 0 ) continue

		const requestedLoop = typeof options.closed === 'boolean' ? options.closed : ( options.closed?.[i] ?? false )
		const outputIndex = lines.length
		const lineBounds = boundsList ? ( boundsList[outputIndex] || new Float64Array( 6 ) ) : null
		const progressTarget = progressTargets?.[outputIndex] || null
		const converted = toFloat32( points )
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
		if ( boundsList ) boundsList[lines.length - 1] = lineBounds
		if ( progressReady ) progressReady[lines.length - 1] = hasPreparedProgress
	}
	if ( boundsList ) boundsList.length = lines.length
	if ( progressReady ) progressReady.length = lines.length

	return prepared
}

const computeLineProgress = ( line, procedural, target = null ) => {
	const pointCount = line.length / 3
	const result = target?.length === pointCount ? target : new Float32Array( pointCount )
	result[0] = 0
	if ( pointCount < 2 ) return result

	if ( procedural ) {
		const step = 1 / ( pointCount - 1 )
		for ( let i = 1; i < pointCount; i++ ) result[i] = i * step
		result[pointCount - 1] = 1
		return result
	}

	let totalLength = 0
	for ( let i = 1; i < pointCount; i++ ) {
		const previousOffset = ( i - 1 ) * 3
		const offset = i * 3
		const dx = line[offset] - line[previousOffset]
		const dy = line[offset + 1] - line[previousOffset + 1]
		const dz = line[offset + 2] - line[previousOffset + 2]
		totalLength += Math.sqrt( dx * dx + dy * dy + dz * dz )
		result[i] = totalLength
	}

	normalizeLineProgress( result, pointCount, totalLength )
	return result
}

const normalizeLineProgress = ( result, pointCount, totalLength ) => {
	if ( pointCount < 2 ) return
	if ( totalLength <= 0 || !Number.isFinite( totalLength ) ) {
		const step = 1 / ( pointCount - 1 )
		for ( let i = 1; i < pointCount; i++ ) result[i] = i * step
	} else {
		for ( let i = 1; i < pointCount; i++ ) result[i] /= totalLength
	}
	result[pointCount - 1] = 1
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
	const hadPendingUpdate = ranges.length > 0
	let rangeStart = start
	let rangeEnd = start + count
	for ( let i = ranges.length - 1; i >= 0; i-- ) {
		const current = ranges[i]
		const currentEnd = current.start + current.count
		if ( rangeEnd < current.start || rangeStart > currentEnd ) continue
		rangeStart = Math.min( rangeStart, current.start )
		rangeEnd = Math.max( rangeEnd, currentEnd )
		ranges.splice( i, 1 )
	}
	if ( rangeStart === 0 && rangeEnd === attribute.array.length ) {
		const fullRange = attribute._meshLineFullUpdateRange || { start: 0, count: attribute.array.length }
		fullRange.start = 0
		fullRange.count = attribute.array.length
		attribute._meshLineFullUpdateRange = fullRange
		ranges.push( fullRange )
	} else {
		attribute.addUpdateRange( rangeStart, rangeEnd - rangeStart )
	}
	if ( !hadPendingUpdate ) attribute.needsUpdate = true
}

const writePositionRange = ( array, line, vertexOffset, startPoint, endPoint ) => {
	for ( let i = startPoint; i < endPoint; i++ ) {
		const sourceOffset = i * 3
		const targetOffset = ( vertexOffset + i * 4 ) * 3
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
	for ( let i = 0; i < values.length; i++ ) {
		const targetOffset = vertexOffset + i * 4
		array[targetOffset] = array[targetOffset + 1] = array[targetOffset + 2] = array[targetOffset + 3] = values[i]
	}
}

const writeUVLine = ( array, progress, vertexOffset ) => {
	for ( let i = 0; i < progress.length; i++ ) {
		const targetOffset = ( vertexOffset + i * 4 ) * 2
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

const writePositionAndNeighbors = ( line, isLooped, positions, previous, next, vertexOffset ) => {
	const pointCount = line.length / 3
	for ( let i = 0; i < pointCount; i++ ) {
		const sourceOffset = i * 3
		const targetOffset = ( vertexOffset + i * 4 ) * 3
		const previousOffset = i > 0
			? sourceOffset - 3
			: ( isLooped ? ( pointCount - 2 ) * 3 : sourceOffset )
		const nextOffset = i < pointCount - 1
			? sourceOffset + 3
			: ( isLooped ? 3 : sourceOffset )
		const x = line[sourceOffset]
		const y = line[sourceOffset + 1]
		const z = line[sourceOffset + 2]
		const px = line[previousOffset]
		const py = line[previousOffset + 1]
		const pz = line[previousOffset + 2]
		const nx = line[nextOffset]
		const ny = line[nextOffset + 1]
		const nz = line[nextOffset + 2]

		positions[targetOffset] = positions[targetOffset + 3] = positions[targetOffset + 6] = positions[targetOffset + 9] = x
		positions[targetOffset + 1] = positions[targetOffset + 4] = positions[targetOffset + 7] = positions[targetOffset + 10] = y
		positions[targetOffset + 2] = positions[targetOffset + 5] = positions[targetOffset + 8] = positions[targetOffset + 11] = z
		previous[targetOffset] = previous[targetOffset + 3] = previous[targetOffset + 6] = previous[targetOffset + 9] = px
		previous[targetOffset + 1] = previous[targetOffset + 4] = previous[targetOffset + 7] = previous[targetOffset + 10] = py
		previous[targetOffset + 2] = previous[targetOffset + 5] = previous[targetOffset + 8] = previous[targetOffset + 11] = pz
		next[targetOffset] = next[targetOffset + 3] = next[targetOffset + 6] = next[targetOffset + 9] = nx
		next[targetOffset + 1] = next[targetOffset + 4] = next[targetOffset + 7] = next[targetOffset + 10] = ny
		next[targetOffset + 2] = next[targetOffset + 5] = next[targetOffset + 8] = next[targetOffset + 11] = nz
	}
	return vertexOffset + pointCount * 4
}

const writeEndpointMetadata = ( array, progress, isLooped, vertexOffset ) => {
	const pointCount = progress.length
	const loopValue = isLooped ? 1 : 0
	for ( let i = 0; i < pointCount; i++ ) {
		const openEndpoint = !isLooped && i === 0 ? -1 : ( !isLooped && i === pointCount - 1 ? 1 : 0 )
		const previousStep = i > 0
			? Math.max( 0, progress[i] - progress[i - 1] )
			: ( isLooped && pointCount > 2 ? Math.max( 0, 1 - progress[pointCount - 2] ) : 0 )
		const nextStep = i < pointCount - 1
			? Math.max( 0, progress[i + 1] - progress[i] )
			: ( isLooped && pointCount > 2 ? Math.max( 0, progress[1] ) : 0 )
		const offset = ( vertexOffset + i * 4 ) * 4
		array[offset] = array[offset + 4] = array[offset + 8] = array[offset + 12] = openEndpoint
		array[offset + 1] = array[offset + 5] = array[offset + 9] = array[offset + 13] = loopValue
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
