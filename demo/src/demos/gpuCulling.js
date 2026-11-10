/**
 * GPU Frustum Culling — a 400,000-point alpine highway pass, overhead portals, and 3D topographic
 * mountain lattice in one MeshLine, with per-chunk GPU frustum culling and indirect draw compaction.
 * Split View shows the external God View (with the 3D camera rig, frustum pyramid, and dim culled
 * blueprint) side-by-side with the live Camera POV rendered from the same compacted indirect buffer.
 */
import { circlePositions, MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import { Fn, mix, positionGeometry, sin, smoothstep, vec3, vec4 } from 'three/tsl'
import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Fog, Group, MathUtils, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import GpuCulling from '@/components/GpuCulling.vue'
import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import mouse from '@/makio/utils/input/mouse'
import { createDemoControls } from '@/utils/demoControls'
import { ARCH_COUNT, buildPassLines, LOOP_STRANDS, MAP_BINS, passCentre, samplePassFrame } from '@/utils/gpuCullingPass'

const POINTS_PER_STRAND = 16_000
const ARCH_POINTS = 64
const GHOST_POINTS_PER_STRAND = 480
const GHOST_ARCH_POINTS = 20
const CHUNK_SIZE = 128 // triangles
const CHUNKS_PER_RING = Math.ceil( POINTS_PER_STRAND * 2 / CHUNK_SIZE )
const CHUNK_COUNT = LOOP_STRANDS * CHUNKS_PER_RING + ARCH_COUNT
const FLY_SPEED = 0.16
const LOOK_AHEAD = 0.085
const PASS_NEAR = 2.0
const PASS_FAR = 88
const PASS_FOV = 58
const BACKGROUND = 0x030711
const SNAPSHOT_INTERVAL = 140
const OVERVIEW_RADIUS = 195
const SPLIT_FIT_ASPECT = 1.05

const VIEWS = {
	overview: { fov: 46, near: 1, far: 620, fogNear: 240, fogFar: 540 },
	pov: { fov: PASS_FOV, near: PASS_NEAR, far: PASS_FAR, fogNear: 44, fogFar: PASS_FAR },
}

// The frustum corners: 0-3 on the near plane, 4-7 on the far plane.
const FRUSTUM_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
const FRUSTUM_FACES = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]

const lookTarget = new Vector3()
const right = new Vector3()

const initialViewMode = () => {
	const mode = new URLSearchParams( window.location.search ).get( 'view' )
	if ( mode === 'pov' || mode === 'overview' ) return mode
	return 'split'
}

// Highway lanes sit on the canyon floor (y < 0.45) and glow icy cyan-white;
// the 250 freestanding tunnel arches (0.6..6.5) glow electric sky-blue;
// mountain contours (y > 6.8) step upward through teal, emerald, amber-gold, and coral.
const alpinePassColor = Fn( ( [baseColor, progress] ) => {
	const { x, y } = positionGeometry
	const roadFactor = smoothstep( 0.38, 0.85, y ).oneMinus()
	const portalFactor = smoothstep( 0.38, 0.85, y ).mul( smoothstep( 6.2, 6.8, y ).oneMinus() )
	const archCrown = smoothstep( 1.0, 5.4, y )
	const midSlope = smoothstep( 7.2, 16.0, y )
	const highSlope = smoothstep( 15.0, 25.5, y )
	const summit = smoothstep( 23.5, 34.5, y )

	const valleyCol = vec3( 0.08, 0.58, 0.92 )
	const tealCol = vec3( 0.16, 0.92, 0.78 )
	const goldCol = vec3( 0.99, 0.78, 0.24 )
	const coralCol = vec3( 1.0, 0.44, 0.58 )
	const roadCol = vec3( 0.90, 0.99, 1.0 )
	const portalCol = mix( vec3( 0.18, 0.76, 1.0 ), vec3( 0.52, 0.95, 1.0 ), archCrown )

	const slopes = mix( valleyCol, tealCol, midSlope )
	const ridges = mix( slopes, goldCol, highSlope )
	const terrain = mix( ridges, coralCol, summit )

	const shimmer = sin( progress.mul( Math.PI * 48 ).add( x.mul( 0.04 ) ) ).mul( 0.05 ).add( 0.96 )
	const withPortals = mix( terrain.mul( shimmer ), portalCol, portalFactor )
	const finalCol = mix( withPortals, roadCol, roadFactor )
	return vec4( finalCol.mul( baseColor.rgb ), 1 )
} )

