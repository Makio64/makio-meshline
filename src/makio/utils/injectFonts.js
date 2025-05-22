/**
 * Modern Font Injection & loading by @makio64 | David Ronai
 * @param {Array<{name: string, url: string, weight?: number}>} fonts
 * @param {boolean} [loadThem=true]
 * @returns {Promise} Resolves when fonts are loaded
 */
export default function loadFonts( fonts, loadThem = true ) {
	const fontCSS = fonts
		.map( ( { name, url, weight = 400 } ) => `
			@font-face {
				font-family: '${name}';
				src: url('${url}.woff2') format('woff2'),
						url('${url}.woff') format('woff');
				font-weight: ${weight};
				font-style: normal;
				font-display: swap;
			}`.trim() ).join( '\n' )

	const style = document.createElement( 'style' )
	style.setAttribute( 'type', 'text/css' )
	style.setAttribute( 'rel', 'preload' )
	style.setAttribute( 'as', 'style' )
	style.setAttribute( 'crossorigin', 'anonymous' )
	style.textContent = fontCSS
	document.head.appendChild( style )

	if ( loadThem && document.fonts ) {
		const promises = fonts.map( ( { name } ) =>
			document.fonts.load( `1em "${name}"` )
				.then( () => console.log( `"${name}" loaded` ) )
				.catch( err => console.warn( `Error loading "${name}":`, err ) )
		)
		return Promise.all( promises )
	}

	return Promise.resolve()
}
