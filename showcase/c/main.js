/**
 * Plan C · Musée des Lignes — a night museum where marble icons are redrawn by makio-meshline v2.
 *
 * One world: seven rooms on a carpet-runner surface ribbon.
 * - Scroll: native document scroll (shared/scroll.js): damped progress, each room HOLDS over the
 *   middle of its page, nothing is captured or latched. Every room is a pure function of it.
 * - Camera: one keyframed rig (shared/rig.js) fed by a C2 design path (see keysFor). It rests on
 *   each room's preset, dollies out between rooms so the room you leave and the room you enter
 *   share the frame around the doorway arch, cranes down FRONT → GRAZE across The Fold's plateau
 *   (the same scroll scrubs the morph), and rises gently over the floor plan into the Collection.
 * - Load: every room is built behind the MeshLine loader, warmed (pipelines, compute, the loupe
 *   pass), then shown by presence. Nothing is built, compiled or disposed while scrolling.
 *
 * `?perf` HUD, `#fold` / `#4` deep links, `?nohash`, window.__probe (shared/perf.js), window.__musee.
 */
import '../shared/base.css'
import './style.css'

import { clamp } from '@shared/math.js'
import { createPerf } from '@shared/perf.js'
import { createPreloader } from '@shared/preload.js'
import { createRig, createScalarTrack } from '@shared/rig.js'
import { createScroll, dwellMap } from '@shared/scroll.js'
import { createStage, prefersReducedMotion, query } from '@shared/stage.js'
import { STATUES } from '@shared/statues.js'
import { loadFonts, prepareText } from '@shared/text.js'
import { circlePositions, MeshLine } from 'makio-meshline'
import { Fn, mix, pass, screenUV, smoothstep, uniform, vec2 } from 'three/tsl'
import { DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Vector2, Vector3 } from 'three/webgpu'

import { archPoints, BG, C, catmull, createDust, FLOOR_Y, roomRings } from './kit.js'
import atrium from './rooms/atrium.js'
import breath from './rooms/breath.js'
import collection from './rooms/collection.js'
import fold from './rooms/fold.js'
import gesture from './rooms/gesture.js'
import restoration from './rooms/restoration.js'
import works from './rooms/works.js'

const DEFS = [atrium, fold, gesture, restoration, breath, works, collection]
const N = DEFS.length
const SPACING = 42 // room to room: at the mid-transition dolly-out both rooms share the frame
const RUNNER_Z = 10
const DWELL = 0.4 // plateau fraction of each page: the room holds still over it
const FOLD = 1
const FOLD_SLOPE = 0.6 // camera-path speed across The Fold's plateau (0 = held): its FRONT -> GRAZE orbit
const PULL = 13 // mid-transition dolly-out away from the gallery line (world units, landscape)
const LIFT = 2.2 // ... and how much the camera rises there
const RISE = 5 // into the Collection: how far the camera lifts over the floor plan (world units)
const PORTRAIT_PITCH = 0.06
const FACES = [
	{ fontFamily: 'Cormorant Garamond', fontWeight: 300 },
	{ fontFamily: 'Cormorant Garamond', fontWeight: 400 },
	{ fontFamily: 'Inter', fontWeight: 600 },
	{ fontFamily: 'JetBrains Mono', fontWeight: 400 },
]

//------------------------------------------------------------------ UI
const brand = document.createElement( 'div' )
brand.className = 'musee-brand'
brand.innerHTML = '<b>Musée des Lignes</b><span class="musee-sub">makio-meshline 2 · </span><a href="./">hub</a>'
document.body.append( brand )

const roomEl = document.createElement( 'div' )
roomEl.className = 'musee-room'
document.body.append( roomEl )

const noteEl = document.createElement( 'div' )
noteEl.className = 'musee-note'
document.body.append( noteEl )

const hintEl = document.createElement( 'div' )
hintEl.className = 'musee-hint'
document.body.append( hintEl )

