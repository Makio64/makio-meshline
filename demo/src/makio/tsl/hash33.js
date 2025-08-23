import { div, float, Fn, int, uint, uvec3, vec3 } from "three/webgpu"

// TSL Port of hash33 https://www.shadertoy.com/view/XlXcW4 by Inigo Quilez
const k = uint( 1103515245 )
const hash33 = Fn( ( [x_immutable] ) => {

	const x = x_immutable.toVar()
	const shift = uvec3( uint( 8 ) )

	x.assign( x.shiftRight( shift ).bitXor( x.yzx ).mul( k ) )
	x.assign( x.shiftRight( shift ).bitXor( x.yzx ).mul( k ) )
	x.assign( x.shiftRight( shift ).bitXor( x.yzx ).mul( k ) )

	return vec3( x ).mul( div( 1.0, float( int( 0xffffffff ) ) ) )

} ).setLayout( {
	name: 'hash33',
	type: 'vec3',
	inputs: [{ name: 'x', type: 'uvec3' }]
} )

export default hash33
export { hash33 }
