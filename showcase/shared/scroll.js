/**
 * Native document scroll -> damped page progress with dwell plateaus.
 *
 *   const scroll = createScroll( { count: 5, stage, labels: ['Intro', ...] } )
 *   stage.onFrame( () => {
 *   	const t = scroll.local( 2 )    // -1 arriving .. 0 held .. +1 leaving (dwell-mapped, clamped)
 *   	const k = scroll.presence( 2 ) // 1 - |local|
 *   } )
 *
 * - A tall spacer (`scroll.track`, one `section.ms-page` per page) gives the page real scroll
 *   height: wheel, trackpad, touch momentum, keys, the scrollbar and find-in-page all just work.
 * - raw = scrollY / pageHeight. progress = critically damped follow of raw (frame-rate
 *   independent, C1: velocity never jumps). mapped = dwell map of progress: each page HOLDS over the
 *   middle `dwell` of its scroll range and transitions in between (quintic, C2).
 * - Momentum-aware plateaus: when the scroll leaves a page toward the next one, the next page's
 *   plateau is fixed for that whole transition: held when you arrive at reading speed, flown
 *   through when you arrive fast (fling, multi-page dot / hash jump), partially in between.
 *   Inside a transition the map is a pure C2 function of progress, so there is never a lurch.
 * - Optional settle: after `settleDelay` ms without input, resting outside a held plateau eases the
 *   scroll into the nearest one. Any input cancels it at once.
 * - Dots, `#n` deep links, Space / PageUp / PageDown / Home / End scroll smoothly (cancellable).
 * - At rest the state is the pure function dwellMap( progress ): scrolling back rewinds exactly.
 * - prefers-reduced-motion: no smoothing, instant jumps, no settle, every page held.
 * - Writes CSS vars on <html>: --page (mapped float), --page-i (int), --progress (0..1).
 *
 * Create it BEFORE other stage.onFrame callbacks so they read this frame's values
 * (stage.onFrame runs callbacks in registration order).
 */
import { prefersReducedMotion } from './stage.js'

const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) )
const smootherstep = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 )
const easeInOutCubic = ( t ) => ( t < 0.5 ? 4 * t * t * t : 1 - Math.pow( -2 * t + 2, 3 ) / 2 )
const easeInOutSine = ( t ) => -( Math.cos( Math.PI * t ) - 1 ) / 2

/** Quintic Hermite with zero second derivatives at both ends (C2 joins), t in 0..1. */
const quintic = ( y0, y1, m0, m1, t ) => {
	const t3 = t * t * t
	const t4 = t3 * t
	const t5 = t4 * t
	return y0 * ( 1 - 10 * t3 + 15 * t4 - 6 * t5 ) + m0 * ( t - 6 * t3 + 8 * t4 - 3 * t5 ) + m1 * ( -4 * t3 + 7 * t4 - 3 * t5 ) + y1 * ( 10 * t3 - 15 * t4 + 6 * t5 )
}

/**
 * Dwell map with per-page plateau slopes. skip[k] = 0: page k holds still over
 * [k - dwell/2, k + dwell/2]; 1: passes straight through; in between: a slow zone. C2 everywhere.
 * With no `skip` (all 0) this is the static map: smootherstep transitions between flat plateaus. Pure.
 * @param {number} p progress 0..max
 * @param {number} dwell plateau fraction of a page (0..0.9)
 * @param {number} max last page index
 * @param {ArrayLike<number>} [skip] per page 0..1
 */
export function dwellMap( p, dwell, max, skip = null ) {
	const c = clamp( p, 0, max )
	if ( dwell <= 0 ) return c
	const h = dwell * 0.5
	const k = Math.floor( c )
	if ( k >= max ) return max
	const f = c - k
	const s0 = skip ? skip[k] : 0
	const s1 = skip ? skip[k + 1] : 0
	if ( f <= h ) return k + s0 * f
	if ( f >= 1 - h ) return k + 1 - s1 * ( 1 - f )
	const w = 1 - dwell
	return k + quintic( s0 * h, 1 - s1 * h, s0 * w, s1 * w, ( f - h ) / w )
}

