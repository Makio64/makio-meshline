import GUI from 'lil-gui'
import { MeshLine } from 'makio-meshline'
import MeshLineGPUPath from 'makio-meshline/gpu-path'
import { attribute, cameraFar, cameraNear, color, cos, float, frontFacing, length, max, mix, perspectiveDepthToViewZ, positionLocal, positionView, pow, reflector, screenUV, smoothstep, transformNormalToView, uniform, varying, vec2, vec3, vec4 } from 'three/tsl'
import {
	AdditiveBlending,
	DirectionalLight,
	DoubleSide,
	HemisphereLight,
	Mesh,
	MeshBasicNodeMaterial,
	PlaneGeometry,
} from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const SURFACE_Y = 0.28
const SURFACE_HEIGHT = 0.46
const SURFACE_WIDTH = 0.9
const FAN_SEGMENTS = 12
const JOIN_FAN_SEGMENTS = 6
// Stay within one adaptive round-fan subdivision band while making the
// opening visibly flex. Replacing an index buffer during the reflected pass
// can race WebGPU, so direction changes rotate this stable V instead.
const JOIN_ANGLE_MIN = 32
const JOIN_ANGLE_MAX = 58
const JOIN_ANGLE_CENTER = ( JOIN_ANGLE_MIN + JOIN_ANGLE_MAX ) * 0.5
const JOIN_ANGLE_AMPLITUDE = ( JOIN_ANGLE_MAX - JOIN_ANGLE_MIN ) * 0.5
const JOIN_ANGLE_SPEED = 0.18
const JOIN_DIRECTION_SPEED_RATIO = 0.5
const MIRROR_SPAN = 48
const MIRROR_STRENGTH = 0.14
const MIRROR_DARKNESS = 0.2
const MIRROR_BLUR = 0.5
const MIRROR_DEPTH_FADE = 5
const MIRROR_NORMAL_STRENGTH = 0.14
const MIRROR_NORMAL_FREQUENCY = 0.45
const MIRROR_NORMAL_PROJECTION = 0.025
const MIRROR_TINT = vec3( 0.68, 0.82, 1 )
const PROJECTED_CUSP_CASE = 'projected-cusp'
const PROJECTED_CUSP_PHI = 1.155
const PROJECTED_CUSP_THETA = 0.271

const JOIN_PATH = [
	[-2.1, -1.05],
	[0, 1.15],
	[2.1, -1.05],
]

const JOIN_ARM_LENGTH = Math.hypot(
	JOIN_PATH[0][0] - JOIN_PATH[1][0],
	JOIN_PATH[0][1] - JOIN_PATH[1][1]
)

const CAP_PATH = [
	[-1.75, 0],
	[1.75, 0],
]

const REVERSAL_PATH = [
	[-3.1, -0.75],
	[1.15, -0.75],
	[-2.25, -0.75],
	[-2.25, 0.95],
	[2.15, 0.95],
]

