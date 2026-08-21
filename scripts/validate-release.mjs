import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { validateReleasePlan } from './release-utils.mjs'

const args = process.argv.slice( 2 )
const readArgument = ( name ) => {
	const index = args.indexOf( name )
	return index === -1 ? null : args[index + 1]
}

const version = readArgument( '--version' )
const npmTag = readArgument( '--tag' )
const allowPublished = args.includes( '--allow-published' )
const currentPackageVersion = JSON.parse(
	readFileSync( new URL( '../src/package.json', import.meta.url ), 'utf8' )
).version

if ( !version || !npmTag ) {
	console.error( 'Usage: node scripts/validate-release.mjs --version <version> --tag <tag> [--allow-published]' )
	process.exit( 1 )
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const registryRequest = spawnSync(
	npmCommand,
	['view', 'makio-meshline', 'versions', 'dist-tags', '--json'],
	{ encoding: 'utf8' }
)

if ( registryRequest.status !== 0 ) {
	console.error( `Could not read makio-meshline registry state:\n${registryRequest.stderr || registryRequest.stdout}` )
	process.exit( 1 )
}

try {
	const registry = JSON.parse( registryRequest.stdout )
	const publishedVersions = Array.isArray( registry.versions )
		? registry.versions
		: registry.versions ? [registry.versions] : []
	const currentTagVersion = registry['dist-tags']?.[npmTag] ?? null
	const plan = validateReleasePlan( {
		version,
		npmTag,
		publishedVersions,
		currentTagVersion,
		currentPackageVersion,
		allowPublished,
	} )

	console.log( JSON.stringify( plan ) )
} catch ( error ) {
	console.error( error.message )
	process.exit( 1 )
}