const STYLE_ID = 'ms-scroll-style'
const CSS = `
html.ms-scroll { height: auto; overflow-x: hidden; overflow-y: auto; touch-action: pan-y pinch-zoom; overscroll-behavior: none; scroll-behavior: auto !important; scrollbar-width: thin; scrollbar-color: rgba(236, 233, 226, 0.22) transparent; }
html.ms-scroll body { height: auto; min-height: 100%; overflow: visible; touch-action: pan-y pinch-zoom; }
.ms-track { position: relative; z-index: 1; width: 100%; margin: 0; padding: 0; pointer-events: none; }
.ms-page { position: relative; width: 100%; margin: 0; overflow: hidden; }
`

/**
 * @param {object} o
 * @param {number} o.count number of pages (>= 1)
 * @param {{ onFrame: Function }} [o.stage] tick inside the stage loop (else call scroll.update( dt ) yourself)
 * @param {number|(() => number)} [o.pageHeight] px per page. Default: the large viewport height
 *   (100lvh), measured once and re-measured only when the width changes (touch) or on any desktop resize.
 * @param {number} [o.dwell=0.35] plateau fraction of each page's scroll range
 * @param {number} [o.damping=12] spring stiffness ω of the critically damped follow (≈ Lenis lerp 0.1 @ 60 fps)
 * @param {[number, number]|false} [o.skip=[1.2, 2.4]] arrival speeds (pages/s) between which a page goes
 *   from held to flown through (decided when the transition toward it starts). false: always hold.
 * @param {boolean} [o.settle=true] ease into the nearest held plateau after idle
 * @param {number} [o.settleDelay=500] ms without input before settling
 * @param {boolean} [o.keys=true] Space / PageUp / PageDown / Home / End move exactly one page (smooth). Arrows stay native.
 * @param {boolean} [o.ui=true] dots + page counter + hint (base.css .pager-* styles)
 * @param {string[]} [o.labels] page titles (dot labels, section aria-labels)
 * @param {string} [o.hint='scroll'] hint text, hidden after the first input ('' for none)
 * @param {boolean} [o.hash=true] sync location.hash (#1..#count, or slugs)
 * @param {string[]} [o.slugs] optional hash names per page (#atrium); numbers still work
 */
