/**
 * 07 · 200K → 1,646 — the spine becomes the 200,000-point oscilloscope trace of gpuPath.js,
 * drawn by MeshLineGPUPath (local dyadic simplification, indirect draw). Arriving scrubs the
 * local tolerance from 0 (raw) to 0.012 with the wireframe on, so the dense raw segments
 * visibly collapse into long retained triangles. 1,646 is the CPU-oracle constant (never a
 * live readback). WebGL2: automatic CPU fallback, full detail.
 */
import { clamp, remap } from '@shared/math.js'
import { MeshLine } from 'makio-meshline'
import MeshLineGPUPath from 'makio-meshline/gpu-path'
import { Fn, uniform, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, Vector3 } from 'three/webgpu'

import { monument, num, text } from '../type.js'

const POINT_COUNT = 200_000
const PATH_LENGTH = 100
const TOLERANCES = [0, 0.0006, 0.0015, 0.003, 0.006, 0.009, 0.012]

// Rest camera (station-local [t, n, b]; t runs along the trace, n up, b = -world z). Landscape: high
// above the south side looking north-down, so the trace crosses the frame broadside and its wobble
// reads in plan; the camera keeps the culling god view's heading and sits between it and the finale
// pull-back (no reversal: the page can be flown through). Portrait: high over the west end (the
// side the portrait culling view looks from), so the trace runs up the narrow frame.
const DESK = { pos: [0, 40, -36], look: [0, 0, 7] } // aim a little north: the trace sits under the type
const PORT = { pos: [56, 60, -24], look: [-14, 0, 0] } // aim down the trace: its far end stops under the type
const PULSE = 96 // points in the signal pulse that rides the trace
const STRIDE = 100 // trace points between two pulse points (the pulse spans ≈ 4.8 % of the trace)