const boxEdges = ( w, h, d, cx = 0, cy = 0, cz = 0 ) => {
	const hx = w * 0.5, hy = h * 0.5, hz = d * 0.5
	const pts = [
		[cx - hx, cy + hy, cz - hz],
		[cx + hx, cy + hy, cz - hz],
		[cx + hx, cy - hy, cz - hz],
		[cx - hx, cy - hy, cz - hz],
		[cx - hx, cy + hy, cz + hz],
		[cx + hx, cy + hy, cz + hz],
		[cx + hx, cy - hy, cz + hz],
		[cx - hx, cy - hy, cz + hz],
	]
	return FRUSTUM_EDGES.map( ( [a, b] ) => new Float32Array( [...pts[a], ...pts[b]] ) )
}

const circleInYZ = ( radius, cx, cy, cz, segments = 24 ) => {
	const flat = circlePositions( segments, radius )
	const out = new Float32Array( flat.length )
	for ( let i = 0; i < flat.length; i += 3 ) {
		out[i] = cx
		out[i + 1] = cy + flat[i + 1]
		out[i + 2] = cz + flat[i]
	}
	return out
}

export default class GpuCullingExample {
	uiComponent = markRaw( GpuCulling )
	hud = reactive( {} )
	viewMode = initialViewMode()
	passCamera = new PerspectiveCamera( PASS_FOV, 1, PASS_NEAR, PASS_FAR )
	fog = new Fog( BACKGROUND, VIEWS.overview.fogNear, VIEWS.overview.fogFar )
	flight = 2.35
	paused = false
	lookOffset = new Vector3()
	snapshotTimer = 0
	ringBins = new Float32Array( MAP_BINS )
	metrics = {
		requested: new URLSearchParams( window.location.search ).get( 'culling' ) !== '0',
		backend: 'initializing',
		pointCount: LOOP_STRANDS * POINTS_PER_STRAND + ARCH_COUNT * ARCH_POINTS,
		indexCount: 0,
		visibleIndexCount: 0,
		get status() { return window.__meshLineCullingHandle?.status ?? null },
	}

	async init() {
		this.updateHud( true )
		await stage3d.initRender( {
			background: BACKGROUND,
			fov: VIEWS.overview.fov,
			near: VIEWS.overview.near,
			far: VIEWS.overview.far,
		} )
		if ( this.disposed ) return // The visitor left while the renderer was starting.

		stage3d.scene.fog = this.fog
		stage3d.renderer._updateCamera?.( this.passCamera )

		stage3d.orbit( OVERVIEW_RADIUS, {
			target: [-6, 8, 0],
			theta: 1.42,
			phi: 0.88,
			minRadius: 55,
			maxRadius: 360,
			minPhi: 0.26,
			maxPhi: 1.36,
			extraThetaMouse: false,
			extraPhiMouse: false,
			autoRotate: 0.000035,
		} )

		this.controls = createDemoControls( [
			{ id: 'culling', label: '', key: 'C', onClick: () => this.setCulling( !this.metrics.requested ) },
			{ id: 'motion', label: 'Fly', key: 'P', pressed: true, onClick: this.togglePause },
			'divider',
			{ id: 'split', label: 'Split View', key: '1', pressed: this.viewMode === 'split', onClick: () => this.setViewMode( 'split' ) },
			{ id: 'overview', label: 'God View', key: '2', pressed: this.viewMode === 'overview', onClick: () => this.setViewMode( 'overview' ) },
			{ id: 'pov', label: 'Camera POV', key: '3', pressed: this.viewMode === 'pov', onClick: () => this.setViewMode( 'pov' ) },
		], { accent: '#38bdf8', label: 'GPU culling controls' } )

		this.createLines()
		this.createFrustumVisualizer()

		stage3d.renderPipeline = { render: this.renderScene }
		this.onResize()

		this.metrics.backend = stage3d.backend
		this.metrics.indexCount = this.line.geometry.getIndex().count
		window.__meshLineCullingMetrics = this.metrics

		this.setCulling( this.metrics.requested )
		this.setViewMode( this.viewMode )
	}

