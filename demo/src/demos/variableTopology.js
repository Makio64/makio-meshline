/**
 * Joins & Caps — interactive specimen table comparing miter, bevel, and round joins and caps.
 * Demonstrates: .surface(), .join({ type, limit, segments }), .cap({ type, segments }), .miterLimit(),
 * 180° reversal cusp splitting, and MeshLineGPUPath screen-space variable topology.
 */
import { MeshLine } from 'makio-meshline'
import MeshLineGPUPath from 'makio-meshline/gpu-path'
import { attribute, color, frontFacing, mix, screenUV, smoothstep, varying, vec3, vec4 } from 'three/tsl'
import { DirectionalLight, DoubleSide, HemisphereLight, MathUtils } from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import VariableTopology from '@/components/VariableTopology.vue'
import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { addBadge, createLabel, createLabelRenderer, paintBadge } from '@/utils/variableTopologyHud'
import { createMirror } from '@/utils/variableTopologyMirror'

const LABEL_Y = 0.28
const SURFACE_Y = 0.46
const WIRE_Y = SURFACE_Y + 0.018
const SURFACE_WIDTH = 0.9
const FAN_SEGMENTS = 12
const JOIN_FAN_SEGMENTS = 6
const DEFAULT_MITER_LIMIT = 2.5
// Sweep from a tight 20° hairpin (160° turn, ×5.76 miter scale, 6/6 round fan)
// to a gentle 165° bend (15° turn, ×1.01 miter scale, 1/6 round fan).
const JOIN_ANGLE_MIN = 20
const JOIN_ANGLE_MAX = 165
const JOIN_ANGLE_DEFAULT = 60
const JOIN_ANGLE_SPEED = 0.12
const JOIN_ANGLE_CENTER = ( JOIN_ANGLE_MIN + JOIN_ANGLE_MAX ) * 0.5
const JOIN_ANGLE_AMPLITUDE = ( JOIN_ANGLE_MAX - JOIN_ANGLE_MIN ) * 0.5
const JOIN_ARM_LENGTH = 2.65
const PROJECTED_CUSP = { id: 'projected-cusp', phi: 1.155, theta: 0.271, radius: 24 }

const CAP_PATH = [[-1.75, 0], [1.75, 0]]

const REVERSAL_PATH = [
	[-3.1, -0.75],
	[1.15, -0.75],
	[-2.25, -0.75],
	[-2.25, 0.95],
	[2.15, 0.95],
]

// `labelOffset` puts each label just in front of its specimen, between it and the camera.
const joinSpecimen = ( label, x, color, gradientColor, type, limit ) => ( {
	label,
	kind: 'join',
	center: [x, 1.45],
	labelOffset: 2,
	color,
	gradientColor,
	join: { type, limit, segments: JOIN_FAN_SEGMENTS },
	cap: { type: 'butt' },
} )

const capSpecimen = ( label, x, color, gradientColor, type ) => ( {
	label,
	kind: 'cap',
	center: [x, -2.55],
	labelOffset: 1.05,
	points: CAP_PATH,
	color,
	gradientColor,
	// A two-point path has no join: the type only feeds the metrics.
	join: { type: 'miter' },
	cap: { type, segments: FAN_SEGMENTS },
} )

const SURFACE_EXAMPLES = [
	joinSpecimen( 'MITER JOIN', -6.2, 0xF59E0B, 0xFDE047, 'miter', DEFAULT_MITER_LIMIT ),
	joinSpecimen( 'TRUE BEVEL', 0, 0xF97316, 0xEF4444, 'bevel' ),
	joinSpecimen( 'TRUE ROUND FAN', 6.2, 0xFB7185, 0xD946EF, 'round' ),
	capSpecimen( 'BUTT CAP', -6, 0x22C55E, 0x2DD4BF, 'butt' ),
	capSpecimen( 'SQUARE CAP', 0, 0x14B8A6, 0x38BDF8, 'square' ),
	capSpecimen( 'TRUE ROUND CAP', 6, 0x06B6D4, 0x818CF8, 'round' ),
	{
		label: '180° REVERSAL · 2 RUNS',
		kind: 'reversal',
		center: [0, -6.35],
		labelOffset: 1.55,
		points: REVERSAL_PATH,
		color: 0xA78BFA,
		gradientColor: 0xF472B6,
		width: 0.68,
		join: { type: 'round', segments: FAN_SEGMENTS },
		cap: { type: 'round', segments: FAN_SEGMENTS },
	},
]