const SURFACE_EXAMPLES = [
	{
		label: 'MITER JOIN',
		kind: 'join',
		center: [-6, 1.45],
		points: JOIN_PATH,
		color: 0xF59E0B,
		gradientColor: 0xFDE047,
		join: { type: 'miter', limit: 12, segments: JOIN_FAN_SEGMENTS },
		cap: { type: 'butt', segments: FAN_SEGMENTS },
	},
	{
		label: 'TRUE BEVEL',
		kind: 'join',
		center: [0, 1.45],
		points: JOIN_PATH,
		color: 0xF97316,
		gradientColor: 0xEF4444,
		join: { type: 'bevel', limit: 4, segments: JOIN_FAN_SEGMENTS },
		cap: { type: 'butt', segments: FAN_SEGMENTS },
	},
	{
		label: 'TRUE ROUND FAN',
		kind: 'join',
		center: [6, 1.45],
		points: JOIN_PATH,
		color: 0xFB7185,
		gradientColor: 0xD946EF,
		join: { type: 'round', limit: 4, segments: JOIN_FAN_SEGMENTS },
		cap: { type: 'butt', segments: FAN_SEGMENTS },
	},
	{
		label: 'BUTT CAP',
		kind: 'cap',
		center: [-6, -2.55],
		points: CAP_PATH,
		color: 0x22C55E,
		gradientColor: 0x2DD4BF,
		join: { type: 'miter', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'butt', segments: FAN_SEGMENTS },
	},
	{
		label: 'SQUARE CAP',
		kind: 'cap',
		center: [0, -2.55],
		points: CAP_PATH,
		color: 0x14B8A6,
		gradientColor: 0x38BDF8,
		join: { type: 'miter', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'square', segments: FAN_SEGMENTS },
	},
	{
		label: 'TRUE ROUND CAP',
		kind: 'cap',
		center: [6, -2.55],
		points: CAP_PATH,
		color: 0x06B6D4,
		gradientColor: 0x818CF8,
		join: { type: 'miter', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'round', segments: FAN_SEGMENTS },
	},
	{
		label: '180° REVERSAL · 2 RUNS',
		kind: 'reversal',
		center: [0, -6.35],
		points: REVERSAL_PATH,
		color: 0xA78BFA,
		gradientColor: 0xF472B6,
		width: 0.68,
		join: { type: 'round', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'round', segments: FAN_SEGMENTS },
	},
]

const SCREEN_PATH = new Float32Array( [
	[-8.2, 3.15, 5.8],
	[-5.4, 4.35, 5.8],
	[-2.7, 2.95, 5.8],
	[0, 4.45, 5.8],
	[2.7, 2.95, 5.8],
	[5.4, 4.35, 5.8],
	[8.2, 3.15, 5.8],
].flat() )

const toSurfacePoints = ( points, center, y = SURFACE_Y ) => {
	const result = new Float32Array( points.length * 3 )

	for ( let index = 0; index < points.length; index++ ) {
		const offset = index * 3
		result[offset] = points[index][0] + center[0]
		result[offset + 1] = y
		result[offset + 2] = points[index][1] + center[1]
	}

	return result
}

const writeJoinPose = ( target, center, angle, direction, y ) => {
	const halfAngle = angle * Math.PI / 360
	const halfWidth = Math.sin( halfAngle ) * JOIN_ARM_LENGTH
	const depth = Math.cos( halfAngle ) * JOIN_ARM_LENGTH
	const rotation = direction * Math.PI / 180
	const cosine = Math.cos( rotation )
	const sine = Math.sin( rotation )
	const apexX = center[0] + JOIN_PATH[1][0]
	const apexZ = center[1] + JOIN_PATH[1][1]

	target[0] = apexX - halfWidth * cosine + depth * sine
	target[1] = y
	target[2] = apexZ - halfWidth * sine - depth * cosine
	target[3] = apexX
	target[4] = y
	target[5] = apexZ
	target[6] = apexX + halfWidth * cosine + depth * sine
	target[7] = y
	target[8] = apexZ + halfWidth * sine - depth * cosine
}

const createSurface = ( points, config, wireframe = false ) => {
	const surface = new MeshLine()
		.lines( points )
		.lineWidth( config.width ?? SURFACE_WIDTH )
		.color( wireframe ? 0x111827 : config.color )
		.needsProgress( !wireframe )
		.surface( {
			frame: 'fixed-up',
			up: [0, 1, 0],
			side: DoubleSide,
			uvMode: 'distance',
			uvScale: 1,
			roughness: wireframe ? 1 : 0.68,
			metalness: wireframe ? 0 : 0.08,
		} )
		.join( config.join )
		.cap( config.cap )
		.wireframe( wireframe )
		.dynamic( config.kind === 'join' )
		.build()

	if ( !wireframe ) {
		const progress = smoothstep( 0.04, 0.96, varying( attribute( 'progress', 'float' ) ) )
		const surfaceColor = mix( color( config.color ), color( config.gradientColor ), progress )
		surface.material.colorNode = surfaceColor
		// The mirror camera sees the underside. Keep it colorful without changing
		// the lighting of the directly visible, front-facing ribbon.
		surface.material.emissiveNode = frontFacing.select( vec3( 0 ), surfaceColor.mul( 0.45 ) )
	}

	return surface
}