//------------------------------------------------------------------ STAGE (+ loupe pass for The Fold)
const loupe = {
	cam: new PerspectiveCamera( 10, 1, 0.1, 400 ),
	on: uniform( 0 ),
	center: uniform( new Vector2( 0.62, 0.45 ) ),
	radius: uniform( 0.14 ),
	aspect: uniform( 1 ),
	pass: null,
	zoom: 4,
}
loupe.cam.layers.set( 0 )
loupe.cam.layers.enable( 2 )

const stage = await createStage( {
	background: BG,
	fog: { color: BG, near: 28, far: 78 },
	bloom: { strength: 0.62, radius: 0.55, threshold: 0.0 },
	post: { grain: 0.04, vignette: 0.62 },
	postFn: ( { color, scenePass } ) => {
		const mainScene = scenePass.scene
		loupe.pass = pass( mainScene, loupe.cam )
		loupe.pass.setResolutionScale( 0.75 )
		// the loupe's second scene render only runs while the loupe is open (and never for the
		// loader, which borrows the main scene pass): closed, it costs nothing
		const renderLoupe = loupe.pass.updateBefore
		loupe.pass.updateBefore = function ( frame ) {
			if ( loupe.on.value <= 0 || scenePass.scene !== mainScene ) return
			return renderLoupe.call( this, frame )
		}
		const tex = loupe.pass.getTextureNode( 'output' )
		const rel = screenUV.sub( loupe.center )
		const d = rel.mul( vec2( loupe.aspect, 1 ) ).length()
		const mask = smoothstep( loupe.radius, loupe.radius.sub( 0.003 ), d ).mul( loupe.on )
		const magnified = tex.sample( rel.add( 0.5 ) )
		return mix( color, magnified.mul( 1.08 ), mask )
	},
} )
const { scene, camera, renderer } = stage
scene.add( camera ) // camera children (loupe ring, restoration divider) render
camera.layers.enable( 1 )

//------------------------------------------------------------------ SCROLL (first onFrame), PERF
const scroll = createScroll( {
	count: N,
	stage,
	dwell: DWELL,
	labels: DEFS.map( ( d ) => `${d.numeral} · ${d.title}` ),
	slugs: DEFS.map( ( d ) => d.slug ),
	hint: 'scroll',
	hash: !query.has( 'nohash' ), // ?nohash: no replaceState (some test harnesses treat it as a navigation)
} )
const perf = createPerf( stage, { scroll } )

scroll.sections.forEach( ( s, i ) => {
	const h = document.createElement( 'h2' )
	h.className = 'sr-only'
	h.textContent = `${DEFS[i].numeral}. ${DEFS[i].title}`
	s.append( h )
	if ( DEFS[i].footnote ) {
		const p = document.createElement( 'p' )
		p.className = 'sr-only'
		p.textContent = DEFS[i].footnote
		s.append( p )
	}
} )

const showRoom = ( i ) => {
	const d = DEFS[i]
	roomEl.innerHTML = `<b>${d.numeral}</b>${d.title}`
	noteEl.textContent = d.footnote || ''
}
showRoom( scroll.page )
scroll.onChange( showRoom )

//------------------------------------------------------------------ LIGHT (only the lit surfaces use it)
scene.add( new HemisphereLight( 0xfff2dc, 0x0c0b0a, 0.55 ) )
const key = new DirectionalLight( 0xffe7c4, 1.25 )
key.position.set( -6, 20, 14 )
scene.add( key, key.target )

//------------------------------------------------------------------ MUSEUM SHELL: runner, arches, floor plan, dust
const centers = DEFS.map( ( _, i ) => new Vector3( i * SPACING, 0, 0 ) )
const runnerZ = ( x ) => RUNNER_Z + Math.sin( x * 0.045 ) * 1.4
const uSpine = uniform( 1 )
const uPlan = uniform( 0.28 )
const shell = new Group()
shell.name = 'museum'
scene.add( shell )
let runner = null
let dust = null

