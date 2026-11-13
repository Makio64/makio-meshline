import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

import vue from '../demo/node_modules/@vitejs/plugin-vue/dist/index.mjs'
import { createServer } from '../demo/node_modules/vite/dist/node/index.js'

// Demos share one stage. A demo left while its init() still awaits finishes that init later, and
// whatever it adds then must not end up in the next demo. These tests run the real ExampleView.vue
// against a stage that records what happens to it.

const require = createRequire( new URL( '../demo/package.json', import.meta.url ) )
const { createRenderer, h, nextTick, provide, ref, ssrContextKey } = require( 'vue' )

const log = []
const signal = () => {
	const handlers = new Set()
	return { handlers, add: handler => handlers.add( handler ), remove: handler => handlers.delete( handler ) }
}
const stage = { onUpdate: signal(), onResize: signal() }
const stage3d = {
	backend: 'test',
	renderer: null,
	scene: [],
	owned: [],
	add( ...objects ) { this.scene.push( ...objects ) },
	own( resource ) {
		this.owned.push( resource )
		return resource
	},
	listen( source, ...args ) {
		source.add( ...args )
		this.own( () => source.remove( ...args ) )
	},
	clearDemo() {
		log.push( 'clearDemo' )
		for ( const resource of this.owned.splice( 0 ).reverse() ) resource()
		this.scene.length = 0
	},
}
const demos = {}
globalThis.__exampleView = {
	stage,
	stage3d,
	store: { contentLoaded: ref( false ), menuOpen: ref( false ) },
	resolveDemoMeta: id => demos[id] && { id, title: id, subtitle: '', blurb: '', sourceFile: `${id}.js`, load: async () => ( { default: demos[id] } ) },
	describeDemoFailure: ( phase, error ) => ( { phase, eyebrow: '', title: '', summary: String( error?.message ?? error ), guidance: [], detail: '' } ),
}
const FAKES = {
	'@/demoMeta': 'export const resolveDemoMeta = id => globalThis.__exampleView.resolveDemoMeta( id )',
	'@/makio/core/stage': 'export default globalThis.__exampleView.stage',
	'@/makio/three/stage3d': 'export default globalThis.__exampleView.stage3d',
	'@/store': 'export const { contentLoaded, menuOpen } = globalThis.__exampleView.store',
	'@/utils/demoFailure': 'export const describeDemoFailure = ( ...args ) => globalThis.__exampleView.describeDemoFailure( ...args )',
}

const hostRenderer = createRenderer( {
	patchProp() {},
	insert( child, parent ) { child.parent = parent },
	remove( child ) { child.parent = null },
	createElement: type => ( { type } ),
	createText: text => ( { type: 'text', text } ),
	createComment: text => ( { type: 'comment', text } ),
	setText() {},
	setElementText() {},
	parentNode: node => node.parent ?? null,
	nextSibling: () => null,
} )

let vite
let ExampleView
// Its own cache, so a running `pnpm dev` keeps the demo's.
const cacheDir = mkdtempSync( join( tmpdir(), 'meshline-view-lifetime-' ) )

before( async () => {
	globalThis.window = new EventTarget()
	vite = await createServer( {
		root: new URL( '../demo', import.meta.url ).pathname,
		configFile: false,
		cacheDir,
		optimizeDeps: { noDiscovery: true },
		plugins: [
			vue(),
			{
				name: 'example-view-fakes',
				enforce: 'pre',
				resolveId: id => id in FAKES ? `\0${id}` : undefined,
				load: id => id.startsWith( '\0' ) ? FAKES[id.slice( 1 )] : undefined,
			},
		],
		server: { middlewareMode: true },
		appType: 'custom',
		logLevel: 'silent',
	} )
	;( { default: ExampleView } = await vite.ssrLoadModule( '/src/ExampleView.vue' ) )
	ExampleView.render = () => null
} )

after( async () => {
	await vite?.close()
	rmSync( cacheDir, { recursive: true, force: true } )
} )

beforeEach( () => {
	log.length = 0
	stage3d.scene.length = 0
	stage3d.owned.length = 0
	stage.onUpdate.handlers.clear()
	for ( const id of Object.keys( demos ) ) delete demos[id]
} )

// Lets every pending promise and Vue update run.
const flush = () => new Promise( resolve => setImmediate( resolve ) )

// A router stand-in: one ExampleView keyed by the demo id, re-mounted when the id changes.
async function openDemos( id ) {
	const current = ref( id )
	const view = ref( null )
	const app = hostRenderer.createApp( {
		setup() {
			// The component is compiled for SSR, which registers itself with this context.
			provide( ssrContextKey, { modules: new Set() } )
			return () => h( ExampleView, { key: current.value, ref: view } )
		},
	} )
	app.config.globalProperties.$router = { get params() { return { id: current.value } } }
	app.mount( { type: 'root' } )
	await flush()
	return {
		view,
		async open( next ) {
			current.value = next
			await nextTick()
			await flush()
		},
		async close() {
			app.unmount()
			await flush()
		},
	}
}

