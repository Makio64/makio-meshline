import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import { atan, cos, float, Fn, fract, mix, positionGeometry, vec3, vec4 } from 'three/tsl'
import { Fog, Vector3 } from 'three/webgpu'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import mouse from '@/makio/utils/input/mouse'

// A braided light tunnel wound around one big closed loop. The camera flies
// inside it forever, so at any moment most of the 400K-point stream is behind
// the camera or beyond the far plane — exactly the case chunk culling is for.
const STRANDS = 8
const POINTS_PER_STRAND = 50_000
const POINT_COUNT = STRANDS * POINTS_PER_STRAND
const LOOP_RADIUS = 260
const TUNNEL_RADIUS = 7
const TURNS = 64
const FLY_SPEED = 0.022
const LOOK_AHEAD = 0.07
const BACKGROUND = 0x03060F
const SNAPSHOT_INTERVAL = 350
const RING_BINS = 180
const RING_SIZE = 84

const formatCount = value => {
	if ( value >= 1_000_000 ) return `${( value / 1_000_000 ).toFixed( 2 )}M`
	if ( value >= 1_000 ) return `${( value / 1_000 ).toFixed( value >= 100_000 ? 0 : 1 )}K`
	return String( value )
}

const loopHeight = angle => Math.sin( angle * 3 ) * 9 + Math.sin( angle * 7 + 1.3 ) * 3

/** Centre of the tunnel at `angle` around the loop. */
const loopCentre = ( angle, target ) => target.set(
	Math.cos( angle ) * LOOP_RADIUS,
	loopHeight( angle ),
	Math.sin( angle ) * LOOP_RADIUS,
)

const createStrands = () => {
	const strands = []
	const step = 1e-4

	for ( let strand = 0; strand < STRANDS; strand++ ) {
		const points = new Float32Array( POINTS_PER_STRAND * 3 )
		const phase = strand / STRANDS * Math.PI * 2
		// Alternate the winding so neighbouring strands braid instead of stacking.
		const direction = strand % 2 === 0 ? 1 : -1

		for ( let i = 0; i < POINTS_PER_STRAND; i++ ) {
			const u = i / POINTS_PER_STRAND * Math.PI * 2
			const cx = Math.cos( u ) * LOOP_RADIUS
			const cz = Math.sin( u ) * LOOP_RADIUS
			const cy = loopHeight( u )
			// Tangent from a small forward difference, then a frame from the loop's
			// outward radial direction.
			let tx = Math.cos( u + step ) * LOOP_RADIUS - cx
			let ty = loopHeight( u + step ) - cy
			let tz = Math.sin( u + step ) * LOOP_RADIUS - cz
			const tangentLength = Math.hypot( tx, ty, tz )
			tx /= tangentLength
			ty /= tangentLength
			tz /= tangentLength
			let nx = Math.cos( u )
			let ny = 0
			let nz = Math.sin( u )
			const along = nx * tx + ny * ty + nz * tz
			nx -= tx * along
			ny -= ty * along
			nz -= tz * along
			const normalLength = Math.hypot( nx, ny, nz )
			nx /= normalLength
			ny /= normalLength
			nz /= normalLength
			const bx = ty * nz - tz * ny
			const by = tz * nx - tx * nz
			const bz = tx * ny - ty * nx

			const theta = phase + direction * u * TURNS
			const radius = TUNNEL_RADIUS
				+ Math.sin( u * 17 + strand * 0.9 ) * 1.3
				+ Math.sin( u * 43 - strand * 1.7 ) * 0.5
			const c = Math.cos( theta ) * radius
			const s = Math.sin( theta ) * radius
			const offset = i * 3
			points[offset] = cx + nx * c + bx * s
			points[offset + 1] = cy + ny * c + by * s
			points[offset + 2] = cz + nz * c + bz * s
		}
		strands.push( points )
	}

	return strands
}

