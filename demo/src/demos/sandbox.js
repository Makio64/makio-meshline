import GUI from 'lil-gui'
import { circlePositions, MeshLine, sineWavePositions, squarePositions, straightLine } from 'makio-meshline'
import { markRaw, reactive, watch } from 'vue'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
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

const normalizePreset = ( value = '' ) => value.toLowerCase().replace( /[^a-z0-9]/g, '' )

const buildPolylinePositions = ( points, segments = 48, scale = 1 ) => {
	const edgeCount = points.length - 1
	const stepsPerEdge = Math.max( 1, Math.ceil( segments / edgeCount ) )
	const positions = []

	for ( let i = 0; i < edgeCount; i++ ) {
		const start = points[i]
		const end = points[i + 1]
		const maxStep = i === edgeCount - 1 ? stepsPerEdge : stepsPerEdge - 1

		for ( let step = 0; step <= maxStep; step++ ) {
			const t = step / stepsPerEdge
			positions.push(
				( start[0] + ( end[0] - start[0] ) * t ) * scale,
				( start[1] + ( end[1] - start[1] ) * t ) * scale,
				( start[2] + ( end[2] - start[2] ) * t ) * scale,
			)
		}
	}

	return new Float32Array( positions )
}

const strongAnglePositions = ( segments = 48, width = 18 ) => {
	return buildPolylinePositions( STRONG_ANGLE_POINTS, segments, width )
}

// Irregular sawtooth — per-tooth amplitude variation produces a mix of gentle
// and hairpin bends, so uniform thickness can be eyeballed across a wide range
// of corner angles. Adjust the miter slider to watch the clamp kick in.
const zigzagPositions = ( teeth = 14, width = 20, baseAmp = 5 ) => {
	const positions = []
	const step = width / teeth
	const startX = -width / 2
	for ( let i = 0; i <= teeth; i++ ) {
		const x = startX + i * step
		const ampMod = 0.35 + 0.9 * Math.abs( Math.sin( i * 1.37 ) )
		const y = ( i % 2 === 0 ? -1 : 1 ) * baseAmp * ampMod
		positions.push( x, y, 0 )
	}
	return new Float32Array( positions )
}

// Serpentine path with amplitude swelling toward the middle — smooth curves
// with varied corner angles. Complements the angular zigzag by demonstrating
// consistent thickness across gentle and moderate bends.
const snakePositions = ( segments = 240, width = 22 ) => {
	const positions = new Float32Array( ( segments + 1 ) * 3 )
	for ( let i = 0; i <= segments; i++ ) {
		const t = i / segments
		const x = -width / 2 + width * t
		const envelope = 0.3 + 0.7 * Math.sin( t * Math.PI )
		const y = 5 * envelope * Math.sin( t * Math.PI * 5 )
		positions[i * 3] = x
		positions[i * 3 + 1] = y
		positions[i * 3 + 2] = 0
	}
	return positions
}

class SandboxExample {
	constructor() {
		this.uiComponent = markRaw( SandboxView )
		this.line = null
		this.gui = null
		this.animationHandler = null
		this.highlighter = null
		this.hasNoMenu = false
		this.animatedDashOffset = 0
		this.stopWatchers = []
		this.copyFeedbackTimer = null
		this.uiState = reactive( {
			compact: false,
			activePanel: 'preview',
			copyState: 'idle',
		} )
		
		// Reactive configuration
		this.config = reactive( {
			// Geometry: an open curve, so the default gradient has no seam.
			lineType: 'snake',
			segments: 64,
			closed: false,
			
			// Appearance
			color: '#ff4d6d',
			lineWidth: 20,
			opacity: 1.0,
			
			// Gradient
			useGradient: true,
			gradientColor: '#4cc9f0',
			
			// Dashes
			useDashes: false,
			dashCount: 8,
			dashRatio: 0.5,
			dashOffset: 0,
			animateDashes: false,
			
			// Size
			sizeAttenuation: false,
			
			// Advanced
			wireframe: false,
			bevelJoins: false,
			antialias: false,
			miterLimit: 4,
			smoothSharpBends: false,
			smoothSharpBendsAlpha: 0.001,
			smoothSharpBendsThreshold: -0.5,
			
			// Generated code
			generatedCode: '',
			highlightedCode: ''
		} )
	}

