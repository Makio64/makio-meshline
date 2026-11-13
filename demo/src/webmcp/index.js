// Exposes the demos to in-browser AI agents through WebMCP. App.vue imports this
// module only when the browser has a model context. `register.js` is a copy of
// the docs site's (test/demo-webmcp.test.js keeps the two identical).
import { routeState, useRouter } from 'vue-tiny-router'

import { demoCatalog, demoSections } from '@/demoCatalog'

import { findControl, readScreen, useControl } from './controls.js'
import { registerTools } from './register.js'
import { createDemoTools } from './tools.js'

// Each source is its own chunk, fetched only when an agent asks for it.
const sources = import.meta.glob( '../demos/*.js', { query: '?raw', import: 'default' } )

let dispose = null
let stage3d = null
const loadStage = () => import( '@/makio/three/stage3d' ).then( module => ( stage3d = module.default ) )

export function setupWebMcp() {
	dispose?.()
	loadStage()
	const router = useRouter()
	const tools = createDemoTools( {
		catalog: demoCatalog,
		sections: demoSections,
		// The router mounts after the translations load: until then, read the address bar.
		getCurrentId: () => routeState.value.params?.id || window.location.pathname.match( /^\/examples\/([^/]+)/ )?.[1] || null,
		navigate: path => router.push( path ),
		// `objects`: what the demo added to the scene, the only progress sign some demos give.
		screen: { read: () => ( { ...readScreen( document ), objects: stage3d?.scene?.children.length ?? 0 } ), find: findControl, use: useControl },
		loadSource: async file => ( await sources[`../demos/${file}`]?.() ) ?? null,
		getBackend: async () => ( await loadStage() ).backend,
		getTitle: () => document.title,
		origin: window.location.origin
	} )
	dispose = registerTools( tools, {
		onError: ( name, error ) => console.warn( `[WebMCP] ${name} was not registered:`, error )
	} )
	return dispose
}

if ( import.meta.hot ) import.meta.hot.dispose( () => dispose?.() )