// Cosine palette keyed to the angle around the loop, so the colour bands sweep
// past as the camera travels.
const tunnelColor = Fn( ( [baseColor] ) => {
	const position = positionGeometry
	const around = atan( position.z, position.x ).div( Math.PI * 2 ).add( 0.5 )
	const t = fract( around.mul( 22 ).add( position.y.mul( 0.015 ) ) )
	const palette = vec3( 0.5 ).add( vec3( 0.5 ).mul( cos( vec3( t ).add( vec3( 0.0, 0.33, 0.67 ) ).mul( Math.PI * 2 ) ) ) )
	const glow = mix( vec3( 0.25, 0.8, 1.0 ), palette, float( 0.8 ) )
	return vec4( glow.mul( baseColor.rgb ), 1 )
} )

class GpuCullingExample {
	constructor() {
		this.text = ''
		this.line = null
		this.culling = null
		this.handle = null
		this.metrics = null
		this.hud = null
		this.hudStyle = null
		this.hudElements = null
		this.hudState = {
			requested: null,
			backend: '',
			indexCount: -1,
			active: null,
			enabled: null,
			chunkCount: -1,
			reason: '',
		}
		this.requested = new URLSearchParams( window.location.search ).get( 'culling' ) !== '0'
		this.flight = 0
		this.lookOffset = new Vector3()
		this.cameraTarget = new Vector3()
		this.snapshotTimer = 0
		this.snapshotPending = false
		this.snapshot = null
		this.ringBins = new Float32Array( RING_BINS )
		this.indicesPerStrand = 0
	}

	async init() {
		this.createHud()
		stage.onUpdate.add( this.updateHud )
		await stage3d.initRender( { background: BACKGROUND } )
		if ( !this.hud ) return

		stage3d.scene.fog = new Fog( BACKGROUND, 40, 170 )
		stage3d.camera.near = 0.1
		stage3d.camera.far = 180
		stage3d.camera.fov = 70
		stage3d.camera.updateProjectionMatrix()
		stage3d.control = null

		this.line = new MeshLine()
			.lines( createStrands(), true )
			.lineWidth( 0.11 )
			.color( 0xFFFFFF )
			.colorFn( tunnelColor )
			.join( { type: 'miter', limit: 3 } )
			.build()
		stage3d.add( this.line )

		const indexCount = this.line.geometry.getIndex().count
		this.indicesPerStrand = indexCount / STRANDS
		this.metrics = {
			requested: this.requested,
			backend: stage3d.renderer.backend?.isWebGPUBackend === true ? 'webgpu' : 'webgl2',
			pointCount: POINT_COUNT,
			indexCount,
			visibleIndexCount: indexCount,
			get status() {
				return window.__meshLineCullingHandle?.status ?? null
			},
		}
		window.__meshLineCullingMetrics = this.metrics
		this.setCulling( this.requested )

		this.updateCamera( 0 )
		stage.onUpdate.add( this.update )
	}

	/** Attach or detach the line so the same scene doubles as its own draw-all baseline. */
	setCulling( enabled ) {
		this.requested = enabled
		if ( this.metrics ) this.metrics.requested = enabled
		if ( enabled && !this.handle ) {
			this.culling ??= MeshLineCullingSystem.attach( stage3d.renderer, stage3d.scene, {
				mode: 'auto',
				chunkSize: 128,
			} )
			this.handle = this.culling.add( this.line )
		} else if ( !enabled && this.handle ) {
			this.culling.remove( this.handle )
			this.handle = null
		}
		window.__meshLineCullingHandle = this.handle
		this.snapshot = null
		this.ringBins.fill( enabled ? 0 : 1 )
		if ( this.metrics ) this.metrics.visibleIndexCount = this.metrics.indexCount
		this.updateHud()
	}

