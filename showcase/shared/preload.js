/**
 * Up-front loading behind an elegant MeshLine progress line, then pipeline warm-up, then a fade.
 * Nothing heavy is left for scroll time.
 *
 *   const pre = createPreloader( stage, {
 *   	steps: [
 *   		{ label: 'fonts', weight: 1, run: () => loadFonts( [...] ) },
 *   		{ label: 'statues', weight: 3, run: async ( step ) => { ...; step.progress( 0.5 ); ... } },
 *   		{ label: 'pages', weight: 2, run: () => buildPages() },
 *   	],
 *   	warm: () => pages.map( ( p ) => p.group ), // default: every child of stage.scene
 *   } )
 *   const report = await pre.done // steps -> warm (compileAsync + one hidden render) -> fade in
 *
 * - The stage loop is paused while loading; the loader renders its own tiny ortho scene.
 * - Steps run in order and yield to the browser after each one so the line keeps animating.
 *   `step.progress( f )` reports progress inside a long step.
 * - warm( groups ): every group (and descendant) temporarily visible with frustumCulled off,
 *   `compileAsync` against the real post scene pass render target (MSAA + HDR formats), optional
 *   compute nodes run once, one full pipeline render at `scale` resolution hidden behind the
 *   loader, then visibility / culling restored. Also callable later for lazily built content.
 * - The page fades through the background colour: loader out, scene in.
 */
import { MeshLine } from 'makio-meshline'
import { Fn, smoothstep, uniform } from 'three/tsl'
import { OrthographicCamera, Scene } from 'three/webgpu'

import { prefersReducedMotion } from './stage.js'

const STYLE_ID = 'ms-preload-style'
const CSS = `
html.ms-loading, html.ms-loading body { overflow: hidden !important; }
.ms-loader { position: fixed; inset: 0; z-index: 30; pointer-events: none; transition: opacity 0.35s ease; }
.ms-loader__row { position: absolute; left: 50%; top: calc(50% + 16px); transform: translateX(-50%); display: flex; justify-content: space-between; gap: 16px; font: 400 10px/1 var(--mono, ui-monospace, monospace); letter-spacing: 0.3em; text-transform: uppercase; color: var(--dim, rgba(236, 233, 226, 0.45)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ms-loader__title { position: absolute; left: 50%; top: calc(50% - 30px); transform: translateX(-50%); font: 400 10px/1 var(--mono, ui-monospace, monospace); letter-spacing: 0.35em; text-transform: uppercase; color: var(--ink, #ece9e2); opacity: 0.8; white-space: nowrap; }
.ms-loader.is-out { opacity: 0; }
`

const nextTask = () => new Promise( ( r ) => setTimeout( r ) )
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) )

/**
 * @param {object} stage createStage() result
 * @param {object} [o]
 * @param {Array<{ label?: string, weight?: number, run: ( step: { progress( f: number ): void, label: string } ) => any }>} [o.steps]
 * @param {Array|(() => Array)} [o.warm] groups to warm (default: stage.scene.children)
 * @param {Array|(() => Array)} [o.compute] compute nodes to run once during warm (GPU sims)
 * @param {number} [o.warmScale=0.5] pixel-ratio scale of the hidden warm render
 * @param {number} [o.compileTimeout=2500] ms to wait for compileAsync before the warm render takes over
 * @param {string} [o.title=''] small caps line above the progress line
 * @param {number|string} [o.color=0xece9e2] line colour
 * @param {number} [o.fadeOut=0.35] s, loader -> background
 * @param {number} [o.fadeIn=0.9] s, background -> scene
 * @returns {{ progress: number, label: string, loaded: Promise<void>, done: Promise<object>, report: object, warm( groups, opts ): Promise<object> }}
 */
