/**
 * GPU Frustum Culling — a 400,000-point alpine pass and its mountain contours in one MeshLine, with per-chunk GPU
 * frustum culling and indirect draw compaction. In God View, the pass camera's frustum glides along the road
 * while the compute pass draws only the chunks inside it.
 * Demonstrates: MeshLineCullingSystem, cullCamera, Overview ("God View") vs Pass POV, and live index compaction telemetry.
 */
import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import { Fn, mix, positionGeometry, sin, smoothstep, vec3, vec4 } from 'three/tsl'
import { BufferAttribute, BufferGeometry, DoubleSide, Fog, Group, MathUtils, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import GpuCulling from '@/components/GpuCulling.vue'
import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import mouse from '@/makio/utils/input/mouse'
import { createDemoControls } from '@/utils/demoControls'
import { buildPassStrands, MAP_BINS, passCentre, samplePassFrame, STRANDS } from '@/utils/gpuCullingPass'

const POINTS_PER_STRAND = 12_500
const GHOST_POINTS_PER_STRAND = 360
const CHUNK_SIZE = 128 // triangles
const CHUNK_COUNT = STRANDS * Math.ceil( POINTS_PER_STRAND * 2 / CHUNK_SIZE )
const FLY_SPEED = 0.048
const LOOK_AHEAD = 0.14
const PASS_NEAR = 2.5
const PASS_FAR = 88
const PASS_FOV = 56
const BACKGROUND = 0x030711
const SNAPSHOT_INTERVAL = 240

const VIEWS = {
	overview: { fov: 46, near: 1, far: 560, fogNear: 220, fogFar: 480 },
	pov: { fov: PASS_FOV, near: PASS_NEAR, far: PASS_FAR, fogNear: 42, fogFar: PASS_FAR },
}

// The frustum corners: 0-3 on the near plane, 4-7 on the far plane.
const FRUSTUM_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
const FRUSTUM_FACES = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]

const lookTarget = new Vector3()
const right = new Vector3()

// Road strands sit near the canyon floor (y < 3.3) and glow icy cyan-white;
// mountain contours step upward through teal, emerald, sunset gold, and coral.
const alpinePassColor = Fn( ( [baseColor, progress] ) => {
	const { x, y } = positionGeometry
	const roadFactor = smoothstep( 2.6, 3.5, y ).oneMinus()
	const midSlope = smoothstep( 3.6, 13.5, y )
	const highSlope = smoothstep( 12, 22, y )
	const summit = smoothstep( 19.5, 30, y )

	const valleyCol = vec3( 0.08, 0.60, 0.94 )
	const tealCol = vec3( 0.18, 0.88, 0.78 )
	const goldCol = vec3( 0.99, 0.76, 0.24 )
	const coralCol = vec3( 1.0, 0.45, 0.55 )
	const roadCol = vec3( 0.78, 0.97, 1.0 )

	const slopes = mix( valleyCol, tealCol, midSlope )
	const ridges = mix( slopes, goldCol, highSlope )
	const terrain = mix( ridges, coralCol, summit )

	const shimmer = sin( progress.mul( Math.PI * 32 ).add( x.mul( 0.05 ) ) ).mul( 0.08 ).add( 0.96 )
	const finalCol = mix( terrain.mul( shimmer ), roadCol, roadFactor )
	return vec4( finalCol.mul( baseColor.rgb ), 1 )
} )

export default class GpuCullingExample {
	uiComponent = markRaw( GpuCulling )
	hud = reactive( {} )
	viewMode = new URLSearchParams( window.location.search ).get( 'view' ) === 'pov' ? 'pov' : 'overview'
	passCamera = new PerspectiveCamera( PASS_FOV, 1, PASS_NEAR, PASS_FAR )
	flight = 2.35
	lookOffset = new Vector3()
	snapshotTimer = 0
	ringBins = new Float32Array( MAP_BINS )
	metrics = {
		requested: new URLSearchParams( window.location.search ).get( 'culling' ) !== '0',
		backend: 'initializing',
		pointCount: STRANDS * POINTS_PER_STRAND,
		indexCount: 0,
		visibleIndexCount: 0,
		get status() { return window.__meshLineCullingHandle?.status ?? null },
	}