	update = dt => {
		// Request the readback before moving: a snapshot describes the camera the
		// last frame was culled for, and the handle refuses to report a stale one.
		// The first one is taken as soon as culling goes live, then throttled.
		this.snapshotTimer += dt
		if ( this.snapshotTimer >= SNAPSHOT_INTERVAL || ( this.handle?.active && !this.snapshot ) ) {
			this.snapshotTimer = 0
			this.readSnapshot()
			// The baseline has no snapshot to wait for; keep its timings live.
			if ( !this.handle ) this.updateHud( true )
		}
		this.flight += Math.min( dt, 100 ) * 0.001 * FLY_SPEED
		this.updateCamera( dt )
	}

	updateCamera( dt ) {
		const camera = stage3d.camera
		// Steer gently inside the tunnel with the pointer.
		const blend = 1 - Math.pow( 0.04, Math.min( dt, 100 ) * 0.001 )
		this.lookOffset.x += ( mouse.normalizedX * TUNNEL_RADIUS * 0.45 - this.lookOffset.x ) * blend
		this.lookOffset.y += ( -mouse.normalizedY * TUNNEL_RADIUS * 0.35 - this.lookOffset.y ) * blend

		loopCentre( this.flight, camera.position )
		loopCentre( this.flight + LOOK_AHEAD, this.cameraTarget )
		const outwardX = Math.cos( this.flight )
		const outwardZ = Math.sin( this.flight )
		camera.position.x += outwardX * this.lookOffset.x
		camera.position.z += outwardZ * this.lookOffset.x
		camera.position.y += this.lookOffset.y
		camera.up.set( 0, 1, 0 )
		camera.lookAt( this.cameraTarget )
		camera.updateMatrixWorld()
	}

	/** An explicit, throttled readback: normal rendering never waits on the GPU result. */
	async readSnapshot() {
		if ( !this.handle?.active || this.snapshotPending ) return
		this.snapshotPending = true
		const handle = this.handle
		try {
			const snapshot = await handle.readCullingSnapshot()
			if ( !snapshot || handle !== this.handle ) return
			this.snapshot = snapshot
			this.metrics.visibleIndexCount = snapshot.visibleIndexCount
			this.ringBins.fill( 0 )
			for ( const chunk of snapshot.visibleChunks ) {
				const local = ( chunk.indexStart % this.indicesPerStrand ) / this.indicesPerStrand
				this.ringBins[Math.min( RING_BINS - 1, Math.floor( local * RING_BINS ) )] += 1
			}
			this.hudState.reason = ''
			this.updateHud( true )
		} catch {
			this.snapshot = null
		} finally {
			this.snapshotPending = false
		}
	}