	async init() {
		// Check for noUI parameter
		const urlParams = new URLSearchParams( window.location.search )
		this.hasNoMenu = urlParams.has( 'noUI' )
		this.applyUrlPreset( urlParams )
		
		// Initialize 3D scene
		await stage3d.initRender()
		stage3d.camera.position.set( 0, 0, 30 )
		stage3d.control = new OrbitControl( stage3d.camera, 40 )
		stage3d.control.maxRadius = 60
		stage3d.control.minRadius = 20
		
		// Initialize GUI
		this.initGUI()
		
		// Create initial line
		this.createLine()
		
		// Set up reactive watchers
		this.setupWatchers()

		stage.onUpdate.add( this.updateDashes )
		stage.onResize.add( this.onResize )
	}
	
	initGUI() {
		this.gui = new GUI( { title: 'Line controls', width: this.hasNoMenu ? 220 : 350 } )
		this.gui.domElement.id = 'sandbox-controls'
		this.gui.domElement.classList.add( 'SandboxControls' )
		this.gui.domElement.style.right = this.hasNoMenu ? '0' : '60px'
		
		// Line Shape folder
		const geometryFolder = this.gui.addFolder( 'Line Shape' )
		geometryFolder.add( this.config, 'lineType', {
			Circle: 'circle',
			Sine: 'sine',
			Square: 'square',
			Straight: 'straight',
			'Strong Angle': 'strongAngle',
			Zigzag: 'zigzag',
			Snake: 'snake'
		} ).onChange( ( value ) => this.configureLineType( value ) )
		geometryFolder.add( this.config, 'segments', 8, 256, 1 )
		geometryFolder.add( this.config, 'closed' )
		geometryFolder.open()
		
		// Appearance folder (merged with colors)
		const appearanceFolder = this.gui.addFolder( 'Appearance' )
		appearanceFolder.addColor( this.config, 'color' )
		appearanceFolder.add( this.config, 'opacity', 0, 1, 0.01 )
		appearanceFolder.add( this.config, 'useGradient' ).name( 'Gradient Enabled' )
		appearanceFolder.addColor( this.config, 'gradientColor' ).name( 'Gradient Color' )
		appearanceFolder.add( this.config, 'lineWidth', 0.1, 25, 0.1 ).name( 'Line Width' )
		appearanceFolder.add( this.config, 'sizeAttenuation' ).name( 'Size Attenuation' )
		appearanceFolder.add( this.config, 'wireframe' )
		appearanceFolder.open()
		
		// Dashes folder
		const dashFolder = this.gui.addFolder( 'Dashes' )
		dashFolder.add( this.config, 'useDashes' )
		dashFolder.add( this.config, 'dashCount', 1, 32, 1 )
		dashFolder.add( this.config, 'dashRatio', 0.1, 0.9, 0.01 )
		dashFolder.add( this.config, 'dashOffset', 0, 1, 0.01 )
		dashFolder.add( this.config, 'animateDashes' )
		
		// Advanced folder
		const advancedFolder = this.gui.addFolder( 'Advanced' )
		advancedFolder.add( this.config, 'miterLimit', 1, 10, 0.1 ).name( 'Miter Limit' )
		advancedFolder.add( this.config, 'bevelJoins' ).name( 'Bevel Joins' )
		advancedFolder.add( this.config, 'antialias' ).name( 'Analytic AA' )
		advancedFolder.add( this.config, 'smoothSharpBends' ).name( 'Smooth Sharp Bends' )
		advancedFolder.add( this.config, 'smoothSharpBendsAlpha', 0.001, 0.5, 0.001 ).name( 'Smooth Cutoff' )
		advancedFolder.add( this.config, 'smoothSharpBendsThreshold', -1, 1, 0.05 ).name( 'Sharp Threshold' )
		
		this.syncUiLayout()
	}

