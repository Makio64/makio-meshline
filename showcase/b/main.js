/**
 * Plan B · Drawn Numerals — prototype.
 *
 * Swiss poster at night: one giant number per page, drawn from MeshLines.
 * Pages sit on a horizontal strip; a long-lens camera (fov 20) trucks sideways
 * between them. Pages with several states (fold policies, statues) own several stops.
 *
 * Scroll: native document scroll (shared/scroll.js), one stop per 100lvh, damped once, dwell
 * plateaus. Every page state is a pure function of the dwell-mapped progress (scrolling back
 * rewinds exactly); time only drives ambient life (the p2 ripple, the p5 shimmer, the p7 pass
 * camera, a small statue sway). Camera: one shared rig (shared/rig.js, keys in lib/camera.js); the
 * finale pulls back over two stops (the strip, then the wall of every poster), and jumps two or more
 * posters away cut through an ink veil instead of flying.
 * Everything is built and warmed behind the loader; pages are shown by presence, never rebuilt.
 */
import '../shared/base.css'
import './b.css'

import { clamp, damp, lerp, smoothstep } from '@shared/math.js'
import { createPerf } from '@shared/perf.js'
import { createPreloader } from '@shared/preload.js'
import { createRig } from '@shared/rig.js'
import { createScroll } from '@shared/scroll.js'
import { createStage, isMobile, prefersReducedMotion } from '@shared/stage.js'
import { loadStatueRings } from '@shared/statues.js'
import { loadFonts, prepareText, textIdle } from '@shared/text.js'
import { MeshLine } from 'makio-meshline'
import { Plane, Raycaster, RenderTarget, Vector2, Vector3 } from 'three/webgpu'

import { cameraKeys, MARGIN, PORTRAIT_BOX, POSTER, SPACING } from './lib/camera.js'
import { PORTRAIT } from './lib/page.js'
import { C, MONO, NUM, setMonoScale, setTypeRenderer } from './lib/type.js'
import p1 from './pages/p1-two.js'
import p2 from './pages/p2-upload.js'
import p3 from './pages/p3-gpupath.js'
import p4 from './pages/p4-fold.js'
import p5 from './pages/p5-joins.js'
import p6 from './pages/p6-marble.js'
import p7 from './pages/p7-culling.js'
import p8 from './pages/p8-green.js'

const PAGES = [p1, p2, p3, p4, p5, p6, p7, p8]
const SLUGS = ['two', 'upload', 'gpu-path', 'simplified', 'miters', 'fold-geometry', 'fold-exact', 'joins', 'sixty-four', 'david', 'venus', 'nefertiti', 'culling', 'all-green', 'strip', 'wall']

//------------------------------------------------------------------ STOPS (one scroll page each)
const stops = []
const first = []
const last = []
PAGES.forEach( ( page, k ) => {
	first[k] = stops.length
	for ( let s = 0; s < page.subs; s++ ) stops.push( { page: k, sub: s, label: page.labels?.[s] ?? page.title } )
	last[k] = stops.length - 1
} )
const WALL_STOP = stops.length - 1 // page 8's last stop is the wall
const STRIP_STOP = WALL_STOP - 1 // halfway round: the last posters in perspective
const FINALE = STRIP_STOP - 1 // page 8's '366': the two-page pull-back starts here

//------------------------------------------------------------------ DOM chrome
const nav = document.createElement( 'div' )
nav.className = 'ui-corner tl b-nav'
nav.innerHTML = '<a href="./">← hub</a> · B · Drawn Numerals'
document.body.append( nav )
const veil = document.createElement( 'div' ) // far jumps cut through the ink instead of whipping past 3+ posters
veil.className = 'b-veil'
veil.setAttribute( 'aria-hidden', 'true' )
document.body.append( veil )

//------------------------------------------------------------------ STAGE, SCROLL (first onFrame subscriber), PERF
const stage = await createStage( {
	background: C.ink,
	fov: 20,
	near: 1,
	far: 3000,
	bloom: { strength: 0, radius: 0.55, threshold: 0.0 },
	post: { grain: 0.022, vignette: 0.32 },
} )
const { scene, camera, renderer } = stage
setTypeRenderer( renderer )

