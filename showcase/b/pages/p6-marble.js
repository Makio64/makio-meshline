/**
 * 06 · Number Into Marble — the signature. A giant '64' made of 64 closed
 * rings: ring r is a flattened loop at the height of statue ring r, masked per
 * point so it only shows where the glyph has ink (scanline hatching). Scroll
 * stops morph the same 64 rings, bottom to top with a swelling front, into
 * David, Venus and Nefertiti. One instanced draw. The only page in colour,
 * the only page with bloom.
 */
import { clamp, damp, lerp, smoothstep } from '@shared/math.js'
import { BASELINE, num } from '@shared/numbers.js'
import { loadStatueRings } from '@shared/statues.js'
import { Group } from 'three/webgpu'

import { layoutText, spans } from '../lib/glyph.js'
import { header, LEFT, P, phases, placer, RIGHT } from '../lib/page.js'
import { createStack } from '../lib/stack.js'
import { C, CSS, figure, mono, stat } from '../lib/type.js'

const RINGS = 64
const SAMPLES = 96
const HALF = SAMPLES / 2
const EPS = 0.02
const DEPTH = 0.5

/**
 * Glyph rings with the statue layout: sample i sits near angle 2πi/96 on a flat
 * ellipse (x = W cos a, z = D sin a). The front pass (i = 0..48, z ≥ 0) and back
 * pass hit every span end exactly; mask = 1 on ink, 0 across gaps.
 */
function glyphRings( L, y0, y1 ) {
	const positions = new Float32Array( RINGS * SAMPLES * 3 )
	const mask = new Float32Array( RINGS * SAMPLES )
	const W = Math.max( Math.abs( L.ink.left ), Math.abs( L.ink.right ) ) + 0.35
	for ( let r = 0; r < RINGS; r++ ) {
		const y = lerp( y0, y1, r / ( RINGS - 1 ) )
		const sp = spans( L, L.py( y ) ).map( ( [a, b] ) => [L.wx( a ), L.wx( b )] ).filter( ( [a, b] ) => b - a > 0.04 ).sort( ( p, q ) => q[0] - p[0] )
		// front pass: interior slots 1..47, right -> left
		const slots = HALF - 1
		const xs = []
		const ms = []
		const fixed = sp.length * 4
		if ( sp.length === 0 || fixed > slots ) {
			for ( let i = 1; i <= slots; i++ ) { xs.push( W * Math.cos( ( Math.PI * i ) / HALF ) ); ms.push( 0 ) }
		} else {
			const lens = sp.map( ( [a, b] ) => b - a )
			const total = lens.reduce( ( p, q ) => p + q, 0 )
			const spare = slots - fixed
			const extra = lens.map( ( l ) => Math.floor( ( spare * l ) / total ) )
			let left = spare - extra.reduce( ( p, q ) => p + q, 0 )
			for ( let k = 0; left > 0; k = ( k + 1 ) % extra.length, left-- ) extra[k]++
			sp.forEach( ( [a, b], k ) => {
				xs.push( b + EPS ); ms.push( 0 )
				const n = extra[k] + 2
				for ( let j = 0; j < n; j++ ) { xs.push( b - ( ( b - a ) * j ) / ( n - 1 ) ); ms.push( 1 ) }
				xs.push( a - EPS ); ms.push( 0 )
			} )
		}
		const write = ( i, x, z, m ) => {
			const o = ( r * SAMPLES + i ) * 3
			positions[o] = x
			positions[o + 1] = y
			positions[o + 2] = z
			mask[r * SAMPLES + i] = m
		}
		const zOf = ( x ) => DEPTH * Math.sqrt( Math.max( 0, 1 - ( x / W ) ** 2 ) )
		write( 0, W, 0, 0 )
		write( HALF, -W, 0, 0 )
		for ( let i = 0; i < slots; i++ ) {
			write( 1 + i, xs[i], zOf( xs[i] ), ms[i] ) // front, right -> left
			write( SAMPLES - 1 - i, xs[i], -zOf( xs[i] ), ms[i] ) // back, mirrored
		}
	}
	return { name: 'sixty-four', positions, mask, rings: RINGS, samples: SAMPLES }
}

