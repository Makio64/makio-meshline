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
		const count = pts.length / 3
		const tStep = count > 1 ? 1 / ( count - 1 ) : 0

		const previousPositions = this.initPrev( pts, count )
		const nextPositions = []

		const positions = []
		const sides = []
		const widths = []
		const uvs = []
		const counters = []
		const indices = []

		for ( let i = 0; i < count; i++ ) {
			const [x, y, z] = this.getPoint( pts, i )
			const t = tStep * i

			positions.push( x, y, z, x, y, z )
			counters.push( t, t )
			sides.push( 1, -1 )

			const w = this.widthCallback( t )
			widths.push( w, w )

			uvs.push( t, 0, t, 1 )

			if ( i < count - 1 ) {
				previousPositions.push( x, y, z, x, y, z )
				const o = i * 2
				indices.push( o, o + 1, o + 2, o + 2, o + 1, o + 3 )
			}

			if ( i > 0 ) {
				nextPositions.push( x, y, z, x, y, z )
			}
		}

		nextPositions.push( ...this.appendNext( pts, count ) )

		const attrs = {
			position: [positions, 3],
			previous: [previousPositions, 3],
			next: [nextPositions, 3],
			side: [sides, 1],
			width: [widths, 1],
			uv: [uvs, 2],
			counters: [counters, 1]
		}

		Object.entries( attrs ).forEach( ( [name, [arr, itemSize, Type = Float32Array]] ) => {
			const array = new Type( arr )
			const attr = new BufferAttribute( array, itemSize )
			const old = this._attrs[name]
			if ( old && old.count === attr.count ) {
				old.copyArray( array )
				old.needsUpdate = true
			} else {
				this._attrs[name] = attr
				this.setAttribute( name, attr )
			}
		} )

		this.setIndex( new BufferAttribute( new Uint16Array( indices ), 1 ) )
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