function buildShell() {
	const runnerCtrl = [[-24, FLOOR_Y + 0.02, runnerZ( -24 )]]
	for ( const W of centers ) {
		runnerCtrl.push( [W.x - 9, FLOOR_Y + 0.02, runnerZ( W.x - 9 )] )
		runnerCtrl.push( [W.x + 9, FLOOR_Y + 0.02, runnerZ( W.x + 9 )] )
	}
	// the spine ends just past the last doorway: the Collection's plinth row stays clear of it
	runnerCtrl.pop()
	runnerCtrl.pop()
	const runnerEnd = centers[5].x + SPACING / 2 + 5
	runnerCtrl.push( [runnerEnd, FLOOR_Y + 0.02, runnerZ( runnerEnd )] )
	const runnerPts = catmull( runnerCtrl, 900 )

	runner = new MeshLine()
		.lines( runnerPts, false )
		.lineWidth( 2.6 )
		.color( 0x6a6055 )
		.surface( { frame: 'fixed-up', up: [0, 1, 0], uvMode: 'distance', uvScale: 4, roughness: 0.95, metalness: 0.0 } )
		.join( { type: 'round', segments: 8 } )
		.cap( { type: 'round', segments: 12 } )
		.build()
	runner.material.emissive.set( 0x0f0c09 )
	runner.material.emissiveIntensity = 1
	shell.add( runner )
	ctx.runner = runner

	// gold border threads along the runner (billboard hairlines)
	const offsetRunner = ( side ) => {
		const out = new Float32Array( runnerPts.length )
		for ( let i = 0; i < runnerPts.length / 3; i++ ) {
			const a = Math.max( 0, i - 1 )
			const b = Math.min( runnerPts.length / 3 - 1, i + 1 )
			let tx = runnerPts[b * 3] - runnerPts[a * 3]
			let tz = runnerPts[b * 3 + 2] - runnerPts[a * 3 + 2]
			const l = Math.hypot( tx, tz ) || 1
			tx /= l
			tz /= l
			out[i * 3] = runnerPts[i * 3] - tz * side
			out[i * 3 + 1] = runnerPts[i * 3 + 1] + 0.02
			out[i * 3 + 2] = runnerPts[i * 3 + 2] + tx * side
		}
		return out
	}
	const runnerThreads = new MeshLine()
		.lines( [offsetRunner( 1.12 ), offsetRunner( -1.12 )], false )
		.lineWidth( 0.045 )
		.color( C.gold )
		.colorFn( Fn( ( [col] ) => col.mul( uSpine ) ) )
		.autoResize()
	shell.add( runnerThreads )

	// doorway arches between rooms (ivory outer, gold inner), two batched draws
	const outer = []
	const inner = []
	for ( let i = 0; i < centers.length - 1; i++ ) {
		const x = centers[i].x + SPACING / 2
		const base = new Vector3( x, FLOOR_Y, runnerZ( x ) )
		const across = new Vector3( 0, 0, 1 )
		outer.push( archPoints( base, across, 6.4, 9.6 ) )
		inner.push( archPoints( base, across, 5.6, 9.0 ) )
	}
	const archOuter = new MeshLine().lines( outer, false ).lineWidth( 0.05 ).color( C.ivory ).autoResize()
	const archInner = new MeshLine().lines( inner, false ).lineWidth( 0.03 ).color( C.gold ).autoResize()
	shell.add( archOuter, archInner )

	// floor plan inlay: each room's walls with door gaps for the runner (constant px, readable from above)
	const plan = []
	for ( const W of centers ) {
		const x0 = W.x - 17
		const x1 = W.x + 17
		const zb = -14
		const zf = 15
		const y = FLOOR_Y + 0.015
		plan.push( new Float32Array( [x0, y, 6, x0, y, zb, x1, y, zb, x1, y, 6] ) )
		plan.push( new Float32Array( [x0, y, zf, x1, y, zf] ) )
		plan.push( new Float32Array( [x0, y, 13.6, x0, y, zf] ) )
		plan.push( new Float32Array( [x1, y, 13.6, x1, y, zf] ) )
	}
	const floorPlan = new MeshLine()
		.lines( plan, false )
		.lineWidth( 1.4 )
		.sizeAttenuation( false )
		.color( C.ivory )
		.transparent( true )
		.opacityFn( Fn( ( [a] ) => a.mul( uPlan ) ) )
		.autoResize()
	shell.add( floorPlan )

	// room markers: a gold rosette inlaid under each plinth (reads from above)
	const markers = []
	for ( const W of centers.filter( ( _, i ) => DEFS[i].stage !== false ) ) { // no central plinth: no rosette
		for ( const r of [5.2, 5.8] ) {
			const c = circlePositions( 96, r )
			for ( let i = 0; i < 96; i++ ) {
				const y = c[i * 3 + 1]
				c[i * 3] += W.x
				c[i * 3 + 1] = FLOOR_Y + 0.02
				c[i * 3 + 2] = W.z + y
			}
			markers.push( c )
		}
	}
	const roomMarkers = new MeshLine()
		.lines( markers, true )
		.lineWidth( 1.6 )
		.sizeAttenuation( false )
		.color( C.gold )
		.colorFn( Fn( ( [col] ) => col.mul( uSpine.mul( 0.5 ).add( 0.4 ) ) ) )
		.autoResize()
	shell.add( roomMarkers )

	dust = createDust( { count: 900, box: [46, 24, 40], opacity: 0.55 } )
	dust.line.layers.set( 1 ) // main camera only: ×4 in the loupe a mote reads as a white square
	shell.add( dust.line )
}