const SCREEN_PATH_X = [-8.2, -5.4, -2.7, 0, 2.7, 5.4, 8.2]
const screenZigzag = ( heights, z ) => new Float32Array( heights.flatMap( ( y, index ) => [SCREEN_PATH_X[index], y, z] ) )

// The screen-space GPU path closes the table as its back row. The projected
// cusp regression pose keeps the original placement it was tuned against.
const CUSP_SCREEN_PATH = screenZigzag( [3.15, 4.35, 2.95, 4.45, 2.95, 4.35, 3.15], 5.8 )
const SCREEN_PATH_Z = -10.2
const SCREEN_PATH = screenZigzag( [0.75, 1.95, 0.55, 2.05, 0.55, 1.95, 0.75], SCREEN_PATH_Z )

// `?case=projected-cusp` is the deterministic edge-on regression pose of the GPU path,
// and `?theta` sweeps it across the projected reversal.
const readCameraCase = query => {
	if ( query.get( 'case' ) !== PROJECTED_CUSP.id ) return null
	const theta = Number( query.get( 'theta' ) ?? PROJECTED_CUSP.theta )
	return { ...PROJECTED_CUSP, theta: Number.isFinite( theta ) ? theta : PROJECTED_CUSP.theta }
}

// A sine crosses each angle twice per cycle: take the crossing closest to `phase`,
// so the sweep resumes from the current pose instead of jumping.
const nearestJoinPhase = ( angle, phase ) => {
	const cycle = Math.PI * 2
	const crossing = Math.asin( MathUtils.clamp( ( angle - JOIN_ANGLE_CENTER ) / JOIN_ANGLE_AMPLITUDE, -1, 1 ) )
	const nearest = candidate => candidate + Math.round( ( phase - candidate ) / cycle ) * cycle
	const first = nearest( crossing )
	const second = nearest( Math.PI - crossing )
	return Math.abs( first - phase ) < Math.abs( second - phase ) ? first : second
}

// The paths are flat: y stays 0 and position.y lifts the ribbon and its wire.
const writeJoinPose = ( target, center, angle ) => {
	const halfAngle = MathUtils.degToRad( angle * 0.5 )
	const halfWidth = Math.sin( halfAngle ) * JOIN_ARM_LENGTH
	const halfDepth = Math.cos( halfAngle ) * JOIN_ARM_LENGTH * 0.5
	const centerX = center[0]
	const centerZ = center[1] + 0.1

	target[0] = centerX - halfWidth
	target[2] = centerZ - halfDepth
	target[3] = centerX
	target[5] = centerZ + halfDepth
	target[6] = centerX + halfWidth
	target[8] = centerZ - halfDepth
	return target
}

const toSurfacePoints = ( path, [centerX, centerZ] ) => new Float32Array( path.flatMap( ( [x, z] ) => [x + centerX, 0, z + centerZ] ) )

const specimenPoints = config => config.kind === 'join'
	? writeJoinPose( new Float32Array( 9 ), config.center, JOIN_ANGLE_DEFAULT )
	: toSurfacePoints( config.points, config.center )

const surfaceLine = ( points, config, surface ) => new MeshLine()
	.lines( points )
	.lineWidth( config.width ?? SURFACE_WIDTH )
	.surface( { frame: 'fixed-up', ...surface } )
	.join( config.join )
	.cap( config.cap )
	.dynamic( config.kind === 'join' )

const createSurface = ( points, config ) => {
	const surface = surfaceLine( points, config, { side: DoubleSide, roughness: 0.68, metalness: 0.08 } )
		.needsProgress( true )
		.build()
	surface.position.y = SURFACE_Y

	const progress = smoothstep( 0.04, 0.96, varying( attribute( 'progress', 'float' ) ) )
	const surfaceColor = mix( color( config.color ), color( config.gradientColor ), progress )
	surface.material.colorNode = surfaceColor
	// The mirror camera sees the underside. Keep it colorful without changing
	// the lighting of the directly visible, front-facing ribbon.
	surface.material.emissiveNode = frontFacing.select( vec3( 0 ), surfaceColor.mul( 0.45 ) )
	return surface
}

const createWire = ( points, config ) => {
	const wire = surfaceLine( points, config, { roughness: 1 } )
		.opacity( 0.3 )
		.wireframe( true )
		.build()
	wire.position.y = WIRE_Y
	// Wireframe edges have no face culling; keeping wireframes single-sided
	// avoids redundant double-pass draws and keeps dynamic buffer resizes
	// synchronized across the reflected pass.
	wire.material.forceSinglePass = true
	return wire
}

