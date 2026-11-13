/**
 * One camera rig for every showcase page: keyframes in, C1-continuous flight out.
 *
 *   const rig = createRig( stage.camera, {
 *   	scroll, stage,
 *   	keys: [
 *   		{ at: 0, pos: [0, 0, 18], target: [0, 0, 0] },
 *   		{ at: 1, pos: [16, 2, 14], target: [16, 0, 0], hold: [1.2, 0, 0] }, // gentle drift while held
 *   		{ at: 1.5, pos: [26, 6, 10], target: [24, 0, 0] },                 // mid-transition waypoint
 *   		{ at: 2, pos: [32, 0, 12], target: [32, 0, 0], fov: 42, fit: [14, 8] },
 *   	],
 *   	parallax: { amount: 0.012, damping: 4 },
 *   } )
 *   stage.onFrame( ( dt ) => rig.update( scroll.progress, dt, stage.pointer ) )
 *
 * - Position and look-target are centripetal Catmull-Rom paths through the keys (no cusps, no
 *   loops, no overshoot), re-timed by arc length with a monotone C1 (PCHIP) curve through the keys'
 *   `at` values. Default timing 'pose': both paths share knots and timing (one curve in 6D pose
 *   space), so the framing changes evenly. Velocity is continuous everywhere, waypoints included.
 * - The rig samples the scroll's dwell-mapped progress, so the camera is at rest on every held page.
 * - fov / roll: PCHIP (no overshoot). Keep the fov range within 4° (warned) and roll within maxRoll.
 * - hold: a progress-driven drift around a held page (C1 at the plateau edges).
 * - Pointer parallax is separate and damped; the progress itself is never damped twice.
 * - update() allocates nothing.
 */
import { Vector3 } from 'three/webgpu'

const prefersReducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches

const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) )
const GL_X = [-0.7745966692414834, 0, 0.7745966692414834]
const GL_W = [0.5555555555555556, 0.8888888888888888, 0.5555555555555556]
const LUT = 64 // arc-length nodes per segment (cubic Hermite inverse between them: C1)

/** Monotone-preserving slopes (Fritsch–Carlson) for y over strictly increasing x. */
function pchipSlopes( x, y ) {
	const n = x.length
	const m = new Float64Array( n )
	if ( n < 2 ) return m
	const d = new Float64Array( n - 1 )
	for ( let i = 0; i < n - 1; i++ ) d[i] = ( y[i + 1] - y[i] ) / ( x[i + 1] - x[i] )
	m[0] = d[0]
	m[n - 1] = d[n - 2]
	for ( let i = 1; i < n - 1; i++ ) {
		if ( d[i - 1] * d[i] <= 0 ) {
			m[i] = 0
			continue
		}
		const h0 = x[i] - x[i - 1]
		const h1 = x[i + 1] - x[i]
		const w1 = 2 * h1 + h0
		const w2 = h1 + 2 * h0
		m[i] = ( w1 + w2 ) / ( w1 / d[i - 1] + w2 / d[i] )
	}
	// end slopes: keep them inside the monotone region
	for ( const [i, k] of [[0, 0], [n - 1, n - 2]] ) {
		if ( d[k] === 0 || Math.sign( m[i] ) !== Math.sign( d[k] ) ) m[i] = 0
		else if ( Math.abs( m[i] ) > 3 * Math.abs( d[k] ) ) m[i] = 3 * d[k]
	}
	return m
}

const hermite = ( y0, y1, m0, m1, t ) => {
	const t2 = t * t
	const t3 = t2 * t
	return ( 2 * t3 - 3 * t2 + 1 ) * y0 + ( t3 - 2 * t2 + t ) * m0 + ( -2 * t3 + 3 * t2 ) * y1 + ( t3 - t2 ) * m1
}

const findSegment = ( xs, t ) => {
	let lo = 0
	let hi = xs.length - 2
	while ( lo < hi ) {
		const mid = ( lo + hi + 1 ) >> 1
		if ( xs[mid] <= t ) lo = mid
		else hi = mid - 1
	}
	return lo
}

/**
 * Scalar PCHIP track through ( ats[i], values[i] ). Returns ( t ) => value. Pure.
 */
export function createScalarTrack( ats, values ) {
	const n = ats.length
	if ( n === 1 ) return () => values[0]
	const m = pchipSlopes( ats, values )
	return ( t ) => {
		if ( t <= ats[0] ) return values[0]
		if ( t >= ats[n - 1] ) return values[n - 1]
		const j = findSegment( ats, t )
		const h = ats[j + 1] - ats[j]
		return hermite( values[j], values[j + 1], m[j] * h, m[j + 1] * h, ( t - ats[j] ) / h )
	}
}

