/**
 * GPU Frustum Culling — a tunnel through a 400,000-point alpine range, all one MeshLine, with
 * per-chunk GPU frustum culling and indirect draw compaction. The camera flies the tunnel, which
 * trails of light sketch as they come at it, and the mini map keeps the whole scene as a dim
 * blueprint: only the chunks inside that camera's frustum are drawn, so they light up. Both
 * views render the same compacted indirect buffer.
 */
import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import { color } from 'three/tsl'
import { AdditiveBlending, Box3, BufferAttribute, BufferGeometry, DoubleSide, Fog, Group, MathUtils, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import GpuCulling from '@/components/GpuCulling.vue'
import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'
import mouse from '@/makio/utils/input/mouse'
import { createDemoControls } from '@/utils/demoControls'
import { archReach, rangeAndTunnelColor, tunnelWidth } from '@/utils/gpuCullingShading'
import { buildGround, buildRidgelines, buildTunnel, passPoint, TUNNEL_LAPS } from '@/utils/gpuCullingTerrain'

const ROWS = 320
const POINTS_PER_ROW = 1120
const ARCHES = 256
const POINTS_PER_ARCH = 48
const POINTS_PER_LAP = 2048
const CHUNK_SIZE = 128 // triangles
const FLY_SPEED = 0.14 // radians per second around the pass
const LOOK_AHEAD = 0.13
const ALTITUDE = 2.5
const BACKGROUND = 0x070a14
const GROUND = 0x020308
const BEAM = 0xdbeafe
const SNAPSHOT_INTERVAL = 140

// `archReach` is the depth at which the tunnel's arches have faded out: never, seen from above.
const OVERVIEW = { fov: 38, fitAspect: 1.25, near: 1, far: 1400, fogNear: 330, fogFar: 1000, archReach: 1e5 }
const POV = { fov: 62, fitAspect: 0.9, near: 0.5, far: 105, fogNear: 30, fogFar: 105, archReach: 70 }

const ahead = new Vector3()
const beyond = new Vector3()
const chunkBox = new Box3()
const chunkPoint = new Vector3()

/**
 * Chunk bounds for the culling system, which cannot derive them from a line with a width
 * hook. Ours only widens pixels, so the points a chunk draws still bound it.
 */
const chunkBoundsOf = line => {
	const index = line.geometry.getIndex().array
	const position = line.geometry.getAttribute( 'position' )
	return ( { indexStart, indexCount } ) => {
		chunkBox.makeEmpty()
		for ( let i = indexStart; i < indexStart + indexCount; i++ ) {
			chunkBox.expandByPoint( chunkPoint.fromBufferAttribute( position, index[i] ) )
		}
		return chunkBox
	}
}

/** Give `camera` the aspect of its view. Narrower than `fitAspect`, the vertical angle opens so the horizontal one holds. */
const setAspect = ( camera, aspect, { fov, fitAspect = 0 } ) => {
	const spread = Math.tan( MathUtils.degToRad( fov * 0.5 ) ) * Math.max( 1, fitAspect / aspect )
	const fitted = MathUtils.radToDeg( Math.atan( spread ) ) * 2
	if ( camera.aspect === aspect && camera.fov === fitted ) return
	camera.aspect = aspect
	camera.fov = fitted
	camera.updateProjectionMatrix()
}

export default class GpuCullingExample {
	uiComponent = markRaw( GpuCulling )
	hud = reactive( { inset: { shown: false, x: 0, y: 0, width: 0, height: 0 } } )
	// The full-screen view: the flying camera by default, the overview with `?view=overview`.
	povHero = new URLSearchParams( window.location.search ).get( 'view' ) !== 'overview'
	passCamera = new PerspectiveCamera( POV.fov, 1, POV.near, POV.far )
	fog = new Fog( BACKGROUND )
	flight = 0.5
	paused = false
	yaw = 0
	pitch = 0
	snapshotTimer = 0
	metrics = {
		requested: new URLSearchParams( window.location.search ).get( 'culling' ) !== '0',
		backend: 'initializing',
		pointCount: 0,
		indexCount: 0,
		visibleIndexCount: 0,
		get status() { return window.__meshLineCullingHandle?.status ?? null },
	}

	async init() {
		this.updateHud( true )
		await stage3d.initRender( { background: BACKGROUND, fov: OVERVIEW.fov, near: OVERVIEW.near, far: OVERVIEW.far } )
		if ( this.disposed ) return // The visitor left while the renderer was starting.

		stage3d.scene.fog = this.fog
		// A background node is drawn inside the viewport, so it also wipes the inset.
		stage3d.scene.backgroundNode = color( BACKGROUND )
		stage3d.renderer._updateCamera?.( this.passCamera )

		stage3d.orbit( 470, {
			theta: 0.95,
			phi: 0.9,
			minRadius: 140,
			maxRadius: 820,
			minPhi: 0.2,
			maxPhi: 1.4,
			extraThetaMouse: false,
			extraPhiMouse: false,
			autoRotate: 0.00004,
		} )

		this.controls = createDemoControls( [
			{ id: 'culling', label: 'Culling', key: 'C', pressed: true, onClick: () => this.setCulling( !this.metrics.requested ) },
			{ id: 'fly', label: 'Fly', key: 'P', pressed: true, onClick: this.togglePause },
			'divider',
			{ id: 'swap', label: 'Swap views', key: 'V', onClick: this.swapViews },
		], { accent: '#7dd3fc', label: 'GPU culling controls' } )

		this.createLines()
		this.createFrustum()

		stage3d.renderPipeline = { render: this.renderScene }

		this.metrics.backend = stage3d.backend
		this.metrics.indexCount = this.line.geometry.getIndex().count
		window.__meshLineCullingMetrics = this.metrics

		this.setCulling( this.metrics.requested )
		this.syncOrbit()
		this.updateCamera( 0 )
	}

	createLines() {
		// A dim blueprint of the whole scene: against it, what culling keeps is obvious.
		this.ghost = new MeshLine()
			.lines( [...buildRidgelines( ROWS / 4, POINTS_PER_ROW / 4 ), ...buildTunnel( ARCHES / 4, 12, POINTS_PER_LAP / 8 )] )
			.sizeAttenuation( false )
			.lineWidth( 1 )
			.color( 0x1b2f55 )

		this.line = new MeshLine()
			.lines( [...buildRidgelines( ROWS, POINTS_PER_ROW ), ...buildTunnel( ARCHES, POINTS_PER_ARCH, POINTS_PER_LAP )] )
			.sizeAttenuation( false )
			.lineWidth( 1.5 )
			.colorFn( rangeAndTunnelColor )
			.widthFn( tunnelWidth )
			// Hooks keep a progress array by default: these two never read it, and it would be 6 MB.
			.needsProgress( false )
			.build()
		this.chunkBounds = chunkBoundsOf( this.line )

		// The tunnel's points come last. Their vertices, four per point, tell the hooks what they
		// are: 1 on an arch, 2 and up on a rail or a lane, whose fraction sets its own pace.
		const { count } = this.line.addVertexAttribute( 'tunnel' )
		const firstTunnelVertex = ROWS * POINTS_PER_ROW * 4
		const kinds = new Float32Array( count - firstTunnelVertex ).fill( 1 )
		for ( let lap = 0; lap < TUNNEL_LAPS; lap++ ) {
			const start = ( ARCHES * POINTS_PER_ARCH + lap * POINTS_PER_LAP ) * 4
			kinds.fill( 2 + lap * 0.618 % 1, start, start + POINTS_PER_LAP * 4 )
		}
		this.line.setVertexValues( 'tunnel', kinds, firstTunnelVertex )
		this.metrics.pointCount = count / 4

		stage3d.add( buildGround( GROUND, BACKGROUND ), this.ghost, this.line )
	}

	/** The cull camera's frustum, as the beam of light it throws over the range. */
	createFrustum() {
		// Built for a 90° square view, then scaled to the camera's own angles every frame.
		const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map( ( [x, y] ) => [x * POV.far, y * POV.far, -POV.far] )
		// Each side runs from the camera to a far corner, then along the far plane.
		const sides = corners.map( ( corner, i ) => new Float32Array( [0, 0, 0, ...corner, ...corners[( i + 1 ) % 4]] ) )

		const fill = new Float32Array( sides.length * 9 )
		sides.forEach( ( side, i ) => fill.set( side, i * 9 ) )
		this.beam = new Mesh(
			new BufferGeometry().setAttribute( 'position', new BufferAttribute( fill, 3 ) ),
			new MeshBasicNodeMaterial( { color: BEAM, transparent: true, opacity: 0.02, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false } ),
		)
		this.frustumLine = new MeshLine()
			.lines( sides )
			.sizeAttenuation( false )
			.lineWidth( 1.1 )
			.color( BEAM )
			.setFrustumCulled( false )

		this.frustum = new Group().add( this.beam, this.frustumLine )
		this.passCamera.add( this.frustum )
		stage3d.add( this.passCamera )
	}

	/** Attach or detach the line so the same scene doubles as its own draw-all baseline. */
	setCulling( enabled ) {
		this.metrics.requested = enabled
		if ( enabled ) {
			this.culling ??= stage3d.own( MeshLineCullingSystem.attach( stage3d.renderer, stage3d.scene, {
				chunkSize: CHUNK_SIZE,
				cullCamera: this.passCamera,
			} ) )
			this.handle = this.culling.add( this.line, { bounds: this.chunkBounds, worldPadding: 0.6 } )
		} else if ( this.handle ) {
			this.culling.remove( this.handle )
			this.handle = null
		}
		window.__meshLineCullingHandle = this.handle ?? null

		this.frustumLine.color( enabled ? BEAM : 0x64748b )
		this.beam.visible = enabled
		this.controls.setPressed( 'culling', enabled )

		this.snapshot = null
		this.metrics.visibleIndexCount = this.metrics.indexCount
		this.updateHud( true )
	}

	togglePause = () => {
		this.paused = !this.paused
		this.controls.setPressed( 'fly', !this.paused )
	}

	swapViews = () => {
		this.povHero = !this.povHero
		this.syncOrbit()
		this.updateHud( true )
	}

	/** As the mini map, the overview keeps turning but leaves the pointer to the flying camera. */
	syncOrbit() {
		const { control } = stage3d
		control.blockThetaMouse = control.blockPhiMouse = control.blockZoom = control.blockPan = this.povHero
	}

	update = dt => {
		// Request the readback before moving: a snapshot describes the camera the
		// last frame was culled for, and the handle refuses to report a stale one.
		this.snapshotTimer += dt
		if ( this.snapshotTimer >= SNAPSHOT_INTERVAL || ( this.handle?.active && !this.snapshot ) ) {
			this.snapshotTimer = 0
			this.readSnapshot()
			if ( !this.handle ) this.updateHud( true )
		}
		if ( !this.paused ) {
			this.flight = ( this.flight + dt * 0.001 * FLY_SPEED ) % ( Math.PI * 2 )
		}
		this.updateCamera( dt )
		this.updateHud()
	}

	updateCamera( dt ) {
		const { flight, passCamera } = this
		const { position } = passCamera

		// Full screen, the camera also looks where the pointer is.
		const seconds = dt * 0.001
		this.yaw = MathUtils.damp( this.yaw, this.povHero ? -mouse.normalizedX * 0.6 : 0, 3, seconds )
		this.pitch = MathUtils.damp( this.pitch, this.povHero ? -mouse.normalizedY * 0.25 : 0, 3, seconds )

		passPoint( flight, position )
		passPoint( flight + LOOK_AHEAD, ahead )
		passPoint( flight + LOOK_AHEAD * 2, beyond )
		position.y = ALTITUDE + Math.sin( flight * 7 ) * 0.3
		ahead.y = position.y + 0.5
		passCamera.lookAt( ahead )

		// Bank into the bend: how far the pass turns between here and the look-ahead.
		const turn = Math.atan2( beyond.z - ahead.z, beyond.x - ahead.x ) - Math.atan2( ahead.z - position.z, ahead.x - position.x )
		passCamera.rotateY( this.yaw )
		passCamera.rotateX( this.pitch )
		passCamera.rotateZ( Math.sin( turn ) * -0.5 )
		passCamera.updateMatrixWorld()
	}

	/** Both views draw the same scene: one fills the canvas, the other sits in its bottom-left corner. */
	renderScene = () => {
		const { renderer, camera } = stage3d
		const { hud: { inset }, passCamera, povHero } = this
		const { width, height } = stage

		const compact = width < 720
		const margin = compact ? 12 : 18
		inset.width = Math.round( MathUtils.clamp( width * 0.3, 170, 460 ) )
		inset.height = Math.round( inset.width * 0.62 )
		inset.x = margin
		inset.y = height - inset.height - margin - ( compact ? 116 : 0 )
		// A viewport may not leave the canvas: a window too small for the inset goes without it.
		inset.shown = !noUI && inset.y >= 0 && inset.x + inset.width <= width

		// Set both projections before the first draw: culling prepares the pass camera's.
		const insetAspect = inset.width / inset.height
		setAspect( passCamera, povHero ? width / height : insetAspect, POV )
		setAspect( camera, povHero ? insetAspect : width / height, OVERVIEW )
		const spread = Math.tan( MathUtils.degToRad( passCamera.fov * 0.5 ) )
		this.frustum.scale.set( spread * passCamera.aspect, spread, 1 )

		renderer.setScissorTest( true )
		this.renderView( povHero ? passCamera : camera, 0, 0, width, height )
		if ( inset.shown ) {
			// The background node repaints the inset, so only the depth is left to clear.
			renderer.autoClear = false
			renderer.clearDepth()
			this.renderView( povHero ? camera : passCamera, inset.x, inset.y, inset.width, inset.height )
			renderer.autoClear = true
		}
		renderer.setScissorTest( false )
		renderer.setViewport( 0, 0, width, height )
	}

	/** Draw the scene from `viewCamera` into one rectangle of the canvas, in CSS pixels. */
	renderView( viewCamera, x, y, width, height ) {
		const { renderer, scene } = stage3d
		const view = viewCamera === this.passCamera ? POV : OVERVIEW

		// The blueprint and the frustum only belong to the overview.
		this.ghost.visible = this.frustum.visible = view === OVERVIEW
		this.fog.near = view.fogNear
		this.fog.far = view.fogFar
		archReach.value = view.archReach
		for ( const line of [this.line, this.ghost, this.frustumLine] ) line.resize( width, height )

		renderer.setViewport( x, y, width, height )
		renderer.setScissor( x, y, width, height )
		renderer.render( scene, viewCamera )
	}

	/** An explicit, throttled readback: normal rendering never waits on the GPU result. */
	async readSnapshot() {
		const { handle } = this
		if ( !handle?.active || this.snapshotPending ) return
		this.snapshotPending = true
		try {
			const snapshot = await handle.readCullingSnapshot()
			if ( !snapshot || handle !== this.handle ) return
			this.snapshot = snapshot
			this.metrics.visibleIndexCount = snapshot.visibleIndexCount
			this.updateHud( true )
		} catch {
			this.snapshot = null
		} finally {
			this.snapshotPending = false
		}
	}

	/** Runs every frame: unless forced, it only touches the HUD when the handle changed state. */
	updateHud( force ) {
		const { handle, hud } = this
		const { backend, indexCount, requested, visibleIndexCount } = this.metrics

		let state = 'warmup'
		let badge = 'Checking GPU'
		if ( !requested ) {
			state = 'baseline'
			badge = 'Culling off'
		} else if ( handle?.active ) {
			state = 'active'
			badge = 'WebGPU active'
		} else if ( handle?.enabled ) {
			badge = 'WebGPU warm-up'
		} else if ( backend !== 'initializing' ) {
			state = 'fallback'
			badge = backend === 'webgl2' ? 'WebGL2 fallback' : 'Draw-all fallback'
		}
		if ( !force && badge === hud.badge ) return

		const { renderer } = stage3d
		Object.assign( hud, {
			state,
			badge,
			povHero: this.povHero,
			indexCount,
			visibleIndexCount,
			measuring: requested && state !== 'fallback' && !this.snapshot,
			gpuTime: renderer?.backend.trackTimestamp ? renderer.info.render.timestamp + renderer.info.compute.timestamp : null,
		} )
	}

	dispose() {
		this.disposed = true
		window.__meshLineCullingHandle = null
		window.__meshLineCullingMetrics = null
	}
}
