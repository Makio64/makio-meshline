import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parseSemver } from './release-utils.mjs'

const rootDirectory = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' )
const packageDirectory = resolve( rootDirectory, 'src' )
const manifestPath = resolve( packageDirectory, 'package.json' )
const manifest = JSON.parse( await readFile( manifestPath, 'utf8' ) )
const errors = []
const temporaryDirectory = await mkdtemp( resolve( tmpdir(), 'makio-meshline-package-' ) )
const npmCacheDirectory = resolve( temporaryDirectory, 'npm-cache' )

const check = ( condition, message ) => {
	if ( !condition ) errors.push( message )
}

const run = ( command, args, options = {} ) => {
	return spawnSync( command, args, { encoding: 'utf8', ...options } )
}

check( manifest.name === 'makio-meshline', 'Unexpected package name' )
check( !!parseSemver( manifest.version ), 'Package version is not valid semver' )
check( manifest.type === 'module', 'Published package must remain ESM' )
check( manifest.license === 'MIT', 'Published package must declare the MIT license' )
check( manifest.sideEffects === false, 'Published package must remain tree-shakeable' )

const exportTargets = new Set( [manifest.main, manifest.module, manifest.types] )
const collectExportTargets = value => {
	if ( typeof value === 'string' ) {
		exportTargets.add( value )
		return
	}
	if ( value && typeof value === 'object' ) Object.values( value ).forEach( collectExportTargets )
}
collectExportTargets( manifest.exports )

for ( const target of exportTargets ) {
	if ( typeof target !== 'string' || !target.startsWith( './' ) ) {
		errors.push( `Invalid package target: ${target}` )
		continue
	}
	try {
		await access( resolve( packageDirectory, target ) )
	} catch {
		errors.push( `Package target does not exist: ${target}` )
	}
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

try {
	const pack = run(
		npmCommand,
		['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryDirectory],
		{
			cwd: packageDirectory,
			env: { ...process.env, npm_config_cache: npmCacheDirectory },
		}
	)

	if ( pack.status !== 0 ) {
		errors.push( `npm pack failed:\n${pack.stderr || pack.stdout}` )
	} else {
		try {
			const [report] = JSON.parse( pack.stdout )
			const packedFiles = new Set( report.files.map( file => file.path ) )
			const requiredFiles = ['README.md', 'LICENSE', 'package.json']

			for ( const target of exportTargets ) {
				if ( typeof target === 'string' && target.startsWith( './' ) ) requiredFiles.push( target.slice( 2 ) )
			}
			for ( const file of requiredFiles ) {
				check( packedFiles.has( file ), `Required file is missing from the npm tarball: ${file}` )
			}
			for ( const file of packedFiles ) {
				check( !/(^|\/)\.DS_Store$/.test( file ), `macOS metadata leaked into the npm tarball: ${file}` )
				check( !/^(demo|docs|examples|test|node_modules)\//.test( file ), `Workspace-only file leaked into the npm tarball: ${file}` )
			}

			const extractDirectory = resolve( temporaryDirectory, 'extract' )
			const consumerDirectory = resolve( temporaryDirectory, 'consumer' )
			const consumerModules = resolve( consumerDirectory, 'node_modules' )
			const installedPackage = resolve( consumerModules, manifest.name )
			await mkdir( extractDirectory, { recursive: true } )
			await mkdir( consumerModules, { recursive: true } )

			const extract = run(
				'tar',
				['-xzf', resolve( temporaryDirectory, report.filename ), '-C', extractDirectory]
			)
			if ( extract.status !== 0 ) throw new Error( extract.stderr || extract.stdout )

			await rename( resolve( extractDirectory, 'package' ), installedPackage )
			await symlink(
				resolve( rootDirectory, 'node_modules', 'three' ),
				resolve( consumerModules, 'three' ),
				process.platform === 'win32' ? 'junction' : 'dir'
			)

			const smokePath = resolve( consumerDirectory, 'smoke.mjs' )
			await writeFile( smokePath, [
				"export { default, MeshLine, MeshLineGeometry, MeshLineNodeMaterial, MeshLineSurfaceGeometry, MeshLineSurfaceNodeMaterial, MeshLineCompute, MeshLinePicker, MeshLinePickerHelper, lineCoord, circlePositions, squarePositions, rectanglePositions, sineWavePositions, straightLine, straightLineBetween, storagePositions } from 'makio-meshline'",
				"export { default as MeshLineCullingSystem } from 'makio-meshline/gpu-culling'",
				"export { default as MeshLineGPUPath } from 'makio-meshline/gpu-path'",
			].join( '\n' ) )

			const packageEntry = await import( `${pathToFileURL( smokePath ).href}?verify=${Date.now()}` )
			check( packageEntry.default === packageEntry.MeshLine, 'Default export must remain the MeshLine facade' )
			for ( const exportName of [
				'MeshLine',
				'MeshLineGeometry',
				'MeshLineNodeMaterial',
				'MeshLineSurfaceGeometry',
				'MeshLineSurfaceNodeMaterial',
				'MeshLineCompute',
				'MeshLinePicker',
				'MeshLinePickerHelper',
				'circlePositions',
				'squarePositions',
				'rectanglePositions',
				'sineWavePositions',
				'straightLine',
				'straightLineBetween',
				'storagePositions',
				'MeshLineCullingSystem',
				'MeshLineGPUPath',
			] ) {
				check( typeof packageEntry[exportName] === 'function', `${exportName} export is missing` )
			}
			check( packageEntry.lineCoord != null, 'lineCoord TSL node export is missing' )

			console.log( `npm package: ${report.entryCount} files, ${( report.unpackedSize / 1024 ).toFixed( 1 )} KiB unpacked` )
		} catch ( error ) {
			errors.push( `Could not verify packed artifact: ${error.message}` )
		}
	}
} finally {
	await rm( temporaryDirectory, { recursive: true, force: true } )
}

if ( errors.length > 0 ) {
	console.error( 'Package verification failed:' )
	errors.forEach( error => console.error( `- ${error}` ) )
	process.exit( 1 )
}

console.log( `makio-meshline@${manifest.version} package verification passed` )
