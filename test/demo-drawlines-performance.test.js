import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readDemo = () => readFile( new URL( '../demo/src/demos/drawlines.js', import.meta.url ), 'utf8' )

test( 'Draw Lines keeps inactive capacity out of its animation hot path', async () => {
	const source = await readDemo()
	const update = source.match( /\n\tupdate = \( dt \) => \{([\s\S]*?)\n\t\}\n\n\tupdateWidthArray/ )?.[1]

	assert.ok( update, 'update loop should remain statically inspectable' )
	assert.match( source, /const NUM_LINES = 1000/ )
	assert.match( source, /createPreviewPath\(\)/ )
	assert.match( source, /lineIndex < LINES_FOLLOWING_MOUSE && !this\.hasInteracted/ )
	assert.match( source, /this\.seedPointerFollowers\(\)/ )
	assert.match( source, /\.dynamic\( true \)/ )
	assert.match( update, /i < this\.activeLineCount/ )
	assert.match( update, /\.setPositionRange\( line\.positions, 0, line\.positionRangeOptions \)/ )
	assert.match( update, /\.setVertexValues\( 'width', this\.activeWidthValues, 0 \)/ )
	assert.doesNotMatch( update, /i < NUM_LINES/ )
	assert.doesNotMatch( update, /\.setPositions\(/ )
} )

test( 'Draw Lines exposes a top-middle cleanup button and top-left hint that reset drawn strokes without starting a stroke', async () => {
	const source = await readDemo()

	assert.match( source, /\.DrawLinesHud \{[\s\S]*?top: calc\(18px \+ var\(--sait, 0px\)\);[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/ )
	assert.match( source, /\.DrawLinesHint \{[\s\S]*?top: calc\(18px \+ var\(--sait, 0px\)\);[\s\S]*?left: calc\(18px \+ var\(--sail, 0px\)\);/ )
	assert.match( source, /this\.clearButton\.className = 'DrawLinesClear'/ )
	assert.match( source, /this\.clearButton\.textContent = 'Clean up'/ )
	assert.match( source, /this\.clearButton\.addEventListener\( 'pointerdown', this\.stopPointerPropagation \)/ )
	assert.match( source, /this\.clearButton\.addEventListener\( 'click', this\.onClearClick \)/ )
	assert.match( source, /clearLines = \(\) => \{[\s\S]*?this\.paths\.length = 0[\s\S]*?this\.activeLineCount = LINES_FOLLOWING_MOUSE/ )
} )
