/**
 * Plan A · One Line.
 * One continuous camera flight along a spine that IS a MeshLine (the thread is the progress
 * bar). Eight stations; the statue station spans three scroll steps (David → Venus → Nefertiti)
 * so the signature wave is scroll-driven.
 *
 * Core v2 (shared/SCROLL.md): native document scroll → damped progress → dwell plateaus
 * (scroll.js), one keyframed camera rig (rig.js, keys from journey.js), everything built behind
 * the MeshLine loader and warmed (preload.js), stations shown by presence (never rebuilt), DPR
 * budget + window.__probe (perf.js). Every visual is a function of the dwell-mapped progress;
 * time only drives ambient life (tunnel drift, glints, the ghost camera, the nebula).
 */
import '../shared/base.css'

import { clamp, lerp } from '@shared/math.js'
import { createPerf } from '@shared/perf.js'
import { createPreloader } from '@shared/preload.js'
import { createRig } from '@shared/rig.js'
import { createScroll, dwellMap } from '@shared/scroll.js'
import { createStage, prefersReducedMotion, query } from '@shared/stage.js'
import { loadFonts, prepareText, textIdle } from '@shared/text.js'
import { REVISION } from 'three/webgpu'

import { buildKeys, pathReport, simulatePass } from './journey.js'
import { createSpine, createThread } from './spine.js'
import { baseStation } from './station.js'
import buildCorners from './stations/corners.js'
import buildCulling from './stations/culling.js'
import buildEdit from './stations/edit.js'
import buildEnter from './stations/enter.js'
import buildFinale from './stations/finale.js'
import buildGpuPath from './stations/gpupath.js'
import buildRibbon from './stations/ribbon.js'
import buildStatues from './stations/statues.js'
import { createTrails } from './trails.js'
import { BG, CAPS_CSS, LINE_CSS, NUM_CSS } from './type.js'
import { createUI } from './ui.js'

// Straight spine runs, one per station (world units). Waypoints bend the flights between them.
const LAYOUT = [
	{ id: 'enter', anchor: [0, 0, -36], dir: [0, 0, -1], half: 34 },
	{ id: 'edit', anchor: [14, 2, -110], dir: [1, 0, -0.5], half: 14 },
	{ id: 'corners', anchor: [56, 6, -132], dir: [1, 0, 0], half: 12 },
	{ id: 'ribbon', anchor: [100, 0, -120], dir: [1, 0, 0.35], half: 22 },
	{ id: 'statues', anchor: [136, 0, -88], dir: [0, 1, 0], half: 7.5 },
	{ id: 'culling', anchor: [122, -6, -20], dir: [0, 0, 1], half: 18 },
	{ id: 'gpupath', anchor: [62, -8, 42], dir: [-1, 0, 0], half: 50 },
	{ id: 'finale', anchor: [-22, 0, 26], dir: [-0.5, 0, -0.85], half: 10 },
]
const WAYPOINTS = [null, null, null, null, [[134, 20, -62]], null, null, null]
const BUILDERS = [buildEnter, buildEdit, buildCorners, buildRibbon, buildStatues, buildCulling, buildGpuPath, buildFinale]
const WEIGHTS = [1, 2, 1, 1, 1, 3, 2, 1] // loader progress share per station build

