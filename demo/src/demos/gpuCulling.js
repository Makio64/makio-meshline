import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import { float, Fn, mix, positionGeometry, sin, smoothstep, vec3, vec4 } from 'three/tsl'
import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Fog,
	Group,
	Mesh,
	MeshBasicNodeMaterial,
	PerspectiveCamera,
	Vector3,
} from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import mouse from '@/makio/utils/input/mouse'

// A 400,000-point winding alpine ribbon pass and surrounding topographic
// mountain contours in one MeshLine. In Overview ("God View"), the pass
// camera's 3D frustum pyramid glides along the road while the GPU compute pass
// compacts and draws only the chunks inside the pyramid.
const ROAD_STRANDS = 8
const CONTOUR_STRANDS = 24
const STRANDS = ROAD_STRANDS + CONTOUR_STRANDS
const POINTS_PER_STRAND = 12_500
const POINT_COUNT = STRANDS * POINTS_PER_STRAND
const GHOST_POINTS_PER_STRAND = 360
const FLY_SPEED = 0.048
const LOOK_AHEAD = 0.14
const PASS_NEAR = 2.5
const PASS_FAR = 88
const PASS_FOV = 56
const BACKGROUND = 0x030711
const SNAPSHOT_INTERVAL = 240
const MAP_BINS = 180
const MAP_SIZE = 74

const ROAD_OFFSETS = [-3.2, -2.6, -1.6, -0.18, 0.18, 1.6, 2.6, 3.2]

const formatCount = value => {
	if ( value >= 1_000_000 ) return `${( value / 1_000_000 ).toFixed( 2 )}M`
	if ( value >= 1_000 ) return `${( value / 1_000 ).toFixed( value >= 100_000 ? 0 : 1 )}K`
	return String( value )
}

const passRadius = angle => 58 + Math.sin( angle * 2 - 0.45 ) * 11 + Math.cos( angle * 3 + 0.7 ) * 8.5
const passHeight = angle => Math.sin( angle * 2 - 0.3 ) * 1.8 + Math.cos( angle * 3 + 0.85 ) * 0.9

/** Centre of the winding alpine pass at `angle` around the valley route. */
const passCentre = ( angle, target ) => {
	const r = passRadius( angle )
	const x = Math.cos( angle ) * r * 1.34 + Math.sin( angle * 2 + 0.5 ) * 9
	const z = Math.sin( angle ) * r * 0.82 + Math.cos( angle * 3 - 0.3 ) * 7
	return target.set( x, passHeight( angle ), z )
}

/** Smooth outward radial frame (never cusps or self-intersects on tight bends). */
const samplePassFrame = ( angle, centre, tangent, right ) => {
	const step = 1.5e-3
	passCentre( angle, centre )
	passCentre( angle + step, tangent )
	const dx = tangent.x - centre.x
	const dy = tangent.y - centre.y
	const dz = tangent.z - centre.z
	const len = Math.hypot( dx, dy, dz ) || 1
	tangent.set( dx / len, dy / len, dz / len )

	// Smooth outward direction from the valley floor so wide contour tiers never loop at bends.
	const rx = Math.cos( angle ) * 1.34 + Math.cos( angle * 2 + 0.5 ) * 0.18
	const rz = Math.sin( angle ) * 0.82 - Math.sin( angle * 3 - 0.3 ) * 0.14
	const rLen = Math.hypot( rx, rz ) || 1
	right.set( rx / rLen, 0, rz / rLen )

	const hLen = Math.hypot( dx, dz ) || 1
	const prevX = Math.cos( angle - step ) * passRadius( angle - step ) * 1.34 + Math.sin( ( angle - step ) * 2 + 0.5 ) * 9
	const prevZ = Math.sin( angle - step ) * passRadius( angle - step ) * 0.82 + Math.cos( ( angle - step ) * 3 - 0.3 ) * 7
	const ddx = ( centre.x + dx ) - 2 * centre.x + prevX
	const ddz = ( centre.z + dz ) - 2 * centre.z + prevZ
	const cross = ( dx * ddz - dz * ddx ) / Math.pow( hLen, 3 )
	return Math.max( -0.28, Math.min( 0.28, cross * 32 ) )
}

