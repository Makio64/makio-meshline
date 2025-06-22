import { Fn, mix, rand, uv, vec3 } from "three/webgpu"

// Port from : https://github.com/mrdoob/three.js/blob/c8ff82d7196d6d7d1e64efd18c6ead16097a2b7b/src/renderers/shaders/ShaderChunk/dithering_pars_fragment.glsl.js#L2
export const dithering = Fn( ( [color] ) => {
	const v = 0.25 / 255
	return color.add( mix( vec3( v, -v, v ).mul( 2 ), vec3( v, -v, v ).mul( -2.0 ), rand( uv() ) ) )
} )
