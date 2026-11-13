/**
 * 01 · Version Two — a giant '2' built from 64 instanced closed MeshLine rings:
 * the glyph outline (red, front) and 63 outset isolines stepped back in z, so
 * the numeral reads as a topographic slab. One draw, positions in a DataTexture.
 */
import { clamp, damp, lerp, smoothstep } from '@shared/math.js'
import { num } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import { Group, Vector3 } from 'three/webgpu'

import { isoLoops, layoutText, loopArea, resample, signedDistance, smoothLoop } from '../lib/glyph.js'
import { header, P, phases, placer } from '../lib/page.js'
import { createStack } from '../lib/stack.js'
import { C, mono, pair } from '../lib/type.js'

const RINGS = 64
const SAMPLES = 220
const OUTSET = 4.6 // world units at the back ring
const DEPTH = 0.05 // z step per ring

function buildRings( L ) {
	const sd = signedDistance( L )
	const positions = new Float32Array( RINGS * SAMPLES * 3 )
	// anchor: start every ring near the end of the base stroke (bottom right) so draw-on sweeps alike
	const ax = L.px( L.ink.right )
	const ay = L.py( L.ink.bottom )
	for ( let r = 0; r < RINGS; r++ ) {
		const levelPx = ( ( r / ( RINGS - 1 ) ) ** 1.15 * OUTSET ) / L.k
		const loops = r === 0 ? isoLoops( L.mask.map( ( v ) => 0.5 - v ), L.w, L.h, 0 ) : isoLoops( sd, L.w, L.h, levelPx )
		let loop = smoothLoop( loops[0], r === 0 ? 1 : 2 )
		if ( loopArea( loop ) < 0 ) { // consistent winding
			const rev = new Float32Array( loop.length )
			const n = loop.length / 2
			for ( let i = 0; i < n; i++ ) { rev[i * 2] = loop[( n - 1 - i ) * 2]; rev[i * 2 + 1] = loop[( n - 1 - i ) * 2 + 1] }
			loop = rev
		}
		let pts = resample( loop, SAMPLES )
		let best = 0
		let bestD = Infinity
		for ( let i = 0; i < SAMPLES; i++ ) {
			const d = ( pts[i * 2] - ax ) ** 2 + ( pts[i * 2 + 1] - ay ) ** 2
			if ( d < bestD ) { bestD = d; best = i }
		}
		for ( let i = 0; i < SAMPLES; i++ ) {
			const j = ( i + best ) % SAMPLES
			const o = ( r * SAMPLES + i ) * 3
			positions[o] = L.wx( pts[j * 2] )
			positions[o + 1] = L.wy( pts[j * 2 + 1] )
			positions[o + 2] = -r * DEPTH
		}
	}
	return { positions, rings: RINGS, samples: SAMPLES }
}

