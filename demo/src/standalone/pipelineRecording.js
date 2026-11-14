/**
 * First-visit shader compiles from a recorded set of startup pipelines, ported from the
 * ultra-msdf-threejs gallery (demo/pipeline-precompile.ts, native-pipeline-sharing.ts).
 *
 * A cold start waits on the native shader compiler, which on a Mac works through about two
 * functions at once, and sits idle until the app has built its scene. A recording of every
 * pipeline the app creates up to its first complete frame (scripts/capture-pipelines.mjs) lets
 * those compiles start as soon as the device exists. Within a sharing scope, the app's own
 * asynchronous requests identical to a recorded one, compared by shader source and layout
 * contents, join that compile instead of starting another.
 *
 * The recording never decides what renders: the app still requests every pipeline it draws with
 * from its own descriptors. A stale entry only compiles something nothing uses.
 */
import { REVISION } from 'three/webgpu'

/** Device features that change three's WGSL, its layouts or its formats. */
const SHADER_FEATURES = [
	'core-features-and-limits',
	'float32-filterable',
	'subgroups',
	'clip-distances',
	'texture-formats-tier1',
	'depth32float-stencil8',
	'rg11b10ufloat-renderable',
]

/** What a recording depends on beyond its entries: equal on the recording and the playing device. */
export function pipelineFingerprint( device ) {
	return {
		three: REVISION,
		features: SHADER_FEATURES.filter( name => device.features.has( name ) ),
		canvasFormat: navigator.gpu.getPreferredCanvasFormat(),
		maxUniformBufferBindingSize: device.limits.maxUniformBufferBindingSize,
		// three opens fragment shaders with a uniformity diagnostic, except in Firefox.
		uniformityDiagnostic: !/Firefox|Deno/.test( navigator.userAgent ),
	}
}

/** The recording when it was made for this device, else null. A malformed one is never trusted. */
export function recordingForDevice( recording, device ) {
	if ( recording?.version !== 1 || !Array.isArray( recording.shaders ) || !Array.isArray( recording.pipelines ) ) return null
	return JSON.stringify( recording.fingerprint ) === JSON.stringify( pipelineFingerprint( device ) ) ? recording : null
}

//---------------------------------------------------------- SHARING
/** Platform WebGPU objects report their interface name, even in minified code. */
const isWebGPUObject = entry => Object.prototype.toString.call( entry ).startsWith( '[object GPU' )

/** A descriptor's data copied, its WebGPU objects kept: three refills its own for the next request. */
function copyDescriptor( value ) {
	if ( value === null || typeof value !== 'object' || isWebGPUObject( value ) ) return value
	if ( Array.isArray( value ) ) return value.map( copyDescriptor )
	const copy = {}
	for ( const key of Object.keys( value ) ) copy[key] = copyDescriptor( value[key] )
	return copy
}

/**
 * Within the returned scope, an asynchronous pipeline request identical to an earlier one gets
 * the earlier pipeline. Shader modules and layouts are keyed by their source and descriptors, so
 * install it before the app creates any. Returns `{ as(), usage(), close() }`.
 *
 * At most `limit` asynchronous compiles are in flight; the others wait their turn, in order. The
 * compiler works through only a few at once, so a larger burst finishes no sooner: every compile
 * would end near the end, and the loader could only jump from nothing to everything.
 */
