import assert from 'node:assert/strict'
import test from 'node:test'

import { MeshLine } from '../src/index.js'

const points = new Float32Array( [
	0, 0, 0,
	1, 0, 0,
	2, 1, 0,
] )

test( 'facade normalizes cap strings and objects', () => {
	const line = new MeshLine( { lines: points, cap: 'round' } ).build()
	assert.deepEqual( line._options.cap, { type: 'round', segments: 8 } )

	line.cap( { type: 'square', segments: 5 } )
	assert.deepEqual( line._options.cap, { type: 'square', segments: 5 } )
	line.dispose()
} )

test( 'facade rejects invalid cap policies before geometry construction', () => {
	assert.throws( () => new MeshLine().cap( 'triangle' ), /unsupported cap type/ )
	assert.throws( () => new MeshLine().cap( { type: 'round', segments: 0 } ), /positive integer/ )
	assert.throws( () => new MeshLine().cap( { type: 'round', segments: 1 } ), /at least 2/ )
} )
