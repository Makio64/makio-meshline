import { dot, float, Fn, pow, screenUV, distance, smoothstep, vec2, sqrt, add, mul, sub } from "three/webgpu"

const vignette = Fn( ( [Falloff] ) => {
	let uv2 = screenUV.sub( .5 ).mul( 2 )

	const rf = sqrt( dot( uv2, uv2 ) ).mul( Falloff )
	const rf2_1 = rf.mul( rf ).add( 1 )
	const e = float( 1 ).div( rf2_1.mul( rf2_1 ) )

	return e
} )

export default vignette

export const vignette2 = Fn( ( [power, intensity, uv] ) => {

	return float( add( power.oneMinus(), mul( power, pow( mul( 32.0, uv.x ).mul( uv.y ).mul( sub( 1.0, uv.x ) ).mul( sub( 1.0, uv.y ) ), intensity ) ) ) ).toVar()

} )

export const vignette3 = Fn( ( [power, intensity, uv] ) => {

	return add( 0.5, mul( 0.6, pow( mul( 8.0, uv.x ).mul( uv.y ).mul( sub( 1.0, uv.x ) ).mul( sub( 1.0, uv.y ) ), 0.8 ) ) )

} )

export const vignette4 = Fn( ( [offset, darkness] ) => {

	const center = vec2( 0.5, 0.5 )
	const d = float( distance( screenUV, center ) ).toVar()
	return smoothstep( 0.8, offset.mul( 0.799 ), d.mul( darkness.add( offset ) ) )
} )