/**
 * N-D track (default 3D): centripetal Catmull-Rom geometry through `points`, timed by arc length
 * with a PCHIP curve through ( ats[i], arc length at point i ). C1 in t (velocity continuous), pure.
 * @param {number[][]} points [[x, y, z, ...], ...] (all the same dimension)
 * @param {number[]} ats strictly increasing
 * @returns {{ eval( t: number, out: Vector3|number[]|Float64Array ): typeof out, length: number, dim: number }}
 *   A Vector3 `out` receives the first three components; an array receives all of them.
 */
export function createTrack( points, ats ) {
	const n = points.length
	const D = points[0].length
	const write = ( out, get ) => {
		if ( out.isVector3 ) return out.set( get( 0 ), get( 1 ), get( 2 ) )
		for ( let a = 0; a < D; a++ ) out[a] = get( a )
		return out
	}
	if ( n === 1 ) {
		const p = points[0]
		return { length: 0, dim: D, eval: ( t, out ) => write( out, ( a ) => p[a] ) }
	}
	const segs = n - 1
	const stride = D * 4
	const coef = new Float64Array( segs * stride ) // per segment, per axis: c0..c3
	const P = ( i ) => {
		if ( i < 0 ) return points[0].map( ( v, a ) => 2 * v - points[1][a] )
		if ( i > n - 1 ) return points[n - 1].map( ( v, a ) => 2 * v - points[n - 2][a] )
		return points[i]
	}
	const dist = ( a, b ) => {
		let d = 0
		for ( let k = 0; k < D; k++ ) d += ( b[k] - a[k] ) ** 2
		return Math.sqrt( d )
	}
	// knot tangents (centripetal, Barry–Goldman form); an axis that repeats a neighbour's value gets a
	// zero tangent there, so held values (a target that waits while the camera moves) never overshoot
	const T = new Float64Array( n * D )
	for ( let i = 0; i < n; i++ ) {
		const a0 = P( i - 1 )
		const a1 = P( i )
		const a2 = P( i + 1 )
		let dA = Math.sqrt( dist( a0, a1 ) )
		let dB = Math.sqrt( dist( a1, a2 ) )
		if ( dA < 1e-4 && dB < 1e-4 ) continue
		if ( dA < 1e-4 ) dA = dB
		if ( dB < 1e-4 ) dB = dA
		for ( let a = 0; a < D; a++ ) {
			if ( Math.abs( a1[a] - a0[a] ) < 1e-6 || Math.abs( a2[a] - a1[a] ) < 1e-6 ) continue
			T[i * D + a] = ( a1[a] - a0[a] ) / dA - ( a2[a] - a0[a] ) / ( dA + dB ) + ( a2[a] - a1[a] ) / dB
		}
	}
	for ( let j = 0; j < segs; j++ ) {
		const p1 = points[j]
		const p2 = points[j + 1]
		const dt = Math.sqrt( dist( p1, p2 ) )
		for ( let a = 0; a < D; a++ ) {
			const x1 = p1[a]
			const x2 = p2[a]
			const t1 = T[j * D + a] * dt
			const t2 = T[( j + 1 ) * D + a] * dt
			const o = j * stride + a * 4
			coef[o] = x1
			coef[o + 1] = t1
			coef[o + 2] = -3 * x1 + 3 * x2 - 2 * t1 - t2
			coef[o + 3] = 2 * x1 - 2 * x2 + t1 + t2
		}
	}
	const speedAt = ( j, u ) => {
		const o = j * stride
		let sq = 0
		for ( let a = 0; a < D; a++ ) {
			const k = o + a * 4
			const d = coef[k + 1] + 2 * coef[k + 2] * u + 3 * coef[k + 3] * u * u
			sq += d * d
		}
		return Math.sqrt( sq )
	}
	// arc-length LUT per segment (3-point Gauss–Legendre per interval)
	const lutL = new Float64Array( segs * ( LUT + 1 ) )
	const lutInv = new Float64Array( segs * ( LUT + 1 ) ) // du/ds at nodes
	const segLen = new Float64Array( segs )
	const S = new Float64Array( n ) // cumulative arc length at each key
	for ( let j = 0; j < segs; j++ ) {
		const base = j * ( LUT + 1 )
		let L = 0
		lutL[base] = 0
		const half = 0.5 / LUT
		for ( let k = 0; k < LUT; k++ ) {
			const mid = k / LUT + half
			let acc = 0
			for ( let g = 0; g < 3; g++ ) acc += GL_W[g] * speedAt( j, mid + GL_X[g] * half )
			L += acc * half
			lutL[base + k + 1] = L
		}
		for ( let k = 0; k <= LUT; k++ ) {
			const sp = speedAt( j, k / LUT )
			lutInv[base + k] = sp > 1e-9 ? 1 / sp : 0
		}
		segLen[j] = L
		S[j + 1] = S[j] + L
	}
	const slopes = pchipSlopes( ats, S )

	// arc length (within segment j) -> curve parameter u, C1 cubic Hermite between LUT nodes
	const uOf = ( j, s ) => {
		const len = segLen[j]
		if ( len < 1e-9 || s <= 0 ) return 0
		if ( s >= len ) return 1
		const base = j * ( LUT + 1 )
		let lo = 0
		let hi = LUT - 1
		while ( lo < hi ) {
			const mid = ( lo + hi + 1 ) >> 1
			if ( lutL[base + mid] <= s ) lo = mid
			else hi = mid - 1
		}
		const L0 = lutL[base + lo]
		const h = lutL[base + lo + 1] - L0
		const du = 1 / LUT
		if ( h < 1e-12 ) return lo * du
		const sec = du / h
		const m0 = Math.min( lutInv[base + lo] || sec, 3 * sec ) * h
		const m1 = Math.min( lutInv[base + lo + 1] || sec, 3 * sec ) * h
		return hermite( lo * du, ( lo + 1 ) * du, m0, m1, ( s - L0 ) / h )
	}

	let cj = 0
	let cu = 0
	const comp = ( a ) => {
		const k = cj * stride + a * 4
		return coef[k] + cu * ( coef[k + 1] + cu * ( coef[k + 2] + cu * coef[k + 3] ) )
	}
	return {
		length: S[n - 1],
		dim: D,
		eval( t, out ) {
			let j
			let s
			if ( t <= ats[0] ) {
				j = 0
				s = 0
			} else if ( t >= ats[n - 1] ) {
				j = segs - 1
				s = segLen[j]
			} else {
				j = findSegment( ats, t )
				const h = ats[j + 1] - ats[j]
				s = hermite( S[j], S[j + 1], slopes[j] * h, slopes[j + 1] * h, ( t - ats[j] ) / h ) - S[j]
			}
			cj = j
			cu = uOf( j, clamp( s, 0, segLen[j] ) )
			return write( out, comp )
		},
	}
}

