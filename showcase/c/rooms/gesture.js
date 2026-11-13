/**
 * III · The Gesture — Venus redrawn as ONE ivory hairline of 200,000 points (a helix sweeping up
 * her contour grid). A gold chisel follows the cursor, or a phantom hand at the hip after 2 s:
 * every touch is a real setPositionRange() of 128 points, and the live counter sums the
 * attribute updateRanges this frame.
 */
import { easeOutCubic } from '@shared/math.js'
import { BASELINE, num } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import { Fn, uniform } from 'three/tsl'
import { Group, Vector3 } from 'three/webgpu'

import { besideRest, C, capsText, clamp01, FLOOR_Y, goldCount, goldRule, goldText, lineText, liveCounter, pinToCamera, PLAIN, plinthLine, restCamWorld, roomRings, setLineOpacity, setLineWidth, spotCone } from '../kit.js'

const upload = num( 'upload773' )
const bytes = num( 'bytes144' )
const cpu = num( 'cpu350' )

const N = 200_000
const TURNS = 150
const SPAN = 128

export default {
	slug: 'gesture',
	title: 'The Gesture',
	numeral: 'III',
	rest: { radius: 22.5, theta: -0.5, ptheta: -0.5, phi: 0.05, tx: 4.4, ty: 0.2, ptx: 0, pty: -2.4 },
	footnote: `200K-point line, 128-point edit · vs ${BASELINE} setPositions()`,

	async create( ctx, root, room ) {
		const { renderer, camera, stage } = ctx
		const venus = await roomRings( 'venus' )
		const { rings, samples, positions } = venus

		//---------------------------------------------------------- one 200K-point helix over the contour grid
		const base = new Float32Array( N * 3 )
		for ( let k = 0; k < N; k++ ) {
			const t = k / ( N - 1 )
			const rf = t * ( rings - 1 )
			const r0 = Math.min( rings - 2, Math.floor( rf ) )
			const fr = rf - r0
			const s = ( t * TURNS * samples ) % samples
			const s0 = Math.floor( s )
			const s1 = ( s0 + 1 ) % samples
			const fs = s - s0
			for ( let c = 0; c < 3; c++ ) {
				const a = positions[( r0 * samples + s0 ) * 3 + c] * ( 1 - fs ) + positions[( r0 * samples + s1 ) * 3 + c] * fs
				const b = positions[( ( r0 + 1 ) * samples + s0 ) * 3 + c] * ( 1 - fs ) + positions[( ( r0 + 1 ) * samples + s1 ) * 3 + c] * fs
				base[k * 3 + c] = a * ( 1 - fr ) + b * fr
			}
		}

		// No TSL hooks on the 200K line: any hook adds a per-vertex progress attribute that a range
		// edit would have to re-upload whole. Edits then touch position + previous + next only.
		const LINE_W = 0.016
		const line = new MeshLine()
			.lines( base.slice(), false )
			.dynamic( true )
			.lineWidth( LINE_W )
			.color( 0xe2d8c6 )
			.transparent( true )
			.antialias( true )
			.autoResize()
		// gold glow over the edited span: its own 128-point line (not counted in the live bytes);
		// faded through a uniform (MeshLine.opacity() on a line without an opacity uniform rebuilds it)
		const uGlow = uniform( 0 )
		const glow = new MeshLine()
			.lines( base.slice( 0, SPAN * 3 ), false )
			.dynamic( true )
			.lineWidth( 0.07 )
			.color( C.goldHot )
			.transparent( true )
			.colorFn( Fn( ( [col] ) => col.mul( 2.6 ) ) )
			.opacityFn( Fn( ( [a, progress] ) => a.mul( progress.mul( Math.PI ).sin().pow( 1.5 ) ).mul( uGlow ) ) )
			.autoResize()
		glow.frustumCulled = false
		root.add( glow )
		line.frustumCulled = false
		root.add( line )

		const plinth = plinthLine( { w: 5.4, h: 1.2, opacity: 0.45 } )
		const cone = spotCone( new Vector3( -2.4, 17.5, 3 ), new Vector3( 0, FLOOR_Y, 0 ), 4.2, { intensity: 0.4 } )
		root.add( plinth, cone )

		// the chisel: a small gold blade outline
		const chisel = new MeshLine()
			.lines( new Float32Array( [0, 0, 0, -0.13, 0.55, 0, -0.13, 1.45, 0, 0.13, 1.45, 0, 0.13, 0.55, 0] ), true )
			.lineWidth( 0.035 )
			.color( C.gold )
			.autoResize()
		const chiselGroup = new Group()
		chisel.rotation.z = -0.5
		chiselGroup.add( chisel )
		root.add( chiselGroup )

		//---------------------------------------------------------- plaque
		const plaque = new Group()
		const headline = await lineText( renderer, 'Touch one stroke. Upload only that.', 0.6, { align: 'left' } )
		headline.position.set( 0, 3.9, 0 )
		const big = await goldCount( renderer, '000×', upload.value, 2.6, { align: 'left', glow: 1.6 } )
		big.position.set( -0.1, 1.85, 0 )
		const bigLabel = await capsText( renderer, 'less upload per edit', 0.19, { align: 'left' } )
		bigLabel.position.set( 0, 0.25, 0 )
		const bytesN = await goldText( renderer, bytes.value, 0.56, { align: 'left' } )
		bytesN.position.set( 0, -0.6, 0 )
		const bytesL = await capsText( renderer, 'bytes per edit', 0.17, { align: 'left' } )
		bytesL.position.set( 0, -1.18, 0 )
		// log bars (KB decade origin): v1.2.3 dim, v2 gold
		const decade = 1.25
		const v1Len = ( Math.log10( bytes.nums[0] * 1e6 ) - 3 ) * decade
		const v2Len = ( Math.log10( bytes.nums[1] * 1e3 ) - 3 ) * decade
		const barV1 = goldRule( v1Len, { lineWidth: 0.16, color: C.stone, intensity: 0.8 } )
		barV1.position.set( 1.5, -1.85, 0 )
		const barV2 = goldRule( v2Len, { lineWidth: 0.16, color: C.gold, intensity: 1.6 } )
		barV2.position.set( 1.5, -2.3, 0 )
		const barL1 = await capsText( renderer, BASELINE, 0.15, { align: 'left' } )
		barL1.position.set( 0, -1.85, 0 )
		const barL2 = await capsText( renderer, 'v2', 0.15, { align: 'left' } )
		barL2.position.set( 0, -2.3, 0 )
		const cpuN = await goldText( renderer, cpu.value, 0.56, { align: 'left' } )
		cpuN.position.set( 0, -3.15, 0 )
		const cpuL = await capsText( renderer, 'faster CPU per edit', 0.17, { align: 'left' } )
		cpuL.position.set( 0, -3.73, 0 )
		const live = await liveCounter( renderer, '000,000 B', 0.42, { align: 'left' } )
		live.position.set( 0, -4.55, 0 )
		const liveL = await capsText( renderer, 'live · uploaded this frame', 0.15, { align: 'left' } )
		liveL.position.set( 0, -5.1, 0 )
		plaque.add( headline, big, bigLabel, bytesN, bytesL, barV1, barV2, barL1, barL2, cpuN, cpuL, live, liveL )
		root.add( plaque )
		const labels = [bigLabel, bytesL, barL1, barL2, cpuL, liveL]
		let wasPortrait = false
		const values = [headline, bytesN, cpuN]

		//---------------------------------------------------------- chisel state
		const slice = new Float32Array( SPAN * 3 )
		let cur = -1
		let liveBytes = 0
		let glowAmt = 0
		let lastAttrs = 0
		let shownBytes = 0
		const cand = []
		for ( let k = 0; k < N; k += 40 ) cand.push( k )
		const v = new Vector3()
		const axis = new Vector3()
		const editPos = new Vector3()
		const camTarget = new Vector3()
		let attrs = null // the 200K line's attributes, listed once (built on first use)
		const allAttrs = () => {
			if ( !attrs || attrs.geometry !== line.geometry ) {
				attrs = Object.values( line.geometry.attributes )
				attrs.geometry = line.geometry
			}
			return attrs
		}

		const writeSpan = ( start, amp ) => {
			for ( let j = 0; j < SPAN; j++ ) {
				const k = start + j
				const w = Math.pow( Math.sin( ( Math.PI * ( j + 0.5 ) ) / SPAN ), 2 ) * amp
				const x = base[k * 3]
				const z = base[k * 3 + 2]
				const l = Math.hypot( x, z ) || 1
				slice[j * 3] = x + ( x / l ) * w
				slice[j * 3 + 1] = base[k * 3 + 1]
				slice[j * 3 + 2] = z + ( z / l ) * w
			}
			line.setPositionRange( slice, start )
			glow.setPositions( slice )
		}
		const helixIndex = ( ringF, angle ) => {
			const turn = Math.floor( ( ringF / ( rings - 1 ) ) * TURNS )
			let frac = angle / ( Math.PI * 2 )
			frac -= Math.floor( frac )
			return Math.max( 0, Math.min( N - 1, Math.round( ( ( turn + frac ) / TURNS ) * ( N - 1 ) ) ) )
		}
		const pick = () => {
			// nearest front-facing candidate to the pointer, in px
			let best = -1
			let bestD = 70 * 70
			const px = ctx.pointer.clientX
			const py = ctx.pointer.clientY
			const W = stage.size.width
			const H = stage.size.height
			for ( const k of cand ) {
				v.set( base[k * 3], base[k * 3 + 1], base[k * 3 + 2] ).add( root.position )
				axis.set( root.position.x, v.y, root.position.z )
				if ( v.distanceToSquared( camera.position ) > axis.distanceToSquared( camera.position ) ) continue
				v.project( camera )
				const dx = ( v.x * 0.5 + 0.5 ) * W - px
				const dy = ( 0.5 - v.y * 0.5 ) * H - py
				const d = dx * dx + dy * dy
				if ( d < bestD ) { bestD = d; best = k }
			}
			return best
		}

		return {
			update( f ) {
				const portrait = ctx.portrait()
				if ( portrait !== wasPortrait ) {
					// phone: no log bars, '350×+' beside the bytes, so the plaque fits under the horizon
					wasPortrait = portrait
					for ( const o of [barV1, barV2, barL1, barL2] ) o.visible = !portrait
					cpuN.position.set( portrait ? 5.6 : 0, portrait ? -0.6 : -3.15, 0 )
					cpuL.position.set( portrait ? 5.6 : 0, portrait ? -1.18 : -3.73, 0 )
					live.position.y = portrait ? -2.05 : -4.55
					liveL.position.y = portrait ? -2.6 : -5.1
				}
				if ( portrait ) pinToCamera( plaque, camera, root, { y: -0.5, width: 10.5, local: f.local } )
				else {
					besideRest( room.def.rest, 6.0, 0.6, plaque.position )
					plaque.scale.setScalar( 1 )
					plaque.lookAt( restCamWorld( room.def.rest, root, camTarget ) )
				}

				// fade in on arrival, reel the stroke thin when leaving
				setLineOpacity( line, Math.pow( clamp01( ( f.local + 1 ) / 0.8 ), 2 ) )
				setLineWidth( line, LINE_W * ( 1 - clamp01( f.local / 0.85 ) ) + 1e-4 )

				const engaged = Math.abs( f.local ) < 0.4
				let idx = -1
				const pointerFresh = ctx.pointerActive && performance.now() - ctx.lastPointerMove < 2000
				if ( engaged && pointerFresh ) idx = pick()
				if ( engaged && idx < 0 && !pointerFresh ) {
					// phantom hand: sweeps the hip, facing the camera
					const th = room.def.rest.theta
					const front = Math.atan2( Math.cos( th ), Math.sin( th ) )
					const ringF = 25 + Math.sin( f.t * 0.37 ) * 3.5
					idx = helixIndex( ringF, front + Math.sin( f.t * 0.6 ) * 0.75 )
				}

				liveBytes = 0
				for ( const a of allAttrs() ) a.updateRanges.length = 0 // count only this frame's edits
				if ( idx >= 0 ) {
					const start = Math.max( 0, Math.min( N - SPAN, idx - SPAN / 2 ) )
					if ( cur >= 0 && Math.abs( start - cur ) > 24 ) writeSpan( cur, 0 )
					if ( cur < 0 || Math.abs( start - cur ) > 24 ) cur = start
					const amp = 0.34 + 0.1 * Math.sin( f.t * 7 )
					writeSpan( cur, amp )
					const mid = cur + SPAN / 2
					editPos.set( base[mid * 3], base[mid * 3 + 1], base[mid * 3 + 2] )
					glowAmt = Math.min( 1, glowAmt + f.dt * 4 )
				} else {
					if ( cur >= 0 ) { writeSpan( cur, 0 ); cur = -1 }
					glowAmt = Math.max( 0, glowAmt - f.dt * 2 )
				}
				for ( const a of allAttrs() ) {
					for ( const r of a.updateRanges ) liveBytes += r.count * a.array.BYTES_PER_ELEMENT
				}
				lastAttrs = 0
				for ( const a of allAttrs() ) if ( a.updateRanges.length ) lastAttrs++
				if ( liveBytes > 0 ) shownBytes = liveBytes
				live.setValue( shownBytes, PLAIN )

				glow.visible = glowAmt > 0.05
				uGlow.value = glowAmt
				chiselGroup.visible = glowAmt > 0.05
				if ( chiselGroup.visible ) {
					const l = Math.hypot( editPos.x, editPos.z ) || 1
					chiselGroup.position.set( editPos.x + ( editPos.x / l ) * 0.5, editPos.y + 0.1, editPos.z + ( editPos.z / l ) * 0.5 )
					chiselGroup.lookAt( camera.position )
				}

				const k = clamp01( ( f.presence - 0.3 ) / 0.7 )
				big.set( Math.round( upload.nums[0] * easeOutCubic( k ) ), k < 0.98 ? 0.3 : 0, k >= 0.98 )
				big.opacityValue = Math.pow( f.presence, 1.5 )
				for ( const tx of values ) tx.opacity.value = Math.pow( f.presence, 1.5 )
				for ( const tx of labels ) tx.opacity.value = Math.pow( f.presence, 1.5 ) * 0.72
				live.opacity.value = Math.pow( f.presence, 1.5 ) * ( liveBytes > 0 ? 1 : 0.5 )
				headline.reveal.value = clamp01( f.presence * 1.5 - 0.4 )
				barV1.draw.value = clamp01( f.presence * 1.6 - 0.5 )
				barV2.draw.value = clamp01( f.presence * 1.6 - 0.5 )
				cone.uIntensity.value = 0.4 * f.presence
				ctx.hint( engaged && !pointerFresh && !ctx.pointerActive ? 'hover the statue to chisel' : '' )
			},
			dispose() {
				for ( const o of [line, glow, plinth, cone, chisel, barV1, barV2] ) o.dispose()
				for ( const tx of [...labels, ...values, live] ) tx.dispose()
				big.dispose()
			},
			stats: () => ( { liveBytes, lastAttrs, attributes: Object.keys( line.geometry.attributes ) } ),
		}
	},
}
