/**
 * 02 · Partial Upload — the '773×' is one MeshLine of 200,000 points: a
 * serpentine hatch filling the glyph mask (split into polylines where the pen
 * lifts). Every frame a real setPositionRange() ripples 128 points under the
 * cursor; the readout sums the attribute updateRanges the renderer will upload.
 *
 * The hatch line uses no shader hooks on purpose: no progress/uv buffers, so a
 * 128-point edit uploads only position/previous/next (the benchmark setup).
 * The draw-on is geometry.setDrawRange (no upload).
 */
import { clamp, damp, smoothstep } from '@shared/math.js'
import { BASELINE, num, RELEASE } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import { Group } from 'three/webgpu'

import { layoutText, spans } from '../lib/glyph.js'
import { dimLine, header, LEFT, P, phases, placer } from '../lib/page.js'
import { C, counter, CSS, figure, mono } from '../lib/type.js'

const POINTS = 200_000
const EDIT = 128
const ROW = 0.082 // hatch row spacing (world)

/** Greedy boustrophedon: runs of spans connected by U-turns while consecutive rows overlap. */
function hatchRuns( L ) {
	const rows = []
	for ( let y = L.ink.top - ROW * 0.5; y > L.ink.bottom; y -= ROW ) {
		const sp = spans( L, L.py( y ) ).map( ( [a, b] ) => ( { a: L.wx( a ), b: L.wx( b ), used: false } ) ).filter( ( s ) => s.b - s.a > 0.03 )
		rows.push( { y, sp } )
	}
	const runs = []
	for ( let r = 0; r < rows.length; r++ ) {
		for ( const start of rows[r].sp ) {
			if ( start.used ) continue
			const pts = []
			let cur = start
			let row = r
			let dir = 1
			cur.used = true
			for ( ;; ) {
				const y = rows[row].y
				if ( dir > 0 ) pts.push( cur.a, y, cur.b, y )
				else pts.push( cur.b, y, cur.a, y )
				const next = rows[row + 1]
				if ( !next ) break
				const end = dir > 0 ? cur.b : cur.a
				let pick = null
				let bestD = Infinity
				for ( const s of next.sp ) {
					if ( s.used || s.a >= cur.b || s.b <= cur.a ) continue
					const d = Math.abs( ( dir > 0 ? s.b : s.a ) - end )
					if ( d < bestD ) { bestD = d; pick = s }
				}
				if ( !pick || bestD > 0.9 ) break
				pick.used = true
				cur = pick
				row++
				dir = -dir
			}
			runs.push( pts )
		}
	}
	return runs
}

function polyLength( p ) {
	let len = 0
	for ( let i = 2; i < p.length; i += 2 ) len += Math.hypot( p[i] - p[i - 2], p[i + 1] - p[i - 1] )
	return len
}

/** Distribute exactly `total` points over the runs by arc length. */
function densify( runs, total ) {
	const lens = runs.map( polyLength )
	const sum = lens.reduce( ( a, b ) => a + b, 0 )
	const counts = lens.map( ( l ) => Math.max( 2, Math.round( ( total * l ) / sum ) ) )
	let diff = total - counts.reduce( ( a, b ) => a + b, 0 )
	const order = lens.map( ( _, i ) => i ).sort( ( a, b ) => lens[b] - lens[a] )
	for ( let k = 0; diff !== 0; k = ( k + 1 ) % order.length ) {
		const i = order[k]
		const step = Math.sign( diff )
		if ( counts[i] + step >= 2 ) { counts[i] += step; diff -= step }
	}
	return runs.map( ( p, ri ) => {
		const n = counts[ri]
		const out = new Float32Array( n * 3 )
		const L = lens[ri]
		let seg = 0
		let acc = 0
		let segLen = Math.hypot( p[2] - p[0], p[3] - p[1] )
		for ( let k = 0; k < n; k++ ) {
			const target = ( k / ( n - 1 ) ) * L
			while ( acc + segLen < target && seg < p.length / 2 - 2 ) {
				acc += segLen
				seg++
				segLen = Math.hypot( p[seg * 2 + 2] - p[seg * 2], p[seg * 2 + 3] - p[seg * 2 + 1] )
			}
			const t = segLen > 0 ? clamp( ( target - acc ) / segLen ) : 0
			out[k * 3] = p[seg * 2] + ( p[seg * 2 + 2] - p[seg * 2] ) * t
			out[k * 3 + 1] = p[seg * 2 + 1] + ( p[seg * 2 + 3] - p[seg * 2 + 1] ) * t
			out[k * 3 + 2] = 0
		}
		return out
	} )
}

