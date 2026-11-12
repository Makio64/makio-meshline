import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

import * as TSL from 'three/tsl'
import * as THREE from 'three/webgpu'

import * as meshline from '../src/index.js'
import { MeshLineBillboard } from '../src/MeshLineBillboard.js'
import * as positions from '../src/positions/index.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

// src/llms-full.txt is what coding agents read before writing makio-meshline
// code, in the npm package and on the docs site. A reference that drifts from
// the source teaches broken code, so these tests pin its recipes, option keys,
// hook arguments and helper signatures to the library.

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )
const reference = await read( 'src/llms-full.txt' )
const billboardSource = await read( 'src/MeshLineBillboard.js' )
const materialSource = await read( 'src/MeshLineNodeMaterial.js' )

const codeBlocks = [...reference.matchAll( /```js\n([\s\S]*?)```/g )].map( match => match[1] )
const section = title => {
	const start = reference.indexOf( `\n## ${title}` )
	assert.notEqual( start, -1, `section "${title}" is missing` )
	const end = reference.indexOf( '\n## ', start + 1 )
	return reference.slice( start, end === -1 ? undefined : end )
}
const tableRows = text => text.split( '\n' ).filter( row => row.startsWith( '| `' ) )

// Arguments of a call whose opening parenthesis ends at `index`.
const callArguments = ( source, index ) => {
	const args = []
	let depth = 1
	let start = index
	for ( let i = index; i < source.length; i++ ) {
		const char = source[i]
		if ( char === '(' || char === '[' || char === '{' ) depth++
		else if ( char === ')' || char === ']' || char === '}' ) depth--
		if ( depth === 0 || ( char === ',' && depth === 1 ) ) {
			args.push( source.slice( start, i ).trim() )
			start = i + 1
		}
		if ( depth === 0 ) return args.filter( Boolean )
	}
	throw new Error( 'unbalanced call' )
}

// Messages that only mean these tests run in Node.
const ENVIRONMENT_WARNINGS = [/autoResize requires a valid target/, /Use Float32Array for positions/]

const captureWarnings = async run => {
	const warnings = []
	const warn = console.warn
	console.warn = ( ...args ) => {
		const message = args.join( ' ' )
		if ( !ENVIRONMENT_WARNINGS.some( pattern => pattern.test( message ) ) ) warnings.push( message )
	}
	try {
		await run()
	} finally {
		console.warn = warn
	}
	return warnings
}

// Runs a recipe as an async function body, with its imports resolved here.
const AsyncFunction = Object.getPrototypeOf( async () => {} ).constructor
const IMPORT = /^import\s+(?:\*\s+as\s+(\w+)|(\w+)|\{([^}]*)\})\s+from\s+'([^']+)'\s*$/gm
const toFunctionBody = code => code.replace( IMPORT, ( _, namespace, name, named, specifier ) => {
	const module = `__import( '${specifier}' )`
	if ( namespace ) return `const ${namespace} = ${module}`
	if ( name ) return `const ${name} = ${module}.default`
	return `const {${named.replace( /\s+as\s+/g, ': ' )}} = ${module}`
} )
const MODULES = {
	'makio-meshline': meshline,
	'makio-meshline/positions': positions,
	'three/tsl': TSL,
	'three/webgpu': THREE,
}
// Blocks that need a browser or an initialized renderer are only parsed.
const NEEDS_BROWSER = /\brenderer\b|TextureLoader|document\.|window\./

test( 'the docs site serves the reference the package ships', async () => {
	assert.equal( await read( 'docs/public/llms-full.txt' ), reference, 'run: cp src/llms-full.txt docs/public/llms-full.txt' )
	const manifest = JSON.parse( await read( 'src/package.json' ) )
	assert.ok( manifest.files.includes( 'llms-full.txt' ), 'src/package.json must publish llms-full.txt' )
	assert.match( await read( 'src/README.md' ), /llms-full\.txt/, 'the package README must point agents at llms-full.txt' )
} )

test( 'the reference covers every public facade method and root export', () => {
	const methods = Object.getOwnPropertyNames( MeshLineBillboard.prototype )
		.filter( name => name !== 'constructor' && !name.startsWith( '_' ) )
	methods.push( 'dispose' ) // an instance field, not a prototype method
	for ( const name of [...methods, ...Object.keys( meshline ).filter( name => name !== 'default' )] ) {
		assert.match( reference, new RegExp( `\\b${name}\\b` ), `${name} is missing from src/llms-full.txt` )
	}
} )

test( 'configure() reads exactly the keys its unknown-option warning knows', () => {
	const body = billboardSource.slice(
		billboardSource.indexOf( '\tconfigure( options = {} ) {' ),
		billboardSource.indexOf( '\t_warnUnknownOptions( options ) {' ),
	)
	const readKeys = new Set( [...body.matchAll( /\boptions\.(\w+)|'(\w+)' in options/g )].map( match => match[1] ?? match[2] ) )

	const listStart = billboardSource.indexOf( 'const CONFIGURE_KEYS' )
	const list = billboardSource.slice( listStart, billboardSource.indexOf( '] )', listStart ) )
	const hooks = billboardSource.match( /const HOOK_NAMES = \[([^\]]*)\]/ )[1]
	const knownKeys = new Set( [
		...[...list.matchAll( /'([\w ]+)'\.split/g )].flatMap( match => match[1].split( ' ' ) ),
		...[...hooks.matchAll( /'(\w+)'/g )].map( match => match[1] ),
	] )

	assert.ok( readKeys.size > 50, 'configure() parsing failed' )
	assert.deepEqual( [...knownKeys].sort(), [...readKeys].sort() )
} )

