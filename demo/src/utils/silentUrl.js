// vue-tiny-router re-mounts the view for every URL it hears of through the Navigation API, query
// and hash included, which rebuilds the demo on screen. Listeners on `navigation` run in the order
// they were added, so main.js imports this module before the router.
let silent = false

// `globalThis`: the Node tests of the modules that write URLs import this one too.
globalThis.navigation?.addEventListener( 'navigate', event => {
	if ( !silent ) return
	// The router cancels the navigations it takes over: one already cancelled means it was added first.
	if ( event.defaultPrevented ) console.warn( '[meshline demo] @/utils/silentUrl has to be imported before vue-tiny-router' )
	event.stopImmediatePropagation()
} )

/** Replace the address bar URL without a route change: the demo on screen stays the one it is. */
export function replaceUrlSilently( url ) {
	silent = true
	try {
		window.history.replaceState( null, '', url )
	} catch {
		// Ignore browser history rate limits.
	} finally {
		silent = false
	}
}