export default async function build( st, ctx ) {
	const { renderer, camera, stage, spine } = ctx
	st.pose = ( p, pos, look ) => {
		const v = st.isPortrait() ? PORT : DESK
		st.local( ...v.pos, pos )
		st.local( ...v.look, look )
	}
	st.fog = [44, 150]
	st.bloom = 0.62
	st.rideIn = st.anchorS - st.half - 4
	st.rideOut = st.anchorS - st.half + 30
	st.headS = st.anchorS + st.half + 30
	st.hide = [( st.anchorS - st.half - 1 ) / spine.length, ( st.anchorS + st.half + 34 ) / spine.length]

	//------------------------------------------------------------------ the 200K trace (gpuPath.js createLargeOpenPath), in world space along the spine
	const pts = new Float32Array( POINT_COUNT * 3 )
	const P = new Vector3()
	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const progress = i / ( POINT_COUNT - 1 )
		const centered = progress * 2 - 1
		const env = Math.exp( -centered * centered * 18 )
		const x = centered * PATH_LENGTH * 0.5
		const y = Math.sin( progress * Math.PI * 4 ) * 0.7
		const z = Math.sin( progress * Math.PI * 24 ) * 2 + Math.sin( progress * Math.PI * 180 ) * env * 4
		st.local( x, y, z, P ).toArray( pts, i * 3 )
	}
	const path = new MeshLineGPUPath( {
		lines: pts,
		lineWidth: 0.24,
		color: new Color( 0x22d3ee ).multiplyScalar( 1.5 ),
		join: { type: 'miter', limit: 3, segments: 8 },
		cap: { type: 'butt', segments: 8 },
	}, {
		chunkSegments: 128,
		simplify: { localTolerance: TOLERANCES[0] },
	} )
	st.group.add( path )
	path.resize( stage.size.width, stage.size.height )
	stage.onResize( ( w, h ) => path.resize( w, h ) )
	let gpu = false
	try {
		gpu = await path.prepare( renderer, camera )
	} catch ( e ) {
		console.warn( '[A] gpu path prepare failed, CPU fallback', e )
	}

	//------------------------------------------------------------------ blueprint grid + scanner
	const grid = []
	for ( let x = -60; x <= 60; x += 5 ) grid.push( new Float32Array( [...st.local( x, -3, -18 ).toArray(), ...st.local( x, -3, 18 ).toArray()] ) )
	for ( let z = -18; z <= 18; z += 4.5 ) grid.push( new Float32Array( [...st.local( -60, -3, z ).toArray(), ...st.local( 60, -3, z ).toArray()] ) )
	const gridLine = new MeshLine().lines( grid, false ).lineWidth( 0.05 ).color( 0x1e3a5f ).build()
	st.group.add( gridLine )
	const scanPts = new Float32Array( [...st.local( -PATH_LENGTH / 2, -3, 0 ).toArray(), ...st.local( -PATH_LENGTH / 2, 5, 0 ).toArray()] ) // distinct points: a zero list builds an empty geometry
	const scanner = new MeshLine().lines( scanPts, false ).dynamic( true ).lineWidth( 0.06 ).color( new Color( 0xa5f3fc ).multiplyScalar( 2.2 ) ).build()
	scanner.frustumCulled = false // sweeps the whole trace: its build-time bounds would cull it
	st.group.add( scanner )

	//------------------------------------------------------------------ signal pulse: a short bright comet riding the raw trace (ambient life while held)
	const pulsePts = new Float32Array( PULSE * 3 )
	const SPAN = ( PULSE - 1 ) * STRIDE
	const writePulse = ( u ) => {
		const head = SPAN + Math.floor( u * ( POINT_COUNT - 1 - SPAN ) )
		for ( let j = 0; j < PULSE; j++ ) {
			const o = ( head - ( PULSE - 1 - j ) * STRIDE ) * 3 // tail first: progress 1 = head
			pulsePts[j * 3] = pts[o]
			pulsePts[j * 3 + 1] = pts[o + 1] + 0.04
			pulsePts[j * 3 + 2] = pts[o + 2]
		}
	}
	writePulse( 0 ) // real points before building (an all-zero list builds an empty geometry)
	const uPulse = uniform( 0 )
	const pulse = new MeshLine()
		.lines( pulsePts, false )
		.dynamic( true )
		.lineWidth( 0.62 )
		.widthCallback( ( t ) => Math.pow( t, 1.2 ) )
		.colorFn( Fn( ( [c, progress] ) => vec4( c.rgb.mul( progress.mul( progress ) ).mul( uPulse ), 1 ) ) )
		.color( new Color( 0xe6fdff ).multiplyScalar( 4 ) )
		.transparent( true )
		.build()
	pulse.material.blending = AdditiveBlending
	pulse.material.depthWrite = false
	pulse.material.depthTest = false // rides on top of the trace's own billboards
	pulse.renderOrder = 3
	pulse.frustumCulled = false // it moves along the whole trace: its build-time bounds would cull it
	st.group.add( pulse )

	//------------------------------------------------------------------ type
	const g = num( 'gpuPath1646' )
	const [from, to] = g.value.split( ' → ' )
	const D = 20
	const mFrom = st.hud( await text( renderer, `${from} →`, { size: 1.35, align: 'left', opacity: 0.6 } ), [-10.6, 6.4], [-0.86, 0.72, 0.62], D )
	const mTo = st.hud( await text( renderer, to, { size: 4.2, align: 'left', glow: 1.3 } ), [-10.6, 3.6], [-0.86, 0.55, 0.6], D )
	const cap = st.hud( await text( renderer, 'points → segments · CPU-oracle count', { kind: 'caps', size: 0.21, align: 'left', valign: 'top' } ), [-10.6, 1.1], [-0.86, 0.4, 0.86], D )
	const cut = st.hud( await monument( renderer, num( 'segmentsCut' ).value, 'segments drawn', { size: 1.3, captionSize: 0.23, align: 'right' } ), [10.8, 6.7], [0.88, -0.36, 0.74], D )
	const mem = st.hud( await monument( renderer, num( 'gpuPathMemory' ).value, 'memory · vs CPU path', { size: 1.3, captionSize: 0.23, align: 'right' } ), [10.8, 3.9], [0.88, -0.56, 0.74], D )
	const line = st.hud( await text( renderer, 'Fewer segments. Same curve.', { kind: 'line', size: 0.42 } ), [0, -6.6], [0, -0.82, 0.82], D )
	const fallbackCap = gpu ? null : st.hud( await text( renderer, 'WebGL2 · CPU fallback · full detail', { kind: 'caps', size: 0.18, align: 'left', valign: 'top' } ), [-10.6, 0.3], [-0.86, 0.32, 0.86], D )
	st.portrait = { pull: 1, shift: [0, 0] } // portrait has its own pose (PORT)

	let level = 0
	let busy = false
	let wire = false
	const setLevel = async ( l ) => {
		if ( busy || l === level || !gpu ) return
		busy = true
		level = l
		try {
			await path.setSimplificationTolerance( TOLERANCES[l] )
		} finally {
			busy = false
		}
	}
	const a = new Vector3()
	const b = new Vector3()
	let lastK = -1
	let time = 0
	st.update = ( { t, dt } ) => {
		time += dt
		const k = clamp( remap( t, -0.7, -0.05, 0, 1 ), 0, 1 )
		const here = clamp( 1 - Math.abs( t ) * 1.6, 0, 1 )
		// the pulse runs the trace once every ~9 s, once the collapse has landed
		uPulse.value = here * k
		pulse.visible = uPulse.value > 0.001
		if ( pulse.visible ) {
			writePulse( ( time / 9 ) % 1 )
			pulse.setPositions( pulsePts )
		}
		setLevel( Math.round( k * ( TOLERANCES.length - 1 ) ) )
		const wantWire = t > -0.75 && t < 0.5
		if ( wantWire !== wire ) {
			wire = wantWire
			path.wireframe( wire )
		}
		// scanner sweeps the same x as the collapse (2 points, rewritten only when k moves)
		if ( k !== lastK ) {
			lastK = k
			const x = -PATH_LENGTH / 2 + k * PATH_LENGTH
			st.local( x, -3, 0, a )
			st.local( x, 5, 0, b )
			a.toArray( scanPts, 0 )
			b.toArray( scanPts, 3 )
			scanner.setPositions( scanPts )
		}
		scanner.visible = k > 0.001 && k < 0.999
		mFrom.opacity.value = here * 0.55
		mFrom.reveal.value = k
		mTo.opacity.value = here
		mTo.reveal.value = clamp( k * 1.15 - 0.15, 0, 1 )
		cap.opacity.value = here * 0.85
		cap.reveal.value = k
		cut.setPresence( here, k )
		mem.setPresence( here, k )
		line.opacity.value = here * 0.9
		line.reveal.value = k
		if ( fallbackCap ) fallbackCap.opacity.value = here * 0.8
	}

	const type = [mFrom, mTo, cap, cut, mem, line, gridLine, fallbackCap].filter( Boolean )
	st.hasFossil = true
	st.fossil = () => {
		const on = st.resident
		for ( const o of type ) o.visible = on
		if ( !on ) scanner.visible = pulse.visible = false // update() owns them while resident
		if ( !on && wire ) {
			wire = false
			path.wireframe( false )
		}
	}
	// The CPU fallback (a full 200K-point MeshLine) is never drawn while the GPU path is active:
	// keep it out of the scene graph so the loader's warm-up does not compile / upload it.
	if ( gpu ) path.remove( path.fallback )
	/**
	 * Loader: the wireframe toggle changes the primitive topology (its own pipeline), so warm that
	 * variant too (the loader's final warm-up compiles the solid one).
	 */
	st.warm = async ( warm ) => {
		if ( !gpu ) return
		path.wireframe( true )
		try {
			await warm( [st.group] )
		} finally {
			path.wireframe( false )
		}
	}
	st.debug = { path, get gpu() { return gpu }, get level() { return level } }
}
