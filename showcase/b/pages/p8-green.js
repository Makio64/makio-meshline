/**
 * 08 · All Green — '366' made of 366 instanced 3-point MeshLine check marks
 * inside the glyph mask; scrolling ticks them grey -> red on the GPU (one
 * uniform, packed instance attribute, one draw). Then the camera pulls back
 * and swings round over two stops (the strip, the wall) to every poster along
 * one red spine; click a poster to fly back.
 */
import { clamp, smoothstep } from '@shared/math.js'
import { num } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import { attribute, clamp as tClamp, Fn, mix, step, uniform, vec3, vec4 } from 'three/tsl'
import { Color, Group } from 'three/webgpu'

import { layoutText, mulberry32, signedDistance } from '../lib/glyph.js'
import { header, LEFT, P, phases, placer } from '../lib/page.js'
import { C, CSS, getMonoScale, mono, stat } from '../lib/type.js'

const CHECK = [[-0.42, 0.04], [-0.12, -0.3], [0.46, 0.38]]

/** Exactly `count` cell centres inside the glyph (grid spacing found by bisection). */
function cellsInside( L, count ) {
	const sd = signedDistance( L )
	const sdAt = ( x, y ) => {
		const px = Math.round( L.px( x ) )
		const py = Math.round( L.py( y ) )
		if ( px < 0 || py < 0 || px >= L.w || py >= L.h ) return 1e9
		return sd[py * L.w + px] * L.k
	}
	const scan = ( sp, out = null ) => {
		let n = 0
		for ( let y = L.ink.bottom + sp * 0.5; y < L.ink.top; y += sp ) {
			for ( let x = L.ink.left + sp * 0.5; x < L.ink.right; x += sp ) {
				const d = sdAt( x, y )
				if ( d < -sp * 0.22 ) {
					n++
					out?.push( [x, y, d] )
				}
			}
		}
		return n
	}
	// bisection on the count alone (no arrays), then one collect at the spacing found
	let lo = 0.1
	let hi = 3
	for ( let i = 0; i < 40; i++ ) {
		const mid = ( lo + hi ) / 2
		if ( scan( mid ) >= count ) lo = mid
		else hi = mid
	}
	const best = { sp: lo, c: [] }
	scan( lo, best.c )
	// drop the cells nearest the edge until exactly `count`
	const cells = best.c.sort( ( a, b ) => a[2] - b[2] ).slice( 0, count )
	return { sp: best.sp, cells: cells.sort( ( a, b ) => a[0] - b[0] || b[1] - a[1] ) }
}

