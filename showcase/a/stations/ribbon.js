/**
 * 04 · Ride the Ribbon — the spine flattens into a lit world-space surface:
 * surface( { frame: 'transport', bank, uvMode: 'stretch' } ), round joins, a round cap,
 * candy pink → cyan PBR, and two dashed lane MeshLines riding on it.
 * The flight to the statue dollies along this road (journey.js).
 */
import { clamp, remap } from '@shared/math.js'
import { MeshLine } from 'makio-meshline'
import { color, mix, smoothstep, uv } from 'three/tsl'
import { DirectionalLight, HemisphereLight, Vector3 } from 'three/webgpu'

import { monument, num, text } from '../type.js'

const N_PTS = 360
const WIDTH = 3.4

export default async function build( st, ctx ) {
	const { renderer, spine } = ctx
	st.preset = { pos: [-27, 3.3, 1.2], look: [3, 0.4, 0] }
	st.fog = [26, 72]
	st.bloom = 0.42
	st.rideIn = st.anchorS - st.half - 6
	st.rideOut = st.anchorS + st.half - 4
	const s0 = st.anchorS - st.half
	const s1 = st.anchorS + st.half
	st.hide = [( s0 - 2 ) / spine.length, ( s1 + 26 ) / spine.length]

	//------------------------------------------------------------------ centreline: spine + sway + undulation, banked into the turns
	const pts = new Float32Array( N_PTS * 3 )
	const bank = new Float32Array( N_PTS )
	const P = new Vector3()
	for ( let i = 0; i < N_PTS; i++ ) {
		const u = i / ( N_PTS - 1 )
		const x = -st.half + u * st.half * 2
		const sway = Math.sin( u * Math.PI * 2.2 ) * 3.0 * Math.sin( Math.PI * u )
		const lift = Math.sin( u * Math.PI * 1.4 ) * 0.7 - 0.25
		st.local( x, lift, sway, P ).toArray( pts, i * 3 )
		// bank against the lateral curvature (second derivative of sway)
		bank[i] = -Math.cos( u * Math.PI * 2.2 ) * 0.22 * Math.sin( Math.PI * u )
	}

	const road = new MeshLine()
		.lines( pts, false )
		.lineWidth( WIDTH )
		.surface( { frame: 'transport', bank, uvMode: 'stretch', roughness: 0.32, metalness: 0.25 } )
		.join( { type: 'round', limit: 3, segments: 8 } )
		.cap( { type: 'round', segments: 16 } )
		.needsUV( true )
		.build()
	const pink = color( 0xff4fa3 )
	const cyan = color( 0x22d3ee )
	const grad = mix( pink, cyan, smoothstep( 0.02, 0.38, uv().x ) )
	road.material.colorNode = grad
	road.material.emissiveNode = grad.mul( 0.22 )
	st.group.add( road )

	// The lights live at the scene root for the whole session: adding / removing a light (even by
	// hiding its group) changes the scene's light set and rebuilds every visible render object.
	// Only the road is lit, so they can simply stay on.
	const sun = new DirectionalLight( 0xfff4e6, 2.6 )
	sun.name = 'ribbon:sun'
	st.local( -6, 14, 9, sun.position )
	sun.target.position.copy( st.anchor )
	const hemi = new HemisphereLight( 0x9fe8ff, 0x1a0b14, 0.75 )
	hemi.name = 'ribbon:hemi'
	ctx.scene.add( sun, sun.target, hemi )

	//------------------------------------------------------------------ dashed lanes on the surface (billboard MeshLines)
	const laneL = new Float32Array( N_PTS * 3 )
	const laneR = new Float32Array( N_PTS * 3 )
	const T = new Vector3()
	const Nn = new Vector3()
	const Bn = new Vector3()
	const up = new Vector3()
	const lat = new Vector3()
	const prev = new Vector3()
	const next = new Vector3()
	for ( let i = 0; i < N_PTS; i++ ) {
		prev.fromArray( pts, Math.max( 0, i - 1 ) * 3 )
		next.fromArray( pts, Math.min( N_PTS - 1, i + 1 ) * 3 )
		T.subVectors( next, prev ).normalize()
		Nn.set( 0, 1, 0 ).addScaledVector( T, -T.y ).normalize()
		Bn.crossVectors( T, Nn ).normalize()
		const a = bank[i]
		up.copy( Nn ).multiplyScalar( Math.cos( a ) ).addScaledVector( Bn, Math.sin( a ) )
		lat.copy( Bn ).multiplyScalar( Math.cos( a ) ).addScaledVector( Nn, -Math.sin( a ) )
		P.fromArray( pts, i * 3 ).addScaledVector( up, 0.05 )
		P.clone().addScaledVector( lat, 0.82 ).toArray( laneL, i * 3 )
		P.clone().addScaledVector( lat, -0.82 ).toArray( laneR, i * 3 )
	}
	const lanes = new MeshLine()
		.lines( [laneL, laneR], false )
		.lineWidth( 0.07 )
		.color( 0xf8f5ef )
		.dash( { count: 46, ratio: 0.45 } )
		.build()
	st.group.add( lanes )

	//------------------------------------------------------------------ monuments standing on the ribbon
	const caps = await monument( renderer, num( 'caps' ).value, 'cap types', { size: 1.6, captionSize: 0.16 } )
	const plus = await monument( renderer, num( 'roundCap16' ).value, 'verts per round cap', { size: 0.85, captionSize: 0.15 } )
	const verts = await monument( renderer, num( 'roadVerts' ).value, 'verts · benchmark road', { size: 0.85, captionSize: 0.15 } )
	const line = await text( renderer, 'The line becomes a road.', { kind: 'line', size: 0.4 } )
	// desktop: monuments stand over the road; portrait: stacked above the vanishing point
	st.hud( caps, [0, 2.2], [0, 0.56, 0.7], 14 )
	st.hud( plus, [6.1, 0.9], [0, 0.17, 0.78], 14 )
	st.hud( verts, [-6.1, 0.9], [0, 0.36, 0.78], 14 )
	st.hud( line, [0, 3.6], [0, 0.76, 0.78], 11 )
	st.portrait = { pull: 1.15, shift: [0, 0] }

	let time = 0
	st.update = ( { t, dt } ) => {
		time += dt
		const here = clamp( 1 - Math.abs( t ) * 1.6, 0, 1 )
		const k = clamp( remap( t, -0.6, 0, 0, 1 ), 0, 1 )
		caps.setPresence( here, k )
		plus.setPresence( here, k )
		verts.setPresence( here, k )
		line.opacity.value = here * 0.85
		line.reveal.value = k
		lanes.material.dashOffset.value = -time * 0.04
	}

	const type = [caps, plus, verts, line]
	st.hasFossil = true
	st.fossil = () => {
		const on = st.resident
		for ( const o of type ) o.visible = on
		lanes.visible = on
	}
}
