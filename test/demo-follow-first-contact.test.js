import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readDemo = () => readFile( new URL( '../demo/src/demos/follow.js', import.meta.url ), 'utf8' )

test( 'Follow animates before interaction and resumes after pointer inactivity', async () => {
	const source = await readDemo()

	assert.match( source, /this\.text = ''/ )
	assert.match( source, /\.dynamic\( true \)/ )
	assert.match( source, /performance\.now\(\) < this\.pointerActiveUntil/ )
	assert.match( source, /this\.pointerActiveUntil = performance\.now\(\) \+ 1800/ )
	assert.match( source, /if \( !pointerActive \) \{\s*this\.target\.set\(/ )
	assert.match( source, /Math\.min\( dt, 100 \) \/ 16\.67/ )
	assert.match( source, /Math\.pow\( line\.friction, frameScale \)/ )
	assert.match( source, /halfWidth \* 0\.72/ )
	assert.match( source, /this\.reducedMotion && !pointerActive/ )
	assert.match( source, /className = 'FollowHint'/ )
	assert.match( source, /position: fixed;/ )
	assert.match( source, /left: calc\(16px/ )
} )
