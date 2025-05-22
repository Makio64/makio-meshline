import { BufferAttribute, BufferGeometry, Matrix4, Vector2, Vector3 } from 'three'

const extractPoints = pts =>
	pts instanceof Float32Array ? pts
		: pts instanceof BufferGeometry ? pts.getAttribute( 'position' ).array
			: ( () => {
				const out = []
				for ( const p of pts ) {
					if ( p instanceof Vector3 ) out.push( p.x, p.y, p.z )
					else if ( p instanceof Vector2 ) out.push( p.x, p.y, 0 )
					else if ( Array.isArray( p ) ) {
						const [x, y, z = 0] = p
						out.push( x, y, z )
					}
				}
				return new Float32Array( out )
			} )()

export class MeshLineGeometry extends BufferGeometry {
	type = 'MeshLine'
	isMeshLine = true
	matrixWorld = new Matrix4()
	widthCallback = t => 1
	closeLoop = false
	_points = new Float32Array()
	_attrs = {}

	get points() { return this._points }
	set points( v ) { this.setPoints( v ) }

	setMatrixWorld( m ) { this.matrixWorld.copy( m ) }

	setPoints( pts, widthCb, closeLoop = false ) {
		this._points = extractPoints( pts )
		this.widthCallback = widthCb || this.widthCallback
		this.closeLoop = closeLoop && this._points.length >= 3
		if ( this.closeLoop ) {
			const [x, y, z] = this._points
			this._points = new Float32Array( [...this._points, x, y, z] )
		}
		this._build()
	}

	_build() {
		const pts = this._points
		const n = pts.length / 3
		const dt = n > 1 ? 1 / ( n - 1 ) : 0

		const pos = [], prev = [], next = []
		const side = [], width = [], uv = [], counter = [], idx = []

		const get = i => pts.subarray( i * 3, i * 3 + 3 )
		const pushPair = ( arr, v ) => arr.push( ...v, ...v )

		// first prev
		if ( this.closeLoop ) pushPair( prev, get( n - 2 ) )
		else {
			const a = get( 0 ), b = get( 1 )
			pushPair( prev, [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]] )
		}

		for ( let i = 0; i < n; i++ ) {
			const p = get( i ), t = dt * i
			pushPair( pos, p )
			pushPair( counter, [t, t] )
			side.push( 1, -1 )
			const w = this.widthCallback( t )
			width.push( w, w )
			uv.push( t, 0, t, 1 )

			if ( i < n - 1 ) {
				pushPair( prev, p )
				const o = i * 2
				idx.push( o, o + 1, o + 2, o + 2, o + 1, o + 3 )
			}
			if ( i > 0 ) pushPair( next, p )
		}

		// last next
		if ( this.closeLoop ) pushPair( next, get( 1 ) )
		else {
			const a = get( n - 1 ), b = get( n - 2 )
			pushPair( next, [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]] )
		}

		// set all non-index attributes
		const attrs = {
			position: [pos, 3],
			previous: [prev, 3],
			next: [next, 3],
			side: [side, 1],
			width: [width, 1],
			uv: [uv, 2],
			counters: [counter, 1],
		}

		for ( const [name, [arr, itemSize, Type = Float32Array]] of Object.entries( attrs ) ) {
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
		}

		// index only via setIndex
		const indexAttr = new BufferAttribute( new Uint16Array( idx ), 1 )
		this._attrs.index = indexAttr
		this.setIndex( indexAttr )

		this.computeBoundingSphere()
		this.computeBoundingBox()
	}
}