const scroll = createScroll( {
	count: stops.length,
	stage,
	labels: stops.map( ( s, i ) => `${String( i + 1 ).padStart( 2, '0' )} · ${s.label}` ),
	hint: 'scroll',
	slugs: SLUGS,
} )
const perf = createPerf( stage, { scroll } )

//------------------------------------------------------------------ LAYOUT (landscape poster / portrait re-stack) + CAMERA RIG
const isPortrait = () => stage.size.width / stage.size.height < 0.8
let portrait = isPortrait()
const keysFor = () => {
	const box = portrait ? PORTRAIT_BOX : POSTER
	return cameraKeys( {
		stops,
		posters: PAGES.length,
		portrait,
		dist: stage.fitDistance( box.w, box.h, portrait ? 1.0 : MARGIN ),
		// the wall view is solved for this aspect: every poster, the nearest '366' included, in frame
		aspect: camera.aspect,
		fov: camera.fov,
	} )
}
const rig = createRig( camera, { scroll, keys: keysFor(), parallax: { amount: 0.015, damping: 3 } } )

//------------------------------------------------------------------ GLOBAL LINES
// 12-column hairline grid behind every poster (antialiased 1 px MeshLines); a 6-column one in portrait
const makeGrid = ( box, cols ) => {
	const lines = []
	const x0 = -box.w / 2
	const x1 = ( PAGES.length - 1 ) * SPACING + box.w / 2
	for ( const y of [-box.h / 2, box.h / 2] ) lines.push( new Float32Array( [x0 - 30, y, -0.5, x1 + 30, y, -0.5] ) )
	for ( let k = 0; k < PAGES.length; k++ ) {
		for ( let j = 0; j <= cols; j++ ) {
			const x = k * SPACING - box.w / 2 + ( j * box.w ) / cols
			lines.push( new Float32Array( [x, -box.h / 2 - 0.6, -0.5, x, box.h / 2 + 0.6, -0.5] ) )
		}
	}
	const grid = new MeshLine()
		.lines( lines, false )
		.sizeAttenuation( false )
		.lineWidth( 1 )
		.color( C.bone )
		.opacity( 0.075 )
		.antialias( true )
		.autoResize()
	grid.renderOrder = -10
	scene.add( grid )
	return grid
}
const gridLand = makeGrid( POSTER, 12 )
const gridPort = makeGrid( PORTRAIT, 6 )

// red rule: wipes from one poster to the next during the truck (hand-off). A unit line placed and
// stretched by its transform: no position upload per frame
const rule = new MeshLine()
	.lines( new Float32Array( [0, 0, 0, 1, 0, 0] ), false )
	.lineWidth( 0.16 )
	.color( C.red )
	.autoResize()
rule.frustumCulled = false
rule.visible = false
scene.add( rule )

//------------------------------------------------------------------ PAGES
const instances = new Array( PAGES.length ).fill( null )
const pointer = { x: 0, y: 0, world: new Vector3(), active: false }

const applyLayout = () => {
	setMonoScale( portrait ? 2.1 : 1 )
	gridLand.visible = !portrait
	gridPort.visible = portrait
	for ( const inst of instances ) inst?.layout?.( portrait )
}
applyLayout()
stage.onResize( () => {
	const p = isPortrait()
	if ( p !== portrait ) {
		portrait = p
		applyLayout()
	}
	rig.setKeys( keysFor() ) // the framing distances depend on the aspect
} )

