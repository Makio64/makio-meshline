import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )

// A method body, from its signature to the closing brace at its own indent.
const method = ( source, name ) => {
	const from = source.indexOf( `\n\t${name}(` )
	assert.notEqual( from, -1, `${name}() should remain statically inspectable` )
	return source.slice( from, source.indexOf( '\n\t}\n', from ) )
}

// The code from `start` to the next `end`, so a check reads one function or loop.
const slice = ( source, start, end, from = 0 ) => {
	const index = source.indexOf( start, from )
	assert.notEqual( index, -1, `${start.trim()} should remain statically inspectable` )
	return source.slice( index, source.indexOf( end, index ) )
}

const stripComments = code => code.replace( /\/\*[\s\S]*?\*\/|\/\/.*$/gm, '' )

test( 'Style Gallery cells share one reveal hook that reads each line\'s own values', async () => {
	const source = await read( 'demo/src/demos/featureGallery.js' )

	// A hook built per cell gave every cell its own shader, even cells that differ only in colour.
	assert.match( source, /\nconst lineDrawn = uniform\( 0 \)\.onObjectUpdate\( \( \{ object \} \) => object\.userData\.drawn\.value \)/ )
	assert.match( source, /\nconst lineKept = uniform\( 1 \)\.onObjectUpdate\( \( \{ object \} \) => object\.userData\.kept\.value \)/ )
	assert.match( source, /\nconst revealClip = Fn\( \( \[progress\] \) => progress\.greaterThan\( lineDrawn \)\.or\( progress\.lessThan\( lineKept\.oneMinus\(\) \) \) \)/ )
	const cell = method( source, 'createCell' )
	assert.match( cell, /\.discardFn\( revealClip \)/ )
	assert.match( cell, /Object\.assign\( line\.userData, \{ drawn, kept \} \)/ )
	assert.doesNotMatch( cell, /uniform\(|\.discardFn\( Fn\(/ )
} )

test( 'GPU Simplification draws its CPU fallback as one dynamic line it refills', async () => {
	const source = await read( 'demo/src/demos/gpuSimplificationPrototype.js' )
	const rebuild = method( source, 'rebuildFallbackLines' )

	// A line per polyline was 33 draw calls; the batched line is one, and the next dataset reuses its buffers.
	assert.match( rebuild, /if \( this\.fallbackLine \) \{\n\t+this\.fallbackLine\.lines\( lines \)\n\t+return\n\t+\}/ )
	assert.match( rebuild, /this\.fallbackLine = new MeshLine\(\)\n\t+\.lines\( lines \)\n\t+\.dynamic\( true \)/ )
	assert.doesNotMatch( source, /this\.fallbackLines\b/ )
} )

test( 'Isobar Contours upload only what changes', async () => {
	const source = await read( 'demo/src/demos/isobars.js' )
	const setTracks = method( source, 'setTracks' )
	const blend = method( source, 'blendOnCPU' )

	// One sample per stored point: snap reads it instead of blending it with its neighbour.
	assert.match( source, /storagePositions\( this\.from, \{[^}]*\n\t+snap: true,/ )
	// Only the slots in use go to the GPU, not the whole capacity, and both buffers of the morph get them:
	// nothing else re-uploads either one.
	assert.match( setTracks, /for \( const buffer of \[this\.from, this\.to\] \) \{\n\t+buffer\.clearUpdateRanges\(\)\n\t+buffer\.addUpdateRange\( 0, tracks\.length \* POINTS_PER_LINE \* 4 \)\n\t+buffer\.needsUpdate = true/ )
	// WebGL2 blends into arrays made once per set of tracks, and its dynamic line keeps its buffers.
	assert.match( source, /if \( !stage3d\.isWebGPU \) \{\n\t+this\.line\.dynamic\( true \)/ )
	assert.match( setTracks, /this\.blended = tracks\.map\( \(\) => new Float32Array\( LINE_SEGMENTS \* 3 \) \)/ )
	assert.match( blend, /const points = this\.blended\[line\]/ )
	assert.match( blend, /this\.line\.lines\( this\.blended \)/ )
	assert.doesNotMatch( blend, /new Float32Array|\.map\(/ )
	// A state holds after its morph: nothing is blended or uploaded again.
	assert.match( source, /if \( morph !== this\.morph\.value \) this\.setMorph\( morph \)/ )
} )

test( 'Venus compiles its pipelines on a hidden frame before the reveal starts', async () => {
	const init = method( await read( 'demo/src/demos/venus.js' ), 'async init' )
	const steps = [
		'this.createLine( ringsA, ringsB )',
		'createBloomPipeline(',
		'stage3d.render()',
		'await stage3d.renderer.backend.device?.queue.onSubmittedWorkDone()',
		'animate( this.opacity, { value: 1',
	].map( step => init.indexOf( step ) )

	assert.ok( steps.every( ( index, i ) => index !== -1 && ( i === 0 || steps[i - 1] < index ) ), `build, render, wait for the GPU, then fade in: ${steps}` )
} )

test( 'Venus builds its ray-casting BVH with the default split strategy', async () => {
	const rings = await read( 'demo/src/utils/venusContourRings.js' )

	// SAH with one triangle per leaf added 60–95 ms to start-up, for rays cast only while sampling the rings.
	assert.match( rings, /new MeshBVH\( mergeGeometries\( parts \), \{ indirect: true \} \)/ )
	assert.doesNotMatch( stripComments( rings ), /\bSAH\b|targetLeafSize|maxLeafTris/ )
} )

test( 'Verlet Ropes measures links and clamps speed without Math.hypot()', async () => {
	const physics = await read( 'demo/src/utils/verletRopesPhysics.js' )
	const link = stripComments( slice( physics, '\nfunction projectCpuLink(', '\n}\n' ) )
	// The CPU stepper's own step 2, not the WebGPU solver's comment of the same name.
	const stepper = slice( physics, '\nexport function stepRopesCpu(', '\n}\n' )
	const integrate = stripComments( slice( stepper, '// 2. Time-corrected Verlet integration.', '\n\t\t}\n' ) )

	// Both run for every point of every rope each step.
	assert.match( link, /const distance = / )
	assert.match( integrate, /const speed = / )
	assert.doesNotMatch( link + integrate, /Math\.hypot\(/ )
} )

test( 'Joins & Caps draws every specimen with one colour graph', async () => {
	const source = await read( 'demo/src/demos/variableTopology.js' )
	const create = slice( source, '\nconst createSurface = ', '\n}\n' )

	// Each drawn surface supplies its two gradient colours to nodes made once, rather than building its own.
	assert.match( source, /\nconst gradientStart = uniform\( new Color\(\) \)\.onObjectUpdate\( \( \{ object \} \) => object\.userData\.gradient\[0\] \)/ )
	assert.match( source, /\nconst gradientEnd = uniform\( new Color\(\) \)\.onObjectUpdate\( \( \{ object \} \) => object\.userData\.gradient\[1\] \)/ )
	assert.match( create, /surface\.userData\.gradient = \[new Color\( config\.color \), new Color\( config\.gradientColor \)\]/ )
	assert.match( create, /surface\.material\.colorNode = surfaceColor\n\t+surface\.material\.emissiveNode = surfaceEmissive/ )
	assert.doesNotMatch( create, /\b(?:mix|color|uniform|smoothstep)\(/ )
} )

test( 'GPU Path builds its grid from Float32Arrays', async () => {
	const source = await read( 'demo/src/demos/gpuPath.js' )

	// The library takes a Float32Array as it is, and converts a nested array on every build.
	assert.equal( ( source.match( /lines\.push\( straightLineBetween\( /g ) || [] ).length, 2 )
	assert.doesNotMatch( source, /lines\.push\( \[/ )
} )
