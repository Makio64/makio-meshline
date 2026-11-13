/**
 * Render budget + measurement for the showcase pages.
 *
 *   const perf = createPerf( stage, { scroll } ) // DPR cap + adaptive DPR + ?perf HUD + window.__probe
 *
 * - DPR is capped at maxDpr (1.5; 1.25 on phones). Adaptive: when the median frame interval of the
 *   last 60 frames exceeds `target` ms, step down 0.25 (at most once per second, never below minDpr);
 *   while frames hold 60 fps for `upDelay` ms, probe one step up (exponential back-off on failure).
 *   Only real rAF frames count (hidden panes / background tabs never trigger a change). `?dpr=1` pins it.
 * - Phones (coarse pointer): height-only resizes (URL bar collapse while scrolling) are swallowed so
 *   the renderer never reallocates mid-scroll; the canvas keeps its last accepted height.
 * - Hidden preview panes starve rAF: the stage falls back to a timer and advances the renderer's
 *   nodeFrame itself (stage.ownsNodeFrame); with an older stage it is advanced here instead.
 * - DPR changes go through stage.setDpr() (kept across resizes, one setPixelRatio per change).
 * - `?perf` shows a HUD: fps, CPU ms (frame callbacks + render encode), DPR, draws, triangles.
 * - window.__probe: startRecording(), stopRecording(), scriptedPass(), continuity(), snapshot().
 */
import { isPhone, isTouchDevice, query } from './stage.js'
const CAP = 20000 // recorded frames

/** Median of the first n entries of `src` (copied into `scratch`, no allocation). */
function median( src, n, scratch ) {
	if ( n <= 0 ) return 0
	for ( let i = 0; i < n; i++ ) scratch[i] = src[i]
	const view = scratch.subarray( 0, n )
	view.sort()
	return n % 2 ? view[( n - 1 ) >> 1] : 0.5 * ( view[n / 2 - 1] + view[n / 2] )
}

const percentile = ( arr, q ) => {
	if ( !arr.length ) return 0
	const s = Float64Array.from( arr ).sort()
	return s[Math.min( s.length - 1, Math.floor( q * ( s.length - 1 ) + 0.5 ) )]
}

/**
 * Camera-continuity metric shared by every page.
 * frames: [{ dt, progress, pos: [x,y,z], dir: [x,y,z], fov }]
 * Spike = |Δv| at a frame > k × the median |Δv| of its ±window neighbours (excluding itself) AND >
 * floorFrac × the largest |Δv| of the pass (ignores float noise while the camera is still). Same test
 * on the angular velocity vector (deg/s).
 * @returns {{ frames, maxSpeed, maxAngSpeed, maxDegPerProgress, maxFovRate, fovRange, spikes, angSpikes, worstRatio, worstAngRatio }}
 */