//------------------------------------------------------------------ FAR JUMPS (dots, Home / End, wall clicks)
// A jump within a poster or to the next one flies with scroll.js's smooth goTo. A jump two or more
// posters away cuts through the ink instead: at flight speed the camera would brake into every
// multi-stop poster on the way and whip past the others (every such flight failed the continuity
// metric in the offline sim, scratchpad/smooth/bq/flights.txt)
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) )
const posterAt = ( stop ) => stops[clamp( Math.round( stop ), 0, WALL_STOP )].page
const needsCut = ( dest ) => Math.abs( stops[dest].page - posterAt( scroll.raw ) ) >= 2
let jumping = false
async function jump( dest ) {
	dest = clamp( Math.round( dest ), 0, WALL_STOP )
	if ( prefersReducedMotion || !needsCut( dest ) ) {
		scroll.goTo( dest )
		return
	}
	if ( jumping ) return
	jumping = true
	veil.classList.add( 'is-on' )
	await sleep( 300 )
	scroll.goTo( dest, { instant: true } )
	await perf.frames( 3 ) // the new page renders (and settles) under the veil
	veil.classList.remove( 'is-on' )
	jumping = false
}
if ( scroll.el ) {
	const dots = [...scroll.el.querySelectorAll( '.pager-dot' )]
	scroll.el.addEventListener( 'click', ( e ) => {
		const i = dots.indexOf( e.target.closest?.( '.pager-dot' ) )
		if ( i < 0 || prefersReducedMotion || !needsCut( i ) ) return // scroll.js flies there itself
		e.stopPropagation()
		jump( i )
	}, true )
}
window.addEventListener( 'keydown', ( e ) => {
	if ( e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey ) return
	if ( e.target?.closest?.( 'input, textarea, select, [contenteditable]' ) ) return
	const to = e.key === 'Home' ? 0 : e.key === 'End' ? WALL_STOP : null
	if ( to === null || prefersReducedMotion || !needsCut( to ) ) return
	e.preventDefault()
	e.stopPropagation() // window capture: scroll.js's own key handler never sees it
	jump( to )
}, true )

// a hash typed while on the page (#venus, #12) follows the same rule as the dots
const stopFromHash = () => {
	const h = decodeURIComponent( window.location.hash.slice( 1 ) )
	if ( !h ) return null
	const j = SLUGS.indexOf( h )
	if ( j >= 0 ) return j
	const n = parseInt( h, 10 )
	return Number.isFinite( n ) ? clamp( n - 1, 0, WALL_STOP ) : null
}
window.addEventListener( 'hashchange', ( e ) => {
	const to = stopFromHash()
	if ( to === null || prefersReducedMotion || !needsCut( to ) ) return
	e.stopImmediatePropagation() // window capture: scroll.js's own hash flight never starts
	jump( to )
}, true )

const ctx = { stage, scene, renderer, camera, pointer, POSTER, SPACING, scroll, isMobile, reducedMotion: prefersReducedMotion, goToPage: ( k ) => jump( first[k] ) }

async function buildPage( k ) {
	const t0 = performance.now()
	const page = PAGES[k]
	const inst = await page.build( { ...ctx, X: k * SPACING, index: k } )
	inst.group.position.x = k * SPACING
	inst.group.name = `b:p${k + 1}`
	inst.layout?.( portrait )
	inst.group.visible = false
	scene.add( inst.group )
	// build every MeshLine now (they would otherwise build lazily on their first render)
	inst.group.traverse( ( o ) => o.ensureBuilt?.() )
	instances[k] = inst
	console.info( `[B] page ${k + 1} ${page.title} built in ${( performance.now() - t0 ).toFixed( 0 )} ms` )
}

//------------------------------------------------------------------ FRAME (pure function of scroll.mapped, plus ambient time)
const raycaster = new Raycaster()
const plane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const ndc = new Vector2()
const shown = new Array( PAGES.length ).fill( null )
const states = PAGES.map( () => ( { enter: 0, exit: 0, sub: 0, build: 0, handoff: 0, focus: 0, wall: 0, dt: 0, t: 0, drift: 0, isLast: false } ) )

function frame( dt, t ) {
	rig.update( scroll.progress, dt, stage.pointer )

	// page-side pointer inertia (cursor-driven tilts) + the pointer on the z = 0 plane
	pointer.x = damp( pointer.x, stage.pointer.x, 2.5, dt )
	pointer.y = damp( pointer.y, stage.pointer.y, 2.5, dt )
	ndc.set( stage.pointer.x, stage.pointer.y )
	raycaster.setFromCamera( ndc, camera )
	raycaster.ray.intersectPlane( plane, pointer.world )

	const bloom = updatePages( scroll.mapped, scroll.progress, dt, t, true )
	// the first frames after the loader run the bloom passes at an invisible strength, so its mip
	// targets are allocated at full size under the fade instead of when page 6 first blooms
	stage.setBloom( bloomWarmFrames > 0 ? Math.max( bloom, 1e-4 ) : bloom )
	if ( bloomWarmFrames > 0 ) bloomWarmFrames--
}
let bloomWarmFrames = 0

/**
 * Rule wipe + every present page, from the dwell-mapped value m (and the raw progress for drift).
 * `toggle`: apply visibility (onShow / onHide); the loader's rehearsal runs without it. Returns bloom.
 */
