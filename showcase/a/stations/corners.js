/**
 * 03 · Every Corner — the spine kinks into a zigzag corridor drawn three times:
 * join miter / bevel / round (three prebuilt lines, draw-on by widthFn collapse), with sharp
 * ~70° corners so the three joins read at a glance. Shading is a fake studio chrome on the
 * flat ribbon: lineCoord.y (the cross-stroke coordinate) maps to a reflected horizon, a hot
 * specular streak and a tinted sky, so a flat billboard reads as a polished tube.
 * Beside it: a chrome trefoil knot (fold 'geometry', the default) with a red echo drawn with
 * fold:false — the old miter spikes flash out where the knot folds toward the camera.
 */
import { clamp, easeOutCubic, remap } from '@shared/math.js'
import { lineCoord, MeshLine } from 'makio-meshline'
import { abs, float, Fn, mix, pow, sin, smoothstep, sqrt, uniform, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, Group } from 'three/webgpu'

import { monument, num, text } from '../type.js'

const ZIG_POINTS = 8
const ZIG_X0 = -10
const ZIG_X1 = 5.4
const ZIG_AMP = 1.45
const ROWS_N = [3.9, 0, -3.9]
const KNOT_DESK = [10.4, -0.9]
const KNOT_PORT = [-2.3, -10]

// studio chrome on a flat stroke (fragment hook: lineCoord.y must be interpolated per fragment,
// a colorFn would evaluate it per vertex where it is only ever ±1): y is read as the tube normal.
// A glint travels along the stroke (progress) so the metal feels lit by a moving studio light.
const uTime = uniform( 0 )
const chromeFn = ( tint, gain ) => Fn( ( [c, , progress] ) => {
	const y = lineCoord.y.clamp( -1, 1 )
	const nz = sqrt( float( 1 ).sub( y.mul( y ) ).max( 0 ) )
	// reflected environment: dark floor below a sharp horizon, bright sky fading into the tint
	const floor = mix( vec3( 0.01, 0.01, 0.014 ), vec3( 0.12, 0.11, 0.1 ), smoothstep( -0.55, -0.98, y ) )
	const sky = mix( vec3( 0.95, 0.97, 1.0 ), tint, smoothstep( 0.2, 0.92, y ) )
	const env = mix( floor, sky, smoothstep( -0.24, -0.14, y ) )
	// hot specular streak just above the horizon + fresnel-ish rim
	const streak = smoothstep( 0.1, 0.0, abs( y.sub( 0.22 ) ) ).mul( 1.1 )
	const rim = pow( float( 1 ).sub( nz ), 3 ).mul( 0.6 )
	const glint = smoothstep( 0.96, 1.0, sin( progress.mul( Math.PI * 3 ).sub( uTime.mul( 1.4 ) ) ) ).mul( 1.6 )
	const shade = env.mul( nz.mul( 0.55 ).add( 0.45 ) ).add( vec3( streak ) ).add( tint.mul( rim ) ).add( vec3( glint.mul( nz ) ) )
	return vec4( shade.mul( gain ).mul( c.r ), 1 )
} )

const drawOnFn = ( draw ) => Fn( ( [w, progress] ) => w.mul( float( 1 ).sub( smoothstep( draw.sub( 0.03 ), draw, progress ) ) ) )