// scroll step -> station (the statue station spans steps 4, 5, 6)
const STEP_STATION = [0, 1, 2, 3, 4, 4, 4, 5, 6, 7]
const PAGE_STEP = [0, 1, 2, 3, 4, 7, 8, 9]
const LAST = STEP_STATION.length - 1
const PAGES = [
	{ title: 'Enter the Line', a11y: 'makio-meshline 2.0. Tag v1.2.3 to release 2.0.0; package entry points 1 to 3. Scroll to ride the line.' },
	{ title: 'Edit in Place', a11y: 'Touch 128 points, upload only those: 773 times less GPU upload than v1.2.3, 14.4 MB to 18.6 KB per edit, 350 times faster CPU.' },
	{ title: 'Every Corner', a11y: 'Miter, bevel, round. No spikes. Join types 1 to 3; worst fold overshoot 31.6 to 4.8 to 1.6 px; notched pixels 489 to 0.' },
	{ title: 'Ride the Ribbon', a11y: 'The line becomes a road. Cap types 0 to 3; plus 16 vertices to round-cap a 50K-point road of 100,000 vertices.' },
	{ title: 'Venus & David', a11y: 'Beauty in one draw call. 64 rings by 96 samples, 6,144 GPU-placed points, one draw. David becomes Venus, then Nefertiti.' },
	{ title: 'Only What’s Seen', a11y: 'Only what you see is drawn. 400,000 points, 6,272 chunks, one indirect draw.' },
	{ title: '200K → 1,646', a11y: 'Fewer segments, same curve. 200,000 points to 1,646 retained segments (CPU-oracle count), minus 99.18% segments drawn.' },
	{ title: 'One Line', a11y: 'One line. Tests 0 to 366, demos 14 to 22, classes 3 to 10, typed exports 30 to 81. pnpm add makio-meshline.' },
]

//------------------------------------------------------------------ STAGE, SCROLL (first onFrame), PERF
const stage = await createStage( {
	background: BG,
	fog: { near: 24, far: 110 },
	bloom: { strength: 0.55, radius: 0.42, threshold: 0 },
	post: { grain: 0.032, vignette: 0.55 },
} )
const { scene, renderer, camera } = stage
scene.add( camera ) // camera-space children (cursor trails)
camera.fov = 50 // constant: the rig keeps it (no speed punch)
camera.near = 0.1
camera.far = 700
camera.updateProjectionMatrix()

const scroll = createScroll( {
	count: STEP_STATION.length,
	stage,
	ui: false,
	hash: false,
	labels: STEP_STATION.map( ( s ) => PAGES[s].title ), // station i = page i
} )
const perf = createPerf( stage, { scroll } )
const ui = createUI( { scroll, pages: PAGES, stepPage: STEP_STATION, pageStep: PAGE_STEP } )
ui.status( `${stage.backend} · r${REVISION}` )

// placeholder key until the stations exist (the loader covers the canvas meanwhile)
const rig = createRig( camera, {
	scroll,
	keys: [{ at: 0, pos: [0, 0.5, 4], target: [0, 4.2, -66] }],
	parallax: { amount: 0.014, damping: 3.5 },
	maxRoll: 0,
} )

// Pages that always hold, even when the scroll would fly through them (a camera that reverses
// direction at a page must come to rest there). None now: the path never reverses at a page, and a
// forced hold after a flown page is a hard stop (it decelerates within one transition).
const HOLD = []
const skip = new Float64Array( LAST + 2 )
/** The dwell-mapped progress the visuals use: scroll's plateaus, with the HOLD pages always held. */
const mappedNow = () => {
	skip.set( scroll.skip.subarray( 0, skip.length ) )
	for ( const k of HOLD ) skip[k] = 0
	return dwellMap( scroll.progress, scroll.dwell, LAST, skip )
}

//------------------------------------------------------------------ BUILD (behind the loader)
let spine = null
let thread = null
let trails = null
const stations = []
const ctx = { stage, scene, renderer, camera, query, ui, scroll, stations, spine: null }

const buildStation = ( i ) => async () => {
	const st = stations[i]
	await BUILDERS[i]( st, ctx )
	st.layout()
	st.ready = true
}