function updatePages( m, progress, dt, t, toggle ) {
	// every poster is fully revealed (and dimmed) by the strip; strip -> wall is a camera move only
	const wall = smoothstep( 0, 1, clamp( m - FINALE ) )

	// red rule wipe between posters, on the same dwell-mapped clock as the camera
	const si = Math.min( Math.floor( m ), WALL_STOP - 1 )
	const f = m - si
	const pa = stops[si].page
	const pb = stops[si + 1].page
	if ( pa !== pb && f > 0 && wall < 0.01 ) {
		const pw = portrait ? PORTRAIT.w : POSTER.w
		const left = lerp( pa * SPACING - pw / 2, pb * SPACING - pw / 2, smoothstep( 0.3, 0.95, f ) )
		const right = lerp( pa * SPACING + pw / 2, pb * SPACING + pw / 2, smoothstep( 0.05, 0.7, f ) )
		rule.position.set( left, -( portrait ? PORTRAIT.h : POSTER.h ) / 2, 0 )
		rule.scale.x = Math.max( 0.01, right - left )
		rule.visible = right - left > 0.05
	} else {
		rule.visible = false
	}

	// pages: visible while present (all of them at the wall); hidden pages cost nothing
	let bloom = 0
	for ( let k = 0; k < PAGES.length; k++ ) {
		const inst = instances[k]
		if ( !inst ) continue
		const vis = ( m > first[k] - 1 && m < last[k] + 1 ) || m > FINALE
		if ( toggle && vis !== shown[k] ) {
			shown[k] = vis
			inst.group.visible = vis
			if ( vis ) inst.onShow?.()
			else inst.onHide?.()
		}
		if ( !vis ) continue
		const s = states[k]
		const span = last[k] - first[k]
		s.enter = clamp( m - ( first[k] - 1 ) )
		s.exit = k === PAGES.length - 1 ? 0 : clamp( m - last[k] )
		s.sub = clamp( m - first[k], 0, span )
		s.build = smoothstep( 0.3, 1, s.enter )
		s.handoff = smoothstep( 0, 0.7, s.exit )
		s.focus = s.build * ( 1 - s.handoff )
		s.wall = wall
		s.dt = dt
		s.t = t
		// undamped scroll position relative to the page: keeps moving through held plateaus, so
		// scroll-driven turntables stay alive while the poster holds (clamped: still at the wall)
		s.drift = clamp( progress - first[k], -1, span + 1 )
		inst.update( s )
		if ( inst.bloom ) bloom = Math.max( bloom, inst.bloom( s ) )
	}
	return bloom
}

/**
 * Loader rehearsal: every page state over the whole strip once, no render. The first pass of the
 * frame code (JIT tiers, counter packing, the first range edits) then happens behind the loader.
 */
function rehearse() {
	const pose = { pos: new Vector3(), target: new Vector3(), fov: camera.fov, roll: 0 }
	for ( let p = 0; p <= WALL_STOP; p += 1 / 16 ) {
		const m = scroll.dwellMap( p )
		rig.sample( p, pose, m )
		updatePages( m, p, 1 / 60, 0, false )
	}
}

/** One synchronous 16 × 16 offscreen render of `group` alone (lights kept), everything restored. */
function warmCullingDraw( group ) {
	const saved = []
	for ( const child of scene.children ) {
		saved.push( child, child.visible, child.frustumCulled )
		child.visible = child === group || child.isLight || child.name === 'b:lights'
	}
	group.traverse( ( o ) => {
		saved.push( o, o.visible, o.frustumCulled )
		o.visible = true
		o.frustumCulled = false
	} )
	const rt = new RenderTarget( 16, 16, { samples: renderer.samples ?? 4, type: renderer.getOutputBufferType?.() } )
	const prev = renderer.getRenderTarget()
	try {
		renderer.setRenderTarget( rt )
		renderer.render( scene, camera )
	} finally {
		renderer.setRenderTarget( prev )
		for ( let i = saved.length - 3; i >= 0; i -= 3 ) {
			saved[i].visible = saved[i + 1]
			saved[i].frustumCulled = saved[i + 2]
		}
		rt.dispose()
	}
}

