import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readDemo = name => readFile( new URL( `../demo/src/demos/${name}.js`, import.meta.url ), 'utf8' )

test( 'fully animated line demos keep fixed topology in reusable dynamic buffers', async () => {
	const [baguettes, waves] = await Promise.all( [
		readDemo( 'baguettes' ),
		readDemo( 'waves' ),
	] )

	for ( const source of [baguettes, waves] ) {
		assert.match( source, /\.lines\([\s\S]*?\)\n\t\t\t\.dynamic\( true \)/ )
		assert.match( source, /\.setPositions\(/ )
	}

	assert.match( baguettes, /positions: new Float32Array\( SEGMENTS \* 3 \)/ )
	assert.match( baguettes, /this\.lineArrays\.push\( baguette\.positions \)/ )
	assert.match( waves, /if \( !this\.linePositions \)/ )
	assert.match( waves, /new Float32Array\( FLOATS_PER_LINE \)/ )
} )

test( 'Flying Baguettes pairs fake 3D normals and lighting with a live flat-mode toggle', async () => {
	const baguettes = await readDemo( 'baguettes' )

	assert.match( baguettes, /\.fragmentColorFn\(/ )
	assert.match( baguettes, /id: 'lit', label: '3D Lit'/ )
	assert.match( baguettes, /id: 'flat', label: 'Flat'/ )
	assert.match( baguettes, /id: 'normals', label: 'Normals'/ )
	assert.match( baguettes, /this\.shadingModeUniform\.value = mode === 'flat' \? 0 : mode === 'normals' \? 2 : 1/ )
	assert.match( baguettes, /this\.hud\?\.remove\(\)/ )
} )