export default {
	title: 'All Green',
	subs: 3,
	labels: ['366 checks', 'the strip', 'the wall'],
	async build( ctx ) {
		const group = new Group()
		const tests = num( 'tests366' )
		const N = tests.nums[1]

		//------------------------------------------------ 366 checks inside '366'
		const L = layoutText( String( N ), { size: 14.2, fontPx: 300, pad: 16 } )
		const { sp, cells } = cellsInside( L, N )
		const rnd = mulberry32( 366 )
		const cellData = new Float32Array( N * 4 )
		cells.forEach( ( [x, y], i ) => cellData.set( [x, y, i / N, rnd()], i * 4 ) )
		const checkPts = new Float32Array( CHECK.flatMap( ( [x, y] ) => [x * sp * 0.82, y * sp * 0.82, 0] ) )

		const uTick = uniform( 0 )
		const grey = new Color( 0x5a5955 )
		const red = new Color( C.red )
		const tickOf = Fn( () => {
			const c = attribute( 'cell', 'vec4' )
			return tClamp( uTick.sub( c.z ).mul( 26 ), 0, 1 )
		} )
		const checks = new MeshLine()
			.lines( checkPts, false )
			.instances( N )
			.lineWidth( sp * 0.17 )
			.color( 0xffffff )
			.join( { type: 'round', segments: 6 } )
			.positionFn( Fn( ( [p] ) => {
				const c = attribute( 'cell', 'vec4' )
				const k = tickOf()
				const s = k.mul( 0.4 ).add( 0.6 ).add( k.mul( k.oneMinus() ).mul( 1.4 ) )
				return vec3( p.x.mul( s ).add( c.x ), p.y.mul( s ).add( c.y ), p.z )
			} ) )
			.colorFn( Fn( () => {
				const k = tickOf()
				return vec4( mix( vec3( grey.r, grey.g, grey.b ), vec3( red.r, red.g, red.b ), step( 0.5, k ) ), 1 )
			} ) )
			.autoResize()
		checks.build()
		checks.addInstanceAttributes( { cell: 4 } )
		checks.setInstanceValues( 'cell', cellData )
		checks.frustumCulled = false
		const poster = new Group()
		poster.position.set( -4.6, 1.6, 0 )
		poster.add( checks )
		group.add( poster )

		//------------------------------------------------ numbers + CTA
		const sTests = await stat( tests.value, 'automated tests', { size: 1.5 } )
		sTests.position.set( LEFT, -7.0, 0 )
		const sDemos = await stat( num( 'demos' ).value, 'demos', { size: 1.5 } )
		sDemos.position.set( -7.6, -7.0, 0 )
		const sEntries = await stat( num( 'joins' ).value, 'package entry points', { size: 1.5 } )
		sEntries.position.set( 1.4, -7.0, 0 )
		const sThree = await stat( num( 'threeReleases' ).value, 'three.js releases in CI', { size: 1.5, color: CSS.red } )
		sThree.position.set( 10.2, -7.0, 0 )
		const cta = await mono( 'pnpm add makio-meshline', { size: 0.46, color: CSS.bone, upper: false } )
		cta.position.set( 10.2, 4.5, 0 ) // clear of the last '6'
		const ctaRule = new MeshLine().lines( new Float32Array( [0, 0, 0, 7.6, 0, 0] ), false ).lineWidth( 0.06 ).color( C.red )
		ctaRule.position.set( 10.2, 3.9, 0 )
		group.add( sTests, sDemos, sEntries, sThree, cta, ctaRule )

		const head = await header( 8, 'All Green', 'All green.' )
		group.add( head )

		//------------------------------------------------ the wall: red spine through every poster (in page-local space)
		const count = ctx.SPACING * 7
		const SPINE = 420
		const spinePts = new Float32Array( SPINE * 3 )
		for ( let i = 0; i < SPINE; i++ ) {
			const t = i / ( SPINE - 1 )
			const x = -count - 14 + t * ( count + 28 )
			spinePts.set( [x, -13.2 + Math.sin( t * Math.PI * 7 ) * 0.9, 0], i * 3 )
		}
		const uSpine = uniform( 0 )
		const spine = new MeshLine()
			.lines( spinePts, false )
			.lineWidth( 0.5 )
			.color( C.red )
			.widthFn( Fn( ( [w, progress] ) => w.mul( step( progress, uSpine ) ) ) )
			.autoResize()
		spine.frustumCulled = false
		group.add( spine )
		const wallHint = await mono( 'click a poster to return', { size: 1.1, color: CSS.dim, align: 'center', upper: false } )
		wallHint.position.set( -ctx.SPACING * 0.6, -17.2, 0 ) // near the front of the wall, under the spine
		group.add( wallHint )

		//------------------------------------------------ portrait re-stack
		const PS = 0.76
		let ruleK = 1 // the CTA rule tracks the (portrait-scaled) mono CTA
		const lay = placer()
		lay.put( poster, 0, 9.4, PS )
		lay.put( sTests, P.left, -3.8 )
		lay.put( sDemos, 1.6, -3.8 )
		lay.put( sEntries, P.left, -8.8 )
		lay.put( sThree, 1.6, -8.8 )
		lay.put( cta, P.left, -14.2 )
		lay.put( ctaRule, P.left, -15.0 )
		lay.on( ( p ) => {
			head.portrait( p )
			checks.lineWidth( sp * 0.17 * ( p ? PS : 1 ) )
			ruleK = getMonoScale()
			// the wall spine runs under the taller portrait posters
			spine.position.y = p ? -9.6 : 0
			wallHint.position.y = p ? -26.8 : -17.2
		} )

		const stats = [sTests, sDemos, sEntries, sThree]
		return {
			group,
			layout: lay.apply,
			update( s ) {
				s.isLast = true
				const { b } = phases( s )
				const wallK = smoothstep( 0, 1, clamp( s.sub ) )
				uTick.value = smoothstep( 0.25, 1, b ) * 1.05
				checks.visible = b > 0.01
				const tIn = smoothstep( 0.35, 0.95, b )
				for ( let i = 0; i < stats.length; i++ ) {
					stats[i].fade( tIn )
					stats[i].reveal( smoothstep( 0.55, 1, b ) )
				}
				cta.fade( tIn )
				cta.reveal( smoothstep( 0.6, 1, b ) )
				ctaRule.scale.x = ruleK * Math.max( 1e-3, smoothstep( 0.7, 1, b ) )
				head.fade( smoothstep( 0.2, 0.7, b ) )
				head.reveal( smoothstep( 0.2, 0.8, b ) )
				uSpine.value = smoothstep( 0.2, 1, wallK )
				spine.visible = wallK > 0.01
				wallHint.fade( smoothstep( 0.7, 1, wallK ) )
			},
		}
	},
}
