/**
 * Headless Chrome over its DevTools WebSocket, for the start-up benchmark and the pipeline capture.
 * No dependencies: a static server for a built app, a Chrome child process with an empty profile.
 *
 * Set CHROME_PATH when Chrome is not in a default location.
 */
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'

const CHROME_PATHS = [
	process.env.CHROME_PATH,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const MIME_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webp': 'image/webp' }

export const sleep = ms => new Promise( done => setTimeout( done, ms ) )
export const within = ( promise, ms, what ) => Promise.race( [promise, sleep( ms ).then( () => { throw new Error( `Timed out: ${what}` ) } )] )

/** Serves a built app: unknown paths fall back to its index.html. Resolves to the origin and a close(). */
export async function serveDirectory( directory ) {
	const root = resolve( directory )
	if ( !existsSync( join( root, 'index.html' ) ) ) throw new Error( `No index.html in ${root}: build it first` )
	const server = createServer( ( request, response ) => {
		let path = resolve( root, `.${decodeURIComponent( new URL( request.url, 'http://localhost' ).pathname )}` )
		if ( !( path === root || path.startsWith( root + sep ) ) ) return response.writeHead( 404 ).end()
		if ( !existsSync( path ) || !statSync( path ).isFile() ) path = join( root, 'index.html' )
		response.writeHead( 200, { 'Content-Type': MIME_TYPES[extname( path )] ?? 'application/octet-stream', 'Cache-Control': 'no-store' } )
		createReadStream( path ).pipe( response )
	} )
	await new Promise( done => server.listen( 0, '127.0.0.1', done ) )
	return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

/**
 * Launches Chrome with a new empty profile and opens one page in it, `init` running in the page
 * before its scripts. Resolves to `{ evaluate, waitFor, errors, screenshot, close }`; `errors` collects
 * exceptions and console errors as they come.
 */
export async function openPage( url, { init = '', width = 1280, height = 800, dpr = 1, timeout = 60000 } = {} ) {
	const chromePath = CHROME_PATHS.find( path => path && existsSync( path ) )
	if ( !chromePath ) throw new Error( 'Chrome not found: set CHROME_PATH' )
	const profile = mkdtempSync( join( tmpdir(), 'meshline-chrome-' ) )
	const chrome = spawn( chromePath, [
		'--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
		'--enable-unsafe-webgpu', `--window-size=${width},${height}`, 'about:blank',
	], { stdio: ['ignore', 'ignore', 'pipe'] } )
	const exited = new Promise( done => chrome.once( 'exit', done ) )
	const close = async () => {
		chrome.kill()
		await exited
		rmSync( profile, { recursive: true, force: true } )
	}
	try {
		const socketUrl = await within( new Promise( ( done, fail ) => {
			let log = ''
			chrome.stderr.on( 'data', chunk => {
				log += chunk
				const match = log.match( /DevTools listening on (ws:\/\/\S+)/ )
				if ( match ) done( match[1] )
			} )
			exited.then( code => fail( new Error( `Chrome exited (${code})\n${log}` ) ) )
		} ), 20000, 'Chrome launch' )
		const socket = new WebSocket( socketUrl )
		await new Promise( ( done, fail ) => {
			socket.onopen = done
			socket.onerror = () => fail( new Error( 'DevTools unreachable' ) )
		} )
		let id = 0
		const pending = new Map()
		const errors = []
		let sessionId
		socket.onmessage = ( { data } ) => {
			const message = JSON.parse( data )
			if ( message.id !== undefined ) {
				const { done, fail } = pending.get( message.id )
				pending.delete( message.id )
				return message.error ? fail( new Error( message.error.message ) ) : done( message.result )
			}
			if ( message.sessionId !== sessionId ) return
			const { method, params } = message
			if ( method === 'Runtime.exceptionThrown' ) errors.push( params.exceptionDetails.exception?.description ?? params.exceptionDetails.text )
			if ( method === 'Runtime.consoleAPICalled' && params.type === 'error' ) errors.push( params.args.map( arg => arg.value ?? arg.description ).join( ' ' ) )
		}
		const send = ( method, params = {}, session ) => within( new Promise( ( done, fail ) => {
			pending.set( ++id, { done, fail } )
			socket.send( JSON.stringify( { id, method, params, sessionId: session } ) )
		} ), timeout, method )
		const { targetId } = await send( 'Target.createTarget', { url: 'about:blank' } )
		sessionId = ( await send( 'Target.attachToTarget', { targetId, flatten: true } ) ).sessionId
		await send( 'Runtime.enable', {}, sessionId )
		await send( 'Page.enable', {}, sessionId )
		await send( 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false }, sessionId )
		if ( init ) await send( 'Page.addScriptToEvaluateOnNewDocument', { source: init }, sessionId )
		await send( 'Page.navigate', { url }, sessionId )
		const evaluate = async expression => {
			const { result, exceptionDetails } = await send( 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId )
			if ( exceptionDetails ) throw new Error( exceptionDetails.exception?.description ?? exceptionDetails.text )
			return result.value
		}
		/** Polls `expression` until it is truthy, failing on a page error or after `timeout`. */
		const waitFor = async ( expression, ms = timeout ) => {
			const deadline = Date.now() + ms
			while ( !( await evaluate( expression ) ) ) {
				if ( errors.length ) throw new Error( `Page error:\n${errors.join( '\n' )}` )
				if ( Date.now() > deadline ) throw new Error( `Timed out waiting for ${expression}` )
				await sleep( 50 )
			}
		}
		return {
			evaluate,
			waitFor,
			errors,
			/** The page as PNG bytes. */
			screenshot: async () => Buffer.from( ( await send( 'Page.captureScreenshot', { format: 'png' }, sessionId ) ).data, 'base64' ),
			close: async () => {
				socket.close()
				await close()
			},
		}
	} catch ( error ) {
		await close()
		throw error
	}
}
