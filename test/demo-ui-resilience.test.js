import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { SpotLight } from 'three'

import Signal from '../demo/src/makio/core/Signal.js'
import { describeDemoFailure, WebGPURequiredError } from '../demo/src/utils/demoFailure.js'
import { clampSimplify, MAX_SIMPLIFY, resolveSimplify } from '../demo/src/utils/gpuPathQuery.js'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )

test( 'demo failures turn GPU limits into actionable device guidance', () => {
	const failure = describeDemoFailure(
		'render',
		new Error( 'Validation error: maxVertexBuffers limit is 8' ),
		'webgpu',
	)

	assert.equal( failure.eyebrow, 'Demo render failed' )
	assert.match( failure.guidance[0], /GPU limit/ )
	assert.match( failure.guidance[0], /updated browser or GPU driver/ )
	assert.match( failure.guidance[1], /selected WebGPU automatically/ )
} )

test( 'WebGPU-only demos explain the missing capability instead of a generic failure', () => {
	const failure = describeDemoFailure( 'init', new WebGPURequiredError( 'Needs compute shaders.' ), 'webgl2' )

	assert.equal( failure.eyebrow, 'WebGPU required' )
	assert.match( failure.title, /needs native WebGPU/ )
	assert.equal( failure.detail, 'Needs compute shaders.' )
	assert.match( failure.guidance[1], /still run on WebGL2/ )
} )

test( 'ExampleView exposes recovery actions and watches runtime GPU failures', async () => {
	const source = await read( 'demo/src/ExampleView.vue' )

	assert.match( source, /Reload demo/ )
	assert.match( source, /Browse examples/ )
	assert.match( source, /uncapturederror/ )
	assert.match( source, /webglcontextlost/ )
	assert.match( source, /unhandledrejection/ )
} )

test( 'embedded demos hide navigation chrome and keep async components raw', async () => {
	const [app, exampleView, codeButton, venus, hud] = await Promise.all( [
		read( 'demo/src/App.vue' ),
		read( 'demo/src/ExampleView.vue' ),
		read( 'demo/src/components/ui/CodeButton.vue' ),
		read( 'demo/src/components/Venus.vue' ),
		read( 'demo/src/utils/demoHud.styl' ),
	] )

	assert.match( app, /markRaw\( defineAsyncComponent/ )
	assert.match( app, /searchParams\.has\( 'noUI' \)/ )
	assert.match( exampleView, /CodeButton v-if="codeUrl && !hideChrome"/ )
	assert.match( exampleView, /searchParams\.has\( 'noUI' \)/ )
	assert.doesNotMatch( exampleView, /class="bottom"/ )
	assert.match( codeButton, /\.CodeButton-center[\s\S]*?left 50%[\s\S]*?bottom calc\( 18px \+ var\( --saib, 0px \) \)[\s\S]*?transform translateX\( -50% \)/ )
	assert.match( codeButton, /\.CodeButton-source[\s\S]*?bottom calc\( 18px \+ var\( --saib, 0px \) \)[\s\S]*?right calc\( 18px \+ var\( --sair, 0px \) \)/ )
	// The morph pill stays at the top center, and is a plain Vue pill so `?noUI` embeds keep it.
	assert.match( venus, /class="DemoControls"/ )
	assert.match( venus, /import '@\/utils\/demoHud\.styl'/ )
	assert.doesNotMatch( venus, /v-if=|v-show=/ )
	assert.match( hud, /\.DemoControls\n\tposition fixed\n\ttop calc\(18px \+ var\(--sait, 0px\)\)\n\tleft 50%\n\ttransform translateX\(-50%\)/ )
} )

test( 'demo rendering caps pixel density and keeps the inspector opt-in', async () => {
	const [stage, stage3d] = await Promise.all( [
		read( 'demo/src/makio/core/stage.js' ),
		read( 'demo/src/makio/three/stage3d.js' ),
	] )

	assert.match( stage, /Math\.min\( ratio, compact \? 1\.5 : 2 \)/ )
	assert.match( stage3d, /new URLSearchParams\( window\.location\.search \)\.has\( 'inspector' \)/ )
	assert.doesNotMatch( stage3d, /^import \{ Inspector \}/m )
} )

test( 'compact demos preserve the canvas until a panel is requested', async () => {
	const [sandbox, sandboxView, topology, compute, computeUi] = await Promise.all( [
		read( 'demo/src/demos/sandbox.js' ),
		read( 'demo/src/views/SandboxView.vue' ),
		read( 'demo/src/demos/variableTopology.js' ),
		read( 'demo/src/demos/meshlineCompute.js' ),
		read( 'demo/src/components/MeshlineCompute.vue' ),
	] )

	assert.doesNotMatch( sandbox, /lil-gui/ )
	assert.doesNotMatch( compute, /lil-gui/ )
	assert.match( sandbox, /activePanel: 'preview'/ )
	assert.match( sandbox, /compact && this\.uiState\.activePanel !== 'controls'/ )
	assert.match( sandboxView, /id: 'preview', label: 'Preview'/ )
	assert.match( sandboxView, /id: 'controls', label: 'Controls'/ )
	assert.match( sandboxView, /id: 'code', label: 'Code'/ )
	assert.match( sandboxView, /class="SandboxControls"/ )
	assert.match( topology, /compact && !this\.isCompactGui \) this\.params\.open = false/ )
	assert.match( compute, /uiComponent = markRaw\( MeshlineCompute \)/ )
	assert.match( compute, /compact && !this\.isCompactGui \) this\.params\.open = false/ )
	assert.match( computeUi, /class="MeshlineComputeGui"/ )
} )

