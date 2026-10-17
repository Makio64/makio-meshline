import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as publicEntry from '../src/index.js'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )

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
	const demo = await read( 'demo/src/demos/surface.js' )

	assert.match( demo, /frame: 'fixed-up'/ )
	assert.match( demo, /frame: 'transport'/ )
	assert.match( demo, /uvMode: 'distance'/ )
	assert.match( demo, /uvMode: 'stretch'/ )
	assert.match( demo, /PORTRAIT_FIT_ASPECT \/ stage3d\.camera\.aspect/ )
	assert.match( demo, /this\.control\._theta \+= Math\.min\( dt, 100 \) \* AUTO_ROTATE_SPEED/ )
	assert.match( demo, /prefers-reduced-motion: reduce/ )
	assert.match( demo, /\.SurfaceStudioWireframe \{[\s\S]*?position: fixed;[\s\S]*?top: calc\([\s\S]*?right: calc\(/ )
	assert.match( demo, /key === 'w' \|\| key === 'W'/ )
	assert.match( demo, /this\.lines\.forEach\( line => line\.wireframe\( this\.wireframeEnabled \) \)/ )
	assert.match( demo, /keyboard\.onDown\.add\( this\.onKeyDown \)/ )
	assert.match( demo, /keyboard\.onDown\.remove\( this\.onKeyDown \)/ )
} )

test( 'Bamboo Grove casts and receives shadows across all layers and exposes wireframe and part toggles', async () => {
	const demo = await read( 'demo/src/demos/bambooGrove.js' )

	assert.equal( ( demo.match( /\.shadow\( true, true \)/g ) || [] ).length, 4 )
	assert.match( demo, /const BAMBOO_PARTS = \[/ )
	assert.match( demo, /setPartVisible\( partKey, visible \)/ )
	assert.match( demo, /togglePart\( partKey \)/ )
	assert.match( demo, /\.widthCallback\( bambooLeafWidth \)/ )
	assert.match( demo, /\.fragmentColorFn\(/ )
	assert.match( demo, /\.BambooGroveWireframe \{[\s\S]*?position: fixed;[\s\S]*?top: calc\([\s\S]*?right: calc\(/ )
	assert.match( demo, /key === 'w' \|\| key === 'W'/ )
	assert.match( demo, /this\.bambooMeshes\.forEach\( mesh => mesh\.wireframe\( this\.wireframeEnabled \) \)/ )
	assert.match( demo, /keyboard\.onDown\.add\( this\.onKeyDown \)/ )
	assert.match( demo, /keyboard\.onDown\.remove\( this\.onKeyDown \)/ )
} )