	setMobilePanel( panel ) {
		if ( !['preview', 'controls', 'code'].includes( panel ) ) return
		this.uiState.activePanel = panel
		this.syncUiLayout()
	}

	syncUiLayout() {
		const compact = stage.width <= 768
		if ( compact && !this.uiState.compact ) this.uiState.activePanel = 'preview'
		this.uiState.compact = compact

		if ( !this.gui ) return
		if ( compact && this.uiState.activePanel !== 'controls' ) this.gui.hide()
		else this.gui.show()
	}

	applyUrlPreset( urlParams ) {
		const preset = normalizePreset( urlParams.get( 'preset' ) || urlParams.get( 'shape' ) || urlParams.get( 'lineType' ) || '' )

		if ( preset === 'strongangle' ) {
			Object.assign( this.config, {
				lineType: 'strongAngle',
				segments: 72,
				closed: false,
				color: '#ff5a36',
				lineWidth: 18,
				useGradient: true,
				gradientColor: '#0ea5e9',
				useDashes: false,
				animateDashes: false,
				miterLimit: 4,
				smoothSharpBends: true,
			} )
			return
		}

		if ( preset === 'zigzag' || preset === 'snake' ) {
			Object.assign( this.config, {
				lineType: preset,
				closed: false,
				useDashes: false,
				animateDashes: false,
				smoothSharpBends: preset === 'zigzag',
			} )
		}
	}

	configureLineType( value ) {
		if ( value === 'circle' || value === 'square' ) {
			this.config.closed = true
			this.config.useGradient = true
		} else {
			this.config.closed = false
		}

		if ( value === 'strongAngle' ) {
			this.config.useGradient = true
		}

		if ( value === 'zigzag' || value === 'strongAngle' ) {
			this.config.smoothSharpBends = true
		}
	}
	
	setupWatchers() {
		// Watch for geometry or structural shader-graph changes that require recreation
		this.stopWatchers.push( watch(
			() => ( {
				lineType: this.config.lineType,
				segments: this.config.segments,
				closed: this.config.closed,
				useGradient: this.config.useGradient,
				useDashes: this.config.useDashes,
				sizeAttenuation: this.config.sizeAttenuation,
				bevelJoins: this.config.bevelJoins,
				antialias: this.config.antialias,
				smoothSharpBends: this.config.smoothSharpBends,
			} ),
			() => this.createLine()
		) )
		
		// Watch for uniform-only material changes (no geometry or shader rebuild needed)
		this.stopWatchers.push( watch(
			() => ( {
				color: this.config.color,
				lineWidth: this.config.lineWidth,
				opacity: this.config.opacity,
				gradientColor: this.config.gradientColor,
				dashCount: this.config.dashCount,
				dashRatio: this.config.dashRatio,
				dashOffset: this.config.dashOffset,
				wireframe: this.config.wireframe,
				miterLimit: this.config.miterLimit,
				smoothSharpBendsAlpha: this.config.smoothSharpBendsAlpha,
				smoothSharpBendsThreshold: this.config.smoothSharpBendsThreshold,
			} ),
			() => this.updateMaterial()
		) )
	}
	
	getLinePositions() {
		switch ( this.config.lineType ) {
			case 'circle':
				return circlePositions( this.config.segments, 10 )
			case 'sine':
				return sineWavePositions( 2, this.config.segments, 1, 20 )
			case 'square':
				return squarePositions( 20, this.config.segments )
			case 'strongAngle':
				return strongAnglePositions( this.config.segments, 18 )
			case 'zigzag':
				return zigzagPositions( 14, 20, 5 )
			case 'snake':
				return snakePositions( 240, 22 )
			case 'straight':
			default:
				return straightLine( 20, this.config.segments )
		}
	}
	
