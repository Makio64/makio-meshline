/**
 * 05 · Venus & David — the signature. The thread arrives at the plinth and coils into 64 helix
 * turns that snap shut, bottom to top, into David's contour rings. Each scroll step sweeps a
 * blooming wave feet → head: David → Venus → Nefertiti. ONE instanced MeshLine (64 × 96,
 * GPU-placed from a float texture, rings pre-baked: no BVH at runtime). The camera makes the
 * journey's only orbit: arc keys in journey.js (st.orbit), held on each statue.
 * Spans scroll steps 4, 5, 6 (sub 0..2, dwell-mapped: the morph holds while the camera holds).
 */
import { clamp, remap } from '@shared/math.js'
import { createRingStack, loadStatueRings, proceduralRings } from '@shared/statues.js'
import { MeshLine } from 'makio-meshline'
import { Color, DoubleSide, Quaternion, Vector3 } from 'three/webgpu'

import { monument, num, text } from '../type.js'

const NAMES = ['david', 'venus', 'nefertiti']
// billboard layouts: land [x, y] world units (16:10 design), port [nx, ny, scale] normalized viewport
const L_TAG = [8.4, 3.6]
const P_TAG = [-0.86, 0.79, 1.3]
const L_RINGS = [-10.4, 2.8]
const P_RINGS = [-0.86, -0.5, 1.25]
const L_POINTS = [-10.4, 0.4]
const P_POINTS = [0.06, -0.5, 1.25]
const L_DRAW = [-10.4, -2.0]
const P_DRAW = [-0.86, -0.69, 1.25]
const L_LINE = [8.4, 2.1]
const P_LINE = [-0.86, 0.68, 1.35]
// orbit angle held on each statue (camera at anchor + R·(sin θ, cos θ); the baked statues face +x).
// The orbit runs down the east side, θ decreasing: David three-quarter from the north-east (entered
// tangentially from the ribbon), Venus frontal, Nefertiti in near profile from the south. It ends
// heading west / south, so the crane up to the culling god view (south, high) never reverses: no
// page has to be force-held and a fast scroll flies through the orbit without a hard stop.
const THETA = [2.7, 1.45, 0.2]