/** Sculpted alpine mountain ridges rising on both sides of the canyon pass. */
const mountainProfile = ( angle, side, tier, maxTiers ) => {
	const tierFrac = ( tier + 1 ) / maxTiers
	const p1 = Math.pow( Math.max( 0, Math.cos( angle - 0.35 ) ), 2.0 ) * 22
	const p2 = Math.pow( Math.max( 0, Math.cos( angle - 1.85 ) ), 2.4 ) * 28
	const p3 = Math.pow( Math.max( 0, Math.cos( angle - 3.25 ) ), 2.0 ) * 20
	const p4 = Math.pow( Math.max( 0, Math.cos( angle - 4.65 ) ), 2.3 ) * 26
	const p5 = Math.pow( Math.max( 0, Math.cos( angle - 5.55 ) ), 2.5 ) * 18
	const sidePhase = side > 0 ? 0 : 1.1
	const ridge = 6.5
		+ ( p1 + p2 + p3 + p4 + p5 ) * ( side > 0 ? 1.0 : 0.78 )
		+ Math.sin( angle * 5 + sidePhase ) * 3.2
		+ Math.cos( angle * 9 - tier * 0.4 + sidePhase ) * 1.6
	const height = 3.6 + Math.pow( tierFrac, 1.12 ) * Math.max( 6, ridge )
	const maxSpan = side > 0 ? 32 : 21
	const spur = 1 + Math.sin( angle * 6 + tier * 0.3 + sidePhase ) * 0.08
	const lateral = ( 4.4 + tierFrac * maxSpan ) * spur
	return { lateral: side * lateral, height }
}

const buildPassStrands = pointsPerStrand => {
	const strands = []
	const centre = new Vector3()
	const tangent = new Vector3()
	const right = new Vector3()
	const outerTiers = 14
	const innerTiers = CONTOUR_STRANDS - outerTiers

	for ( let strand = 0; strand < STRANDS; strand++ ) {
		const points = new Float32Array( pointsPerStrand * 3 )
		const isRoad = strand < ROAD_STRANDS
		const roadOffset = isRoad ? ROAD_OFFSETS[strand] : 0
		const isGuardrail = isRoad && ( strand === 0 || strand === ROAD_STRANDS - 1 )
		const contourIndex = strand - ROAD_STRANDS
		const side = contourIndex < outerTiers ? 1 : -1
		const tier = side > 0 ? contourIndex : contourIndex - outerTiers
		const maxTiers = side > 0 ? outerTiers : innerTiers

		for ( let i = 0; i < pointsPerStrand; i++ ) {
			const u = i / pointsPerStrand * Math.PI * 2
			const bank = samplePassFrame( u, centre, tangent, right )
			const offset = i * 3

			if ( isRoad ) {
				const cosB = Math.cos( bank )
				const sinB = Math.sin( bank )
				const lift = isGuardrail ? 0.22 : 0.04
				points[offset] = centre.x + right.x * roadOffset * cosB
				points[offset + 1] = centre.y + roadOffset * sinB + lift
				points[offset + 2] = centre.z + right.z * roadOffset * cosB
			} else {
				const { lateral, height } = mountainProfile( u, side, tier, maxTiers )
				points[offset] = centre.x + right.x * lateral
				points[offset + 1] = centre.y + height
				points[offset + 2] = centre.z + right.z * lateral
			}
		}
		strands.push( points )
	}

	return strands
}

// Road strands sit near the canyon floor (y < 3.3) and glow icy cyan-white;
// mountain contours step upward through teal, emerald, sunset gold, and coral.
const alpinePassColor = Fn( ( [baseColor, progress] ) => {
	const pos = positionGeometry
	const y = pos.y
	const roadFactor = float( 1 ).sub( smoothstep( float( 2.6 ), float( 3.5 ), y ) )
	const midSlope = smoothstep( float( 3.6 ), float( 13.5 ), y )
	const highSlope = smoothstep( float( 12.0 ), float( 22.0 ), y )
	const summit = smoothstep( float( 19.5 ), float( 30.0 ), y )

	const valleyCol = vec3( 0.08, 0.60, 0.94 )
	const tealCol = vec3( 0.18, 0.88, 0.78 )
	const goldCol = vec3( 0.99, 0.76, 0.24 )
	const coralCol = vec3( 1.0, 0.45, 0.55 )

	let terrain = mix( valleyCol, tealCol, midSlope )
	terrain = mix( terrain, goldCol, highSlope )
	terrain = mix( terrain, coralCol, summit )

	const shimmer = sin( progress.mul( Math.PI * 32 ).add( pos.x.mul( 0.05 ) ) ).mul( 0.08 ).add( 0.96 )
	const roadCol = vec3( 0.78, 0.97, 1.0 )
	const finalCol = mix( terrain.mul( shimmer ), roadCol, roadFactor )
	return vec4( finalCol.mul( baseColor.rgb ), 1 )
} )