test( 'Variable Topology sweeps the full join angle range with live telemetry and static orientation', async () => {
	const [source, ui, surfaceMaterial] = await Promise.all( [
		read( 'demo/src/demos/variableTopology.js' ),
		read( 'demo/src/components/VariableTopology.vue' ),
		read( 'src/MeshLineSurfaceNodeMaterial.js' ),
	] )

	assert.doesNotMatch( source, /lil-gui/ )
	assert.match( source, /uiComponent = markRaw\( VariableTopology \)/ )
	assert.match( source, /const JOIN_ANGLE_MIN = 20/ )
	assert.match( source, /const JOIN_ANGLE_MAX = 165/ )
	assert.match( ui, /\.VariableTopologyGui[\s\S]*?position fixed\n\ttop calc\(18px \+ var\(--sait, 0px\)\)\n\tleft calc\(18px \+ var\(--sail, 0px\)\)/ )
	assert.match( ui, /label: 'Opening \(°\)'/ )
	assert.match( ui, /label: 'Turn \(°\)'/ )
	assert.match( ui, /label: 'Miter limit'/ )
	assert.doesNotMatch( ui, /Orientation|Motion speed/ )
	assert.match( source, /Opening \$\{opening\}° · Turn \$\{turn\}° · Miter ×\$\{miterScale\.toFixed\( 2 \)\}/ )
	// The mirror sees the ribbon's underside; the wire stays on the single-sided surface default.
	assert.match( source, /surfaceLine\( points, config, \{ side: DoubleSide, roughness: 0\.68, metalness: 0\.08 \} \)/ )
	assert.match( source, /surfaceLine\( points, config, \{ roughness: 1 \} \)/ )
	assert.match( surfaceMaterial, /this\.side = surface\.side \?\? FrontSide/ )
	assert.match( source, /wire\.material\.forceSinglePass = true/ )
	assert.doesNotMatch( source, /joinDirectionPhase/ )
} )

test( 'the shadow showcase keeps debug helpers out of the composition', async () => {
	const [source, hint] = await Promise.all( [
		read( 'demo/src/demos/shadow.js' ),
		read( 'demo/src/utils/demoHint.js' ),
	] )

	assert.doesNotMatch( source, /SpotLightHelper/ )
	// Three lights at 512: the demo leaves the map size at three's default.
	assert.doesNotMatch( source, /shadow\.mapSize/ )
	assert.deepEqual( new SpotLight().shadow.mapSize.toArray(), [512, 512] )
	assert.doesNotMatch( source, /createDemoHint/ )
	assert.match( hint, /const element = stage3d\.own\( document\.createElement\( 'div' \) \)/ )
	assert.match( source, /SCULPTURE_RADIUS \/ \( Math\.tan\( halfFov \) \* stage3d\.camera\.aspect \)/ )
} )