const toArr = ( v ) => ( Array.isArray( v ) ? v : [v.x, v.y, v.z] )

/**
 * @param {import('three/webgpu').PerspectiveCamera} camera
 * @param {object} o
 * @param {Array<{ at: number, pos: number[]|Vector3, target: number[]|Vector3, fov?: number, roll?: number, hold?: number[]|{ pos?: number[], target?: number[] }, fit?: [number, number, number?] }>} o.keys
 *   at: page index (fractional = mid-transition waypoint). fov in degrees (default: the camera's fov
 *   at creation). roll in radians. hold: world-space drift amplitude while the page is held (pos only
 *   for an array). fit: [width, height, margin = 1.1] box around the target the camera pulls back to
 *   frame (portrait phones), never closer than the authored distance. Keys without `fit` (waypoints,
 *   orbit arcs) interpolate the pull-back ratio of their fitted neighbours; `fit: false` opts out.
 * @param {object} [o.scroll] createScroll() instance: provides dwellMap, dwell and the live mapped value
 * @param {(p: number) => number} [o.map] progress -> mapped (default scroll.dwellMap, else identity)
 * @param {number} [o.dwell] plateau fraction for hold drift (default scroll.dwell)
 * @param {{ amount?: number, damping?: number }|false} [o.parallax] amount = fraction of the camera-target distance
 * @param {number} [o.maxRoll=0.2] radians
 * @param {'pose'|'separate'} [o.timing='pose'] 'pose': pos and target are the two halves of one
 *   centripetal Catmull-Rom curve in 6D pose space (shared knots + arc-length timing), so framing
 *   changes evenly and both stay C1 together. 'separate': two independent 3D curves, each timed by
 *   its own arc length (still C1 each, but a target that stops early can whip the view).
 * @param {number} [o.targetWeight=1] weight of target motion vs camera motion in pose space
 * @param {{ onResize: Function }} [o.stage] re-fit `fit` keys on resize
 */