class VariableTopologyExample {
	constructor() {
		this.text = ''
		this.surfaces = []
		this.animatedJoins = []
		this.lights = []
		this.mirror = null
		this.mirrorReflection = null
		this.mirrorUniforms = null
		this.screenPath = null
		this.control = null
		this.gui = null
		this.isCompactGui = null
		this.hud = null
		this.hudStyle = null
		this.metrics = null
		this.cameraState = null
		this.cameraCase = null
		this.animateAnglesController = null
		this.joinAngleController = null
		this.joinDirectionController = null
		this.joinAnglePhase = 0
		this.joinDirectionPhase = 0
		this.params = {
			animateAngles: true,
			joinAngle: JOIN_ANGLE_CENTER,
			joinDirection: 0,
			angleSpeed: JOIN_ANGLE_SPEED,
			surfaceHeight: SURFACE_HEIGHT,
			mirrorStrength: MIRROR_STRENGTH,
			mirrorDarkness: MIRROR_DARKNESS,
			mirrorBlur: MIRROR_BLUR,
			normalStrength: MIRROR_NORMAL_STRENGTH,
			normalFrequency: MIRROR_NORMAL_FREQUENCY,
		}
	}

	async init() {
		const searchParams = new URLSearchParams( window.location.search )
		const reportMetrics = searchParams.get( 'metrics' ) === '1'
		this.cameraCase = null
		if ( searchParams.get( 'case' ) === PROJECTED_CUSP_CASE ) {
			const requestedTheta = searchParams.has( 'theta' ) ? Number( searchParams.get( 'theta' ) ) : PROJECTED_CUSP_THETA
			this.cameraCase = {
				id: PROJECTED_CUSP_CASE,
				phi: PROJECTED_CUSP_PHI,
				theta: Number.isFinite( requestedTheta ) ? requestedTheta : PROJECTED_CUSP_THETA,
				radius: 24,
			}
		}
		const prefersReducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true
		this.params.animateAngles = !this.cameraCase && !reportMetrics && !prefersReducedMotion
		await stage3d.initRender( { background: 0x07101E } )
		stage3d.renderer.setClearColor( 0x07101E )

		this.cameraState = {
			near: stage3d.camera.near,
			far: stage3d.camera.far,
		}
		stage3d.camera.near = 0.1
		stage3d.camera.far = 180
		stage3d.camera.updateProjectionMatrix()

		this.control = new OrbitControl( stage3d.camera, this.cameraCase?.radius ?? 24 )
		this.control.minRadius = 15
		this.control.maxRadius = 38
		this.control.minPhi = 0.42
		this.control.maxPhi = 1.25
		this.control._phi = this.cameraCase?.phi ?? 0.72
		this.control._theta = this.cameraCase?.theta ?? 1.25
		if ( this.cameraCase ) {
			this.control.extraThetaMouse = false
			this.control.extraPhiMouse = false
		}
		this.control.target.set( 0, 0.5, -1.3 )
		this.control.update()
		stage3d.control = this.control

		this.createScene()
		this.createGui( searchParams.has( 'noUI' ) )
		await this.createScreenTopology()
		this.createHud()

		stage.onResize.add( this.onResize )
		stage.onUpdate.add( this.update )
		this.onResize()

		if ( reportMetrics ) console.info( `[variableTopology] ${JSON.stringify( this.metrics )}` )
	}