	createLines() {
		// Dim blueprint of the full 3D pass in God View so culled chunks are obvious by contrast.
		const ghostPass = buildPassLines( GHOST_POINTS_PER_STRAND, GHOST_ARCH_POINTS )
		this.ghostLine = new MeshLine()
			.lines( ghostPass.lines, ghostPass.closed )
			.sizeAttenuation( false )
			.lineWidth( 1.2 )
			.color( 0x1e3f66 )
			.opacity( 0.36 )
			.setFrustumCulled( false )
		this.ghostLine.renderOrder = -1

		const mainPass = buildPassLines( POINTS_PER_STRAND, ARCH_POINTS )
		this.line = new MeshLine()
			.lines( mainPass.lines, mainPass.closed )
			.sizeAttenuation( false )
			.lineWidth( 2.0 )
			.colorFn( alpinePassColor )
			.join( { type: 'miter', limit: 3 } )
			.build()

		stage3d.add( this.ghostLine, this.line )
	}

	/**
	 * Build both the 3D cinema camera object (unscaled so its body and reels keep true
	 * proportions) and the 3D frustum pyramid (scaled horizontally by passCamera.aspect).
	 */
	createFrustumVisualizer() {
		const tanHalf = Math.tan( PASS_FOV * MathUtils.DEG2RAD * 0.5 )
		const corners = [PASS_NEAR, PASS_FAR].flatMap( depth => {
			const half = depth * tanHalf
			return [[-half, half, -depth], [half, half, -depth], [half, -half, -depth], [-half, -half, -depth]]
		} )

		const fillPositions = new Float32Array( FRUSTUM_FACES.flatMap( corner => corners[corner] ) )
		this.frustumMesh = new Mesh(
			new BufferGeometry().setAttribute( 'position', new BufferAttribute( fillPositions, 3 ) ),
			new MeshBasicNodeMaterial( { color: 0x38bdf8, transparent: true, opacity: 0.065, depthWrite: false, side: DoubleSide } ),
		)
		this.frustumMesh.frustumCulled = false
		this.frustumMesh.renderOrder = 1

		// Near-plane lens quad + 4 apex rays from the camera lens [0, 0, 0] to the near plane.
		const apexEdges = [0, 1, 2, 3].map( i => new Float32Array( [0, 0, 0, ...corners[i]] ) )
		const mainEdges = FRUSTUM_EDGES.map( ( [a, b] ) => new Float32Array( [...corners[a], ...corners[b]] ) )

		this.frustumLine = new MeshLine()
			.lines( [...apexEdges, ...mainEdges], false )
			.sizeAttenuation( false )
			.lineWidth( 2.2 )
			.color( 0x67e8f9 )
			.opacity( 0.92 )
			.setFrustumCulled( false )
		this.frustumLine.renderOrder = 2

		// Depth-slice rings at 35% and 70% of the frustum + center optical axis ray.
		const sliceLines = [0.35, 0.7].flatMap( frac => {
			const d = MathUtils.lerp( PASS_NEAR, PASS_FAR, frac )
			const h = d * tanHalf
			const c = [[-h, h, -d], [h, h, -d], [h, -h, -d], [-h, -h, -d]]
			return [[0, 1], [1, 2], [2, 3], [3, 0]].map( ( [a, b] ) => new Float32Array( [...c[a], ...c[b]] ) )
		} )
		const farCross = PASS_FAR * tanHalf * 0.16
		sliceLines.push(
			new Float32Array( [0, 0, -PASS_NEAR, 0, 0, -PASS_FAR] ),
			new Float32Array( [-farCross, 0, -PASS_FAR, farCross, 0, -PASS_FAR] ),
			new Float32Array( [0, -farCross, -PASS_FAR, 0, farCross, -PASS_FAR] ),
		)

		this.frustumGridLine = new MeshLine()
			.lines( sliceLines, false )
			.sizeAttenuation( false )
			.lineWidth( 1.2 )
			.color( 0x38bdf8 )
			.opacity( 0.42 )
			.setFrustumCulled( false )
		this.frustumGridLine.renderOrder = 2

		this.frustumGroup = new Group().add( this.frustumMesh, this.frustumGridLine, this.frustumLine )

		// 3D Camera Object at the apex of the frustum: body chassis, dual top film reels, and lens barrel.
		const bodyMat = new MeshBasicNodeMaterial( { color: 0x0f172a } )
		const accentMat = new MeshBasicNodeMaterial( { color: 0x38bdf8 } )
		const beaconMat = new MeshBasicNodeMaterial( { color: 0xfef08a } )

		const chassis = new Mesh( new BoxGeometry( 3.2, 2.4, 4.4 ), bodyMat )
		chassis.position.set( 0, 0, 2.6 )

		const lensBarrel = new Mesh( new CylinderGeometry( 1.05, 1.25, 1.6, 20 ), bodyMat )
		lensBarrel.rotation.x = Math.PI * 0.5
		lensBarrel.position.set( 0, 0, -0.3 )

		const reelGeo = new CylinderGeometry( 1.35, 1.35, 0.85, 24 )
		reelGeo.rotateZ( Math.PI * 0.5 )
		const frontReel = new Mesh( reelGeo, bodyMat )
		frontReel.position.set( 0, 2.25, 1.4 )
		const rearReel = new Mesh( reelGeo, bodyMat )
		rearReel.position.set( 0, 2.25, 4.0 )

		const lensRim = new Mesh( new CylinderGeometry( 1.18, 1.18, 0.22, 20 ), accentMat )
		lensRim.rotation.x = Math.PI * 0.5
		lensRim.position.set( 0, 0, -1.05 )

		const tallyBeacon = new Mesh( new BoxGeometry( 0.7, 0.45, 0.7 ), beaconMat )
		tallyBeacon.position.set( 0, 1.45, 0.0 )

		// Crisp wireframe silhouette around the 3D camera body, matte box hood, and dual top reels.
		const camWires = [
			...boxEdges( 3.28, 2.48, 4.48, 0, 0, 2.6 ),
			...boxEdges( 2.6, 2.0, 1.2, 0, 0, -0.9 ),
			circleInYZ( 1.38, -0.45, 2.25, 1.4 ),
			circleInYZ( 1.38, 0.45, 2.25, 1.4 ),
			circleInYZ( 1.38, -0.45, 2.25, 4.0 ),
			circleInYZ( 1.38, 0.45, 2.25, 4.0 ),
		]
		this.cameraWireLine = new MeshLine()
			.lines( camWires, false )
			.sizeAttenuation( false )
			.lineWidth( 1.6 )
			.color( 0xe0f2fe )
			.setFrustumCulled( false )
		this.cameraWireLine.renderOrder = 3

		this.cameraAccentMat = accentMat
		this.cameraRig = new Group().add( chassis, lensBarrel, frontReel, rearReel, lensRim, tallyBeacon, this.cameraWireLine )
		for ( const child of this.cameraRig.children ) child.frustumCulled = false

		this.passCamera.add( this.frustumGroup, this.cameraRig )
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
			this.handle = this.culling.add( this.line, { worldPadding: 0.6 } )
		} else if ( this.handle ) {
			this.culling.remove( this.handle )
			this.handle = null
		}
		window.__meshLineCullingHandle = this.handle ?? null

