// Exposes the docs to in-browser AI agents through WebMCP. The theme imports
// this module only when the browser has a model context; the page snapshot
// loads on the first tool call.
import { withBase } from 'vitepress'

import { registerTools } from './register.js'
import { createDocsTools } from './tools.js'

const DEMO_URL = 'https://meshline-demo.makio.io/'

let dispose = null

export function setupWebMcp( { router, siteData } ) {
	dispose?.()
	const referencePath = '/llms-full.txt'
	let reference = null
	const tools = createDocsTools( {
		loadPages: () => import( './pages.data.js' ).then( module => module.data ),
		loadReference: ( { signal } = {} ) => {
			reference ||= fetch( withBase( referencePath ), { signal } )
				.then( response => {
					if ( !response.ok ) throw new Error( `llms-full.txt: HTTP ${response.status}` )
					return response.text()
				} )
				.catch( error => {
					reference = null
					throw error
				} )
			return reference
		},
		navigate: href => router.go( withBase( href ) ),
		getCurrentPath: () => router.route.path.slice( siteData.value.base.length - 1 ),
		getSidebar: () => siteData.value.themeConfig.sidebar,
		origin: window.location.origin,
		referencePath,
		demoUrl: DEMO_URL
	} )
	dispose = registerTools( tools, {
		onError: ( name, error ) => console.warn( `[WebMCP] ${name} was not registered:`, error )
	} )
	return dispose
}

if ( import.meta.hot ) import.meta.hot.dispose( () => dispose?.() )