	createLine() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}
		
		const positions = this.getLinePositions()
		this.animatedDashOffset = this.config.dashOffset
		
		this.line = new MeshLine()
			.lines( positions )
			.closed( this.config.closed )
			.color( this.config.color )
			.lineWidth( this.config.lineWidth )
			.opacity( this.config.opacity )
			.transparent( this.config.opacity < 1 )
			.sizeAttenuation( this.config.sizeAttenuation )
			.antialias( this.config.antialias )
			.wireframe( this.config.wireframe )
			.renderSize( stage.width, stage.height )
			.dpr( stage.devicePixelRatio )
		
		if ( this.config.useGradient ) {
			this.line.gradientColor( this.config.gradientColor )
		}
		
		if ( this.config.useDashes ) {
			this.line.dash( { count: this.config.dashCount, ratio: this.config.dashRatio, offset: this.config.dashOffset } )
		}
		
		this.line.join( {
			type: this.config.bevelJoins ? 'bevel' : 'miter',
			limit: this.config.miterLimit,
		} )
		this.line.smoothSharpBends( this.config.smoothSharpBends )
		this.line.smoothSharpBendsAlpha( this.config.smoothSharpBendsAlpha )
		this.line.smoothSharpBendsThreshold( this.config.smoothSharpBendsThreshold )

		this.line.build()
		stage3d.add( this.line )
		
		this.generateCode()
	}
	
	updateMaterial() {
		if ( !this.line ) {
			this.createLine()
			return
		}
		this.animatedDashOffset = this.config.dashOffset
		this.line
			.color( this.config.color )
			.lineWidth( this.config.lineWidth )
			.opacity( this.config.opacity )
			.transparent( this.config.opacity < 1 )
			.wireframe( this.config.wireframe )
			.smoothSharpBendsAlpha( this.config.smoothSharpBendsAlpha )
			.smoothSharpBendsThreshold( this.config.smoothSharpBendsThreshold )

		if ( this.config.useGradient ) {
			this.line.gradientColor( this.config.gradientColor )
		}
		if ( this.config.useDashes ) {
			this.line.dash( { count: this.config.dashCount, ratio: this.config.dashRatio, offset: this.config.dashOffset } )
		}

		this.generateCode()
	}
	
	generateCode() {
		const code = generateSandboxCode( this.config )
		this.config.generatedCode = code
		
		// Apply syntax highlighting
		this.highlightCode( code )
	}
	
	async loadHighlighter() {
		if ( this.highlighter ) return
		
		try {
			const { createCodeHighlighter } = await import( '@/utils/createHighlighter' )
			this.highlighter = await createCodeHighlighter()
		} catch ( error ) {
			console.error( 'Failed to load syntax highlighter:', error )
		}
	}
	
	async highlightCode( code ) {
		// Start with plain code
		this.config.highlightedCode = code
		
		// Load highlighter if not already loaded
		if ( !this.highlighter ) {
			await this.loadHighlighter()
		}
		
		// Apply highlighting if available
		if ( this.highlighter ) {
			try {
				const html = this.highlighter.codeToHtml( code, {
					lang: 'javascript',
					theme: 'github-dark'
				} )
				this.config.highlightedCode = html
			} catch ( error ) {
				console.error( 'Failed to highlight code:', error )
			}
		}
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
	
	updateDashes = ( dt ) => {
		if ( !this.config.animateDashes || !this.config.useDashes || !this.line ) return

		this.animatedDashOffset -= ( dt / 8 ) * 0.02
		if ( this.line.material?.dashOffset ) {
			this.line.material.dashOffset.value = this.animatedDashOffset
		}
	}
	
	onResize = () => {
		this.syncUiLayout()
		this.line?.resize( stage.width, stage.height )
	}

	dispose() {
		stage.onUpdate.remove( this.updateDashes )
		stage.onResize.remove( this.onResize )
		this.stopWatchers.forEach( stop => stop() )
		this.stopWatchers = []
		clearTimeout( this.copyFeedbackTimer )
		this.copyFeedbackTimer = null

		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		this.gui?.destroy()
		stage3d.control?.dispose()
	}

}

export default SandboxExample
