/**
 * Sandbox — interactive MeshLine configurator and live code generator.
 * Demonstrates: shape presets, gradients, dashes, sizeAttenuation, join({ type, limit, fold }),
 * antialias, smoothSharpBends, and live copy-paste code output.
 */
import { circlePositions, MeshLine, sineWavePositions, squarePositions, straightLine } from 'makio-meshline'
import { MathUtils } from 'three/webgpu'
import { markRaw, reactive, watch } from 'vue'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'
import { linePoints } from '@/utils/points'
import { generateSandboxCode } from '@/utils/sandboxCode'
import SandboxView from '@/views/SandboxView.vue'

const STRONG_ANGLE_POINTS = [
	[-0.8, -0.45, 0],
	[-0.22, -0.12, 0],
	[-0.04, 0.78, 0],
	[0.03, -0.82, 0],
	[0.22, 0.1, 0],
	[0.8, 0.46, 0],
]

// Shape options: the built line takes the new points in place.
const SHAPE_KEYS = ['lineType', 'segments', 'closed']

// Shader-graph options: each compiles a new shader, so the demo simply builds a new line.
const REBUILD_KEYS = ['useGradient', 'useDashes', 'sizeAttenuation', 'joinType', 'joinFold', 'antialias']

// Options a built line applies in place, without touching its points.
const LIVE_KEYS = ['color', 'lineWidth', 'opacity', 'gradientColor', 'dashCount', 'dashRatio', 'dashOffset', 'animateDashes', 'wireframe', 'miterLimit']

// Options that split the points again: the geometry is rebuilt, the shader stays.
const SMOOTHING_KEYS = ['smoothSharpBends', 'smoothSharpBendsAlpha', 'smoothSharpBendsThreshold']

// Picked with `?preset=`, `?shape=` or `?lineType=`, ignoring case and punctuation.
const URL_PRESETS = {
	strongangle: {
		lineType: 'strongAngle',
		segments: 72,
		color: '#ff5a36',
		lineWidth: 18,
		gradientColor: '#0ea5e9',
		smoothSharpBends: true,
	},
	zigzag: { lineType: 'zigzag', smoothSharpBends: true },
	helix: { lineType: 'helix' },
}

const urlPreset = () => {
	const query = new URLSearchParams( window.location.search )
	const name = query.get( 'preset' ) || query.get( 'shape' ) || query.get( 'lineType' ) || ''
	return URL_PRESETS[name.toLowerCase().replace( /[^a-z0-9]/g, '' )]
}

// Subdivides every edge evenly, so each sharp corner stays an exact vertex.
const strongAnglePositions = segments => {
	const edges = STRONG_ANGLE_POINTS.length - 1
	const steps = Math.ceil( segments / edges )
	return linePoints( edges * steps + 1, ( _, i ) => {
		const edge = Math.min( Math.floor( i / steps ), edges - 1 )
		const t = ( i - edge * steps ) / steps
		const end = STRONG_ANGLE_POINTS[edge + 1]
		return STRONG_ANGLE_POINTS[edge].map( ( start, axis ) => MathUtils.lerp( start, end[axis], t ) * 18 )
	} )
}

// Gentle and hairpin bends side by side. Move the miter slider to watch the clamp kick in.
const zigzagPositions = () => linePoints( 15, ( t, i ) => {
	const amplitude = 5 * ( 0.35 + 0.9 * Math.abs( Math.sin( i * 1.37 ) ) )
	return [-10 + 20 * t, i % 2 === 0 ? -amplitude : amplitude, 0]
} )

// Checks consistent thickness across gentle and moderate bends, where zigzag is angular.
const snakePositions = () => linePoints( 241, t => {
	const envelope = 0.3 + 0.7 * Math.sin( t * Math.PI )
	return [-11 + 22 * t, 5 * envelope * Math.sin( t * Math.PI * 5 ), 0]
} )

// Depth in Z, to test sizeAttenuation and 3D projected corner folding while orbiting.
const helixPositions = segments => linePoints( segments + 1, t => {
	const angle = t * Math.PI * 2 * 3.5
	return [-9 + 18 * t, Math.cos( angle ) * 5.5, Math.sin( angle ) * 5.5]
} )

const LINE_POSITIONS = {
	snake: snakePositions,
	helix: helixPositions,
	circle: segments => circlePositions( segments, 10 ),
	sine: segments => sineWavePositions( 2, segments, 1, 20 ),
	square: segments => squarePositions( 20, segments ),
	straight: segments => straightLine( 20, segments ),
	strongAngle: strongAnglePositions,
	zigzag: zigzagPositions,
}

export default class SandboxExample {
	uiComponent = markRaw( SandboxView )
	hasNoMenu = noUI
	uiState = reactive( { compact: false, activePanel: 'preview', controlsOpen: true, controlsHidden: false, copyState: 'idle' } )
	config = reactive( {
		// An open curve, so the default gradient has no seam.
		lineType: 'snake',
		segments: 64,
		closed: false,

		color: '#ff4d6d',
		lineWidth: 20,
		opacity: 1,
		useGradient: true,
		gradientColor: '#4cc9f0',

		useDashes: false,
		dashCount: 8,
		dashRatio: 0.5,
		dashOffset: 0,
		animateDashes: false,

		sizeAttenuation: false,
		wireframe: false,
		joinType: 'miter',
		joinFold: 'geometry',
		antialias: false,
		miterLimit: 4,
		smoothSharpBends: false,
		smoothSharpBendsAlpha: 0.001,
		smoothSharpBendsThreshold: -0.5,

		generatedCode: '',
	} )