	createScene() {
		this.mirrorUniforms = {
			strength: uniform( this.params.mirrorStrength ),
			darkness: uniform( this.params.mirrorDarkness ),
			blur: uniform( this.params.mirrorBlur ),
			normalStrength: uniform( this.params.normalStrength ),
			normalFrequency: uniform( this.params.normalFrequency ),
		}

		this.mirrorReflection = reflector( {
			resolutionScale: 0.5,
			generateMipmaps: true,
			bounces: false,
			depth: true,
			samples: 0,
		} )
		this.mirrorReflection.levelNode = this.mirrorUniforms.blur.mul( 5 )

		// A shallow procedural normal field bends the sampled reflection while the
		// reflector itself stays planar. The matching depth UV prevents fade halos.
		const normalCoordinate = positionLocal.xy.mul( this.mirrorUniforms.normalFrequency )
		const normalDirectionA = vec2( 0.82, 0.57 )
		const normalDirectionB = vec2( -0.34, 0.94 )
		const normalDirectionC = vec2( 0.61, -0.79 )
		const normalNoise = normalDirectionA.mul( cos( normalCoordinate.dot( normalDirectionA ) ) )
			.add( normalDirectionB.mul(
				cos( normalCoordinate.dot( normalDirectionB ).mul( 1.73 ).add( 1.7 ) ).mul( 0.45 )
			) )
			.add( normalDirectionC.mul(
				cos( normalCoordinate.dot( normalDirectionC ).mul( 3.07 ).add( 4.2 ) ).mul( 0.16 )
			) )
		const flatViewNormal = transformNormalToView( vec3( 0, 0, 1 ) )
		const bumpedViewNormal = transformNormalToView(
			vec3( normalNoise.mul( this.mirrorUniforms.normalStrength ), 1 ).normalize()
		)
		const normalBend = vec2(
			bumpedViewNormal.x.sub( flatViewNormal.x ).negate(),
			bumpedViewNormal.y.sub( flatViewNormal.y )
		).mul( MIRROR_NORMAL_PROJECTION )
		const mirrorUV = screenUV.flipX().add( normalBend )
		this.mirrorReflection.uvNode = mirrorUV
		const mirrorDepth = this.mirrorReflection.getDepthNode()
		mirrorDepth.uvNode = mirrorUV

		const behindMirror = max(
			0,
			perspectiveDepthToViewZ( mirrorDepth, cameraNear, cameraFar )
				.negate()
				.sub( positionView.z.negate() )
		)
		const depthFade = float( 1 ).sub( smoothstep( 0, MIRROR_DEPTH_FADE, behindMirror ) )
		const edgeFade = float( 1 ).sub(
			smoothstep( 0.04, 0.3, length( positionLocal.xy.div( MIRROR_SPAN ) ) )
		)

		const mirrorMaterial = new MeshBasicNodeMaterial()
		mirrorMaterial.toneMapped = false
		mirrorMaterial.transparent = true
		mirrorMaterial.depthWrite = false
		mirrorMaterial.blending = AdditiveBlending
		const mirrorContrast = float( 1 ).add( this.mirrorUniforms.darkness.mul( 1.4 ) )
		mirrorMaterial.colorNode = pow( max( this.mirrorReflection.rgb, vec3( 0 ) ), vec3( mirrorContrast ) )
			.mul( MIRROR_TINT )
			.mul( this.mirrorUniforms.strength )
			.mul( depthFade )
			.mul( edgeFade )

		this.mirror = new Mesh( new PlaneGeometry( MIRROR_SPAN, MIRROR_SPAN ), mirrorMaterial )
		this.mirror.rotation.x = -Math.PI / 2
		this.mirror.position.set( 0, 0, -1.4 )
		this.mirror.renderOrder = -100
		this.mirror.frustumCulled = false
		this.mirror.add( this.mirrorReflection.target )
		stage3d.add( this.mirror )

		const examples = []
		for ( const config of SURFACE_EXAMPLES ) {
			const points = toSurfacePoints( config.points, config.center )
			const wirePoints = toSurfacePoints( config.points, config.center, SURFACE_Y + 0.018 )
			if ( config.kind === 'join' ) {
				writeJoinPose( points, config.center, this.params.joinAngle, this.params.joinDirection, SURFACE_Y )
				writeJoinPose( wirePoints, config.center, this.params.joinAngle, this.params.joinDirection, SURFACE_Y + 0.018 )
			}
			const surface = createSurface( points, config )
			const wire = createSurface( wirePoints, config, true )
			const heightOffset = this.params.surfaceHeight - SURFACE_Y
			surface.position.y = heightOffset
			wire.position.y = heightOffset
			stage3d.add( surface )
			stage3d.add( wire )
			this.surfaces.push( surface, wire )

			const sourcePointCount = points.length / 3
			const vertexCount = surface.geometry.getAttribute( 'position' ).count
			const triangleCount = surface.geometry.getIndex().count / 3
			const metrics = {
				label: config.label,
				kind: config.kind,
				join: config.join.type,
				cap: config.cap.type,
				sourcePointCount,
				vertexCount,
				triangleCount,
				variableTopology: vertexCount > sourcePointCount * 2,
			}
			examples.push( metrics )

			if ( config.kind === 'join' ) {
				this.animatedJoins.push( {
					center: config.center,
					metrics,
					points,
					surface,
					wire,
					wirePoints,
				} )
			}
		}

		const hemisphere = new HemisphereLight( 0xD9F1FF, 0x182033, 2.35 )
		const sun = new DirectionalLight( 0xFFF1D6, 4.2 )
		sun.position.set( -7, 15, 9 )
		stage3d.add( hemisphere )
		stage3d.add( sun )
		this.lights.push( hemisphere, sun )

		this.metrics = {
			cameraCase: this.cameraCase ? { ...this.cameraCase } : null,
			surface: {
				exampleCount: examples.length,
				joinTypes: ['miter', 'bevel', 'round'],
				capTypes: ['butt', 'square', 'round'],
				reversalSplits: 1,
				roundHalfTurnSegments: FAN_SEGMENTS,
				animatedRoundHalfTurnSegments: JOIN_FAN_SEGMENTS,
				examples,
			},
			screen: {
				requested: true,
				active: false,
				reason: 'preparing',
			},
		}
		window.__meshLineVariableTopologyMetrics = this.metrics
	}

