/**
 * Scroll-jacked page progress: one smoothed float 0..count-1.
 *
 *   const pager = createPager( { count: 8, stage, labels: ['Enter', ...] } )
 *   stage.onFrame( () => {
 *   	const t = pager.local( 2 ) // -1 (arriving) .. 0 (centred) .. +1 (left)
 *   } )
 *
 * Inputs: wheel (normalized, trackpad friendly), touch drag + flick, keys
 * (arrows, PageUp/PageDown, space, Home/End), clickable dots, location.hash
 * (#1..#count, 1-based). After `snapDelay` ms idle it snaps: back to the gesture's page if it
 * moved < snapThreshold, else to the nearest page at least one step in the gesture direction.
 * prefers-reduced-motion: one page per gesture and a faster settle.
 * Writes CSS vars --page (float) and --page-i (int) on <html>.
 */
import { prefersReducedMotion } from './stage.js'

const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) )

/**
 * @param {object} o
 * @param {number} o.count number of pages (>= 1)
 * @param {(progress: number, pager: object) => void} [o.onProgress] called every frame the progress moves
 * @param {(page: number, pager: object) => void} [o.onPage] called when the nearest integer page changes
 * @param {number} [o.snapDelay=250] ms of idle before snapping
 * @param {number} [o.snapThreshold=0.1] pages a gesture must move before the snap turns the page
 * @param {number} [o.damping=6] higher = snappier follow (frame-rate independent)
 * @param {number} [o.wheelSpeed=1] pages per viewport-height of wheel delta
 * @param {number} [o.dragSpeed=1.4] pages per viewport-height of touch drag
 * @param {{ onFrame: Function }} [o.stage] tick inside the stage loop (else own rAF)
 * @param {boolean} [o.ui=true] dots + page counter + hint DOM
 * @param {string[]} [o.labels] dot titles / aria labels
 * @param {string} [o.hint] small hint text (e.g. 'scroll'), hidden after first input
 * @param {boolean} [o.hash=true] sync location.hash
 */
