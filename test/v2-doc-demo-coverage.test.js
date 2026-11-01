import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as publicEntry from '../src/index.js'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )

const CONTROLS_AT_TOP_CENTER = /\.DemoControls\n\tposition fixed\n\ttop calc\(18px \+ var\(--sait, 0px\)\)\n\tleft 50%\n\ttransform translateX\(-50%\)/

test( 'the V2 coverage index lists every root package export', async () => {
	const coverage = await read( 'docs/v2-api-coverage.md' )
	const exportNames = Object.keys( publicEntry )
		.filter( name => name !== 'default' )
		.sort()

	for ( const exportName of exportNames ) {
		assert.match( coverage, new RegExp( `\\b${exportName}\\b` ), `${exportName} is missing from the V2 coverage index` )
	}
} )

const documentedFeatures = [
	{
		name: 'world-space surface profile',
		api: '.surface(',
		doc: 'docs/surface.md',
		demo: 'demo/src/demos/surface.js',
	},
	{
		name: 'cap topology',
		api: '.cap(',
		doc: 'docs/surface.md',
		demo: 'demo/src/demos/variableTopology.js',
	},
	{
		name: 'partial point updates',
		api: 'setPositionRange(',
		doc: 'docs/meshline.md',
		demo: 'demo/src/demos/drawlines.js',
	},
	{
		name: 'bulk vertex updates',
		api: 'setVertexValues(',
		doc: 'docs/meshline.md',
		demo: 'demo/src/demos/drawlines.js',
	},
	{
		name: 'bulk instance updates',
		api: 'setInstanceValues(',
		doc: 'docs/meshline.md',
		demo: 'demo/src/demos/gpuInstance.js',
	},
	{
		name: 'native GPU culling entry',
		api: 'MeshLineCullingSystem',
		doc: 'docs/gpu-culling.md',
		demo: 'demo/src/demos/gpuCulling.js',
	},
	{
		name: 'native GPU path entry',
		api: 'MeshLineGPUPath',
		doc: 'docs/gpu-path.md',
		demo: 'demo/src/demos/gpuPath.js',
	},
]

for ( const feature of documentedFeatures ) {
	test( `${feature.name} has a canonical reference and runnable demo`, async () => {
		const [documentation, demo] = await Promise.all( [read( feature.doc ), read( feature.demo )] )
		assert.ok( documentation.includes( feature.api ), `${feature.doc} must mention ${feature.api}` )
		assert.ok( demo.includes( feature.api ), `${feature.demo} must exercise ${feature.api}` )
	} )
}

test( 'framework starters exercise the V2 surface profile declaratively', async () => {
	const [react, vue] = await Promise.all( [
		read( 'examples/react-three-fiber/src/App.jsx' ),
		read( 'examples/vue/src/App.vue' ),
	] )

	assert.match( react, /surface=\{roadSurface\}/ )
	assert.match( vue, /:surface="roadSurface"/ )
} )

test( 'Surface Studio compares mapped frames with responsive motion', async () => {
	const [demo, orbit, detect, controls, hud, stage3d] = await Promise.all( [
		read( 'demo/src/demos/surface.js' ),
		read( 'demo/src/makio/three/controls/OrbitControl.js' ),
		read( 'demo/src/makio/utils/detect.js' ),
		read( 'demo/src/utils/demoControls.js' ),
		read( 'demo/src/utils/demoHud.styl' ),
		read( 'demo/src/makio/three/stage3d.js' ),
	] )

	assert.match( demo, /frame: 'fixed-up'/ )
	assert.match( demo, /frame: 'transport'/ )
	assert.match( demo, /uvMode: 'distance'/ )
	assert.match( demo, /uvMode: 'stretch'/ )
	assert.match( demo, /PORTRAIT_FIT_ASPECT \/ stage3d\.camera\.aspect/ )
	// The control turns the camera, pausing for a drag and for reduced motion.
	assert.match( demo, /autoRotate: 0\.00002,/ )
	assert.match( orbit, /if \( this\.autoRotate && !this\._isDown && !reducedMotion\.matches \) this\._theta \+= this\.autoRotate \* dt/ )
	assert.match( detect, /export const reducedMotion = window\.matchMedia\( '\(prefers-reduced-motion: reduce\)' \)/ )
	assert.match( demo, /this\.controls = createDemoControls\(/ )
	assert.match( hud, CONTROLS_AT_TOP_CENTER )
	assert.match( demo, /id: 'wireframe', label: 'Wireframe', key: 'W'/ )
	assert.match( controls, /pressed\.toLowerCase\(\) !== key\.toLowerCase\(\)/ )
	assert.match( demo, /this\.lines\.forEach\( line => line\.wireframe\( this\.wireframeEnabled \) \)/ )
	// The shortcut listens through stage3d, which unsubscribes it in clearDemo().
	assert.match( controls, /if \( key \) onShortcut\( key, onClick \)/ )
	assert.match( controls, /stage3d\.listen\( keyboard\.onDown,/ )
	assert.match( stage3d, /this\.own\( \(\) => source\[remove\]\( \.\.\.args \) \)/ )
} )

test( 'Bamboo Grove casts and receives shadows across all layers and exposes wireframe and part toggles', async () => {
	const [demo, controls, hud] = await Promise.all( [
		read( 'demo/src/demos/bambooGrove.js' ),
		read( 'demo/src/utils/demoControls.js' ),
		read( 'demo/src/utils/demoHud.styl' ),
	] )

	assert.equal( ( demo.match( /\.shadow\( true, true \)/g ) || [] ).length, 4 )
	assert.match( demo, /const BAMBOO_PARTS = \[/ )
	assert.match( demo, /togglePart\( partKey \)/ )
	assert.match( demo, /mesh\.visible = !mesh\.visible/ )
	assert.match( demo, /this\.controls\.setPressed\( partKey, mesh\.visible \)/ )
	assert.match( demo, /\.widthCallback\( bambooLeafWidth \)/ )
	assert.match( demo, /\.fragmentColorFn\(/ )
	assert.match( demo, /this\.controls = createDemoControls\( \[/ )
	assert.match( hud, CONTROLS_AT_TOP_CENTER )
	assert.match( demo, /id: 'wireframe', label: 'Wireframe', key: 'W'/ )
	assert.match( controls, /pressed\.toLowerCase\(\) !== key\.toLowerCase\(\)/ )
	assert.match( demo, /Object\.values\( this\.parts \)\.forEach\( mesh => mesh\.wireframe\( this\.wireframeEnabled \) \)/ )
	// Keys 1 to 4 and W come with their buttons, and stage3d releases the shortcuts in clearDemo().
	assert.match( demo, /id: 'stalks'[^\n]*key: '1'[\s\S]*?id: 'nodes'[^\n]*key: '2'[\s\S]*?id: 'twigs'[^\n]*key: '3'[\s\S]*?id: 'leaves'[^\n]*key: '4'/ )
	assert.match( demo, /\.\.\.BAMBOO_PARTS\.map\( part => \( \{ \.\.\.part, pressed: true, onClick: \(\) => this\.togglePart\( part\.id \) \} \) \)/ )
	assert.match( controls, /if \( key \) onShortcut\( key, onClick \)/ )
	assert.match( controls, /stage3d\.listen\( keyboard\.onDown,/ )
	assert.doesNotMatch( demo, /keyboard\.onDown/ )
} )