export function continuity( frames, { window: W = 6, k = 3, floorFrac = 0.05 } = {} ) {
	const n = frames.length
	const lin = []
	const ang = []
	const dvs = [0]
	const dws = [0]
	let maxSpeed = 0
	let maxAngSpeed = 0
	let maxDegPerProgress = 0
	let maxFovRate = 0
	let fovMin = Infinity
	let fovMax = -Infinity
	let pv = null
	let pw = null
	for ( let i = 0; i < n; i++ ) {
		const f = frames[i]
		fovMin = Math.min( fovMin, f.fov )
		fovMax = Math.max( fovMax, f.fov )
		if ( i === 0 ) continue
		const g = frames[i - 1]
		const dt = f.dt > 0 ? f.dt : 1 / 60
		const v = [( f.pos[0] - g.pos[0] ) / dt, ( f.pos[1] - g.pos[1] ) / dt, ( f.pos[2] - g.pos[2] ) / dt]
		const a = g.dir
		const b = f.dir
		const dot = Math.max( -1, Math.min( 1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2] ) )
		const angle = Math.acos( dot ) // rad
		const cx = a[1] * b[2] - a[2] * b[1]
		const cy = a[2] * b[0] - a[0] * b[2]
		const cz = a[0] * b[1] - a[1] * b[0]
		const cl = Math.hypot( cx, cy, cz )
		const s = cl > 1e-12 ? angle / cl / dt : 0
		const w = [cx * s, cy * s, cz * s] // rad/s
		const speed = Math.hypot( v[0], v[1], v[2] )
		const degs = ( angle * 180 ) / Math.PI
		const dp = Math.abs( f.progress - g.progress )
		maxSpeed = Math.max( maxSpeed, speed )
		maxAngSpeed = Math.max( maxAngSpeed, degs / dt )
		if ( dp > 1e-5 ) maxDegPerProgress = Math.max( maxDegPerProgress, degs / dp )
		maxFovRate = Math.max( maxFovRate, Math.abs( f.fov - g.fov ) / dt )
		lin.push( speed )
		ang.push( degs / dt )
		if ( pv ) {
			dvs.push( Math.hypot( v[0] - pv[0], v[1] - pv[1], v[2] - pv[2] ) )
			dws.push( ( Math.hypot( w[0] - pw[0], w[1] - pw[1], w[2] - pw[2] ) * 180 ) / Math.PI )
		} else if ( i > 1 ) {
			dvs.push( 0 )
			dws.push( 0 )
		}
		pv = v
		pw = w
	}
	const detect = ( d ) => {
		const out = []
		let worst = 0
		const max = d.reduce( ( m, x ) => Math.max( m, x ), 0 )
		const floor = Math.max( 1e-9, floorFrac * max )
		const win = []
		for ( let i = 1; i < d.length; i++ ) {
			win.length = 0
			for ( let j = i - W; j <= i + W; j++ ) if ( j !== i && j >= 1 && j < d.length ) win.push( d[j] )
			if ( win.length < W ) continue
			win.sort( ( x, y ) => x - y )
			const med = win[win.length >> 1]
			const ratio = d[i] / Math.max( med, 1e-12 )
			if ( d[i] > floor ) worst = Math.max( worst, ratio )
			if ( d[i] > k * med && d[i] > floor ) {
				const fr = frames[Math.min( frames.length - 1, i + 1 )]
				out.push( { frame: i + 1, progress: +fr.progress.toFixed( 4 ), delta: +d[i].toFixed( 4 ), ratio: +ratio.toFixed( 2 ) } )
			}
		}
		return { out, worst }
	}
	const ls = detect( dvs )
	const as = detect( dws )
	return {
		frames: n,
		maxSpeed: +maxSpeed.toFixed( 3 ),
		maxAngSpeed: +maxAngSpeed.toFixed( 2 ),
		maxDegPerProgress: +maxDegPerProgress.toFixed( 2 ),
		maxFovRate: +maxFovRate.toFixed( 3 ),
		fovRange: +( fovMax - fovMin ).toFixed( 3 ),
		spikes: ls.out,
		angSpikes: as.out,
		worstRatio: +ls.worst.toFixed( 2 ),
		worstAngRatio: +as.worst.toFixed( 2 ),
	}
}

/**
 * @param {object} stage createStage() result
 * @param {object} [o]
 * @param {object} [o.scroll] createScroll() instance (recording + scripted passes)
 * @param {number} [o.minDpr=0.75]
 * @param {number} [o.maxDpr=1.5] (1.25 on phones)
 * @param {number} [o.target=18] ms: median frame interval above this steps the DPR down
 * @param {boolean} [o.adaptive=true]
 * @param {number} [o.upDelay=3000] ms of healthy frames before probing one step up
 * @param {boolean} [o.stableViewport] swallow height-only resizes on touch devices (default: coarse pointer)
 * @param {boolean} [o.hud] default: ?perf in the URL
 */