export default {
	title: 'Version Two',
	subs: 1,
	frame: { zoom: 1 },
	async build( ctx ) {
		const group = new Group()

		//------------------------------------------------ the '2'
		const L = layoutText( '2', { size: 16.5, fontPx: 320, pad: 110 } )
		const shape = buildRings( L )
		const stack = createStack( [shape], {
			lineWidth: 0.036,
			palettes: [[C.bone, 0x2a2926]],
			accentRing: 0,
			accentWidth: 3.2,
			intensity: 1,
		} )
		const slab = new Group()
		slab.position.set( -8.2, -0.4, 0 )
		slab.add( stack.line )
		group.add( slab )

		//------------------------------------------------ numbers + type
		const head = await header( 1, 'Version Two', 'Every line on this page is a MeshLine.' )
		group.add( head )

		const versions = num( 'versions' )
		const classes = num( 'classes' )
		const vPair = await pair( versions.value, { size: 2.3 } )
		vPair.position.set( 1.6, 3.4, 0 )
		const vLabel = await mono( versions.label, { size: 0.3 } )
		vLabel.position.set( 1.7, 1.75, 0 )
		const cPair = await pair( classes.value, { size: 2.3 } )
		cPair.position.set( 1.6, -2.2, 0 )
		const cLabel = await mono( classes.label, { size: 0.3 } )
		cLabel.position.set( 1.7, -3.85, 0 )
		group.add( vPair, vLabel, cPair, cLabel )

		//------------------------------------------------ portrait re-stack: the slab on top, the pairs below
		const lay = placer()
		lay.put( slab, -0.6, 6.2 )
		lay.put( vPair, P.left, -6.4, 1.2 )
		lay.put( vLabel, P.left + 0.1, -8.6 )
		lay.put( cPair, P.left, -12.2, 1.2 )
		lay.put( cLabel, P.left + 0.1, -14.4 )
		lay.on( ( p ) => head.portrait( p ) )

		//------------------------------------------------ red cursor trail (MeshLine)
		const TRAIL = 48
		const trailPts = new Float32Array( TRAIL * 3 )
		const trail = new MeshLine()
			.lines( trailPts.map( ( _, i ) => ( i % 3 === 0 ? ( i / 3 ) * 0.001 : 0 ) ), false )
			.dynamic( true )
			.lineWidth( 0.14 )
			.widthCallback( ( t ) => t * t )
			.color( C.red )
			.autoResize()
		trail.frustumCulled = false
		group.add( trail )
		const head3 = new Vector3()
		let trailInit = false
		let lastTrailWidth = 0.14

		const tilt = { x: 0, y: 0 } // pointer only (damped); scroll-driven turns are added undamped
		const fades = [[vPair, 0], [vLabel, 0.1], [cPair, 0.15], [cLabel, 0.25]]

		return {
			group,
			layout: lay.apply,
			update( s ) {
				const { b, h, dim } = phases( s )
				// rings: front outline draws on, then the echoes rise ring by ring
				stack.draw.value = smoothstep( 0.0, 0.5, b ) * ( 1 - smoothstep( 0.45, 1, h ) )
				stack.reveal.value = b <= 0.001 ? 0 : lerp( 0.1, 1, smoothstep( 0.3, 1, b ) * ( 1 - smoothstep( 0, 0.5, h ) ) )
				stack.opacity.value = dim
				// the slab turns in as it builds, keeps turning slowly with the scroll, turns away on hand-off;
				// the cursor adds ±8° with inertia
				tilt.y = damp( tilt.y, ctx.pointer.x * 0.14, 3, s.dt )
				tilt.x = damp( tilt.x, -ctx.pointer.y * 0.1, 3, s.dt )
				const turn = -0.5 + 0.22 * ( 1 - b ) - 0.12 * s.drift + 0.3 * h
				slab.rotation.set( ( 0.12 + tilt.x ) * ( 1 - s.wall ), lerp( turn + tilt.y, 0.75, s.wall ), 0 )

				const tIn = smoothstep( 0.35, 0.95, b ) * ( 1 - smoothstep( 0, 0.5, h ) )
				head.fade( smoothstep( 0.2, 0.7, b ) * ( 1 - smoothstep( 0, 0.4, h ) ) * dim )
				head.reveal( smoothstep( 0.2, 0.8, b ) )
				for ( let i = 0; i < fades.length; i++ ) {
					const g = fades[i][0]
					const d = fades[i][1]
					g.fade( tIn * dim )
					g.reveal( smoothstep( 0.45 + d, 0.9 + d * 0.5, b ) )
				}

				// trail follows the pointer on the poster plane
				const on = s.focus * ( 1 - s.wall )
				trail.visible = on > 0.05
				if ( trail.visible ) {
					head3.set( ctx.pointer.world.x - ctx.X, ctx.pointer.world.y, 0.4 )
					if ( !trailInit ) {
						for ( let i = 0; i < TRAIL; i++ ) {
							trailPts[i * 3] = head3.x - ( TRAIL - i ) * 0.001
							trailPts[i * 3 + 1] = head3.y
							trailPts[i * 3 + 2] = head3.z
						}
						trailInit = true
					}
					for ( let i = 0; i < TRAIL - 1; i++ ) {
						const o = i * 3
						trailPts[o] = lerp( trailPts[o], trailPts[o + 3], 0.55 )
						trailPts[o + 1] = lerp( trailPts[o + 1], trailPts[o + 4], 0.55 )
						trailPts[o + 2] = head3.z
					}
					trailPts[( TRAIL - 1 ) * 3] = head3.x
					trailPts[( TRAIL - 1 ) * 3 + 1] = head3.y
					trailPts[( TRAIL - 1 ) * 3 + 2] = head3.z
					// keep consecutive points distinct
					for ( let i = 1; i < TRAIL; i++ ) {
						const o = i * 3
						if ( Math.abs( trailPts[o] - trailPts[o - 3] ) < 1e-5 && Math.abs( trailPts[o + 1] - trailPts[o - 2] ) < 1e-5 ) trailPts[o] += 1e-4 * i
					}
					trail.setPositions( trailPts )
					const w = 0.14 * clamp( on )
					if ( w !== lastTrailWidth ) {
						lastTrailWidth = w
						trail.lineWidth( w )
					}
				} else {
					trailInit = false
				}
			},
		}
	},
}