//------------------------------------------------------------------ ROOMS (built once behind the loader, shown by presence)
const ctx = {
	stage, scene, camera, renderer, loupe, scroll, isWebGPU: stage.isWebGPU,
	pointer: stage.pointer,
	pointerActive: false,
	pointerDown: false,
	lastPointerMove: -1e9,
	hintText: '',
	hint: ( text ) => { if ( text ) ctx.hintText = text },
	spine: uSpine,
	plan: uPlan,
	runner: null,
	centers,
	intro: prefersReducedMotion ? 1 : 0, // the Atrium's one-time rise as the scene fades in
	portrait: () => stage.size.width / Math.max( 1, stage.size.height ) < 0.9,
	goTo: ( i ) => scroll.goTo( i ),
	renderOnce,
}

const rooms = DEFS.map( ( def, i ) => {
	const root = new Group()
	root.name = `room:${def.slug}`
	root.position.copy( centers[i] )
	scene.add( root )
	return { def, i, root, center: centers[i], inst: null, failed: false, ms: 0 }
} )

/**
 * One real pipeline frame (half resolution) with `groups` revealed, while the loader covers the
 * canvas: for resources that need a genuine draw before anything else touches them.
 */
function renderOnce( groups ) {
	const saved = []
	for ( const g of groups ) g.traverse( ( o ) => saved.push( o, o.visible, o.frustumCulled ) )
	for ( let i = 0; i < saved.length; i += 3 ) {
		saved[i].visible = true
		saved[i].frustumCulled = false
	}
	const dpr = renderer.getPixelRatio()
	renderer.setPixelRatio( dpr * 0.5 )
	renderer._nodes?.nodeFrame?.update() // a new frame id: the scene pass re-renders
	try {
		stage.render()
	} finally {
		renderer.setPixelRatio( dpr )
		for ( let i = 0; i < saved.length; i += 3 ) {
			saved[i].visible = saved[i + 1]
			saved[i].frustumCulled = saved[i + 2]
		}
	}
}

async function buildRoom( room ) {
	const t0 = performance.now()
	try {
		room.inst = await room.def.create( ctx, room.root, room )
	} catch ( e ) {
		room.failed = true
		for ( const child of [...room.root.children] ) child.removeFromParent()
		console.error( `[musee] ${room.def.slug} failed`, e )
	}
	room.ms = +( performance.now() - t0 ).toFixed( 1 )
	if ( room.inst && !room.root.visible ) room.inst.hidden?.()
}

// visible while on screen (|mapped - i| < 1); a hidden room skips its update, so its sims,
// culling, snapshots and range edits pause with it
for ( const room of rooms ) {
	scroll.bind( room.i, room.root, {
		onShow: () => room.inst?.shown?.(),
		onHide: () => room.inst?.hidden?.(),
	} )
}

