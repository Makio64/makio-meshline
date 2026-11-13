/**
 * 01 · Enter the Line — the Ring Tunnel (gpuInstance.js) threaded on the spine:
 * 150 rosette rings × 192 segments, ONE instanced draw. Ring centres/frames come from a
 * spine-frames DataTexture read in gpuPositionNode, so the tunnel bends with the path.
 * Colours: packed addInstanceAttributes( { ringStyle: 4 } ) recoloured with setInstanceValues().
 * A giant "2.0" floats at the far end. Hold = warp.
 */
import { clamp, damp, easeOutCubic } from '@shared/math.js'
import { RELEASE } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import { attribute, cos, float, floor, Fn, fract, instanceIndex, int, ivec2, min, mix, sin, smoothstep, texture, uniform, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, DataTexture, FloatType, NearestFilter, RGBAFormat, Vector3 } from 'three/webgpu'

import { monument, num, text } from '../type.js'

const RINGS = 150
const SEGMENTS = 192
const ROWS = 256
const RADIUS = 2.6
const PALETTES = [
	[0x22d3ee, 0x8b5cf6],
	[0xf472b6, 0x22d3ee],
	[0xa78bfa, 0xf472b6],
	[0xe0f2fe, 0xf0abfc],
]
const PETALS = [3, 4, 5, 6, 8]