class GpuCullingExample {
	constructor() {
		this.text = ''
		this.line = null
		this.ghostLine = null
		this.frustumGroup = null
		this.frustumLine = null
		this.frustumMesh = null
		this.culling = null
		this.handle = null
		this.metrics = null
		this.control = null
		this.controlActive = false
		this.passCamera = null
		this.hud = null
		this.hudStyle = null
		this.hudElements = null
		this.hudState = {
			requested: null,
			viewMode: '',
			backend: '',
			indexCount: -1,
			active: null,
			enabled: null,
			chunkCount: -1,
			reason: '',
		}
		const params = new URLSearchParams( window.location.search )
		this.requested = params.get( 'culling' ) !== '0'
		this.viewMode = params.get( 'view' ) === 'pov' ? 'pov' : 'overview'
		this.flight = 2.35
		this.lookOffset = new Vector3()
		this.cameraTarget = new Vector3()
		this.frameTangent = new Vector3()
		this.frameRight = new Vector3()
		this.snapshotTimer = 0
		this.snapshotPending = false
		this.snapshot = null
		this.ringBins = new Float32Array( MAP_BINS )
		this.mapPath = []
		this.indicesPerStrand = 0
	}

	async init() {
		this.buildMapPath()
		this.createHud()
		stage.onUpdate.add( this.updateHud )
		await stage3d.initRender( { background: BACKGROUND } )
		if ( !this.hud ) return

		this.passCamera = new PerspectiveCamera( PASS_FOV, stage.width / Math.max( 1, stage.height ), PASS_NEAR, PASS_FAR )

		this.control = new OrbitControl( stage3d.camera, 195 )
		this.controlActive = true
		this.control.extraThetaMouse = false
		this.control.extraPhiMouse = false
		this.control.minRadius = 60
		this.control.maxRadius = 320
		this.control.minPhi = 0.28
		this.control.maxPhi = 1.36
		this.control._phi = 0.84
		this.control._theta = 1.48
		this.control.target.set( -8, 6, 0 )
		this.control.update( 16 )

		// Subtle blueprint of the full pass in Overview mode so culled chunks are obvious by contrast.
		this.ghostLine = new MeshLine()
			.lines( buildPassStrands( GHOST_POINTS_PER_STRAND ), true )
			.lineWidth( 0.22 )
			.color( 0x26486e )
			.transparent( true )
			.opacity( 0.28 )
			.build()
		this.ghostLine.frustumCulled = false
		this.ghostLine.renderOrder = -1
		stage3d.add( this.ghostLine )

		this.line = new MeshLine()
			.lines( buildPassStrands( POINTS_PER_STRAND ), true )
			.lineWidth( 0.26 )
			.color( 0xFFFFFF )
			.colorFn( alpinePassColor )
			.join( { type: 'miter', limit: 3 } )
			.build()
		stage3d.add( this.line )

		this.createFrustumVisualizer()

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
		this.applyViewMode()

		this.updateCamera( 0 )
		stage.onUpdate.add( this.update )
	}

	buildMapPath() {
		const temp = new Vector3()
		this.mapPath = []
		for ( let i = 0; i <= MAP_BINS; i++ ) {
			const u = i / MAP_BINS * Math.PI * 2
			passCentre( u, temp )
			this.mapPath.push( { x: temp.x, z: temp.z } )
		}
	}