export function createPerf( stage, o = {} ) {
	const { renderer, camera } = stage
	const {
		minDpr = 0.75,
		target = 18,
		adaptive = !query.has( 'dpr' ),
		upDelay = 3000,
		stableViewport = isTouchDevice,
		hud = query.has( 'perf' ),
	} = o
	const maxDpr = Math.min( window.devicePixelRatio || 1, o.maxDpr ?? stage.maxDpr ?? ( isPhone ? 1.25 : 1.5 ) )
	let scroll = o.scroll ?? null

	// DPR ladder: maxDpr, then 0.25 steps down to minDpr
	const levels = [maxDpr]
	for ( let d = Math.floor( ( maxDpr - 1e-6 ) * 4 ) / 4; d >= minDpr - 1e-6; d -= 0.25 ) levels.push( +d.toFixed( 2 ) )
	const pinned = query.has( 'dpr' ) ? parseFloat( query.get( 'dpr' ) ) : null
	let level = 0
	let dpr = pinned && pinned > 0 ? pinned : levels[0]
	// stage.setDpr() keeps the value across resizes (older stages: re-apply after each resize)
	const applyDpr = () => {
		if ( stage.setDpr ) {
			stage.setDpr( dpr )
			return
		}
		if ( Math.abs( renderer.getPixelRatio() - dpr ) > 1e-6 ) renderer.setPixelRatio( dpr )
		stage.size.dpr = dpr
	}
	applyDpr()
	const offResize = stage.setDpr ? () => {} : stage.onResize( applyDpr )

	//------------------------------------------------------------------ STABLE VIEWPORT (phones)
	let acceptedW = window.innerWidth
	let acceptedH = window.innerHeight
	const lockCanvas = () => stage.canvas.style.setProperty( 'height', `${acceptedH}px`, 'important' )
	const onResizeCapture = ( e ) => {
		const w = window.innerWidth
		const h = window.innerHeight
		if ( w === acceptedW && Math.abs( h - acceptedH ) < acceptedH * 0.3 ) {
			e.stopImmediatePropagation() // stage, MeshLine.autoResize and others keep their size
			return
		}
		acceptedW = w
		acceptedH = h
		lockCanvas()
	}
	if ( stableViewport ) {
		lockCanvas()
		window.addEventListener( 'resize', onResizeCapture, { capture: true } )
	}

	//------------------------------------------------------------------ rAF liveness + nodeFrame keepalive
	let lastRaf = performance.now()
	let rafId = 0
	const ping = () => {
		lastRaf = performance.now()
		rafId = requestAnimationFrame( ping )
	}
	rafId = requestAnimationFrame( ping )
	const nodeFrame = stage.ownsNodeFrame ? null : renderer._nodes?.nodeFrame ?? null // the stage advances it itself
	const rafAlive = () => performance.now() - lastRaf < 100

	//------------------------------------------------------------------ FRAME TIMING (wrap info.reset = frame start, pipeline.render = end)
	const N = 60
	const intervals = new Float32Array( N )
	const cpuRing = new Float32Array( N )
	const scratch = new Float32Array( N )
	let ring = 0
	let filled = 0
	let cpuHead = 0
	let cpuFilled = 0
	let frameStart = 0
	let renderStart = 0
	let prevStart = 0
	let lastChange = performance.now()
	let lastUp = 0
	let backoff = 1
	let evalCount = 0
	const stats = { fps: 0, cpuMs: 0, intervalMs: 0, lastCpuMs: 0, lastRenderMs: 0, dpr, drawCalls: 0, triangles: 0, frames: 0 }

	const info = renderer.info
	const origReset = info.reset
	info.reset = function () {
		frameStart = performance.now() // the renderer's rAF and the stage both reset: the last one before render wins
		if ( nodeFrame && !rafAlive() ) {
			nodeFrame.update()
			info.frame = nodeFrame.frameId
		}
		return origReset.call( this )
	}

	const pipeline = stage.post.pipeline
	const target3 = pipeline ?? renderer
	const origRender = target3.render
	target3.render = function ( ...args ) {
		renderStart = performance.now()
		const r = origRender.apply( this, args )
		frameEnd()
		return r
	}

	function frameEnd() {
		const end = performance.now()
		const cpu = end - frameStart
		const interval = prevStart > 0 ? frameStart - prevStart : 0
		prevStart = frameStart
		stats.lastCpuMs = cpu
		stats.lastRenderMs = end - renderStart
		stats.frames++
		stats.drawCalls = info.render.drawCalls
		stats.triangles = info.render.triangles
		if ( recording ) record( cpu, interval )
		// CPU ms is valid in any mode; frame intervals only from real rAF frames of a visible, loaded document
		cpuRing[cpuHead] = cpu
		cpuHead = ( cpuHead + 1 ) % N
		cpuFilled = Math.min( N, cpuFilled + 1 )
		const loading = document.documentElement.classList.contains( 'ms-loading' )
		const trusted = !loading && interval > 0 && interval < 250 && rafAlive() && !document.hidden
		if ( !trusted ) filled = 0
		else {
			intervals[ring] = interval
			ring = ( ring + 1 ) % N
			filled = Math.min( N, filled + 1 )
		}
		if ( ++evalCount % 15 === 0 ) evaluate()
	}

	function setLevel( l ) {
		level = Math.max( 0, Math.min( levels.length - 1, l ) )
		dpr = levels[level]
		applyDpr()
		stats.dpr = dpr
		lastChange = performance.now()
		filled = 0
	}

	function evaluate() {
		if ( cpuFilled > 0 ) stats.cpuMs = median( cpuRing, cpuFilled, scratch )
		if ( filled < 2 ) {
			stats.fps = 0
			return
		}
		const med = median( intervals, filled, scratch )
		stats.intervalMs = med
		stats.fps = med > 0 ? 1000 / med : 0
		if ( !adaptive || filled < N ) return
		const now = performance.now()
		if ( med > target && now - lastChange > 1000 && level < levels.length - 1 ) {
			if ( now - lastUp < 3000 ) backoff = Math.min( 16, backoff * 2 ) // the last probe up failed
			setLevel( level + 1 )
		} else if ( med < Math.min( target, 17.5 ) && level > 0 && now - lastChange > upDelay * backoff ) {
			lastUp = now
			setLevel( level - 1 )
		}
	}

	//------------------------------------------------------------------ HUD
	let hudEl = null
	let hudTimer = 0
	if ( hud ) {
		hudEl = document.createElement( 'div' )
		hudEl.className = 'ms-perf'
		hudEl.setAttribute( 'aria-hidden', 'true' )
		hudEl.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;padding:6px 8px;font:400 10px/1.5 var(--mono, monospace);letter-spacing:0.08em;color:rgba(236,233,226,0.7);background:rgba(5,6,10,0.6);border:1px solid rgba(236,233,226,0.12);border-radius:3px;pointer-events:none;white-space:pre;font-variant-numeric:tabular-nums'
		document.body.append( hudEl )
		hudTimer = setInterval( () => {
			const tri = stats.triangles >= 1e6 ? `${( stats.triangles / 1e6 ).toFixed( 2 )}M` : `${( stats.triangles / 1e3 ).toFixed( 1 )}k`
			const fps = stats.fps > 0 ? `${stats.fps.toFixed( 0 )} fps` : '-- fps (timer)'
			hudEl.textContent = `${fps}  ${stats.cpuMs.toFixed( 2 )} ms cpu\ndpr ${stats.dpr.toFixed( 2 )}  ${stats.drawCalls} draws  ${tri} tris`
		}, 250 )
	}

	//------------------------------------------------------------------ PROBE
	let recording = false
	let recN = 0
	let recStart = 0
	const R = {
		t: new Float64Array( CAP ), dt: new Float32Array( CAP ), cpu: new Float32Array( CAP ), render: new Float32Array( CAP ),
		progress: new Float64Array( CAP ), mapped: new Float64Array( CAP ), raw: new Float64Array( CAP ),
		pos: new Float64Array( CAP * 3 ), dir: new Float64Array( CAP * 3 ), fov: new Float32Array( CAP ),
		draws: new Uint32Array( CAP ), tris: new Uint32Array( CAP ), pipes: new Uint32Array( CAP ),
	}
	const pipelineCount = () => renderer._pipelines?.caches?.size ?? 0

	// Uncaptured GPU validation errors (a pass that fails validation drops the whole frame)
	let gpuErrors = 0
	const onGpuError = () => { gpuErrors++ }
	renderer.backend?.device?.addEventListener?.( 'uncapturederror', onGpuError )

	// Pipeline creation log: every new render pipeline with the object that triggered it.
	// `sync: true` means it compiled inside a frame (a hitch); compileAsync ones are `sync: false`.
	const pipelineLog = []
	const pipes = renderer._pipelines
	const origGetForRender = pipes?.getForRender
	if ( origGetForRender ) {
		pipes.getForRender = function ( renderObject, promises = null ) {
			const before = this.caches.size
			const r = origGetForRender.call( this, renderObject, promises )
			if ( this.caches.size > before && pipelineLog.length < 500 ) {
				const obj = renderObject.object
				let path = obj.name || obj.type
				for ( let q = obj.parent; q && q.parent; q = q.parent ) if ( q.name ) path = `${q.name}/${path}`
				pipelineLog.push( {
					t: +( performance.now() ).toFixed( 1 ),
					sync: promises === null,
					object: path,
					material: renderObject.material?.type,
					colorSpace: renderObject.context?.textures?.[0]?.colorSpace ?? 'canvas',
					progress: scroll ? +scroll.progress.toFixed( 3 ) : null,
				} )
			}
			return r
		}
	}
	const dirTmp = camera.position.clone()
	function record( cpu, interval ) {
		if ( recN >= CAP ) return
		const i = recN++
		R.t[i] = frameStart - recStart
		R.dt[i] = scroll?.fixedDt ?? interval / 1000
		R.cpu[i] = cpu
		R.render[i] = performance.now() - renderStart
		R.progress[i] = scroll?.progress ?? 0
		R.mapped[i] = scroll?.mapped ?? 0
		R.raw[i] = scroll?.raw ?? 0
		camera.getWorldPosition( dirTmp )
		R.pos[i * 3] = dirTmp.x
		R.pos[i * 3 + 1] = dirTmp.y
		R.pos[i * 3 + 2] = dirTmp.z
		camera.getWorldDirection( dirTmp )
		R.dir[i * 3] = dirTmp.x
		R.dir[i * 3 + 1] = dirTmp.y
		R.dir[i * 3 + 2] = dirTmp.z
		R.fov[i] = camera.fov
		R.draws[i] = info.render.drawCalls
		R.tris[i] = info.render.triangles
		R.pipes[i] = pipelineCount()
	}

	const longTasks = []
	const observers = []
	for ( const type of ['longtask', 'long-animation-frame'] ) {
		try {
			const ob = new PerformanceObserver( ( list ) => {
				for ( const e of list.getEntries() ) {
					if ( longTasks.length > 2000 ) longTasks.shift()
					longTasks.push( { type, start: +e.startTime.toFixed( 1 ), duration: +e.duration.toFixed( 1 ), blocking: e.blockingDuration !== undefined ? +e.blockingDuration.toFixed( 1 ) : undefined } )
				}
			} )
			ob.observe( { type, buffered: true } )
			observers.push( ob )
		} catch {
			// unsupported entry type
		}
	}

	// Long-task fallback: some embedders never deliver 'longtask' entries. While recording, a 16 ms
	// timer chain reports every gap > 50 ms beyond its schedule (main thread blocked).
	const stalls = []
	let beatId = 0
	let beatLast = 0
	const beat = () => {
		const now = performance.now()
		const gap = now - beatLast - 16
		if ( beatLast > 0 && gap > 50 ) stalls.push( { type: 'stall', start: +( beatLast + 16 ).toFixed( 1 ), duration: +gap.toFixed( 1 ) } )
		beatLast = now
		beatId = setTimeout( beat, 16 )
	}

	const probe = {
		stats,
		levels,
		get dpr() { return dpr },
		setDpr( d ) { dpr = d; applyDpr(); stats.dpr = d },
		attach( { scroll: s } = {} ) { if ( s ) scroll = s },
		startRecording() {
			recN = 0
			recStart = performance.now()
			recording = true
			stalls.length = 0
			clearTimeout( beatId )
			beatLast = 0
			beat()
		},
		/** @returns {{ frames: object[], longTasks: object[], stalls: object[], since: number }} */
		stopRecording() {
			recording = false
			clearTimeout( beatId )
			const frames = []
			for ( let i = 0; i < recN; i++ ) {
				frames.push( {
					t: +R.t[i].toFixed( 2 ), dt: R.dt[i], cpuMs: +R.cpu[i].toFixed( 3 ), renderMs: +R.render[i].toFixed( 3 ),
					progress: R.progress[i], mapped: R.mapped[i], raw: R.raw[i],
					pos: [R.pos[i * 3], R.pos[i * 3 + 1], R.pos[i * 3 + 2]], dir: [R.dir[i * 3], R.dir[i * 3 + 1], R.dir[i * 3 + 2]],
					fov: R.fov[i], draws: R.draws[i], tris: R.tris[i], pipelines: R.pipes[i],
				} )
			}
			return { frames, longTasks: longTasks.filter( ( e ) => e.start >= recStart ), stalls: stalls.slice(), since: recStart }
		},
		continuity,
		/** Every render pipeline created so far ({ t, sync, object, material, colorSpace, progress }). */
		pipelineLog,
		/** Long tasks / LoAF entries after `since` (performance.now() ms). */
		longTasks( since = 0 ) { return longTasks.filter( ( e ) => e.start >= since ) },
		/** Wait n stage frames. */
		frames( n = 1 ) {
			return new Promise( ( resolve ) => {
				let k = 0
				const off = stage.onFrame( () => {
					if ( ++k >= n ) {
						off()
						resolve()
					}
				} )
			} )
		},
		/**
		 * Drive window.scrollTo by pxPerFrame per stage frame from page a to page b (deterministic:
		 * the scroll spring runs at fixedDt), record every frame, wait for the spring to settle.
		 * @returns {Promise<{ summary, continuity, longTasks, frames? }>}
		 */
		async scriptedPass( { pxPerFrame = 12, pages = [0, ( scroll?.count ?? 1 ) - 1], fixedDt = 1 / 60, settleMax = 600, keepFrames = false } = {} ) {
			if ( !scroll ) throw new Error( '__probe.scriptedPass needs createPerf( stage, { scroll } )' )
			const H = scroll.pageHeight
			const [a, b] = pages
			scroll.goTo( a, { instant: true } )
			await probe.frames( 4 )
			const y1 = b * H
			const dir = Math.sign( b - a ) || 1
			let y = a * H
			scroll.fixedDt = fixedDt
			probe.startRecording()
			let extra = 0
			await new Promise( ( resolve ) => {
				const off = stage.onFrame( () => {
					if ( ( dir > 0 && y < y1 ) || ( dir < 0 && y > y1 ) ) {
						y = dir > 0 ? Math.min( y1, y + pxPerFrame ) : Math.max( y1, y - pxPerFrame )
						window.scrollTo( 0, y )
						return
					}
					const settled = Math.abs( scroll.progress - scroll.raw ) < 1e-4 && Math.abs( scroll.velocity ) < 1e-3
					if ( ( settled && ++extra > 3 ) || extra++ > settleMax ) {
						off()
						resolve()
					}
				} )
			} )
			scroll.fixedDt = null
			const rec = probe.stopRecording()
			const c = continuity( rec.frames )
			const cpu = rec.frames.map( ( f ) => f.cpuMs )
			const summary = {
				pxPerFrame, pages, frames: rec.frames.length,
				cpuMs: { median: +percentile( cpu, 0.5 ).toFixed( 3 ), p95: +percentile( cpu, 0.95 ).toFixed( 3 ), max: +Math.max( ...cpu ).toFixed( 3 ) },
				newPipelines: rec.frames.length ? rec.frames[rec.frames.length - 1].pipelines - rec.frames[0].pipelines : 0,
				heavyFrames: rec.frames.filter( ( f ) => f.cpuMs > 16 ).map( ( f ) => ( { progress: +f.progress.toFixed( 3 ), cpuMs: f.cpuMs, renderMs: f.renderMs, pipelines: f.pipelines } ) ).slice( 0, 12 ),
				longTasks: rec.longTasks.filter( ( e ) => e.type === 'longtask' ).length,
				stalls: rec.stalls.length,
				maxStallMs: rec.stalls.reduce( ( m, e ) => Math.max( m, e.duration ), 0 ),
				maxSpeed: c.maxSpeed, maxAngSpeed: c.maxAngSpeed, maxDegPerProgress: c.maxDegPerProgress, fovRange: c.fovRange,
				spikes: c.spikes.length, angSpikes: c.angSpikes.length, worstRatio: c.worstRatio, worstAngRatio: c.worstAngRatio,
			}
			return { summary, continuity: c, longTasks: rec.longTasks, stalls: rec.stalls, frames: keepFrames ? rec.frames : undefined }
		},
		snapshot() {
			const m = performance.memory
			return {
				backend: stage.backend, dpr, levels, rafAlive: rafAlive(),
				fps: +stats.fps.toFixed( 1 ), cpuMs: +stats.cpuMs.toFixed( 3 ), lastCpuMs: +stats.lastCpuMs.toFixed( 3 ),
				drawCalls: info.render.drawCalls, triangles: info.render.triangles, pipelines: pipelineCount(),
				geometries: info.memory.geometries, textures: info.memory.textures,
				heapMB: m ? +( m.usedJSHeapSize / 1048576 ).toFixed( 1 ) : null,
				gpuErrors,
				size: { ...stage.size },
			}
		},
		dispose() {
			cancelAnimationFrame( rafId )
			clearInterval( hudTimer )
			hudEl?.remove()
			offResize()
			window.removeEventListener( 'resize', onResizeCapture, { capture: true } )
			info.reset = origReset
			target3.render = origRender
			if ( origGetForRender ) pipes.getForRender = origGetForRender
			for ( const ob of observers ) ob.disconnect()
			renderer.backend?.device?.removeEventListener?.( 'uncapturederror', onGpuError )
			stage.setDpr?.( null )
			if ( window.__probe === probe ) delete window.__probe
		},
	}
	window.__probe = probe
	return probe
}

export default createPerf
