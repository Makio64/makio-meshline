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
		demo: 'demo/src/demos/v2Updates.js',
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
		demo: 'demo/src/demos/v2Updates.js',
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