//------------------------------------------------------------------ LOADER: build everything, warm every pipeline, then show
const gpuFallbacks = [] // active GPU paths: their (never drawn) CPU fallback line is kept out of the warm-up
const pre = createPreloader( stage, {
	title: 'drawn numerals',
	color: C.bone,
	steps: [
		{ label: 'fonts', weight: 1, run: () => loadFonts( ['800 1em "Inter Tight"', '400 1em "JetBrains Mono"'] ) },
		{ label: 'type', weight: 2, run: ( step ) => prepareText( renderer, [NUM, MONO], { onProgress: ( f ) => step.progress( f ) } ) },
		{ label: 'statues', weight: 1, run: () => Promise.all( ['david', 'venus', 'nefertiti'].map( ( n ) => loadStatueRings( n, { rings: 64, samples: 96 } ) ) ) },
		{
			label: 'posters',
			weight: 8,
			run: async ( step ) => {
				let built = 0
				const tick = () => step.progress( ++built / PAGES.length )
				// pages that wait on the GPU (path preparation) start first: their wait overlaps the
				// CPU-heavy builds of the others instead of adding to them
				const early = PAGES.map( ( page, k ) => ( page.gpuWait ? buildPage( k ).then( tick ) : null ) )
				for ( let k = 0; k < PAGES.length; k++ ) {
					if ( early[k] ) continue
					await buildPage( k )
					tick()
					await sleep( 0 )
				}
				await Promise.all( early )
				await textIdle()
			},
		},
		{
			label: 'warm-up',
			weight: 1,
			run: async () => {
				// GPU paths: their CPU fallback lines are never drawn on WebGPU; keep them out of the warm-up
				for ( const inst of instances ) {
					for ( const path of inst.gpuPaths ?? [] ) {
						if ( path.status?.active && path.fallback?.parent === path ) {
							gpuFallbacks.push( path )
							path.remove( path.fallback )
						}
					}
				}
				rehearse()
				rig.update( scroll.progress, 0, null )
				frame( 0, 0 ) // page states for the start position
				// GPU culling: its output buffer is both INDEX and STORAGE, and only the handle's own first
				// draw creates it that way. Anything that touches the line before (compileAsync binds it as
				// storage) leaves an index buffer without INDEX usage: every frame with page 7 then fails
				// validation. So: one tiny offscreen draw of page 7 first, then the final warm-up render
				// dispatches the culling compute (autoUpdate on) and draws it culled.
				const p7 = instances[6]
				if ( p7 ) {
					warmCullingDraw( p7.group )
					p7.onShow()
				}
				shown.fill( null ) // after the loader, the first frame re-applies every onShow / onHide
				bloomWarmFrames = 3
				stage.setBloom( 0.6 ) // the final warm-up render also compiles the bloom passes
			},
		},
	],
	warm: () => [...instances.map( ( inst ) => inst.group ), gridLand, gridPort, rule],
	// ~600 render objects (mostly type) share ~35 pipelines: compileAsync spends most of its time
	// yielding between objects, so cap it and let the hidden warm render build the rest in one go
	compileTimeout: 700,
} )

stage.onFrame( frame )

//------------------------------------------------------------------ strip / wall: click a dimmed number to fly back
const restingOn = ( stop ) => Math.abs( scroll.raw - stop ) < 0.01 && Math.abs( scroll.mapped - stop ) < 0.01
window.addEventListener( 'click', ( e ) => {
	if ( e.target.closest?.( 'a, button' ) ) return
	if ( !restingOn( WALL_STOP ) && !restingOn( STRIP_STOP ) ) return
	const k = clamp( Math.round( pointer.world.x / SPACING ), 0, PAGES.length - 1 )
	if ( k < PAGES.length - 1 ) jump( first[k] )
} )

window.__B = { stage, scroll, rig, perf, pre, instances, stops, first, last, jump, needsCut, ready: false }

const report = await pre.done
// back in place (invisible) so the GPU paths can still fall back. Not freed: dropping ~70 MB of
// arrays right after the loader made V8 run incremental marking (frames ~3× slower) and then a
// ~190 ms mark-compact pause about 25 s in; kept alive, they cost nothing per frame
for ( const path of gpuFallbacks ) path.add( path.fallback )
console.info( '[B] loader', report )
window.__B.report = report
window.__B.ready = true
