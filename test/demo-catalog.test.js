import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import { demoCatalog } from '../demo/src/demoCatalog.js'

const unique = values => new Set( values ).size === values.length

test( 'demo catalog has stable unique routes and useful preview metadata', () => {
	assert.ok( demoCatalog.length >= 20 )
	assert.ok( unique( demoCatalog.map( demo => demo.id ) ), 'demo ids must be unique' )
	assert.ok( unique( demoCatalog.map( demo => demo.sourceFile ) ), 'demo source files must be unique' )
	assert.ok( unique( demoCatalog.flatMap( demo => [demo.id, ...( demo.aliases || [] )] ) ), 'demo routes and aliases must be unique' )

	for ( const demo of demoCatalog ) {
		assert.match( demo.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/ )
		assert.ok( demo.title.length > 0, `${demo.id} needs a title` )
		assert.ok( demo.subtitle.length > 0, `${demo.id} needs a preview subtitle` )
		assert.ok( ['basic', 'advanced'].includes( demo.group ), `${demo.id} has an invalid group` )
		assert.ok( ['learn', 'tools', 'gpu', 'surface', 'showcase'].includes( demo.category ), `${demo.id} has an invalid category` )
		if ( demo.status ) assert.equal( demo.status, 'experimental' )
	}
} )

test( 'Basic keeps the feature gallery on the stable route', () => {
	const basic = demoCatalog.find( demo => demo.id === 'basic' )
	assert.equal( basic?.title, 'Basic' )
	assert.equal( basic?.sourceFile, 'featureGallery.js' )
	assert.deepEqual( basic?.aliases, ['feature-gallery'] )
} )

test( 'merged demos keep their historical routes as aliases', () => {
	const routes = {
		'v2-updates': 'drawlines',
		'vertex-colors': 'waves',
		'gpu-circle': 'gpu-instance',
	}

	for ( const [alias, id] of Object.entries( routes ) ) {
		const demo = demoCatalog.find( entry => entry.aliases?.includes( alias ) )
		assert.equal( demo?.id, id, `${alias} should open ${id}` )
	}
} )

test( 'live update APIs stay exercised by the demos that absorbed Live Updates', async () => {
	const [drawLines, gpuInstance, waves] = await Promise.all( [
		readFile( new URL( '../demo/src/demos/drawlines.js', import.meta.url ), 'utf8' ),
		readFile( new URL( '../demo/src/demos/gpuInstance.js', import.meta.url ), 'utf8' ),
		readFile( new URL( '../demo/src/demos/waves.js', import.meta.url ), 'utf8' ),
	] )

	assert.match( drawLines, /\.setPositionRange\(/ )
	assert.match( drawLines, /\.setVertexValues\( 'lineColor'/ )
	assert.match( gpuInstance, /\.gpuPositionNode\(/ )
	assert.match( gpuInstance, /\.addInstanceAttribute\(/ )
	assert.match( gpuInstance, /\.setInstanceValues\(/ )
	assert.match( waves, /\.vertexColors\(/ )
	assert.match( waves, /\.setPositions\(/ )
} )

test( 'every catalog entry points to a fresh disposable demo class', async () => {
	for ( const demo of demoCatalog ) {
		const sourcePath = new URL( `../demo/src/demos/${demo.sourceFile}`, import.meta.url )
		await access( sourcePath )
		const source = await readFile( sourcePath, 'utf8' )
		const defaultExport = source.match( /export default ([A-Za-z][A-Za-z0-9_]*)/ )

		assert.ok( defaultExport, `${demo.sourceFile} needs a named default export` )
		assert.match( source, new RegExp( `class ${defaultExport[1]}(?:\\s|\\{)` ) )
		assert.match( source, /\n\tasync init\(\)/, `${demo.sourceFile} needs async init()` )
		assert.match( source, /\n\tdispose\(\)/, `${demo.sourceFile} needs dispose()` )
		assert.doesNotMatch( source, /export default new /, `${demo.sourceFile} must create a fresh instance per visit` )
		assert.doesNotMatch( source, /\n\tshow\(\) \{\s*\}\s*\n\t(?:hide\( cb \))?/, `${demo.sourceFile} has empty transition boilerplate` )
	}
} )

test( 'custom source links resolve inside the repository', async () => {
	for ( const demo of demoCatalog.filter( demo => demo.sourcePath ) ) {
		await access( new URL( `../${demo.sourcePath}`, import.meta.url ) )
	}
} )
