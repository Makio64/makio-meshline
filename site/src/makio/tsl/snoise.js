
import { vec3, mod, Fn, vec2, floor, step, float, sub, int, dot, max, fract, abs, pow, mul } from 'three/webgpu'

const permute = /*#__PURE__*/ Fn( ( [x_immutable] ) => {

	const x = vec3( x_immutable ).toVar()
	return mod( x.mul( 34. ).add( 1. ).mul( x ), 289. )

} ).setLayout( {
	name: 'permute',
	type: 'vec3',
	inputs: [{ name: 'x', type: 'vec3', qualifier: 'in' }]
} )

export const snoise = /*#__PURE__*/ Fn( ( [v_immutable] ) => {

	const v = vec2( v_immutable ).toVar()
	const i = vec2( floor( v.x.add( v.y ).mul( .36602540378443 ).add( v ) ) ).toVar()
	const x0 = vec2( i.x.add( i.y ).mul( .211324865405187 ).add( v.sub( i ) ) ).toVar()
	const s = float( step( x0.x, x0.y ) ).toVar()
	const j = vec2( sub( 1.0, s ), s ).toVar()
	const x1 = vec2( x0.sub( j ).add( .211324865405187 ) ).toVar()
	const x3 = vec2( x0.sub( .577350269189626 ) ).toVar()
	i.assign( mod( i, 289. ) )
	const p = vec3( permute( permute( i.y.add( vec3( int( 0 ), j.y, int( 1 ) ) ) ).add( i.x ).add( vec3( int( 0 ), j.x, int( 1 ) ) ) ) ).toVar()
	const m = vec3( max( float( .5 ).sub( vec3( dot( x0, x0 ), dot( x1, x1 ), dot( x3, x3 ) ) ), 0. ) ).toVar()
	const x = vec3( fract( p.mul( .024390243902439 ) ).mul( 2. ).sub( 1. ) ).toVar(), h = vec3( abs( x ).sub( .5 ) ).toVar()
	const a0 = vec3( x.sub( floor( x.add( .5 ) ) ) ).toVar()

	return float( .5 ).add( mul( 65., dot( pow( m, vec3( 4. ) ).mul( float( -0.85373472095314 ).mul( a0.mul( a0 ).add( h.mul( h ) ) ).add( 1.79284291400159 ) ), a0.mul( vec3( x0.x, x1.x, x3.x ) ).add( h.mul( vec3( x0.y, x1.y, x3.y ) ) ) ) ) )

} ).setLayout( {
	name: 'snoise',
	type: 'float',
	inputs: [{ name: 'v', type: 'vec2', qualifier: 'in' }]
} )