export function createRig( camera, o = {} ) {
	const scroll = o.scroll ?? null
	const map = o.map ?? ( scroll ? ( p ) => scroll.dwellMap( p ) : ( p ) => p )
	const dwell = o.dwell ?? scroll?.dwell ?? 0
	const maxRoll = o.maxRoll ?? 0.2
	const timing = o.timing ?? 'pose'
	const targetWeight = Math.max( 1e-3, o.targetWeight ?? 1 )
	const baseFov = o.fov ?? camera.fov
	const parallax = o.parallax === false ? { amount: 0, damping: 4 } : { amount: 0.012, damping: 4, ...( o.parallax || {} ) }
	const up = new Vector3( 0, 1, 0 )

	let rawKeys = []
	let posTrack = null
	let targetTrack = null
	let poseTrack = null
	const poseBuf = new Float64Array( 6 )
	let fovTrack = null
	let rollTrack = null
	let holdPos = []
	let holdTarget = []
	let hasHold = false
	let lastPage = 0

	const pose = { pos: new Vector3(), target: new Vector3(), fov: baseFov, roll: 0 }
	const tmpA = new Vector3()
	const tmpB = new Vector3()
	let px = 0
	let py = 0

	function setKeys( keys ) {
		rawKeys = keys.slice().sort( ( a, b ) => a.at - b.at )
		for ( let i = 1; i < rawKeys.length; i++ ) {
			if ( rawKeys[i].at - rawKeys[i - 1].at < 1e-6 ) throw new Error( `createRig: two keys at ${rawKeys[i].at}` )
		}
		build()
		return rig
	}

	function build() {
		const keys = rawKeys
		const ats = keys.map( ( k ) => k.at )
		const vFovOf = ( f ) => ( f * Math.PI ) / 180
		// fit: pull-back ratio per fitted key; keys without `fit` (waypoints, orbit arcs) interpolate the
		// ratio of their fitted neighbours so a sequence keeps one consistent framing distance
		const ratio = keys.map( ( k ) => {
			if ( !k.fit ) return null
			const p = toArr( k.pos )
			const t = toArr( k.target )
			const [w, h, margin = 1.1] = k.fit
			const half = Math.tan( vFovOf( k.fov ?? baseFov ) / 2 )
			const need = Math.max( ( h * margin ) / 2 / half, ( w * margin ) / 2 / ( half * Math.max( 1e-3, camera.aspect ) ) )
			const d = Math.hypot( p[0] - t[0], p[1] - t[1], p[2] - t[2] )
			return d < 1e-6 ? 1 : Math.max( 1, need / d )
		} )
		const anchors = ratio.map( ( r, i ) => ( r === null ? -1 : i ) ).filter( ( i ) => i >= 0 )
		const ratioAt = ( i ) => {
			if ( ratio[i] !== null ) return ratio[i]
			if ( keys[i].fit === false || anchors.length === 0 ) return 1
			let a = -1
			let b = -1
			for ( const j of anchors ) {
				if ( j < i ) a = j
				else if ( b < 0 ) b = j
			}
			if ( a < 0 ) return ratio[b]
			if ( b < 0 ) return ratio[a]
			const f = ( ats[i] - ats[a] ) / ( ats[b] - ats[a] )
			return ratio[a] + ( ratio[b] - ratio[a] ) * f
		}
		const pos = keys.map( ( k, i ) => {
			const p = toArr( k.pos ).slice()
			const r = ratioAt( i )
			if ( r === 1 ) return p
			const t = toArr( k.target )
			return [t[0] + ( p[0] - t[0] ) * r, t[1] + ( p[1] - t[1] ) * r, t[2] + ( p[2] - t[2] ) * r]
		} )
		const targets = keys.map( ( k ) => toArr( k.target ) )
		if ( timing === 'pose' ) {
			// one centripetal curve in pose space (pos, target * w): both move in step, C1 together
			poseTrack = createTrack( pos.map( ( p, i ) => [...p, ...targets[i].map( ( v ) => v * targetWeight )] ), ats )
			posTrack = targetTrack = null
		} else {
			posTrack = createTrack( pos, ats )
			targetTrack = createTrack( targets, ats )
			poseTrack = null
		}
		const fovs = keys.map( ( k ) => k.fov ?? baseFov )
		const fovRange = Math.max( ...fovs ) - Math.min( ...fovs )
		if ( fovRange > 4 + 1e-6 ) console.warn( `[rig] fov range ${fovRange.toFixed( 1 )}° > 4°: keep it nearly constant` )
		fovTrack = createScalarTrack( ats, fovs )
		rollTrack = createScalarTrack( ats, keys.map( ( k ) => clamp( k.roll ?? 0, -maxRoll, maxRoll ) ) )

		lastPage = Math.max( 0, Math.floor( ats[ats.length - 1] ) )
		holdPos = []
		holdTarget = []
		hasHold = false
		for ( let i = 0; i <= lastPage; i++ ) {
			holdPos.push( new Vector3() )
			holdTarget.push( new Vector3() )
		}
		for ( const k of keys ) {
			if ( !k.hold || !Number.isInteger( k.at ) ) continue
			const hp = Array.isArray( k.hold ) ? k.hold : k.hold.pos
			const ht = Array.isArray( k.hold ) ? null : k.hold.target
			if ( hp ) holdPos[k.at].fromArray( hp )
			if ( ht ) holdTarget[k.at].fromArray( ht )
			hasHold = true
		}
	}

	/**
	 * Pure pose for a progress value (no parallax). `mapped` overrides map( progress ).
	 * @returns {{ pos: Vector3, target: Vector3, fov: number, roll: number }}
	 */
	function sample( progress, out = { pos: new Vector3(), target: new Vector3(), fov: baseFov, roll: 0 }, mapped ) {
		const m = mapped ?? map( progress )
		if ( poseTrack ) {
			poseTrack.eval( m, poseBuf )
			out.pos.set( poseBuf[0], poseBuf[1], poseBuf[2] )
			out.target.set( poseBuf[3] / targetWeight, poseBuf[4] / targetWeight, poseBuf[5] / targetWeight )
		} else {
			posTrack.eval( m, out.pos )
			targetTrack.eval( m, out.target )
		}
		out.fov = fovTrack( m )
		out.roll = rollTrack( m )
		if ( hasHold && dwell > 1e-3 ) {
			// (p - m) runs -dwell/2 .. +dwell/2 across a held page and unwinds to 0 mid-transition: C1
			const s = ( progress - m ) / ( dwell * 0.5 )
			const k = clamp( Math.floor( m ), 0, lastPage )
			const f = clamp( m - k, 0, 1 )
			const k1 = Math.min( k + 1, lastPage )
			tmpA.copy( holdPos[k] ).lerp( holdPos[k1], f )
			tmpB.copy( holdTarget[k] ).lerp( holdTarget[k1], f )
			out.pos.addScaledVector( tmpA, s )
			out.target.addScaledVector( tmpB, s )
		}
		return out
	}

	/**
	 * Drive the camera. Pass scroll.progress: the rig then uses scroll.mapped (which also flattens
	 * plateaus during dot / hash flights). `pointer` is stage.pointer (NDC).
	 */
	function update( progress = scroll?.progress ?? 0, dt = 1 / 60, pointer = null, mapped ) {
		const m = mapped ?? ( scroll && progress === scroll.progress ? scroll.mapped : map( progress ) )
		sample( progress, pose, m )
		camera.position.copy( pose.pos )
		camera.up.copy( up )
		camera.lookAt( pose.target )
		if ( parallax.amount > 0 && !prefersReducedMotion ) {
			const k = 1 - Math.exp( -parallax.damping * dt )
			px += ( ( pointer?.x ?? 0 ) - px ) * k
			py += ( ( pointer?.y ?? 0 ) - py ) * k
			if ( Math.abs( px ) + Math.abs( py ) > 1e-5 ) {
				const d = pose.pos.distanceTo( pose.target ) * parallax.amount
				camera.translateX( px * d )
				camera.translateY( py * d )
				camera.lookAt( pose.target )
			}
		}
		if ( pose.roll !== 0 ) camera.rotateZ( pose.roll )
		if ( Math.abs( camera.fov - pose.fov ) > 1e-4 ) {
			camera.fov = pose.fov
			camera.updateProjectionMatrix()
		}
		return pose
	}

	const rig = {
		pose,
		get keys() { return rawKeys },
		setKeys,
		sample,
		update,
		/** Re-apply `fit` keys for the current camera.aspect. */
		resize() { if ( rawKeys.length ) build() },
		dispose() { offResize?.() },
	}
	const offResize = o.stage?.onResize?.( () => rig.resize() ) ?? null
	setKeys( o.keys ?? [{ at: 0, pos: camera.position.toArray(), target: [0, 0, 0] }] )
	return rig
}

export default createRig
