import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDirectory = fileURLToPath( new URL( '../', import.meta.url ) )
const scriptPath = fileURLToPath( new URL( '../scripts/verify-compatibility.mjs', import.meta.url ) )
const manifest = JSON.parse( await readFile( new URL( '../package.json', import.meta.url ), 'utf8' ) )

const listMatrix = ( ...args ) => {
	const result = spawnSync( process.execPath, [scriptPath, ...args, '--list'], {
		cwd: rootDirectory,
		encoding: 'utf8',
	} )
	assert.equal( result.status, 0, result.stderr || result.stdout )
	return JSON.parse( result.stdout )
}

test( 'required compatibility matrix covers minimum core, minimum optional entries, and pinned current', () => {
	const matrix = listMatrix()
	assert.deepEqual( matrix.map( profile => profile.id ), [
		'core-minimum',
		'optional-minimum',
		'pinned-current',
	] )
	assert.deepEqual( matrix.map( profile => profile.coverage ), [
		'core',
		'core+optional',
		'core+optional',
	] )
	assert.ok( matrix.every( profile => profile.required ) )

	assert.equal( matrix[0].three, manifest.meshlineCompatibility.coreMinimum.three )
	assert.equal( matrix[0].types, manifest.meshlineCompatibility.coreMinimum.types )
	assert.equal( matrix[1].three, manifest.meshlineCompatibility.optionalMinimum.three )
	assert.equal( matrix[1].types, manifest.meshlineCompatibility.optionalMinimum.types )
	assert.equal( matrix[2].three, manifest.devDependencies.three )
	assert.equal( matrix[2].types, manifest.devDependencies['@types/three'] )
} )

test( 'every profile runs the node-level shader tests against its own Three.js', async () => {
	const helperTests = []
	for ( const file of ( await readdir( new URL( './', import.meta.url ) ) ).sort() ) {
		if ( !file.endsWith( '.test.js' ) ) continue
		if ( /['"][^'"\n]*\/helpers\/shaderBuilder\.js['"]/.test( await readFile( new URL( file, import.meta.url ), 'utf8' ) ) ) helperTests.push( file )
	}
	const [core, ...optionalProfiles] = listMatrix( '--include-dev-canary' )
	for ( const profile of optionalProfiles ) assert.deepEqual( profile.shaderTests, helperTests, profile.id )

	// The minimum core release skips only the tests of r183+ optional entries.
	const coreSkipped = helperTests.filter( file => !core.shaderTests.includes( file ) )
	assert.ok( core.shaderTests.includes( 'meshline-fold-joins.test.js' ) )
	assert.ok( coreSkipped.every( file => /gpu-path|culling/.test( file ) ), `core-minimum skips ${coreSkipped.join( ', ' )}` )
} )

test( 'Three.js dev canary is explicit and non-blocking', () => {
	const [canary] = listMatrix( '--dev-canary-only' )
	assert.equal( canary.id, 'dev-canary' )
	assert.equal( canary.three, 'github:mrdoob/three.js#dev' )
	assert.equal( canary.coverage, 'core+optional' )
	assert.equal( canary.required, false )
} )