// A demo whose init() adds to the stage, then waits for `gate` before adding more.
function gatedDemo( name, { fail = false } = {} ) {
	let release
	const gate = new Promise( resolve => { release = resolve } )
	demos[name] = class {
		update = () => {}
		async init() {
			log.push( `${name}:init` )
			stage3d.add( `${name}:early` )
			stage3d.own( () => log.push( `${name}:early released` ) )
			await gate
			log.push( `${name}:late` )
			stage3d.add( `${name}:late` )
			stage3d.own( () => log.push( `${name}:late released` ) )
			if ( fail ) throw new Error( `${name} failed late` )
		}
		dispose() { log.push( `${name}:dispose` ) }
	}
	return release
}

function plainDemo( name ) {
	demos[name] = class {
		update = () => {}
		async init() {
			log.push( `${name}:init` )
			stage3d.add( name )
		}
	}
	return demos[name]
}

async function quietly( run ) {
	const errors = []
	const { error } = console
	console.error = ( ...args ) => errors.push( args )
	try {
		await run()
	} finally {
		console.error = error
	}
	return errors
}

test( 'a demo left during init() finishes and is cleared before the next demo starts', async () => {
	const release = gatedDemo( 'slow' )
	plainDemo( 'next' )
	const router = await openDemos( 'slow' )
	assert.deepEqual( log, ['slow:init'] )

	await router.open( 'next' )
	// Leaving disposes the demo and clears what it built so far; the next demo waits.
	assert.deepEqual( log, ['slow:init', 'slow:dispose', 'clearDemo', 'slow:early released'] )
	assert.deepEqual( stage3d.scene, [] )

	release()
	await flush()
	assert.deepEqual( log.slice( 4 ), ['slow:late', 'clearDemo', 'slow:late released', 'next:init'] )
	assert.deepEqual( stage3d.scene, ['next'] )
	assert.equal( stage3d.owned.length, 1 ) // next's update subscription
	assert.deepEqual( [...stage.onUpdate.handlers], [router.view.value.example.update] )
	assert.equal( router.view.value.isInitialized, true )
	await router.close()
} )

test( 'a demo left while it waits for the previous one never starts', async () => {
	const release = gatedDemo( 'slow' )
	plainDemo( 'skipped' )
	plainDemo( 'next' )
	const router = await openDemos( 'slow' )
	await router.open( 'skipped' )
	await router.open( 'next' )
	assert.equal( log.includes( 'skipped:init' ), false )
	assert.equal( log.includes( 'next:init' ), false )

	release()
	await flush()
	assert.equal( log.includes( 'skipped:init' ), false )
	assert.deepEqual( log.slice( -4 ), ['slow:late', 'clearDemo', 'slow:late released', 'next:init'] )
	assert.deepEqual( stage3d.scene, ['next'] )
	await router.close()
} )

test( 'a dead init() that rejects is still cleared, and the next demo shows no failure', async () => {
	const release = gatedDemo( 'doomed', { fail: true } )
	plainDemo( 'next' )
	const router = await openDemos( 'doomed' )
	await router.open( 'next' )

	const errors = await quietly( async () => {
		release()
		await flush()
	} )
	assert.deepEqual( errors, [] )
	assert.deepEqual( log.slice( -4 ), ['doomed:late', 'clearDemo', 'doomed:late released', 'next:init'] )
	assert.deepEqual( stage3d.scene, ['next'] )
	assert.equal( router.view.value.failure, null )
	await router.close()
} )

test( 'a demo that fails while its init() awaits leaves nothing for the next demo', async () => {
	const release = gatedDemo( 'broken' )
	plainDemo( 'next' )
	const router = await openDemos( 'broken' )

	const errors = await quietly( async () => {
		window.dispatchEvent( Object.assign( new Event( 'error' ), { error: new Error( 'an asset failed' ) } ) )
		await flush()
		release()
		await flush()
	} )
	assert.equal( errors.length, 1 )
	assert.equal( router.view.value.failure.phase, 'init' )
	// What the init added after the failure is cleared once it settles.
	assert.deepEqual( stage3d.scene, [] )
	assert.equal( stage3d.owned.length, 0 )

	await router.open( 'next' )
	assert.deepEqual( stage3d.scene, ['next'] )
	await router.close()
} )

test( 'a demo whose dispose() throws still has its stage cleared', async () => {
	demos.brittle = class {
		async init() { stage3d.add( 'brittle' ) }
		dispose() { throw new Error( 'dispose failed' ) }
	}
	plainDemo( 'next' )
	const router = await openDemos( 'brittle' )

	const errors = await quietly( () => router.open( 'next' ) )
	assert.equal( errors.length, 1 )
	assert.deepEqual( log, ['clearDemo', 'next:init'] )
	assert.deepEqual( stage3d.scene, ['next'] )
	await router.close()
} )
