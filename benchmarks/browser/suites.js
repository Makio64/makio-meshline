/**
 * End-to-end browser benchmarks: every sample covers the JavaScript call, the
 * renderer's upload and draw submission, and the GPU finishing the frame.
 * The Node benchmarks next to this folder only time the JavaScript part.
 *
 * Run with `pnpm bench:browser` (see run.mjs), or open this page from any
 * static server rooted at the repository.
 */
import { MeshLine } from 'makio-meshline'
import { PerspectiveCamera, REVISION, Scene, WebGPURenderer } from 'three/webgpu'

const query = new URLSearchParams( location.search )
const only = query.get( 'only' )?.split( ',' ) ?? null
const forceWebGL = query.has( 'webgl' )
const out = document.getElementById( 'out' )

const log = text => {
	out.textContent += `${text}\n`
	console.log( `[bench] ${text}` )
}
const median = samples => [...samples].sort( ( a, b ) => a - b )[samples.length >> 1]

//---------------------------------------------------------- RENDERER
// GPU buffer creations and uploaded bytes, counted at the WebGPU device.
const gpu = { buffers: 0, bufferBytes: 0, uploadBytes: 0 }
const resetGpuCounters = () => { gpu.buffers = gpu.bufferBytes = gpu.uploadBytes = 0 }

function countGpuWork( device ) {
	const createBuffer = device.createBuffer.bind( device )
	device.createBuffer = descriptor => {
		gpu.buffers++
		gpu.bufferBytes += descriptor.size
		return createBuffer( descriptor )
	}
	const writeBuffer = device.queue.writeBuffer.bind( device.queue )
	device.queue.writeBuffer = ( buffer, offset, data, start, size ) => {
		const elementBytes = data.BYTES_PER_ELEMENT ?? 1
		gpu.uploadBytes += size !== undefined ? size * elementBytes : data.byteLength - ( start ?? 0 ) * elementBytes
		return writeBuffer( buffer, offset, data, start, size )
	}
}

async function createRenderer() {
	const canvas = document.createElement( 'canvas' )
	canvas.style.cssText = 'position:fixed;right:0;bottom:0;width:256px;height:192px'
	document.body.appendChild( canvas )
	const renderer = new WebGPURenderer( { canvas, antialias: true, forceWebGL } )
	renderer.setPixelRatio( 1 )
	renderer.setSize( 1024, 768, false )
	await renderer.init()
	const device = renderer.backend.device
	if ( device ) countGpuWork( device )
	return renderer
}

// Resolves once the GPU has finished everything submitted so far.
const gpuDone = renderer => renderer.backend.device
	? renderer.backend.device.queue.onSubmittedWorkDone()
	: Promise.resolve( renderer.backend.gl.finish() )

function destroyRenderer( renderer ) {
	renderer.dispose()
	renderer.backend.device?.destroy()
	renderer.domElement.remove()
}

function createView() {
	const scene = new Scene()
	const camera = new PerspectiveCamera( 50, 4 / 3, 0.1, 100 )
	camera.position.z = 6
	return { scene, camera }
}

async function warmUp( renderer, scene, camera, frames = 8 ) {
	for ( let i = 0; i < frames; i++ ) {
		renderer.render( scene, camera )
		await gpuDone( renderer )
	}
}

//---------------------------------------------------------- STARTUP
// First render of many lines: the cost of building their shaders and buffers.
function ringPoints( index, count, points = 64 ) {
	const ring = new Float32Array( points * 3 )
	const x = ( ( index % 20 ) - 9.5 ) * 0.4
	const y = ( Math.floor( index / 20 ) - count / 40 ) * 0.4
	for ( let i = 0; i < points; i++ ) {
		const angle = i / ( points - 1 ) * Math.PI * 2
		ring[i * 3] = x + Math.cos( angle ) * 0.15
		ring[i * 3 + 1] = y + Math.sin( angle ) * 0.15
	}
	return ring
}

const STARTUP_STYLES = {
	plain: line => line,
	styled: line => line.dash( { count: 8, ratio: 0.5 } ).gradientColor( 0xff0088 ),
}