	createGui( hasNoMenu ) {
		this.gui = new GUI( { title: 'Mirror & lines', width: hasNoMenu ? 230 : 290 } )
		this.gui.domElement.classList.add( 'VariableTopologyControls' )
		this.gui.domElement.style.right = hasNoMenu ? '0' : '60px'
		this.gui.domElement.style.top = '58px'

		const angleFolder = this.gui.addFolder( 'Join motion' )
		this.animateAnglesController = angleFolder.add( this.params, 'animateAngles' )
			.name( 'Animate' )
			.onChange( enabled => {
				if ( enabled ) this.syncJoinMotionPhases()
			} )
		this.joinAngleController = angleFolder.add( this.params, 'joinAngle', JOIN_ANGLE_MIN, JOIN_ANGLE_MAX, 0.1 )
			.name( 'Opening' )
			.listen()
			.onChange( angle => {
				this.params.animateAngles = false
				this.animateAnglesController.updateDisplay()
				this.setJoinPose( angle, this.params.joinDirection )
			} )
		this.joinDirectionController = angleFolder.add( this.params, 'joinDirection', -180, 180, 0.1 )
			.name( 'Orientation' )
			.listen()
			.onChange( direction => {
				this.params.animateAngles = false
				this.animateAnglesController.updateDisplay()
				this.setJoinPose( this.params.joinAngle, direction )
			} )
		angleFolder.add( this.params, 'angleSpeed', 0.03, 0.3, 0.01 )
			.name( 'Motion speed' )

		this.gui.add( this.params, 'surfaceHeight', 0.2, 0.9, 0.01 )
			.name( 'Line height' )
			.onChange( value => {
				const offset = value - SURFACE_Y
				for ( const surface of this.surfaces ) surface.position.y = offset
			} )

		const mirrorFolder = this.gui.addFolder( 'Mirror' )
		mirrorFolder.add( this.params, 'mirrorStrength', 0, 0.3, 0.005 )
			.name( 'Reflection' )
			.onChange( value => { this.mirrorUniforms.strength.value = value } )
		mirrorFolder.add( this.params, 'mirrorDarkness', 0, 0.75, 0.01 )
			.name( 'Darkness' )
			.onChange( value => { this.mirrorUniforms.darkness.value = value } )
		mirrorFolder.add( this.params, 'mirrorBlur', 0, 1, 0.01 )
			.name( 'Blur' )
			.onChange( value => { this.mirrorUniforms.blur.value = value } )

		const normalFolder = this.gui.addFolder( 'Normal displacement' )
		normalFolder.add( this.params, 'normalStrength', 0, 0.4, 0.005 )
			.name( 'Amount' )
			.onChange( value => { this.mirrorUniforms.normalStrength.value = value } )
		normalFolder.add( this.params, 'normalFrequency', 0.05, 2, 0.01 )
			.name( 'Scale' )
			.onChange( value => { this.mirrorUniforms.normalFrequency.value = value } )

		this.syncGuiLayout()
	}

