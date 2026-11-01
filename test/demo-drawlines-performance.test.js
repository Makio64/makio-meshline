import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )
const readDemo = () => read( 'demo/src/demos/drawlines.js' )

test( 'Draw Lines keeps inactive capacity out of its animation hot path', async () => {
	const source = await readDemo()
	const update = source.match( /\n\tupdate = \( dt \) => \{([\s\S]*?)\n\t\}\n\n\tupdateWidthArray/ )?.[1]

	assert.ok( update, 'update loop should remain statically inspectable' )
	assert.match( source, /const NUM_LINES = 1000/ )
	assert.match( source, /createPreviewPath\(\)/ )
	assert.match( source, /const isMouseFollower = lineIndex < LINES_FOLLOWING_MOUSE/ )
	assert.match( source, /isMouseFollower && !this\.hasInteracted/ )
	assert.match( source, /this\.seedPointerFollowers\(\)/ )
	assert.match( source, /\.dynamic\( true \)/ )
	assert.match( update, /i < this\.activeLineCount/ )
	assert.match( update, /\.setPositionRange\( line\.positions, 0, line\.positionRangeOptions \)/ )
	assert.match( update, /\.setVertexValues\( 'width', this\.activeWidthValues, 0 \)/ )
	assert.doesNotMatch( update, /i < NUM_LINES/ )
	assert.doesNotMatch( update, /\.setPositions\(/ )
} )

test( 'Draw Lines exposes a top-middle cleanup button and top-left hint that reset drawn strokes without starting a stroke', async () => {
	const [source, controls, hud] = await Promise.all( [
		readDemo(),
		read( 'demo/src/utils/demoControls.js' ),
		read( 'demo/src/utils/demoHud.styl' ),
	] )

	// The foundation places the pills: the button at the top middle, the hint at the top left.
	assert.match( hud, /\.DemoControls\n\tposition fixed\n\ttop calc\(18px \+ var\(--sait, 0px\)\)\n\tleft 50%\n\ttransform translateX\(-50%\)/ )
	assert.match( hud, /\.DemoHint\n\tposition fixed\n\tleft calc\(18px \+ var\(--sail, 0px\)\)\n\ttop calc\(18px \+ var\(--sait, 0px\)\)/ )
	assert.match( source, /createDemoControls\( \[\{ id: 'clear', label: 'Clean up', ariaLabel: 'Clean up drawn lines', onClick: this\.clearLines \}\]/ )
	assert.match( source, /createDemoHint\( 'Drag to add your own stroke', \{ accent: ACCENT, hideAfter: 0 \} \)/ )
	// `mouse` listens on window, so a press stopped on the bar never starts a stroke.
	assert.match( controls, /bar\.addEventListener\( 'pointerdown', event => event\.stopPropagation\(\) \)/ )
	assert.match( controls, /button\.addEventListener\( 'click', item\.onClick \)/ )
	assert.match( controls, /if \( item\.ariaLabel \) button\.setAttribute\( 'aria-label', item\.ariaLabel \)/ )
	assert.match( source, /clearLines = \(\) => \{[\s\S]*?this\.paths\.length = 0[\s\S]*?this\.activeLineCount = LINES_FOLLOWING_MOUSE/ )
} )