export default async function build( st, ctx ) {
	const { renderer, camera } = ctx
	st.fog = [20, 64]
	st.bloom = 0.72
	st.rideIn = st.anchorS - st.half - 24
	st.rideOut = st.anchorS + st.half + 2
	st.headS = st.anchorS + st.half + 22
	// the statue is the thread now: hide the whole spine while we orbit (other stretches cross the view)
	st.hide = [0, 1.01]

	const anchor = st.anchor.clone()
	const [k0] = st.steps
	const TAN = Math.tan( ( 50 * Math.PI ) / 360 ) // rig FOV
	const fit = ( w, h, m ) => Math.max( ( h * m ) / 2 / TAN, ( w * m ) / 2 / ( TAN * camera.aspect ) )
	const radius = () => ( st.isPortrait() ? fit( 13.5, 20, 1.04 ) : Math.max( 23, fit( 14, 19, 1.05 ) ) )
	const center = new Vector3( anchor.x, anchor.y - 0.9, anchor.z )
	/** Orbit pose at angle theta (radius / rise multiply / add to the rest orbit). */
	const orbitPose = ( theta, out, { radius: rk = 1, rise = 0 } = {} ) => {
		const R = radius() * rk
		out.pos.set( anchor.x + Math.sin( theta ) * R, anchor.y + 1.6 + rise, anchor.z + Math.cos( theta ) * R )
		out.target.copy( center )
		return out
	}
	st.orbit = { center, theta: THETA, pose: orbitPose }
	const restPose = { pos: null, target: null }
	st.pose = ( p, pos, look ) => {
		const sub = clamp( p - k0, 0, 2 )
		const i = Math.min( 1, Math.floor( sub ) )
		restPose.pos = pos
		restPose.target = look
		orbitPose( THETA[i] + ( THETA[i + 1] - THETA[i] ) * ( sub - i ), restPose )
	}
	st.fogScale = () => radius() / 23

	//------------------------------------------------------------------ shapes: helix turns + three statues
	const statues = await Promise.all( NAMES.map( ( n ) => loadStatueRings( n ) ) ) // baked .bin, one fetch each
	const minY = Math.min( ...statues.map( ( s ) => s.minY ) )
	const maxY = Math.max( ...statues.map( ( s ) => s.maxY ) )
	const helix = proceduralRings( { rings: 64, samples: 96, name: 'helix' }, ( t, a, out, r, i ) => {
		const y = minY + ( ( r + i / 96 ) / 64 ) * ( maxY - minY )
		const R = 3.1
		out[0] = Math.cos( a ) * R
		out[1] = y
		out[2] = Math.sin( a ) * R
	} )
	const shapes = [helix, ...statues]
	const palettes = [[0xe9e3d6, 0x9fe8ff], null, null, null]
	const stack = createRingStack( shapes, { lineWidth: 0.026, intensity: 0.9, palettes, swell: 0.6, widthSwell: 0.1 } )
	stack.line.position.copy( anchor )
	stack.line.build()
	st.group.add( stack.line )

	// reflection on the plinth: a mirrored, faint second stack (same shapes, synced morph)
	const PLINTH = minY - 0.35
	const mirror = createRingStack( shapes, { lineWidth: 0.026, intensity: 0.32, palettes, swell: 0.6, widthSwell: 0.1, opacity: 0.4 } )
	mirror.line.position.set( anchor.x, anchor.y + PLINTH * 2, anchor.z )
	mirror.line.scale.y = -1
	mirror.line.build()
	mirror.line.material.side = DoubleSide // the mirrored transform flips the winding
	st.group.add( mirror.line )

	// plinth: concentric hairline rings + a slow dashed ring
	const circles = []
	for ( let r = 0; r < 6; r++ ) {
		const rad = 2.4 + r * 1.25
		const c = new Float32Array( 129 * 3 )
		for ( let i = 0; i <= 128; i++ ) {
			const a = ( i / 128 ) * Math.PI * 2
			c[i * 3] = Math.cos( a ) * rad
			c[i * 3 + 1] = PLINTH
			c[i * 3 + 2] = Math.sin( a ) * rad
		}
		circles.push( c.subarray( 0, 128 * 3 ) )
	}
	const plinth = new MeshLine()
		.lines( circles, true )
		.lineWidth( 0.018 )
		.color( new Color( 0xe9e3d6 ).multiplyScalar( 0.32 ) )
		.dash( { count: 64, ratio: 0.6 } )
		.build()
	plinth.position.copy( anchor )
	st.group.add( plinth )

	//------------------------------------------------------------------ type (billboards: the camera orbits)
	const tags = []
	for ( const n of NAMES ) {
		const tg = await text( renderer, n, { kind: 'caps', size: 0.36, align: 'left', css: { letterSpacing: '0.5em', color: '#e9e3d6' } } )
		st.group.add( tg )
		tags.push( tg )
	}
	const mRings = await monument( renderer, num( 'statueRings' ).value, 'rings × samples', { size: 1.1, captionSize: 0.24, align: 'left' } )
	const mPoints = await monument( renderer, num( 'statuePoints' ).value, 'GPU-placed points', { size: 1.1, captionSize: 0.24, align: 'left' } )
	const mDraw = await monument( renderer, num( 'oneDraw' ).value, 'for every ring', { size: 1.1, captionSize: 0.24, align: 'left' } )
	const line = await text( renderer, 'Beauty in one draw call.', { kind: 'line', size: 0.52, align: 'left' } )
	st.group.add( mRings, mPoints, mDraw, line )

	const q = new Quaternion()
	const right = new Vector3()
	const up = new Vector3()
	const toCam = new Vector3()
	// billboards in the plane through the statue facing the camera.
	// land: [x, y] world units (16:10 design, squeezed on narrower landscapes); port: [nx, ny, scale] normalized viewport
	let portrait = false
	const half = { w: 1, h: 1 }
	let squeeze = 1
	const billboard = ( obj, land, port ) => {
		obj.quaternion.copy( q )
		if ( portrait ) {
			obj.scale.setScalar( port[2] )
			obj.position.copy( look0 ).addScaledVector( right, port[0] * half.w ).addScaledVector( up, port[1] * half.h )
		} else {
			obj.scale.setScalar( squeeze )
			obj.position.copy( anchor ).addScaledVector( right, land[0] * squeeze ).addScaledVector( up, land[1] )
		}
	}
	const look0 = new Vector3()

	let time = 0
	st.update = ( { t, sub, dt } ) => {
		time += dt
		// arrival: helix turns reveal (t -1..-0.45), then snap shut into David (-0.45..0)
		const reveal = clamp( remap( t, -0.95, -0.4, 0, 1 ), 0, 1 )
		const shut = clamp( remap( t, -0.5, -0.02, 0, 1 ), 0, 1 )
		const morph = t < 0 ? shut : 1 + sub
		stack.morph.value = morph
		mirror.morph.value = morph
		stack.reveal.value = reveal
		mirror.reveal.value = reveal
		const leave = clamp( t, 0, 1 )
		stack.opacity.value = 1 - leave // gone when the next page holds (it is hidden there)
		mirror.opacity.value = 0.4 * ( 1 - leave )
		stack.line.position.y = anchor.y + leave * leave * 6
		// the blooming wave: brighter while the front sweeps
		const front = morph - Math.floor( morph )
		const wave = morph > 0.001 && front > 0.001 ? Math.sin( Math.PI * front ) : 0
		stack.intensity.value = 0.85 + 0.45 * wave
		mirror.intensity.value = 0.28 + 0.15 * wave
		plinth.material.dashOffset.value = time * 0.01
		plinth.rotation.y = time * 0.05

		portrait = st.isPortrait()
		squeeze = clamp( camera.aspect / 1.6, 0.75, 1 )
		q.copy( camera.quaternion )
		right.set( 1, 0, 0 ).applyQuaternion( q )
		up.set( 0, 1, 0 ).applyQuaternion( q )
		look0.set( anchor.x, anchor.y - 0.9, anchor.z )
		const dist = toCam.subVectors( camera.position, look0 ).length()
		half.h = dist * Math.tan( ( camera.fov * Math.PI ) / 360 )
		half.w = half.h * camera.aspect
		const here = clamp( 1 - Math.abs( t ) * 1.8, 0, 1 )
		for ( let i = 0; i < tags.length; i++ ) {
			const tg = tags[i]
			const k = clamp( 1 - Math.abs( morph - ( i + 1 ) ) * 2.2, 0, 1 )
			billboard( tg, L_TAG, P_TAG )
			tg.opacity.value = k * here
			tg.reveal.value = k
		}
		const nk = clamp( remap( t, -0.4, 0, 0, 1 ), 0, 1 ) * here
		billboard( mRings, L_RINGS, P_RINGS )
		billboard( mPoints, L_POINTS, P_POINTS )
		billboard( mDraw, L_DRAW, P_DRAW )
		mRings.setPresence( nk * 0.9, nk )
		mPoints.setPresence( nk * 0.9, nk )
		mDraw.setPresence( nk * 0.9, nk )
		billboard( line, L_LINE, P_LINE )
		line.opacity.value = nk * 0.9
		line.reveal.value = nk
	}

	const type = [...tags, mRings, mPoints, mDraw, line]
	st.hasFossil = true
	st.fossil = ( kf ) => {
		const on = st.resident
		mirror.line.visible = on
		plinth.visible = on
		for ( const o of type ) o.visible = on
		if ( !on ) {
			stack.morph.value = 2
			stack.reveal.value = kf
			stack.opacity.value = 0.6 * kf
			stack.intensity.value = 1.2
			stack.line.position.y = anchor.y
		}
	}
	st.debug = { stack, mirror }
}