	async init() {
		this.updateHud()
		await stage3d.initRender( { background: BACKGROUND } )
		if ( this.disposed ) return // The visitor left while the renderer was starting.

		stage3d.orbit( 195, {
			target: [-8, 6, 0],
			theta: 1.48,
			phi: 0.84,
			minRadius: 60,
			maxRadius: 320,
			minPhi: 0.28,
			maxPhi: 1.36,
			extraThetaMouse: false,
			extraPhiMouse: false,
			autoRotate: 0.000035,
		} )

		// setCulling() and setViewMode() fill in the labels and the pressed states.
		this.controls = createDemoControls( [
			{ id: 'culling', label: '', onClick: () => this.setCulling( !this.metrics.requested ) },
			{ id: 'view', label: '', onClick: () => this.setViewMode( this.viewMode === 'overview' ? 'pov' : 'overview' ) },
		], { accent: '#38bdf8', label: 'GPU culling controls' } )

		this.createLines()
		this.createFrustumVisualizer()
		this.onResize()

		this.metrics.backend = stage3d.backend
		this.metrics.indexCount = this.line.geometry.getIndex().count
		window.__meshLineCullingMetrics = this.metrics

		this.setCulling( this.metrics.requested )
		this.setViewMode( this.viewMode )
	}

	createLines() {
		// Subtle blueprint of the full pass in Overview mode so culled chunks are obvious by contrast.
		this.ghostLine = new MeshLine()
			.lines( buildPassStrands( GHOST_POINTS_PER_STRAND ), true )
			.lineWidth( 0.22 )
			.color( 0x26486e )
			.opacity( 0.28 )
			.setFrustumCulled( false )
			.autoResize()
		this.ghostLine.renderOrder = -1

		this.line = new MeshLine()
			.lines( buildPassStrands( POINTS_PER_STRAND ), true )
			.lineWidth( 0.26 )
			.colorFn( alpinePassColor )
			.join( { type: 'miter', limit: 3 } )
			.autoResize()
			.build()

		stage3d.add( this.ghostLine, this.line )
	}

	/** Build the 3D frustum pyramid once in camera-local space (unit aspect, scaled by aspect). */
	createFrustumVisualizer() {
		const tanHalf = Math.tan( PASS_FOV * MathUtils.DEG2RAD * 0.5 )
		const corners = [PASS_NEAR, PASS_FAR].flatMap( depth => {
			const half = depth * tanHalf
			return [[-half, half, -depth], [half, half, -depth], [half, -half, -depth], [-half, -half, -depth]]
		} )

		const fillPositions = new Float32Array( FRUSTUM_FACES.flatMap( corner => corners[corner] ) )
		this.frustumMesh = new Mesh(
			new BufferGeometry().setAttribute( 'position', new BufferAttribute( fillPositions, 3 ) ),
			new MeshBasicNodeMaterial( { color: 0x38bdf8, transparent: true, depthWrite: false, side: DoubleSide } ),
		)
		this.frustumMesh.frustumCulled = false
		this.frustumMesh.renderOrder = 1

		this.frustumLine = new MeshLine()
			.lines( FRUSTUM_EDGES.map( ( [a, b] ) => new Float32Array( [...corners[a], ...corners[b]] ) ), false )
			.lineWidth( 0.28 )
			.opacity( 0.85 )
			.setFrustumCulled( false )
			.autoResize()
		this.frustumLine.renderOrder = 2

		this.frustumGroup = new Group().add( this.frustumMesh, this.frustumLine )
		this.passCamera.add( this.frustumGroup )
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
			this.handle = this.culling.add( this.line )
		} else if ( this.handle ) {
			this.culling.remove( this.handle )
			this.handle = null
		}
		window.__meshLineCullingHandle = this.handle ?? null

