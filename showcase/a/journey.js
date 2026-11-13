/**
 * Plan A camera path: one continuous flight, authored as rig keys (shared/rig.js).
 *
 * - One key per scroll step = the station's rest pose (the pose its flat type is laid out against),
 *   so the camera is exactly still while a page is held.
 * - No flight reverses at a page (the orbit runs down the statue's east side toward the culling
 *   view; the trace is seen from above, between the god view and the finale), so every page can be
 *   flown through at speed and none has to be force-held (a forced hold after a flown page is a
 *   hard stop).
 * - Held pages drift slowly along their own flight (addDrift): a slow zone, not a dead stop.
 * - Waypoints only where a flight needs a shape the curve would not take by itself: the ride down
 *   the ring tunnel (on its axis, the view already turning toward the coil), the statue orbit
 *   (arc keys around one target) and one re-aim key on the corners -> ribbon curve (its 107° turn
 *   spread evenly). Every other flight is the rig's own centripetal Catmull-Rom
 *   through the page poses: each extra key is a curvature joint (the curve is C1, not C2), and at
 *   scroll speed a joint the path bends hard at reads as a jolt, so fewer keys fly smoother.
 * - Nothing here runs per frame (keys are rebuilt on resize). pathReport() and simulatePass() are
 *   the tuning tools behind window.__A.path() / .sim() / .bench().
 */
import { dwellMap } from '@shared/scroll.js'
import { Vector3 } from 'three/webgpu'

const pose = () => ( { pos: new Vector3(), target: new Vector3() } )
const tmpA = new Vector3()
const tmpB = new Vector3()
const tmpC = new Vector3()
const geo = ( a, b, u ) => Math.pow( a, 1 - u ) * Math.pow( b, u )

/** Unit-vector slerp (falls back to nlerp for tiny angles). */
function slerpDir( a, b, u, out ) {
	const dot = Math.max( -1, Math.min( 1, a.dot( b ) ) )
	const ang = Math.acos( dot )
	if ( ang < 1e-4 ) return out.copy( a ).lerp( b, u ).normalize()
	const s = Math.sin( ang )
	const wa = Math.sin( ( 1 - u ) * ang ) / s
	const wb = Math.sin( u * ang ) / s
	return out.set( a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb ).normalize()
}

/** Pose at `pos` looking along the slerp of A's and B's view directions, at their geometric mean distance. */
function aimPose( pos, A, B, u, out = pose() ) {
	const dA = tmpA.subVectors( A.target, A.pos )
	const dB = tmpB.subVectors( B.target, B.pos )
	const d = geo( dA.length(), dB.length(), u )
	const dir = slerpDir( dA.normalize(), dB.normalize(), u, tmpC )
	out.pos.copy( pos )
	out.target.copy( pos ).addScaledVector( dir, d )
	return out
}

/**
 * @param {object} o
 * @param {object[]} o.stations built stations (rest poses via st.camera( step, pos, look ))
 * @param {number[]} o.stepStation scroll step -> station index
 * @param {object} o.rig the rig (its curve through the page poses places the re-aim waypoints)
 * @returns {Array<{ at: number, pos: number[], target: number[] }>} rig keys
 */