async function benchStartup( lineCount, mode ) {
	const renderer = await createRenderer()
	const { scene, camera } = createView()

	const createStart = performance.now()
	if ( mode === 'batched' ) {
		const rings = []
		for ( let i = 0; i < lineCount; i++ ) rings.push( ringPoints( i, lineCount ) )
		scene.add( new MeshLine().lines( rings ).lineWidth( 0.02 ).build() )
	} else {
		for ( let i = 0; i < lineCount; i++ ) {
			const line = new MeshLine().lines( ringPoints( i, lineCount ) ).lineWidth( 0.02 ).color( 0x4488ff + i * 16 )
			scene.add( STARTUP_STYLES[mode]( line ).build() )
		}
	}
	const createMs = performance.now() - createStart

	const renderStart = performance.now()
	renderer.render( scene, camera )
	const firstRenderMs = performance.now() - renderStart
	await gpuDone( renderer )
	const firstFrameMs = performance.now() - renderStart

	const steady = []
	for ( let i = 0; i < 40; i++ ) {
		const start = performance.now()
		renderer.render( scene, camera )
		steady.push( performance.now() - start )
		await gpuDone( renderer )
	}

	const result = {
		lines: lineCount,
		mode,
		createMs,
		firstRenderMs,
		firstFrameMs,
		perLineMs: firstRenderMs / lineCount,
		steadyRenderMs: median( steady ),
		// Shader graphs three built, against the programs they compiled into.
		shaderGraphs: renderer._nodes?.nodeBuilderCache?.size ?? null,
		programs: renderer._pipelines?.programs?.vertex?.size ?? null,
	}
	destroyRenderer( renderer )
	return result
}

//---------------------------------------------------------- DYNAMIC POSITIONS
// Every point moves each frame: setPositions() plus the upload it causes.
async function benchDynamic( pointCount, mode, frames = 60 ) {
	const renderer = await createRenderer()
	const { scene, camera } = createView()
	const points = new Float32Array( pointCount * 3 )
	const fill = time => {
		for ( let i = 0; i < pointCount; i++ ) {
			const u = i / ( pointCount - 1 )
			points[i * 3] = ( u - 0.5 ) * 7
			points[i * 3 + 1] = Math.sin( u * 60 + time ) * 1.5
		}
	}
	fill( 0 )

	const line = new MeshLine().lines( points ).dynamic( mode === 'storage' ? 'storage' : true ).lineWidth( 0.01 ).setFrustumCulled( false )
	scene.add( line )
	await warmUp( renderer, scene, camera )

	const setMs = [], renderMs = [], frameMs = []
	resetGpuCounters()
	for ( let i = 0; i < frames; i++ ) {
		fill( i * 0.1 )
		const start = performance.now()
		line.setPositions( points )
		const afterSet = performance.now()
		renderer.render( scene, camera )
		const afterRender = performance.now()
		await gpuDone( renderer )
		setMs.push( afterSet - start )
		renderMs.push( afterRender - afterSet )
		frameMs.push( performance.now() - start )
	}

	const result = {
		points: pointCount,
		mode,
		// 'storage' falls back to attributes where storage buffers are missing.
		path: line.positionStorage ? 'storage' : 'attributes',
		setPositionsMs: median( setMs ),
		renderMs: median( renderMs ),
		frameMs: median( frameMs ),
		uploadKB: renderer.backend.device ? gpu.uploadBytes / frames / 1024 : null,
	}
	destroyRenderer( renderer )
	return result
}

//---------------------------------------------------------- GROWING LINE
// One point is appended per frame, either by passing the longer array to
// lines() or by editing a preallocated line and moving its draw range.
async function benchGrowing( pointCount, mode, frames = 60 ) {
	const renderer = await createRenderer()
	const { scene, camera } = createView()
	const capacity = pointCount + frames + 16
	const points = new Float32Array( capacity * 3 )
	for ( let i = 0; i < capacity; i++ ) {
		const u = i / capacity
		points[i * 3] = ( u - 0.5 ) * 7
		points[i * 3 + 1] = Math.sin( u * 60 ) * 1.5
	}

	const line = new MeshLine().dynamic( true ).lineWidth( 0.01 ).setFrustumCulled( false )
	line.lines( mode === 'lines' ? points.subarray( 0, pointCount * 3 ) : points )
	scene.add( line )
	await warmUp( renderer, scene, camera )

	const callMs = [], frameMs = []
	resetGpuCounters()
	for ( let i = 0; i < frames; i++ ) {
		const count = pointCount + i + 1
		const start = performance.now()
		if ( mode === 'lines' ) {
			line.lines( points.subarray( 0, count * 3 ) )
		} else {
			line.setPositionRange( points.subarray( ( count - 1 ) * 3, count * 3 ), count - 1 )
			line.geometry.setDrawRange( 0, ( count - 1 ) * 6 )
		}
		callMs.push( performance.now() - start )
		renderer.render( scene, camera )
		await gpuDone( renderer )
		frameMs.push( performance.now() - start )
	}

	const result = {
		points: pointCount,
		mode,
		callMs: median( callMs ),
		frameMs: median( frameMs ),
		buffersPerFrame: renderer.backend.device ? gpu.buffers / frames : null,
		bufferKBPerFrame: renderer.backend.device ? gpu.bufferBytes / frames / 1024 : null,
		uploadKB: renderer.backend.device ? gpu.uploadBytes / frames / 1024 : null,
	}
	destroyRenderer( renderer )
	return result
}