export default async function build( st, ctx ) {
	const { renderer } = ctx
	st.preset = { pos: [0, 1.0, 21], look: [0, 0.6, 0] }
	st.portrait = { pull: 2.05, shift: [-2.3, -2.4] }
	st.fog = [24, 60]
	st.bloom = 0.24
	st.rideIn = st.anchorS - st.half - 4
	st.rideOut = st.anchorS + st.half + 2
	st.hide = [( st.anchorS - st.half - 1 ) / ctx.spine.length, ( st.anchorS + st.half + 1 ) / ctx.spine.length]

	const rows = [
		{ type: 'miter', tint: 0x22d3ee },
		{ type: 'bevel', tint: 0xff4fa3 },
		{ type: 'round', tint: 0xf5c87a },
	]
	const lines = []
	rows.forEach( ( row, r ) => {
		const n = ROWS_N[r]
		const pts = new Float32Array( ZIG_POINTS * 3 )
		for ( let i = 0; i < ZIG_POINTS; i++ ) {
			const x = ZIG_X0 + ( ( ZIG_X1 - ZIG_X0 ) * i ) / ( ZIG_POINTS - 1 )
			const y = n + ( i % 2 === 0 ? -ZIG_AMP : ZIG_AMP )
			st.local( x, y, 0 ).toArray( pts, i * 3 )
		}
		const draw = uniform( 0 )
		const tint = uniform( new Color( row.tint ) )
		const line = new MeshLine()
			.lines( pts, false )
			.lineWidth( 0.74 )
			.join( { type: row.type, limit: 4, segments: 10 } )
			.widthFn( drawOnFn( draw ) )
			.fragmentColorFn( chromeFn( tint, float( 0.95 ) ) )
			.build()
		st.group.add( line )
		lines.push( { line, draw, row, n } )
	} )

	//------------------------------------------------------------------ chrome trefoil knot + fold:false echo
	const KNOT = 420
	const knotPts = new Float32Array( KNOT * 3 )
	for ( let i = 0; i < KNOT; i++ ) {
		const t = ( i / KNOT ) * Math.PI * 2
		knotPts[i * 3] = ( Math.sin( t ) + 2 * Math.sin( 2 * t ) ) * 1.15
		knotPts[i * 3 + 1] = ( Math.cos( t ) - 2 * Math.cos( 2 * t ) ) * 1.15
		knotPts[i * 3 + 2] = -Math.sin( 3 * t ) * 1.6
	}
	// the echo is sampled coarser: v1.2.3-style miters on a 3D fold spike past the stroke
	const ECHO = 96
	const echoPts = new Float32Array( ECHO * 3 )
	for ( let i = 0; i < ECHO; i++ ) {
		const t = ( i / ECHO ) * Math.PI * 2
		echoPts[i * 3] = ( Math.sin( t ) + 2 * Math.sin( 2 * t ) ) * 1.15
		echoPts[i * 3 + 1] = ( Math.cos( t ) - 2 * Math.cos( 2 * t ) ) * 1.15
		echoPts[i * 3 + 2] = -Math.sin( 3 * t ) * 1.6
	}
	const knotGroup = new Group()
	knotGroup.scale.setScalar( 1.0 )
	const knot = new MeshLine()
		.lines( knotPts, true )
		.lineWidth( 0.55 )
		.fragmentColorFn( chromeFn( uniform( new Color( 0x7dd3fc ) ), float( 0.95 ) ) )
		.build()
	const echo = new MeshLine()
		.lines( echoPts, true )
		.lineWidth( 0.55 )
		.join( { type: 'miter', fold: false, limit: 12 } )
		.color( new Color( 0xff2a3d ).multiplyScalar( 1.1 ) )
		.transparent( true )
		.opacity( 0.5 )
		.build()
	echo.material.blending = AdditiveBlending
	echo.material.depthWrite = false
	echo.renderOrder = 2
	const spin = new Group()
	spin.add( echo, knot )
	knotGroup.add( spin )
	st.group.add( knotGroup )

	//------------------------------------------------------------------ type (desktop: view-plane units at depth 19.5; portrait: normalized)
	const D = 19.5
	const joins = st.hud( await monument( renderer, num( 'joins' ).value, 'join types', { size: 1.9, captionSize: 0.21 } ), [-10.6, 6.1], [-0.52, 0.6, 0.56], D )
	const fold = st.hud( await monument( renderer, num( 'fold' ).value, 'fold overshoot · documented', { size: 0.95, captionSize: 0.21, align: 'right' } ), [13.6, 6.3], [0.92, 0.79, 0.72], D )
	const notch = st.hud( await monument( renderer, num( 'notched' ).value, 'notched px · documented', { size: 0.8, captionSize: 0.21, align: 'right' } ), [13.6, 4.0], [0.92, 0.6, 0.76], D )
	const disc = st.hud( await monument( renderer, num( 'discards' ).value, 'discards · default line', { size: 0.8, captionSize: 0.21, align: 'right' } ), [13.6, -6.1], [0.92, -0.6, 0.76], D )
	const line = st.hud( await text( renderer, 'Miter. Bevel. Round. No spikes.', { kind: 'line', size: 0.46 } ), [-2.3, -7.5], [0, -0.8, 0.82], D )
	// row labels stay in the world next to their row
	const labels = []
	for ( const row of lines ) {
		const lb = await text( renderer, row.row.type, { kind: 'caps', size: 0.24, align: 'right' } )
		st.group.add( lb )
		labels.push( lb )
	}

	st.onLayout = ( portrait ) => {
		const [kt, kn] = portrait ? KNOT_PORT : KNOT_DESK
		st.local( kt, kn, 0, knotGroup.position )
		st.orient( knotGroup )
		labels.forEach( ( lb, i ) => {
			const n = lines[i].n
			if ( portrait ) st.local( ZIG_X0 + lb.width * 1.9 - 0.3, n + ZIG_AMP + 0.95, 0.4, lb.position )
			else st.local( ZIG_X0 - 0.9, n, 0.4, lb.position )
			lb.scale.setScalar( portrait ? 1.9 : 1 )
			st.orient( lb )
		} )
	}

	const type = [joins, fold, notch, disc, line, ...labels] // fossil toggles (no per-frame arrays)
	let time = 0
	st.update = ( { t, dt } ) => {
		time += dt
		uTime.value = time
		const here = clamp( 1 - Math.abs( t ) * 1.6, 0, 1 )
		const k = clamp( remap( t, -0.7, 0, 0, 1 ), 0, 1 )
		for ( let i = 0; i < lines.length; i++ ) {
			const on = easeOutCubic( clamp( remap( t, -0.75 + i * 0.12, -0.15 + i * 0.05, 0, 1 ), 0, 1 ) )
			lines[i].draw.value = on * 1.04 * ( t > 0.6 ? clamp( ( 1 - t ) / 0.4, 0, 1 ) : 1 )
		}
		spin.rotation.y = time * 0.35
		spin.rotation.x = Math.sin( time * 0.21 ) * 0.6
		joins.setPresence( here, k )
		fold.setPresence( here, k )
		notch.setPresence( here * 0.85, k )
		disc.setPresence( here * 0.85, k )
		for ( const l of labels ) { l.opacity.value = here * 0.9; l.reveal.value = k }
		line.opacity.value = here * 0.9
		line.reveal.value = k
	}

	st.hasFossil = true
	st.fossil = ( kf ) => {
		if ( st.resident ) { knotGroup.visible = true; return }
		knotGroup.visible = false
		for ( const l of lines ) l.draw.value = kf * 1.04
		for ( const o of type ) o.visible = false
	}
	st.onResident = ( on ) => {
		if ( on ) for ( const o of type ) o.visible = true
	}
}