	/** Build the 3D frustum pyramid once in camera-local space (unit aspect, scaled by aspect). */
	createFrustumVisualizer() {
		const tanHalf = Math.tan( ( PASS_FOV * Math.PI / 180 ) * 0.5 )
		const nh = PASS_NEAR * tanHalf
		const fh = PASS_FAR * tanHalf

		const corners = [
			[-nh, nh, -PASS_NEAR],
			[nh, nh, -PASS_NEAR],
			[nh, -nh, -PASS_NEAR],
			[-nh, -nh, -PASS_NEAR],
			[-fh, fh, -PASS_FAR],
			[fh, fh, -PASS_FAR],
			[fh, -fh, -PASS_FAR],
			[-fh, -fh, -PASS_FAR],
		]

		const pairA = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]
		const pairB = [1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7]
		const edges = []
		for ( let i = 0; i < 12; i++ ) {
			const a = corners[pairA[i]]
			const b = corners[pairB[i]]
			edges.push( new Float32Array( [a[0], a[1], a[2], b[0], b[1], b[2]] ) )
		}

		const faceIndices = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]
		const fillPositions = new Float32Array( faceIndices.length * 3 )
		for ( let i = 0; i < faceIndices.length; i++ ) {
			const c = corners[faceIndices[i]]
			fillPositions[i * 3] = c[0]
			fillPositions[i * 3 + 1] = c[1]
			fillPositions[i * 3 + 2] = c[2]
		}

		this.frustumGroup = new Group()

		const fillGeo = new BufferGeometry()
		fillGeo.setAttribute( 'position', new BufferAttribute( fillPositions, 3 ) )
		const fillMat = new MeshBasicNodeMaterial( {
			color: 0x38bdf8,
			transparent: true,
			opacity: 0.06,
			depthWrite: false,
			side: DoubleSide,
		} )
		this.frustumMesh = new Mesh( fillGeo, fillMat )
		this.frustumMesh.frustumCulled = false
		this.frustumMesh.renderOrder = 1
		this.frustumGroup.add( this.frustumMesh )

		this.frustumLine = new MeshLine()
			.lines( edges, false )
			.lineWidth( 0.28 )
			.color( 0x67e8f9 )
			.transparent( true )
			.opacity( 0.85 )
			.build()
		this.frustumLine.frustumCulled = false
		this.frustumLine.renderOrder = 2
		this.frustumGroup.add( this.frustumLine )

		stage3d.add( this.frustumGroup )
	}

	updateFrustumVisualizer() {
		if ( !this.frustumGroup || !this.passCamera ) return
		this.frustumGroup.position.copy( this.passCamera.position )
		this.frustumGroup.quaternion.copy( this.passCamera.quaternion )
		this.frustumGroup.scale.set( this.passCamera.aspect, 1, 1 )
		this.frustumGroup.updateMatrixWorld( true )
	}

	/** Attach or detach the line so the same scene doubles as its own draw-all baseline. */
	setCulling( enabled ) {
		this.requested = enabled
		if ( this.metrics ) this.metrics.requested = enabled
		if ( enabled && !this.handle ) {
			this.culling ??= MeshLineCullingSystem.attach( stage3d.renderer, stage3d.scene, {
				mode: 'auto',
				chunkSize: 128,
				cullCamera: this.passCamera,
			} )
			this.culling.cullCamera = this.passCamera
			this.handle = this.culling.add( this.line )
		} else if ( !enabled && this.handle ) {
			this.culling.remove( this.handle )
			this.handle = null
		}
		if ( this.frustumLine ) {
			this.frustumLine.color( enabled ? 0x67e8f9 : 0x64748b )
		}
		if ( this.frustumMesh?.material ) {
			this.frustumMesh.material.opacity = enabled ? 0.06 : 0.02
		}
		window.__meshLineCullingHandle = this.handle
		this.snapshot = null
		this.ringBins.fill( enabled ? 0 : 1 )
		if ( this.metrics ) this.metrics.visibleIndexCount = this.metrics.indexCount
		this.updateHud( true )
	}

	setViewMode( mode ) {
		this.viewMode = mode === 'pov' ? 'pov' : 'overview'
		this.applyViewMode()
		this.updateCamera( 0 )
		this.updateHud( true )
	}

	applyViewMode() {
		const isOverview = this.viewMode === 'overview'
		if ( this.ghostLine ) this.ghostLine.visible = isOverview
		if ( this.frustumGroup ) this.frustumGroup.visible = isOverview

		if ( isOverview ) {
			stage3d.scene.fog = new Fog( BACKGROUND, 220, 480 )
			stage3d.camera.fov = 46
			stage3d.camera.near = 1
			stage3d.camera.far = 560
			stage3d.camera.updateProjectionMatrix()
			if ( this.control ) {
				if ( !this.controlActive ) {
					this.control.enable()
					this.controlActive = true
				}
				stage3d.control = this.control
				this.control.update( 16 )
			}
		} else {
			stage3d.scene.fog = new Fog( BACKGROUND, 42, PASS_FAR )
			stage3d.camera.fov = PASS_FOV
			stage3d.camera.near = PASS_NEAR
			stage3d.camera.far = PASS_FAR
			stage3d.camera.updateProjectionMatrix()
			if ( this.control && this.controlActive ) {
				this.control.disable()
				this.controlActive = false
			}
			stage3d.control = null
		}
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
		this.flight = ( this.flight + Math.min( dt, 100 ) * 0.001 * FLY_SPEED ) % ( Math.PI * 2 )
		this.updateCamera( dt )
	}

	updateCamera( dt ) {
		if ( !this.passCamera ) return

		const aspect = stage.width / Math.max( 1, stage.height )
		if ( Math.abs( this.passCamera.aspect - aspect ) > 1e-4 ) {
			this.passCamera.aspect = aspect
			this.passCamera.updateProjectionMatrix()
		}

		const blend = 1 - Math.pow( 0.04, Math.min( dt, 100 ) * 0.001 )
		const steerX = this.viewMode === 'pov' ? mouse.normalizedX * 2.2 : 0
		const steerY = this.viewMode === 'pov' ? -mouse.normalizedY * 1.6 : 0
		this.lookOffset.x += ( steerX - this.lookOffset.x ) * blend
		this.lookOffset.y += ( steerY - this.lookOffset.y ) * blend

		const bank = samplePassFrame( this.flight, this.passCamera.position, this.frameTangent, this.frameRight )
		passCentre( this.flight + LOOK_AHEAD, this.cameraTarget )

		this.passCamera.position.x += this.frameRight.x * this.lookOffset.x
		this.passCamera.position.z += this.frameRight.z * this.lookOffset.x
		this.passCamera.position.y += 3.8 + this.lookOffset.y
		this.cameraTarget.y += 4.6 + this.lookOffset.y * 0.7

		this.passCamera.up.set(
			-this.frameRight.x * Math.sin( bank * 0.55 ),
			Math.cos( bank * 0.55 ),
			-this.frameRight.z * Math.sin( bank * 0.55 ),
		).normalize()
		this.passCamera.lookAt( this.cameraTarget )
		this.passCamera.updateMatrixWorld()

		if ( this.viewMode === 'pov' ) {
			stage3d.camera.position.copy( this.passCamera.position )
			stage3d.camera.quaternion.copy( this.passCamera.quaternion )
			stage3d.camera.updateMatrixWorld()
		} else {
			if ( this.control && !this.control._isDown ) {
				this.control._theta += Math.min( dt, 100 ) * 0.000035
			}
			this.updateFrustumVisualizer()
		}
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
				this.ringBins[Math.min( MAP_BINS - 1, Math.floor( local * MAP_BINS ) )] += 1
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
				gap: 10px;
				box-sizing: border-box;
				width: min(286px, calc(100vw - 84px));
				padding: 13px 15px 14px;
				border: 1px solid rgba(56, 189, 248, .22);
				border-radius: 16px;
				background: linear-gradient(155deg, rgba(4, 14, 26, .84), rgba(3, 8, 18, .68));
				box-shadow: 0 18px 50px rgba(0, 0, 0, .38);
				backdrop-filter: blur(14px);
				color: rgba(226, 242, 252, .78);
				font: 500 11px/1.3 system-ui, sans-serif;
				text-align: left;
				pointer-events: none;
				user-select: none;
			}
			.GpuCullingHud__header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
			.GpuCullingHud__title {
				color: #fff;
				font-size: 10px;
				font-weight: 800;
				letter-spacing: .14em;
				text-transform: uppercase;
			}
			.GpuCullingHud__badge {
				display: inline-flex;
				align-items: center;
				gap: 5px;
				padding: 3px 8px;
				border: 1px solid rgba(250, 204, 21, .28);
				border-radius: 999px;
				background: rgba(250, 204, 21, .1);
				color: #fde68a;
				font-size: 9px;
				font-weight: 750;
				letter-spacing: .07em;
				text-transform: uppercase;
			}
			.GpuCullingHud__badge::before {
				content: '';
				width: 5px;
				height: 5px;
				border-radius: 50%;
				background: currentColor;
				box-shadow: 0 0 8px currentColor;
			}
			.GpuCullingHud[data-state="active"] .GpuCullingHud__badge {
				border-color: rgba(56, 189, 248, .32);
				background: rgba(56, 189, 248, .12);
				color: #7dd3fc;
			}
			.GpuCullingHud[data-state="fallback"] .GpuCullingHud__badge {
				border-color: rgba(251, 113, 133, .28);
				background: rgba(244, 63, 94, .1);
				color: #fecdd3;
			}
			.GpuCullingHud[data-state="baseline"] .GpuCullingHud__badge {
				border-color: rgba(148, 163, 184, .26);
				background: rgba(148, 163, 184, .1);
				color: #cbd5e1;
			}
			.GpuCullingHud__summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
			.GpuCullingHud__big { display: grid; gap: 3px; color: #fff; }
			.GpuCullingHud__statRow { display: flex; align-items: baseline; gap: 6px; }
			.GpuCullingHud__percent { font-size: 32px; font-weight: 780; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
			.GpuCullingHud__label { color: rgba(186, 230, 253, .78); font-size: 11px; font-weight: 600; }
			.GpuCullingHud__metric { color: rgba(203, 225, 240, .66); font-size: 10.5px; font-variant-numeric: tabular-nums; }
			.GpuCullingHud__ring { display: block; flex: none; width: ${MAP_SIZE}px; height: ${MAP_SIZE}px; }
			.GpuCullingHud__actions { display: flex; align-items: center; gap: 6px; }
			.GpuCullingHud__btn {
				pointer-events: auto;
				flex: 1;
				padding: 6px 10px;
				border: 1px solid rgba(56, 189, 248, .35);
				border-radius: 999px;
				background: rgba(56, 189, 248, .1);
				color: #e0f2fe;
				font: 700 9.5px/1 system-ui, sans-serif;
				letter-spacing: .06em;
				text-transform: uppercase;
				text-align: center;
				cursor: pointer;
				transition: border-color .15s, background .15s;
			}
			.GpuCullingHud__btn:hover { border-color: #7dd3fc; background: rgba(56, 189, 248, .18); }
			.GpuCullingHud__btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
			.GpuCullingHud__btn--secondary {
				border-color: rgba(148, 163, 184, .28);
				background: rgba(148, 163, 184, .09);
				color: #e2e8f0;
			}
			.GpuCullingHud__btn--secondary:hover { border-color: #cbd5e1; background: rgba(148, 163, 184, .16); }
			@media (max-width: 620px) {
				.GpuCullingHud { left: calc(10px + var(--sail, 0px)); top: calc(10px + var(--sait, 0px)); width: auto; max-width: calc(100vw - 76px); padding: 10px 12px; gap: 8px; }
				.GpuCullingHud__percent { font-size: 24px; }
				.GpuCullingHud__ring { width: 54px; height: 54px; }
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
		const statRow = document.createElement( 'div' )
		statRow.className = 'GpuCullingHud__statRow'
		const percent = document.createElement( 'span' )
		percent.className = 'GpuCullingHud__percent'
		percent.textContent = '—'
		const percentLabel = document.createElement( 'span' )
		percentLabel.className = 'GpuCullingHud__label'
		percentLabel.textContent = 'drawn'
		statRow.append( percent, percentLabel )

		const metric = document.createElement( 'span' )
		metric.className = 'GpuCullingHud__metric'
		metric.textContent = `${formatCount( POINT_COUNT )} pts`
		big.append( statRow, metric )

		const ring = document.createElement( 'canvas' )
		ring.className = 'GpuCullingHud__ring'
		ring.width = MAP_SIZE * 2
		ring.height = MAP_SIZE * 2
		ring.setAttribute( 'aria-hidden', 'true' )
		summary.append( big, ring )

		const actions = document.createElement( 'div' )
		actions.className = 'GpuCullingHud__actions'

		const toggle = document.createElement( 'button' )
		toggle.type = 'button'
		toggle.className = 'GpuCullingHud__btn'
		toggle.addEventListener( 'click', this.onToggle )
		toggle.addEventListener( 'pointerdown', event => event.stopPropagation() )

		const viewToggle = document.createElement( 'button' )
		viewToggle.type = 'button'
		viewToggle.className = 'GpuCullingHud__btn GpuCullingHud__btn--secondary'
		viewToggle.addEventListener( 'click', this.onViewToggle )
		viewToggle.addEventListener( 'pointerdown', event => event.stopPropagation() )

		actions.append( toggle, viewToggle )
		this.hud.append( header, summary, actions )
		this.hud.hidden = new URLSearchParams( window.location.search ).has( 'noUI' )
		document.body.appendChild( this.hud )

		this.hudElements = { badge, metric, percent, percentLabel, ring, toggle, viewToggle }
		this.updateHud()
	}

	onToggle = () => {
		if ( !this.line ) return
		this.setCulling( !this.requested )
	}

	onViewToggle = () => {
		this.setViewMode( this.viewMode === 'overview' ? 'pov' : 'overview' )
	}

	updateHud = ( force = false ) => {
		if ( !this.hud || !this.hudElements ) return

		const requested = this.requested
		const viewMode = this.viewMode
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
			viewMode === previous.viewMode &&
			backend === previous.backend &&
			indexCount === previous.indexCount &&
			active === previous.active &&
			enabled === previous.enabled &&
			chunkCount === previous.chunkCount &&
			reason === previous.reason
		) return
		previous.requested = requested
		previous.viewMode = viewMode
		previous.backend = backend
		previous.indexCount = indexCount
		previous.active = active
		previous.enabled = enabled
		previous.chunkCount = chunkCount
		previous.reason = reason

		let state = 'warmup'
		let badge = 'Checking GPU'
		if ( !requested ) {
			state = 'baseline'
			badge = 'Culling off'
		} else if ( active ) {
			state = 'active'
			badge = 'WebGPU active'
		} else if ( enabled ) {
			badge = 'WebGPU warm-up'
		} else if ( this.handle || backend !== 'initializing' ) {
			state = 'fallback'
			badge = backend === 'webgl2' ? 'WebGL2 fallback' : 'Draw-all fallback'
		}

		const visible = this.metrics?.visibleIndexCount ?? indexCount
		const ratio = indexCount ? visible / indexCount : 1
		const measuring = requested && state !== 'fallback' && !this.snapshot
		if ( state === 'fallback' ) this.ringBins.fill( 1 )

		this.hud.dataset.state = state
		this.hudElements.badge.textContent = badge
		this.hudElements.toggle.hidden = state === 'fallback'
		this.hudElements.toggle.textContent = requested ? 'Culling: ON' : 'Culling: OFF'
		this.hudElements.toggle.setAttribute( 'aria-pressed', String( requested ) )
		this.hudElements.viewToggle.textContent = viewMode === 'overview' ? 'Camera POV' : 'God View'
		this.hudElements.viewToggle.setAttribute( 'aria-pressed', String( viewMode === 'pov' ) )

		this.hudElements.percent.textContent = measuring ? '—' : `${( ratio * 100 ).toFixed( ratio < 0.1 ? 1 : 0 )}%`
		this.hudElements.percentLabel.textContent = measuring ? 'measuring…' : 'drawn'

		if ( !indexCount || measuring ) {
			this.hudElements.metric.textContent = `${formatCount( POINT_COUNT )} pts · ${formatCount( chunkCount || 6272 )} chunks`
		} else {
			this.hudElements.metric.textContent = `${formatCount( visible / 3 )} / ${formatCount( indexCount / 3 )} tris`
		}
		const info = stage3d.renderer?.info
		if ( stage3d.renderer?.backend?.trackTimestamp && info ) {
			this.hudElements.metric.textContent += ` · ${( info.render.timestamp + info.compute.timestamp ).toFixed( 2 )} ms`
		}
		this.drawMap()
	}

	drawMap() {
		const canvas = this.hudElements?.ring
		const context = canvas?.getContext( '2d' )
		if ( !context || this.mapPath.length === 0 ) return
		const { width, height } = canvas
		const center = width * 0.5
		const scale = width / 225
		const toX = x => center + x * scale
		const toY = z => center + z * scale

		let peak = 0
		for ( let bin = 0; bin < MAP_BINS; bin++ ) peak = Math.max( peak, this.ringBins[bin] )

		context.clearRect( 0, 0, width, height )
		context.lineCap = 'round'
		context.lineJoin = 'round'

		// Base serpentine alpine route.
		context.lineWidth = width * 0.065
		context.strokeStyle = 'rgba(148, 163, 184, .22)'
		context.beginPath()
		for ( let i = 0; i <= MAP_BINS; i++ ) {
			const pt = this.mapPath[i]
			if ( i === 0 ) context.moveTo( toX( pt.x ), toY( pt.z ) )
			else context.lineTo( toX( pt.x ), toY( pt.z ) )
		}
		context.stroke()

		// Retained chunks along the alpine pass.
		for ( let bin = 0; bin < MAP_BINS; bin++ ) {
			const value = peak > 0 ? this.ringBins[bin] / peak : 0
			if ( value <= 0 ) continue
			const a = this.mapPath[bin]
			const b = this.mapPath[bin + 1]
			context.strokeStyle = `rgba(103, 232, 249, ${0.45 + value * 0.55})`
			context.beginPath()
			context.moveTo( toX( a.x ), toY( a.z ) )
			context.lineTo( toX( b.x ), toY( b.z ) )
			context.stroke()
		}

		// Pass camera position and frustum cone on the map.
		const camIdx = Math.floor( ( ( this.flight % ( Math.PI * 2 ) ) / ( Math.PI * 2 ) ) * MAP_BINS )
		const nextIdx = ( camIdx + 4 ) % MAP_BINS
		const camPt = this.mapPath[camIdx]
		const nextPt = this.mapPath[nextIdx]
		const cx = toX( camPt.x )
		const cy = toY( camPt.z )
		const heading = Math.atan2( toY( nextPt.z ) - cy, toX( nextPt.x ) - cx )
		const reach = PASS_FAR * scale

		context.fillStyle = 'rgba(103, 232, 249, .2)'
		context.beginPath()
		context.moveTo( cx, cy )
		context.arc( cx, cy, reach, heading - 0.52, heading + 0.52 )
		context.closePath()
		context.fill()

		context.fillStyle = '#ffffff'
		context.beginPath()
		context.arc( cx, cy, width * 0.042, 0, Math.PI * 2 )
		context.fill()
	}

	dispose() {
		stage.onUpdate.remove( this.updateHud )
		stage.onUpdate.remove( this.update )
		this.hudElements?.toggle.removeEventListener( 'click', this.onToggle )
		this.hudElements?.viewToggle.removeEventListener( 'click', this.onViewToggle )
		this.hud?.remove()
		this.hudStyle?.remove()
		this.culling?.dispose()
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}
		if ( this.ghostLine ) {
			stage3d.remove( this.ghostLine )
			this.ghostLine.dispose()
		}
		if ( this.frustumGroup ) {
			stage3d.remove( this.frustumGroup )
		}
		if ( this.frustumLine ) {
			this.frustumLine.dispose()
		}
		if ( this.frustumMesh ) {
			this.frustumMesh.geometry.dispose()
			this.frustumMesh.material.dispose()
		}
		if ( this.control && this.controlActive ) {
			this.control.disable()
			this.controlActive = false
		}
		if ( stage3d.scene ) stage3d.scene.fog = null
		if ( window.__meshLineCullingHandle === this.handle ) window.__meshLineCullingHandle = null
		if ( window.__meshLineCullingMetrics === this.metrics ) window.__meshLineCullingMetrics = null

		this.line = null
		this.ghostLine = null
		this.frustumGroup = null
		this.frustumLine = null
		this.frustumMesh = null
		this.culling = null
		this.handle = null
		this.metrics = null
		this.control = null
		this.passCamera = null
		this.hud = null
		this.hudStyle = null
		this.hudElements = null
		this.hudState = null
		this.snapshot = null
	}

}

export default GpuCullingExample