const NAMES = ['sixty-four', 'David', 'Venus', 'Nefertiti']
// holder yaw that shows each statue at its best angle (the baked rings face +x for David and Venus,
// Nefertiti is in profile at 0): David and Venus a few degrees off frontal, Nefertiti 3/4 to profile
const FACING = [0.45, 0.95, 0.4]
const smootherstep = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 )

export default {
	title: 'Number Into Marble',
	subs: 4,
	labels: ['64', 'David', 'Venus', 'Nefertiti'],
	async build( ctx ) {
		const group = new Group()
		const rings = num( 'statueRings' )
		const pts = num( 'statuePoints' )
		const draw = num( 'oneDraw' )

		// baked ring files (one small fetch each, cached: the loader's statues step already fetched them)
		const [david, venus, nefertiti] = await Promise.all( ['david', 'venus', 'nefertiti'].map( ( n ) => loadStatueRings( n, { rings: RINGS, samples: SAMPLES } ) ) )

		const SIZE = 16.4
		const L = layoutText( '64', { size: SIZE, fontPx: 360, pad: 16 } )
		const glyph = glyphRings( L, L.ink.bottom + 0.05, L.ink.top - 0.05 )

		const stack = createStack( [glyph, david, venus, nefertiti], {
			lineWidth: 0.085,
			palettes: [[C.red, 0xff5a3a], [0xff1500, 0xffd400], [0xff00c8, 0xffffff], [0x00b3ff, 0xfff1c4]],
			swell: 0.6,
			widthSwell: 0.1,
			intensity: 1.05,
			frontGlow: 2.2,
		} )
		const holder = new Group()
		holder.position.set( 0, 0.6, 0 )
		holder.add( stack.line )
		group.add( holder )

		// the ultra-text '64' face fades as the rings take over
		const face = await figure( '64', { size: SIZE, color: CSS.red, align: 'center' } )
		const faceDY = L.wy( L.cy )
		face.position.set( 0, 0.6 + faceDY, -0.8 )
		group.add( face )

		//------------------------------------------------ captions + numbers
		const names = []
		for ( let i = 1; i < NAMES.length; i++ ) {
			const n = await mono( NAMES[i], { size: 0.42, color: CSS.bone } )
			n.position.set( RIGHT - 4.6, 4.8, 0 )
			group.add( n )
			names.push( n )
		}
		const sRings = await stat( rings.value, 'rings × samples', { size: 1.6 } )
		sRings.position.set( LEFT, -6.9, 0 )
		const sPts = await stat( pts.value, 'GPU-placed points', { size: 1.6 } )
		sPts.position.set( -8.4, -6.9, 0 )
		const sDraw = await stat( draw.value, 'instanced · every ring', { size: 1.6, color: CSS.red } )
		sDraw.position.set( 6.6, -6.9, 0 )
		const foot = await mono( `ring count unchanged since ${BASELINE}`, { size: 0.24, color: CSS.grey, upper: false } )
		foot.position.set( LEFT, -9.35, 0 )
		group.add( sRings, sPts, sDraw, foot )

		const head = await header( 6, 'Number Into Marble', 'Number into marble, in one draw.' )
		group.add( head )

		const ptr = { x: 0, y: 0 } // pointer only (damped); every scroll-driven value is used as is
		const stats = [sRings, sPts, sDraw]

		//------------------------------------------------ portrait re-stack: the statue column on top, numbers below
		let baseY = 0.6
		let grow = 1.3 // statue scale once the first morph lands
		const lay = placer()
		names.forEach( ( n ) => lay.put( n, P.left, 16.2 ) )
		lay.put( sRings, P.left, -7.4 )
		lay.put( sDraw, 1.6, -7.4 ) // clear of the pager dots
		lay.put( sPts, P.left, -12.2 )
		lay.put( foot, P.left, -16.4 )
		lay.on( ( p ) => {
			head.portrait( p )
			baseY = p ? 6.4 : 0.6
			grow = p ? 1.5 : 1.3
			face.position.y = baseY + faceDY
		} )

		const inst = {
			debugMorph: null, // inspection hook: freeze the morph (0 '64' .. 3 Nefertiti)
			group,
			layout: lay.apply,
			bloom( s ) {
				// the bloom flares while a morph front sweeps the rings, then settles
				const m = s.sub
				const sweep = Math.sin( Math.PI * clamp( m - Math.floor( m ) ) )
				return ( 0.42 + 0.38 * sweep ) * s.focus * ( 1 - s.wall * 0.6 )
			},
			update( s ) {
				const { b, h, dim } = phases( s )
				// the morph IS the dwell-mapped sub-progress: each stop holds one shape, the ring-by-ring
				// sweep runs between stops and rewinds exactly when scrolling back
				const m = inst.debugMorph ?? s.sub
				stack.morph.value = m
				// glyph -> statue: gentle swell, keep the glyph's gaps until a ring has contracted
				const g2s = 1 - smoothstep( 0.9, 1.1, m )
				stack.swell.value = lerp( 0.6, 0.18, g2s )
				stack.maskLag.value = lerp( 0, 0.75, g2s )
				stack.reveal.value = smoothstep( 0.05, 0.9, b ) * ( 1 - smoothstep( 0.1, 0.9, h ) )
				stack.opacity.value = dim
				stack.intensity.value = lerp( 0.55, 1.05, s.focus )

				// statues turn with the scroll: each stop shows its statue at its best angle (keyframed, eased
				// between stops), a slow scroll-driven turn keeps going while it holds, plus a small bounded
				// idle sway; the '64' faces the camera
				const k = smoothstep( 0.15, 0.9, m )
				ptr.x = damp( ptr.x, ctx.pointer.x, 2, s.dt )
				ptr.y = damp( ptr.y, ctx.pointer.y, 2, s.dt )
				const j = clamp( Math.floor( m - 1 ), 0, FACING.length - 2 )
				const facing = lerp( FACING[j], FACING[j + 1], smootherstep( clamp( m - 1 - j ) ) )
				const sway = ctx.reducedMotion ? 0 : 0.07 * Math.sin( s.t * 0.35 )
				const spin = k * ( facing + 0.35 * ( s.drift - m ) + sway + ptr.x * 0.2 )
				holder.rotation.set( lerp( 0.04, 0.3, k ) + ptr.y * 0.08 * k, spin, 0 )
				// statues stand taller than the numeral: rise and grow as the first morph lands
				holder.scale.setScalar( lerp( 1, grow, k ) )
				holder.position.y = baseY + 0.9 * k

				const tIn = smoothstep( 0.35, 0.95, b ) * ( 1 - smoothstep( 0, 0.5, h ) ) * dim
				face.fade( 0.16 * tIn * ( 1 - smoothstep( 0.05, 0.6, m ) ) )
				for ( let i = 0; i < names.length; i++ ) names[i].fade( tIn * clamp( 1 - Math.abs( m - ( i + 1 ) ) * 2.2 ) )
				for ( let i = 0; i < stats.length; i++ ) {
					stats[i].fade( tIn )
					stats[i].reveal( smoothstep( 0.55, 1, b ) )
				}
				foot.fade( tIn * 0.9 )
				head.fade( smoothstep( 0.2, 0.7, b ) * ( 1 - smoothstep( 0, 0.4, h ) ) * dim )
				head.reveal( smoothstep( 0.2, 0.8, b ) )
			},
		}
		return inst
	},
}