export function sharePipelineCompiles( device, { limit = 6 } = {} ) {
	const sources = new WeakMap()
	const layouts = new WeakMap()
	const ids = new WeakMap()
	const sourceIds = new Map()
	const pipelines = new Map()
	const modules = new Map()
	// Who the requests come from: the app unless `as()` says otherwise.
	let origin = 'app'

	// Descriptor data with sorted keys and no labels. Three refills one descriptor instance for
	// every request, so its contents count, never its identity.
	const stableKey = value => {
		const constants = new WeakSet()
		return JSON.stringify( value, function ( key, entry ) {
			// An override constant may itself be named `label`.
			if ( key === 'label' && !constants.has( this ) ) return undefined
			// JSON erases signed zero, which an override can observe.
			if ( constants.has( this ) && Object.is( entry, -0 ) ) return 'override:-0'
			if ( entry === null || typeof entry !== 'object' || Array.isArray( entry ) ) return entry
			const layout = layouts.get( entry )
			if ( layout !== undefined ) return layout
			const source = sources.get( entry )
			if ( source !== undefined ) {
				if ( !sourceIds.has( source ) ) sourceIds.set( source, sourceIds.size )
				return `module:${sourceIds.get( source )}`
			}
			if ( isWebGPUObject( entry ) ) {
				if ( !ids.has( entry ) ) ids.set( entry, `#${ids.size}` )
				return ids.get( entry )
			}
			const sorted = {}
			for ( const name of Object.keys( entry ).sort() ) sorted[name] = entry[name]
			if ( key === 'constants' ) constants.add( sorted )
			return sorted
		} )
	}

	const originals = {
		createShaderModule: device.createShaderModule,
		createBindGroupLayout: device.createBindGroupLayout,
		createPipelineLayout: device.createPipelineLayout,
		createRenderPipelineAsync: device.createRenderPipelineAsync,
		createComputePipelineAsync: device.createComputePipelineAsync,
		createRenderPipeline: device.createRenderPipeline,
		createComputePipeline: device.createComputePipeline,
	}
	const call = ( name, descriptor ) => originals[name].call( device, descriptor )
	const queue = []
	let running = 0
	const next = () => {
		while ( running < limit && queue.length ) {
			const { name, descriptor, done, fail } = queue.shift()
			running++
			call( name, descriptor ).then( done, fail ).finally( () => {
				running--
				next()
			} )
		}
	}
	const asynchronous = name => descriptor => {
		// Keyed and copied before the call returns: three resets its descriptor right after.
		const key = stableKey( descriptor )
		const existing = pipelines.get( key )
		if ( existing ) {
			existing.requesters.add( origin )
			return existing.promise
		}
		const promise = new Promise( ( done, fail ) => queue.push( { name, descriptor: copyDescriptor( descriptor ), done, fail } ) )
		next()
		pipelines.set( key, { promise, requesters: new Set( [origin] ) } )
		return promise
	}
	// A synchronous request must return a pipeline now: Dawn's cache serves a finished repeat.
	const synchronous = name => descriptor => {
		const key = stableKey( descriptor )
		const existing = pipelines.get( key )
		existing?.requesters.add( origin )
		const pipeline = call( name, descriptor )
		if ( !existing ) pipelines.set( key, { promise: Promise.resolve( pipeline ), requesters: new Set( [origin] ) } )
		return pipeline
	}
	const installed = {
		createShaderModule: descriptor => {
			let module = modules.get( descriptor.code )
			if ( !module ) {
				module = call( 'createShaderModule', descriptor )
				modules.set( descriptor.code, module )
				sources.set( module, descriptor.code )
			}
			return module
		},
		createBindGroupLayout: descriptor => {
			const layout = call( 'createBindGroupLayout', descriptor )
			layouts.set( layout, stableKey( descriptor ) )
			return layout
		},
		createPipelineLayout: descriptor => {
			const layout = call( 'createPipelineLayout', descriptor )
			layouts.set( layout, stableKey( descriptor ) )
			return layout
		},
		createRenderPipelineAsync: asynchronous( 'createRenderPipelineAsync' ),
		createComputePipelineAsync: asynchronous( 'createComputePipelineAsync' ),
		createRenderPipeline: synchronous( 'createRenderPipeline' ),
		createComputePipeline: synchronous( 'createComputePipeline' ),
	}
	const own = Object.fromEntries( Object.keys( installed ).map( name => [name, Object.hasOwn( device, name )] ) )
	Object.assign( device, installed )

	return {
		/** Runs `request` with its pipeline requests attributed to `name`. */
		as( name, request ) {
			const previous = origin
			origin = name
			try {
				return request()
			} finally {
				origin = previous
			}
		},
		/** Unique pipelines requested by `name`, by the app, and by both. */
		usage( name ) {
			const count = { [name]: 0, app: 0, both: 0 }
			for ( const { requesters } of pipelines.values() ) {
				if ( requesters.has( name ) ) count[name]++
				if ( requesters.has( 'app' ) ) count.app++
				if ( requesters.has( name ) && requesters.has( 'app' ) ) count.both++
			}
			return count
		},
		/** Puts the device's own methods back. Pipelines already requested still resolve. */
		close() {
			for ( const [name, method] of Object.entries( installed ) ) {
				if ( device[name] !== method ) continue
				if ( own[name] ) device[name] = originals[name]
				else delete device[name]
			}
			// Requests still waiting go out at once.
			limit = Infinity
			next()
			modules.clear()
			sourceIds.clear()
			pipelines.clear()
		},
	}
}