test( 'every option key the reference documents is one configure() accepts', async () => {
	const keys = new Set()
	for ( const row of tableRows( section( '5. MeshLine API' ) ) ) {
		const options = row.split( ' | ' )[0].split( ' / ' )[0]
		for ( const [, key] of options.matchAll( /`(\w+)`/g ) ) keys.add( key )
	}
	assert.ok( keys.size > 35, 'option table parsing failed' )

	const line = new meshline.MeshLine()
	const warnings = await captureWarnings( () => {
		for ( const key of keys ) line._warnUnknownOptions( { [key]: true } )
	} )
	assert.deepEqual( warnings, [] )
	line.dispose()
} )

test( 'the hook table lists the arguments the material passes', () => {
	const documented = new Map()
	for ( const row of tableRows( section( '6. TSL hooks' ) ) ) {
		const [names, args] = row.slice( 2 ).split( ' | ' )
		for ( const [, name] of names.matchAll( /`(\w+)`/g ) ) documented.set( name, args.split( ',' ).length )
	}

	// gpuPositionNode also receives a reserved `extra`, always 0.
	const reserved = { gpuPositionNode: 1 }
	const hooks = [...materialSource.match( /const GRAPH_HOOKS = \[([^\]]*)\]/ )[1].matchAll( /'(\w+)'/g )].map( match => match[1] )
	for ( const hook of hooks ) {
		assert.ok( documented.has( hook ), `${hook} is missing from the hook table` )
		const calls = [...materialSource.matchAll( new RegExp( `this\\.${hook}\\(`, 'g' ) )]
		assert.ok( calls.length > 0, `no call to ${hook} found` )
		for ( const call of calls ) {
			const passed = callArguments( materialSource, call.index + call[0].length ).length
			assert.equal( documented.get( hook ) + ( reserved[hook] ?? 0 ), passed, `${hook} arguments` )
		}
	}
} )

test( 'the helper signatures match the source', async () => {
	const directory = new URL( '../src/positions/', import.meta.url )
	const signatures = new Map()
	for ( const file of await readdir( directory ) ) {
		const source = await readFile( new URL( file, directory ), 'utf8' )
		for ( const match of source.matchAll( /export (?:const (\w+) = |function (\w+))\( ([^)]*) \)/g ) ) {
			const name = match[1] ?? match[2]
			signatures.set( name, `${name}( ${match[3]} )` )
		}
	}
	for ( const name of Object.keys( positions ) ) {
		assert.ok( signatures.has( name ), `no signature found for ${name}` )
		assert.ok( reference.includes( signatures.get( name ) ), `src/llms-full.txt must list ${signatures.get( name )}` )
	}
} )

test( 'every JavaScript block in the reference parses', () => {
	assert.ok( codeBlocks.length >= 15, 'code blocks went missing' )
	for ( const code of codeBlocks ) {
		assert.doesNotThrow( () => new AsyncFunction( '__import', toFunctionBody( code ) ), code.slice( 0, 80 ) )
	}
} )

test( 'the recipes build, compile and warn about nothing', async () => {
	const recipes = codeBlocks.filter( code => !NEEDS_BROWSER.test( code ) )
	assert.ok( recipes.length >= 10, 'recipes went missing' )
	const renderers = { wgsl: createRenderer( false ), glsl: createRenderer( true ) }

	for ( const code of recipes ) {
		const scene = new THREE.Scene()
		const warnings = await captureWarnings( async () => {
			const run = new AsyncFunction( '__import', 'THREE', 'scene', 'camera', `${toFunctionBody( code )}\nreturn typeof update === 'function' ? update : null` )
			const update = await run( specifier => MODULES[specifier], THREE, scene, new THREE.PerspectiveCamera() )
			const lines = []
			scene.traverse( object => {
				if ( object instanceof MeshLineBillboard ) lines.push( object )
			} )
			assert.ok( lines.length > 0, 'the recipe adds no line to the scene' )
			for ( const line of lines ) {
				line.ensureBuilt()
				if ( !line.material.isMeshLineNodeMaterial ) continue
				assert.match( buildShaderGraph( renderers.wgsl, line ).vertexShader, /@vertex/ )
				// WebGL2 has no storage buffers to read points from.
				if ( !/storagePositions/.test( code ) ) assert.match( buildShaderGraph( renderers.glsl, line ).vertexShader, /void main/ )
			}
			update?.( 1000 )
			for ( const line of lines ) line.dispose()
		} )
		assert.deepEqual( warnings, [], `recipe starting "${code.slice( 0, 60 )}" warned` )
	}
} )
