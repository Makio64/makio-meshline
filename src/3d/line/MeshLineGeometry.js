import {
	BufferAttribute,
	BufferGeometry,
	Matrix4,
	Vector2,
	Vector3
} from 'three'

export class MeshLineGeometry extends BufferGeometry {
	constructor( pts, widthCb, loop ) {
		super()
		this.type = 'MeshLine'
		this.isMeshLine = true

		this.matrixWorld = new Matrix4()
		this.widthCallback = t => 1
		this.closeLoop = false
		this._points = new Float32Array()
		this._attrs = {}
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
		this.widthCallback = widthCb
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

	// Generate starting "previous" points for the first vertex pair
	// For closed loops: use the second-to-last point
	// For open lines: extrapolate by reflecting first point over second
	// Returns 6 values: [x,y,z,x,y,z] for the two vertices of the first segment
	getStartingPreviousPoints( pts, numPoints ) {
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

	// Generate ending "next" points for the last vertex pair
	// For closed loops: use the second point (after the first/closing point)
	// For open lines: extrapolate by reflecting last point over second-to-last
	// Returns 6 values: [x,y,z,x,y,z] for the two vertices of the last segment
	getEndingNextPoints( pts, numPoints ) {
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

	// build/update all geometry attributes and index
	build() {
		const pts = this._points
		const numPoints = pts.length / 3
		const tStep = numPoints > 1 ? 1 / ( numPoints - 1 ) : 0

		// Calculate sizes for attribute arrays
		const positionSize = numPoints * 3 * 2
		const previousSize = ( numPoints + 1 ) * 3 * 2 // +1 for initPrev/appendNext
		const nextSize = ( numPoints + 1 ) * 3 * 2     // +1 for initPrev/appendNext
		const sideSize = numPoints * 2
		const widthSize = numPoints * 2
		const uvSize = numPoints * 2 * 2
		const counterSize = numPoints * 2
		const indexSize = ( numPoints - 1 ) * 6

		// Initialize Float32Arrays
		const positions = new Float32Array( positionSize )
		const previous = new Float32Array( previousSize )
		const next = new Float32Array( nextSize )
		const sides = new Float32Array( sideSize )
		const widths = new Float32Array( widthSize )
		const uvs = new Float32Array( uvSize )
		const counters = new Float32Array( counterSize )
		const indices = new Uint16Array( indexSize )

		let posIdx = 0
		let prevIdx = 0
		let nextIdx = 0
		let sideIdx = 0
		let widthIdx = 0
		let uvIdx = 0
		let counterIdx = 0
		let indicesIdx = 0

		// Set initial previous positions
		const initPrevArr = this.getStartingPreviousPoints( pts, numPoints )
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
		const appendNextArr = this.getEndingNextPoints( pts, numPoints )
		next.set( appendNextArr, nextIdx )
		// nextIdx should already be at the correct position after the loop

		// Helper function to set or update attribute
		const setOrUpdateAttribute = ( name, array, itemSize ) => {
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

		setOrUpdateAttribute( 'position', positions, 3 )
		setOrUpdateAttribute( 'previous', previous, 3 )
		setOrUpdateAttribute( 'next', next, 3 )
		setOrUpdateAttribute( 'side', sides, 1 )
		setOrUpdateAttribute( 'width', widths, 1 )
		setOrUpdateAttribute( 'uv', uvs, 2 )
		setOrUpdateAttribute( 'counters', counters, 1 )

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