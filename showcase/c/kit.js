/**
 * Musée des Lignes · shared kit: palette, plaque typography (ultra-text) and the small
 * MeshLine props every room uses (rules, frames, plinths, spotlight cones, dust, arches).
 */
import { loadRings } from '@shared/rings.js'
import { RING_LAYOUTS } from '@shared/statues.js'
import { createCounter, createText } from '@shared/text.js'
import { MeshLine } from 'makio-meshline'
import { cameraPosition, cos, float, Fn, fract, hash, instanceIndex, sin, smoothstep, uniform, varying, vec3 } from 'three/tsl'
import { AdditiveBlending, Group, Vector3 } from 'three/webgpu'

export const BG = 0x0c0b0a
export const C = {
	bg: 0x0c0b0a,
	ivory: 0xece4d6,
	gold: 0xc8a25a,
	goldHot: 0xffd27a,
	stone: 0x8a8174,
	blue: 0x2f5a8c,
}
export const CSS_GOLD = '#c8a25a'
export const CSS_IVORY = '#ece4d6'
export const FLOOR_Y = -7.2

/**
 * Pre-baked statue rings (one fetch, no BVH). Always the full 64 × 96 layout, phones included: the
 * plaques print its point count.
 */
export const roomRings = ( name ) => loadRings( name, RING_LAYOUTS.full )

/** Options for a plain counter.setValue( v, PLAIN ) (per-frame calls allocate nothing). */
export const PLAIN = Object.freeze( { scramble: 0 } )

/** Assign a style property only when its value changed (per-frame DOM writes stay free at rest). */
export function setStyle( el, prop, value ) {
	const key = `_ms_${prop}`
	if ( el[key] === value ) return
	el[key] = value
	el.style[prop] = value
}

/** Quintic smootherstep on 0..1 (zero velocity and acceleration at both ends). */
export const smoother = ( t ) => {
	const x = t <= 0 ? 0 : t >= 1 ? 1 : t
	return x * x * x * ( x * ( x * 6 - 15 ) + 10 )
}

//------------------------------------------------------------------ easing
export const easeOutBack = ( t, s = 1.70158 ) => {
	const u = t - 1
	return 1 + ( s + 1 ) * u * u * u + s * u * u
}
export const clamp01 = ( v ) => Math.max( 0, Math.min( 1, v ) )

//------------------------------------------------------------------ typography (ultra-text)
/** Engraved gold Cormorant numerals (bloom-fed). */
export const goldText = ( renderer, str, size, o = {} ) => createText( renderer, str, {
	fontFamily: 'Cormorant Garamond', fontWeight: 300, color: CSS_GOLD, letterSpacing: '-0.01em',
}, { size, glow: 1.45, backdrop: BG, ...o } )

/** Animated gold numerals: one counter per number. */
export const goldCounter = ( renderer, template, size, o = {} ) => createCounter( renderer, {
	template, size, glow: 1.45, backdrop: BG,
	css: { fontFamily: 'Cormorant Garamond', fontWeight: 300, color: CSS_GOLD, letterSpacing: '-0.01em' },
	...o,
} )

/**
 * Live readout (bytes this frame, % drawn): JetBrains Mono, so the zero-DOM counter cells are truly
 * tabular while the value changes every frame (Cormorant's proportional figures leave gaps).
 */
export const liveCounter = ( renderer, template, size, o = {} ) => createCounter( renderer, {
	template, size, glow: 1.25, backdrop: BG,
	css: { fontFamily: 'JetBrains Mono', fontWeight: 400, color: CSS_GOLD, letterSpacing: '0em' },
	...o,
} )

// wall labels read at ~11 px on a 1280 × 800 screen (callers pass the old 0.15–0.21 scale)
const CAPS_SCALE = 1.32
/** Inter caps caption (the museum wall-label voice). Version tags keep their lowercase 'v'. */
export async function capsText( renderer, str, size = 0.21, o = {} ) {
	const group = await createText( renderer, str.toUpperCase().replace( /\bV(\d+(\.\d+)*)\b/g, 'v$1' ), {
		fontFamily: 'Inter', fontWeight: 600, color: CSS_IVORY, letterSpacing: '0.26em',
	}, { size: size * CAPS_SCALE, opacity: 0.72, backdrop: BG, ...o } )
	group.isCaps = true // main.js enlarges wall labels on phones
	return group
}

