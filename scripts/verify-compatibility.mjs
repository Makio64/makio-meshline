import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' )
const packageDirectory = resolve( rootDirectory, 'src' )
const workspaceManifest = JSON.parse( await readFile( resolve( rootDirectory, 'package.json' ), 'utf8' ) )
const packageManifest = JSON.parse( await readFile( resolve( packageDirectory, 'package.json' ), 'utf8' ) )
const compatibility = workspaceManifest.meshlineCompatibility ?? {}
const currentThreeVersion = workspaceManifest.devDependencies?.three
const currentTypesVersion = workspaceManifest.devDependencies?.['@types/three']
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const tscCommand = resolve( rootDirectory, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc' )
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const requireExactVersion = ( value, label ) => {
	if ( typeof value !== 'string' || !exactVersionPattern.test( value ) ) {
		throw new Error( `${label} must be an exact package version, received ${JSON.stringify( value )}` )
	}
	return value
}

const stableProfiles = [
	{
		id: 'core-minimum',
		label: 'minimum core',
		three: requireExactVersion( compatibility.coreMinimum?.three, 'meshlineCompatibility.coreMinimum.three' ),
		types: requireExactVersion( compatibility.coreMinimum?.types, 'meshlineCompatibility.coreMinimum.types' ),
		optionalEntries: false,
		required: true,
	},
	{
		id: 'optional-minimum',
		label: 'minimum optional entries',
		three: requireExactVersion( compatibility.optionalMinimum?.three, 'meshlineCompatibility.optionalMinimum.three' ),
		types: requireExactVersion( compatibility.optionalMinimum?.types, 'meshlineCompatibility.optionalMinimum.types' ),
		optionalEntries: true,
		required: true,
	},
	{
		id: 'pinned-current',
		label: 'pinned current',
		three: requireExactVersion( currentThreeVersion, 'devDependencies.three' ),
		types: requireExactVersion( currentTypesVersion, 'devDependencies.@types/three' ),
		optionalEntries: true,
		required: true,
	},
]

const devCanary = {
	id: 'dev-canary',
	label: 'Three.js dev canary',
	three: 'github:mrdoob/three.js#dev',
	types: requireExactVersion( currentTypesVersion, 'devDependencies.@types/three' ),
	optionalEntries: true,
	required: false,
}

// Node-level shader tests: every test file that builds shaders through
// test/helpers/shaderBuilder.js. Node-builder output changes between Three.js
// releases, so each profile runs them against its own install.
const testDirectory = resolve( rootDirectory, 'test' )
const shaderBuilderImport = /['"]\.\/helpers\/shaderBuilder\.js['"]/
const optionalEntryShaderTests = new Set( ['meshline-gpu-path-position-accessors.test.js'] )
const shaderTests = []
for ( const file of ( await readdir( testDirectory ) ).filter( file => file.endsWith( '.test.js' ) ).sort() ) {
	if ( shaderBuilderImport.test( await readFile( resolve( testDirectory, file ), 'utf8' ) ) ) shaderTests.push( file )
}
if ( shaderTests.length === 0 ) throw new Error( 'No test/*.test.js file imports ./helpers/shaderBuilder.js' )
for ( const file of optionalEntryShaderTests ) {
	if ( !shaderTests.includes( file ) ) throw new Error( `Optional-entry shader test ${file} is not a test/*.test.js file importing ./helpers/shaderBuilder.js` )
}
const shaderTestsFor = profile => shaderTests.filter( file => profile.optionalEntries || !optionalEntryShaderTests.has( file ) )

// What the shader tests import. Each profile runs a copy below its consumer, so
// the tests and the library resolve that profile's `three`; src/ links its own
// node_modules/three (the pinned release), so node_modules folders stay behind.
const shaderTestSources = ['src', 'test', 'demo/src/utils', 'docs/.vitepress/theme']

const argumentsSet = new Set( process.argv.slice( 2 ) )
const knownArguments = new Set( ['--include-dev-canary', '--dev-canary-only', '--list'] )
const unknownArguments = [...argumentsSet].filter( argument => !knownArguments.has( argument ) )
if ( unknownArguments.length > 0 ) throw new Error( `Unknown compatibility option: ${unknownArguments.join( ', ' )}` )

const profiles = argumentsSet.has( '--dev-canary-only' )
	? [devCanary]
	: argumentsSet.has( '--include-dev-canary' )
		? [...stableProfiles, devCanary]
		: stableProfiles

const publicProfile = profile => ( {
	id: profile.id,
	label: profile.label,
	three: profile.three,
	types: profile.types,
	coverage: profile.optionalEntries ? 'core+optional' : 'core',
	required: profile.required,
	shaderTests: shaderTestsFor( profile ),
} )

if ( argumentsSet.has( '--list' ) ) {
	console.log( JSON.stringify( profiles.map( publicProfile ), null, 2 ) )
	process.exit( 0 )
}

const run = ( command, args, options = {} ) => {
	return spawnSync( command, args, {
		encoding: 'utf8',
		maxBuffer: 10 * 1024 * 1024,
		...options,
	} )
}

const commandFailure = ( result, label ) => {
	const output = [result.error?.message, result.stderr, result.stdout].filter( Boolean ).join( '\n' ).trim()
	return new Error( `${label} failed${output ? `:\n${output}` : ''}` )
}

const assertCommand = ( result, label ) => {
	if ( result.status === 0 ) return
	throw commandFailure( result, label )
}

const sanitizedEnvironment = Object.fromEntries(
	Object.entries( process.env ).filter( ([key]) => !key.toLowerCase().startsWith( 'npm_config_' ) )
)

const createRuntimeSmoke = optionalEntries => {
	const source = [
		"import MeshLine, { MeshLineGeometry, MeshLinePicker, MeshLineSurfaceGeometry } from 'makio-meshline'",
		"if ( MeshLine !== MeshLine.prototype.constructor ) throw new Error( 'Default MeshLine export is invalid' )",
		"if ( !MeshLineGeometry || !MeshLineSurfaceGeometry || !MeshLinePicker ) throw new Error( 'Core named exports are missing' )",
		'const line = new MeshLine( { segments: 2 } ).build()',
	]

	if ( optionalEntries ) {
		source.push(
			"const { default: MeshLineCullingSystem } = await import( 'makio-meshline/gpu-culling' )",
			"const { default: MeshLineGPUPath } = await import( 'makio-meshline/gpu-path' )",
			"if ( typeof MeshLineCullingSystem !== 'function' ) throw new Error( 'GPU culling export is invalid' )",
			"if ( typeof MeshLineGPUPath !== 'function' ) throw new Error( 'GPU path export is invalid' )",
			'const path = new MeshLineGPUPath( { lines: new Float32Array( [0, 0, 0, 1, 0, 0] ) } )',
			"if ( path.isMeshLineGPUPath !== true ) throw new Error( 'GPU path could not be constructed' )",
			'path.dispose()',
		)
	}

	source.push( 'line.dispose()' )
	return source.join( '\n' )
}

const createTypeSmoke = optionalEntries => {
	const source = [
		"import MeshLine, { type MeshLineConfigureOptions, MeshLineSurfaceGeometry } from 'makio-meshline'",
		'const options: MeshLineConfigureOptions = { lines: new Float32Array( [0, 0, 0, 1, 0, 0] ), lineWidth: 0.3 }',
		'const line: MeshLine = new MeshLine( options )',
		'const surface: MeshLineSurfaceGeometry | null = null',
		'void line',
		'void surface',
	]

	if ( optionalEntries ) {
		source.unshift(
			"import MeshLineCullingSystem, { type MeshLineCullingSystemOptions } from 'makio-meshline/gpu-culling'",
			"import MeshLineGPUPath, { type MeshLineGPUPathOptions } from 'makio-meshline/gpu-path'",
		)
		source.push(
			"const cullingOptions: MeshLineCullingSystemOptions = { mode: 'auto' }",
			'const cullingConstructor: typeof MeshLineCullingSystem = MeshLineCullingSystem',
			'const gpuOptions: MeshLineGPUPathOptions = { chunkSegments: 128 }',
			'const gpuPath: MeshLineGPUPath = new MeshLineGPUPath( options, gpuOptions )',
			'gpuPath.dispose()',
			'void cullingOptions',
			'void cullingConstructor',
		)
	}

	return source.join( '\n' )
}

const verifyProfile = async ( profile, temporaryDirectory, tarballPath, shaderTestSnapshot ) => {
	const consumerDirectory = resolve( temporaryDirectory, profile.id )
	const npmEnvironment = {
		...sanitizedEnvironment,
		npm_config_cache: resolve( temporaryDirectory, 'npm-cache' ),
		npm_config_update_notifier: 'false',
	}
	await mkdir( consumerDirectory, { recursive: true } )
	await writeFile( resolve( consumerDirectory, 'package.json' ), JSON.stringify( {
		name: `makio-meshline-${profile.id}-smoke`,
		private: true,
		type: 'module',
	}, null, 2 ) )

	const install = run(
		npmCommand,
		[
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--package-lock=false',
			`three@${profile.three}`,
			`@types/three@${profile.types}`,
			tarballPath,
		],
		{ cwd: consumerDirectory, env: npmEnvironment }
	)
	assertCommand( install, `${profile.label} consumer install` )

	const installedThreeManifest = JSON.parse( await readFile( resolve( consumerDirectory, 'node_modules/three/package.json' ), 'utf8' ) )
	const installedTypesManifest = JSON.parse( await readFile( resolve( consumerDirectory, 'node_modules/@types/three/package.json' ), 'utf8' ) )
	if ( profile.required && installedThreeManifest.version !== profile.three ) {
		throw new Error( `${profile.label} installed three@${installedThreeManifest.version}; expected ${profile.three}` )
	}
	if ( installedTypesManifest.version !== profile.types ) {
		throw new Error( `${profile.label} installed @types/three@${installedTypesManifest.version}; expected ${profile.types}` )
	}

	const runtimeSmokePath = resolve( consumerDirectory, 'smoke.mjs' )
	await writeFile( runtimeSmokePath, createRuntimeSmoke( profile.optionalEntries ) )
	assertCommand(
		run( process.execPath, [runtimeSmokePath], { cwd: consumerDirectory } ),
		`${profile.label} runtime smoke`
	)

	const typeSmokePath = resolve( consumerDirectory, 'smoke.ts' )
	await writeFile( typeSmokePath, createTypeSmoke( profile.optionalEntries ) )
	assertCommand( run( tscCommand, [
		'--noEmit',
		'--strict',
		'--skipLibCheck',
		'--module', 'NodeNext',
		'--moduleResolution', 'NodeNext',
		'--target', 'ES2022',
		'--lib', 'ES2022,DOM',
		typeSmokePath,
	], { cwd: consumerDirectory } ), `${profile.label} declaration smoke` )

	const shaderTestDirectory = resolve( consumerDirectory, 'shader-tests' )
	await cp( shaderTestSnapshot, shaderTestDirectory, { recursive: true } )
	const shaderTestRun = run(
		process.execPath,
		['--test', '--test-reporter=spec', ...shaderTestsFor( profile ).map( file => `test/${file}` )],
		{ cwd: shaderTestDirectory }
	)
	if ( shaderTestRun.status !== 0 ) {
		// Crash output comes first and failure details last; only passes are dropped.
		const stdout = ( shaderTestRun.stdout ?? '' ).split( '\n' ).filter( line => !/^\s*✔ /u.test( line ) ).join( '\n' )
		throw commandFailure( { ...shaderTestRun, stdout }, `${profile.label} shader tests` )
	}

	return {
		...publicProfile( profile ),
		installedThree: installedThreeManifest.version,
		installedTypes: installedTypesManifest.version,
		shaderTestCount: shaderTestRun.stdout.match( /ℹ tests (\d+)/u )?.[1],
		status: 'passed',
	}
}

const temporaryDirectory = await mkdtemp( resolve( tmpdir(), 'makio-meshline-compat-' ) )
const results = []
const failures = []

try {
	const npmEnvironment = {
		...sanitizedEnvironment,
		npm_config_cache: resolve( temporaryDirectory, 'npm-cache' ),
		npm_config_update_notifier: 'false',
	}
	const pack = run(
		npmCommand,
		['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryDirectory],
		{ cwd: packageDirectory, env: npmEnvironment }
	)
	assertCommand( pack, 'npm pack' )
	const [report] = JSON.parse( pack.stdout )
	const tarballPath = resolve( temporaryDirectory, report.filename )

	// One snapshot for every profile, taken with the tarball.
	const shaderTestSnapshot = resolve( temporaryDirectory, 'shader-tests' )
	for ( const source of shaderTestSources ) {
		await cp( resolve( rootDirectory, source ), resolve( shaderTestSnapshot, source ), {
			recursive: true,
			filter: path => basename( path ) !== 'node_modules',
		} )
	}
	await writeFile( resolve( shaderTestSnapshot, 'package.json' ), JSON.stringify( { private: true, type: 'module' }, null, 2 ) )

	for ( const profile of profiles ) {
		try {
			results.push( await verifyProfile( profile, temporaryDirectory, tarballPath, shaderTestSnapshot ) )
		} catch ( error ) {
			results.push( {
				...publicProfile( profile ),
				status: profile.required ? 'failed' : 'advisory-failed',
				error: error.message,
			} )
			if ( profile.required ) failures.push( error )
		}
	}
} finally {
	await rm( temporaryDirectory, { recursive: true, force: true } )
}

console.log( `makio-meshline@${packageManifest.version} Three.js compatibility matrix` )
for ( const result of results ) {
	const marker = result.status === 'passed' ? 'PASS' : result.status === 'advisory-failed' ? 'WARN' : 'FAIL'
	const installed = result.installedThree ? `three@${result.installedThree}, @types/three@${result.installedTypes}` : `three@${result.three}`
	const shaderTestCount = result.shaderTestCount ? `, ${result.shaderTestCount} shader tests` : ''
	console.log( `[${marker}] ${result.id}: ${result.coverage} runtime + declarations + ${result.shaderTests.length} shader test files (${installed}${shaderTestCount})` )
	if ( result.error ) console.log( result.error )
}

if ( failures.length > 0 ) process.exitCode = 1