window.addEventListener( 'pointermove', () => {
	ctx.pointerActive = true
	ctx.lastPointerMove = performance.now()
}, { passive: true } )
window.addEventListener( 'pointerdown', ( e ) => { ctx.pointerDown = true; ctx.downX = e.clientX }, { passive: true } )
window.addEventListener( 'pointerup', () => { ctx.pointerDown = false }, { passive: true } )

//------------------------------------------------------------------ CAMERA RIG (keys from the rooms' presets)
/** Room preset → rig key: orbit (radius, theta, phi) around a look point offset by tx / ty. */
function restPose( i, p, aspect ) {
	const portrait = aspect < 0.9
	const W = centers[i]
	const rs = aspect < 1.2 ? Math.min( 2.3, 1.35 / Math.max( 0.45, aspect ) ) : 1
	const th = portrait ? ( p.ptheta ?? p.theta ) : p.theta
	let ph = portrait ? ( p.pphi ?? p.phi ) : p.phi
	const tx = portrait ? ( p.ptx ?? 0 ) : ( p.tx ?? 0 )
	let ty = portrait ? ( p.pty ?? p.ty ?? 0 ) : ( p.ty ?? 0 )
	let r = portrait && p.pradius ? p.pradius : p.radius * rs
	if ( portrait && DEFS[i].stage !== false ) {
		// phone: the eye sits just above the floor, so the runner, rosettes and floor plan collapse
		// into a horizon at the statue's feet; the statue owns the upper half, the plaques the lower
		r = p.radius * Math.min( 2, rs )
		ph = -PORTRAIT_PITCH
		ty = FLOOR_Y + 0.3 + r * Math.sin( PORTRAIT_PITCH )
	}
	const target = [W.x + Math.cos( th ) * tx, W.y + ty, W.z - Math.sin( th ) * tx]
	const pos = [
		target[0] + r * Math.cos( ph ) * Math.sin( th ),
		target[1] + r * Math.sin( ph ),
		target[2] + r * Math.cos( ph ) * Math.cos( th ),
	]
	// gentle drift while the room is held: a small truck along the orbit tangent (scroll-driven)
	const amp = r * 0.035
	const hold = { pos: [Math.cos( th ) * amp, amp * 0.15, -Math.sin( th ) * amp], target: [Math.cos( th ) * amp * 0.25, 0, -Math.sin( th ) * amp * 0.25] }
	return { pos, target, fov: p.fov ?? 45, hold }
}

const mid3 = ( a, b ) => [( a[0] + b[0] ) / 2, ( a[1] + b[1] ) / 2, ( a[2] + b[2] ) / 2]
/** Heading of a view (radians, 0 = looking down -z, positive = turned toward +x, down the gallery). */
const yawOf = ( pos, target ) => Math.atan2( target[0] - pos[0], pos[2] - target[2] )

/** Blend two room presets (orbit parameters), portrait overrides falling back to their base value. */
function mixPreset( a, b, t ) {
	const v = ( k, base, fb = 0 ) => {
		const x = a[k] ?? ( base ? a[base] : undefined ) ?? fb
		const y = b[k] ?? ( base ? b[base] : undefined ) ?? fb
		return x + ( y - x ) * t
	}
	return {
		radius: v( 'radius' ), theta: v( 'theta' ), ptheta: v( 'ptheta', 'theta' ), phi: v( 'phi' ),
		tx: v( 'tx' ), ty: v( 'ty' ), ptx: v( 'ptx' ), pty: v( 'pty', 'ty' ), fov: v( 'fov', null, 45 ),
	}
}