export default {
	title: 'Partial Upload',
	subs: 1,
	async build( ctx ) {
		const group = new Group()
		const upload = num( 'upload773' )
		const bytes = num( 'bytes144' )
		const cpu = num( 'cpu350' )

		//------------------------------------------------ hatch '773×'
		const SIZE = 13.2
		const L = layoutText( upload.value, { size: SIZE, fontPx: 300, pad: 16 } )
		const lines = densify( hatchRuns( L ), POINTS )
		const base = lines.map( ( l ) => l.slice() )
		const hatch = new MeshLine()
			.lines( lines, false )
			.dynamic( true )
			.lineWidth( 0.04 )
			.color( C.bone )
			.autoResize()
		hatch.build()
		const poster = new Group()
		poster.position.set( 0, 1.8, 0 )
		poster.add( hatch )
		group.add( poster )
		const indexCount = hatch.geometry.index ? hatch.geometry.index.count : 0

		// red ultra-text face underneath, misregistered like a two-colour screenprint.
		// Pushed back in z (glyph quads carry their own depth) and rescaled to keep its apparent size.
		const face = await figure( upload.value, { size: SIZE, color: CSS.red } )
		const D = ctx.stage.fitDistance( ctx.POSTER.w, ctx.POSTER.h, 1 )
		const FACE_Z = -3
		face.position.set( 0.14, -0.12, FACE_Z )
		face.scale.setScalar( ( D - FACE_Z ) / D )
		poster.add( face )

		// the edited 128 points, re-drawn in red on top (separate small line, not counted)
		const edit = new Float32Array( EDIT * 3 )
		const markPts = new Float32Array( EDIT * 3 )
		for ( let i = 0; i < EDIT; i++ ) markPts[i * 3] = i * 0.01
		const mark = new MeshLine()
			.lines( markPts, false )
			.dynamic( true )
			.lineWidth( 0.075 )
			.color( C.red )
			.autoResize()
		mark.frustumCulled = false
		poster.add( mark )

		// lookup: one sample every 48 points of runs long enough to host the edit
		const probe = []
		lines.forEach( ( l, ri ) => {
			const n = l.length / 3
			if ( n < EDIT + 8 ) return
			for ( let i = 4; i < n - 4; i += 48 ) probe.push( l[i * 3], l[i * 3 + 1], ri, i )
		} )
		const nearest = { run: 0, index: 0, d: 0 } // reused: no allocation per frame
		const findNearest = ( x, y ) => {
			let best = 0
			let bestD = Infinity
			for ( let k = 0; k < probe.length; k += 4 ) {
				const d = ( probe[k] - x ) ** 2 + ( probe[k + 1] - y ) ** 2
				if ( d < bestD ) { bestD = d; best = k }
			}
			nearest.run = probe[best + 2]
			nearest.index = probe[best + 3]
			nearest.d = Math.sqrt( bestD )
			return nearest
		}

		//------------------------------------------------ bars (Swiss rules)
		const [mbLabel, kbLabel] = bytes.value.split( '→' ).map( ( s ) => s.trim() )
		const ratio = bytes.nums[1] / ( bytes.nums[0] * 1000 )
		const BAR = 27
		const barX = -BAR / 2
		const v1Bar = new MeshLine().lines( new Float32Array( [0, 0, 0, BAR, 0, 0] ), false ).lineWidth( 0.36 ).color( C.grey )
		const v2Bar = new MeshLine().lines( new Float32Array( [0, 0, 0, Math.max( 0.02, BAR * ratio ), 0, 0] ), false ).lineWidth( 0.36 ).color( C.red )
		let barK = 1 // portrait shortens the bars
		v1Bar.position.set( barX, -5.4, 0 )
		v2Bar.position.set( barX, -6.3, 0 )
		group.add( v1Bar, v2Bar )
		const l1 = await mono( BASELINE, { size: 0.26, color: CSS.grey, align: 'right', upper: false } )
		l1.position.set( barX - 0.5, -5.4, 0 )
		const l2 = await mono( RELEASE, { size: 0.26, color: CSS.red, align: 'right', upper: false } )
		l2.position.set( barX - 0.5, -6.3, 0 )
		const b1 = await figure( mbLabel, { size: 0.62, color: CSS.grey, align: 'left' } )
		b1.position.set( barX + BAR + 0.4, -5.4, 0 )
		const b2 = await figure( kbLabel, { size: 0.62, color: CSS.red, align: 'left' } )
		b2.position.set( barX + 0.5, -6.3, 0 )
		const uploadLabel = await mono( `less GPU upload · 128-pt edit · vs ${BASELINE}`, { size: 0.28, upper: false } )
		uploadLabel.position.set( barX, -4.35, 0 )
		group.add( l1, l2, b1, b2, uploadLabel )

		//------------------------------------------------ stats row
		// '350×+' counts up (template from the bank string: digits become slots)
		const cpuCount = await counter( cpu.value.replace( /\d/g, '0' ), { size: 1.5, color: CSS.bone, align: 'left', value: 0 } )
		cpuCount.position.set( LEFT, -8.2, 0 )
		const cpuLabel = await mono( 'faster CPU per edit', { size: 0.26, drop: true } )
		cpuLabel.position.set( LEFT + 0.05, -9.37, 0 )
		const cpuStat = new Group()
		cpuStat.add( cpuCount, cpuLabel )
		cpuStat.fade = ( a ) => { cpuCount.fade( a ); cpuLabel.fade( a ) }
		cpuStat.reveal = ( r ) => { cpuCount.reveal.value = r }
		const live = await counter( '00,000 B', { size: 1.5, color: CSS.bone, align: 'left', value: 0 } )
		live.position.set( 4.0, -8.2, 0 )
		const liveLabel = await mono( 'uploaded this frame · live', { size: 0.26, drop: true } )
		liveLabel.position.set( 4.0, -9.37, 0 )
		group.add( cpuStat, live, liveLabel )

		const head = await header( 2, 'Partial Upload', 'One small edit. One small upload.' )
		group.add( head )

		//------------------------------------------------ portrait re-stack
		// the hatch scales down to the column; bars shorten; version tags sit above the bars
		const PS = 0.66
		const lay = placer()
		lay.put( poster, 0, 8.6, PS )
		lay.put( uploadLabel, P.left, 1.6 )
		lay.put( b1, P.left, 0.0, 1.25 )
		lay.put( v1Bar, P.left, -1.2 )
		lay.put( l1, P.right, 0.0 )
		lay.put( v2Bar, P.left, -2.5 )
		lay.put( b2, P.left + 0.5, -3.7, 1.25 )
		lay.put( l2, P.right, -3.7 )
		lay.put( cpuCount, P.left, -8.0, 1.25 )
		lay.put( cpuLabel, P.left + 0.05, -9.5 )
		lay.put( live, P.left, -13.2, 1.25 )
		lay.put( liveLabel, P.left + 0.05, -14.7 )
		lay.on( ( p ) => {
			head.portrait( p )
			barK = p ? ( P.right - P.left ) / BAR : 1
			// keep the hatch's ink-to-gap ratio when the poster shrinks
			hatch.lineWidth( p ? 0.04 * PS : 0.04 )
			markW = p ? 0.075 * PS : 0.075
			mark.lineWidth( markW * lastLive )
		} )

		//------------------------------------------------ live edit
		let active = null // { run, start }
		const rangeOpts = { lineIndex: 0 }
		const restore = () => {
			if ( !active ) return
			rangeOpts.lineIndex = active.run
			hatch.setPositionRange( base[active.run].subarray( active.start * 3, ( active.start + EDIT ) * 3 ), active.start, rangeOpts )
			active = null
		}
		// every attribute with an array (cached once: no Object.values per frame)
		const uploadAttrs = []
		for ( const name in hatch.geometry.attributes ) {
			const attr = hatch.geometry.attributes[name]
			if ( attr.array && attr.updateRanges ) uploadAttrs.push( attr )
		}
		const measure = () => {
			let total = 0
			for ( let a = 0; a < uploadAttrs.length; a++ ) {
				const attr = uploadAttrs[a]
				const ranges = attr.updateRanges
				for ( let r = 0; r < ranges.length; r++ ) total += ranges[r].count * attr.array.BYTES_PER_ELEMENT
			}
			return total
		}
		let lastBytes = 0
		let markW = 0.075
		let lastLive = 1
		const target = { x: 9, y: 0 }
		const statFades = [l1, l2, b1, b2, uploadLabel, cpuStat, liveLabel]
		let lastDrawStart = -1
		let lastDrawEnd = -1
		let lastCpu = -1
		let lastDim = -1

		return {
			group,
			layout: lay.apply,
			update( s ) {
				const { b, h, dim } = phases( s )
				// plotter draw-on: reveal the index buffer in path order; hand-off un-draws from the start
				const show = smoothstep( 0.05, 0.85, b )
				const hide = smoothstep( 0.05, 0.9, h )
				const start = Math.floor( ( hide * indexCount ) / 3 ) * 3
				const end = Math.floor( ( show * indexCount ) / 3 ) * 3
				if ( start !== lastDrawStart || end !== lastDrawEnd ) {
					lastDrawStart = start
					lastDrawEnd = end
					hatch.geometry.setDrawRange( start, Math.max( 0, end - start ) )
				}
				if ( dim !== lastDim ) {
					lastDim = dim
					dimLine( hatch, C.bone, dim )
					dimLine( v1Bar, C.grey, dim )
				}
				hatch.visible = end - start > 0

				face.fade( smoothstep( 0.05, 0.4, b ) * ( 1 - smoothstep( 0.2, 0.8, h ) ) * 0.9 * dim )
				face.reveal( smoothstep( 0.1, 0.85, b ) )
				// '350×+' counts up with the build (scrambles only while it is counting)
				const k = smoothstep( 0.45, 0.95, b )
				const cpuValue = Math.round( cpu.nums[0] * ( 1 - ( 1 - k ) ** 3 ) )
				const counting = k > 0 && k < 0.99
				if ( counting || cpuValue !== lastCpu ) {
					lastCpu = cpuValue
					cpuCount.setValue( cpuValue, { scramble: counting ? 0.3 : 0 } )
				}

				v1Bar.scale.x = barK * Math.max( 1e-3, smoothstep( 0.3, 0.8, b ) * ( 1 - h ) )
				v2Bar.scale.x = barK * Math.max( 1e-3, smoothstep( 0.6, 0.9, b ) * ( 1 - h ) )
				v1Bar.visible = v2Bar.visible = b > 0.3 && h < 0.99
				const tIn = smoothstep( 0.45, 0.95, b ) * ( 1 - smoothstep( 0, 0.5, h ) ) * dim
				for ( let i = 0; i < statFades.length; i++ ) statFades[i].fade( tIn )
				cpuStat.reveal( smoothstep( 0.5, 1, b ) )
				live.fade( tIn )
				head.fade( smoothstep( 0.2, 0.7, b ) * ( 1 - smoothstep( 0, 0.4, h ) ) * dim )
				head.reveal( smoothstep( 0.2, 0.8, b ) )

				// HOLD: one 128-point setPositionRange per frame under the cursor. The edit fades in and out
				// with the hold (wave amplitude and the red mark's width follow liveK): nothing pops
				const liveK = smoothstep( 0.9, 1, s.focus ) * ( 1 - s.wall )
				const holding = liveK > 0.002
				mark.visible = holding
				if ( !holding ) {
					restore()
					return
				}
				const lw = Math.round( liveK * 100 ) / 100
				if ( lw !== lastLive ) {
					lastLive = lw
					mark.lineWidth( markW * lw )
				}
				const px = ( ctx.pointer.world.x - ctx.X - poster.position.x ) / poster.scale.x
				const py = ( ctx.pointer.world.y - poster.position.y ) / poster.scale.y
				const inPoster = Math.abs( px ) < 15 && Math.abs( py ) < 7
				target.x = damp( target.x, inPoster ? px : 9.2 + Math.sin( s.t * 0.7 ) * 1.6, 13, s.dt )
				target.y = damp( target.y, inPoster ? py : Math.cos( s.t * 0.9 ) * 1.8, 13, s.dt )
				const hit = findNearest( target.x, target.y )
				const n = lines[hit.run].length / 3
				const startPt = clamp( hit.index - EDIT / 2, 1, n - EDIT - 2 ) | 0
				if ( active && ( active.run !== hit.run || Math.abs( active.start - startPt ) > 24 ) ) {
					// moving to another stretch: this frame uploads only the restore (one 128-point range)
					restore()
					const bytesNow = measure()
					if ( bytesNow > 0 ) lastBytes = bytesNow
					live.setValue( lastBytes )
					return
				}
				if ( !active ) active = { run: hit.run, start: startPt }
				const src = base[active.run]
				for ( let i = 0; i < EDIT; i++ ) {
					const o = ( active.start + i ) * 3
					const env = Math.sin( ( Math.PI * i ) / ( EDIT - 1 ) ) ** 2
					const dy = Math.sin( i * 0.32 - s.t * 10 ) * 0.2 * env * liveK
					edit[i * 3] = src[o]
					edit[i * 3 + 1] = src[o + 1] + dy
					edit[i * 3 + 2] = src[o + 2]
					markPts[i * 3] = src[o]
					markPts[i * 3 + 1] = src[o + 1] + dy
					markPts[i * 3 + 2] = 0.05
				}
				rangeOpts.lineIndex = active.run
				hatch.setPositionRange( edit, active.start, rangeOpts )
				mark.setPositions( markPts )
				const bytesNow = measure()
				if ( bytesNow > 0 ) lastBytes = bytesNow
				live.setValue( lastBytes )
			},
		}
	},
}
