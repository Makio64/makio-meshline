/**
 * A standalone app's first frame, sooner, with the startup tricks of the ultra-msdf-threejs gallery.
 *
 * - Shader compaction: the WGSL keeps every instruction and compiles faster (wgslCompact.js).
 * - Recorded pipelines: compiled from the moment the device exists, while the app is still
 *   building its scene, and shared with the app's own identical requests (pipelineRecording.js).
 * - Parallel compiles: until the first complete frame, three creates render pipelines with the
 *   asynchronous API, which compiles them side by side instead of one after another on the GPU
 *   process. A draw waits for its pipeline, so the canvas stays hidden until a frame has every one.
 *
 * Call `installFastStart()` before the renderer exists, then `await firstCompleteFrame( renderer )`
 * once the app has built its scene: it resolves when a complete frame is on the GPU, and the app
 * reveals the canvas then. `onProgress` follows the way there, for the page's loader.
 */
import { WebGPUBackend } from 'three/webgpu'

import { pipelineFingerprint, precompileRecording, recordingForDevice, sharePipelineCompiles } from './pipelineRecording'
import { compactShaders } from './wgslCompact'

const state = {
	installed: false,
	recording: null,
	scope: null,
	precompile: null,
	pending: [],
	requested: 0,
	created: new Set(),
	// Puts three's synchronous render pipelines back.
	restore: null,
	// Progress: the device, the scene, and the pipelines compiled, recorded and the app's own.
	onProgress: null,
	device: false,
	scene: false,
	recorded: 0,
	recordedDone: 0,
	appDone: 0,
	progress: 0,
}

// Where the loader stands once the device exists, and once the scene is built: the rest is compiling.
const DEVICE_PROGRESS = 0.08
const SCENE_PROGRESS = 0.16

function report() {
	if ( !state.onProgress ) return
	let compiled = state.recorded ? state.recordedDone / state.recorded : 0
	// Before the scene is built, the app has asked for only part of its pipelines.
	if ( state.scene && state.requested ) compiled = Math.max( compiled, state.appDone / state.requested )
	const floor = state.scene ? SCENE_PROGRESS : state.device ? DEVICE_PROGRESS : 0
	// Never back, and never done before the first complete frame is.
	state.progress = Math.max( state.progress, Math.min( 0.99, Math.max( floor, DEVICE_PROGRESS + compiled * ( 1 - DEVICE_PROGRESS ) ) ) )
	state.onProgress( state.progress )
}

/**
 * `recording` is the URL of the app's pipeline recording (scripts/capture-pipelines.mjs), if it
 * has one. A capture run (`globalThis.__pipelineCapture`) skips it, so that it records only the app.
 */
export function installFastStart( { recording, onProgress } = {} ) {
	if ( state.installed || typeof navigator === 'undefined' ) return
	state.installed = true
	state.onProgress = onProgress ?? null
	const capturing = globalThis.__pipelineCapture !== undefined
	state.recording = recording && !capturing && navigator.gpu
		? fetch( recording ).then( response => response.ok ? response.json() : null ).catch( () => null )
		: Promise.resolve( null )

	// Kept for good: the WGSL must not change between startup and later pipelines.
	compactShaders()

	// The first device the page asks for: three's, inside renderer.init().
	if ( globalThis.GPUAdapter ) {
		const prototype = GPUAdapter.prototype
		const requestDevice = prototype.requestDevice
		prototype.requestDevice = async function ( ...args ) {
			prototype.requestDevice = requestDevice
			const device = await requestDevice.apply( this, args )
			onDevice( device )
			return device
		}
	}

	// Until the first complete frame, render pipelines compile side by side.
	const prototype = WebGPUBackend.prototype
	const createRenderPipeline = prototype.createRenderPipeline
	prototype.createRenderPipeline = function ( renderObject, promises ) {
		if ( promises ) return createRenderPipeline.call( this, renderObject, promises )
		const started = []
		createRenderPipeline.call( this, renderObject, started )
		state.pending.push( ...started )
		state.requested++
		for ( const compiled of started ) {
			compiled.then( () => {
				state.appDone++
				report()
			} )
		}
		state.created.add( renderObject.pipeline )
	}
	state.restore = () => { prototype.createRenderPipeline = createRenderPipeline }
}

function onDevice( device ) {
	// What a recording made now will be played on.
	if ( globalThis.__pipelineCapture ) globalThis.__pipelineCapture.fingerprint = pipelineFingerprint( device )
	state.scope = sharePipelineCompiles( device )
	state.device = true
	report()
	state.recording.then( recording => {
		const usable = recordingForDevice( recording, device )
		if ( !usable || !state.scope ) return
		const { scope } = state
		state.recorded = usable.pipelines.length
		state.precompile = precompileRecording( device, usable, {
			request: issue => scope.as( 'recording', issue ),
			onSettle: () => {
				state.recordedDone++
				report()
			},
		} )
	} )
}

const nextFrame = () => new Promise( done => requestAnimationFrame( done ) )

/**
 * Resolves once the renderer has drawn a frame with every pipeline it asked for and the GPU has
 * finished it; rejects when one failed to compile. From then on, pipelines are created as three
 * creates them, and the recording is let go.
 */
export async function firstCompleteFrame( renderer ) {
	const backend = renderer.backend
	state.scene = true
	report()
	try {
		if ( backend.isWebGPUBackend ) {
			for ( ;; ) {
				const requested = state.requested
				await Promise.all( state.pending.splice( 0 ) )
				// Two frames: at least one renders whole after the wait, and may ask for more.
				await nextFrame()
				await nextFrame()
				if ( state.requested === requested && state.pending.length === 0 ) break
			}
			for ( const pipeline of state.created ) {
				if ( backend.get( pipeline ).error ) throw new Error( 'A render pipeline failed to compile.' )
			}
			await backend.device.queue.onSubmittedWorkDone()
		} else {
			await nextFrame()
			await nextFrame()
		}
	} finally {
		finish()
	}
}

function finish() {
	state.restore?.()
	state.restore = null
	const usage = state.scope?.usage( 'recording' )
	if ( import.meta.env.DEV && usage && usage.recording > usage.both ) {
		console.warn( `[fast start] ${usage.recording - usage.both} of ${usage.recording} recorded pipelines went unused: record them again (scripts/capture-pipelines.mjs)` )
	}
	globalThis.__fastStart = { pipelines: state.requested, ...usage }
	state.onProgress = null
	state.precompile?.release()
	state.scope?.close()
	state.scope = null
	state.precompile = null
	state.created.clear()
}
