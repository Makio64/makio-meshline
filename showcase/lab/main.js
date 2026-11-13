/**
 * Scroll Lab: a 5-page bench for the shared core (scroll.js, rig.js, preload.js, perf.js).
 * Native scroll + dwell plateaus, one keyframed camera rig (waypoint + orbit-as-arc), everything
 * built behind the loader and warmed, pages shown by presence. `?perf` HUD, `?webgl`, `#3` deep links.
 * window.__lab and window.__probe expose everything for automated checks.
 */
import '../shared/base.css'

import { clamp } from '@shared/math.js'
import { num } from '@shared/numbers.js'
import { createPerf } from '@shared/perf.js'
import { createPreloader } from '@shared/preload.js'
import { createRig } from '@shared/rig.js'
import { decodeRings, encodeRings, loadRings } from '@shared/rings.js'
import { createScroll } from '@shared/scroll.js'
import { createStage } from '@shared/stage.js'
import { createRingStack, loadStatueRings } from '@shared/statues.js'
import { createCounter, createText, loadFonts } from '@shared/text.js'
import { circlePositions, MeshLine, sineWavePositions } from 'makio-meshline'
import { Fn, smoothstep, uniform } from 'three/tsl'
import { Group, REVISION } from 'three/webgpu'

const BG = 0x05060a
const LABELS = ['Lab', 'Lines', 'Upload', 'Statue', 'Orbit']
const C = [80, 0.5, -40] // statue centre (page 3 / 4 orbit)

//------------------------------------------------------------------ STAGE, SCROLL (first: its tick runs before ours), PERF
const stage = await createStage( {
	background: BG,
	fog: { near: 22, far: 80 },
	bloom: { strength: 0.55, radius: 0.4, threshold: 0 },
	post: { grain: 0.03, vignette: 0.5 },
} )
const { scene, renderer, camera } = stage
const scroll = createScroll( { count: LABELS.length, stage, labels: LABELS } )
const perf = createPerf( stage, { scroll } )

const status = document.createElement( 'div' )
status.className = 'ui-corner tl'
status.innerHTML = `lab · ${stage.backend} · r${REVISION} · <a href="./">hub</a>`
document.body.append( status )

const a11y = [
	'Scroll Lab. A test bench for the showcase scroll and camera.',
	'Lines drawn on as you arrive.',
	`${num( 'upload773' ).value} ${num( 'upload773' ).label}.`,
	'A statue drawn with contour rings, David becoming Venus.',
	'The camera orbits the statue, driven by scroll.',
]
scroll.sections.forEach( ( s, i ) => {
	const p = document.createElement( 'p' )
	p.className = 'sr-only'
	p.textContent = a11y[i]
	s.append( p )
} )

//------------------------------------------------------------------ PAGES (built inside the loader steps)
const pages = LABELS.map( ( name ) => {
	const g = new Group()
	g.name = `page:${name}`
	scene.add( g )
	return g
} )
const statueGroup = new Group()
statueGroup.name = 'statue'
scene.add( statueGroup )

const u = {
	lines: uniform( 0 ),
	knot: uniform( 1 ),
	halo: uniform( 0 ),
}
let knot = null
let title = null
let counter = null
let caption = null
let stack = null
const halos = []
const rings = {}

