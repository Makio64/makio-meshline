import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )
const readDemo = name => read( `demo/src/demos/${name}.js` )

test( 'fully animated line demos keep fixed topology in reusable dynamic buffers', async () => {
	const [baguettes, waves, points] = await Promise.all( [
		readDemo( 'baguettes' ),
		readDemo( 'waves' ),
		read( 'demo/src/utils/points.js' ),
	] )
	const wavesFrame = waves.slice( waves.indexOf( '\n\tupdate = dt => {' ) )

	for ( const source of [baguettes, waves] ) {
		assert.match( source, /\.lines\([\s\S]*?\)\n\t\t\t\.dynamic\( true \)/ )
		assert.match( source, /\.setPositions\(/ )
	}

	assert.match( baguettes, /positions: new Float32Array\( SEGMENTS \* 3 \)/ )
	assert.match( baguettes, /lineArrays = this\.baguettes\.map\( baguette => baguette\.positions \)/ )
	assert.match( baguettes, /this\.line\.setPositions\( this\.lineArrays \)/ )
	// Each sea row is a Float32Array allocated once: a frame only rewrites its heights.
	assert.match( waves, /this\.rows = times\( LINE_COUNT, row => \{[\s\S]*?return linePoints\( POINTS_PER_LINE,/ )
	assert.match( points, /const points = new Float32Array\( count \* 3 \)/ )
	assert.match( wavesFrame, /row\[i \+ 1\] = waveHeight\( row\[i\], row\[2\], this\.time \)/ )
	assert.match( wavesFrame, /this\.sea\.setPositions\( this\.rows \)/ )
	assert.doesNotMatch( wavesFrame, /new Float32Array|linePoints\(/ )
} )

test( 'Flying Baguettes pairs fake 3D normals and lighting with a live flat-mode toggle', async () => {
	const [baguettes, controls, stage3d] = await Promise.all( [
		readDemo( 'baguettes' ),
		read( 'demo/src/utils/demoControls.js' ),
		read( 'demo/src/makio/three/stage3d.js' ),
	] )

	assert.match( baguettes, /\.fragmentColorFn\(/ )
	assert.match( baguettes, /id: 'lit', label: '3D Lit'/ )
	assert.match( baguettes, /id: 'flat', label: 'Flat'/ )
	assert.match( baguettes, /id: 'normals', label: 'Normals'/ )
	assert.match( baguettes, /this\.shadingModeUniform\.value = mode === 'flat' \? 0 : mode === 'normals' \? 2 : 1/ )
	// The shading pill leaves with the demo: stage3d owns the bar and removes it in clearDemo().
	assert.match( baguettes, /this\.controls = createDemoControls\( \[/ )
	assert.match( controls, /const bar = stage3d\.own\( document\.createElement\( 'div' \) \)/ )
	assert.match( stage3d, /const dispose = resource\.dispose \?\? resource\.destroy \?\? resource\.remove/ )
} )
