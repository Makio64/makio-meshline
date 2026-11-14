/**
 * `three/webgpu` in the standalone builds (vite.standalone.js): three's own, except that its
 * WebGPURenderer downloads the WebGL2 backend only once a browser turns out to need it, as the
 * ultra-msdf-threejs gallery's renderer does. three asks for its fallback synchronously, so the
 * backend fetches it before reporting that WebGPU failed.
 */
import { Renderer, StandardNodeLibrary, WebGPUBackend } from 'three/src/Three.WebGPU.js'

export * from 'three/src/Three.WebGPU.js'

let WebGLBackend = null
const loadWebGL = async () => {
	WebGLBackend ??= ( await import( './threeWebGL.js' ) ).WebGLBackend
}

class WebGPUOrLaterWebGLBackend extends WebGPUBackend {
	async init( renderer ) {
		if ( this.parameters.forceWebGL ) {
			await loadWebGL()
			throw new Error( 'WebGL2 was requested' )
		}
		try {
			await super.init( renderer )
		} catch ( error ) {
			// A failed download is reported by the fallback, with this error as its cause.
			await loadWebGL().catch( () => {} )
			throw error
		}
	}
}

export class WebGPURenderer extends Renderer {
	constructor( parameters = {} ) {
		super( new WebGPUOrLaterWebGLBackend( parameters ), {
			...parameters,
			getFallback: error => {
				if ( !WebGLBackend ) throw new Error( 'Unable to load the WebGL2 backend', { cause: error } )
				if ( !parameters.forceWebGL ) console.warn( 'WebGPURenderer: WebGPU is not available, running under WebGL2 backend.' )
				return new WebGLBackend( parameters )
			},
		} )
		this.library = new StandardNodeLibrary()
		this.isWebGPURenderer = true
	}
}