export function buildKeys( { stations, stepStation, rig } ) {
	const keys = []
	const key = ( at, p ) => keys.push( { at, pos: p.pos.toArray(), target: p.target.toArray() } )
	const rest = stepStation.map( ( si, k ) => {
		const p = pose()
		stations[si].camera( k, p.pos, p.target )
		key( k, p )
		return p
	} )

	// 0 -> 1 · ride down the ring tunnel on its axis; the curve then peels off toward the side of
	// the coil. The waypoint sits up to 58% of the way along the axis, but early enough that the
	// peel turns at most ~32°; its `at` follows the chord lengths and its view has turned as far.
	// Portrait pulls the coil camera far back and aside: the ride would be too short to read, so
	// the flight is the plain curve there.
	const enter = stations[stepStation[0]]
	const axial = ( v ) => tmpA.subVectors( v, enter.anchor ).dot( enter.T )
	const a0 = axial( rest[0].pos )
	const a1 = axial( rest[1].pos )
	const lateral = tmpB.subVectors( rest[1].pos, enter.anchor ).addScaledVector( enter.T, -a1 ).length()
	const aW = Math.min( a0 + 0.58 * ( a1 - a0 ), a1 - 1.6 * lateral )
	if ( aW > a0 + 0.35 * ( a1 - a0 ) ) { // too short a ride (portrait): the plain curve flies better
		const ride = enter.local( aW, 0.9, 0 )
		const c0 = ride.distanceTo( rest[0].pos )
		const c1 = ride.distanceTo( rest[1].pos )
		const at = Math.min( 0.75, Math.max( 0.25, c0 / ( c0 + c1 ) ) )
		key( at, aimPose( ride, rest[0], rest[1], at ) )
	}

	// 4 -> 5 -> 6 · the only orbit: arc keys around one target (held on David, Venus, Nefertiti)
	const o = stations[stepStation[4]].orbit
	key( 4.5, o.pose( ( o.theta[0] + o.theta[1] ) / 2, pose() ) )
	key( 5.5, o.pose( ( o.theta[1] + o.theta[2] ) / 2, pose() ) )

	keys.sort( ( a, b ) => a.at - b.at )

	// 2 -> 3 · corners (looking north) to the ribbon (looking east down the road) is a 107° turn over a
	// short move: on its own the curve bunches it (peak 450°/page). A mid-flight key ON the curve, its
	// view moved 60% of the way from the curve's own view toward the half-way slerp, spreads the turn
	// (peak ≈ 355°/page) without bending the path; the full re-aim would kink the view at slow speed.
	rig.setKeys( keys )
	const on = rig.sample( 2.5, { pos: new Vector3(), target: new Vector3(), fov: 50, roll: 0 }, 2.5 )
	const aim = aimPose( on.pos, rest[2], rest[3], 0.5 )
	const natural = tmpB.subVectors( on.target, on.pos )
	const dNat = natural.length()
	const dAim = aim.pos.distanceTo( aim.target )
	const dir = slerpDir( natural.normalize(), tmpA.subVectors( aim.target, aim.pos ).normalize(), 0.6, tmpC )
	aim.target.copy( on.pos ).addScaledVector( dir, dNat + ( dAim - dNat ) * 0.6 )
	key( 2.5, aim )
	keys.sort( ( a, b ) => a.at - b.at )

	addDrift( keys )
	return keys
}

/**
 * Hold drift: while a page is held the camera keeps creeping along its own flight (the pose-curve
 * tangent at the key, from the neighbouring keys), so a plateau reads as a slow zone of the same
 * move instead of a dead stop, and the motion never reverses at a plateau edge. Scroll-driven
 * (rig.js: -hold .. +hold across the plateau, C1 at its edges). Amplitude: 2.5 % of the view
 * distance (capped at 40), at most 3 % of the neighbour chord, so it stays far below flight speed.
 */
function addDrift( keys, { frac = 0.025, chordFrac = 0.03 } = {} ) {
	for ( let i = 0; i < keys.length; i++ ) {
		const k = keys[i]
		if ( !Number.isInteger( k.at ) ) continue
		const a = keys[Math.max( 0, i - 1 )]
		const b = keys[Math.min( keys.length - 1, i + 1 )]
		const dp = tmpA.fromArray( b.pos ).sub( tmpB.fromArray( a.pos ) )
		const len = dp.length()
		if ( len < 1e-6 ) continue
		const d = tmpB.fromArray( k.target ).distanceTo( tmpC.fromArray( k.pos ) )
		const lambda = Math.min( frac * Math.min( d, 40 ), chordFrac * len ) / len
		const pos = dp.multiplyScalar( lambda ).toArray()
		const target = tmpB.fromArray( b.target ).sub( tmpC.fromArray( a.target ) ).multiplyScalar( lambda ).toArray()
		k.hold = { pos, target }
	}
}

/**
 * Pure path report (no parallax, no hold), per transition k -> k+1, sampled over RAW progress
 * (what a steady scroll feels like: the dwell map holds the plateaus and eases the flight):
 * total turn (deg), peak angular rate (deg per page of scroll) and its ratio to the turn (an even
 * quintic flight is about 2.9), path length and peak linear rate (units per page) with its ratio.
 */
