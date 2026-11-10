/**
 * Runs benchmarks/browser/suites.js in headless Chrome and prints the results.
 * No dependencies: a static server, a Chrome child process and its DevTools
 * WebSocket.
 *
 *   pnpm bench:browser
 *   pnpm bench:browser -- --only=startup,dynamic,growing,bending
 *   pnpm bench:browser -- --webgl --json=results.json
 *
 * Set CHROME_PATH when Chrome is not in a default location.
 */
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve( fileURLToPath( import.meta.url ), '../../..' )
const TIMEOUT_MS = 5 * 60 * 1000

const args = Object.fromEntries( process.argv.slice( 2 ).map( arg => {
	const [key, value = true] = arg.replace( /^--/, '' ).split( '=' )
	return [key, value]
} ) )

const CHROME_PATHS = [
	process.env.CHROME_PATH,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

const MIME_TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
}

//---------------------------------------------------------- STATIC SERVER
// Cross-origin isolation gives the page 5 µs timers instead of 100 µs.
function serveRepository() {
	const server = createServer( ( request, response ) => {
		const path = resolve( ROOT, `.${decodeURIComponent( new URL( request.url, 'http://localhost' ).pathname )}` )
		if ( !( path === ROOT || path.startsWith( ROOT + sep ) ) || !existsSync( path ) || !statSync( path ).isFile() ) {
			response.writeHead( 404 ).end()
			return
		}
		response.writeHead( 200, {
			'Content-Type': MIME_TYPES[extname( path )] ?? 'application/octet-stream',
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cache-Control': 'no-store',
		} )
		createReadStream( path ).pipe( response )
	} )
	return new Promise( done => server.listen( 0, '127.0.0.1', () => done( server ) ) )
}

