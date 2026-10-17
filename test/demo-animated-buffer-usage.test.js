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
