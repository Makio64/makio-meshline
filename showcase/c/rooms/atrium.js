/**
 * I · Atrium — Nefertiti rises out of concentric plinth discs as 64 contour rings (one instanced
 * draw, GPU-placed points), under two hairline spotlight cones, with a gold 'II' behind her.
 * The rise plays once as the scene fades in (ctx.intro), then follows the scroll: the rings sink
 * back into the discs as you leave and rise again when you return.
 */
import { easeOutCubic } from '@shared/math.js'
import { BASELINE, num } from '@shared/numbers.js'
import { createRingStack, proceduralRings } from '@shared/statues.js'
import { MeshLine } from 'makio-meshline'
import { Fn } from 'three/tsl'
import { Group, Vector3 } from 'three/webgpu'

import { besideRest, C, capsText, clamp01, FLOOR_Y, goldCount, goldRule, goldText, lineText, pinToCamera, plinthLine, restCamWorld, roomRings, spotCone } from '../kit.js'

const versions = num( 'versions' )
const points = num( 'statuePoints' )

/** Roman 'II' with serif bars: outer outline + the counter between the stems. */
function romanTwo( h = 13, w = 9, bar = 1, stem = 1.5, gap = 1.9 ) {
	const H = h / 2
	const W = w / 2
	const sx = gap / 2 + stem
	const outer = [
		[-W, H], [W, H], [W, H - bar], [sx, H - bar], [sx, -H + bar], [W, -H + bar], [W, -H], [-W, -H],
		[-W, -H + bar], [-sx, -H + bar], [-sx, H - bar], [-W, H - bar],
	]
	const hole = [[-gap / 2, H - bar], [gap / 2, H - bar], [gap / 2, -H + bar], [-gap / 2, -H + bar]]
	const flat = ( pts ) => new Float32Array( pts.flatMap( ( [x, y] ) => [x, y, 0] ) )
	return [flat( outer ), flat( hole )]
}

