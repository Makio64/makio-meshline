/**
 * Start-up time of built standalone apps (dist/<name>) in headless Chrome, A/B.
 * No dependencies: a static server per build, a fresh Chrome per load and its DevTools WebSocket.
 *
 *   node benchmarks/browser/startup.mjs --builds=before:/tmp/a,after:dist/rice-field --runs=4 --guard=1200000
 *
 * Loads alternate between builds (ABBA...), each in a new browser with an empty profile.
 * `--guard=<seed>` makes every shader new to the machine (a different seed per load), as on a first
 * visit: Metal keeps compiled shaders across browsers, so without it every load after the first is
 * warm. Seeds are 1,000,000 to 16,000,000: take a range no earlier run used. `--guard=0` (default)
 * measures warm loads, after one discarded priming load per build.
 *
 * Ready is the first complete frame: the app says so (`data-ready` on <html>), or in an older build
 * its loading line has gone; two frames have been drawn since, and the GPU has finished them.
 *
 * Set CHROME_PATH when Chrome is not in a default location.
 */
import { resolve } from 'node:path'

import { openPage, serveDirectory } from '../../scripts/headless-chrome.mjs'

const args = Object.fromEntries( process.argv.slice( 2 ).map( arg => {
	const [key, value = 'true'] = arg.replace( /^--/, '' ).split( '=' )
	return [key, value]
} ) )
const builds = ( args.builds ?? '' ).split( ',' ).filter( Boolean ).map( entry => {
	const [name, dir] = entry.includes( ':' ) ? entry.split( ':' ) : [entry, entry]
	return { name, dir: resolve( dir ) }
} )
if ( builds.length === 0 ) throw new Error( 'Pass --builds=name:dir[,name:dir]' )
const runs = Number( args.runs ?? 3 )
const guardBase = Number( args.guard ?? 0 )
if ( guardBase !== 0 && ( guardBase < 1_000_000 || guardBase + runs * builds.length > 16_000_000 ) ) throw new Error( 'Invalid --guard' )
const [width, height] = ( args.size ?? '1280x800' ).split( 'x' ).map( Number )
const dpr = Number( args.dpr ?? 2 )
const query = args.query ?? ''
const TIMEOUT = 60000