//---------------------------------------------------------- BENDING SURFACE
// A road whose bends sharpen and relax each frame. Its round joins
// re-tessellate, so the vertex count changes on every update: a static
// surface needs new buffers each time, a dynamic one keeps its own.
async function benchBending( pointCount, mode, frames = 60 ) {
	const renderer = await createRenderer()
	const { scene, camera } = createView()
	camera.position.set( 0, 5, 7 )
	camera.lookAt( 0, 0, 0 )
	const points = new Float32Array( pointCount * 3 )
	const spacing = 7 / ( pointCount - 1 )
	const fill = time => {
		// A zigzag whose corners swing between about 20 and 90 degrees.
		const swing = ( 0.1 + ( Math.sin( time ) * 0.5 + 0.5 ) * 0.4 ) * spacing
		for ( let i = 0; i < pointCount; i++ ) {
			points[i * 3] = ( i - ( pointCount - 1 ) / 2 ) * spacing
			points[i * 3 + 2] = i % 2 ? swing : -swing
		}
	}
	fill( 0 )

	const line = new MeshLine()
		.lines( points )
		.surface( { frame: 'fixed-up' } )
		.join( { type: 'round', segments: 8 } )
		.lineWidth( spacing * 0.5 )
		.dynamic( mode === 'dynamic' )
	scene.add( line )
	await warmUp( renderer, scene, camera )

	const callMs = [], frameMs = []
	let vertices = 0
	resetGpuCounters()
	for ( let i = 0; i < frames; i++ ) {
		fill( i * 0.35 )
		const start = performance.now()
		line.setPositions( points )
		callMs.push( performance.now() - start )
		renderer.render( scene, camera )
		await gpuDone( renderer )
		frameMs.push( performance.now() - start )
		vertices = Math.max( vertices, line.geometry.vertexCount )
	}

	const result = {
		points: pointCount,
		mode,
		vertices,
		callMs: median( callMs ),
		frameMs: median( frameMs ),
		buffersPerFrame: renderer.backend.device ? gpu.buffers / frames : null,
		bufferKBPerFrame: renderer.backend.device ? gpu.bufferBytes / frames / 1024 : null,
	}
	destroyRenderer( renderer )
	return result
}

//---------------------------------------------------------- RUN
const SUITES = {
	startup: {
		cases: [[1, 'plain'], [50, 'plain'], [200, 'plain'], [200, 'styled'], [200, 'batched']],
		run: benchStartup,
	},
	dynamic: {
		cases: [10_000, 50_000, 200_000].flatMap( count => [[count, 'attributes'], [count, 'storage']] ),
		run: benchDynamic,
	},
	growing: {
		cases: [2_000, 20_000].flatMap( count => [[count, 'lines'], [count, 'range']] ),
		run: benchGrowing,
	},
	bending: {
		cases: [1_000, 10_000].flatMap( count => [[count, 'static'], [count, 'dynamic']] ),
		run: benchBending,
	},
}

async function run() {
	const results = { three: REVISION, backend: null, suites: {} }
	const probe = await createRenderer()
	results.backend = probe.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
	destroyRenderer( probe )
	log( `three r${REVISION} · ${results.backend}` )

	for ( const [name, suite] of Object.entries( SUITES ) ) {
		if ( only && !only.includes( name ) ) continue
		results.suites[name] = []
		for ( const args of suite.cases ) {
			const result = await suite.run( ...args )
			results.suites[name].push( result )
			log( `${name} ${JSON.stringify( result, ( key, value ) => typeof value === 'number' ? Number( value.toFixed( 3 ) ) : value )}` )
		}
	}
	log( 'done' )
	return results
}

window.__meshlineBench = run().catch( error => {
	log( `error ${error.stack ?? error}` )
	return { error: String( error.stack ?? error ) }
} )