export function createPreloader( stage, o = {} ) {
	const { renderer, scene, camera, canvas } = stage
	const { steps = [], warmScale = 0.5, title = '', color = 0xece9e2 } = o
	const fadeOut = prefersReducedMotion ? 0 : o.fadeOut ?? 0.35
	const fadeIn = prefersReducedMotion ? 0 : o.fadeIn ?? 0.9
	const t0 = performance.now()

	if ( !document.getElementById( STYLE_ID ) ) {
		const style = document.createElement( 'style' )
		style.id = STYLE_ID
		style.textContent = CSS
		document.head.append( style )
	}
	document.documentElement.classList.add( 'ms-loading' )
	stage.pause()

	//------------------------------------------------------------------ LOADER SCENE (ortho, 1 unit = 1 CSS px)
	const lScene = new Scene()
	const lCam = new OrthographicCamera( -1, 1, 1, -1, -10, 10 )
	const uHead = uniform( 0 )
	const uAlpha = uniform( 1 )
	const linePts = ( len ) => new Float32Array( [-len / 2, 0, 0, len / 2, 0, 0] )
	const lineLength = () => Math.round( Math.min( 280, window.innerWidth * 0.5 ) )
	let len = lineLength()
	const track = new MeshLine()
		.lines( linePts( len ) )
		.dynamic( true )
		.lineWidth( 1 )
		.color( color )
		.transparent( true )
		.opacityFn( Fn( ( [alpha] ) => alpha.mul( 0.14 ).mul( uAlpha ) ) )
	const fill = new MeshLine()
		.lines( linePts( len ) )
		.dynamic( true )
		.lineWidth( 1.5 )
		.color( color )
		.transparent( true )
		.opacityFn( Fn( ( [alpha, progress] ) => alpha.mul( smoothstep( uHead.sub( 0.012 ), uHead, progress ).oneMinus() ).mul( uAlpha ) ) )
	track.frustumCulled = false
	fill.frustumCulled = false
	lScene.add( track, fill )
	const fit = () => {
		const w = Math.max( 1, window.innerWidth )
		const h = Math.max( 1, window.innerHeight )
		lCam.left = -w / 2
		lCam.right = w / 2
		lCam.top = h / 2
		lCam.bottom = -h / 2
		lCam.updateProjectionMatrix()
		track.resize( w, h )
		fill.resize( w, h )
		const nl = lineLength()
		if ( nl !== len ) {
			len = nl
			track.setPositions( linePts( len ) )
			fill.setPositions( linePts( len ) )
			row.style.width = `${len}px`
		}
	}

	//------------------------------------------------------------------ DOM (title, label, %)
	const el = document.createElement( 'div' )
	el.className = 'ms-loader'
	el.setAttribute( 'role', 'progressbar' )
	el.setAttribute( 'aria-label', title || 'Loading' )
	el.setAttribute( 'aria-valuemin', '0' )
	el.setAttribute( 'aria-valuemax', '100' )
	const titleEl = document.createElement( 'div' )
	titleEl.className = 'ms-loader__title'
	titleEl.textContent = title
	const row = document.createElement( 'div' )
	row.className = 'ms-loader__row'
	row.style.width = `${len}px`
	const labelEl = document.createElement( 'span' )
	const pctEl = document.createElement( 'span' )
	row.append( labelEl, pctEl )
	el.append( titleEl, row )
	document.body.append( el )
	const offResize = stage.onResize( fit )
	fit()

	//------------------------------------------------------------------ LOOP (rAF + timer fallback for starved panes)
	const pre = {
		progress: 0,
		label: '',
		report: { firstFrameMs: 0, steps: [], warm: null, loadMs: 0, totalMs: 0, longestStep: null },
		loaded: null,
		done: null,
		warm,
	}
	let shown = 0
	let looping = true
	let lastFrame = performance.now()
	let lastPct = -1
	let rafId = 0
	const frameWaiters = []
	// The loader renders THROUGH the post pipeline (scene pass swapped to the loader scene): three r186
	// keys RenderContexts by attachment state only, so a direct canvas render (frame-buffer target)
	// between compileAsync steps would swap the shared context's textures (colour space '' vs
	// 'srgb-linear') and the pass pipelines would compile in the wrong variant.
	const pass = stage.post.scenePass
	const pipeline = stage.post.pipeline
	const nodeFrame = renderer._nodes?.nodeFrame ?? null
	const renderLoader = ( starved = false ) => {
		if ( starved && nodeFrame ) nodeFrame.update() // hidden panes: pass nodes only re-render on a new frame id
		if ( pass && pipeline ) {
			const s = pass.scene
			const c = pass.camera
			const prevTarget = renderer.getRenderTarget()
			pass.scene = lScene
			pass.camera = lCam
			renderer.setRenderTarget( null )
			try {
				pipeline.render()
			} finally {
				pass.scene = s
				pass.camera = c
				renderer.setRenderTarget( prevTarget )
			}
		} else {
			const prevTarget = renderer.getRenderTarget()
			renderer.setRenderTarget( null )
			renderer.render( lScene, lCam )
			renderer.setRenderTarget( prevTarget )
		}
	}
	const loaderFrame = ( starved = false ) => {
		const now = performance.now()
		const dt = Math.min( 0.1, ( now - lastFrame ) / 1000 )
		lastFrame = now
		shown += ( pre.progress - shown ) * ( prefersReducedMotion ? 1 : 1 - Math.exp( -dt * 7 ) )
		if ( pre.progress - shown < 1e-4 ) shown = pre.progress
		uHead.value = shown * 1.012
		const pct = Math.floor( shown * 100 )
		if ( pct !== lastPct ) {
			lastPct = pct
			pctEl.textContent = `${String( pct ).padStart( 3, '0' )}%`
			el.setAttribute( 'aria-valuenow', String( pct ) )
		}
		renderer.info.reset()
		renderLoader( starved )
		while ( frameWaiters.length ) frameWaiters.shift()()
	}
	const rafLoop = () => {
		if ( !looping ) return
		rafId = requestAnimationFrame( rafLoop )
		loaderFrame()
	}
	rafId = requestAnimationFrame( rafLoop )
	const watchdog = setInterval( () => {
		if ( looping && performance.now() - lastFrame > 60 ) loaderFrame( true )
	}, 33 )
	const nextFrame = () => new Promise( ( r ) => frameWaiters.push( r ) )

	//------------------------------------------------------------------ WARM
	/**
	 * Compile every pipeline the groups need, upload their buffers, then restore them.
	 * @param {Array} groups Object3Ds (pages); all descendants become visible + unculled meanwhile
	 * @param {{ compute?: Array, scale?: number, compileTimeout?: number }} [opts]
	 */
	async function warm( groups = scene.children, { compute = [], scale = warmScale, compileTimeout = o.compileTimeout ?? 2500 } = {} ) {
		const w0 = performance.now()
		const saved = []
		for ( const g of groups ) g.traverse( ( obj ) => saved.push( obj, obj.visible, obj.frustumCulled ) )
		const reveal = ( on ) => {
			for ( let i = 0; i < saved.length; i += 3 ) {
				saved[i].visible = on ? true : saved[i + 1]
				saved[i].frustumCulled = on ? false : saved[i + 2]
			}
		}
		// compileAsync builds its render list synchronously, then yields between objects: everything is
		// revealed only for that synchronous part, so frames rendered meanwhile never show it
		reveal( true )
		scene.updateMatrixWorld( true )
		const pass = stage.post.scenePass
		let compiling
		try {
			if ( pass ) {
				// same render target config as the real pass (PassNode.setup), so the pipeline keys match;
				// restored at once (PassNode.compileAsync keeps it bound across its awaits, so frames
				// rendered meanwhile would draw the output quad into the pass texture)
				pass.renderTarget.samples = pass.options?.samples ?? renderer.samples
				pass.renderTarget.texture.type = renderer.getOutputBufferType()
				const prevTarget = renderer.getRenderTarget()
				const prevMRT = renderer.getMRT()
				renderer.setRenderTarget( pass.renderTarget )
				renderer.setMRT( pass.getMRT?.() ?? null )
				compiling = renderer.compileAsync( scene, camera )
				renderer.setRenderTarget( prevTarget )
				renderer.setMRT( prevMRT )
			} else {
				compiling = renderer.compileAsync( scene, camera )
			}
		} finally {
			reveal( false )
		}
		// WebGL polls shader completion with rAF: in a background tab / starved pane that can take
		// tens of seconds, so cap the wait; the warm render below finishes whatever is left
		let timer = 0
		try {
			await Promise.race( [compiling, new Promise( ( r ) => { timer = setTimeout( r, compileTimeout ) } )] )
		} catch ( e ) {
			console.warn( '[preload] compileAsync failed, the warm render compiles instead', e )
		}
		clearTimeout( timer )
		const compileMs = performance.now() - w0
		const c0 = performance.now()
		for ( const node of compute ) renderer.compute( node )
		const computeMs = performance.now() - c0

		// one full frame while the loader still covers the canvas (uploads buffers, creates bindings):
		// the loader is rendered over it in the same task, so it never shows
		let renderMs = 0
		if ( looping ) {
			const r0 = performance.now()
			const dpr = renderer.getPixelRatio()
			reveal( true )
			if ( scale !== 1 ) renderer.setPixelRatio( dpr * scale )
			nodeFrame?.update() // new frame id: the scene pass must re-render (with the main scene this time)
			try {
				stage.render()
			} finally {
				if ( scale !== 1 ) renderer.setPixelRatio( dpr )
				reveal( false )
			}
			renderLoader( true )
			renderMs = performance.now() - r0
		}
		const result = { objects: saved.length / 3, compileMs: +compileMs.toFixed( 1 ), computeMs: +computeMs.toFixed( 1 ), renderMs: +renderMs.toFixed( 1 ), totalMs: +( performance.now() - w0 ).toFixed( 1 ) }
		pre.report.warm = result
		return result
	}

	//------------------------------------------------------------------ RUN
	const resolveList = ( v ) => ( typeof v === 'function' ? v() : v )
	pre.loaded = ( async () => {
		await nextFrame()
		pre.report.firstFrameMs = +( performance.now() - t0 ).toFixed( 1 )
		const total = steps.reduce( ( s, st ) => s + ( st.weight ?? 1 ), 0 ) || 1
		let doneW = 0
		for ( const st of steps ) {
			const wgt = st.weight ?? 1
			pre.label = st.label ?? ''
			labelEl.textContent = pre.label
			const s0 = performance.now()
			const handle = {
				label: pre.label,
				progress( f ) { pre.progress = Math.min( 1, ( doneW + wgt * Math.max( 0, Math.min( 1, f ) ) ) / total ) },
			}
			await st.run( handle )
			const ms = performance.now() - s0
			pre.report.steps.push( { label: pre.label, ms: +ms.toFixed( 1 ) } )
			doneW += wgt
			pre.progress = doneW / total
			await nextTask()
			await nextFrame()
		}
		pre.report.loadMs = +( performance.now() - t0 ).toFixed( 1 )
		const longest = pre.report.steps.reduce( ( a, b ) => ( !a || b.ms > a.ms ? b : a ), null )
		pre.report.longestStep = longest
	} )()

	pre.done = ( async () => {
		await pre.loaded
		pre.label = 'warm'
		labelEl.textContent = 'ready'
		await warm( resolveList( o.warm ) ?? scene.children, { compute: resolveList( o.compute ) ?? [] } )
		pre.progress = 1
		const until = performance.now() + 500
		while ( shown < 0.999 && performance.now() < until ) await nextFrame()

		// fade: loader -> background -> scene
		canvas.style.transition = `opacity ${fadeOut}s ease`
		canvas.style.opacity = '0'
		el.style.transition = `opacity ${fadeOut}s ease`
		el.classList.add( 'is-out' )
		await sleep( fadeOut * 1000 + 30 )
		looping = false
		cancelAnimationFrame( rafId )
		clearInterval( watchdog )
		offResize()
		track.dispose()
		fill.dispose()
		el.remove()
		document.documentElement.classList.remove( 'ms-loading' )
		stage.resume()
		await new Promise( ( r ) => {
			let k = 0
			const off = stage.onFrame( () => {
				if ( ++k >= 2 ) {
					off()
					r()
				}
			} )
		} )
		canvas.style.transition = `opacity ${fadeIn}s ease`
		canvas.style.opacity = '1'
		await sleep( fadeIn * 1000 )
		canvas.style.transition = ''
		canvas.style.opacity = ''
		pre.report.totalMs = +( performance.now() - t0 ).toFixed( 1 )
		return pre.report
	} )()
	pre.done.catch( ( e ) => {
		console.error( '[preload] failed', e )
		labelEl.textContent = 'error'
	} )

	return pre
}

export default createPreloader
