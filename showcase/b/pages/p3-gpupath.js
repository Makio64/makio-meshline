/**
 * 03 · Simplified On GPU — the real demo trace (200,000 points, gpuPath.js data)
 * rendered by MeshLineGPUPath. Stop A: raw path. Stop B: the simplified path
 * with wireframe() in red, and the '1,646' drawn as a MeshLine outline of
 * exactly 1,646 segments (count = CPU-oracle constant, footnoted).
 * WebGL2: MeshLineGPUPath keeps its CPU MeshLine fallback automatically.
 */
import { clamp, smoothstep } from '@shared/math.js'
import { num } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import MeshLineGPUPath from 'makio-meshline/gpu-path'
import { Fn, step, uniform } from 'three/tsl'
import { Group } from 'three/webgpu'

import { isoLoops, layoutText, loopLength, loopToWorld, resample, smoothLoop } from '../lib/glyph.js'
import { header, LEFT, P, phases, placer, RIGHT } from '../lib/page.js'
import { C, figure, mono, stat } from '../lib/type.js'

// identical data to demo/src/demos/gpuPath.js (the 1,646 oracle count is for this path)
const POINT_COUNT = 200_000
const PATH_LENGTH = 100
const LOCAL_TOLERANCE = 0.012
function createLargeOpenPath() {
	const points = new Float32Array( POINT_COUNT * 3 )
	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const progress = i / ( POINT_COUNT - 1 )
		const centered = progress * 2 - 1
		const detailEnvelope = Math.exp( -centered * centered * 18 )
		const offset = i * 3
		points[offset] = centered * PATH_LENGTH * 0.5
		points[offset + 1] = Math.sin( progress * Math.PI * 4 ) * 0.7
		points[offset + 2] = Math.sin( progress * Math.PI * 24 ) * 2 + Math.sin( progress * Math.PI * 180 ) * detailEnvelope * 4
	}
	return points
}

/** Outline of `text` resampled so the closed loops hold exactly `total` segments. */
function exactOutline( text, size, total ) {
	const L = layoutText( text, { size, fontPx: 300, pad: 12 } )
	const loops = isoLoops( L.mask.map( ( v ) => 0.5 - v ), L.w, L.h, 0 ).filter( ( l ) => loopLength( l ) > 30 ).map( ( l ) => smoothLoop( l, 1 ) )
	const lens = loops.map( ( l ) => loopLength( l ) )
	const sum = lens.reduce( ( a, b ) => a + b, 0 )
	const counts = lens.map( ( l ) => Math.max( 8, Math.round( ( total * l ) / sum ) ) )
	let diff = total - counts.reduce( ( a, b ) => a + b, 0 )
	for ( let i = 0; diff !== 0; i = ( i + 1 ) % counts.length ) {
		counts[i] += Math.sign( diff )
		diff -= Math.sign( diff )
	}
	return loops.map( ( l, i ) => loopToWorld( L, resample( l, counts[i] ) ) )
}

