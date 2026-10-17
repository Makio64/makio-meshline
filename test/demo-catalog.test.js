import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import { demoCatalog, demoSections } from '../demo/src/demoCatalog.js'

const unique = values => new Set( values ).size === values.length
const menuDemos = demoCatalog.filter( demo => !demo.hidden )
const sectionIds = demoSections.map( section => section.id )

test( 'demo catalog has stable unique routes and useful preview metadata', () => {
	assert.ok( menuDemos.length >= 20 )
	assert.ok( unique( demoCatalog.map( demo => demo.id ) ), 'demo ids must be unique' )
	assert.ok( unique( demoCatalog.map( demo => demo.sourceFile ) ), 'demo source files must be unique' )
	assert.ok( unique( demoCatalog.flatMap( demo => [demo.id, ...( demo.aliases || [] )] ) ), 'demo routes and aliases must be unique' )
	assert.ok( unique( sectionIds ), 'menu section ids must be unique' )

	for ( const demo of demoCatalog ) {
		assert.match( demo.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/ )
		assert.ok( demo.title.length > 0, `${demo.id} needs a title` )
		assert.ok( demo.subtitle.length > 0, `${demo.id} needs a preview subtitle` )
		assert.ok( demo.blurb.length > 0 && demo.blurb.length <= 110, `${demo.id} needs a one-line blurb` )
		assert.ok( Array.isArray( demo.apis ) && demo.apis.length > 0, `${demo.id} needs the APIs it shows` )
		assert.ok( sectionIds.includes( demo.section ), `${demo.id} has an invalid section` )
		if ( demo.status ) assert.equal( demo.status, 'experimental' )
		if ( demo.requires ) assert.equal( demo.requires, 'webgpu' )
		if ( 'hidden' in demo ) assert.equal( demo.hidden, true )
	}

	for ( const section of demoSections ) {
		assert.ok( menuDemos.some( demo => demo.section === section.id ), `${section.id} needs at least one menu demo` )
	}
} )

test( 'every menu demo has a gallery thumbnail', async () => {
	for ( const demo of menuDemos ) {
		await access( new URL( `../demo/public/thumbs/${demo.id}.webp`, import.meta.url ) )
	}
} )

test( 'the menu opens on the basics, with Joins & Caps beside the Style Gallery', () => {
	const start = menuDemos.filter( demo => demo.section === 'start' ).map( demo => demo.id )
	assert.equal( demoSections[0].id, 'start' )
	assert.deepEqual( start.slice( 0, 2 ), ['basic', 'variable-topology'] )
} )

test( 'Shadows, Bamboooo and GPU Simplification stay on the menu', () => {
	for ( const id of ['shadow', 'bamboooo', 'gpu-simplification'] ) {
		assert.ok( menuDemos.some( demo => demo.id === id ), `${id} must stay on the menu` )
	}
} )

test( 'hidden demos keep their own route', () => {
	const follow = demoCatalog.find( demo => demo.id === 'follow' )
	assert.equal( follow?.hidden, true )
	assert.equal( follow?.sourceFile, 'follow.js' )
} )

test( 'Basic keeps the feature gallery on the stable route', () => {
	const basic = demoCatalog.find( demo => demo.id === 'basic' )
	assert.equal( basic?.title, 'Style Gallery' )
	assert.equal( basic?.subtitle, 'options + TSL hooks' )
	assert.equal( basic?.sourceFile, 'featureGallery.js' )
	assert.deepEqual( basic?.aliases, ['feature-gallery'] )
} )

test( 'Laser Heist preserves the historical Bunker route', () => {
	const heist = demoCatalog.find( demo => demo.id === 'laser-heist' )
	assert.deepEqual( heist?.aliases, ['bunker'] )
} )

test( 'Basic feature gallery exercises the public TSL styling hooks', async () => {
	const source = await readFile( new URL( '../demo/src/demos/featureGallery.js', import.meta.url ), 'utf8' )

	for ( const hook of ['widthFn', 'gradientFn', 'opacityFn', 'dashFn', 'uvFn', 'discardFn'] ) {
		assert.match( source, new RegExp( `\\.${hook}\\(` ), `${hook} needs live gallery coverage` )
	}
	assert.match( source, /from 'three\/tsl'/ )
	assert.match( source, /\btime\b/ )
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