/** The ≤10-word room line, ivory serif. */
export const lineText = ( renderer, str, size = 0.6, o = {} ) => createText( renderer, str, {
	fontFamily: 'Cormorant Garamond', fontWeight: 400, color: CSS_IVORY, letterSpacing: '0.005em',
}, { size, glow: 1.05, backdrop: BG, ...o } )

//------------------------------------------------------------------ MeshLine props
const additive = ( line ) => {
	line.build()
	line.material.blending = AdditiveBlending
	line.material.transparent = true
	line.material.depthWrite = false
	return line
}

/** Gold rule that draws itself: `draw` uniform 0..1 along arc-length progress. */
export function goldRule( length, { lineWidth = 0.03, color = C.gold, intensity = 1.6 } = {} ) {
	const draw = uniform( 0 )
	const pts = new Float32Array( 33 * 3 )
	for ( let i = 0; i <= 32; i++ ) pts[i * 3] = ( i / 32 ) * length
	const line = new MeshLine()
		.lines( pts, false )
		.lineWidth( lineWidth )
		.color( color )
		.widthFn( Fn( ( [width, progress] ) => width.mul( smoothstep( draw, draw.sub( 0.03 ), progress ) ) ) )
		.colorFn( Fn( ( [col] ) => col.mul( intensity ) ) )
		.autoResize()
	line.frustumCulled = false
	line.draw = draw
	return line
}

/** Closed rectangle hairline (plaque or picture frame), centred on the origin, XY plane. */
export function frameLine( w, h, { lineWidth = 0.025, color = C.gold, opacity = 1, intensity = 1.2, z = 0 } = {} ) {
	const pts = new Float32Array( [-w / 2, -h / 2, z, w / 2, -h / 2, z, w / 2, h / 2, z, -w / 2, h / 2, z] )
	const uOpacity = uniform( opacity )
	const line = new MeshLine()
		.lines( pts, true )
		.lineWidth( lineWidth )
		.color( color )
		.transparent( true )
		.colorFn( Fn( ( [col] ) => col.mul( intensity ) ) )
		.opacityFn( Fn( ( [a] ) => a.mul( uOpacity ) ) )
		.autoResize()
	line.uOpacity = uOpacity
	return line
}

/** Plinth: box edges + top ring, one MeshLine batch. */
export function plinthLine( { w = 4.2, h = 1.2, y = FLOOR_Y, color = C.ivory, lineWidth = 0.03, opacity = 0.55 } = {} ) {
	const a = w / 2
	const y0 = y
	const y1 = y + h
	const c = [[-a, -a], [a, -a], [a, a], [-a, a]]
	const lines = []
	for ( let i = 0; i < 4; i++ ) {
		const [x0, z0] = c[i]
		const [x1, z1] = c[( i + 1 ) % 4]
		lines.push( new Float32Array( [x0, y0, z0, x1, y0, z1] ) )
		lines.push( new Float32Array( [x0, y1, z0, x1, y1, z1] ) )
		lines.push( new Float32Array( [x0, y0, z0, x0, y1, z0] ) )
	}
	const uOpacity = uniform( opacity )
	const line = new MeshLine()
		.lines( lines, false )
		.lineWidth( lineWidth )
		.color( color )
		.transparent( true )
		.opacityFn( Fn( ( [al] ) => al.mul( uOpacity ) ) )
		.autoResize()
	line.uOpacity = uOpacity
	return line
}

/**
 * Overhead spotlight cone: a fan of `count` additive hairlines from the apex to a floor circle,
 * fading toward the floor. One draw.
 */
