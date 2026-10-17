const PHASE_COPY = {
	load: {
		eyebrow: 'Demo load failed',
		title: 'This example could not be downloaded',
		summary: 'The gallery could not load this demo module. Check the connection, then reload the page.',
	},
	init: {
		eyebrow: 'Demo setup failed',
		title: 'This example could not start',
		summary: 'The scene or renderer could not initialize on this browser and device.',
	},
	render: {
		eyebrow: 'Demo render failed',
		title: 'This example stopped rendering',
		summary: 'The GPU context or render pipeline reported an error while the scene was running.',
	},
}

const WEBGPU_REQUIRED = {
	eyebrow: 'WebGPU required',
	title: 'This example needs native WebGPU',
	summary: 'It runs its simulation in compute shaders, which the WebGL2 fallback cannot execute.',
}

/**
 * Throw this from a demo's `init()` when it has no WebGL2 path, so the gallery
 * explains the missing capability instead of reporting a generic failure.
 */
export class WebGPURequiredError extends Error {
	constructor( message ) {
		super( message )
		this.name = 'WebGPURequiredError'
	}
}

const messageFrom = error => {
	if ( error instanceof Error ) return error.message
	if ( typeof error === 'string' ) return error
	if ( error?.message ) return String( error.message )
	return 'No additional error details were reported.'
}

const shorten = message => {
	const normalized = message.replace( /\s+/g, ' ' ).trim()
	return normalized.length > 320 ? `${normalized.slice( 0, 317 )}…` : normalized
}

export const describeDemoFailure = ( phase, error, backend = 'uninitialized' ) => {
	const detail = shorten( messageFrom( error ) )
	if ( error?.name === 'WebGPURequiredError' ) {
		return {
			...WEBGPU_REQUIRED,
			detail,
			guidance: [
				'Open it in a current Chrome, Edge, or Safari with WebGPU enabled on supported hardware.',
				'Most other gallery examples still run on WebGL2.',
			],
		}
	}
	const copy = PHASE_COPY[phase] || PHASE_COPY.render
	const renderer = backend === 'webgpu' ? 'WebGPU' : backend === 'webgl2' ? 'WebGL2' : null
	const deviceLimit = /device limit|max(?:imum)?[\s_-]*(?:vertex|storage|buffer|binding)|maxVertexBuffers|too many (?:vertex )?buffers|validation error/i.test( detail )
	const contextLost = /context lost|device lost|gpu process|out of memory/i.test( detail )
	const guidance = []

	if ( deviceLimit ) {
		guidance.push( 'This scene exceeded a GPU limit exposed by the current device. Try an updated browser or GPU driver, or open the demo on another device.' )
	} else if ( contextLost ) {
		guidance.push( 'Reload after closing other GPU-heavy tabs or applications. Persistent context loss can indicate a browser, driver, or memory issue.' )
	} else if ( phase === 'load' ) {
		guidance.push( 'Confirm the connection is online and reload. If the failure persists, clear this site’s cached files or try a current browser.' )
	} else {
		guidance.push( 'Use a current browser with hardware acceleration enabled and an up-to-date GPU driver.' )
	}

	guidance.push( renderer
		? `The gallery selected ${renderer} automatically before the failure.`
		: 'The gallery selects the compatible renderer automatically; initialization did not complete far enough to identify it.' )

	return {
		...copy,
		detail,
		guidance,
	}
}