//---------------------------------------------------------- CHROME
function launchChrome( profileDir ) {
	const executable = CHROME_PATHS.find( path => path && existsSync( path ) )
	if ( !executable ) throw new Error( 'Chrome not found. Set CHROME_PATH to a Chrome or Chromium executable.' )

	const chrome = spawn( executable, [
		'--headless=new',
		'--remote-debugging-port=0',
		`--user-data-dir=${profileDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--enable-unsafe-webgpu',
		'--window-size=1280,800',
		'about:blank',
	], { stdio: ['ignore', 'ignore', 'pipe'] } )

	const debuggerUrl = new Promise( ( done, fail ) => {
		let stderr = ''
		chrome.stderr.on( 'data', chunk => {
			stderr += chunk
			const match = stderr.match( /DevTools listening on (ws:\/\/\S+)/ )
			if ( match ) done( match[1] )
		} )
		chrome.once( 'exit', code => fail( new Error( `Chrome exited early (code ${code})\n${stderr}` ) ) )
	} )
	return { chrome, debuggerUrl }
}

// Minimal DevTools protocol client over the WebSocket built into Node.
function connect( url ) {
	const socket = new WebSocket( url )
	const pending = new Map()
	const listeners = new Map()
	let nextId = 1

	socket.addEventListener( 'message', event => {
		const message = JSON.parse( event.data )
		if ( message.id === undefined ) {
			listeners.get( message.method )?.( message.params )
			return
		}
		const { done, fail } = pending.get( message.id )
		pending.delete( message.id )
		if ( message.error ) fail( new Error( message.error.message ) )
		else done( message.result )
	} )

	return new Promise( ( ready, fail ) => {
		socket.addEventListener( 'error', () => fail( new Error( 'Could not reach Chrome DevTools' ) ) )
		socket.addEventListener( 'open', () => ready( {
			send: ( method, params = {}, sessionId ) => new Promise( ( done, fail ) => {
				const id = nextId++
				pending.set( id, { done, fail } )
				socket.send( JSON.stringify( { id, method, params, sessionId } ) )
			} ),
			on: ( method, listener ) => listeners.set( method, listener ),
			close: () => socket.close(),
		} ) )
	} )
}

async function runPage( browser, url ) {
	const { targetId } = await browser.send( 'Target.createTarget', { url: 'about:blank' } )
	const { sessionId } = await browser.send( 'Target.attachToTarget', { targetId, flatten: true } )
	const evaluate = async expression => {
		const { result, exceptionDetails } = await browser.send( 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId )
		if ( exceptionDetails ) throw new Error( exceptionDetails.exception?.description ?? exceptionDetails.text )
		return result.value
	}

	browser.on( 'Runtime.consoleAPICalled', ( { args: [first] } ) => {
		const text = String( first?.value ?? '' )
		if ( text.startsWith( '[bench] ' ) && args.verbose ) console.log( text.slice( 8 ) )
	} )
	browser.on( 'Runtime.exceptionThrown', ( { exceptionDetails } ) => {
		console.error( exceptionDetails.exception?.description ?? exceptionDetails.text )
	} )
	await browser.send( 'Runtime.enable', {}, sessionId )
	await browser.send( 'Page.enable', {}, sessionId )
	await browser.send( 'Page.navigate', { url }, sessionId )

	const deadline = Date.now() + TIMEOUT_MS
	while ( await evaluate( 'typeof window.__meshlineBench' ) === 'undefined' ) {
		if ( Date.now() > deadline ) throw new Error( 'The benchmark page did not start' )
		await new Promise( done => setTimeout( done, 100 ) )
	}
	let timeout
	try {
		return await Promise.race( [
			evaluate( 'window.__meshlineBench' ),
			new Promise( ( done, fail ) => {
				timeout = setTimeout( () => fail( new Error( 'The benchmark timed out' ) ), TIMEOUT_MS )
			} ),
		] )
	} finally {
		clearTimeout( timeout )
	}
}

//---------------------------------------------------------- REPORT
const ms = value => `${value.toFixed( value < 10 ? 2 : 1 )} ms`
const kb = value => value === null ? '—' : value >= 1024 ? `${( value / 1024 ).toFixed( 1 )} MB` : `${value.toFixed( 1 )} KB`

const TABLES = {
	startup: {
		title: 'First render of many lines',
		columns: {
			'lines': row => row.lines,
			'mode': row => row.mode,
			'first render': row => ms( row.firstRenderMs ),
			'per line': row => ms( row.perLineMs ),
			'shader graphs': row => row.shaderGraphs ?? '—',
			'programs': row => row.programs ?? '—',
			'steady render': row => ms( row.steadyRenderMs ),
		},
	},
	dynamic: {
		title: 'Every point moved each frame',
		columns: {
			'points': row => row.points.toLocaleString( 'en-US' ),
			'mode': row => row.mode === row.path ? row.mode : `${row.mode} → ${row.path}`,
			'setPositions': row => ms( row.setPositionsMs ),
			'frame': row => ms( row.frameMs ),
			'upload / frame': row => kb( row.uploadKB ),
		},
	},
	growing: {
		title: 'One point appended each frame',
		columns: {
			'points': row => row.points.toLocaleString( 'en-US' ),
			'mode': row => row.mode,
			'call': row => ms( row.callMs ),
			'frame': row => ms( row.frameMs ),
			'new buffers / frame': row => row.buffersPerFrame === null ? '—' : `${row.buffersPerFrame.toFixed( 1 )} (${kb( row.bufferKBPerFrame )})`,
			'upload / frame': row => kb( row.uploadKB ),
		},
	},
	bending: {
		title: 'Surface with round joins bending each frame',
		columns: {
			'points': row => row.points.toLocaleString( 'en-US' ),
			'mode': row => row.mode,
			'vertices': row => row.vertices.toLocaleString( 'en-US' ),
			'setPositions': row => ms( row.callMs ),
			'frame': row => ms( row.frameMs ),
			'new buffers / frame': row => row.buffersPerFrame === null ? '—' : `${row.buffersPerFrame.toFixed( 1 )} (${kb( row.bufferKBPerFrame )})`,
		},
	},
}

function printTable( { title, columns }, rows ) {
	const names = Object.keys( columns )
	const cells = rows.map( row => names.map( name => String( columns[name]( row ) ) ) )
	const widths = names.map( ( name, i ) => Math.max( name.length, ...cells.map( row => row[i].length ) ) )
	const format = row => row.map( ( cell, i ) => cell.padEnd( widths[i] ) ).join( '  ' )
	console.log( `\n${title}` )
	console.log( format( names ) )
	console.log( widths.map( width => '-'.repeat( width ) ).join( '  ' ) )
	for ( const row of cells ) console.log( format( row ) )
}

//---------------------------------------------------------- MAIN
const profileDir = mkdtempSync( join( tmpdir(), 'meshline-bench-' ) )
const server = await serveRepository()
const { chrome, debuggerUrl } = launchChrome( profileDir )

try {
	const browser = await connect( await debuggerUrl )
	const query = new URLSearchParams()
	if ( args.only ) query.set( 'only', args.only )
	if ( args.webgl ) query.set( 'webgl', '' )
	const url = `http://127.0.0.1:${server.address().port}/benchmarks/browser/index.html?${query}`

	const results = await runPage( browser, url )
	browser.close()
	if ( results.error ) throw new Error( results.error )

	console.log( `three r${results.three} · ${results.backend} · medians, each frame waits for the GPU to finish` )
	for ( const [name, rows] of Object.entries( results.suites ) ) printTable( TABLES[name], rows )
	if ( typeof args.json === 'string' ) {
		writeFileSync( args.json, JSON.stringify( results, null, '\t' ) )
		console.log( `\nSaved ${args.json}` )
	}
} finally {
	chrome.kill()
	server.close()
	await new Promise( done => chrome.once( 'exit', done ) )
	rmSync( profileDir, { recursive: true, force: true } )
}