export default {
	slug: 'atrium',
	title: 'Atrium',
	numeral: 'I',
	rest: { radius: 24, theta: -0.16, phi: 0.06, tx: 4.2, ty: 0.3, ptx: 0, pty: -2.2 },
	footnote: `${points.value} = ${num( 'statueRings' ).value} · same count as ${BASELINE}`,

	async create( ctx, root, room ) {
		const { renderer } = ctx
		const nef = await roomRings( 'nefertiti' )
		const PLINTH_TOP = FLOOR_Y + 1.2
		// concentric discs lying on the plinth: ring 0 is the widest
		const discs = proceduralRings( { rings: nef.rings, samples: nef.samples, name: 'discs' }, ( t, a, out ) => {
			const r = 3.3 - t * 3.05
			out[0] = Math.cos( a ) * r
			out[1] = PLINTH_TOP + 0.02
			out[2] = Math.sin( a ) * r
		} )
		const pal = [0xff2bd6, 0xece4d6]
		const stack = createRingStack( [discs, nef], { lineWidth: 0.03, palettes: [pal, pal], antialias: true, intensity: 1.15, swell: 0.45 } )
		stack.morph.value = 0
		root.add( stack.line )

		const plinth = plinthLine( { w: 7.4, h: 1.2, opacity: 0.5 } )
		root.add( plinth )

		const cones = [
			spotCone( new Vector3( -3.2, 17, 2.5 ), new Vector3( -0.4, FLOOR_Y, 0.4 ), 4.6, { intensity: 0.5 } ),
			spotCone( new Vector3( 3.6, 17, -2.2 ), new Vector3( 0.6, FLOOR_Y, -0.3 ), 3.8, { intensity: 0.38 } ),
		]
		root.add( ...cones )

		// gold outline 'II' floating behind the bust
		const two = new MeshLine()
			.lines( romanTwo(), true )
			.lineWidth( 0.05 )
			.color( C.gold )
			.colorFn( Fn( ( [col] ) => col.mul( 0.75 ) ) )
			.autoResize()
		two.position.set( -2.6, 1.6, -11 )
		root.add( two )

		//---------------------------------------------------------- plaque
		const plaque = new Group()
		const kicker = await capsText( renderer, 'makio-meshline', 0.2, { align: 'left' } )
		kicker.position.set( 0, 3.4, 0 )
		const big = await goldText( renderer, versions.value, 1.25, { align: 'left' } )
		big.position.set( -0.05, 2.15, 0 )
		const bigLabel = await capsText( renderer, versions.label, 0.19, { align: 'left' } )
		bigLabel.position.set( 0, 0.95, 0 )
		const rule = goldRule( 5.8 )
		rule.position.set( 0, 0.55, 0 )
		const counter = await goldCount( renderer, '0,000', points.value, 1.55, { align: 'left' } )
		counter.position.set( -0.05, -0.55, 0 )
		const counterLabel = await capsText( renderer, 'points · one draw', 0.19, { align: 'left' } )
		counterLabel.position.set( 0, -1.75, 0 )
		const line = await lineText( renderer, 'Meshline 2. Every line, redrawn.', 0.62, { align: 'left' } )
		line.position.set( 0, -3.1, 0 )
		plaque.add( kicker, big, bigLabel, rule, counter, counterLabel, line )
		root.add( plaque )

		const texts = [kicker, big, bigLabel, counter, counterLabel, line]
		const dim = [kicker, bigLabel, counterLabel]
		const camTarget = new Vector3()
		cones.forEach( ( c, i ) => { c.phase = i * 2.1 } )

		return {
			update( f ) {
				const portrait = ctx.portrait()
				// plaque sits right of the bust, facing the rest camera (below the bust in portrait)
				if ( portrait ) pinToCamera( plaque, ctx.camera, root, { y: -0.47, width: 10, local: f.local } )
				else {
					besideRest( room.def.rest, 6.2, 0.6, plaque.position, 0.9 )
					plaque.scale.setScalar( 1 )
					plaque.lookAt( restCamWorld( room.def.rest, root, camTarget ) )
				}

				// rings: a one-time rise as the scene fades in, then a pure function of the scroll
				const intro = ctx.intro
				const arrive = clamp01( ( f.local + 1 ) / 0.85 )
				const leave = 1 - clamp01( f.local / 0.85 )
				stack.morph.value = Math.min( easeOutCubic( intro ), arrive, leave )
				stack.line.rotation.y = Math.sin( f.t * 0.12 ) * 0.25

				const k = clamp01( ( f.presence - 0.35 ) / 0.65 )
				const kc = k * Math.min( 1, intro * 1.4 )
				counter.set( Math.round( points.nums[0] * easeOutCubic( kc ) ), kc < 0.98 ? 0.3 : 0, kc >= 0.98 )
				const a = Math.pow( f.presence, 1.5 )
				for ( const tx of texts ) {
					const v = dim.includes( tx ) ? a * 0.72 : a
					if ( tx === counter ) tx.opacityValue = v
					else tx.opacity.value = v
				}
				big.reveal.value = clamp01( f.presence * 1.4 - 0.25 )
				line.reveal.value = clamp01( f.presence * 1.6 - 0.5 ) * Math.min( 1, intro * 1.5 )
				rule.draw.value = clamp01( f.presence * 1.3 - 0.2 )
				for ( const c of cones ) c.uIntensity.value = 0.45 * ( 0.75 + 0.25 * Math.sin( f.t * 0.7 + c.phase ) ) * f.presence
				two.position.y = 1.6 + Math.sin( f.t * 0.4 ) * 0.15
			},
			dispose() {
				stack.dispose()
				for ( const o of [plinth, two, rule, ...cones] ) o.dispose()
				for ( const tx of texts ) tx.dispose()
			},
		}
	},
}