test( 'Rice Field keeps per-instance storage mappable to WebGL2 instanced attributes', async () => {
	const source = await read( 'demo/src/demos/ricefield.js' )

	// Plain StorageBufferAttribute reads compile to nothing on the WebGL2 backend,
	// which silently drops every stalk; the instanced variant maps to attributes.
	assert.doesNotMatch( source, /new StorageBufferAttribute\(/ )
	assert.match( source, /new StorageInstancedBufferAttribute\( stalks\.length, 2 \)/ )
	assert.match( source, /new StorageInstancedBufferAttribute\( stalks\.length, 4 \)/ )
} )

test( 'GPU Path exposes a continuous 0..99% simplification slider with strictly decreasing segment counts', async () => {
	const [source, query, controls, hud] = await Promise.all( [
		read( 'demo/src/demos/gpuPath.js' ),
		read( 'demo/src/utils/gpuPathQuery.js' ),
		read( 'demo/src/utils/demoControls.js' ),
		read( 'demo/src/utils/demoHud.styl' ),
	] )

	assert.match( source, /id: 'simplify'/ )
	assert.match( source, /min: 0,\s+max: MAX_SIMPLIFY,\s+step: 1/ )
	assert.match( source, /onInput: value => this\.setSimplify\( value \)/ )
	assert.match( source, /onChange: value => writeSimplify\( clampSimplify\( value \) \)/ )
	assert.match( query, /stopImmediatePropagation/ )
	assert.match( controls, /wrap\.className = 'DemoControls__slider'/ )
	assert.match( controls, /dragstart/ )
	assert.match( hud, /touch-action pan-x/ )
	assert.match( hud, /&__slider[\s\S]*?input\[type='range'\]::-webkit-slider-runnable-track/ )
	assert.equal( clampSimplify( null ), 99 )
	assert.equal( clampSimplify( '90' ), 90 )
	assert.equal( clampSimplify( '0' ), 0 )
	assert.deepEqual( resolveSimplify( 0 ), { simplify: 0, tolerance: 0, segments: 199_999 } )
	assert.deepEqual( resolveSimplify( 90 ), { simplify: 90, tolerance: 0.000023, segments: 19_983 } )
	assert.deepEqual( resolveSimplify( 99 ), { simplify: 99, tolerance: 0.012, segments: 1_646 } )

	for ( let pct = 1; pct <= MAX_SIMPLIFY; pct++ ) {
		const prev = resolveSimplify( pct - 1 )
		const curr = resolveSimplify( pct )
		assert.ok( curr.tolerance > prev.tolerance, `tolerance at ${pct}% must exceed ${pct - 1}%` )
		assert.ok( curr.segments < prev.segments, `segments at ${pct}% must be fewer than at ${pct - 1}%` )
	}
} )

test( 'Signal isolates pooled listener nodes across signals and during dispatch removal', () => {
	const onDown = new Signal()
	const onUp = new Signal()
	const onLeave = new Signal()
	const onUpdate = new Signal()

	const sharedUpHandler = () => {}
	onUp.add( sharedUpHandler )
	onLeave.add( sharedUpHandler )
	onUp.remove( sharedUpHandler )
	onLeave.remove( sharedUpHandler )

	const calls = []
	const downHandler = ( mouseData ) => calls.push( ['down', mouseData.normalizedX] )
	const updateHandler = ( dt ) => calls.push( ['update', dt] )
	onDown.add( downHandler )
	onUpdate.add( updateHandler )

	// A recycled node from onLeave must not stay linked in onLeave's list and
	// accidentally invoke onDown/onUpdate handlers without arguments.
	onLeave.dispatch()
	assert.deepEqual( calls, [] )

	onDown.dispatch( { normalizedX: 0.25 } )
	onUpdate.dispatch( 16 )
	assert.deepEqual( calls, [['down', 0.25], ['update', 16]] )

	const order = []
	const first = () => {
		order.push( 'first' )
		onUpdate.remove( second )
	}
	const second = () => order.push( 'second' )
	const third = () => order.push( 'third' )
	onUpdate.removeAll()
	onUpdate.add( first )
	onUpdate.add( second )
	onUpdate.add( third )
	onUpdate.dispatch( 16 )
	assert.deepEqual( order, ['first', 'third'] )
} )