		this.frustumLine.color( enabled ? 0x67e8f9 : 0x64748b )
		this.frustumGridLine.color( enabled ? 0x38bdf8 : 0x475569 )
		this.cameraWireLine.color( enabled ? 0xe0f2fe : 0x94a3b8 )
		this.cameraAccentMat.color.setHex( enabled ? 0x38bdf8 : 0x64748b )
		this.frustumMesh.material.opacity = enabled ? 0.065 : 0.02
		this.controls.setLabel( 'culling', enabled ? 'Culling: ON' : 'Culling: OFF' )
		this.controls.setPressed( 'culling', enabled )

		this.snapshot = null
		this.ringBins.fill( enabled ? 0 : 1 )
		this.metrics.visibleIndexCount = this.metrics.indexCount
		this.updateHud( true )
	}

	togglePause = () => {
		this.paused = !this.paused
		this.controls.setLabel( 'motion', this.paused ? 'Paused' : 'Fly' )
		this.controls.setPressed( 'motion', !this.paused )
		this.updateHud( true )
	}

	setViewMode( mode ) {
		this.viewMode = mode
		const isPovOnly = mode === 'pov'

		if ( isPovOnly ) {
			stage3d.control.disable()
		} else {
			stage3d.control.enable()
			stage3d.control.update()
		}

		for ( const id of ['split', 'overview', 'pov'] ) {
			this.controls.setPressed( id, id === mode )
		}

		this.onResize()
		this.updateCamera( 0 )
		this.updateHud( true )
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

	onResize = () => {
		const w = Math.max( 1, stage.width )
		const h = Math.max( 1, stage.height )
		const isSplit = this.viewMode === 'split'
		const landscape = w >= h
		const paneW = isSplit && landscape ? Math.max( 1, Math.floor( w * 0.5 ) ) : w
		const paneH = isSplit && !landscape ? Math.max( 1, Math.floor( h * 0.5 ) ) : h
		const paneAspect = paneW / paneH

		this.passCamera.aspect = paneAspect
		this.passCamera.updateProjectionMatrix()
		this.frustumGroup.scale.x = paneAspect

		stage3d.camera.aspect = paneAspect
		stage3d.camera.updateProjectionMatrix()

		if ( stage3d.control && this.viewMode !== 'pov' ) {
			const fitScale = Math.max( 1, SPLIT_FIT_ASPECT / paneAspect )
			stage3d.control.snapRadius( Math.min( stage3d.control.maxRadius, OVERVIEW_RADIUS * fitScale ) )
			stage3d.control.place()
		}

		this.line?.resize( paneW, paneH )
		this.ghostLine?.resize( paneW, paneH )
		this.frustumLine?.resize( paneW, paneH )
		this.frustumGridLine?.resize( paneW, paneH )
		this.cameraWireLine?.resize( paneW, paneH )
	}

	updateCamera( dt ) {
		const { flight, lookOffset, passCamera } = this
		const isPov = this.viewMode === 'pov'
		const blend = 1 - Math.pow( 0.04, dt * 0.001 )
		lookOffset.x = MathUtils.lerp( lookOffset.x, isPov ? mouse.normalizedX * 2.0 : 0, blend )
		lookOffset.y = MathUtils.lerp( lookOffset.y, isPov ? -mouse.normalizedY * 1.2 : 0, blend )

		const bank = samplePassFrame( flight, passCamera.position, right )
		passCentre( flight + LOOK_AHEAD, lookTarget )

		passCamera.position.addScaledVector( right, lookOffset.x )
		passCamera.position.y += 2.25 + lookOffset.y
		lookTarget.y += 2.35 + lookOffset.y * 0.7

		const roll = Math.sin( bank * 0.55 )
		passCamera.up.set( -right.x * roll, Math.cos( bank * 0.55 ), -right.z * roll ).normalize()
		passCamera.lookAt( lookTarget )
		passCamera.updateMatrixWorld()
	}

	renderScene = () => {
		const { renderer, scene, camera } = stage3d
		const w = Math.max( 1, stage.width )
		const h = Math.max( 1, stage.height )

		if ( this.viewMode !== 'split' ) {
			const isOverview = this.viewMode === 'overview'
			const view = VIEWS[isOverview ? 'overview' : 'pov']
			this.ghostLine.visible = isOverview
			this.frustumGroup.visible = isOverview
			this.cameraRig.visible = isOverview
			this.fog.near = view.fogNear
			this.fog.far = view.fogFar

			renderer.setScissorTest( false )
			renderer.setViewport( 0, 0, w, h )
			renderer.autoClear = true
			renderer.render( scene, isOverview ? camera : this.passCamera )
			return
		}

		const landscape = w >= h
		const w1 = landscape ? Math.floor( w * 0.5 ) : w
		const h1 = landscape ? h : Math.floor( h * 0.5 )
		const x2 = landscape ? w1 : 0
		const y2 = landscape ? 0 : h1
		const w2 = w - x2
		const h2 = h - y2
		const paneAspect = w1 / Math.max( 1, h1 )

		if ( Math.abs( camera.aspect - paneAspect ) > 1e-4 ) {
			camera.aspect = paneAspect
			camera.updateProjectionMatrix()
		}

		renderer.setScissorTest( false )
		renderer.setViewport( 0, 0, w, h )
		renderer.clear( true, true, false )
		renderer.autoClear = false
		renderer.setScissorTest( true )

		// Scene 1 (Left / Top): External God View showing the 3D camera rig, frustum, and culled blueprint.
		this.ghostLine.visible = true
		this.frustumGroup.visible = true
		this.cameraRig.visible = true
		this.fog.near = VIEWS.overview.fogNear
		this.fog.far = VIEWS.overview.fogFar
		renderer.setViewport( 0, 0, w1, h1 )
		renderer.setScissor( 0, 0, w1, h1 )
		renderer.render( scene, camera )

		// Scene 2 (Right / Bottom): Live Camera POV rendered from the exact same GPU-culled indirect buffer.
		this.ghostLine.visible = false
		this.frustumGroup.visible = false
		this.cameraRig.visible = false
		this.fog.near = VIEWS.pov.fogNear
		this.fog.far = VIEWS.pov.fogFar
		renderer.setViewport( x2, y2, w2, h2 )
		renderer.setScissor( x2, y2, w2, h2 )
		renderer.render( scene, this.passCamera )

		this.ghostLine.visible = true
		this.frustumGroup.visible = true
		this.cameraRig.visible = true
		renderer.setScissorTest( false )
		renderer.setViewport( 0, 0, w, h )
		renderer.autoClear = true
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
			for ( const chunk of snapshot.visibleChunks ) {
				const local = ( chunk.chunkIndex % CHUNKS_PER_RING ) / CHUNKS_PER_RING
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

		hud.flight = this.flight
		if ( !force && badge === hud.badge && this.viewMode === hud.viewMode ) return

		if ( state === 'fallback' ) this.ringBins.fill( 1 )
		const { renderer } = stage3d
		Object.assign( hud, {
			state,
			badge,
			viewMode: this.viewMode,
			culling: requested,
			chunkCount: handle?.chunkCount || CHUNK_COUNT,
			visibleChunkCount: this.snapshot?.visibleChunkCount ?? ( requested ? 0 : CHUNK_COUNT ),
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
