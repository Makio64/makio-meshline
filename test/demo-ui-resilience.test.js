import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
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

test( 'Rice Field grows each new village into the lines of the one before', async () => {
	const [source, village] = await Promise.all( [
		read( 'demo/src/demos/ricefield.js' ),
		read( 'demo/src/utils/ricefieldVillage.js' ),
	] )
	const section = ( start, end ) => {
		const from = village.indexOf( start )
		assert.notEqual( from, -1, `${start} should remain statically inspectable` )
		return village.slice( from, village.indexOf( end, from ) )
	}
	const grow = section( '\n\tgrow() {', '\n\tdispose() {' )
	const surfaces = section( '\nclass Surfaces {', '\n}\n' )
	const strokes = section( '\nclass Strokes {', '\n}\n' )

	// Disposing the village and building its lines again compiled about 30 pipelines per press.
	assert.match( source, /newVillage = \(\) => this\.village\.grow\(\)/ )
	assert.match( grow, /batch\.clear\(\)/ )
	assert.match( grow, /batch\.update\( this, looks\[name\] \)/ )
	assert.doesNotMatch( grow, /dispose\(|new MeshLine\(|createSmoke\(/ )
	assert.match( surfaces, /if \( this\.line \) this\.line\.lines\( this\.lines, this\.closed \)/ )
	assert.match( strokes, /if \( this\.line \) this\.line\.lines\( this\.lines \)\.vertexColors\( new Float32Array\( this\.colors \) \)/ )
	assert.match( grow, /smoke\.lines\( vents\.map\(/ )
	// The refill reads only what this village added: clear() empties every list, and strokes stay
	// Float32Arrays, which the library takes without copying them on every lines() call.
	assert.match( surfaces, /for \( const list of \[this\.lines, this\.closed, this\.widths, this\.banks, this\.tapers\] \) list\.length = 0/ )
	assert.match( strokes, /for \( const list of \[this\.lines, this\.widths, this\.colors\] \) list\.length = 0/ )
	assert.match( strokes, /this\.lines\.push\( new Float32Array\( points\.flat\(\) \) \)/ )
	// The next village may have no wall of a look, or no chimney: what the one before drew has to go.
	assert.match( surfaces, /if \( this\.line \) this\.line\.visible = this\.lines\.length > 0/ )
	assert.match( grow, /smoke\.visible = vents\.length > 0/ )
	// A dynamic line keeps its buffers when the next village has another point count.
	for ( const code of [surfaces, strokes, section( '\nfunction createSmoke() {', '\n}\n' )] ) {
		assert.match( code, /new MeshLine\(\)\n(?:\t+(?:\/\/.*|\.\w+\(.*\))\n)*\t+\.dynamic\( true \)/ )
	}
} )

test( 'the Playground updates its line in place and builds a new one only for a shader-graph option', async () => {
	const sandbox = await read( 'demo/src/demos/sandbox.js' )
	const method = name => {
		const start = sandbox.indexOf( `\n\t${name}(` )
		assert.notEqual( start, -1, `${name} should remain statically inspectable` )
		return sandbox.slice( start, sandbox.indexOf( '\n\t}\n', start ) )
	}

	// [^\]]* also reads a list written one key per line.
	const keys = name => {
		const list = sandbox.match( new RegExp( `const ${name} = \\[([^\\]]*)\\]` ) )
		assert.ok( list, `${name} should remain statically inspectable` )
		return list[1].match( /'\w+'/g ).map( key => key.slice( 1, -1 ) )
	}
	const [shape, rebuild, live, smoothing] = ['SHAPE_KEYS', 'REBUILD_KEYS', 'LIVE_KEYS', 'SMOOTHING_KEYS'].map( keys )

	// Each option reaches the line one way, and only a shader-graph option builds a new line,
	// which costs new buffers, shader modules and a pipeline.
	assert.equal( new Set( [...shape, ...rebuild, ...live, ...smoothing] ).size, shape.length + rebuild.length + live.length + smoothing.length )
	for ( const key of ['lineType', 'segments', 'closed'] ) assert.ok( shape.includes( key ), key )
	for ( const key of ['smoothSharpBends', 'smoothSharpBendsAlpha', 'smoothSharpBendsThreshold'] ) assert.ok( smoothing.includes( key ), key )
	for ( const key of ['useGradient', 'useDashes', 'sizeAttenuation', 'joinType', 'joinFold', 'antialias'] ) assert.ok( rebuild.includes( key ), key )
	// Animate is live too: the generated code shows its animate() block only once the toggle refreshes it.
	for ( const key of ['color', 'lineWidth', 'opacity', 'gradientColor', 'dashCount', 'dashRatio', 'dashOffset', 'animateDashes', 'wireframe', 'miterLimit'] ) assert.ok( live.includes( key ), key )
	assert.match( sandbox, /onChange\( SHAPE_KEYS, \(\) => this\.updateShape\(\) \)/ )
	assert.match( sandbox, /onChange\( REBUILD_KEYS, \(\) => this\.createLine\(\) \)/ )
	assert.match( sandbox, /onChange\( LIVE_KEYS, \(\) => this\.updateMaterial\(\) \)/ )
	assert.match( sandbox, /onChange\( SMOOTHING_KEYS, \(\) => this\.updateSmoothing\(\) \)/ )

	const create = method( 'createLine' )
	assert.match( create, /\.dynamic\( true \)/ )
	assert.match( create, /this\.smoothing = \{ enabled: config\.smoothSharpBends, alpha: config\.smoothSharpBendsAlpha, threshold: config\.smoothSharpBendsThreshold \}/ )
	assert.match( create, /\.smoothSharpBends\( config\.smoothSharpBends \)\n\t+\.smoothSharpBendsAlpha\( config\.smoothSharpBendsAlpha \)\n\t+\.smoothSharpBendsThreshold\( config\.smoothSharpBendsThreshold \)/ )
	// Snake and Zigzag ignore segments and Strong Angle rounds it: a step that gives the same points sends nothing,
	// while the code is still regenerated, since Strong Angle and Helix print segments.
	assert.match( create, /this\.points = LINE_POSITIONS\[config\.lineType\]\( config\.segments \)\n\t+this\.line = new MeshLine\(\)\n\t+\.lines\( this\.points, config\.closed \)/ )
	assert.match( method( 'updateShape' ), /const same = config\.closed === this\.closed && points\.length === this\.points\.length && points\.every\( \( value, i \) => value === this\.points\[i\] \)\n\t+if \( !same \) \{\n\t+this\.points = points\n(?:\t+\/\/.*\n)?\t+if \( config\.closed === this\.closed \) line\.setPositions\( points, true \)\n\t+else line\.lines\( points, this\.closed = config\.closed \)\n\t+\}\n\n\t+config\.generatedCode = generateSandboxCode\( config \)/ )
	// Watchers run in the order their keys change: the rebuild key first builds the new shape once, into the new
	// line, rather than into the old line about to be disposed; smoothing last, rather than on the old shape.
	const configure = method( 'configureLineType' )
	const steps = ['useGradient = true', 'lineType = value', 'closed = ', 'smoothSharpBends = true'].map( step => configure.indexOf( `this.config.${step}` ) )
	const [gradient, lineType, closed, smoothBends] = steps
	assert.ok( steps.every( index => index !== -1 ), 'configureLineType() should remain statically inspectable' )
	assert.ok( gradient < Math.min( lineType, closed ) && smoothBends > Math.max( lineType, closed ), `gradient, shape, then smoothing: ${steps}` )
	// stage recomputes its capped pixel ratio on resize, and only createLine() gave it to the line.
	assert.match( sandbox, /onResize = \(\) => \{\n\t+this\.syncUiLayout\(\)\n(?:\t+\/\/.*\n)?\t+this\.line\.dpr\( stage\.devicePixelRatio \)\n\t\}/ )

	// Each smoothing setter splits the points again, even with smoothing off: one call per value that differs
	// from what the line holds, the two values only while smoothing is on, and none on a colour change.
	const smooth = method( 'updateSmoothing' )
	assert.equal( smooth.match( /line\.smoothSharpBends\w*\(/g ).length, 3 )
	assert.match( smooth, /if \( config\.smoothSharpBends && config\.smoothSharpBendsAlpha !== smoothing\.alpha \) line\.smoothSharpBendsAlpha\( smoothing\.alpha = config\.smoothSharpBendsAlpha \)/ )
	assert.match( smooth, /if \( config\.smoothSharpBends && config\.smoothSharpBendsThreshold !== smoothing\.threshold \) line\.smoothSharpBendsThreshold\( smoothing\.threshold = config\.smoothSharpBendsThreshold \)/ )
	assert.match( smooth, /if \( config\.smoothSharpBends !== smoothing\.enabled \) line\.smoothSharpBends\( smoothing\.enabled = config\.smoothSharpBends \)/ )
	assert.doesNotMatch( method( 'updateMaterial' ), /smoothSharpBends/ )
	for ( const name of ['updateMaterial', 'updateShape', 'updateSmoothing'] ) assert.match( method( name ), /config\.generatedCode = generateSandboxCode\( config \)/ )
} )

test( 'a silent URL write never reaches a navigate listener added after its guard', async () => {
	const [main, query, saves] = await Promise.all( [
		read( 'demo/src/main.js' ),
		read( 'demo/src/utils/gpuPathQuery.js' ),
		read( 'demo/src/utils/surfaceRoadSaves.js' ),
	] )

	// The router re-mounts the demo for every URL it hears of, and navigate listeners run in
	// the order they were added: the guard has to be imported first, and every write of a
	// query or hash has to go through it.
	const guardImport = main.indexOf( "'@/utils/silentUrl'" )
	assert.ok( guardImport !== -1 && guardImport < main.indexOf( "'vue-tiny-router'" ) )
	for ( const source of [query, saves] ) assert.match( source, /replaceUrlSilently\( / )
	const writers = []
	for ( const file of await readdir( new URL( '../demo/src/', import.meta.url ), { recursive: true } ) ) {
		if ( !/\.(js|vue)$/.test( file ) || file.endsWith( 'silentUrl.js' ) ) continue
		const code = ( await read( `demo/src/${file}` ) ).replace( /\/\*[\s\S]*?\*\/|\/\/.*$/gm, '' )
		if ( /history\.(replace|push)State\(|location\.(hash|search)\s*=(?!=)/.test( code ) ) writers.push( file )
	}
	assert.deepEqual( writers, [], 'only silentUrl.js writes the query or hash of the address' )

	const navigation = new EventTarget()
	const written = []
	globalThis.navigation = navigation
	globalThis.window = {
		history: {
			replaceState( state, title, url ) {
				// As in the browser: a cancelled navigation leaves the address as it was.
				if ( navigation.dispatchEvent( new Event( 'navigate', { cancelable: true } ) ) ) written.push( String( url ) )
			},
		},
	}
	try {
		const { replaceUrlSilently } = await import( '../demo/src/utils/silentUrl.js?guard' )
		let heard = 0
		navigation.addEventListener( 'navigate', () => heard++ )

		replaceUrlSilently( '/examples/gpu-path?wireframe=1' )
		assert.deepEqual( written, ['/examples/gpu-path?wireframe=1'] )
		assert.equal( heard, 0, 'the router must not hear of a silent write' )

		navigation.dispatchEvent( new Event( 'navigate' ) )
		assert.equal( heard, 1, 'every other navigation still reaches it' )
	} finally {
		delete globalThis.navigation
		delete globalThis.window
	}
} )

test( 'GPU Path exposes a continuous 0..99% simplification slider with strictly decreasing segment counts', async () => {
	const [source, controls, hud] = await Promise.all( [
		read( 'demo/src/demos/gpuPath.js' ),
		read( 'demo/src/utils/demoControls.js' ),
		read( 'demo/src/utils/demoHud.styl' ),
	] )

	assert.match( source, /id: 'simplify'/ )
	assert.match( source, /min: 0,\s+max: MAX_SIMPLIFY,\s+step: 1/ )
	assert.match( source, /onInput: value => this\.setSimplify\( value \)/ )
	assert.match( source, /onChange: value => writeSimplify\( clampSimplify\( value \) \)/ )
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
