
import { abs, add, dot, float, floor, Fn, inverseSqrt, max, min, mod, mul, step, sub, vec2, vec3, vec4 } from 'three/webgpu'

export const permute = /*#__PURE__*/ Fn( ( [x_immutable] ) => {

	const x = vec4( x_immutable ).toVar()

	return mod( x.mul( 34. ).add( 1. ).mul( x ), 289. ).toVar()

} ).setLayout( {
	name: 'permute',
	type: 'vec4',
	inputs: [{ name: 'x', type: 'vec4' }]
} )

export const snoise3d = /*#__PURE__*/ Fn( ( [v_immutable] ) => {

	const v = vec3( v_immutable ).toVar()
	const C = vec2( 0.16666666666, 0.33333333333 )
	const D = vec4( 0., 0.5, 1., 2. )
	const i = vec3( floor( C.y.mul( v.x.add( v.y ).add( v.z ) ).add( v ) ) ).toVar()
	const x0 = vec3( C.x.mul( i.x.add( i.y ).add( i.z ) ).add( v.sub( i ) ) ).toVar()
	const g = vec3( step( x0.yzx, x0 ) ).toVar()
	const l = vec3( sub( 1., g ).zxy ).toVar()
	const i1 = vec3( min( g, l ) ).toVar()
	const i2 = vec3( max( g, l ) ).toVar()
	const x1 = vec3( x0.sub( i1 ).add( C.x ) ).toVar()
	const x2 = vec3( x0.sub( i2 ).add( C.y ) ).toVar()
	const x3 = vec3( x0.sub( D.yyy ) ).toVar()
	i.assign( mod( i, 289. ) )
	const p = vec4( permute( permute( permute( i.z.add( vec4( 0., i1.z, i2.z, 1. ) ) ).add( i.y ).add( vec4( 0., i1.y, i2.y, 1. ) ) ).add( i.x ).add( vec4( 0., i1.x, i2.x, 1. ) ) ) ).toVar()
	const ns = vec3( mul( 0.142857142857, D.wyz ).sub( D.xzx ) ).toVar()
	const j = vec4( float( - 49. ).mul( floor( p.mul( ns.z ).mul( ns.z ) ) ).add( p ) ).toVar()
	const x_ = vec4( floor( j.mul( ns.z ) ) ).toVar()
	const x = vec4( x_.mul( ns.x ).add( ns.yyyy ) ).toVar()
	const y = vec4( floor( j.sub( mul( 7., x_ ) ) ).mul( ns.x ).add( ns.yyyy ) ).toVar()
	const h = vec4( sub( 1., abs( x ) ).sub( abs( y ) ) ).toVar()
	const b0 = vec4( x.xy, y.xy ).toVar()
	const b1 = vec4( x.zw, y.zw ).toVar()
	const sh = vec4( step( h, vec4( 0. ) ).negate() ).toVar()
	const a0 = vec4( b0.xzyw.add( floor( b0 ).mul( 2. ).add( 1. ).xzyw.mul( sh.xxyy ) ) ).toVar()
	const a1 = vec4( b1.xzyw.add( floor( b1 ).mul( 2. ).add( 1. ).xzyw.mul( sh.zzww ) ) ).toVar()
	const p0 = vec3( a0.xy, h.x ).toVar()
	const p1 = vec3( a0.zw, h.y ).toVar()
	const p2 = vec3( a1.xy, h.z ).toVar()
	const p3 = vec3( a1.zw, h.w ).toVar()
	const norm = vec4( inverseSqrt( vec4( dot( p0, p0 ), dot( p1, p1 ), dot( p2, p2 ), dot( p3, p3 ) ) ) ).toVar()
	p0.mulAssign( norm.x )
	p1.mulAssign( norm.y )
	p2.mulAssign( norm.z )
	p3.mulAssign( norm.w )
	const m = vec4( max( sub( 0.6, vec4( dot( x0, x0 ), dot( x1, x1 ), dot( x2, x2 ), dot( x3, x3 ) ) ), 0. ) ).toVar()

	return add( 0.5, mul( 12., dot( m.mul( m ).mul( m ), vec4( dot( p0, x0 ), dot( p1, x1 ), dot( p2, x2 ), dot( p3, x3 ) ) ) ) ).toVar()

} ).setLayout( {
	name: 'snoise',
	type: 'float',
	inputs: [{ name: 'v', type: 'vec3', qualifier: 'in' }]
} )

export default snoise3d
