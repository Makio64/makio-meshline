import {
	BufferAttribute,
	BufferGeometry,
	Matrix4,
	Vector2,
	Vector3
} from 'three'

// normalize various point inputs into a Float32Array
const toFloat32 = pts =>
	pts instanceof Float32Array
		? pts
		: pts instanceof BufferGeometry
			? pts.getAttribute( 'position' ).array
			: new Float32Array(
				pts.flatMap( p =>
					p instanceof Vector3
						? [p.x, p.y, p.z]
						: p instanceof Vector2
							? [p.x, p.y, 0]
							: Array.isArray( p )
								? [p[0], p[1], p[2] ?? 0]
								: []
				)
			)

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

	// set the world matrix
	setMatrixWorld( m ) {
		this.matrixWorld.copy( m )
	}

	// set new points, optional width callback and loop flag
	setPoints( pts, widthCb = this.widthCallback, loop = false ) {
		let arr = toFloat32( pts )
		this.closeLoop = loop && arr.length >= 3
		if ( this.closeLoop ) {
			const [x, y, z] = arr
			arr = new Float32Array( [...arr, x, y, z] )
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

	// initial previous-pair positions
	initPrev( pts, n ) {
		if ( this.closeLoop ) {
			const p = this.getPoint( pts, n - 2 )
			return [...p, ...p]
		} else {
			const a = this.getPoint( pts, 0 )
			const b = this.getPoint( pts, 1 )
			const r = this.reflect( a, b )
			return [...r, ...r]
		}
	}

	// final next-pair positions
	appendNext( pts, n ) {
		if ( this.closeLoop ) {
			const p = this.getPoint( pts, 1 )
			return [...p, ...p]
		} else {
			const a = this.getPoint( pts, n - 1 )
			const b = this.getPoint( pts, n - 2 )
			const r = this.reflect( a, b )
			return [...r, ...r]
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
		const initPrevArr = this.initPrev( pts, numPoints )
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
		const appendNextArr = this.appendNext( pts, numPoints )
		next.set( appendNextArr, nextIdx )
		// nextIdx should already be at the correct position after the loop

		const attrsSetup = {
			position: [positions, 3],
			previous: [previous, 3],
			next: [next, 3],
			side: [sides, 1],
			width: [widths, 1],
			uv: [uvs, 2],
			counters: [counters, 1]
		}

		Object.entries( attrsSetup ).forEach( ( [name, [array, itemSize]] ) => {
			const attr = new BufferAttribute( array, itemSize )
			const old = this._attrs[name]
			if ( old && old.count * old.itemSize === array.length ) { // Check total buffer size
				old.copyArray( array )
				old.needsUpdate = true
			} else {
				this.deleteAttribute( name ) // Remove old attribute if size changed
				this._attrs[name] = attr
				this.setAttribute( name, attr )
			}
		} )

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
