/**
 * Load JavaScript files dynamically.
 * @author Makio64 | David Ronai
 */

const scriptsLoaded = new Set()
const scriptsLoading = new Map()

/**
 * Loads a JavaScript file dynamically.
 *
 * @param {string} src - Script URL.
 * @returns {Promise} Return a promise which resolves when the script loads, rejects on failure.
 */
const loadScript = src => {
	if ( scriptsLoaded.has( src ) ) return Promise.resolve()
	if ( scriptsLoading.has( src ) ) return scriptsLoading.get( src )

	const promise = new Promise( ( resolve, reject ) => {
		const script = document.createElement( 'script' )
		script.src = src

		script.onload = () => {
			scriptsLoaded.add( src )
			scriptsLoading.delete( src )
			resolve()
		}

		script.onerror = () => {
			scriptsLoaded.delete( src )
			scriptsLoading.delete( src )
			script.remove()
			reject( new Error( `Failed to load script: ${src}` ) )
		}

		document.head.append( script )
	} )

	scriptsLoading.set( src, promise )
	return promise
}

export default loadScript