export function pathReport( rig, last, map, samples = 600 ) {
	const out = []
	const a = { pos: new Vector3(), target: new Vector3(), fov: 0, roll: 0 }
	const b = { pos: new Vector3(), target: new Vector3(), fov: 0, roll: 0 }
	const da = new Vector3()
	const db = new Vector3()
	for ( let k = 0; k < last; k++ ) {
		let turn = 0
		let peak = 0
		let peakAt = k
		let len = 0
		let peakLin = 0
		for ( let i = 0; i < samples; i++ ) {
			const m0 = map( k + i / samples )
			const m1 = map( k + ( i + 1 ) / samples )
			rig.sample( m0, a, m0 )
			rig.sample( m1, b, m1 )
			da.subVectors( a.target, a.pos ).normalize()
			db.subVectors( b.target, b.pos ).normalize()
			const ang = ( Math.acos( Math.max( -1, Math.min( 1, da.dot( db ) ) ) ) * 180 ) / Math.PI
			const d = a.pos.distanceTo( b.pos )
			turn += ang
			len += d
			const rate = ang * samples
			if ( rate > peak ) {
				peak = rate
				peakAt = m0
			}
			peakLin = Math.max( peakLin, d * samples )
		}
		out.push( { from: k, turn: +turn.toFixed( 1 ), peakDegPerPage: +peak.toFixed( 1 ), peakAtMapped: +peakAt.toFixed( 3 ), ratio: +( peak / Math.max( 1e-6, turn ) ).toFixed( 2 ), length: +len.toFixed( 1 ), peakLinPerPage: +peakLin.toFixed( 1 ), linRatio: +( peakLin / Math.max( 1e-6, len ) ).toFixed( 2 ) } )
	}
	return out
}

const smootherstep = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 )
const easeInOutCubic = ( t ) => ( t < 0.5 ? 4 * t * t * t : 1 - Math.pow( -2 * t + 2, 3 ) / 2 )

/**
 * Offline scroll pass (no rendering), the same model as scroll.js: raw progress moves at
 * `pagesPerSec` (or, with `flight`, eases from -> to like a dot / hash goTo), a critically damped
 * spring (ω 12) follows it at 60 fps, momentum-aware plateaus (skip speeds [1.2, 2.4] pages/s,
 * flights hold only at the destination, `hold` pages always hold), the rig is sampled per frame. Returns frames for
 * perf.js continuity() (the shared C1 metric).
 */
export function simulatePass( rig, { pagesPerSec = 1.2, from = 0, to = 1, flight = false, dwell = 0.35, max = 9, omega = 12, fps = 60, skipSpeeds = [1.2, 2.4], hold = [] } = {} ) {
	const dt = 1 / fps
	const h = dwell / 2
	const dir = Math.sign( to - from ) || 1
	const s = { pos: new Vector3(), target: new Vector3(), fov: 50, roll: 0 }
	const skip = new Float64Array( max + 2 )
	const frames = []
	const dur = 0.6 + 0.4 * Math.sqrt( Math.max( Math.abs( to - from ), 0.25 ) )
	let t = 0
	let raw = from
	let sp = from
	let v = 0
	let extra = 0
	const decide = ( k ) => {
		if ( flight ) return k === to ? 0 : 1
		const sv = Math.max( Math.abs( v ), Math.abs( raw - sp ) * omega * 0.5 )
		return smootherstep( Math.max( 0, Math.min( 1, ( sv - skipSpeeds[0] ) / ( skipSpeeds[1] - skipSpeeds[0] ) ) ) )
	}
	while ( extra < fps * 1.5 ) {
		t += dt
		if ( flight ) {
			const u = Math.min( 1, t / dur )
			raw = from + ( to - from ) * easeInOutCubic( u )
			if ( u >= 1 ) extra++
		} else if ( dir * ( to - raw ) > 0 ) raw = dir > 0 ? Math.min( to, raw + pagesPerSec * dt ) : Math.max( to, raw - pagesPerSec * dt )
		else extra++
		const prev = sp
		const e = Math.exp( -omega * dt )
		const d = sp - raw
		const j = v + omega * d
		sp = raw + ( d + j * dt ) * e
		v = ( v - omega * j * dt ) * e
		if ( sp > prev ) {
			for ( let k = Math.max( 0, Math.floor( prev - h ) ); k <= Math.min( max - 1, Math.floor( sp ) ); k++ ) if ( prev < k + h && sp >= k + h ) skip[k + 1] = decide( k + 1 )
		} else if ( sp < prev ) {
			for ( let k = Math.max( 0, Math.floor( sp ) ); k <= Math.min( max - 1, Math.floor( prev + h ) ); k++ ) if ( prev > k + 1 - h && sp <= k + 1 - h ) skip[k] = decide( k )
		}
		for ( const k of hold ) skip[k] = 0
		const m = dwellMap( sp, dwell, max, skip )
		rig.sample( sp, s, m )
		const f = tmpA.subVectors( s.target, s.pos ).normalize()
		frames.push( { dt, progress: sp, mapped: m, pos: s.pos.toArray(), dir: f.toArray(), fov: s.fov } )
	}
	return frames
}
