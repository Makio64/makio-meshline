/**
 * The page's loader (index.html), from the ultra-msdf-threejs gallery: a hairline that fills over a
 * label and a figure. It is in the HTML so that it paints with the page, before any script; this
 * drives it once the app runs. The line moves on the compositor, so a busy main thread cannot stop it.
 */
export function adoptLoader( element ) {
	if ( !element ) return { set() {}, leave() {} }
	const fill = element.querySelector( '.StandaloneLoader__line i' )
	const figure = element.querySelector( '.StandaloneLoader__status b' )
	let shown = -1
	return {
		/** Fills to `fraction` (0–1); the figure changes with whole percents only, and never goes back. */
		set( fraction ) {
			const percent = Math.round( Math.min( 1, Math.max( 0, fraction ) ) * 100 )
			if ( percent <= shown ) return
			shown = percent
			fill.style.transform = `scaleX(${percent / 100})`
			figure.textContent = String( percent )
			element.setAttribute( 'aria-valuenow', String( percent ) )
		},
		/** Full, then gone. */
		leave() {
			this.set( 1 )
			element.classList.add( 'is-done' )
			const fade = element.animate( [{ opacity: 1 }, { opacity: 0 }], { duration: 520, delay: 280, easing: 'ease-in', fill: 'forwards' } )
			fade.finished.finally( () => element.remove() )
		},
	}
}
