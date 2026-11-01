import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDirectory = fileURLToPath( new URL( '../', import.meta.url ) )
const scriptPath = fileURLToPath( new URL( '../scripts/verify-compatibility.mjs', import.meta.url ) )
const manifest = JSON.parse( await readFile( new URL( '../package.json', import.meta.url ), 'utf8' ) )
const packageManifest = JSON.parse( await readFile( new URL( '../src/package.json', import.meta.url ), 'utf8' ) )

const listMatrix = ( ...args ) => {
	const result = spawnSync( process.execPath, [scriptPath, ...args, '--list'], {
		cwd: rootDirectory,
		encoding: 'utf8',
	} )
	assert.equal( result.status, 0, result.stderr || result.stdout )
	return JSON.parse( result.stdout )
}

test( 'required compatibility matrix covers the minimum supported and pinned current Three.js', () => {
	const matrix = listMatrix()
	assert.deepEqual( matrix.map( profile => profile.id ), [
		'minimum',
		'pinned-current',
	] )
	assert.ok( matrix.every( profile => profile.required ) )

	assert.equal( matrix[0].three, manifest.meshlineCompatibility.minimum.three )
	assert.equal( matrix[0].types, manifest.meshlineCompatibility.minimum.types )
	assert.equal( matrix[1].three, manifest.devDependencies.three )
	assert.equal( matrix[1].types, manifest.devDependencies['@types/three'] )
} )

test( 'the published peer range starts at the tested minimum', () => {
	const { minimum } = manifest.meshlineCompatibility
	assert.equal( packageManifest.peerDependencies.three, `>=${minimum.three}` )
	assert.equal( packageManifest.peerDependencies['@types/three'], `>=${minimum.types}` )
} )

test( 'every profile runs the node-level shader tests against its own Three.js', async () => {
	const helperTests = []
	for ( const file of ( await readdir( new URL( './', import.meta.url ) ) ).sort() ) {
		if ( !file.endsWith( '.test.js' ) ) continue
		if ( /['"][^'"\n]*\/helpers\/shaderBuilder\.js['"]/.test( await readFile( new URL( file, import.meta.url ), 'utf8' ) ) ) helperTests.push( file )
	}
	for ( const profile of listMatrix( '--include-dev-canary' ) ) assert.deepEqual( profile.shaderTests, helperTests, profile.id )
} )

test( 'Three.js dev canary is explicit and non-blocking', () => {
	const [canary] = listMatrix( '--dev-canary-only' )
	assert.equal( canary.id, 'dev-canary' )
	assert.equal( canary.three, 'github:mrdoob/three.js#dev' )
	assert.equal( canary.required, false )
} )