/** Natural cubic spline through ( xs[i], ys[i] ), xs increasing: C2 everywhere. Returns ( x ) => y. */
function naturalSpline( xs, ys ) {
	const n = xs.length
	const M = new Float64Array( n ) // second derivatives (0 at both ends)
	if ( n > 2 ) {
		const b = new Float64Array( n )
		const d = new Float64Array( n )
		for ( let i = 1; i < n - 1; i++ ) {
			const h0 = xs[i] - xs[i - 1]
			const h1 = xs[i + 1] - xs[i]
			b[i] = 2 * ( h0 + h1 )
			d[i] = 6 * ( ( ys[i + 1] - ys[i] ) / h1 - ( ys[i] - ys[i - 1] ) / h0 )
			if ( i > 1 ) {
				const w = h0 / b[i - 1]
				b[i] -= w * h0
				d[i] -= w * d[i - 1]
			}
		}
		for ( let i = n - 2; i >= 1; i-- ) M[i] = ( d[i] - ( i < n - 2 ? ( xs[i + 1] - xs[i] ) * M[i + 1] : 0 ) ) / b[i]
	}
	return ( x ) => {
		let j = 0
		while ( j < n - 2 && x > xs[j + 1] ) j++
		const h = xs[j + 1] - xs[j]
		const A = ( xs[j + 1] - x ) / h
		const B = 1 - A
		return A * ys[j] + B * ys[j + 1] + ( ( A * A * A - A ) * M[j] + ( B * B * B - B ) * M[j + 1] ) * h * h / 6
	}
}

const KEY_DENSITY = 48 // rig keys per page of camera path

/**
 * Camera path, sampled by cameraParam() (the scroll's dwell map, see below). Designed as knots:
 * - one per room, where the camera rests while the room is held (with a gentle `hold` drift);
 * - The Fold: two knots, FRONT -> GRAZE (a crane down to the rings' level), crossed while its
 *   plateau is scrolled (the same scroll scrubs the morph);
 * - between rooms one waypoint, halfway: the camera dollies out from the gallery line and rises a
 *   little, so the room you leave and the room you enter share the frame around the doorway arch
 *   (no dead stretch of floor); into the Collection it rises higher, over the floor plan;
 * - past the end, the last waypoint mirrored (the camera lands level, like at every room).
 * The knots go through a natural cubic spline (C2: no jolt where the camera crosses a knot at
 * speed), which is resampled densely into the shared rig's keys (its Catmull-Rom + arc-length
 * timing then follow the C2 curve to within a hair, so the camera stays smooth at any scroll speed).
 */
function designKnots( aspect ) {
	const portrait = aspect < 0.9
	const groups = DEFS.map( ( def, i ) => {
		if ( i !== FOLD ) return [{ at: i, ...restPose( i, def.rest, aspect ) }]
		const e = FOLD_SLOPE * DWELL / 2
		return [0, 1].map( ( t ) => {
			const k = restPose( i, mixPreset( def.rest, def.graze, t ), aspect )
			return { at: i + ( t * 2 - 1 ) * e, pos: k.pos, target: k.target, fov: k.fov }
		} )
	} )
	const knots = []
	const pull = portrait ? PULL * 0.6 : PULL
	for ( let i = 0; i < N; i++ ) {
		knots.push( ...groups[i] )
		if ( i === N - 1 ) break
		const a = groups[i][groups[i].length - 1]
		const b = groups[i + 1][0]
		const last = i === N - 2
		const pos = mid3( a.pos, b.pos )
		// (phone: from the mean height, so a low room next to a high one is a slope, not a V)
		pos[1] = ( portrait ? pos[1] : Math.max( a.pos[1], b.pos[1] ) ) + ( last ? RISE : LIFT )
		pos[2] += last ? RISE * 0.6 + pull * 0.5 : pull
		const target = mid3( a.target, b.target )
		// the heading through the waypoint stays between the two rooms' headings: the view turns one
		// way across a transition, it never swings out and back while the camera is at full speed
		const ya = yawOf( a.pos, a.target )
		const yb = yawOf( b.pos, b.target )
		const yw = yawOf( pos, target )
		const y = Math.min( Math.max( yw, Math.min( ya, yb ) ), Math.max( ya, yb ) )
		if ( y !== yw ) {
			const d = Math.hypot( target[0] - pos[0], target[2] - pos[2] )
			target[0] = pos[0] + Math.sin( y ) * d
			target[2] = pos[2] - Math.cos( y ) * d
		}
		knots.push( { at: ( a.at + b.at ) / 2, pos, target, fov: ( a.fov + b.fov ) / 2 } )
	}
	const b = knots[knots.length - 1]
	const w = knots[knots.length - 2]
	knots.push( {
		at: N,
		pos: [2 * b.pos[0] - w.pos[0], w.pos[1], w.pos[2]],
		target: [2 * b.target[0] - w.target[0], w.target[1], w.target[2]],
		fov: b.fov,
	} )
	return knots
}

