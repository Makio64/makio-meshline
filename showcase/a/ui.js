/**
 * Plan A overlay: 8 page dots (the statue page spans 3 scroll steps), #1..#8 hash deep links,
 * a page counter + station name, the hidden accessible text, and the finale links.
 * The shared scroll runs with ui:false / hash:false; this module maps pages <-> steps.
 * Dots and hashes call scroll.goTo() (a smooth, cancellable flight); the hash is written only
 * once a page is held.
 */
import './style.css'

export function createUI( { scroll, pages, stepPage, pageStep } ) {
	const root = document.createElement( 'div' )
	root.className = 'a-ui'
	root.innerHTML = `
		<a class="a-ui__brand" href="./">A · One Line</a>
		<nav class="a-ui__dots" aria-label="Pages"></nav>
		<div class="a-ui__count" aria-hidden="true"><span class="a-ui__n">01 / 08</span><span class="a-ui__name"></span></div>
		<div class="a-ui__hint" aria-hidden="true">scroll</div>
		<div class="a-ui__status"></div>
		<nav class="a-ui__links" aria-label="Links">
			<a href="https://meshline.makio.io" target="_blank" rel="noopener">Docs</a>
			<a href="https://meshline-demo.makio.io" target="_blank" rel="noopener">Demos</a>
			<a href="https://github.com/Makio64/makio-meshline" target="_blank" rel="noopener">GitHub</a>
		</nav>
	`
	document.body.append( root )

	// accessible copy of every page (the canvas is aria-hidden): one real section per scroll step
	pages.forEach( ( pg, i ) => {
		const section = scroll.sections[pageStep[i]]
		section.id = `page-${i + 1}`
		section.innerHTML = `<div class="sr-only"><h2>${pg.title}</h2><p>${pg.a11y}</p></div>`
	} )

	const dotsEl = root.querySelector( '.a-ui__dots' )
	const nEl = root.querySelector( '.a-ui__n' )
	const nameEl = root.querySelector( '.a-ui__name' )
	const hintEl = root.querySelector( '.a-ui__hint' )
	const statusEl = root.querySelector( '.a-ui__status' )
	const linksEl = root.querySelector( '.a-ui__links' )
	const dots = pages.map( ( pg, i ) => {
		const b = document.createElement( 'button' )
		b.type = 'button'
		b.className = 'a-ui__dot'
		b.title = pg.title
		b.setAttribute( 'aria-label', `${pg.title} (${i + 1} of ${pages.length})` )
		b.addEventListener( 'click', () => scroll.goTo( pageStep[i] ) )
		dotsEl.append( b )
		return b
	} )

	const readHash = () => {
		const n = parseInt( window.location.hash.slice( 1 ), 10 )
		return Number.isFinite( n ) ? Math.max( 0, Math.min( pages.length - 1, n - 1 ) ) : null
	}
	const onHash = () => {
		const pg = readHash()
		if ( pg !== null && stepPage[Math.round( scroll.raw )] !== pg ) scroll.goTo( pageStep[pg] )
	}
	window.addEventListener( 'hashchange', onHash )
	const initial = readHash()
	if ( initial !== null ) scroll.goTo( pageStep[initial], { instant: true } )

	const hideHint = () => hintEl.classList.add( 'is-hidden' )
	const opts = { once: true, passive: true }
	for ( const type of ['wheel', 'keydown', 'touchstart', 'scroll'] ) window.addEventListener( type, hideHint, opts )

	let lastPage = -1
	let lastHash = initial ?? 0
	/** m = dwell-mapped progress (scroll.mapped). DOM writes only when the page changes. */
	function update( m ) {
		const step = Math.max( 0, Math.min( stepPage.length - 1, Math.round( m ) ) )
		const pg = stepPage[step]
		if ( pg !== lastPage ) {
			lastPage = pg
			dots.forEach( ( d, i ) => {
				d.classList.toggle( 'is-active', i === pg )
				if ( i === pg ) d.setAttribute( 'aria-current', 'step' )
				else d.removeAttribute( 'aria-current' )
			} )
			nEl.textContent = `${String( pg + 1 ).padStart( 2, '0' )} / ${String( pages.length ).padStart( 2, '0' )}`
			nameEl.textContent = pages[pg].title
			linksEl.classList.toggle( 'is-on', pg === pages.length - 1 )
			if ( pg === pages.length - 1 ) hideHint() // the links take the bottom row on the last page
		}
		// hash only once the page is held (few replaceState calls)
		if ( pg !== lastHash && Math.abs( m - step ) < 1e-4 && !scroll.animating ) {
			lastHash = pg
			window.history.replaceState( window.history.state, '', `#${pg + 1}` )
		}
	}

	return {
		update,
		status( s ) { statusEl.textContent = s },
		dispose() { root.remove(); window.removeEventListener( 'hashchange', onHash ) },
	}
}