const pre = createPreloader( stage, {
	title: 'one line',
	steps: [
		{ label: 'type', weight: 1, run: async () => {
			await loadFonts( ['800 1em Inter', '300 1em Inter', '400 1em "JetBrains Mono"'] )
			await prepareText( renderer, [NUM_CSS, LINE_CSS, CAPS_CSS] ) // one shared atlas per face
		} },
		{ label: 'spine', weight: 1, run: () => {
			spine = createSpine( LAYOUT, WAYPOINTS )
			ctx.spine = spine
			thread = createThread( spine )
			scene.add( thread.line )
			const stationSteps = LAYOUT.map( ( _, i ) => {
				const steps = STEP_STATION.map( ( s, k ) => ( s === i ? k : -1 ) ).filter( ( k ) => k >= 0 )
				return [steps[0], steps[steps.length - 1]]
			} )
			LAYOUT.forEach( ( _, i ) => stations.push( baseStation( ctx, i, LAYOUT, stationSteps[i] ) ) )
			trails = createTrails( stage )
		} },
		...LAYOUT.map( ( L, i ) => ( { label: L.id, weight: WEIGHTS[i], run: buildStation( i ) } ) ),
		{ label: 'camera', weight: 0.5, run: async () => {
			await textIdle()
			refresh()
		} },
		{ label: 'gpu', weight: 1, run: async () => {
			// variants the final warm-up cannot see (wireframe topology, compute dispatches)
			for ( const st of stations ) await st.warm?.( ( groups ) => pre.warm( groups ) )
		} },
	],
	// default warm set: every child of the scene (thread, stations, lights, camera + trails)
} )

/** Rig keys, per-step tables and type layout for the current aspect (after build and on resize). */
const stepTable = { fogNear: new Float32Array( LAST + 1 ), fogFar: new Float32Array( LAST + 1 ), bloom: new Float32Array( LAST + 1 ), head: new Float32Array( LAST + 1 ) }
function refresh() {
	for ( let k = 0; k <= LAST; k++ ) {
		const st = stations[STEP_STATION[k]]
		const fs = st.fogScale()
		stepTable.fogNear[k] = st.fog[0] * fs
		stepTable.fogFar[k] = st.fog[1] * fs
		stepTable.bloom[k] = st.bloom
		stepTable.head[k] = st.headS / spine.length
	}
	rig.setKeys( buildKeys( { stations, stepStation: STEP_STATION, rig } ) )
}
stage.onResize( () => {
	if ( !stations.length || !stations.every( ( st ) => st.ready ) ) return
	for ( const st of stations ) st.layout()
	refresh()
} )

//------------------------------------------------------------------ FRAME
const blend = ( arr, m ) => {
	const k = Math.min( LAST - 1, Math.max( 0, Math.floor( m ) ) )
	return lerp( arr[k], arr[k + 1], clamp( m - k, 0, 1 ) )
}
// prefers-reduced-motion: scroll.js / rig.js drop smoothing, settle and parallax; the stations' ambient
// life (tunnel flow, spins, pulses, the nebula) runs at a fifth of its speed. dt: ambient, rdt: real.
const AMBIENT = prefersReducedMotion ? 0.2 : 1
const frameArgs = { p: 0, t: 0, sub: 0, dt: 0, rdt: 0, elapsed: 0 }
let debugMapped = null // __A.view( m ): freeze the dwell-mapped progress (screenshots)
let ready = false