//---------------------------------------------------------- PRECOMPILE
/**
 * Requests every recorded pipeline asynchronously, `concurrency` at a time: first those the app
 * creates synchronously, which would otherwise stall the GPU process, then the rest in recorded
 * order. Validation errors of a stale entry are captured, never reported. Compiled pipelines stay
 * referenced until `release()`, so the native caches serve the app's own requests.
 * `onSettle` is called as each entry compiles or fails. Returns `{ settled, release() }`; `settled`
 * resolves to `{ compiled, failed }` and never rejects.
 */
export function precompileRecording( device, recording, { concurrency = 2, request = issue => issue(), onSettle } = {} ) {
	let retained = []
	const modules = new Map()
	const groupLayouts = new Map()
	const layouts = new Map()
	const module = ( { shader } ) => {
		if ( !modules.has( shader ) ) modules.set( shader, device.createShaderModule( { code: recording.shaders[shader] } ) )
		return modules.get( shader )
	}
	const groupLayout = entry => {
		const key = JSON.stringify( entry )
		if ( !groupLayouts.has( key ) ) groupLayouts.set( key, device.createBindGroupLayout( entry ) )
		return groupLayouts.get( key )
	}
	const layout = recorded => {
		if ( recorded === 'auto' ) return 'auto'
		const key = JSON.stringify( recorded )
		if ( !layouts.has( key ) ) layouts.set( key, device.createPipelineLayout( { bindGroupLayouts: recorded.bindGroupLayouts.map( groupLayout ) } ) )
		return layouts.get( key )
	}
	const stage = recorded => recorded && { ...recorded, module: module( recorded.module ) }

	const compile = async ( { label, descriptor } ) => {
		let pending
		device.pushErrorScope( 'validation' )
		try {
			pending = request( () => descriptor.compute
				? device.createComputePipelineAsync( { ...descriptor, label, layout: layout( descriptor.layout ), compute: stage( descriptor.compute ) } )
				: device.createRenderPipelineAsync( {
					...descriptor,
					label,
					layout: layout( descriptor.layout ),
					vertex: stage( descriptor.vertex ),
					...( descriptor.fragment ? { fragment: stage( descriptor.fragment ) } : {} ),
				} ) )
		} catch {
			return false
		} finally {
			device.popErrorScope().catch( () => {} )
		}
		try {
			const pipeline = await pending
			retained?.push( pipeline )
			return true
		} catch {
			return false
		}
	}

	const order = [...recording.pipelines.filter( entry => entry.sync ), ...recording.pipelines.filter( entry => !entry.sync )]
	let next = 0
	let compiled = 0
	let failed = 0
	const worker = async () => {
		while ( retained && next < order.length ) {
			if ( await compile( order[next++] ) ) compiled++
			else failed++
			if ( retained ) onSettle?.()
		}
	}
	const settled = Promise.all( Array.from( { length: Math.min( concurrency, order.length ) }, worker ) ).then( () => ( { compiled, failed } ) )
	return {
		settled,
		/** Drops the compiled pipelines once the app holds its own; entries still queued are skipped. */
		release() {
			retained = null
			modules.clear()
			groupLayouts.clear()
			layouts.clear()
		},
	}
}