	createHud() {
		this.hudStyle = document.createElement( 'style' )
		this.hudStyle.textContent = `
			.GpuCullingHud {
				position: fixed;
				left: calc(18px + var(--sail, 0px));
				top: calc(18px + var(--sait, 0px));
				z-index: 20;
				display: grid;
				gap: 8px;
				box-sizing: border-box;
				width: min(340px, calc(100vw - 84px));
				padding: 13px 15px 14px;
				border: 1px solid rgba(34, 211, 238, .18);
				border-radius: 15px;
				background: linear-gradient(145deg, rgba(3, 16, 27, .81), rgba(3, 9, 20, .64));
				box-shadow: 0 18px 55px rgba(0, 0, 0, .3);
				backdrop-filter: blur(13px);
				color: rgba(218, 237, 247, .72);
				font: 500 11px/1.35 system-ui, sans-serif;
				text-align: left;
				pointer-events: none;
				user-select: none;
			}
			.GpuCullingHud__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
			.GpuCullingHud__title {
				color: #fff;
				font-size: 10px;
				font-weight: 800;
				letter-spacing: .15em;
				text-transform: uppercase;
			}
			.GpuCullingHud__badge {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 4px 7px;
				border: 1px solid rgba(250, 204, 21, .26);
				border-radius: 999px;
				background: rgba(250, 204, 21, .09);
				color: #fde68a;
				font-size: 9px;
				font-weight: 750;
				letter-spacing: .08em;
				text-transform: uppercase;
			}
			.GpuCullingHud__badge::before {
				content: '';
				width: 6px;
				height: 6px;
				border-radius: 50%;
				background: currentColor;
				box-shadow: 0 0 10px currentColor;
			}
			.GpuCullingHud[data-state="active"] .GpuCullingHud__badge {
				border-color: rgba(34, 211, 238, .27);
				background: rgba(34, 211, 238, .1);
				color: #67e8f9;
			}
			.GpuCullingHud[data-state="fallback"] .GpuCullingHud__badge {
				border-color: rgba(251, 113, 133, .28);
				background: rgba(244, 63, 94, .1);
				color: #fecdd3;
			}
			.GpuCullingHud[data-state="baseline"] .GpuCullingHud__badge {
				border-color: rgba(148, 163, 184, .24);
				background: rgba(148, 163, 184, .09);
				color: #cbd5e1;
			}
			.GpuCullingHud__summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
			.GpuCullingHud__big { display: grid; gap: 2px; color: #fff; }
			.GpuCullingHud__percent { font-size: 34px; font-weight: 750; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
			.GpuCullingHud__label { color: rgba(218, 237, 247, .72); }
			.GpuCullingHud__ring { display: block; flex: none; width: ${RING_SIZE}px; height: ${RING_SIZE}px; }
			.GpuCullingHud__metric { color: rgba(248, 252, 255, .92); font-weight: 680; font-variant-numeric: tabular-nums; }
			.GpuCullingHud__detail { color: rgba(185, 210, 225, .63); }
			.GpuCullingHud__toggle {
				pointer-events: auto;
				justify-self: start;
				margin: 2px 0 0;
				padding: 6px 11px;
				border: 1px solid rgba(34, 211, 238, .4);
				border-radius: 999px;
				background: rgba(34, 211, 238, .08);
				color: #cffafe;
				font: 700 10px/1 system-ui, sans-serif;
				letter-spacing: .08em;
				text-transform: uppercase;
				cursor: pointer;
			}
			.GpuCullingHud__toggle:hover { border-color: #67e8f9; }
			.GpuCullingHud__toggle:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
			.GpuCullingHud__hint { color: rgba(210, 230, 241, .44); font-size: 10px; }
			@media (max-width: 620px) {
				.GpuCullingHud { left: calc(10px + var(--sail, 0px)); top: calc(10px + var(--sait, 0px)); width: auto; max-width: calc(100vw - 76px); padding: 10px 12px; gap: 7px; }
				.GpuCullingHud__detail, .GpuCullingHud__hint { display: none; }
				.GpuCullingHud__percent { font-size: 24px; }
				.GpuCullingHud__ring { width: 56px; height: 56px; }
			}
		`
		document.head.appendChild( this.hudStyle )

		this.hud = document.createElement( 'aside' )
		this.hud.className = 'GpuCullingHud'
		this.hud.setAttribute( 'role', 'status' )
		this.hud.setAttribute( 'aria-live', 'polite' )

		const header = document.createElement( 'div' )
		header.className = 'GpuCullingHud__header'
		const title = document.createElement( 'span' )
		title.className = 'GpuCullingHud__title'
		title.textContent = 'GPU culling'
		const badge = document.createElement( 'span' )
		badge.className = 'GpuCullingHud__badge'
		header.append( title, badge )

		const summary = document.createElement( 'div' )
		summary.className = 'GpuCullingHud__summary'
		const big = document.createElement( 'div' )
		big.className = 'GpuCullingHud__big'
		const percent = document.createElement( 'span' )
		percent.className = 'GpuCullingHud__percent'
		percent.textContent = '—'
		const percentLabel = document.createElement( 'span' )
		percentLabel.className = 'GpuCullingHud__label'
		percentLabel.textContent = 'measuring the drawn share…'
		big.append( percent, percentLabel )
		// The loop seen from above: lit where the GPU kept chunks, with the camera
		// and its view cone. Everything left dark was culled before the draw.
		const ring = document.createElement( 'canvas' )
		ring.className = 'GpuCullingHud__ring'
		ring.width = RING_SIZE * 2
		ring.height = RING_SIZE * 2
		ring.setAttribute( 'aria-hidden', 'true' )
		summary.append( big, ring )

		const metric = document.createElement( 'span' )
		metric.className = 'GpuCullingHud__metric'
		metric.textContent = `${formatCount( POINT_COUNT )} points · building packed index stream`

		const detail = document.createElement( 'span' )
		detail.className = 'GpuCullingHud__detail'
		const toggle = document.createElement( 'button' )
		toggle.type = 'button'
		toggle.className = 'GpuCullingHud__toggle'
		toggle.addEventListener( 'click', this.onToggle )
		toggle.addEventListener( 'pointerdown', event => event.stopPropagation() )
		const hint = document.createElement( 'span' )
		hint.className = 'GpuCullingHud__hint'
		hint.textContent = 'Move the pointer to steer · the ring maps the whole loop · add ?timing for GPU ms'
		this.hud.append( header, summary, metric, detail, toggle, hint )
		this.hud.hidden = new URLSearchParams( window.location.search ).has( 'noUI' )
		document.body.appendChild( this.hud )

		this.hudElements = { badge, detail, metric, percent, percentLabel, ring, toggle }
		this.updateHud()
	}

