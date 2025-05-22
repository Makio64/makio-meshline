import { dot, float, Fn, int, screenSize, time, uint, uv, vec2, vec3, vec4, viewportResolution } from "three/tsl"

const squares16 = Fn( ( [ctr] ) => {
	const key = uint( 0x7a1a912f )
	const two16 = float( 65536.0 )

	// Weyl sequence vars, y and z
	let y = ctr.mul( key ).toUint()
	let z = ctr.add( 1 ).mul( key ).toUint()
	let x = uint( ctr.mul( key ) ).toUint() // x = y

	// mixing rounds
	x = x.mul( x ).add( y )
	x = x.shiftRight( 16 ).bitOr( x.shiftLeft( 16 ) )
	x = x.mul( x ).add( z )
	x = x.shiftRight( 16 ).bitOr( x.shiftLeft( 16 ) )
	x = x.mul( x ).add( y ).shiftRight( 16 )

	return x.div( two16 )
} )

const fastNoise = Fn( () => {
	const id = dot( uv(), vec2( 1, screenSize.x ) ).toUint()
	// const cnt_pixels = screenSize.x.mul( screenSize.y ).toInt()

	return squares16( id )//.add(float(0.1).mul(cnt_pixels).toUint()))
} )

export default fastNoise
export { fastNoise }
