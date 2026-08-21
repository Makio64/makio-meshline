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

test( 'V2 data updates demo covers arc-length and partial upload APIs', async () => {
	const demo = demoCatalog.find( entry => entry.id === 'v2-updates' )
	assert.equal( demo?.group, 'basic' )
	assert.equal( demo?.category, 'learn' )

	const source = await readFile( new URL( '../demo/src/demos/v2Updates.js', import.meta.url ), 'utf8' )
	assert.match( source, /new Float32Array/ )
	assert.match( source, /\.gradientColor\(/ )
	assert.match( source, /\.dash\(/ )
	assert.match( source, /material\.dashOffset\.value/ )
	assert.match( source, /\.setPositionRange\(/ )
	assert.match( source, /\.setInstanceValues\(/ )
	assert.match( source, /new OrbitControl\(/ )
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
