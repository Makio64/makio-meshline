/**
 * One fullscreen WebGPURenderer + scene + camera + bloom/grain/vignette post.
 *
 *   const stage = await createStage( { background: 0x05060a, bloom: { strength: 0.6 } } )
 *   stage.scene.add( mesh )
 *   const off = stage.onFrame( ( dt, t ) => { ... } ) // seconds
 *
 * `?webgl` forces the WebGL2 backend, `?timing` enables GPU timestamps,
 * `?nopost` renders without the post pipeline (debug).
 *
 * Render budget: DPR capped at 1.5 (1.25 on phones), MSAA, bloom at half resolution (0.3 on
 * phones) and skipped entirely while its strength is 0. `stage.setDpr( d )` is the hook for
 * adaptive resolution (perf.js). The stage owns the node frame: `time` and FRAME-updated nodes
 * (the scene pass, bloom) advance once per stage frame, also on the timer fallback.
 */
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { float, Fn, length, mix, pass, rand, screenUV, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { Color, Fog, FogExp2, NoToneMapping, PerspectiveCamera, RenderPipeline, Scene, Timer, WebGPURenderer } from 'three/webgpu'

export const query = new URLSearchParams( window.location.search )
export const isMobile = /android|iphone|ipad|ipod/i.test( navigator.userAgent ) || window.matchMedia( '(pointer: coarse)' ).matches
/** Touch-first device (no hover, coarse pointer). */
export const isTouchDevice = window.matchMedia( '(hover: none) and (pointer: coarse)' ).matches
/** Phone-sized touch device (shorter screen side < 600 CSS px): lower DPR cap and bloom resolution. */
export const isPhone = ( isTouchDevice || /android|iphone|ipod/i.test( navigator.userAgent ) ) && Math.min( window.screen.width, window.screen.height ) < 600
export const prefersReducedMotion = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches

/**
 * @param {object} [options]
 * @param {number|string} [options.background=0x05060a]
 * @param {{ color?: number|string, near?: number, far?: number, density?: number }|null} [options.fog]
 * @param {{ strength?: number, radius?: number, threshold?: number, resolutionScale?: number, idle?: boolean }|false} [options.bloom]
 *   resolutionScale defaults to 0.5 (0.3 on phones); idle (default true) skips the bloom passes while strength is 0
 * @param {{ grain?: number, vignette?: number }} [options.post] grain 0..1 (default 0.025), vignette 0..1 (default 0.45)
 * @param {(nodes: { color, sceneColor, bloomPass, scenePass }) => any} [options.postFn] extra TSL composition, applied before grain/vignette
 * @param {boolean} [options.antialias=true] MSAA
 * @param {number} [options.fov=45]
 * @param {number} [options.near=0.1]
 * @param {number} [options.far=400]
 * @param {number} [options.maxDpr] defaults to 1.5 (1.25 on phones)
 * @param {HTMLElement} [options.parent=document.body]
 */
export async function createStage( options = {} ) {
	const {
		background = 0x05060a,
		fog = null,
		antialias = true,
		fov = 45,
		near = 0.1,
		far = 400,
		maxDpr = isPhone ? 1.25 : 1.5,
		parent = document.body,
		postFn = null,
	} = options
	const bloomOptions = options.bloom === false ? null : { strength: 0.6, radius: 0.35, threshold: 0, resolutionScale: isPhone ? 0.3 : 0.5, idle: true, ...( options.bloom || {} ) }

	const renderer = new WebGPURenderer( {
		antialias,
		alpha: false,
		forceWebGL: query.has( 'webgl' ),
		trackTimestamp: query.has( 'timing' ),
	} )
	renderer.toneMapping = NoToneMapping
	renderer.setClearColor( new Color( background ), 1 )
	// DPR: the cap, or the value set through stage.setDpr() (adaptive resolution, ?dpr pins)
	let dprOverride = null
	const dpr = () => dprOverride ?? Math.min( window.devicePixelRatio || 1, maxDpr )
	renderer.setPixelRatio( dpr() )
	renderer.setSize( Math.max( 1, window.innerWidth ), Math.max( 1, window.innerHeight ) )
	await renderer.init()

	const canvas = renderer.domElement
	canvas.classList.add( 'stage-canvas' )
	canvas.setAttribute( 'aria-hidden', 'true' )
	parent.prepend( canvas )

	const isWebGPU = renderer.backend?.isWebGPUBackend === true
	const backend = isWebGPU ? 'webgpu' : 'webgl2'
	document.documentElement.dataset.backend = backend
	console.info( `[showcase] ${backend.toUpperCase()} backend` )

	const scene = new Scene()
	if ( fog ) {
		const fogColor = new Color( fog.color ?? background )
		scene.fog = fog.density !== undefined ? new FogExp2( fogColor, fog.density ) : new Fog( fogColor, fog.near ?? 10, fog.far ?? 60 )
	}

	const camera = new PerspectiveCamera( fov, window.innerWidth / Math.max( 1, window.innerHeight ), near, far )
	camera.position.set( 0, 0, 10 )
	camera.lookAt( 0, 0, 0 )

	//------------------------------------------------------------------ POST
	const uGrain = uniform( options.post?.grain ?? 0.025 )
	const uVignette = uniform( options.post?.vignette ?? 0.45 )
	let pipeline = null
	let scenePass = null
	let bloomPass = null
	if ( !query.has( 'nopost' ) ) {
		pipeline = new RenderPipeline( renderer )
		scenePass = pass( scene, camera )
		const sceneColor = scenePass.getTextureNode( 'output' )
		let color = sceneColor
		if ( bloomOptions ) {
			bloomPass = bloom( sceneColor, bloomOptions.strength, bloomOptions.radius, bloomOptions.threshold )
			bloomPass.setResolutionScale( bloomOptions.resolutionScale )
			color = sceneColor.add( bloomPass )
			if ( bloomOptions.idle ) {
				// strength 0: render the passes once more (the composite is multiplied by the strength,
				// so the output becomes black), then skip all 2 + 2 × mips quad passes until it rises
				const updateBefore = bloomPass.updateBefore
				let idle = false
				bloomPass.updateBefore = function ( frame ) {
					if ( this.strength.value > 0 ) idle = false
					else if ( idle ) return
					else idle = true
					return updateBefore.call( this, frame )
				}
			}
		}
		if ( postFn ) color = postFn( { color, sceneColor, bloomPass, scenePass } )
		pipeline.outputNode = Fn( () => {
			const c = vec3( color.rgb ).toVar()
			const d = length( screenUV.sub( 0.5 ).mul( vec2( 1.0, 0.8 ) ) )
			const vig = mix( float( 1 ), smoothstep( 0.85, 0.2, d ), uVignette )
			const n = rand( screenUV.mul( 997.0 ).add( time.mul( 0.0137 ).fract().mul( 61.0 ) ) ).sub( 0.5 )
			return vec4( c.mul( vig ).add( n.mul( uGrain ) ), 1 )
		} )()
	}

	//------------------------------------------------------------------ LOOP
	// copy-on-write arrays: iterating them allocates nothing, and (un)subscribing inside a callback is
	// safe (a callback removed mid-frame is also blanked in the list being iterated, so it never runs again)
	let frameCallbacks = []
	let resizeCallbacks = []
	const noop = () => {}
	const without = ( list, cb ) => {
		const i = list.indexOf( cb )
		if ( i < 0 ) return list
		const next = list.filter( ( f ) => f !== cb )
		list[i] = noop
		return next
	}
	const timer = new Timer() // not connected to Page Visibility: hidden panes keep ticking
	let elapsed = 0
	let running = true
	const size = { width: window.innerWidth, height: window.innerHeight, dpr: dpr() }
	const pointer = { x: 0, y: 0, clientX: 0, clientY: 0 } // x, y in NDC (-1..1, y up)

	const onPointerMove = ( e ) => {
		pointer.clientX = e.clientX
		pointer.clientY = e.clientY
		pointer.x = ( e.clientX / Math.max( 1, size.width ) ) * 2 - 1
		pointer.y = -( e.clientY / Math.max( 1, size.height ) ) * 2 + 1
	}
	window.addEventListener( 'pointermove', onPointerMove, { passive: true } )

	const render = () => {
		if ( size.width === 0 || size.height === 0 ) return
		if ( pipeline ) pipeline.render()
		else renderer.render( scene, camera )
		if ( renderer.backend?.trackTimestamp ) {
			renderer.resolveTimestampsAsync( 'render' )
			renderer.resolveTimestampsAsync( 'compute' )
		}
	}

	// Own rAF loop (not renderer.setAnimationLoop) plus a watchdog: when the document is visible
	// but rAF is starved (embedded/hidden preview panes), frames continue on a 16 ms timer and
	// switch back to rAF as soon as it fires again. Real hidden tabs (document.hidden) stay paused.
	// three's own Animation loop (rAF) advances the node frame; when it did not tick since our last
	// frame (starved rAF, timer fallback) we advance it here, so `time` and FRAME-updated nodes
	// (scene pass, bloom) never freeze and it still advances exactly once per frame.
	const nodeFrame = renderer._nodes?.nodeFrame ?? null
	let seenFrameId = -1
	let lastStep = performance.now()
	let rafId = 0
	let fallbackId = 0
	const step = () => {
		lastStep = performance.now()
		if ( !running ) return
		timer.update()
		const dt = Math.min( timer.getDelta(), 1 / 15 )
		elapsed += dt
		renderer.info.reset()
		if ( nodeFrame && nodeFrame.frameId === seenFrameId ) {
			nodeFrame.update()
			renderer.info.frame = nodeFrame.frameId
		}
		const list = frameCallbacks
		for ( let i = 0; i < list.length; i++ ) list[i]( dt, elapsed )
		render()
		if ( nodeFrame ) seenFrameId = nodeFrame.frameId
	}
	const rafLoop = () => {
		rafId = window.requestAnimationFrame( rafLoop )
		if ( fallbackId ) { clearTimeout( fallbackId ); fallbackId = 0 }
		step()
	}
	const fallbackLoop = () => {
		fallbackId = setTimeout( fallbackLoop, 16 )
		step()
	}
	const watchdog = setInterval( () => {
		if ( !running || fallbackId || document.hidden ) return
		if ( performance.now() - lastStep > 400 ) fallbackLoop()
	}, 250 )
	const start = () => {
		window.cancelAnimationFrame( rafId )
		rafId = window.requestAnimationFrame( rafLoop )
	}
	const stop = () => {
		window.cancelAnimationFrame( rafId )
		clearTimeout( fallbackId )
		fallbackId = 0
	}

	const applyDpr = () => {
		size.dpr = dpr()
		if ( Math.abs( renderer.getPixelRatio() - size.dpr ) > 1e-6 ) renderer.setPixelRatio( size.dpr )
	}
	const resize = () => {
		const w = window.innerWidth
		const h = window.innerHeight
		if ( w === 0 || h === 0 ) return
		size.width = w
		size.height = h
		camera.aspect = w / h
		camera.updateProjectionMatrix()
		applyDpr()
		renderer.setSize( w, h )
		const list = resizeCallbacks
		for ( let i = 0; i < list.length; i++ ) list[i]( w, h )
	}
	window.addEventListener( 'resize', resize )
	start()

	const stage = {
		renderer,
		scene,
		camera,
		canvas,
		isWebGPU,
		backend,
		size,
		pointer,
		post: { pipeline, scenePass, bloomPass, grain: uGrain, vignette: uVignette },
		/** DPR cap (the device pixel ratio is clamped to it unless setDpr() overrides). */
		maxDpr,
		/** True: the stage advances the renderer's node frame when rAF is starved (perf.js skips its own). */
		ownsNodeFrame: nodeFrame !== null,
		/**
		 * Adaptive-resolution hook: render at `d` device pixels per CSS px from now on (kept across
		 * resizes). `null` returns to min( devicePixelRatio, maxDpr ). Returns the applied DPR.
		 */
		setDpr( d ) {
			dprOverride = d > 0 ? d : null
			applyDpr()
			return size.dpr
		},
		/** Register a per-frame callback `( dt, elapsed )` in seconds (run in registration order). Returns an unsubscribe function. */
		onFrame( cb ) {
			if ( !frameCallbacks.includes( cb ) ) frameCallbacks = [...frameCallbacks, cb]
			return () => { frameCallbacks = without( frameCallbacks, cb ) }
		},
		/** Register a resize callback `( width, height )` in CSS px. Returns an unsubscribe function. */
		onResize( cb ) {
			if ( !resizeCallbacks.includes( cb ) ) resizeCallbacks = [...resizeCallbacks, cb]
			return () => { resizeCallbacks = without( resizeCallbacks, cb ) }
		},
		/** Number = bloom strength; object = { strength, radius, threshold }. No-op without bloom. */
		setBloom( v ) {
			if ( !bloomPass ) return
			if ( typeof v === 'number' ) {
				bloomPass.strength.value = v
				return
			}
			if ( v.strength !== undefined ) bloomPass.strength.value = v.strength
			if ( v.radius !== undefined ) bloomPass.radius.value = v.radius
			if ( v.threshold !== undefined ) bloomPass.threshold.value = v.threshold
		},
		/**
		 * Camera distance that fits a `width` x `height` world-unit box (facing the camera) in the
		 * current viewport, e.g. for portrait framing: camera.position.z = stage.fitDistance( 14, 6 ).
		 */
		fitDistance( width, height, margin = 1.1 ) {
			const vFov = ( camera.fov * Math.PI ) / 180
			const dH = ( height * margin ) / 2 / Math.tan( vFov / 2 )
			const dW = ( width * margin ) / 2 / ( Math.tan( vFov / 2 ) * camera.aspect )
			return Math.max( dH, dW )
		},
		render,
		resize,
		pause() { running = false; stop() },
		resume() { running = true; timer.reset(); start() },
		dispose() {
			running = false
			stop()
			clearInterval( watchdog )
			timer.dispose()
			window.removeEventListener( 'resize', resize )
			window.removeEventListener( 'pointermove', onPointerMove )
			frameCallbacks = []
			resizeCallbacks = []
			bloomPass?.dispose()
			scenePass?.dispose()
			pipeline?.dispose()
			renderer.dispose()
			canvas.remove()
		},
	}
	resize()
	return stage
}

export default createStage