export default async function build( st, ctx ) {
	const { spine, renderer } = ctx
	const s0 = st.anchorS - st.half + 3
	const s1 = st.anchorS + st.half
	const len = s1 - s0

	st.preset = { pos: [-40, 0.5, 0], look: [30, 4.2, 0] }
	st.rideIn = 0
	st.rideOut = s1 - 6
	st.headS = s1 + 26
	st.fog = [30, 120]
	st.bloom = 0.62

	//------------------------------------------------------------------ frames texture (pos, N, B per row)
	const data = new Float32Array( 3 * ROWS * 4 )
	const P = new Vector3()
	for ( let r = 0; r < ROWS; r++ ) {
		const s = s0 + ( r / ( ROWS - 1 ) ) * len
		spine.at( s, P )
		const { N, B } = spine.frame( s )
		const o = r * 3 * 4
		data.set( [P.x, P.y, P.z, 1, N.x, N.y, N.z, 0, B.x, B.y, B.z, 0], o )
	}
	const framesTex = new DataTexture( data, 3, ROWS, RGBAFormat, FloatType )
	framesTex.magFilter = framesTex.minFilter = NearestFilter
	framesTex.generateMipmaps = false
	framesTex.needsUpdate = true
	const tex = texture( framesTex )
	const ld = ( col, row ) => tex.load( ivec2( int( col ), row ) ).xyz

	const uTravel = uniform( 0 )
	const uTime = uniform( 0 )
	const uMorph = uniform( 0 )
	const uFade = uniform( 1 )
	const ringStyle = attribute( 'ringStyle', 'vec4' )
	const along = Fn( () => fract( float( instanceIndex ).div( RINGS ).sub( uTravel ) ) )

	const positionNode = Fn( ( [progress] ) => {
		const a = along().toVar()
		const f = a.mul( ROWS - 1 )
		const r0 = int( floor( f ) )
		const r1 = int( min( floor( f ).add( 1 ), ROWS - 1 ) )
		const k = fract( f )
		const c = mix( ld( 0, r0 ), ld( 0, r1 ), k )
		const n = mix( ld( 1, r0 ), ld( 1, r1 ), k ).normalize()
		const b = mix( ld( 2, r0 ), ld( 2, r1 ), k ).normalize()
		const angle = progress.mul( Math.PI * 2 )
		const petal = sin( angle.mul( ringStyle.w ) ).mul( uMorph.mul( 0.22 ) )
		const breathing = sin( a.mul( 40 ).add( uTime.mul( 0.9 ) ) ).mul( 0.07 )
		const radius = float( RADIUS ).mul( petal.add( breathing ).add( 1 ) )
		const tw = angle.add( a.mul( 7 ) ).add( uTime.mul( 0.25 ) )
		return c.add( n.mul( cos( tw ).mul( radius ) ) ).add( b.mul( sin( tw ).mul( radius ) ) )
	} )

	const colorNode = Fn( ( [, progress] ) => {
		const a = along()
		const fadeFar = float( 1 ).sub( smoothstep( 0.72, 1.0, a ) )
		const fadeNear = smoothstep( 0.0, 0.07, a )
		const sparkle = sin( progress.mul( Math.PI * 2 ).mul( ringStyle.w ).sub( uTime.mul( 3 ) ) ).mul( 0.25 ).add( 0.85 )
		return vec4( ringStyle.rgb.mul( fadeFar.mul( fadeNear ).mul( sparkle ).mul( uFade ).mul( 1.25 ) ), 1 )
	} )

	const tunnel = new MeshLine()
		.instances( RINGS )
		.segments( SEGMENTS )
		.closed( true )
		.gpuPositionNode( positionNode )
		.colorFn( colorNode )
		.lineWidth( 0.045 )
		.setFrustumCulled( false )
		.build()
	tunnel.material.blending = AdditiveBlending
	tunnel.material.depthWrite = false
	tunnel.material.transparent = true

	const styles = new Float32Array( RINGS * 4 )
	const generations = new Int32Array( RINGS )
	const col = new Color()
	const colB = new Color()
	let serial = 0
	let time = 0
	let travel = 0
	const generation = ( i ) => Math.floor( i / RINGS - travel )
	const writeStyle = ( i ) => {
		const epoch = Math.floor( time / 6 )
		const [a, b] = PALETTES[epoch % PALETTES.length]
		col.setHex( a ).lerp( colB.setHex( b ), Math.sin( serial * 0.42 ) * 0.5 + 0.5 )
		styles.set( [col.r, col.g, col.b, PETALS[epoch % PETALS.length]], i * 4 )
		serial++
	}
	for ( let i = 0; i < RINGS; i++ ) {
		generations[i] = generation( i )
		writeStyle( i )
	}
	tunnel.addInstanceAttributes( { ringStyle: 4 } )
	tunnel.setInstanceValues( 'ringStyle', styles )
	st.group.add( tunnel )

	//------------------------------------------------------------------ type
	const endPoint = spine.at( s1 + 10 ).addScaledVector( st.N, 15.5 ) // above the ring rosette, not across it
	const hero = await text( renderer, RELEASE.slice( 1, 4 ), { size: 24, glow: 1.35 } ) // "2.0"
	hero.position.copy( endPoint )
	st.orient( hero )
	st.group.add( hero )

	const versions = num( 'versions' )
	const entries = num( 'joins' ) // '1 → 3' also counts package entry points
	const mVersions = await monument( renderer, versions.value, 'tag to release', { size: 0.62, captionSize: 0.13, align: 'left' } )
	const mEntries = await monument( renderer, entries.value, 'package entry points', { size: 0.62, captionSize: 0.13, align: 'right' } )
	const kicker = await text( renderer, 'Scroll to ride the line.', { kind: 'line', size: 0.36 } )
	// desktop: numbers flank the tunnel mouth, the kicker sits under the rings.
	// portrait: stacked under the tunnel.
	st.hud( mVersions, [-6.1, -2.35], [-0.86, -0.36, 0.86], 10 )
	st.hud( mEntries, [6.1, -2.35], [0.86, -0.56, 0.86], 10 )
	st.hud( kicker, [0, -3.45], [0, -0.8, 0.8], 10 )
	st.portrait = { pull: 1.18, shift: [0, 0], look: [30, -7, 0] } // portrait: back out of the mouth, aim low so the rings sit above the numbers
	st.onLayout = ( portrait ) => {
		hero.scale.setScalar( portrait ? 0.72 : 0.86 )
		st.orient( hero )
	}

	//------------------------------------------------------------------ interaction: hold = warp
	let warp = false
	const onDown = () => { warp = true }
	const onUp = () => { warp = false }
	window.addEventListener( 'pointerdown', onDown )
	window.addEventListener( 'pointerup', onUp )
	window.addEventListener( 'pointercancel', onUp )

	let speed = 0.02
	let intro = 0
	st.update = ( { t, dt, rdt } ) => {
		time += dt
		intro = Math.min( 1, intro + rdt / 1.6 )
		speed = damp( speed, warp ? 0.16 : 0.012, warp ? 2.5 : 1.6, dt )
		travel += speed * dt
		uTravel.value = travel % 1
		uTime.value = time
		uMorph.value = Math.sin( time * 0.35 ) * 0.5 + 0.5
		// recolour only the rings that wrapped (contiguous runs)
		let runStart = -1
		for ( let i = 0; i <= RINGS; i++ ) {
			let changed = false
			if ( i < RINGS ) {
				const g = generation( i )
				if ( g !== generations[i] ) {
					generations[i] = g
					writeStyle( i )
					changed = true
				}
			}
			if ( changed && runStart < 0 ) runStart = i
			if ( !changed && runStart >= 0 ) {
				tunnel.setInstanceValues( 'ringStyle', styles.subarray( runStart * 4, i * 4 ), runStart )
				runStart = -1
			}
		}

		const here = clamp( 1 - t * 1.8, 0, 1 )
		const e = easeOutCubic( intro )
		hero.opacity.value = clamp( 1 - t * 2.4, 0, 1 ) // gone before the ride passes under it
		hero.reveal.value = e
		mVersions.setPresence( here * e, e )
		mEntries.setPresence( here * e, e )
		kicker.opacity.value = here * e * 0.85
		kicker.reveal.value = e
		uFade.value = clamp( 1.4 - t, 0, 1 )
	}

	// finale fossil: the hero "2.0" returns, tunnel dimmed
	st.hasFossil = true
	st.fossil = ( k ) => {
		if ( st.resident ) { tunnel.visible = true; mVersions.visible = mEntries.visible = kicker.visible = true; return }
		tunnel.visible = k > 0
		mVersions.visible = mEntries.visible = kicker.visible = false
		uFade.value = 0.35 * k
		hero.opacity.value = 0.3 + 0.7 * k
		hero.reveal.value = 1
	}
}