function keysFor( aspect ) {
	const knots = designKnots( aspect )
	const xs = knots.map( ( k ) => k.at )
	const axis = ( get ) => naturalSpline( xs, knots.map( get ) )
	const P = [0, 1, 2].map( ( a ) => axis( ( k ) => k.pos[a] ) )
	const T = [0, 1, 2].map( ( a ) => axis( ( k ) => k.target[a] ) )
	const fov = createScalarTrack( xs, knots.map( ( k ) => k.fov ) ) // monotone: never past a knot's fov
	const keys = []
	const end = N - 1 + 1 / KEY_DENSITY // one sample past the Collection fixes its end tangent
	for ( let j = 0; j < knots.length - 1 && knots[j].at < end; j++ ) {
		const x0 = knots[j].at
		const x1 = Math.min( knots[j + 1].at, end )
		const n = Math.max( 1, Math.ceil( ( x1 - x0 ) * KEY_DENSITY - 1e-6 ) )
		for ( let q = 0; q < n; q++ ) {
			const at = q === 0 ? x0 : x0 + ( ( x1 - x0 ) * q ) / n
			const key = { at, pos: P.map( ( f ) => f( at ) ), target: T.map( ( f ) => f( at ) ), fov: fov( at ) }
			if ( q === 0 && knots[j].hold ) key.hold = knots[j].hold
			keys.push( key )
		}
	}
	const at = end
	keys.push( { at, pos: P.map( ( f ) => f( at ) ), target: T.map( ( f ) => f( at ) ), fov: fov( at ) } )
	return keys
}

// The camera samples the scroll's dwell map, except across The Fold's plateau where it keeps
// moving at FOLD_SLOPE (the orbit). Same C2 map as scroll.mapped (scroll.js dwellMap), same
// momentum-aware plateaus: a page flown through by the scroll is flown through by the camera.
const CAM_SLOPE = DEFS.map( ( _, i ) => ( i === FOLD ? FOLD_SLOPE : 0 ) )
const camSkip = new Float64Array( N + 1 )
function cameraParam() {
	const s = scroll.skip
	for ( let k = 0; k < N; k++ ) camSkip[k] = 1 - ( 1 - s[k] ) * ( 1 - CAM_SLOPE[k] )
	return dwellMap( scroll.progress, DWELL, N - 1, camSkip )
}

const aspectNow = () => stage.size.width / Math.max( 1, stage.size.height )
// no `stage`: no key uses `fit`, and the aspect handler below rebuilds the keys itself (the rig's own
// resize rebuild of ~300 keys would run on every resize event for nothing)
const rig = createRig( camera, {
	scroll,
	fov: 45,
	parallax: prefersReducedMotion ? false : { amount: 0.014, damping: 3.5 },
	keys: keysFor( aspectNow() ),
} )
let keyAspect = aspectNow()
stage.onResize( () => {
	const a = aspectNow()
	if ( Math.abs( a - keyAspect ) < 1e-3 ) return
	keyAspect = a
	rig.setKeys( keysFor( a ) )
	applyCapsScale()
} )

// phone plaques are scaled to fit the width, so their wall labels get a little extra size
function applyCapsScale() {
	const s = ctx.portrait() ? 1.3 : 1
	for ( const room of rooms ) room.root.traverse( ( o ) => { if ( o.isCaps ) o.scale.setScalar( s ) } )
}