function buildLines() {
	// page 0: trefoil knot
	const pts = new Float32Array( 480 * 3 )
	for ( let i = 0; i < 480; i++ ) {
		const t = ( i / 480 ) * Math.PI * 2
		pts[i * 3] = ( Math.sin( t ) + 2 * Math.sin( 2 * t ) ) * 1.3
		pts[i * 3 + 1] = ( Math.cos( t ) - 2 * Math.cos( 2 * t ) ) * 1.3
		pts[i * 3 + 2] = -Math.sin( 3 * t ) * 1.3
	}
	knot = new MeshLine()
		.lines( pts, true )
		.lineWidth( 0.2 )
		.color( 0x22d3ee )
		.gradientColor( 0xff3df0 )
		.join( { type: 'round' } )
		.transparent( true )
		.opacityFn( Fn( ( [alpha] ) => alpha.mul( u.knot ) ) )
		.autoResize()
	knot.position.set( 0, 0.9, 0 )
	pages[0].add( knot )

	// page 1: a fan of sine waves drawn on by scroll (one uniform, no CPU rewrites)
	for ( let i = 0; i < 14; i++ ) {
		const k = i / 13
		const line = new MeshLine()
			.lines( sineWavePositions( 3 + k * 2, 160, 0.4 + 0.9 * Math.sin( k * Math.PI ), 16 ) )
			.lineWidth( 0.05 + 0.04 * Math.sin( k * Math.PI ) )
			.color( 0xece9e2 )
			.gradientColor( i % 2 ? 0x22d3ee : 0xff6a3d )
			.transparent( true )
			.opacityFn( Fn( ( [alpha, progress] ) => alpha.mul( smoothstep( u.lines.sub( 0.04 ), u.lines, progress ).oneMinus() ) ) )
			.autoResize()
		line.position.set( 32, ( k - 0.5 ) * 7, -k * 4 )
		pages[1].add( line )
	}

	// page 4: halo circles around the statue (object rotation only, the camera never spins by time)
	for ( let i = 0; i < 5; i++ ) {
		const r = 7 + i * 1.3
		const line = new MeshLine()
			.lines( circlePositions( 160, r ), true )
			.lineWidth( 0.04 )
			.color( i % 2 ? 0xffd2a8 : 0xff3df0 )
			.transparent( true )
			.opacityFn( Fn( ( [alpha] ) => alpha.mul( u.halo ).mul( 0.85 ) ) )
			.autoResize()
		line.rotation.x = Math.PI / 2 + ( i - 2 ) * 0.12
		line.position.set( C[0], C[1] - 3 + i * 1.6, C[2] )
		pages[4].add( line )
		halos.push( line )
	}
}

async function buildText() {
	title = await createText( renderer, 'Scroll Lab', { fontFamily: 'Inter', fontWeight: 800, letterSpacing: '-0.04em' }, { size: 1.5, glow: 1.15, backdrop: BG } )
	title.position.set( 0, -4.4, 0 )
	pages[0].add( title )
	const upload = num( 'upload773' )
	counter = await createCounter( renderer, { template: '000×', css: { fontFamily: 'Inter', fontWeight: 800, letterSpacing: '-0.05em' }, size: 4.2, glow: 1.5, backdrop: BG } )
	counter.position.set( 62, 0.9, -6 )
	counter.setValue( 0 )
	pages[2].add( counter )
	caption = await createText( renderer, upload.label, { fontFamily: 'JetBrains Mono', fontWeight: 400, color: '#9aa0a6' }, { size: 0.3, backdrop: BG } )
	caption.position.set( 62, -2.2, -6 )
	pages[2].add( caption )
}

function buildStatue() {
	stack = createRingStack( [rings.david, rings.venus], { lineWidth: 0.035, intensity: 1.25 } )
	stack.line.position.set( C[0], C[1], C[2] )
	statueGroup.add( stack.line )
}

//------------------------------------------------------------------ RIG
const arc = ( deg, y ) => {
	const a = ( deg * Math.PI ) / 180
	return [C[0] + Math.sin( a ) * 20, y, C[2] + Math.cos( a ) * 20]
}
const rig = createRig( camera, {
	scroll,
	stage,
	parallax: { amount: 0.012, damping: 3.5 },
	keys: [
		{ at: 0, pos: [0, 0.6, 17], target: [0, -0.4, 0], hold: [0.8, 0.2, 0], fit: [11, 11] },
		{ at: 1, pos: [27, 4, 15], target: [32, 0, -2], hold: { pos: [0, 0.4, -0.8], target: [0.4, 0, 0] }, fit: [12, 10] },
		{ at: 1.5, pos: [45, 6, 16], target: [47, 0.2, -4] }, // waypoint: swing high between pages
		{ at: 2, pos: [62, 1.2, 9], target: [62, 0.2, -6], fov: 44, hold: [0.7, 0, 0], fit: [10, 7] },
		{ at: 3, pos: arc( -60, 1.5 ), target: [C[0] - 3, 0.5, C[2] + 2], hold: { pos: [0.8, 0.3, 0] }, fit: [10, 12] },
		{ at: 3.33, pos: arc( -95, 2.6 ), target: [C[0] - 1.2, 0.8, C[2] + 0.6] }, // orbit = progress-driven arc keys
		{ at: 3.67, pos: arc( -130, 3.6 ), target: [C[0], 1.1, C[2]] },
		{ at: 4, pos: arc( -160, 4.2 ), target: [C[0] + 0.5, 1.5, C[2] - 0.5], hold: { pos: [0, 0.5, 0] }, fit: [16, 16] },
	],
} )