export function spotCone( apex, base, radius, { count = 48, lineWidth = 0.012, color = C.ivory, intensity = 0.55 } = {} ) {
	const lines = []
	const steps = 10
	for ( let k = 0; k < count; k++ ) {
		const a = ( k / count ) * Math.PI * 2
		const bx = base.x + Math.cos( a ) * radius
		const bz = base.z + Math.sin( a ) * radius
		const pts = new Float32Array( ( steps + 1 ) * 3 )
		for ( let s = 0; s <= steps; s++ ) {
			const t = s / steps
			pts[s * 3] = apex.x + ( bx - apex.x ) * t
			pts[s * 3 + 1] = apex.y + ( base.y - apex.y ) * t
			pts[s * 3 + 2] = apex.z + ( bz - apex.z ) * t
		}
		lines.push( pts )
	}
	const uIntensity = uniform( intensity )
	const line = new MeshLine()
		.lines( lines, false )
		.lineWidth( lineWidth )
		.color( color )
		.transparent( true )
		.opacityFn( Fn( ( [al, progress] ) => al.mul( float( 1 ).sub( progress ).pow( 1.6 ).mul( 0.85 ).add( 0.05 ) ).mul( uIntensity ) ) )
		.autoResize()
	additive( line )
	line.uIntensity = uIntensity
	return line
}

/**
 * Dust motes: one instanced MeshLine (two GPU points per mote), world-anchored but wrapped in a
 * box around `center` so they always surround the camera's room.
 */
export function createDust( { count = 900, box = [44, 22, 36], lineWidth = 0.035, color = C.ivory, opacity = 0.5 } = {} ) {
	const uCenter = uniform( new Vector3() )
	const uTime = uniform( 0 )
	const uOpacity = uniform( opacity )
	const bx = vec3( box[0], box[1], box[2] )
	const id = float( instanceIndex )
	const flicker = varying( sin( uTime.mul( hash( id.add( 3.3 ) ).mul( 1.6 ).add( 0.4 ) ).add( id ) ).mul( 0.5 ).add( 0.5 ), 'vDustFlicker' )
	const r = vec3( hash( id ), hash( id.add( 17.31 ) ), hash( id.add( 41.77 ) ) )
	const speed = hash( id.add( 7.13 ) ).mul( 0.7 ).add( 0.25 )
	const drift = vec3(
		sin( uTime.mul( 0.11 ).add( id ) ).mul( 0.02 ),
		uTime.mul( speed ).mul( 0.006 ),
		cos( uTime.mul( 0.09 ).add( id.mul( 1.7 ) ) ).mul( 0.02 ),
	)
	const mote = uCenter.add( fract( r.add( drift ).sub( uCenter.div( bx ) ).add( 0.5 ) ).sub( 0.5 ).mul( bx ) )
	// a mote that drifts right in front of the lens would read as a big flat square: fade it out
	const far = varying( smoothstep( 3, 9, mote.distance( cameraPosition ) ), 'vDustFar' )
	const line = new MeshLine()
		.instances( count )
		.segments( 1 )
		.color( color )
		.lineWidth( lineWidth )
		.gpuPositionNode( Fn( ( [progress] ) => mote.add( vec3( 0, progress.mul( 0.05 ), 0 ) ) ) )
		.opacityFn( Fn( ( [al] ) => al.mul( uOpacity ).mul( flicker.mul( 0.8 ).add( 0.2 ) ).mul( far ) ) )
		.autoResize()
	additive( line )
	line.frustumCulled = false
	line.renderOrder = 5
	return { line, center: uCenter, time: uTime, opacity: uOpacity }
}

/** A doorway arch (posts + half circle) in the plane spanning `across` (unit, horizontal). */
export function archPoints( base, across, width, height, segments = 40 ) {
	const r = width / 2
	const pts = []
	const push = ( s, y ) => pts.push( base.x + across.x * s, base.y + y, base.z + across.z * s )
	push( -r, 0 )
	push( -r, height - r )
	for ( let i = 1; i < segments; i++ ) {
		const a = Math.PI - ( i / segments ) * Math.PI
		push( Math.cos( a ) * r, height - r + Math.sin( a ) * r )
	}
	push( r, height - r )
	push( r, 0 )
	return new Float32Array( pts )
}

/** Catmull-Rom (centripetal-free, uniform) resample of control points to `n` points. */
export function catmull( ctrl, n ) {
	const out = new Float32Array( n * 3 )
	const m = ctrl.length
	for ( let k = 0; k < n; k++ ) {
		const u = ( k / ( n - 1 ) ) * ( m - 1 )
		const i = Math.min( m - 2, Math.floor( u ) )
		const t = u - i
		const p0 = ctrl[Math.max( 0, i - 1 )]
		const p1 = ctrl[i]
		const p2 = ctrl[i + 1]
		const p3 = ctrl[Math.min( m - 1, i + 2 )]
		const t2 = t * t
		const t3 = t2 * t
		for ( let c = 0; c < 3; c++ ) {
			out[k * 3 + c] = 0.5 * ( 2 * p1[c] + ( -p0[c] + p2[c] ) * t + ( 2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c] ) * t2 + ( -p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c] ) * t3 )
		}
	}
	return out
}