export default {
	title: 'Simplified On GPU',
	gpuWait: true, // its build awaits the GPU path preparation: the loader starts it first
	subs: 2,
	labels: ['200,000 points', 'simplified'],
	async build( ctx ) {
		const group = new Group()
		const gp = num( 'gpuPath1646' )
		const [fromStr, toStr] = gp.value.split( '→' ).map( ( s ) => s.trim() )

		//------------------------------------------------ the trace: raw + simplified GPU paths
		const points = createLargeOpenPath()
		const trace = new Group()
		trace.position.set( 0, -3.2, 0 )
		trace.rotation.x = -Math.PI / 2 // the demo's z waves become the poster's y
		trace.scale.setScalar( 0.355 )
		group.add( trace )
		const lineOpts = { lines: points, join: { type: 'miter', limit: 3, segments: 8 }, cap: { type: 'butt', segments: 8 } }
		const raw = new MeshLineGPUPath( { ...lineOpts, lineWidth: 0.075, color: C.bone }, { chunkSegments: 128, simplify: false } )
		const simple = new MeshLineGPUPath( { ...lineOpts, lineWidth: 0.075, color: C.red }, { chunkSegments: 128, simplify: { localTolerance: LOCAL_TOLERANCE } } )
		trace.add( raw, simple )
		const { width, height } = ctx.stage.size
		raw.resize( width, height )
		simple.resize( width, height )
		const [rawOk, simpleOk] = await Promise.all( [raw.prepare( ctx.renderer, ctx.camera ), simple.prepare( ctx.renderer, ctx.camera )] )
		simple.wireframe( true )
		ctx.stage.onResize( ( w, h ) => { raw.resize( w, h ); simple.resize( w, h ) } )
		const backend = rawOk && simpleOk ? 'indirect · GPU path' : 'WebGL2 · CPU fallback'

		//------------------------------------------------ '200,000' (ultra-text) and '1,646' (MeshLine, 1,646 segments)
		const big = await figure( fromStr, { size: 8.6, align: 'center' } )
		big.position.set( 0, 4.3, 0 )
		group.add( big )

		const uDraw = uniform( 0 )
		const outline = new MeshLine()
			.lines( exactOutline( toStr, 8.6, gp.nums[1] ), true )
			.lineWidth( 0.075 )
			.color( C.red )
			.widthFn( Fn( ( [w, progress] ) => w.mul( step( progress, uDraw.mul( 1.001 ) ) ) ) )
			.autoResize()
		outline.position.set( 0, 4.3, 0 )
		group.add( outline )
		const oracle = await mono( `${toStr} segments · CPU-oracle count`, { size: 0.26, upper: false } )
		oracle.position.set( 6.2, 0.55, 0 )
		group.add( oracle )

		//------------------------------------------------ stats row
		const s121 = await stat( num( 'segments121' ).value, 'fewer segments', { size: 1.4 } )
		s121.position.set( LEFT, -8.1, 0 )
		const mem = num( 'gpuPathMemory' )
		const sMem = await stat( mem.value, 'buffers · vs CPU path', { size: 1.4 } )
		sMem.position.set( -6.2, -8.1, 0 )
		const sDraw = await stat( num( 'oneDraw' ).value, backend, { size: 1.4 } )
		sDraw.position.set( 6.2, -8.1, 0 )
		const ptsLabel = await mono( `${fromStr} points in`, { size: 0.26 } )
		ptsLabel.position.set( RIGHT - 9, -0.45, 0 )
		group.add( s121, sMem, sDraw, ptsLabel )

		const head = await header( 3, 'Simplified On GPU', 'Simplified on the GPU. One draw.' )
		group.add( head )

		//------------------------------------------------ portrait re-stack
		let traceK = 0.355
		let waveK = 1 // portrait: taller waves on the narrower trace
		const BIG = 0.6
		const lay = placer()
		lay.put( big, 0, 11.6, BIG )
		lay.put( outline, 0, 11.6, BIG )
		lay.put( oracle, P.left, 7.4 )
		lay.put( ptsLabel, P.left, 7.4 )
		lay.put( s121, P.left, -7.6, 1.15 )
		lay.put( sMem, 0.6, -7.6, 1.15 )
		lay.put( sDraw, P.left, -13.4, 1.15 )
		lay.on( ( p ) => {
			head.portrait( p )
			traceK = p ? 0.205 : 0.355
			waveK = p ? 1.8 : 1
			trace.position.y = p ? 0.6 : -3.2
			trace.scale.x = trace.scale.y = traceK
			outline.lineWidth( p ? 0.06 : 0.075 )
		} )

		const stats = [s121, sMem, sDraw]
		return {
			group,
			gpuPaths: [raw, simple],
			layout: lay.apply,
			update( s ) {
				const { b, h, dim } = phases( s )
				const sub = s.sub
				const isSimple = sub > 0.5
				// the trace grows out of a flat band (page 2's hand-off) and flattens on the way out; between
				// the two stops it collapses flat and re-forms, so the raw -> simplified swap at the flat
				// moment never pops. Local z carries the waves (rotated onto the poster's y)
				const swap = smoothstep( 0.15, 0.5, sub ) * ( 1 - smoothstep( 0.5, 0.85, sub ) )
				trace.scale.z = traceK * waveK * Math.max( 1e-3, smoothstep( 0.1, 0.8, b ) * ( 1 - smoothstep( 0.2, 1, h ) ) * ( 1 - swap ) )
				// a slow scroll-driven tilt shows the trace's depth while each stop holds
				trace.rotation.x = -Math.PI / 2 + 0.16 * clamp( s.drift - 0.5, -1.5, 1.5 )
				raw.visible = !isSimple
				simple.visible = isSimple
				if ( raw.visible ) raw.update( ctx.camera )
				if ( simple.visible ) simple.update( ctx.camera )

				const tIn = smoothstep( 0.4, 0.95, b ) * ( 1 - smoothstep( 0, 0.5, h ) ) * dim
				big.fade( tIn * ( 1 - smoothstep( 0.15, 0.5, sub ) ) )
				big.reveal( smoothstep( 0.3, 0.9, b ) )
				uDraw.value = smoothstep( 0.45, 1, sub ) * ( 1 - smoothstep( 0, 0.6, h ) )
				outline.visible = uDraw.value > 0.001
				oracle.fade( tIn * smoothstep( 0.7, 1, sub ) )
				ptsLabel.fade( tIn * ( 1 - smoothstep( 0.2, 0.5, sub ) ) )
				for ( let i = 0; i < stats.length; i++ ) {
					stats[i].fade( tIn )
					stats[i].reveal( smoothstep( 0.55, 1, b ) )
				}
				head.fade( smoothstep( 0.2, 0.7, b ) * ( 1 - smoothstep( 0, 0.4, h ) ) * dim )
				head.reveal( smoothstep( 0.2, 0.8, b ) )
			},
		}
	},
}