stage.onFrame( ( dt, elapsed ) => {
	if ( !ready ) return
	const m = debugMapped ?? mappedNow()
	rig.update( debugMapped ?? scroll.progress, dt, stage.pointer, m )

	// fog, bloom and the thread head follow the mapped progress (held with the page)
	scene.fog.near = blend( stepTable.fogNear, m )
	scene.fog.far = blend( stepTable.fogFar, m )
	stage.setBloom( blend( stepTable.bloom, m ) )
	thread.head.value = blend( stepTable.head, m )

	// collapse the thread where the current station draws its own line (ribbon, statue, pass, trace)
	const cur = stations[STEP_STATION[Math.round( m )]]
	if ( cur.hide ) {
		const [k0, k1] = cur.steps
		const away = m < k0 ? k0 - m : m > k1 ? m - k1 : 0
		thread.hideFrom.value = cur.hide[0]
		thread.hideTo.value = cur.hide[1]
		thread.hide.value = clamp( 1 - away * 2.2, 0, 1 )
	} else {
		thread.hide.value = 0
	}

	// visibility by presence (+ the finale's fossils); pages are only shown / hidden, never rebuilt
	const finale = stations[stations.length - 1]
	const fossilK = clamp( ( m - ( finale.steps[0] - 0.6 ) ) / 0.6, 0, 1 )
	frameArgs.p = m
	frameArgs.dt = dt * AMBIENT
	frameArgs.rdt = dt
	frameArgs.elapsed = elapsed * AMBIENT
	for ( let i = 0; i < stations.length; i++ ) {
		const st = stations[i]
		const [k0, k1] = st.steps
		// strictly less than a page away: a held page shows only its own station (a neighbour exactly
		// one page off is at presence 0, and drawing / simulating it would only cost frames)
		const resident = m > k0 - 1 && m < k1 + 1
		st.setResident( resident )
		frameArgs.t = m < k0 ? Math.max( -1, m - k0 ) : m > k1 ? Math.min( 1, m - k1 ) : 0
		frameArgs.sub = clamp( m - k0, 0, k1 - k0 )
		if ( resident ) st.update( frameArgs )
		if ( st !== finale ) st.fossil( resident ? 0 : fossilK )
		st.group.visible = resident || ( fossilK > 0.01 && st.hasFossil === true )
	}
	trails.update( dt, elapsed )
	ui.update( m )
} )

// the stage resumes (first frames under the fade) as soon as the warm-up is done
pre.loaded.then( () => { ready = true } )
const report = await pre.done
console.info( '[A] loader', report )

window.__A = {
	stage, scroll, rig, perf, pre, report, spine, thread, stations,
	/** Pure camera path report per transition (no parallax / hold). */
	path: () => pathReport( rig, LAST, ( p ) => scroll.dwellMap( p ) ),
	mapped: mappedNow,
	/** Pages that always hold (tuning). */
	hold( list ) {
		HOLD.length = 0
		HOLD.push( ...list )
	},
	/** Offline pass through the rig + the shared continuity metric (no rendering). flight = a goTo. */
	sim( pagesPerSec = 1.2, from = 0, to = LAST, flight = false ) {
		const c = perf.continuity( simulatePass( rig, { pagesPerSec, from, to, flight, dwell: scroll.dwell, max: LAST, hold: HOLD, skipSpeeds: scroll.skipSpeeds || [1e9, 2e9] } ) )
		return { pagesPerSec: flight ? 'goTo' : pagesPerSec, from, to, maxSpeed: c.maxSpeed, maxAngSpeed: c.maxAngSpeed, spikes: c.spikes.map( ( x ) => `${x.progress}:${x.ratio}` ), angSpikes: c.angSpikes.map( ( x ) => `${x.progress}:${x.ratio}` ), worst: c.worstRatio, worstAng: c.worstAngRatio }
	},
	/** sim() over steady passes (slow / normal / fast / stress, both ways) and goTo flights, one line each. */
	bench( runs = [[0.45, 0, LAST], [0.45, LAST, 0], [1.2, 0, LAST], [1.2, LAST, 0], [1.8, 0, LAST], [1.8, LAST, 0], [2.6, 0, LAST], [0, 0, LAST, true], [0, LAST, 0, true], [0, 0, 4, true], [0, 2, 7, true], [0, 8, 1, true]] ) {
		return runs.map( ( a ) => {
			const r = window.__A.sim( ...a )
			return `${r.pagesPerSec} ${r.from}->${r.to} lin ${r.spikes.length} ang ${r.angSpikes.length} worst ${r.worst}/${r.worstAng} maxAng ${r.maxAngSpeed} | ${r.spikes.slice( 0, 4 ).join( ' ' )} | ${r.angSpikes.slice( 0, 6 ).join( ' ' )}`
		} )
	},
	/** Freeze the view at dwell-mapped progress m (null resumes the scroll). */
	view( m ) { debugMapped = m },
}
