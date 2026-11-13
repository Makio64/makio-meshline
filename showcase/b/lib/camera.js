/**
 * Plan B camera keys for shared/rig.js: one key per pager stop, so the camera is at rest on every
 * held stop. A poster's sub-stops share its pose (the camera waits while the poster changes state).
 * Between posters: a long-lens sideways truck (fov 20, flat and calm). The finale is one continuous
 * pull-back + yaw arc over two pages: 'the strip' (held halfway, the last posters in perspective),
 * then 'the wall'. Pure data, no three imports (the offline continuity sim imports it too).
 *
 * Tuned with the shared continuity metric (scratchpad/smooth/bq/sim.mjs: exact scroll.js spring,
 * skip decisions and dwell map + rig.js), every aspect from 0.46 to 2:
 * - TRUCK: a truck into / out of a multi-stop poster is shaped by waypoints into a quintic ease
 *   (zero velocity AND acceleration at the poster), so a page flown at speed brakes into the
 *   poster smoothly instead of with a C1 corner.
 * - DRIFT: while a single-stop poster holds, the camera keeps gliding a little along the strip
 *   (rig `hold`, pure translation: no rotation), so held pages never look frozen.
 * - WALL: yaw / elevation / look point follow r(u) = u^rotPow (1 + rotEnd rotPow (1 - u)) (pull
 *   back while swinging round), the look point lags the swing (r^lookPow: the strip keeps '366' in
 *   front), the distance grows linearly. Waypoints (perPage per page) follow one pacing curve over
 *   both pages (eased start, C1 through the strip); `start` repeats the '366' pose that far into the
 *   transition so the truck in and the arc out never bend each other. The wall pose itself is solved
 *   for the current aspect (fitWall): every poster, the spine and the return hint in frame, centred.
 *   Portrait looks down the strip more end-on (yawPortrait), so the posters stay legible on a phone.
 *   Two pages and the lagging look point cut the turn rate at 16 px per frame from 345°/s to 115°/s.
 */
export const SPACING = 46
export const POSTER = { w: 38, h: 22 }
export const PORTRAIT_BOX = { w: 22 + 2.4, h: 42 + 1 } // portrait poster + a right margin for the pager dots
/** landscape framing margin: the poster clears the pager dots (right) and the hub link (top left) */
export const MARGIN = 1.09
/**
 * What the wall view must frame, in strip space (y extents of the posters, the red spine and the
 * return hint under the front posters): the wall distance and look point are solved per aspect.
 */
export const WALL_FRAME = {
	landscape: { top: 11.6, bottom: -14.8, hint: -17.8, margin: 1.12 },
	portrait: { top: 21.6, bottom: -24.4, hint: -27.4, margin: 1.16 },
}

const PITCH = 0.012 // a hair above the poster's centre line

export const TRUCK = { waypoints: 16 }
export const DRIFT = { amount: 1.5 } // world units at the landscape poster distance (scaled with it)
export const WALL = { yaw: 1.06, rise: 0.16, yawPortrait: 1.35, risePortrait: 0.12, rotPow: 1, rotEnd: 1, lookPow: 3, lookPowPortrait: 4, ease: 1.6, start: 0.04, perPage: 12 }

/** Quintic Hermite with zero second derivatives at both ends, t in 0..1. */
const quintic = ( y0, y1, m0, m1, t ) => {
	const t3 = t * t * t
	const t4 = t3 * t
	const t5 = t4 * t
	return y0 * ( 1 - 10 * t3 + 15 * t4 - 6 * t5 ) + m0 * ( t - 6 * t3 + 8 * t4 - 3 * t5 ) + m1 * ( -4 * t3 + 7 * t4 - 3 * t5 ) + y1 * ( 10 * t3 - 15 * t4 + 6 * t5 )
}

/**
 * Wall pose for a view direction (yaw, elevation): the distance and look point at which every
 * point of `pts` fits the viewport (aspect, vertical fov in degrees) with `margin`, centred.
 * Plain vector maths (pure data, no three).
 */