	onToggle = () => {
		if ( !this.line ) return
		this.setCulling( !this.requested )
	}

	updateHud = ( force = false ) => {
		if ( !this.hud || !this.hudElements ) return

		const requested = this.requested
		const backend = this.metrics?.backend ?? 'initializing'
		const indexCount = this.metrics?.indexCount ?? 0
		const active = this.handle?.active ?? false
		const enabled = this.handle?.enabled ?? false
		const chunkCount = this.handle?.chunkCount ?? 0
		const reason = this.handle?.reason ?? ''
		const previous = this.hudState
		if (
			force !== true &&
			requested === previous.requested &&
			backend === previous.backend &&
			indexCount === previous.indexCount &&
			active === previous.active &&
			enabled === previous.enabled &&
			chunkCount === previous.chunkCount &&
			reason === previous.reason
		) return
		previous.requested = requested
		previous.backend = backend
		previous.indexCount = indexCount
		previous.active = active
		previous.enabled = enabled
		previous.chunkCount = chunkCount
		previous.reason = reason

		let state = 'warmup'
		let badge = 'Checking GPU'
		let detail = 'Preparing chunk bounds and indirect buffers…'
		if ( !requested ) {
			state = 'baseline'
			badge = 'Culling off'
			detail = 'Draw-all baseline · every triangle of the loop is submitted'
		} else if ( active ) {
			state = 'active'
			badge = 'WebGPU active'
			detail = `${formatCount( chunkCount )} chunks tested in compute · one indirect draw`
		} else if ( enabled ) {
			badge = 'WebGPU warm-up'
			detail = `${formatCount( chunkCount )} chunks · ${reason}`
		} else if ( this.handle || backend !== 'initializing' ) {
			state = 'fallback'
			badge = backend === 'webgl2' ? 'WebGL2 fallback' : 'Draw-all fallback'
			detail = `Full path remains visible · ${reason || 'GPU culling unavailable'}`
		}

		const visible = this.metrics?.visibleIndexCount ?? indexCount
		const ratio = indexCount ? visible / indexCount : 1
		// Until the first readback lands there is no measured share to show: a
		// placeholder 100% would claim the opposite of what culling does.
		const measuring = requested && state !== 'fallback' && !this.snapshot
		// The fallback draws every chunk, so the whole loop is lit on the ring.
		if ( state === 'fallback' ) this.ringBins.fill( 1 )
		this.hud.dataset.state = state
		this.hudElements.badge.textContent = badge
		this.hudElements.detail.textContent = detail
		// The draw-all fallback has nothing to compare against.
		this.hudElements.toggle.hidden = state === 'fallback'
		this.hudElements.toggle.textContent = requested ? 'Turn culling off' : 'Turn culling on'
		this.hudElements.toggle.setAttribute( 'aria-pressed', String( requested ) )
		this.hudElements.percent.textContent = measuring ? '—' : `${( ratio * 100 ).toFixed( ratio < 0.1 ? 1 : 0 )}%`
		this.hudElements.percentLabel.textContent = measuring ? 'measuring the drawn share…' : 'of the path drawn'
		if ( !indexCount ) {
			this.hudElements.metric.textContent = `${formatCount( POINT_COUNT )} points · building packed index stream`
		} else if ( measuring ) {
			this.hudElements.metric.textContent = `${formatCount( indexCount / 3 )} triangles · ${formatCount( POINT_COUNT )} points`
		} else {
			this.hudElements.metric.textContent = `${formatCount( visible / 3 )} of ${formatCount( indexCount / 3 )} triangles · ${formatCount( POINT_COUNT )} points`
		}
		const info = stage3d.renderer?.info
		if ( stage3d.renderer?.backend?.trackTimestamp && info ) {
			this.hudElements.metric.textContent += ` · GPU ${( info.render.timestamp + info.compute.timestamp ).toFixed( 2 )} ms`
		}
		this.drawRing()
	}