export function createPager( o ) {
	const {
		count,
		onProgress = null,
		onPage = null,
		snapDelay = 250,
		snapThreshold = 0.1,
		damping = prefersReducedMotion ? 14 : 6,
		wheelSpeed = 1,
		dragSpeed = 1.4,
		stage = null,
		ui = true,
		labels = [],
		hint = 'scroll',
		hash = true,
	} = o
	const max = Math.max( 0, count - 1 )
	let lastInput = 0
	let gestureBase = 0 // page where the current gesture started
	let holdUntil = 0
	let lastPage = -1
	let stepLock = false // reduced motion: one page per gesture
	let disposed = false

	const pager = {
		count,
		progress: 0,
		target: 0,
		velocity: 0,
		get page() { return Math.round( pager.progress ) },
		/** Per-page t: -1 arriving .. 0 centred .. +1 leaving (clamped). Scrolling back rewinds. */
		local( i ) { return clamp( pager.progress - i, -1, 1 ) },
		/** 1 when centred on page i, 0 one page away (linear). */
		presence( i ) { return 1 - Math.abs( pager.local( i ) ) },
		/** Jump smoothly (or instantly) to page i. */
		goTo( i, { instant = false } = {} ) {
			pager.target = clamp( Math.round( i ), 0, max )
			gestureBase = pager.target
			if ( instant ) pager.progress = pager.target
			lastInput = performance.now() - snapDelay // allow snap immediately
		},
		next() { pager.goTo( Math.round( pager.target ) + 1 ) },
		prev() { pager.goTo( Math.round( pager.target ) - 1 ) },
		/** Ignore user input for `ms` (e.g. while a count lands). */
		hold( ms ) { holdUntil = performance.now() + ms },
		update,
		dispose,
		el: null,
	}

	const input = () => {
		const now = performance.now()
		if ( now - lastInput > snapDelay ) gestureBase = clamp( Math.round( pager.target ), 0, max )
		lastInput = now
		if ( hintEl ) hintEl.classList.add( 'is-hidden' )
	}
	const blocked = () => performance.now() < holdUntil

	//------------------------------------------------------------------ WHEEL
	let wheelIdleTimer = 0
	const onWheel = ( e ) => {
		e.preventDefault()
		if ( blocked() ) return
		let dy = e.deltaY
		if ( Math.abs( e.deltaX ) > Math.abs( dy ) ) dy = e.deltaX
		if ( e.deltaMode === 1 ) dy *= 16
		else if ( e.deltaMode === 2 ) dy *= window.innerHeight
		input()
		if ( prefersReducedMotion ) {
			clearTimeout( wheelIdleTimer )
			wheelIdleTimer = setTimeout( () => { stepLock = false }, 180 )
			if ( stepLock || Math.abs( dy ) < 4 ) return
			stepLock = true
			return dy > 0 ? pager.next() : pager.prev()
		}
		dy = clamp( dy, -240, 240 )
		pager.target = clamp( pager.target + ( dy / Math.max( 1, window.innerHeight ) ) * wheelSpeed, -0.15, max + 0.15 )
	}

	//------------------------------------------------------------------ TOUCH
	let touchY = 0
	let touchStartY = 0
	let touchStartTarget = 0
	let touchT = 0
	const onTouchStart = ( e ) => {
		if ( e.touches.length !== 1 ) return
		touchY = touchStartY = e.touches[0].clientY
		touchStartTarget = pager.target
		touchT = performance.now()
		input()
	}
	const onTouchMove = ( e ) => {
		if ( e.touches.length !== 1 || blocked() ) return
		e.preventDefault()
		touchY = e.touches[0].clientY
		if ( prefersReducedMotion ) return
		const d = ( touchStartY - touchY ) / Math.max( 1, window.innerHeight )
		pager.target = clamp( touchStartTarget + d * dragSpeed, -0.15, max + 0.15 )
		input()
	}
	const onTouchEnd = () => {
		const dy = touchStartY - touchY
		const dt = Math.max( 1, performance.now() - touchT )
		const v = dy / dt // px per ms
		if ( Math.abs( dy ) > 30 && ( Math.abs( v ) > 0.5 || prefersReducedMotion ) ) {
			pager.goTo( Math.round( touchStartTarget ) + Math.sign( dy ) )
		}
		input()
	}

	//------------------------------------------------------------------ KEYS
	const onKey = ( e ) => {
		if ( e.target?.closest?.( 'input, textarea, select, [contenteditable]' ) ) return
		const k = e.key
		if ( k === 'ArrowDown' || k === 'PageDown' || ( k === ' ' && !e.shiftKey ) || k === 'ArrowRight' ) { e.preventDefault(); input(); pager.next() }
		else if ( k === 'ArrowUp' || k === 'PageUp' || ( k === ' ' && e.shiftKey ) || k === 'ArrowLeft' ) { e.preventDefault(); input(); pager.prev() }
		else if ( k === 'Home' ) { e.preventDefault(); input(); pager.goTo( 0 ) }
		else if ( k === 'End' ) { e.preventDefault(); input(); pager.goTo( max ) }
	}

	//------------------------------------------------------------------ HASH
	const readHash = () => {
		const n = parseInt( window.location.hash.slice( 1 ), 10 )
		return Number.isFinite( n ) ? clamp( n - 1, 0, max ) : null
	}
	const onHash = () => {
		const p = readHash()
		if ( p !== null && p !== Math.round( pager.target ) ) pager.goTo( p )
	}

	//------------------------------------------------------------------ UI
	let dots = []
	let countEl = null
	let hintEl = null
	if ( ui ) {
		const root = document.createElement( 'div' )
		root.className = 'pager-ui'
		const nav = document.createElement( 'nav' )
		nav.className = 'pager-dots'
		nav.setAttribute( 'aria-label', 'Pages' )
		for ( let i = 0; i < count; i++ ) {
			const b = document.createElement( 'button' )
			b.type = 'button'
			b.className = 'pager-dot'
			b.title = labels[i] ?? `Page ${i + 1}`
			b.setAttribute( 'aria-label', b.title )
			b.addEventListener( 'click', () => { input(); pager.goTo( i ) } )
			nav.append( b )
			dots.push( b )
		}
		countEl = document.createElement( 'div' )
		countEl.className = 'pager-count'
		root.append( nav, countEl )
		if ( hint ) {
			hintEl = document.createElement( 'div' )
			hintEl.className = 'pager-hint'
			hintEl.textContent = hint
			root.append( hintEl )
		}
		document.body.append( root )
		pager.el = root
	}

	// Snap after idle: back to the gesture's page when it barely moved, else at least one page
	// in the gesture direction (so a single wheel notch or a short drag turns a page).
	function snapTarget() {
		const d = pager.target - gestureBase
		if ( Math.abs( d ) < snapThreshold ) return gestureBase
		return clamp( gestureBase + Math.sign( d ) * Math.max( 1, Math.round( Math.abs( d ) ) ), 0, max )
	}

	//------------------------------------------------------------------ TICK
	let last = performance.now()
	function update( dt ) {
		const now = performance.now()
		if ( dt === undefined ) dt = Math.min( 0.1, ( now - last ) / 1000 )
		last = now
		if ( now - lastInput > snapDelay ) pager.target = snapTarget()
		const prev = pager.progress
		const k = 1 - Math.exp( -dt * damping )
		pager.progress += ( pager.target - pager.progress ) * k
		if ( Math.abs( pager.target - pager.progress ) < 1e-4 ) pager.progress = pager.target
		pager.velocity = dt > 0 ? ( pager.progress - prev ) / dt : 0
		const moved = pager.progress !== prev
		const page = clamp( Math.round( pager.progress ), 0, max )
		if ( moved || lastPage === -1 ) {
			document.documentElement.style.setProperty( '--page', pager.progress.toFixed( 4 ) )
			onProgress?.( pager.progress, pager )
		}
		if ( page !== lastPage ) {
			lastPage = page
			document.documentElement.style.setProperty( '--page-i', String( page ) )
			dots.forEach( ( d, i ) => d.classList.toggle( 'is-active', i === page ) )
			if ( countEl ) countEl.textContent = `${String( page + 1 ).padStart( 2, '0' )} / ${String( count ).padStart( 2, '0' )}`
			if ( hash && Math.round( pager.target ) === page ) history.replaceState( null, '', `#${page + 1}` )
			onPage?.( page, pager )
		}
	}

	let raf = 0
	let offFrame = null
	if ( stage ) offFrame = stage.onFrame( ( dt ) => update( dt ) )
	else {
		const tick = () => {
			if ( disposed ) return
			update()
			raf = requestAnimationFrame( tick )
		}
		raf = requestAnimationFrame( tick )
	}

	window.addEventListener( 'wheel', onWheel, { passive: false } )
	window.addEventListener( 'touchstart', onTouchStart, { passive: true } )
	window.addEventListener( 'touchmove', onTouchMove, { passive: false } )
	window.addEventListener( 'touchend', onTouchEnd )
	window.addEventListener( 'keydown', onKey )
	if ( hash ) window.addEventListener( 'hashchange', onHash )

	const initial = hash ? readHash() : null
	if ( initial !== null ) pager.goTo( initial, { instant: true } )
	update( 0 )

	function dispose() {
		disposed = true
		cancelAnimationFrame( raf )
		offFrame?.()
		window.removeEventListener( 'wheel', onWheel )
		window.removeEventListener( 'touchstart', onTouchStart )
		window.removeEventListener( 'touchmove', onTouchMove )
		window.removeEventListener( 'touchend', onTouchEnd )
		window.removeEventListener( 'keydown', onKey )
		window.removeEventListener( 'hashchange', onHash )
		pager.el?.remove()
	}

	return pager
}

export default createPager
