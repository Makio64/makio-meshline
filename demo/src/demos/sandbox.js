/**
 * Sandbox — interactive MeshLine configurator and live code generator.
 * Demonstrates: shape presets, gradients, dashes, sizeAttenuation, join({ type, limit, fold }),
 * antialias, smoothSharpBends, and live copy-paste code output.
 */
import GUI from 'lil-gui'
import { circlePositions, MeshLine, sineWavePositions, squarePositions, straightLine } from 'makio-meshline'
import { MathUtils } from 'three/webgpu'
import { markRaw, reactive, watch } from 'vue'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'
import { linePoints } from '@/utils/points'
import { generateSandboxCode } from '@/utils/sandboxCode'
import { highlightCode } from '@/utils/sandboxHighlight'
import SandboxView from '@/views/SandboxView.vue'

const STRONG_ANGLE_POINTS = [
	[-0.8, -0.45, 0],
	[-0.22, -0.12, 0],
	[-0.04, 0.78, 0],
	[0.03, -0.82, 0],
	[0.22, 0.1, 0],
	[0.8, 0.46, 0],
]

// Geometry and shader-graph options: changing one needs a new line.
const REBUILD_KEYS = ['lineType', 'segments', 'closed', 'useGradient', 'useDashes', 'sizeAttenuation', 'joinType', 'joinFold', 'antialias', 'smoothSharpBends']

// Options a built line applies in place.
const LIVE_KEYS = ['color', 'lineWidth', 'opacity', 'gradientColor', 'dashCount', 'dashRatio', 'dashOffset', 'wireframe', 'miterLimit', 'smoothSharpBendsAlpha', 'smoothSharpBendsThreshold']

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
	uiState = reactive( { compact: false, activePanel: 'preview', copyState: 'idle' } )
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
		highlightedCode: '',
	} )

	async init() {
		Object.assign( this.config, urlPreset() )

		await stage3d.initRender()
		stage3d.orbit( 40, { minRadius: 20, maxRadius: 60 } )

		this.initGUI()
		this.createLine()

		stage3d.own( watch( () => REBUILD_KEYS.map( key => this.config[key] ), () => this.createLine() ) )
		stage3d.own( watch( () => LIVE_KEYS.map( key => this.config[key] ), () => this.updateMaterial() ) )

		stage3d.own( () => clearTimeout( this.copyFeedbackTimer ) )
	}

	createLine() {
		const { config } = this
		this.line?.dispose()
		this.line = new MeshLine()
			.lines( LINE_POSITIONS[config.lineType]( config.segments ), config.closed )
			.sizeAttenuation( config.sizeAttenuation )
			.antialias( config.antialias )
			.join( { type: config.joinType, limit: config.miterLimit, fold: config.joinFold } )
			.smoothSharpBends( config.smoothSharpBends )
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
			.smoothSharpBendsAlpha( config.smoothSharpBendsAlpha )
			.smoothSharpBendsThreshold( config.smoothSharpBendsThreshold )

		if ( config.useGradient ) line.gradientColor( config.gradientColor )
		if ( config.useDashes ) line.dash( { count: config.dashCount, ratio: config.dashRatio, offset: config.dashOffset } )

		config.generatedCode = generateSandboxCode( config )
		highlightCode( config )
	}

	update = dt => {
		if ( !this.config.animateDashes || !this.config.useDashes ) return
		this.line.material.dashOffset.value -= ( dt / 8 ) * 0.02
	}

	initGUI() {
		const { config } = this
		this.gui = stage3d.own( new GUI( { title: 'Line controls', width: this.hasNoMenu ? 220 : 350 } ) )
		this.gui.domElement.id = 'sandbox-controls'
		this.gui.domElement.classList.add( 'SandboxControls' )
		this.gui.domElement.style.right = this.hasNoMenu ? '0' : '60px'

		const geometryFolder = this.gui.addFolder( 'Line Shape' )
		geometryFolder.add( config, 'lineType', {
			Snake: 'snake',
			'Helix (3D)': 'helix',
			Circle: 'circle',
			Sine: 'sine',
			Square: 'square',
			Straight: 'straight',
			'Strong Angle': 'strongAngle',
			Zigzag: 'zigzag',
		} ).onChange( value => this.configureLineType( value ) )
		geometryFolder.add( config, 'segments', 8, 256, 1 )
		geometryFolder.add( config, 'closed' )

		const appearanceFolder = this.gui.addFolder( 'Appearance' )
		appearanceFolder.addColor( config, 'color' )
		appearanceFolder.add( config, 'opacity', 0, 1, 0.01 )
		appearanceFolder.add( config, 'useGradient' ).name( 'Gradient Enabled' )
		appearanceFolder.addColor( config, 'gradientColor' ).name( 'Gradient Color' )
		appearanceFolder.add( config, 'lineWidth', 0.1, 25, 0.1 ).name( 'Line Width' )
		appearanceFolder.add( config, 'sizeAttenuation' ).name( 'Size Attenuation' )
		appearanceFolder.add( config, 'wireframe' )

		const dashFolder = this.gui.addFolder( 'Dashes' )
		dashFolder.add( config, 'useDashes' )
		dashFolder.add( config, 'dashCount', 1, 32, 1 )
		dashFolder.add( config, 'dashRatio', 0.1, 0.9, 0.01 )
		dashFolder.add( config, 'dashOffset', 0, 1, 0.01 )
		dashFolder.add( config, 'animateDashes' )

		const advancedFolder = this.gui.addFolder( 'Advanced' )
		advancedFolder.add( config, 'joinType', { Miter: 'miter', Bevel: 'bevel', Round: 'round' } ).name( 'Join Type' )
		advancedFolder.add( config, 'joinFold', { 'Geometry (Fast)': 'geometry', 'Exact (2-Pass)': 'exact', Off: false } ).name( '3D Fold' )
		advancedFolder.add( config, 'miterLimit', 1, 10, 0.1 ).name( 'Miter Limit' )
		advancedFolder.add( config, 'antialias' ).name( 'Analytic AA' )
		advancedFolder.add( config, 'smoothSharpBends' ).name( 'Smooth Sharp Bends' )
		advancedFolder.add( config, 'smoothSharpBendsAlpha', 0.001, 0.5, 0.001 ).name( 'Smooth Cutoff' )
		advancedFolder.add( config, 'smoothSharpBendsThreshold', -1, 1, 0.05 ).name( 'Sharp Threshold' )

		this.syncUiLayout()
	}

	configureLineType( value ) {
		this.config.closed = value === 'circle' || value === 'square'
		if ( ['circle', 'square', 'strongAngle', 'helix'].includes( value ) ) this.config.useGradient = true
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

		if ( compact && this.uiState.activePanel !== 'controls' ) this.gui.hide()
		else this.gui.show()
	}

	onResize = () => this.syncUiLayout()

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