	syncJoinMotionPhases() {
		const normalizedAngle = ( this.params.joinAngle - JOIN_ANGLE_CENTER ) / JOIN_ANGLE_AMPLITUDE
		const clampedAngle = Math.max( -1, Math.min( 1, normalizedAngle ) )
		const primaryPhase = Math.asin( clampedAngle )
		const secondaryPhase = Math.PI - primaryPhase
		const cycle = Math.PI * 2
		const nearestPrimary = primaryPhase + Math.round( ( this.joinAnglePhase - primaryPhase ) / cycle ) * cycle
		const nearestSecondary = secondaryPhase + Math.round( ( this.joinAnglePhase - secondaryPhase ) / cycle ) * cycle
		this.joinAnglePhase = Math.abs( nearestPrimary - this.joinAnglePhase ) < Math.abs( nearestSecondary - this.joinAnglePhase )
			? nearestPrimary
			: nearestSecondary

		const direction = this.params.joinDirection * Math.PI / 180
		this.joinDirectionPhase = direction + Math.round( ( this.joinDirectionPhase - direction ) / cycle ) * cycle
	}

	setJoinPose( angle, direction ) {
		const clampedAngle = Math.max( JOIN_ANGLE_MIN, Math.min( JOIN_ANGLE_MAX, angle ) )
		const wrappedDirection = ( ( direction + 180 ) % 360 + 360 ) % 360 - 180
		this.params.joinAngle = clampedAngle
		this.params.joinDirection = wrappedDirection

		for ( const entry of this.animatedJoins ) {
			writeJoinPose( entry.points, entry.center, clampedAngle, wrappedDirection, SURFACE_Y )
			writeJoinPose( entry.wirePoints, entry.center, clampedAngle, wrappedDirection, SURFACE_Y + 0.018 )

			// Angle and direction stay inside one fixed-topology band, so retain the
			// unchanged source index while uploading only the animated vertices.
			const surfaceIndex = entry.surface.geometry.getIndex()
			const surfaceIndexVersion = surfaceIndex.version
			entry.surface.setPositions( entry.points )
			if ( entry.surface.geometry.getIndex() === surfaceIndex ) surfaceIndex.version = surfaceIndexVersion

			// Three.js derives a transient edge index for wireframe materials. The
			// motion preserves topology, so retain the source index version and
			// let WebGPU update only the animated vertex attributes.
			const wireIndex = entry.wire.geometry.getIndex()
			const wireIndexVersion = wireIndex.version
			entry.wire.setPositions( entry.wirePoints )
			if ( entry.wire.geometry.getIndex() === wireIndex ) wireIndex.version = wireIndexVersion

			const position = entry.surface.geometry.getAttribute( 'position' )
			const index = entry.surface.geometry.getIndex()
			entry.metrics.vertexCount = position.count
			entry.metrics.triangleCount = index.count / 3
			entry.metrics.variableTopology = position.count > entry.metrics.sourcePointCount * 2
		}
	}

	syncGuiLayout() {
		if ( !this.gui ) return

		const compact = stage.width <= 700
		if ( compact && this.isCompactGui !== true ) this.gui.close()
		this.isCompactGui = compact
	}

