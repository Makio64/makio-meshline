import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )

test( 'Follow animates before interaction and resumes after pointer inactivity', async () => {
	const [source, exampleView, stage, hint, hud] = await Promise.all( [
		read( 'demo/src/demos/follow.js' ),
		read( 'demo/src/ExampleView.vue' ),
		read( 'demo/src/makio/core/stage.js' ),
		read( 'demo/src/utils/demoHint.js' ),
		read( 'demo/src/utils/demoHud.styl' ),
	] )

	// No instruction text: ExampleView falls back to an empty one.
	assert.doesNotMatch( source, /^\s*(?:this\.)?text = /m )
	assert.match( exampleView, /this\.text = this\.example\.text \|\| ''/ )
	assert.match( source, /\.dynamic\( true \)/ )
	assert.match( source, /performance\.now\(\) < this\.pointerActiveUntil/ )
	assert.match( source, /this\.pointerActiveUntil = performance\.now\(\) \+ 1800/ )
	assert.match( source, /if \( !pointerActive \) \{\s*this\.target\.set\(/ )
	// `stage` caps dt before dispatching, so frame scaling stays bounded after a long frame.
	assert.match( stage, /const MAX_DT = 100\b/ )
	assert.match( stage, /let dt = Math\.min\( now - this\.lastTime, MAX_DT \)/ )
	assert.match( source, /const frameScale = dt \/ 16\.67/ )
	assert.match( source, /Math\.pow\( line\.friction, frameScale \)/ )
	assert.match( source, /halfWidth \* 0\.72/ )
	assert.match( source, /reducedMotion\.matches && !pointerActive/ )
	assert.match( source, /createDemoHint\( `\$\{action\} · speed controls width`, \{ accent: '#76ffb2', hideAfter: 7000 \} \)/ )
	assert.match( hint, /element\.className = 'DemoHint'/ )
	assert.match( hud, /\.DemoHint\n\tposition fixed\n\tleft calc\(18px \+ var\(--sail, 0px\)\)/ )
} )