/** Make a group of plaque pieces face a world point (text and lines live in local XY). */
export function faceTo( obj, target ) {
	obj.lookAt( target )
	return obj
}

/** World position of a room's resting camera (landscape rig key, no hold drift or parallax). */
export function restCamWorld( rest, root, out ) {
	const { radius: r, theta: th, phi: ph, tx = 0, ty = 0 } = rest
	out.set(
		Math.cos( th ) * tx + r * Math.cos( ph ) * Math.sin( th ),
		ty + r * Math.sin( ph ),
		-Math.sin( th ) * tx + r * Math.cos( ph ) * Math.cos( th ),
	)
	return out.add( root.position )
}

/**
 * Gold number that counts with a zero-DOM counter and rests as static proportional text:
 * Cormorant's figures are proportional, so the tabular counter cells only show while moving.
 */
export async function goldCount( renderer, template, finalStr, size, o = {} ) {
	const counter = await goldCounter( renderer, template, size, o )
	const still = await goldText( renderer, finalStr, size, o )
	const group = new Group()
	group.add( counter, still )
	let last = null
	const opts = { scramble: 0 } // reused: per-frame calls allocate nothing
	const api = Object.assign( group, {
		counter,
		still,
		/** Per-frame safe: `scramble` 0..1 while counting, `final` swaps to the proportional still. */
		set( v, scramble = 0, final = false ) {
			const atRest = final && scramble === 0
			counter.visible = !atRest
			still.visible = atRest
			if ( !atRest && ( v !== last || scramble > 0 ) ) {
				opts.scramble = scramble
				counter.setValue( v, opts )
			}
			last = v
			return api
		},
		setValue( v, { scramble = 0, final = false } = {} ) {
			return api.set( v, scramble, final )
		},
		set opacityValue( a ) {
			counter.opacity.value = a
			still.opacity.value = a
		},
		dispose() {
			counter.dispose()
			still.dispose()
			group.removeFromParent()
		},
	} )
	return api
}

/** Per-frame safe opacity / width writes (uniforms only: no rebuild, no bounds recompute). */
export function setLineOpacity( line, a ) {
	const u = line.material?.opacity
	if ( u && typeof u === 'object' && 'value' in u ) u.value = a
	else line.opacity( a )
}
export function setLineWidth( line, w ) {
	const u = line.material?.lineWidth
	if ( u && typeof u === 'object' && 'value' in u ) u.value = w
	else line.lineWidth( w )
}

/** Room-local point `dist` to the right of the statue (seen from the rest camera), lifted to `y`. */
export function besideRest( rest, dist, y, out, toward = 0.8 ) {
	const th = rest.theta
	return out.set( Math.cos( th ) * dist + Math.sin( th ) * toward, y, -Math.sin( th ) * dist + Math.cos( th ) * toward )
}

const _pp = new Vector3()
const PIN_SLIDE = 2.4 // frame widths / 2 a pinned plaque travels per page: it slides in with its room
/**
 * Portrait layout: pin a left-aligned plaque to the lower part of the camera frame (still 3D
 * ultra-text, just camera-anchored) and scale it to fit `width` world units into the frame.
 * `local` (the room's scroll.local) slides it in from the right on arrival and out to the left when
 * leaving, in step with the camera's truck, so two rooms' plaques never sit on top of each other.
 */
export function pinToCamera( obj, camera, root, { x = -0.88, y = -0.42, width = 9.5, D = 14, local = 0 } = {} ) {
	const h = D * Math.tan( ( camera.fov * Math.PI ) / 360 )
	const w = h * camera.aspect
	_pp.set( ( x - local * PIN_SLIDE ) * w, y * h, -D ).applyMatrix4( camera.matrixWorld ).sub( root.position )
	obj.position.copy( _pp )
	obj.quaternion.copy( camera.quaternion )
	obj.scale.setScalar( Math.min( 1, ( 2 * w * 0.9 ) / width ) )
}