//------------------------------------------------------------------ LOADER
const pre = createPreloader( stage, {
	title: 'scroll lab',
	steps: [
		{ label: 'fonts', weight: 1, run: () => loadFonts( ['800 1em Inter', '400 1em "JetBrains Mono"'] ) },
		{ label: 'statues', weight: 1, run: async () => Object.assign( rings, { david: await loadRings( 'david' ), venus: await loadRings( 'venus' ) } ) },
		{ label: 'lines', weight: 1, run: buildLines },
		{ label: 'type', weight: 3, run: buildText },
		{ label: 'statue', weight: 1, run: buildStatue },
	],
	warm: () => [...pages, statueGroup],
} )

//------------------------------------------------------------------ VISIBILITY BY PRESENCE
pages.forEach( ( g, i ) => scroll.bind( i, g ) )
scroll.bind( [3, 4], statueGroup )

//------------------------------------------------------------------ FRAME
let lastCount = -1
stage.onFrame( ( dt, t ) => {
	rig.update( scroll.progress, dt, stage.pointer )

	if ( knot && pages[0].visible ) {
		knot.rotation.y = t * 0.22
		u.knot.value = 0.35 + 0.65 * scroll.presence( 0 )
		title.opacity.value = scroll.presence( 0 )
	}
	if ( pages[1].visible ) u.lines.value = clamp( scroll.local( 1 ) + 1, 0, 1 ) * 1.05
	if ( counter && pages[2].visible ) {
		const k = clamp( scroll.local( 2 ) + 1, 0, 1 )
		const eased = 1 - Math.pow( 1 - k, 3 )
		const v = Math.round( num( 'upload773' ).nums[0] * eased )
		if ( v !== lastCount ) {
			lastCount = v
			counter.setValue( v )
		}
		caption.reveal.value = k
	}
	if ( stack && statueGroup.visible ) {
		stack.reveal.value = clamp( scroll.local( 3 ) + 1, 0, 1 )
		stack.morph.value = clamp( scroll.local( 3 ), 0, 1 )
		stack.line.rotation.y = t * 0.12
	}
	if ( pages[4].visible ) {
		u.halo.value = scroll.presence( 4 )
		for ( let i = 0; i < halos.length; i++ ) halos[i].rotation.z = t * ( 0.05 + i * 0.02 ) * ( i % 2 ? -1 : 1 )
	}
	stage.setBloom( 0.5 + 0.35 * scroll.presence( 3 ) + 0.2 * scroll.presence( 4 ) )
} )

const report = await pre.done
console.info( '[lab] loader', report )

/** Bake helper for shared/rings/*.bin (dev only): base64 of the encoded ring file. */
async function bakeRings( name ) {
	const data = await loadStatueRings( name )
	const bytes = new Uint8Array( encodeRings( data ) )
	let bin = ''
	for ( let i = 0; i < bytes.length; i += 0x8000 ) bin += String.fromCharCode( ...bytes.subarray( i, i + 0x8000 ) )
	return btoa( bin )
}

window.__lab = { stage, scroll, rig, perf, pre, report, pages, statueGroup, bakeRings, decodeRings, ready: true }