	async createScreenTopology() {
		const path = new MeshLineGPUPath( {
			lines: SCREEN_PATH,
			lineWidth: 0.44,
			sizeAttenuation: true,
			color: 0x38BDF8,
			join: { type: 'round', limit: 4, segments: FAN_SEGMENTS },
			cap: { type: 'round', segments: FAN_SEGMENTS },
		}, {
			chunkSegments: 32,
			// True round joins/caps require full-detail primitive records.
			simplify: false,
		} )
		const screenGradient = vec4(
			mix( color( 0x38BDF8 ), color( 0xA78BFA ), smoothstep( 0.16, 0.84, screenUV.x ) ),
			1
		)
		path.fallback.material.colorNode = screenGradient
		path.resize( stage.width, stage.height )
		const prepared = await path.prepare( stage3d.renderer, stage3d.camera )

		if ( !prepared ) {
			this.metrics.screen = {
				...path.status,
				requested: true,
				active: false,
			}
			path.dispose()
			return
		}

		path.gpuMesh.material.colorNode = screenGradient
		this.screenPath = path
		stage3d.add( path )
		this.metrics.screen = path.status
	}

	createHud() {
		this.hudStyle = document.createElement( 'style' )
		this.hudStyle.textContent = `
			.VariableTopologyControls {
				z-index: 24 !important;
			}
			.VariableTopologyHud {
				position: fixed;
				top: calc(14px + var(--sait, 0px));
				left: calc(14px + var(--sail, 0px));
				right: calc(70px + var(--sair, 0px));
				z-index: 20;
				width: fit-content;
				max-width: 860px;
				box-sizing: border-box;
				padding: 9px 11px 10px;
				border: 1px solid rgba(148, 163, 184, .18);
				border-radius: 13px;
				background: rgba(2, 6, 23, .72);
				box-shadow: 0 10px 34px rgba(2, 6, 23, .3);
				backdrop-filter: blur(10px);
				color: #f8fafc;
				pointer-events: none;
				user-select: none;
			}
			.VariableTopologyHud__header {
				display: flex;
				align-items: center;
				gap: 9px;
				margin-bottom: 7px;
				font: 750 10px/1 system-ui, sans-serif;
				letter-spacing: .12em;
				text-transform: uppercase;
			}
			.VariableTopologyHud__hint {
				padding-left: 9px;
				border-left: 1px solid rgba(148, 163, 184, .22);
				font-weight: 600;
				color: rgba(226, 232, 240, .55);
			}
			.VariableTopologyHud__legend {
				display: grid;
				grid-template-columns: repeat(4, minmax(0, auto));
				gap: 6px 14px;
			}
			.VariableTopologyHud__item {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				min-width: 0;
				font: 700 9px/1 system-ui, sans-serif;
				letter-spacing: .07em;
				text-transform: uppercase;
				white-space: nowrap;
				color: rgba(241, 245, 249, .76);
			}
			.VariableTopologyHud__swatch {
				width: 7px;
				height: 7px;
				flex: 0 0 auto;
				border-radius: 999px;
				box-shadow: 0 0 10px currentColor;
			}
			@media (max-width: 700px) {
				.VariableTopologyControls {
					--width: min(190px, calc(100vw - 76px - var(--sail, 0px) - var(--sair, 0px)));
					top: auto !important;
					right: calc(10px + var(--sair, 0px)) !important;
					bottom: calc(10px + var(--saib, 0px));
					max-height: min(58vh, 440px);
					overflow-y: auto;
				}
				.VariableTopologyHud {
					top: calc(9px + var(--sait, 0px));
					left: calc(9px + var(--sail, 0px));
					right: calc(58px + var(--sair, 0px));
					padding: 8px 9px 9px;
				}
				.VariableTopologyHud__header { margin-bottom: 6px; }
				.VariableTopologyHud__legend {
					grid-template-columns: repeat(2, minmax(0, 1fr));
					gap: 6px 10px;
				}
				.VariableTopologyHud__item { font-size: 8px; }
			}
		`
		document.head.appendChild( this.hudStyle )

		this.hud = document.createElement( 'aside' )
		this.hud.className = 'VariableTopologyHud'
		this.hud.setAttribute( 'aria-label', 'Surface topology legend' )

		const header = document.createElement( 'div' )
		header.className = 'VariableTopologyHud__header'
		const title = document.createElement( 'span' )
		title.textContent = 'Surface topology'
		const hint = document.createElement( 'span' )
		hint.className = 'VariableTopologyHud__hint'
		hint.textContent = 'Animated opening + orientation · drag to orbit'
		header.append( title, hint )
		this.hud.appendChild( header )

		const legend = document.createElement( 'div' )
		legend.className = 'VariableTopologyHud__legend'
		const items = SURFACE_EXAMPLES.map( config => ( {
			label: config.label,
			accent: `#${config.color.toString( 16 ).padStart( 6, '0' )}`,
		} ) )
		items.push( {
			label: this.metrics.screen.active ? 'GPU screen path' : 'Screen path fallback',
			accent: '#38bdf8',
		} )

		for ( const item of items ) {
			const element = document.createElement( 'span' )
			element.className = 'VariableTopologyHud__item'
			const swatch = document.createElement( 'span' )
			swatch.className = 'VariableTopologyHud__swatch'
			swatch.style.color = item.accent
			swatch.style.background = item.accent
			const label = document.createElement( 'span' )
			label.textContent = item.label
			element.append( swatch, label )
			legend.appendChild( element )
		}
		this.hud.appendChild( legend )
		document.body.appendChild( this.hud )
	}

