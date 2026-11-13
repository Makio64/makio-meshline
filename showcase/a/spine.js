/**
 * The Spine: one CatmullRom curve through every station. It is sampled once at a fixed
 * arc-length step (LUT), exposes up-ish frames for the stations that wrap geometry
 * around it, and is drawn as ONE bone-white MeshLine thread that reveals ahead of the
 * camera (widthFn collapse, discard-free), so the thread doubles as the progress bar.
 */
import { MeshLine } from 'makio-meshline'
import { float, Fn, mix, smoothstep, uniform, vec3, vec4 } from 'three/tsl'
import { CatmullRomCurve3, Color, Vector3 } from 'three/webgpu'

const UP = new Vector3( 0, 1, 0 )
const STEP = 0.25 // world units between LUT samples

/**
 * @param {Array<{ anchor: number[], dir: number[], half: number }>} segments straight runs (one per station)
 * @param {Array<number[]|null>} [waypoints] optional extra points inserted AFTER segment i (same index)
 */
export function createSpine( segments, waypoints = [] ) {
	const control = []
	const anchorsAt = [] // index into control of each station anchor
	const a = new Vector3()
	const d = new Vector3()
	segments.forEach( ( seg, i ) => {
		a.fromArray( seg.anchor )
		d.fromArray( seg.dir ).normalize()
		// five collinear points keep the station run straight under CatmullRom
		for ( const k of [-1, -0.5, 0, 0.5, 1] ) {
			if ( k === 0 ) anchorsAt.push( control.length )
			control.push( a.clone().addScaledVector( d, seg.half * k ) )
		}
		const extra = waypoints[i]
		if ( extra ) for ( const w of extra ) control.push( new Vector3().fromArray( w ) )
	} )

	const curve = new CatmullRomCurve3( control, false, 'centripetal' )
	curve.arcLengthDivisions = 6000
	const length = curve.getLength()
	const count = Math.max( 2, Math.ceil( length / STEP ) + 1 )
	const points = new Float32Array( count * 3 )
	const tmp = new Vector3()
	for ( let i = 0; i < count; i++ ) {
		curve.getPointAt( i / ( count - 1 ), tmp )
		tmp.toArray( points, i * 3 )
	}
	const ds = length / ( count - 1 )

	// arc length of each station anchor: nearest LUT sample to the anchor point
	const anchorS = segments.map( ( seg ) => {
		a.fromArray( seg.anchor )
		let best = 0
		let bestD = Infinity
		for ( let i = 0; i < count; i++ ) {
			const dx = points[i * 3] - a.x
			const dy = points[i * 3 + 1] - a.y
			const dz = points[i * 3 + 2] - a.z
			const dd = dx * dx + dy * dy + dz * dz
			if ( dd < bestD ) { bestD = dd; best = i }
		}
		return best * ds
	} )

	const clampS = ( s ) => Math.min( length, Math.max( 0, s ) )

	/** Position at arc length s (linear between LUT samples; s is clamped). */
	function at( s, out = new Vector3() ) {
		const f = clampS( s ) / ds
		const i = Math.min( count - 2, Math.floor( f ) )
		const k = f - i
		const o = i * 3
		return out.set(
			points[o] + ( points[o + 3] - points[o] ) * k,
			points[o + 1] + ( points[o + 4] - points[o + 1] ) * k,
			points[o + 2] + ( points[o + 5] - points[o + 2] ) * k,
		)
	}

	const p0 = new Vector3()
	const p1 = new Vector3()
	/** Up-ish frame at s: T tangent, N world-up orthogonalised (falls back to +z when vertical), B = T x N. */
	function frame( s, T = new Vector3(), N = new Vector3(), B = new Vector3() ) {
		at( s - 0.6, p0 )
		at( s + 0.6, p1 )
		T.subVectors( p1, p0 ).normalize()
		N.copy( UP ).addScaledVector( T, -T.dot( UP ) )
		if ( N.lengthSq() < 1e-4 ) N.set( 0, 0, 1 ).addScaledVector( T, -T.z )
		N.normalize()
		B.crossVectors( T, N ).normalize()
		return { T, N, B }
	}

	/** Copy of the LUT between s0 and s1 resampled every `step` units. */
	function slice( s0, s1, step = STEP ) {
		const n = Math.max( 2, Math.round( ( s1 - s0 ) / step ) + 1 )
		const out = new Float32Array( n * 3 )
		for ( let i = 0; i < n; i++ ) at( s0 + ( s1 - s0 ) * ( i / ( n - 1 ) ), tmp ).toArray( out, i * 3 )
		return out
	}

	/** Bounding sphere of the whole spine (finale framing). */
	function bounds() {
		let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
		for ( let i = 0; i < count; i++ ) {
			const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2]
			minX = Math.min( minX, x ); maxX = Math.max( maxX, x )
			minY = Math.min( minY, y ); maxY = Math.max( maxY, y )
			minZ = Math.min( minZ, z ); maxZ = Math.max( maxZ, z )
		}
		const center = new Vector3( ( minX + maxX ) / 2, ( minY + maxY ) / 2, ( minZ + maxZ ) / 2 )
		const size = new Vector3( maxX - minX, maxY - minY, maxZ - minZ )
		return { center, size }
	}

	return { curve, points, count, length, ds, anchorS, at, frame, slice, bounds }
}

/**
 * The thread: one MeshLine along the full spine. Constant CSS-pixel width so it reads as a
 * hairline both up close and in the finale pull-back. `head` (normalized arc length) is where
 * the line stops; a short HDR segment glows behind the head (bloom on the line head only).
 * `hideFrom/hideTo` collapse a span (e.g. inside the statue) without a second draw.
 */
export function createThread( spine, { color = 0xe9e3d6, width = 2.2 } = {} ) {
	const head = uniform( 0.1 )
	const glow = uniform( 3.2 )
	const hideFrom = uniform( 2 )
	const hideTo = uniform( 2 )
	const hide = uniform( 0 )
	const fade = 6 / spine.length // normalized fade-in length of the head
	const glowLen = 18 / spine.length
	const bone = new Color( color )

	const line = new MeshLine()
		.lines( spine.points, false )
		.sizeAttenuation( false )
		.lineWidth( width )
		.color( bone )
		.widthFn( Fn( ( [w, progress] ) => {
			const reveal = float( 1 ).sub( smoothstep( head.sub( fade ), head, progress ) )
			const inHidden = smoothstep( hideFrom.sub( 0.002 ), hideFrom, progress ).mul( float( 1 ).sub( smoothstep( hideTo, hideTo.add( 0.002 ), progress ) ) )
			return w.mul( reveal ).mul( float( 1 ).sub( inHidden.mul( hide ) ) )
		} ) )
		.colorFn( Fn( ( [c, progress] ) => {
			const k = smoothstep( head.sub( glowLen ), head, progress )
			const hot = mix( vec3( c.rgb ), vec3( 0.7, 0.95, 1.0 ), k.mul( 0.5 ) )
			return vec4( hot.mul( k.mul( glow ).add( 1 ) ), 1 )
		} ) )
		.autoResize()
		.build()
	line.frustumCulled = false
	line.name = 'thread'
	return { line, head, glow, hideFrom, hideTo, hide }
}
