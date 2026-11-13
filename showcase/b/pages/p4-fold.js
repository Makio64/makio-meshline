/**
 * 04 · No Spikes — a thick helix seen obliquely, so its coils turn toward the
 * camera. Three stops step the join fold policy: false (old miters, grey),
 * 'geometry' (v2 default, red), 'exact' (red). Tube shading via lineCoord.
 * Numbers are documented (CHANGELOG), not re-measured here.
 */
import { clamp, damp, smoothstep } from '@shared/math.js'
import { BASELINE, num } from '@shared/numbers.js'
import { lineCoord, MeshLine } from 'makio-meshline'
import { float, Fn, mix, positionGeometry, smoothstep as tslSmooth, uniform, varying, vec3, vec4 } from 'three/tsl'
import { Group } from 'three/webgpu'

import { dimLine, header, LEFT, P, phases, placer } from '../lib/page.js'
import { C, CSS, figure, mono, stat } from '../lib/type.js'

const RADIUS = 3.1
const helixPositions = ( segments = 30, width = 16.5, radius = RADIUS, turns = 3.5 ) => {
	const positions = new Float32Array( ( segments + 1 ) * 3 )
	for ( let i = 0; i <= segments; i++ ) {
		const t = i / segments
		const angle = t * Math.PI * 2 * turns
		positions[i * 3] = -width / 2 + width * t
		positions[i * 3 + 1] = Math.cos( angle ) * radius
		positions[i * 3 + 2] = Math.sin( angle ) * radius
	}
	return positions
}

// fake chrome tube across the billboard (metallicTube.js idea, unlit): dark rim, soft body,
// a hard studio highlight above the axis and a dim reflected band below it; coils on the far
// side of the helix fall back into the ink so the spring reads in depth on a flat poster
const vDepth = varying( positionGeometry.z, 'vCoilDepth' )
const tubeShade = Fn( ( [color] ) => {
	const y = lineCoord.y
	const n = float( 1 ).sub( y.mul( y ) ).max( 0 ).sqrt()
	const body = n.pow( 1.6 ).mul( 0.78 ).add( 0.1 )
	const spec = tslSmooth( 0.66, 1.0, float( 1 ).sub( y.sub( -0.38 ).abs() ) ).pow( 2 ).mul( 0.62 )
	const band = tslSmooth( 0.7, 1.0, float( 1 ).sub( y.sub( 0.5 ).abs() ) ).mul( 0.16 )
	const near = tslSmooth( -RADIUS * 0.8, RADIUS * 0.8, vDepth )
	const lit = color.rgb.mul( body.add( band ) ).add( vec3( spec ) )
	return vec4( mix( lit.mul( 0.22 ), lit, near.mul( 0.85 ).add( 0.15 ) ), 1 )
} )

const VARIANTS = [
	{ fold: false, limit: 12, color: 0x8c8a85, label: 'old miters (approx.)' },
	{ fold: 'geometry', limit: 4, color: C.red, label: "fold: 'geometry'" },
	{ fold: 'exact', limit: 4, color: C.red, label: "fold: 'exact'" },
]