	drawRing() {
		const canvas = this.hudElements?.ring
		const context = canvas?.getContext( '2d' )
		if ( !context ) return
		const { width, height } = canvas
		const center = width * 0.5
		const radius = width * 0.36
		const thickness = width * 0.075
		let peak = 0
		for ( let bin = 0; bin < RING_BINS; bin++ ) peak = Math.max( peak, this.ringBins[bin] )
		context.clearRect( 0, 0, width, height )
		context.lineWidth = thickness
		// Seen from above, x to the right and z down: the loop angle maps straight
		// onto the canvas, and so does the chunk order along each strand.
		context.strokeStyle = 'rgba(148, 163, 184, .18)'
		context.beginPath()
		context.arc( center, center, radius, 0, Math.PI * 2 )
		context.stroke()
		const step = Math.PI * 2 / RING_BINS
		for ( let bin = 0; bin < RING_BINS; bin++ ) {
			const value = peak > 0 ? this.ringBins[bin] / peak : 0
			if ( value <= 0 ) continue
			context.strokeStyle = `rgba(103, 232, 249, ${0.45 + value * 0.55})`
			context.beginPath()
			context.arc( center, center, radius, bin * step, ( bin + 1 ) * step + 0.01 )
			context.stroke()
		}
		// The camera flies along the loop, so it faces the tangent; the cone
		// reaches as far as the far plane does on the real loop.
		const x = center + Math.cos( this.flight ) * radius
		const y = center + Math.sin( this.flight ) * radius
		const heading = this.flight + Math.PI * 0.5
		const reach = radius * stage3d.camera.far / LOOP_RADIUS
		context.fillStyle = 'rgba(255, 255, 255, .14)'
		context.beginPath()
		context.moveTo( x, y )
		context.arc( x, y, reach, heading - 0.75, heading + 0.75 )
		context.closePath()
		context.fill()
		context.fillStyle = '#ffffff'
		context.beginPath()
		context.arc( x, y, thickness * 0.6, 0, Math.PI * 2 )
		context.fill()
	}

	dispose() {
		stage.onUpdate.remove( this.updateHud )
		stage.onUpdate.remove( this.update )
		this.hudElements?.toggle.removeEventListener( 'click', this.onToggle )
		this.hud?.remove()
		this.hudStyle?.remove()
		this.culling?.dispose()
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}
		if ( stage3d.scene ) stage3d.scene.fog = null
		if ( window.__meshLineCullingHandle === this.handle ) window.__meshLineCullingHandle = null
		if ( window.__meshLineCullingMetrics === this.metrics ) window.__meshLineCullingMetrics = null

		this.line = null
		this.culling = null
		this.handle = null
		this.metrics = null
		this.hud = null
		this.hudStyle = null
		this.hudElements = null
		this.hudState = null
		this.snapshot = null
	}

}

export default GpuCullingExample