		this.frustumLine.color( enabled ? 0x67e8f9 : 0x64748b )
		this.frustumMesh.material.opacity = enabled ? 0.06 : 0.02
		this.controls.setLabel( 'culling', enabled ? 'Culling: ON' : 'Culling: OFF' )
		this.controls.setPressed( 'culling', enabled )

		this.snapshot = null
		this.ringBins.fill( enabled ? 0 : 1 )
		this.metrics.visibleIndexCount = this.metrics.indexCount
		this.updateHud( true )
	}

	setViewMode( mode ) {
		this.viewMode = mode
		const isOverview = mode === 'overview'
		this.ghostLine.visible = isOverview
		this.frustumGroup.visible = isOverview

		const { fov, near, far, fogNear, fogFar } = VIEWS[mode]
		stage3d.scene.fog = new Fog( BACKGROUND, fogNear, fogFar )
		Object.assign( stage3d.camera, { fov, near, far } )
		stage3d.camera.updateProjectionMatrix()

		if ( isOverview ) {
			stage3d.control.enable()
			stage3d.control.update()
		} else {
			stage3d.control.disable()
		}

		this.updateCamera( 0 )
		this.controls.setLabel( 'view', isOverview ? 'Camera POV' : 'God View' )
		this.controls.setPressed( 'view', !isOverview )
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
		this.flight = ( this.flight + dt * 0.001 * FLY_SPEED ) % ( Math.PI * 2 )
		this.updateCamera( dt )
		this.updateHud()
	}

	onResize = () => {
		this.passCamera.aspect = stage.width / Math.max( 1, stage.height )
		this.passCamera.updateProjectionMatrix()
		this.frustumGroup.scale.x = this.passCamera.aspect
	}

	updateCamera( dt ) {
		const { flight, lookOffset, passCamera } = this
		const isPov = this.viewMode === 'pov'
		const blend = 1 - Math.pow( 0.04, dt * 0.001 )
		lookOffset.x = MathUtils.lerp( lookOffset.x, isPov ? mouse.normalizedX * 2.2 : 0, blend )
		lookOffset.y = MathUtils.lerp( lookOffset.y, isPov ? -mouse.normalizedY * 1.6 : 0, blend )

		const bank = samplePassFrame( flight, passCamera.position, right )
		passCentre( flight + LOOK_AHEAD, lookTarget )

		passCamera.position.addScaledVector( right, lookOffset.x )
		passCamera.position.y += 3.8 + lookOffset.y
		lookTarget.y += 4.6 + lookOffset.y * 0.7

		const roll = Math.sin( bank * 0.55 )
		passCamera.up.set( -right.x * roll, Math.cos( bank * 0.55 ), -right.z * roll ).normalize()
		passCamera.lookAt( lookTarget )
		passCamera.updateMatrixWorld()

		if ( isPov ) {
			stage3d.camera.position.copy( passCamera.position )
			stage3d.camera.quaternion.copy( passCamera.quaternion )
			stage3d.camera.updateMatrixWorld()
		}
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
			this.ringBins.fill( 0 )
			const indicesPerStrand = this.metrics.indexCount / STRANDS
			for ( const chunk of snapshot.visibleChunks ) {
				const local = ( chunk.indexStart % indicesPerStrand ) / indicesPerStrand
				this.ringBins[Math.floor( local * MAP_BINS )]++
			}
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

		if ( state === 'fallback' ) this.ringBins.fill( 1 )
		const { renderer } = stage3d
		Object.assign( hud, {
			state,
			badge,
			chunkCount: handle?.chunkCount || CHUNK_COUNT,
			indexCount,
			visibleIndexCount,
			flight: this.flight,
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