export default {
	title: 'No Spikes',
	subs: 3,
	labels: ['old miters', "fold 'geometry'", "fold 'exact'"],
	async build( ctx ) {
		const group = new Group()
		const fold = num( 'fold' )
		const pts = helixPositions()

		const coil = new Group()
		coil.position.set( 7.4, 0.9, 0 )
		group.add( coil )
		const lines = VARIANTS.map( ( v ) => {
			const uW = uniform( 0 )
			const line = new MeshLine()
				.lines( pts, false )
				.lineWidth( 0.95 )
				.color( v.color )
				.join( { type: 'miter', limit: v.limit, fold: v.fold } )
				.widthFn( Fn( ( [w] ) => w.mul( uW ) ) )
				.fragmentColorFn( tubeShade )
				.autoResize()
			coil.add( line )
			return { line, uW, ...v }
		} )

		//------------------------------------------------ counter: 31.6 → 4.8 → 1.6 px
		// one static figure per documented value (proportional digits, crisp kerning)
		const bigs = []
		for ( let i = 0; i < 3; i++ ) {
			const f = await figure( `${fold.nums[i]} px`, { size: 4.6, align: 'left', color: i === 0 ? '#8C8A85' : CSS.red } )
			f.position.set( LEFT, 3.3, 0 )
			group.add( f )
			bigs.push( f )
		}
		const what = await mono( 'worst overshoot · 24 poses', { size: 0.28 } )
		what.position.set( LEFT + 0.15, 0.55, 0 )
		group.add( what )
		const stateLabels = []
		for ( const v of VARIANTS ) {
			const l = await mono( v.label, { size: 0.42, color: v.fold === false ? CSS.grey : CSS.red, upper: false } )
			l.position.set( LEFT + 0.15, -0.6, 0 )
			group.add( l )
			stateLabels.push( l )
		}

		//------------------------------------------------ stats + footnote
		const notched = await stat( num( 'notched' ).value, 'notched px · torus knot', { size: 1.4 } )
		notched.position.set( LEFT, -7.0, 0 )
		const width = await stat( num( 'width100' ).value, `90° corner width · vs ${BASELINE}`, { size: 1.4 } )
		width.position.set( -5.5, -7.0, 0 )
		const foot = await mono( 'documented · not re-measured here', { size: 0.24, color: CSS.grey, upper: false } )
		foot.position.set( LEFT, -9.35, 0 )
		group.add( notched, width, foot )

		const head = await header( 4, 'No Spikes', 'Turn toward the camera. No spikes.' )
		group.add( head )

		const rot = { x: 0, y: 0 } // pointer only (damped); the scroll-driven turntable is added undamped

		//------------------------------------------------ portrait re-stack
		let bigY = 3.3
		const lay = placer()
		lay.put( coil, 0.2, 8.8, 0.92 )
		bigs.forEach( ( f ) => lay.put( f, P.left, -2.4, 0.86 ) )
		lay.put( what, P.left + 0.15, -5.2 )
		stateLabels.forEach( ( l ) => lay.put( l, P.left + 0.15, -6.7 ) )
		lay.put( notched, P.left, -10.6, 1.1 )
		lay.put( width, P.left, -15.0, 1.1 )
		lay.put( foot, P.left, -18.6 )
		lay.on( ( p ) => {
			head.portrait( p )
			bigY = p ? -2.4 : 3.3
			for ( const v of lines ) v.line.lineWidth( p ? 0.95 * 0.86 : 0.95 )
		} )

		const stats = [notched, width]
		const lastDim = [-1, -1, -1]
		return {
			group,
			layout: lay.apply,
			update( s ) {
				const { b, h, dim } = phases( s )
				const sub = s.sub
				const grow = smoothstep( 0.1, 0.8, b ) * ( 1 - smoothstep( 0.1, 0.8, h ) )
				for ( let i = 0; i < lines.length; i++ ) {
					const v = lines[i]
					const w = ( 1 - smoothstep( 0.22, 0.52, Math.abs( sub - i ) ) ) * grow
					v.uW.value = w
					v.line.visible = w > 0.002
					if ( lastDim[i] !== dim ) {
						lastDim[i] = dim
						dimLine( v.line, v.color, dim )
					}
				}
				// turntable driven by the scroll: the coils sweep through the cusp angle where old miters
				// spike as you read the three stops (about 9° per page); the cursor adds its own damped turn
				rot.y = damp( rot.y, ctx.pointer.x * 0.3, 2.5, s.dt )
				rot.x = damp( rot.x, ctx.pointer.y * 0.18, 2.5, s.dt )
				coil.rotation.set( 0.05 + rot.x, 0.12 + 0.16 * s.drift + rot.y, 0.12 )

				// number: the documented value of each stop wipes in as the previous one leaves
				const tIn = smoothstep( 0.35, 0.95, b ) * ( 1 - smoothstep( 0, 0.5, h ) ) * dim
				for ( let i = 0; i < bigs.length; i++ ) {
					const f = bigs[i]
					const near = clamp( 1 - Math.abs( sub - i ) * 2.2 )
					f.fade( tIn * near )
					f.reveal( Math.min( smoothstep( 0.3, 0.85, b ), smoothstep( 0, 1, near ) ) )
					f.position.y = bigY + ( sub - i ) * 0.9
				}
				what.fade( tIn )
				for ( let i = 0; i < stateLabels.length; i++ ) stateLabels[i].fade( tIn * clamp( 1 - Math.abs( sub - i ) * 2.4 ) )
				for ( let i = 0; i < stats.length; i++ ) {
					stats[i].fade( tIn )
					stats[i].reveal( smoothstep( 0.55, 1, b ) )
				}
				foot.fade( tIn * 0.9 )
				head.fade( smoothstep( 0.2, 0.7, b ) * ( 1 - smoothstep( 0, 0.4, h ) ) * dim )
				head.reveal( smoothstep( 0.2, 0.8, b ) )
			},
		}
	},
}