function fitWall( pts, look, yaw, el, aspect, fov, margin ) {
	const off = [Math.sin( yaw ) * Math.cos( el ), Math.sin( el ), Math.cos( yaw ) * Math.cos( el )] // target -> camera
	const f = [-off[0], -off[1], -off[2]]
	const rl = Math.hypot( f[2], f[0] )
	const r = [-f[2] / rl, 0, f[0] / rl] // f x up
	const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
	const tv = Math.tan( ( fov * Math.PI ) / 360 ) / margin
	const th = tv * aspect
	const dot = ( a, b ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
	// screen extents (tan units) with the look point moved by (a, b) along world x / y, i.e. it stays
	// on the strip plane (z = 0), and the camera at look + off * d
	const extents = ( d, a, b ) => {
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		for ( const p of pts ) {
			const v = [p[0] - look[0] - a - off[0] * d, p[1] - look[1] - b - off[1] * d, p[2] - look[2] - off[2] * d]
			const z = dot( v, f )
			const x = dot( v, r ) / z
			const y = dot( v, u ) / z
			x0 = Math.min( x0, x )
			x1 = Math.max( x1, x )
			y0 = Math.min( y0, y )
			y1 = Math.max( y1, y )
		}
		return [x0, x1, y0, y1]
	}
	// centre: the shift whose extents are symmetric (monotone in each shift, bisection; x and y
	// interact a little through depth, so alternate a few rounds)
	const centre = ( d, axis, other ) => {
		let lo = -2000
		let hi = 2000
		for ( let i = 0; i < 50; i++ ) {
			const mid = ( lo + hi ) / 2
			const e = axis === 0 ? extents( d, mid, other ) : extents( d, other, mid )
			if ( ( axis === 0 ? e[0] + e[1] : e[2] + e[3] ) > 0 ) lo = mid
			else hi = mid
		}
		return ( lo + hi ) / 2
	}
	const fits = ( d ) => {
		let a = 0
		let b = 0
		for ( let k = 0; k < 4; k++ ) {
			a = centre( d, 0, b )
			b = centre( d, 1, a )
		}
		const e = extents( d, a, b )
		return { ok: e[0] >= -th && e[1] <= th && e[2] >= -tv && e[3] <= tv, a, b }
	}
	let lo = 1
	let hi = 20000
	for ( let i = 0; i < 50; i++ ) {
		const mid = ( lo + hi ) / 2
		if ( fits( mid ).ok ) hi = mid
		else lo = mid
	}
	const { a, b } = fits( hi )
	return { look: [look[0] + a, look[1] + b, look[2]], dist: hi }
}

/**
 * @param {object} o
 * @param {Array<{ page: number }>} o.stops pager stops (page index per stop); the last poster owns the finale (its first stop, the strip, the wall)
 * @param {number} o.posters poster count
 * @param {boolean} o.portrait
 * @param {number} o.dist camera distance that frames one poster (stage.fitDistance of the poster box)
 * @param {number} o.aspect viewport aspect (the wall is framed for it)
 * @param {number} o.fov vertical fov in degrees
 * @returns {Array<{ at: number, pos: number[], target: number[], hold?: object }>}
 */
export function cameraKeys( { stops, posters, portrait, dist, aspect, fov } ) {
	const keys = []
	const ox = portrait ? 0.9 : 0
	const last = stops.length - 1
	const lastPage = posters - 1
	const w0 = stops.findIndex( ( s ) => s.page === lastPage ) // p8 '366': the finale starts here
	const subs = new Map()
	for ( let s = 0; s <= w0; s++ ) subs.set( stops[s].page, ( subs.get( stops[s].page ) ?? 0 ) + 1 )
	const multi = ( s ) => s < w0 && subs.get( stops[s].page ) > 1
	const drift = DRIFT.amount * ( dist / 67 )
	const glide = drift > 0 ? { pos: [drift, 0, 0], target: [drift, 0, 0] } : null
	const pose = ( x ) => ( { pos: [x, Math.sin( PITCH ) * dist, Math.cos( PITCH ) * dist], target: [x, 0, 0] } )

	for ( let s = 0; s < w0; s++ ) {
		const x = stops[s].page * SPACING + ox
		const key = { at: s, ...pose( x ) }
		if ( glide && !multi( s ) ) key.hold = glide
		keys.push( key )
		// truck to the next poster: eased into / out of a multi-stop poster, cruising otherwise
		if ( stops[s + 1].page === stops[s].page ) continue
		const m0 = multi( s ) ? 0 : 1
		const m1 = multi( s + 1 ) ? 0 : 1
		if ( m0 === 1 && m1 === 1 ) continue
		const n = TRUCK.waypoints
		for ( let i = 1; i <= n; i++ ) {
			const t = i / ( n + 1 )
			keys.push( { at: s + t, ...pose( x + SPACING * quintic( 0, 1, m0, m1, t ) ) } )
		}
	}

	// the finale: long lens looking back along the strip, every poster receding in perspective
	const endX = lastPage * SPACING
	const l0 = [endX + ox, 0, 0]
	const yaw1 = portrait ? WALL.yawPortrait : WALL.yaw
	const lookPow = portrait ? WALL.lookPowPortrait : WALL.lookPow
	const e1 = Math.atan( portrait ? WALL.risePortrait : WALL.rise )
	const frame = portrait ? WALL_FRAME.portrait : WALL_FRAME.landscape
	const pw = ( portrait ? PORTRAIT_BOX.w - 2.4 : POSTER.w ) / 2
	const pts = []
	for ( const x of [-pw, endX + pw] ) for ( const y of [frame.top, frame.bottom] ) pts.push( [x + ox, y, 0] )
	pts.push( [endX - SPACING * 0.6 - 9, frame.hint, 0], [endX - SPACING * 0.6 + 9, frame.hint, 0] )
	const wall = fitWall( pts, [endX * 0.5, 0, 0], yaw1, e1, aspect, fov, frame.margin )
	const l1 = wall.look
	const d1 = wall.dist
	const poseAt = ( u ) => {
		const r = Math.pow( u, WALL.rotPow ) * ( 1 + WALL.rotEnd * WALL.rotPow * ( 1 - u ) )
		const d = dist + ( d1 - dist ) * u
		const yaw = yaw1 * r
		const el = PITCH + ( e1 - PITCH ) * r
		const rl = Math.pow( r, lookPow ) // the look point lags the swing: the strip keeps '366' in front
		const l = [l0[0] + ( l1[0] - l0[0] ) * rl, l0[1] + ( l1[1] - l0[1] ) * rl, l0[2] + ( l1[2] - l0[2] ) * rl]
		return {
			pos: [l[0] + Math.sin( yaw ) * Math.cos( el ) * d, l[1] + Math.sin( el ) * d, l[2] + Math.cos( yaw ) * Math.cos( el ) * d],
			target: l,
		}
	}
	// arc length of the move in pose space, so waypoints can be spaced evenly along it
	const N = 480
	const cum = new Float64Array( N + 1 )
	let prev = poseAt( 0 )
	for ( let i = 1; i <= N; i++ ) {
		const q = poseAt( i / N )
		let d2 = 0
		for ( let a = 0; a < 3; a++ ) d2 += ( q.pos[a] - prev.pos[a] ) ** 2 + ( q.target[a] - prev.target[a] ) ** 2
		cum[i] = cum[i - 1] + Math.sqrt( d2 )
		prev = q
	}
	/** u at the arc-length fraction f (0..1) */
	const uOf = ( f ) => {
		const want = cum[N] * f
		let j = 0
		while ( j < N && cum[j + 1] < want ) j++
		return Math.min( 1, ( j + ( want - cum[j] ) / Math.max( 1e-9, cum[j + 1] - cum[j] ) ) / N )
	}

	// no drift on '366': the next move pulls back (+z), a sideways glide would kink into it
	keys.push( { at: w0, ...poseAt( 0 ) } )
	const a0 = w0 + WALL.start
	if ( WALL.start > 0 ) keys.push( { at: a0, ...poseAt( 0 ) } )
	// one pacing curve over the whole finale (eased start, C1 through the strip): arc fraction
	// ((at - a0) / (last - a0)) ^ ease, WALL.perPage waypoints per page
	const span = last - a0
	const fAt = ( at ) => Math.pow( ( at - a0 ) / span, WALL.ease )
	const K = WALL.perPage
	for ( let s = w0; s < last; s++ ) {
		const from = Math.max( s, a0 )
		for ( let i = 1; i <= K; i++ ) {
			const at = from + ( ( s + 1 - from ) * i ) / ( K + 1 )
			keys.push( { at, ...poseAt( uOf( fAt( at ) ) ) } )
		}
		if ( s + 1 === last ) break
		// the strip holds here and keeps drifting along the move (rig `hold`), so it reads as a slow beat
		const um = uOf( fAt( s + 1 ) )
		const strip = { at: s + 1, ...poseAt( um ) }
		if ( drift > 0 ) {
			const a = poseAt( Math.max( 0, um - 0.01 ) )
			const b = poseAt( Math.min( 1, um + 0.01 ) )
			const dp = b.pos.map( ( v, i ) => v - a.pos[i] )
			const dt = b.target.map( ( v, i ) => v - a.target[i] )
			const k = drift / Math.hypot( ...dp, ...dt )
			strip.hold = { pos: dp.map( ( v ) => v * k ), target: dt.map( ( v ) => v * k ) }
		}
		keys.push( strip )
	}
	keys.push( { at: last, ...poseAt( 1 ) } )
	return keys
}