//------------------------------------------------------------------ LOADER
let warmPending = false
const pre = createPreloader( stage, {
	title: 'musée des lignes',
	color: C.ivory,
	steps: [
		{ label: 'fonts', weight: 1, run: () => loadFonts( ['300 1em "Cormorant Garamond"', '400 1em "Cormorant Garamond"', '600 1em Inter', '400 1em "JetBrains Mono"'] ) },
		{ label: 'type', weight: 2, run: ( step ) => prepareText( renderer, FACES, { onProgress: ( f ) => step.progress( f ) } ) },
		{ label: 'statues', weight: 1, run: () => Promise.all( STATUES.map( ( name ) => roomRings( name ) ) ) },
		{ label: 'museum', weight: 1, run: buildShell },
		...rooms.map( ( room ) => ( {
			label: room.def.title.toLowerCase(),
			weight: room.def.slug === 'works' ? 4 : room.def.slug === 'gesture' ? 2 : 1,
			run: () => buildRoom( room ),
		} ) ),
		{ label: 'layout', weight: 0.2, run: applyCapsScale },
	],
	// every room + the camera's children; layer 2 (The Fold's exact stack, loupe only) and the loupe
	// pass are included for this one warm, then restored by the first frame
	warm: () => {
		camera.layers.enable( 2 )
		loupe.on.value = 1
		warmPending = true
		return [shell, ...rooms.map( ( r ) => r.root ), camera]
	},
} )

//------------------------------------------------------------------ FRAME
// local: -1 arriving .. 0 held .. 1 leaving (dwell-mapped). inPage: -1 .. 1 across the room's plateau
// (raw damped progress: it keeps moving while the room holds), clamped outside it.
const frame = { local: 0, presence: 0, dt: 0, t: 0, inPage: 0 }
let introStart = -1
stage.onFrame( ( dt, t ) => {
	if ( warmPending ) {
		warmPending = false
		camera.layers.disable( 2 )
	}
	if ( introStart < 0 ) introStart = t
	if ( ctx.intro < 1 ) ctx.intro = clamp( ( t - introStart ) / 2.4 )

	// camera: one rig, sampled from the (damped, dwell-mapped) scroll; parallax is separate
	const pose = rig.update( scroll.progress, dt, stage.pointer, cameraParam() )
	camera.updateMatrixWorld()

	// fog opens up as the camera rises over the floor plan (a function of the camera height)
	const h = Math.max( 0, camera.position.y - FLOOR_Y - 14 )
	scene.fog.near = 28 + h * 0.7
	scene.fog.far = 78 + h * 2.4
	uPlan.value = 0.22 + clamp( h / 60 ) * 0.6
	if ( dust ) {
		dust.center.value.copy( pose.target )
		dust.time.value = t
	}
	key.target.position.copy( pose.target )
	key.position.set( pose.target.x - 8, pose.target.y + 22, pose.target.z + 14 )

	// per-frame defaults the rooms may override
	loupe.on.value = 0
	ctx.hintText = ''
	stage.setBloom( 0.62 )
	uSpine.value = 1
	if ( runner ) runner.material.emissiveIntensity = 1
	loupe.aspect.value = stage.size.width / Math.max( 1, stage.size.height )

	frame.dt = dt
	frame.t = t
	for ( let i = 0; i < N; i++ ) {
		const room = rooms[i]
		if ( !room.inst || !room.root.visible ) continue
		frame.local = scroll.local( i )
		frame.presence = scroll.presence( i )
		frame.inPage = clamp( ( scroll.progress - i ) / ( DWELL / 2 ), -1, 1 )
		room.inst.update?.( frame )
	}

	if ( hintEl.textContent !== ctx.hintText ) {
		hintEl.textContent = ctx.hintText
		hintEl.classList.toggle( 'is-on', !!ctx.hintText )
	}
} )

const report = await pre.done
console.info( '[musee] loader', report, rooms.map( ( r ) => `${r.def.slug} ${r.ms} ms` ).join( ' · ' ) )

window.__musee = { stage, scroll, rig, perf, pre, report, rooms, ctx, loupe, keysFor, designKnots, restPose, mixPreset, cameraParam, camSkip, ready: true }