	onResize = () => {
		this.syncGuiLayout()
		this.screenPath?.resize( stage.width, stage.height )
	}

	update = dt => {
		if ( this.params.animateAngles ) {
			this.joinAnglePhase += dt * 0.001 * this.params.angleSpeed * Math.PI * 2
			this.joinDirectionPhase += dt * 0.001 * this.params.angleSpeed * JOIN_DIRECTION_SPEED_RATIO * Math.PI * 2
			const angle = JOIN_ANGLE_CENTER + Math.sin( this.joinAnglePhase ) * JOIN_ANGLE_AMPLITUDE
			const direction = this.joinDirectionPhase * 180 / Math.PI
			this.setJoinPose( angle, direction )
		}
		this.screenPath?.update( stage3d.camera )
	}

	dispose() {
		stage.onResize.remove( this.onResize )
		stage.onUpdate.remove( this.update )
		this.gui?.destroy()
		this.gui = null
		this.isCompactGui = null

		for ( const surface of this.surfaces ) {
			stage3d.remove( surface )
			surface.dispose()
		}
		this.surfaces = []
		this.animatedJoins = []
		this.animateAnglesController = null
		this.joinAngleController = null
		this.joinDirectionController = null

		if ( this.screenPath ) {
			stage3d.remove( this.screenPath )
			this.screenPath.dispose()
			this.screenPath = null
		}

		if ( this.mirror ) {
			stage3d.remove( this.mirror )
			this.mirror.geometry.dispose()
			this.mirror.material.dispose()
			this.mirror = null
		}
		this.mirrorReflection?.dispose()
		this.mirrorReflection = null
		this.mirrorUniforms = null

		for ( const light of this.lights ) {
			stage3d.remove( light )
			light.dispose()
		}
		this.lights = []

		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		this.control = null

		this.hud?.remove()
		this.hudStyle?.remove()
		this.hud = null
		this.hudStyle = null

		if ( this.cameraState ) {
			stage3d.camera.near = this.cameraState.near
			stage3d.camera.far = this.cameraState.far
			stage3d.camera.updateProjectionMatrix()
			this.cameraState = null
		}

		stage3d.renderer.setClearColor( 0x000000 )
		if ( window.__meshLineVariableTopologyMetrics === this.metrics ) {
			window.__meshLineVariableTopologyMetrics = null
		}
		this.metrics = null
	}

}

export default VariableTopologyExample