const CAP_COST = { butt: 'compact', square: '+2 quads', round: `2×${FAN_SEGMENTS} fan` }

const specimenCost = metrics => {
	if ( metrics.kind === 'reversal' ) return 'split cusp'
	if ( metrics.kind === 'cap' ) return CAP_COST[metrics.cap]
	if ( metrics.join === 'miter' ) return metrics.variableTopology ? '> limit' : 'compact'
	if ( metrics.join === 'bevel' ) return '+1 wedge'
	return `+${Math.max( 1, metrics.triangleCount - 4 )}/${JOIN_FAN_SEGMENTS} fan`
}

// The topology really changes: read the counts in use back from the rebuilt
// geometry. Its buffers can be larger, so an animated join keeps reusing them.
const refreshBadge = ( { surface, metrics, badgeElement } ) => {
	metrics.vertexCount = surface.geometry.vertexCount
	metrics.triangleCount = surface.geometry.indexCount / 3
	metrics.variableTopology = metrics.vertexCount > metrics.sourcePointCount * 2
	metrics.badge = `${metrics.triangleCount} tris · ${specimenCost( metrics )}`
	paintBadge( badgeElement, metrics )
}

const createMetrics = ( cameraCase, examples ) => ( {
	cameraCase,
	surface: {
		exampleCount: examples.length,
		joinTypes: ['miter', 'bevel', 'round'],
		capTypes: ['butt', 'square', 'round'],
		reversalSplits: 1,
		roundHalfTurnSegments: FAN_SEGMENTS,
		animatedRoundHalfTurnSegments: JOIN_FAN_SEGMENTS,
		examples,
	},
	screen: { requested: true, active: false, reason: 'preparing' },
} )

export default class VariableTopologyExample {
	uiComponent = markRaw( VariableTopology )
	wires = []
	animatedJoins = []
	isCompactGui = false
	joinAnglePhase = nearestJoinPhase( JOIN_ANGLE_DEFAULT, 0 )
	params = reactive( {
		open: true,
		animateAngles: false,
		showTriangles: true,
		joinAngle: JOIN_ANGLE_DEFAULT,
		turnAngle: 180 - JOIN_ANGLE_DEFAULT,
		miterLimit: DEFAULT_MITER_LIMIT,
		miterScale: Number( ( 1 / Math.sin( MathUtils.degToRad( JOIN_ANGLE_DEFAULT * 0.5 ) ) ).toFixed( 2 ) ),
		telemetry: '',
	} )

	async init() {
		const query = new URLSearchParams( window.location.search )
		const reportMetrics = query.get( 'metrics' ) === '1'
		this.cameraCase = readCameraCase( query )
		this.params.animateAngles = !this.cameraCase && !reportMetrics && !reducedMotion.matches

		await stage3d.initRender( { background: 0x07101E, near: 0.1, far: 180 } )
		const cusp = this.cameraCase
		stage3d.orbit( cusp?.radius ?? 17.5, {
			target: [0, 0.4, cusp ? -1.3 : -3],
			theta: cusp?.theta,
			phi: cusp?.phi ?? 0.78,
			minPhi: 0.42,
			maxPhi: 1.25,
			minRadius: 15,
			maxRadius: 38,
			extraThetaMouse: !cusp,
			extraPhiMouse: !cusp,
		} )

		createMirror()
		this.labelRenderer = createLabelRenderer()
		this.createSpecimens()
		this.createLights()
		this.updateTelemetry()
		this.syncGuiLayout()
		await this.createScreenPath()
		this.onResize()

		if ( reportMetrics ) console.info( `[variableTopology] ${JSON.stringify( this.metrics )}` )
	}

	createSpecimens() {
		const examples = SURFACE_EXAMPLES.map( config => this.createSpecimen( config ) )
		this.metrics = createMetrics( this.cameraCase, examples )
		window.__meshLineVariableTopologyMetrics = this.metrics
		stage3d.own( () => { window.__meshLineVariableTopologyMetrics = null } )
	}

	createSpecimen( config ) {
		const points = specimenPoints( config )
		const surface = createSurface( points, config )
		const wire = createWire( points, config )
		stage3d.add( surface, wire )
		this.wires.push( wire )

		const [x, z] = config.center
		const label = createLabel( config.label, config.color, [x, LABEL_Y, z + config.labelOffset] )
		const metrics = {
			label: config.label,
			kind: config.kind,
			join: config.join.type,
			cap: config.cap.type,
			sourcePointCount: points.length / 3,
		}
		const entry = { badgeElement: addBadge( label ), center: config.center, metrics, points, surface, wire }
		refreshBadge( entry )
		if ( config.kind === 'join' ) this.animatedJoins.push( entry )
		return metrics
	}