/** Runs in the page before its scripts: shader guard, pipeline log, device and ready marks. */
function instrument( guard ) {
	const report = { pipelines: [], longTasks: [], guarded: 0, shaders: 0 }
	globalThis.__startup = report
	new PerformanceObserver( list => {
		for ( const entry of list.getEntries() ) report.longTasks.push( Math.round( entry.duration ) )
	} ).observe( { type: 'longtask', buffered: true } )
	new MutationObserver( ( _, observer ) => {
		const shown = 'ready' in document.documentElement.dataset || ( report.loadingSeen && !document.querySelector( '.Standalone__loading' ) )
		if ( shown && report.initMs === undefined ) {
			report.initMs = performance.now()
			observer.disconnect()
			requestAnimationFrame( () => requestAnimationFrame( async () => {
				await report.device?.queue.onSubmittedWorkDone()
				report.readyMs = performance.now()
			} ) )
		}
		if ( document.querySelector( '.Standalone__loading' ) ) report.loadingSeen = true
	} ).observe( document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ready'] } )
	if ( !globalThis.GPUAdapter ) return
	const requestDevice = GPUAdapter.prototype.requestDevice
	GPUAdapter.prototype.requestDevice = async function ( ...rest ) {
		const device = await requestDevice.apply( this, rest )
		report.device ??= device
		report.deviceMs ??= performance.now()
		return device
	}
	const createShaderModule = GPUDevice.prototype.createShaderModule
	GPUDevice.prototype.createShaderModule = function ( descriptor ) {
		let code = descriptor.code
		report.shaders++
		if ( guard ) {
			// Conditions no frame meets, with a constant new to the machine: other source, other binary.
			const flow = code.indexOf( '// local vars' )
			if ( code.includes( '@compute' ) && /\bglobalId\b/.test( code ) && flow >= 0 ) {
				code = code.slice( 0, flow ) + code.slice( flow ).replaceAll( /\bglobalId\.x\b/g, `(globalId.x + select(0u, 1u, globalId.x > ${4_000_000_000 - guard}u))` )
			} else if ( code.includes( '@vertex' ) && code.includes( 'varyings.builtinClipSpace' ) && code.includes( 'return varyings;' ) ) {
				code = code.replace( 'return varyings;', `if (varyings.builtinClipSpace.x > ${guard}.0) { varyings.builtinClipSpace.x = 0.0; }\nreturn varyings;` )
			} else if ( code.includes( '@fragment' ) && code.includes( 'return output;' ) ) {
				const [, name, type] = /struct Output(?:Struct|Type)?\s*\{\s*@location\(\s*0\s*\)\s*(\w+)\s*:\s*(\w+)/.exec( code ) ?? []
				if ( name ) {
					const target = `output.${name}${type === 'f32' ? '' : type.startsWith( 'vec' ) ? '.x' : ''}`
					code = code.replace( 'return output;', `if (${target} > ${guard}.0) { ${target} = 0.0; }\nreturn output;` )
				}
			} else if ( code.includes( '@fragment' ) ) {
				const match = /fn main\([^)]*\)\s*->\s*@location\(\s*0\s*\)\s*vec4<f32>\s*\{/.exec( code )
				if ( match ) code = code.replace( /return\s+([^;]+);(\s*\}\s*)$/, `let guarded = $1;\nif (guarded.x > ${guard}.0) { return vec4<f32>(0.0); }\nreturn guarded;$2` )
			}
			if ( code !== descriptor.code ) report.guarded++
		}
		return createShaderModule.call( this, { ...descriptor, code } )
	}
	for ( const method of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync'] ) {
		const original = GPUDevice.prototype[method]
		GPUDevice.prototype[method] = function ( ...rest ) {
			const entry = { method, label: rest[0]?.label, start: performance.now(), ms: 0 }
			report.pipelines.push( entry )
			const result = original.apply( this, rest )
			if ( result instanceof Promise ) return result.finally( () => { entry.ms = performance.now() - entry.start } )
			entry.ms = performance.now() - entry.start
			return result
		}
	}
}

async function load( build, origin, guard ) {
	const page = await openPage( `${origin}/${query}`, { init: `(${instrument})(${guard})`, width, height, dpr, timeout: TIMEOUT } )
	try {
		await page.waitFor( 'globalThis.__startup?.readyMs !== undefined' )
		const result = await page.evaluate( `(() => {
			const r = globalThis.__startup
			const script = performance.getEntriesByType( 'resource' ).find( e => e.initiatorType === 'script' )
			const pipes = r.pipelines
			const ends = pipes.map( p => p.start + p.ms )
			return {
				ready: r.readyMs, init: r.initMs, device: r.deviceMs, script: script?.responseEnd,
				sync: pipes.filter( p => !p.method.endsWith( 'Async' ) ).length, async: pipes.filter( p => p.method.endsWith( 'Async' ) ).length,
				firstPipeline: pipes.length ? Math.min( ...pipes.map( p => p.start ) ) : null, lastPipeline: ends.length ? Math.max( ...ends ) : null,
				shaders: r.shaders, guarded: r.guarded, longTasks: r.longTasks,
			}
		})()` )
		if ( page.errors.length ) result.errors = page.errors
		return result
	} finally {
		await page.close()
	}
}

const servers = await Promise.all( builds.map( build => serveDirectory( build.dir ) ) )
const origins = servers.map( server => server.origin )
const results = Object.fromEntries( builds.map( build => [build.name, []] ) )
const round = n => n === null || n === undefined ? '—' : Math.round( n )
try {
	if ( guardBase === 0 ) {
		for ( const [i, build] of builds.entries() ) await load( build, origins[i], 0 )
	}
	let seed = guardBase
	for ( let run = 0; run < runs; run++ ) {
		// ABBA: each build goes first as often as it goes last.
		const order = builds.map( ( build, i ) => i )
		if ( run % 2 === 1 ) order.reverse()
		for ( const i of order ) {
			const result = await load( builds[i], origins[i], guardBase ? seed++ : 0 )
			results[builds[i].name].push( result )
			console.log( `${builds[i].name.padEnd( 10 )} ready ${round( result.ready )} ms · init ${round( result.init )} · device ${round( result.device )} · script ${round( result.script )} · pipelines ${result.sync} sync + ${result.async} async, ${round( result.firstPipeline )}–${round( result.lastPipeline )} ms · shaders ${result.shaders}${guardBase ? ` (${result.guarded} guarded)` : ''} · long tasks ${result.longTasks.join( ' ' )}${result.errors ? ` · ERRORS ${result.errors.length}` : ''}` )
		}
	}
} finally {
	servers.forEach( server => server.close() )
}
const median = values => {
	const sorted = values.filter( value => value !== null && value !== undefined ).sort( ( a, b ) => a - b )
	return sorted.length ? sorted[Math.floor( ( sorted.length - 1 ) / 2 )] + sorted[Math.ceil( ( sorted.length - 1 ) / 2 )] >> 1 : null
}
console.log( `\n${guardBase ? 'cold' : 'warm'}, ${width}×${height} at DPR ${dpr}, medians of ${runs}:` )
for ( const [name, list] of Object.entries( results ) ) {
	console.log( `${name.padEnd( 10 )} ready ${median( list.map( r => r.ready ) )} ms · init ${median( list.map( r => r.init ) )} · device ${median( list.map( r => r.device ) )} · last pipeline ${median( list.map( r => r.lastPipeline ) )}` )
}
