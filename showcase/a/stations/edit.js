/**
 * 02 · Edit in Place — the thread winds into a 200,000-point coil: ONE dynamic billboard
 * MeshLine. Every frame a 128-point bracket ripples through setPositionRange( slice, start );
 * the byte readout is measured live from the geometry's updateRanges (not a constant).
 * The pointer brushes the coil to move the bracket. Bars: v1.2.3 full upload vs v2 range.
 */
import { clamp, easeOutCubic, remap } from '@shared/math.js'
import { MeshLine } from 'makio-meshline'
import { AdditiveBlending, Color, Group, Vector3 } from 'three/webgpu'

import { BASELINE, counter, monument, num, text } from '../type.js'

const POINTS = 200_000
const BRACKET = 128
const TURNS = 150
const RADIUS = 2.3

export default async function build( st, ctx ) {
	const { renderer, stage, camera } = ctx
	st.preset = { pos: [0, 3.2, 23], look: [0, 0.6, 0] }
	st.fog = [26, 70]
	st.bloom = 0.5
	st.rideIn = st.anchorS - st.half - 4
	st.rideOut = st.anchorS + st.half + 2

	const { anchor, T, N, B } = st
	const half = st.half

	//------------------------------------------------------------------ the coil (200K points)
	const base = new Float32Array( POINTS * 3 )
	const colors = new Float32Array( POINTS * 3 )
	const c0 = new Color( 0x2b2a2f )
	const c1 = new Color( 0xb9b2a5 )
	const c = new Color()
	const angleOf = ( i ) => ( i / ( POINTS - 1 ) ) * TURNS * Math.PI * 2
	const radiusOf = ( u ) => RADIUS * ( 0.82 + 0.18 * Math.sin( Math.PI * u ) )
	for ( let i = 0; i < POINTS; i++ ) {
		const u = i / ( POINTS - 1 )
		const x = -half + u * half * 2
		const a = angleOf( i )
		const r = radiusOf( u )
		const ca = Math.cos( a ) * r
		const sa = Math.sin( a ) * r
		const o = i * 3
		base[o] = anchor.x + T.x * x + N.x * ca + B.x * sa
		base[o + 1] = anchor.y + T.y * x + N.y * ca + B.y * sa
		base[o + 2] = anchor.z + T.z * x + N.z * ca + B.z * sa
		// lit from the camera side: points facing B are brighter
		const lit = 0.35 + 0.65 * ( 0.5 + 0.5 * Math.sin( a ) )
		c.copy( c0 ).lerp( c1, lit * ( 0.55 + 0.45 * Math.sin( Math.PI * u ) ) )
		colors[o] = c.r
		colors[o + 1] = c.g
		colors[o + 2] = c.b
	}
	const live = base.slice()
	const coil = new MeshLine()
		.lines( live, false )
		.dynamic( true )
		.vertexColors( colors )
		.lineWidth( 0.028 )
		.build()
	st.group.add( coil )

	//------------------------------------------------------------------ the bracket (glowing cyan copy of the edited range)
	const slice = new Float32Array( BRACKET * 3 )
	const glowPts = new Float32Array( BRACKET * 3 )
	let start = Math.floor( POINTS * 0.62 )
	let pendingRestore = -1
	const geo = coil.geometry
	const measure = () => {
		let bytes = 0
		const attrs = geo.attributes
		for ( const name in attrs ) {
			const attr = attrs[name]
			const ranges = attr.updateRanges
			if ( !ranges?.length ) continue
			for ( let i = 0; i < ranges.length; i++ ) bytes += ranges[i].count * attr.array.BYTES_PER_ELEMENT
		}
		return bytes
	}
	const rippleFrame = ( time ) => {
		for ( let j = 0; j < BRACKET; j++ ) {
			const i = start + j
			const u = i / ( POINTS - 1 )
			const a = angleOf( i )
			const env = Math.sin( ( Math.PI * j ) / ( BRACKET - 1 ) )
			const amp = env * ( 0.55 + 0.35 * Math.sin( time * 5.5 + j * 0.21 ) )
			const ca = Math.cos( a )
			const sa = Math.sin( a )
			const o = i * 3
			const jo = j * 3
			for ( let k = 0; k < 3; k++ ) {
				const radial = ( k === 0 ? N.x * ca + B.x * sa : k === 1 ? N.y * ca + B.y * sa : N.z * ca + B.z * sa )
				slice[jo + k] = base[o + k] + radial * amp * radiusOf( u ) * 0.85
				glowPts[jo + k] = slice[jo + k] + radial * 0.01
			}
		}
	}

	// seed the bracket with a real ripple: an all-zero point list builds an empty geometry
	rippleFrame( 0 )
	const bracket = new MeshLine()
		.lines( glowPts, false )
		.dynamic( true )
		.lineWidth( 0.13 )
		.color( new Color( 0x22d3ee ).multiplyScalar( 1.5 ) )
		.widthCallback( ( t ) => Math.sin( Math.PI * t ) * 0.85 + 0.15 )
		.build()
	bracket.frustumCulled = false // the brush moves it along the coil: its build-time bounds would cull it
	st.group.add( bracket )

	//------------------------------------------------------------------ bars: v1.2.3 full upload vs v2 range upload (linear)
	// Bars + their labels live in one flat group laid out like type (hud), in group-local units.
	const bytes = num( 'bytes144' )
	const [v1Bytes, v2Bytes] = bytes.value.split( ' → ' ) // '14.4 MB', '18.6 KB'
	const ratio = ( bytes.nums[1] * 1e3 ) / ( bytes.nums[0] * 1e6 )
	const BAR = 16
	const ROW2 = -1.3
	const barPts = new Float32Array( [-BAR / 2, 0, 0, BAR / 2, 0, 0] )
	const v1Bar = new MeshLine().lines( barPts, false ).lineWidth( 0.42 ).color( 0x3c3b40 ).dynamic( true ).build()
	const pulses = new MeshLine().lines( barPts, false ).lineWidth( 0.42 ).color( new Color( 0xb9b2a5 ).multiplyScalar( 0.7 ) ).dash( { count: 18, ratio: 0.08 } ).dynamic( true ).transparent( true ).build()
	pulses.material.blending = AdditiveBlending
	pulses.material.depthWrite = false
	const v2Dot = new MeshLine().lines( new Float32Array( [-BAR / 2, ROW2, 0, -BAR / 2 + Math.max( 0.02, BAR * ratio ), ROW2, 0] ), false ).lineWidth( 0.42 ).color( new Color( 0x22d3ee ).multiplyScalar( 2.4 ) ).build()
	const bars = new Group()
	bars.add( v1Bar, pulses, v2Dot )

	//------------------------------------------------------------------ type
	const upload = num( 'upload773' )
	const big = await counter( renderer, '000×', { size: 3.6, glow: 1.25 } )
	const bigCap = await text( renderer, `less GPU upload · vs ${BASELINE}`, { kind: 'caps', size: 0.21, valign: 'top' } )
	const cpu = await monument( renderer, num( 'cpu350' ).value, 'faster CPU', { size: 1.7, captionSize: 0.21 } )
	const v1Label = await text( renderer, BASELINE, { kind: 'caps', size: 0.22, align: 'right' } )
	const v2Label = await text( renderer, 'v2', { kind: 'caps', size: 0.22, align: 'right', css: { color: '#7fe7f7' } } )
	const v1Value = await text( renderer, v1Bytes, { size: 0.5, align: 'left' } )
	const v2Value = await text( renderer, v2Bytes, { size: 0.5, align: 'left', css: { color: '#a5f3fc' } } )
	const liveCount = await counter( renderer, '00,000 B', { size: 0.5, align: 'left', css: { fontFamily: 'JetBrains Mono', fontWeight: 400, letterSpacing: '0' } } )
	const liveCap = await text( renderer, 'live bytes', { kind: 'caps', size: 0.2, align: 'left', valign: 'top' } )
	const line = await text( renderer, 'Touch 128 points. Upload only those.', { kind: 'line', size: 0.46 } )
	bars.add( v1Label, v2Label, v1Value, v2Value, liveCount, liveCap )

	// in-group arrangement: desktop = labels left / values right of each bar; portrait = stacked above
	const arrangeBars = ( portrait ) => {
		const ts = portrait ? 1.7 : 1 // portrait type inside the (scaled-down) group
		for ( const o of [v1Label, v2Label, v1Value, v2Value, liveCount, liveCap] ) o.scale.setScalar( ts )
		if ( !portrait ) {
			v1Label.position.set( -BAR / 2 - 0.5, 0, 0 )
			v2Label.position.set( -BAR / 2 - 0.5, ROW2, 0 )
			v1Value.position.set( BAR / 2 + 0.5, 0, 0 )
			v2Value.position.set( -BAR / 2 + 0.6, ROW2, 0 )
			liveCount.position.set( 2.2, ROW2, 0 )
			liveCap.position.set( 2.2, ROW2 - 0.45, 0 )
			return
		}
		const above = 1.25
		v1Label.position.set( -BAR / 2 + v1Label.width * ts, above, 0 )
		v1Value.position.set( BAR / 2 - v1Value.width * ts, above, 0 )
		v2Label.position.set( -BAR / 2 + v2Label.width * ts, ROW2 * 2.4 + above, 0 )
		v2Value.position.set( -BAR / 2 + v2Label.width * ts + 0.6, ROW2 * 2.4 + above, 0 )
		liveCount.position.set( BAR / 2 - liveCount.templateWidth * ts, ROW2 * 2.4 + above, 0 )
		liveCap.position.set( BAR / 2 - Math.max( liveCount.templateWidth, liveCap.width ) * ts, ROW2 * 2.4 + above - 0.55 * ts, 0 )
		v2Dot.position.y = ROW2 * 1.4
	}

	// desktop design (view-plane units at depth 21) / portrait (normalized viewport)
	const D = 21
	st.hud( big, [-5.2, 5.6], [0, 0.68, 0.6], D )
	st.hud( bigCap, [-5.2, 3.2], [0, 0.52, 0.95], D )
	st.hud( cpu, [7.4, 5.8], [0, 0.34, 0.62], D )
	st.hud( bars, [0, -5.4], [0, -0.38, 0.52], D )
	st.hud( line, [0, -8.0], [0, -0.8, 0.84], D )
	st.portrait = { pull: 2.2, shift: [0, 0] }
	st.onLayout = ( portrait ) => {
		arrangeBars( portrait )
		if ( !portrait ) v2Dot.position.y = 0
	}

	//------------------------------------------------------------------ pointer brush: move the bracket to the nearest arc length
	const a2 = new Vector3()
	const b2 = new Vector3()
	const axisA = st.local( -half, 0, 0 )
	const axisB = st.local( half, 0, 0 )
	const brush = () => {
		a2.copy( axisA ).project( camera )
		b2.copy( axisB ).project( camera )
		const px = stage.pointer.x
		const py = stage.pointer.y
		const dx = b2.x - a2.x
		const dy = b2.y - a2.y
		const u = clamp( ( ( px - a2.x ) * dx + ( py - a2.y ) * dy ) / ( dx * dx + dy * dy ), 0, 1 )
		const qy = a2.y + dy * u
		if ( Math.abs( py - qy ) > 0.16 ) return
		const next = Math.round( clamp( u * ( POINTS - 1 ) - BRACKET / 2, 0, POINTS - BRACKET - 1 ) )
		if ( Math.abs( next - start ) > 400 && pendingRestore < 0 ) {
			pendingRestore = start
			start = next
		}
	}
	let lastPX = 0
	let lastPY = 0

	const barType = [v1Label, v2Label, v1Value, v2Value, liveCap]
	const SCRAMBLE = { scramble: 0.3 }
	const CLEAN = { scramble: 0 }
	let time = 0
	let shownBytes = 0
	let lastGrow = -1
	st.update = ( { t, dt } ) => {
		time += dt
		const here = clamp( 1 - Math.abs( t ) * 1.6, 0, 1 )
		if ( here > 0.6 && ( stage.pointer.x !== lastPX || stage.pointer.y !== lastPY ) ) {
			lastPX = stage.pointer.x
			lastPY = stage.pointer.y
			brush()
		}
		// restore the previous bracket (its own upload), then the per-frame 128-point edit
		let restored = false
		if ( pendingRestore >= 0 ) {
			coil.setPositionRange( base.subarray( pendingRestore * 3, ( pendingRestore + BRACKET ) * 3 ), pendingRestore )
			pendingRestore = -1
			restored = true
		}
		const before = measure()
		rippleFrame( time )
		coil.setPositionRange( slice, start )
		bracket.setPositions( glowPts )
		const edit = measure() - before
		if ( !restored && edit > 0 ) shownBytes = edit
		liveCount.setValue( shownBytes )

		// counts are scroll-driven: rewind when scrolling back
		const k = easeOutCubic( clamp( remap( t, -0.65, 0, 0, 1 ), 0, 1 ) )
		const count = Math.max( 1, Math.round( upload.nums[0] * k ) )
		big.setValue( count, k < 0.98 ? SCRAMBLE : CLEAN )
		big.opacity.value = here
		bigCap.opacity.value = here * 0.9
		bigCap.reveal.value = k
		cpu.setPresence( here, k )
		for ( const o of barType ) {
			o.opacity.value = here
			o.reveal.value = k
		}
		liveCount.opacity.value = here
		line.opacity.value = here * 0.9
		line.reveal.value = clamp( remap( t, -0.4, 0, 0, 1 ), 0, 1 )
		// bars grow in (2 points, rewritten only when the length changes), dashed pulses flow along the v1.2.3 bar
		const grow = Math.max( 0.001, k )
		if ( grow !== lastGrow ) {
			lastGrow = grow
			barPts[3] = -BAR / 2 + BAR * grow
			v1Bar.setPositions( barPts )
			pulses.setPositions( barPts )
		}
		pulses.material.dashOffset.value = -time * 0.35
	}
}