	createLights() {
		const sun = new DirectionalLight( 0xFFF1D6, 4.2 )
		sun.position.set( -7, 15, 9 )
		stage3d.add( new HemisphereLight( 0xD9F1FF, 0x182033, 2.35 ), sun )
	}

	setAnimateAngles( enabled ) {
		this.params.animateAngles = enabled
		if ( enabled ) this.joinAnglePhase = nearestJoinPhase( this.params.joinAngle, this.joinAnglePhase )
	}

	scrubJoinAngle( angle ) {
		this.params.animateAngles = false
		this.setJoinPose( angle )
	}

	scrubTurnAngle( turn ) {
		this.scrubJoinAngle( 180 - turn )
	}

	// The wire overlay is the proof: extra triangles appear only where a join or
	// cap needs them.
	setShowTriangles( visible ) {
		this.params.showTriangles = visible
		for ( const wire of this.wires ) wire.visible = visible
	}

	syncGuiLayout() {
		const compact = stage.width <= 700
		if ( compact && !this.isCompactGui ) this.params.open = false
		this.isCompactGui = compact
	}

	async createScreenPath() {
		const path = new MeshLineGPUPath( {
			lines: this.cameraCase ? CUSP_SCREEN_PATH : SCREEN_PATH,
			lineWidth: 0.44,
			color: 0x38BDF8,
			join: { type: 'round', segments: FAN_SEGMENTS },
			cap: { type: 'round', segments: FAN_SEGMENTS },
		}, { chunkSegments: 32 } )
		const prepared = await path.prepare( stage3d.renderer, stage3d.camera )
		if ( prepared ) {
			path.gpuMesh.material.colorNode = vec4( mix( color( 0x38BDF8 ), color( 0xA78BFA ), smoothstep( 0.16, 0.84, screenUV.x ) ), 1 )
		}

		this.screenPath = path
		stage3d.add( path )
		this.metrics.screen = prepared ? path.status : { ...path.status, requested: true }
		createLabel( prepared ? 'GPU screen path · round' : 'Screen path fallback', 0x38BDF8, [0, LABEL_Y, SCREEN_PATH_Z + 1.2] )
	}

	setJoinPose( angle ) {
		const { params } = this
		params.joinAngle = angle
		params.turnAngle = 180 - angle

		for ( const entry of this.animatedJoins ) {
			writeJoinPose( entry.points, entry.center, angle )
			entry.surface.setPositions( entry.points )
			entry.wire.setPositions( entry.points )
			refreshBadge( entry )
		}
		this.updateTelemetry()
	}

	setMiterLimit( limit ) {
		this.params.miterLimit = limit
		for ( const entry of this.animatedJoins ) {
			if ( entry.metrics.join !== 'miter' ) continue
			entry.surface.miterLimit( limit )
			entry.wire.miterLimit( limit )
			refreshBadge( entry )
		}
		this.updateTelemetry()
	}

	updateTelemetry() {
		const { joinAngle, turnAngle, miterLimit } = this.params
		const { surface } = this.metrics
		const opening = Math.round( joinAngle )
		const turn = Math.round( turnAngle )
		const miterScale = 1 / Math.sin( MathUtils.degToRad( joinAngle * 0.5 ) )
		const roundedScale = Number( miterScale.toFixed( 2 ) )
		surface.joinAngle = joinAngle
		surface.turnAngle = turnAngle
		surface.miterScale = roundedScale
		surface.miterLimit = miterLimit
		this.params.miterScale = roundedScale
		this.params.telemetry = `Joins, caps + reversals · Opening ${opening}° · Turn ${turn}° · Miter ×${miterScale.toFixed( 2 )}`
	}

	onResize = () => {
		this.syncGuiLayout()
		this.screenPath.resize( stage.width, stage.height )
		this.labelRenderer.setSize( stage.width, stage.height )
	}

	update = dt => {
		if ( this.params.animateAngles ) {
			this.joinAnglePhase += dt * 0.001 * JOIN_ANGLE_SPEED * Math.PI * 2
			const angle = JOIN_ANGLE_CENTER + Math.sin( this.joinAnglePhase ) * JOIN_ANGLE_AMPLITUDE
			this.setJoinPose( angle )
		}
		this.screenPath.update( stage3d.camera )
		this.labelRenderer.render( stage3d.scene, stage3d.camera )
	}
}