export function createScroll( o ) {
	const {
		count,
		stage = null,
		dwell = 0.35,
		damping = 12,
		settle = !prefersReducedMotion,
		settleDelay = 500,
		keys = true,
		ui = true,
		labels = [],
		hint = 'scroll',
		hash = true,
		slugs = null,
	} = o
	const max = Math.max( 0, count - 1 )
	const root = document.documentElement
	const coarse = window.matchMedia( '(hover: none) and (pointer: coarse)' ).matches // phones / tablets
	const h = dwell * 0.5

	if ( !document.getElementById( STYLE_ID ) ) {
		const style = document.createElement( 'style' )
		style.id = STYLE_ID
		style.textContent = CSS
		document.head.append( style )
	}
	root.classList.add( 'ms-scroll' )
	if ( 'scrollRestoration' in history ) history.scrollRestoration = 'manual'

	//------------------------------------------------------------------ TRACK
	const track = document.createElement( 'div' )
	track.className = 'ms-track'
	const sections = []
	for ( let i = 0; i < count; i++ ) {
		const s = document.createElement( 'section' )
		s.className = 'ms-page'
		s.dataset.page = String( i )
		s.setAttribute( 'aria-label', labels[i] ?? `Page ${i + 1}` )
		track.append( s )
		sections.push( s )
	}
	document.body.append( track )

	const measureLvh = () => {
		const probe = document.createElement( 'div' )
		probe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:100lvh;visibility:hidden;pointer-events:none'
		document.body.append( probe )
		const v = probe.offsetHeight
		probe.remove()
		return v || window.innerHeight
	}
	const measure = () => {
		const ph = o.pageHeight
		if ( typeof ph === 'number' ) return ph
		if ( typeof ph === 'function' ) return ph()
		return measureLvh()
	}

	let pageHeight = 1
	const layout = () => {
		pageHeight = Math.max( 1, Math.round( measure() ) )
		// every page is one pageHeight; the last also covers the viewport, so max scroll = max * pageHeight
		const hpx = `${pageHeight}px`
		for ( const s of sections ) s.style.height = hpx
		scroll.pageHeight = pageHeight
	}

	//------------------------------------------------------------------ STATE
	const skip = new Float64Array( count + 1 ) // per page: 0 held .. 1 flown through
	const scroll = {
		count,
		dwell,
		pageHeight: 1,
		/** scrollY / pageHeight, clamped 0..count-1 */
		raw: 0,
		/** critically damped follow of raw */
		progress: 0,
		/** progress / s */
		velocity: 0,
		/** dwell-mapped progress (what pages, the rig and CSS read) */
		mapped: 0,
		/** per page 0 held .. 1 flown through (read-only view) */
		skip,
		/** [from, to] arrival speeds in pages/s for flying through a page, or false. Mutable. */
		skipSpeeds: o.skip === undefined ? [1.2, 2.4] : o.skip,
		/** set by the probe for deterministic passes (seconds per frame), else null */
		fixedDt: null,
		get page() { return clamp( Math.round( scroll.mapped ), 0, max ) },
		/** true while a dot / hash / key / settle flight is running */
		get animating() { return anim !== null },
		/** Per-page t: -1 arriving .. 0 held .. +1 leaving (dwell-mapped, clamped). */
		local( i ) { return clamp( scroll.mapped - i, -1, 1 ) },
		/** 1 while page i is held, 0 one page away. */
		presence( i ) { return 1 - Math.abs( clamp( scroll.mapped - i, -1, 1 ) ) },
		/** Is page i on screen (presence > 0), widened by `margin` pages. */
		isVisible( i, margin = 0 ) { return Math.abs( scroll.mapped - i ) < 1 + margin },
		/** The static map (every page held): what the visuals show at rest. */
		dwellMap( p ) { return dwellMap( p, dwell, max ) },
		goTo,
		next() { goTo( baseStep() + 1 ) },
		prev() { goTo( baseStep() - 1 ) },
		onChange( cb ) {
			changeCallbacks.add( cb )
			return () => changeCallbacks.delete( cb )
		},
		bind,
		update,
		dispose,
		track,
		sections,
		el: null,
	}
	const changeCallbacks = new Set()

	let spring = 0 // progress
	let springV = 0
	let anim = null // { from, to, t, dur, ease, dest } in pages
	let lastSetY = -1
	let lastActivity = performance.now()
	let touching = false
	let pointerHeld = false
	let hintEl = null

	const readRaw = () => clamp( window.scrollY / pageHeight, 0, max )

	const activity = () => {
		lastActivity = performance.now()
		if ( hintEl && !hintEl.classList.contains( 'is-hidden' ) ) hintEl.classList.add( 'is-hidden' )
	}
	const cancel = () => {
		anim = null
	}

	/** Plateau slope for page k, decided as the transition toward it starts. */
	function decide( k ) {
		if ( prefersReducedMotion ) return 0
		if ( anim && anim.dest !== null ) return k === anim.dest ? 0 : 1 // flights hold only at the destination
		const sp = scroll.skipSpeeds
		if ( !sp ) return 0
		// arrival speed: the spring velocity, or the speed it is about to reach (2v/ω lag at steady state)
		const v = Math.max( Math.abs( springV ), Math.abs( scroll.raw - spring ) * damping * 0.5 )
		return smootherstep( clamp( ( v - sp[0] ) / ( sp[1] - sp[0] ), 0, 1 ) )
	}

	function startAnim( to, dur, ease, dest = null ) {
		anim = { from: scroll.raw, to, t: 0, dur: Math.max( 0.05, dur ), ease, dest }
	}

	/** Smooth (cancellable) or instant scroll to page i. */
	function goTo( i, { instant = prefersReducedMotion } = {} ) {
		const to = clamp( Math.round( i ), 0, max )
		activity()
		if ( instant ) {
			anim = null
			window.scrollTo( 0, to * pageHeight )
			scroll.raw = to
			spring = to
			springV = 0
			skip.fill( 0 )
			commit()
			return
		}
		const d = Math.abs( to - scroll.progress )
		startAnim( to, 0.6 + 0.4 * Math.sqrt( Math.max( d, 0.25 ) ), easeInOutCubic, to )
	}

	const baseStep = () => ( anim && anim.dest !== null ? anim.dest : Math.round( scroll.raw ) )

	//------------------------------------------------------------------ INPUT (listen only: native scroll does the work)
	const onWheel = () => {
		cancel()
		activity()
	}
	const onTouchStart = () => {
		touching = true
		cancel()
		activity()
	}
	const onTouchEnd = ( e ) => {
		if ( e.touches.length === 0 ) touching = false
		activity()
	}
	const onPointerDown = ( e ) => {
		if ( e.pointerType === 'mouse' ) pointerHeld = true
		cancel()
		activity()
	}
	const onPointerUp = () => {
		pointerHeld = false
		activity()
	}
	const onScroll = () => {
		// our own scrollTo lands within a pixel of lastSetY; anything else is the user
		if ( anim && Math.abs( window.scrollY - lastSetY ) <= 2 ) return
		activity()
	}
	const onKey = ( e ) => {
		if ( e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey ) return
		const t = e.target
		if ( t?.closest?.( 'input, textarea, select, [contenteditable]' ) ) return
		activity()
		const k = e.key
		const onControl = t?.closest?.( 'button, a, summary' )
		let to = null
		if ( keys ) {
			if ( k === 'PageDown' || ( k === ' ' && !e.shiftKey && !onControl ) ) to = baseStep() + 1
			else if ( k === 'PageUp' || ( k === ' ' && e.shiftKey && !onControl ) ) to = baseStep() - 1
			else if ( k === 'Home' ) to = 0
			else if ( k === 'End' ) to = max
		}
		if ( to === null ) {
			cancel() // arrows and the rest scroll natively
			return
		}
		e.preventDefault()
		goTo( to )
	}

	//------------------------------------------------------------------ HASH
	const pageFromHash = () => {
		const s = decodeURIComponent( window.location.hash.slice( 1 ) )
		if ( !s ) return null
		if ( slugs ) {
			const j = slugs.indexOf( s )
			if ( j >= 0 ) return j
		}
		const n = parseInt( s, 10 )
		return Number.isFinite( n ) ? clamp( n - 1, 0, max ) : null
	}
	const hashFor = ( i ) => `#${slugs?.[i] ?? i + 1}`
	const onHash = () => {
		const p = pageFromHash()
		if ( p !== null ) goTo( p )
	}

	//------------------------------------------------------------------ UI
	const dots = []
	let countEl = null
	if ( ui ) {
		const el = document.createElement( 'div' )
		el.className = 'pager-ui'
		const nav = document.createElement( 'nav' )
		nav.className = 'pager-dots'
		nav.setAttribute( 'aria-label', 'Pages' )
		for ( let i = 0; i < count; i++ ) {
			const b = document.createElement( 'button' )
			b.type = 'button'
			b.className = 'pager-dot'
			b.title = labels[i] ?? `Page ${i + 1}`
			b.setAttribute( 'aria-label', `${b.title} (${i + 1} of ${count})` )
			b.addEventListener( 'click', () => goTo( i ) )
			nav.append( b )
			dots.push( b )
		}
		countEl = document.createElement( 'div' )
		countEl.className = 'pager-count'
		countEl.setAttribute( 'aria-hidden', 'true' )
		el.append( nav, countEl )
		if ( hint ) {
			hintEl = document.createElement( 'div' )
			hintEl.className = 'pager-hint'
			hintEl.textContent = hint
			hintEl.setAttribute( 'aria-hidden', 'true' )
			el.append( hintEl )
		}
		document.body.append( el )
		scroll.el = el
	}

	//------------------------------------------------------------------ BINDINGS (visibility by presence)
	const bindings = []
	/**
	 * Toggle `target.visible` (Object3D) by page presence, firing onShow / onHide once per change.
	 * @param {number|[number, number]} i page index, or an inclusive [from, to] page range
	 * @param {{ visible: boolean }|null} target usually the page Group (null: callbacks only)
	 * @param {{ margin?: number, onShow?: Function, onHide?: Function }} [opts] margin widens the window in pages
	 * @returns {() => void} unbind
	 */
	function bind( i, target, { margin = 0, onShow = null, onHide = null } = {} ) {
		const [from, to] = Array.isArray( i ) ? i : [i, i]
		const b = { from, to, target, margin, onShow, onHide, shown: null }
		bindings.push( b )
		applyBinding( b )
		return () => {
			const j = bindings.indexOf( b )
			if ( j >= 0 ) bindings.splice( j, 1 )
		}
	}
	function applyBinding( b ) {
		const m = scroll.mapped
		const v = m > b.from - 1 - b.margin && m < b.to + 1 + b.margin
		if ( v === b.shown ) return
		b.shown = v
		if ( b.target ) b.target.visible = v
		if ( v ) b.onShow?.( b.from )
		else b.onHide?.( b.from )
	}

	//------------------------------------------------------------------ TICK
	let cssPage = ''
	let cssProgress = ''
	let lastPage = -1
	let lastHashPage = -1

	function commit() {
		scroll.progress = spring
		scroll.velocity = springV
		scroll.mapped = dwellMap( spring, dwell, max, skip )

		const pageStr = scroll.mapped.toFixed( 4 )
		if ( pageStr !== cssPage ) {
			cssPage = pageStr
			root.style.setProperty( '--page', pageStr )
		}
		const progStr = ( max > 0 ? spring / max : 0 ).toFixed( 4 )
		if ( progStr !== cssProgress ) {
			cssProgress = progStr
			root.style.setProperty( '--progress', progStr )
		}
		const page = scroll.page
		if ( page !== lastPage ) {
			lastPage = page
			root.style.setProperty( '--page-i', String( page ) )
			for ( let i = 0; i < dots.length; i++ ) {
				const on = i === page
				dots[i].classList.toggle( 'is-active', on )
				if ( on ) dots[i].setAttribute( 'aria-current', 'step' )
				else dots[i].removeAttribute( 'aria-current' )
			}
			if ( countEl ) countEl.textContent = `${String( page + 1 ).padStart( 2, '0' )} / ${String( count ).padStart( 2, '0' )}`
			for ( const cb of changeCallbacks ) cb( page, scroll )
		}
		// hash only once a page is actually held (few replaceState calls, Safari limits them)
		if ( hash && page !== lastHashPage && Math.abs( scroll.mapped - page ) < 1e-4 && !anim ) {
			lastHashPage = page
			history.replaceState( history.state, '', hashFor( page ) )
		}
		for ( const b of bindings ) applyBinding( b )
	}

	let lastTick = performance.now()
	function update( dtIn ) {
		const now = performance.now()
		let dt = scroll.fixedDt ?? ( dtIn ?? Math.min( 0.1, ( now - lastTick ) / 1000 ) )
		lastTick = now
		dt = Math.min( dt, 0.1 )

		// 1. programmatic flight (pages -> px every frame, so a resize mid-flight stays correct)
		if ( anim ) {
			if ( anim.t > 0 && Math.abs( window.scrollY - lastSetY ) > 2 ) {
				anim = null // the user scrolled by some other means
			} else {
				anim.t += dt
				const u = clamp( anim.t / anim.dur, 0, 1 )
				const pages = anim.from + ( anim.to - anim.from ) * anim.ease( u )
				lastSetY = pages * pageHeight
				window.scrollTo( 0, lastSetY )
				scroll.raw = clamp( pages, 0, max )
				if ( u >= 1 ) anim = null
			}
		}
		if ( !anim ) scroll.raw = readRaw()

		// 2. damped follow (exact critically damped spring step, frame-rate independent)
		const target = scroll.raw
		const prev = spring
		if ( prefersReducedMotion ) {
			spring = target
			springV = 0
		} else if ( dt > 0 ) {
			const e = Math.exp( -damping * dt )
			const d = spring - target
			const j = springV + damping * d
			spring = target + ( d + j * dt ) * e
			springV = ( springV - damping * j * dt ) * e
			if ( Math.abs( spring - target ) < 2e-5 && Math.abs( springV ) < 2e-4 ) {
				spring = target
				springV = 0
			}
			if ( spring < 0 || spring > max ) {
				spring = clamp( spring, 0, max )
				springV = 0
			}
		}

		// 3. plateau decisions: entering the transition k -> k+1 forward fixes skip[k+1],
		//    entering it backward fixes skip[k] (never changed while inside, so the map stays pure)
		if ( spring > prev ) {
			for ( let k = Math.max( 0, Math.floor( prev - h ) ); k <= Math.min( max - 1, Math.floor( spring ) ); k++ ) {
				if ( prev < k + h && spring >= k + h ) skip[k + 1] = decide( k + 1 )
			}
		} else if ( spring < prev ) {
			for ( let k = Math.max( 0, Math.floor( spring ) ); k <= Math.min( max - 1, Math.floor( prev + h ) ); k++ ) {
				if ( prev > k + 1 - h && spring <= k + 1 - h ) skip[k] = decide( k )
			}
		}

		// 4. at rest: a page passed at speed becomes held again once the scroll sits on its centre
		const resting = !anim && Math.abs( target - spring ) < 1e-3 && Math.abs( springV ) < 0.02
		const kNear = Math.round( spring )
		if ( resting && Math.abs( spring - kNear ) < 1e-5 && skip[kNear] !== 0 ) skip[kNear] = 0 // exact centre: no visible change

		// 5. settle into the nearest held plateau after idle
		if ( settle && !anim && resting && !touching && !pointerHeld && now - lastActivity > settleDelay ) {
			const k = Math.floor( target )
			const f = target - k
			const inTransition = k < max && f > h + 1e-3 && f < 1 - h - 1e-3
			const nearest = f < 0.5 ? k : k + 1
			const inFlownPlateau = !inTransition && skip[kNear] > 0 && Math.abs( target - kNear ) > 1e-5
			if ( inTransition || inFlownPlateau ) {
				const page = inTransition ? nearest : kNear
				// a held plateau: land just inside it; a flown one: land on its centre (where it re-holds)
				const to = skip[page] > 0 ? page : page + ( target < page ? -h * 0.6 : h * 0.6 )
				const dist = Math.abs( to - target )
				startAnim( to, 0.35 + dist * 1.4, easeInOutSine )
			}
		}

		commit()
	}

	//------------------------------------------------------------------ RESIZE (width, or any desktop resize; never mobile URL-bar jitter)
	let lastW = window.innerWidth
	let lastH = window.innerHeight
	const onResize = () => {
		const w = window.innerWidth
		const hh = window.innerHeight
		if ( w === lastW && ( coarse || hh === lastH ) ) return
		lastW = w
		lastH = hh
		const keep = scroll.raw
		layout()
		lastSetY = keep * pageHeight
		window.scrollTo( 0, lastSetY )
	}

	//------------------------------------------------------------------ START
	layout()
	const initial = hash ? pageFromHash() : null
	if ( initial !== null ) goTo( initial, { instant: true } )
	else {
		scroll.raw = readRaw()
		spring = scroll.raw
		commit()
	}

	const passive = { passive: true }
	window.addEventListener( 'wheel', onWheel, passive )
	window.addEventListener( 'touchstart', onTouchStart, passive )
	window.addEventListener( 'touchend', onTouchEnd, passive )
	window.addEventListener( 'touchcancel', onTouchEnd, passive )
	window.addEventListener( 'pointerdown', onPointerDown, passive )
	window.addEventListener( 'pointerup', onPointerUp, passive )
	window.addEventListener( 'scroll', onScroll, passive )
	window.addEventListener( 'keydown', onKey )
	window.addEventListener( 'resize', onResize )
	if ( hash ) window.addEventListener( 'hashchange', onHash )

	let raf = 0
	let disposed = false
	let offFrame = null
	if ( stage ) offFrame = stage.onFrame( ( dt ) => update( dt ) )
	else if ( o.auto !== false ) {
		const tick = () => {
			if ( disposed ) return
			update()
			raf = requestAnimationFrame( tick )
		}
		raf = requestAnimationFrame( tick )
	}

	function dispose() {
		disposed = true
		cancelAnimationFrame( raf )
		offFrame?.()
		window.removeEventListener( 'wheel', onWheel )
		window.removeEventListener( 'touchstart', onTouchStart )
		window.removeEventListener( 'touchend', onTouchEnd )
		window.removeEventListener( 'touchcancel', onTouchEnd )
		window.removeEventListener( 'pointerdown', onPointerDown )
		window.removeEventListener( 'pointerup', onPointerUp )
		window.removeEventListener( 'scroll', onScroll )
		window.removeEventListener( 'keydown', onKey )
		window.removeEventListener( 'resize', onResize )
		window.removeEventListener( 'hashchange', onHash )
		scroll.el?.remove()
		track.remove()
		root.classList.remove( 'ms-scroll' )
		changeCallbacks.clear()
		bindings.length = 0
	}

	return scroll
}

export default createScroll