	async init() {
		Object.assign( this.config, urlPreset() )

		await stage3d.initRender()
		stage3d.orbit( 40, { minRadius: 20, maxRadius: 60 } )

		this.syncUiLayout()
		this.createLine()

		const onChange = ( keys, update ) => stage3d.own( watch( () => keys.map( key => this.config[key] ), update ) )
		onChange( SHAPE_KEYS, () => this.updateShape() )
		onChange( REBUILD_KEYS, () => this.createLine() )
		onChange( LIVE_KEYS, () => this.updateMaterial() )
		onChange( SMOOTHING_KEYS, () => this.updateSmoothing() )

		stage3d.own( () => clearTimeout( this.copyFeedbackTimer ) )
	}

	createLine() {
		const { config } = this
		this.line?.dispose()
		this.closed = config.closed
		this.smoothing = { enabled: config.smoothSharpBends, alpha: config.smoothSharpBendsAlpha, threshold: config.smoothSharpBendsThreshold }
		this.points = LINE_POSITIONS[config.lineType]( config.segments )
		this.line = new MeshLine()
			.lines( this.points, config.closed )
			// The shape controls give this line new points: it keeps its buffers and its shader.
			.dynamic( true )
			.sizeAttenuation( config.sizeAttenuation )
			.antialias( config.antialias )
			.join( { type: config.joinType, limit: config.miterLimit, fold: config.joinFold } )
			.smoothSharpBends( config.smoothSharpBends )
			.smoothSharpBendsAlpha( config.smoothSharpBendsAlpha )
			.smoothSharpBendsThreshold( config.smoothSharpBendsThreshold )
			// The canvas ratio, which stage caps: exact folds and analytic AA measure in device pixels.
			.dpr( stage.devicePixelRatio )
			.autoResize()

		this.updateMaterial()
		stage3d.add( this.line.build() )
	}

	updateMaterial() {
		const { config, line } = this
		line
			.color( config.color )
			.lineWidth( config.lineWidth )
			.opacity( config.opacity )
			.wireframe( config.wireframe )
			.miterLimit( config.miterLimit )

		if ( config.useGradient ) line.gradientColor( config.gradientColor )
		if ( config.useDashes ) line.dash( { count: config.dashCount, ratio: config.dashRatio, offset: config.dashOffset } )

		config.generatedCode = generateSandboxCode( config )
	}

	updateShape() {
		const { config, line } = this
		const points = LINE_POSITIONS[config.lineType]( config.segments )
		// Snake and Zigzag ignore segments and Strong Angle rounds it: skip a step that sends the same points.
		const same = config.closed === this.closed && points.length === this.points.length && points.every( ( value, i ) => value === this.points[i] )
		if ( !same ) {
			this.points = points
			// setPositions() takes any point count and refreshes the culling bounds; opening or closing the loop needs lines().
			if ( config.closed === this.closed ) line.setPositions( points, true )
			else line.lines( points, this.closed = config.closed )
		}

		config.generatedCode = generateSandboxCode( config )
	}

	updateSmoothing() {
		const { config, line, smoothing } = this
		// Each smoothing setter splits the points of the built line again, even with smoothing off: send only
		// what differs from what the line holds, and the two values only while smoothing is on.
		if ( config.smoothSharpBends && config.smoothSharpBendsAlpha !== smoothing.alpha ) line.smoothSharpBendsAlpha( smoothing.alpha = config.smoothSharpBendsAlpha )
		if ( config.smoothSharpBends && config.smoothSharpBendsThreshold !== smoothing.threshold ) line.smoothSharpBendsThreshold( smoothing.threshold = config.smoothSharpBendsThreshold )
		if ( config.smoothSharpBends !== smoothing.enabled ) line.smoothSharpBends( smoothing.enabled = config.smoothSharpBends )

		config.generatedCode = generateSandboxCode( config )
	}

	update = dt => {
		if ( !this.config.animateDashes || !this.config.useDashes ) return
		this.line.material.dashOffset.value -= ( dt / 8 ) * 0.02
	}

	configureLineType( value ) {
		// The rebuild key first: its watcher then runs first and builds the new shape once.
		if ( ['circle', 'square', 'strongAngle', 'helix'].includes( value ) ) this.config.useGradient = true
		this.config.lineType = value
		this.config.closed = value === 'circle' || value === 'square'
		if ( value === 'zigzag' || value === 'strongAngle' ) this.config.smoothSharpBends = true
	}

	setMobilePanel( panel ) {
		this.uiState.activePanel = panel
		this.syncUiLayout()
	}

	syncUiLayout() {
		const compact = stage.width <= 768
		if ( compact && !this.uiState.compact ) this.uiState.activePanel = 'preview'
		this.uiState.compact = compact
		this.uiState.controlsHidden = compact && this.uiState.activePanel !== 'controls'
	}

	onResize = () => {
		this.syncUiLayout()
		// stage recomputes its capped ratio on resize: keep the line's AA and folds on the canvas grid.
		this.line.dpr( stage.devicePixelRatio )
	}

	async copyCode() {
		clearTimeout( this.copyFeedbackTimer )
		try {
			await navigator.clipboard.writeText( this.config.generatedCode )
			this.uiState.copyState = 'copied'
		} catch ( error ) {
			console.error( 'Failed to copy generated code:', error )
			this.uiState.copyState = 'failed'
		}
		this.copyFeedbackTimer = setTimeout( () => {
			this.uiState.copyState = 'idle'
		}, 2000 )
	}
}
