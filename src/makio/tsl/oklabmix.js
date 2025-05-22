import { Fn, mat3, mix, pow, vec3 } from "three/tsl"

// optimized oklab_mix : https://www.shadertoy.com/view/ttcyRS
const oklab_mix = Fn( ( [colA, colB, h] ) => {
	// https://bottosson.github.io/posts/oklab
	const kCONEtoLMS = mat3(
		0.4121656120,  0.2118591070,  0.0883097947,
		0.5362752080,  0.6807189584,  0.2818474174,
		0.0514575653,  0.1074065790,  0.6302613616 ).toConst()
	const kLMStoCONE = mat3(
		4.0767245293, -1.2681437731, -0.0041119885,
		-3.3072168827,  2.6093323231, -0.7034763098,
		0.2307590544, -0.3411344290,  1.7068625689 ).toConst()

	const c13 = vec3( 1 / 3 ).toConst()
	const lmsA = pow( kCONEtoLMS.mul( colA ), c13 )
	const lmsB = pow( kCONEtoLMS.mul( colB ), c13 )
	const lms = mix( lmsA, lmsB, h )
	return kLMStoCONE.mul( lms.mul( lms ).mul( lms ) )
} )

export default oklab_mix
export { oklab_mix }
