import { BufferAttribute, BufferGeometry, Matrix4, Vector2, Vector3 } from 'three'

function convertPoints( points ) {
	if ( points instanceof Float32Array ) return points
	if ( points instanceof BufferGeometry ) return points.getAttribute( 'position' ).array
	return points
		.map( ( p ) => {
			const isArray = Array.isArray( p )
			return p instanceof Vector3
				? [p.x, p.y, p.z]
				: p instanceof Vector2
					? [p.x, p.y, 0]
					: isArray && p.length === 3
						? [p[0], p[1], p[2]]
						: isArray && p.length === 2
							? [p[0], p[1], 0]
							: p
		} )
		.flat()
}

export class MeshLineGeometry extends BufferGeometry {
	type = 'MeshLine'
	isMeshLine = true
	positions = []
	previous = []
	next = []
	side = []
	width = []
	indices_array = []
	uvs = []
	counters = []
	widthCallback = null
	closeLoop = false

	_attributes = {
		position: new BufferAttribute( new Float32Array( this.positions ), 3 ),
		previous: new BufferAttribute( new Float32Array( this.previous ), 3 ),
		next: new BufferAttribute( new Float32Array( this.next ), 3 ),
		side: new BufferAttribute( new Float32Array( this.side ), 1 ),
		width: new BufferAttribute( new Float32Array( this.width ), 1 ),
		uv: new BufferAttribute( new Float32Array( this.uvs ), 2 ),
		index: new BufferAttribute( new Uint16Array( this.indices_array ), 1 ),
		counters: new BufferAttribute( new Float32Array( this.counters ), 1 ),
	}

	_points = []
	points = null

	// Used to raycast
	matrixWorld = new Matrix4()

	constructor() {
		super()

		Object.defineProperties( this, {
			points: {
				enumerable: true,
				get() {
					return this._points
				},
				set( value ) {
					this.setPoints( value, this.widthCallback, this.closeLoop )
				},
			},
		} )
	}

	setMatrixWorld( matrixWorld ) {
		this.matrixWorld = matrixWorld
	}

	setPoints( points, wcb, closeLoop = false ) {
		points = convertPoints( points )
		this.closeLoop = closeLoop
		if ( this.closeLoop && points.length >= 3 ) {
			let pts = points
			if ( pts instanceof Float32Array ) pts = Array.from( pts )
			pts.push( pts[0], pts[1], pts[2] )
			points = pts
		}
		this._points = points
		this.widthCallback = wcb ?? null
		this.positions = []
		this.counters = []

		if ( points.length && ( points[0] ) instanceof Vector3 ) {
			for ( let j = 0; j < points.length; j++ ) {
				const p = points[j]
				const c = j / ( points.length - 1 )
				this.positions.push( p.x, p.y, p.z )
				this.positions.push( p.x, p.y, p.z )
				this.counters.push( c )
				this.counters.push( c )
			}
		} else {
			for ( let j = 0; j < points.length; j += 3 ) {
				const c = j / ( points.length - 1 )
				this.positions.push( points[j], points[j + 1], points[j + 2] )
				this.positions.push( points[j], points[j + 1], points[j + 2] )
				this.counters.push( c )
				this.counters.push( c )
			}
		}
		this.process()
	}

	compareV3( a, b ) {
		const aa = a * 6
		const ab = b * 6
		return (
			this.positions[aa] === this.positions[ab] &&
      this.positions[aa + 1] === this.positions[ab + 1] &&
      this.positions[aa + 2] === this.positions[ab + 2]
		)
	}

	copyV3( a ) {
		const aa = a * 6
		return [this.positions[aa], this.positions[aa + 1], this.positions[aa + 2]]
	}

	process() {
		const l = this.positions.length / 6

		this.previous = []
		this.next = []
		this.side = []
		this.width = []
		this.indices_array = []
		this.uvs = []

		let w = 1
		let v = this.copyV3( this.closeLoop ? l - 2 : 0 )
		this.previous.push( v[0], v[1], v[2] )
		this.previous.push( v[0], v[1], v[2] )

		for ( let j = 0; j < l; j++ ) {
			this.side.push( 1, -1 )

			if ( this.widthCallback ) w = this.widthCallback( j / ( l - 1 ) )
			this.width.push( w, w )

			this.uvs.push( j / ( l - 1 ), 0 )
			this.uvs.push( j / ( l - 1 ), 1 )

			if ( j < l - 1 ) {
				v = this.copyV3( j )
				this.previous.push( v[0], v[1], v[2] )
				this.previous.push( v[0], v[1], v[2] )

				const n = j * 2
				this.indices_array.push( n, n + 1, n + 2 )
				this.indices_array.push( n + 2, n + 1, n + 3 )
			}
			if ( j > 0 ) {
				v = this.copyV3( j )
				this.next.push( v[0], v[1], v[2] )
				this.next.push( v[0], v[1], v[2] )
			}
		}

		if ( this.closeLoop ) v = this.copyV3( 1 )
		else v = this.copyV3( l - 2 ) // ← use penultimate point as next

		this.next.push( v[0], v[1], v[2] )
		this.next.push( v[0], v[1], v[2] )

		if ( !this._attributes || this._attributes.position.count !== this.counters.length ) {
			this._attributes = {
				position: new BufferAttribute( new Float32Array( this.positions ), 3 ),
				previous: new BufferAttribute( new Float32Array( this.previous ), 3 ),
				next: new BufferAttribute( new Float32Array( this.next ), 3 ),
				side: new BufferAttribute( new Float32Array( this.side ), 1 ),
				width: new BufferAttribute( new Float32Array( this.width ), 1 ),
				uv: new BufferAttribute( new Float32Array( this.uvs ), 2 ),
				index: new BufferAttribute( new Uint16Array( this.indices_array ), 1 ),
				counters: new BufferAttribute( new Float32Array( this.counters ), 1 ),
			}
		} else {
			this._attributes.position.copyArray( new Float32Array( this.positions ) )
			this._attributes.position.needsUpdate = true
			this._attributes.previous.copyArray( new Float32Array( this.previous ) )
			this._attributes.previous.needsUpdate = true
			this._attributes.next.copyArray( new Float32Array( this.next ) )
			this._attributes.next.needsUpdate = true
			this._attributes.side.copyArray( new Float32Array( this.side ) )
			this._attributes.side.needsUpdate = true
			this._attributes.width.copyArray( new Float32Array( this.width ) )
			this._attributes.width.needsUpdate = true
			this._attributes.uv.copyArray( new Float32Array( this.uvs ) )
			this._attributes.uv.needsUpdate = true
			this._attributes.index.copyArray( new Uint16Array( this.indices_array ) )
			this._attributes.index.needsUpdate = true
		}

		this.setAttribute( 'position', this._attributes.position )
		this.setAttribute( 'previous', this._attributes.previous )
		this.setAttribute( 'next', this._attributes.next )
		this.setAttribute( 'side', this._attributes.side )
		this.setAttribute( 'width', this._attributes.width )
		this.setAttribute( 'uv', this._attributes.uv )
		this.setAttribute( 'counters', this._attributes.counters )

		this.setIndex( this._attributes.index )

		this.computeBoundingSphere()
		this.computeBoundingBox()
	}
}
