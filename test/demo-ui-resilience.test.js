import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import Signal from '../demo/src/makio/core/Signal.js'
import { describeDemoFailure, WebGPURequiredError } from '../demo/src/utils/demoFailure.js'

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
	const [app, exampleView, codeButton, venus] = await Promise.all( [
		read( 'demo/src/App.vue' ),
		read( 'demo/src/ExampleView.vue' ),
		read( 'demo/src/components/ui/CodeButton.vue' ),
		read( 'demo/src/components/Venus.vue' ),
	] )

	assert.match( app, /markRaw\( defineAsyncComponent/ )
	assert.match( app, /searchParams\.has\( 'noUI' \)/ )
	assert.match( exampleView, /CodeButton v-if="codeUrl && !hideChrome"/ )
	assert.match( exampleView, /searchParams\.has\( 'noUI' \)/ )
	assert.doesNotMatch( exampleView, /class="bottom"/ )
	assert.match( codeButton, /\.CodeButton-center[\s\S]*?left 50%[\s\S]*?bottom calc\( 18px \+ var\( --saib, 0px \) \)[\s\S]*?transform translateX\( -50% \)/ )
	assert.match( codeButton, /\.CodeButton-source[\s\S]*?bottom calc\( 18px \+ var\( --saib, 0px \) \)[\s\S]*?right calc\( 18px \+ var\( --sair, 0px \) \)/ )
	assert.match( venus, /\.morph-ui[\s\S]*?top calc\( 18px \+ var\( --sait, 0px \) \)[\s\S]*?left 50%[\s\S]*?transform translateX\( -50% \)/ )
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
	const [sandbox, sandboxView, topology] = await Promise.all( [
		read( 'demo/src/demos/sandbox.js' ),
		read( 'demo/src/views/SandboxView.vue' ),
		read( 'demo/src/demos/variableTopology.js' ),
	] )

	assert.match( sandbox, /activePanel: 'preview'/ )
	assert.match( sandbox, /compact && this\.uiState\.activePanel !== 'controls'/ )
	assert.match( sandboxView, /id: 'preview', label: 'Preview'/ )
	assert.match( sandboxView, /id: 'controls', label: 'Controls'/ )
	assert.match( sandboxView, /id: 'code', label: 'Code'/ )
	assert.match( topology, /compact && this\.isCompactGui !== true \) this\.gui\.close\(\)/ )
} )

test( 'Variable Topology sweeps the full join angle range with live telemetry and static orientation', async () => {
	const source = await read( 'demo/src/demos/variableTopology.js' )

	assert.match( source, /const JOIN_ANGLE_MIN = 20/ )
	assert.match( source, /const JOIN_ANGLE_MAX = 165/ )
	assert.match( source, /\.name\( 'Opening \(°\)' \)/ )
	assert.match( source, /\.name\( 'Turn \(°\)' \)/ )
	assert.match( source, /\.name\( 'Miter limit' \)/ )
	assert.match( source, /Opening \$\{opening\}° · Turn \$\{turn\}° · Miter ×\$\{miterScale\.toFixed\( 2 \)\}/ )
	assert.match( source, /side: wireframe \? FrontSide : DoubleSide/ )
	assert.doesNotMatch( source, /joinDirectionPhase/ )
} )

test( 'the shadow showcase keeps debug helpers out of the composition', async () => {
	const source = await read( 'demo/src/demos/shadow.js' )

	assert.doesNotMatch( source, /SpotLightHelper/ )
	assert.match( source, /shadow\.mapSize\.set\( 512, 512 \)/ )
	assert.match( source, /Live cast \+ receive · 3 moving spotlights/ )
	assert.match( source, /this\.hud\?\.remove\(\)/ )
	assert.match( source, /SCULPTURE_RADIUS \/ \( Math\.tan\( halfFov \) \* stage3d\.camera\.aspect \)/ )
} )

test( 'Rice Field keeps per-instance storage mappable to WebGL2 instanced attributes', async () => {
	const source = await read( 'demo/src/demos/ricefield.js' )

	// Plain StorageBufferAttribute reads compile to nothing on the WebGL2 backend,
	// which silently drops every stalk; the instanced variant maps to attributes.
	assert.doesNotMatch( source, /new StorageBufferAttribute\(/ )
	assert.match( source, /new StorageInstancedBufferAttribute\( this\.riceInstances\.length, 2 \)/ )
	assert.match( source, /new StorageInstancedBufferAttribute\( this\.riceInstances\.length, 4 \)/ )
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
