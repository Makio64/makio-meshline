import { createApp, h, reactive, watch } from 'vue'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import stage from '@/makio/core/stage'
import { MeshLine, circlePositions, sineWavePositions, squarePositions, straightLine } from 'meshline'
import GUI from 'lil-gui'
import SandboxView from '@/views/SandboxView.vue'

class SandboxExample {
	constructor() {
		this.app = null
		this.container = null
		this.line = null
		this.gui = null
		this.animationHandler = null
		this.highlighter = null
		
		// Reactive configuration
		this.config = reactive( {
			// Geometry
			lineType: 'circle',
			segments: 64,
			isClose: true,
			
			// Appearance
			color: '#ff3300',
			lineWidth: 2,
			opacity: 1.0,
			
			// Gradient
			useGradient: true,
			gradientColor: '#0033ff',
			
			// Dashes
			useDashes: false,
			dashCount: 8,
			dashRatio: 0.5,
			dashOffset: 0,
			animateDashes: false,
			
			// Size
			sizeAttenuation: true,
			
			// Advanced
			wireframe: false,
			useMiterLimit: true,
			miterLimit: 4,
			
			// Generated code
			generatedCode: '',
			highlightedCode: ''
		} )
	}

	async init() {
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
		
		// Create Vue app for display
		this.container = document.createElement( 'div' )
		this.container.style.width = '100%'
		this.container.style.height = '100vh'
		document.body.appendChild( this.container )
		
		this.app = createApp( {
			render: () => h( SandboxView, {
				generatedCode: this.config.generatedCode,
				highlightedCode: this.config.highlightedCode,
				'onCopy-code': () => this.copyCode()
			} )
		} )
		this.app.mount( this.container )
		
		stage.onUpdate.add( this.updateDashes )
		
		// Add resize handler
		window.addEventListener( 'resize', this.onResize )
	}
	
	initGUI() {
		this.gui = new GUI( { width: 350 } )
		this.gui.domElement.style.right = '60px'
		
		// Line Shape folder
		const geometryFolder = this.gui.addFolder( 'Line Shape' )
		geometryFolder.add( this.config, 'lineType', ['circle', 'sine', 'square', 'straight'] ).onChange( ( value ) => {
			// Auto-configure based on line type
			if ( value === 'circle' || value === 'square' ) {
				this.config.isClose = true
				this.config.useGradient = true
			} else if ( value === 'sine' || value === 'straight' ) {
				this.config.isClose = false
			}
		} )
		geometryFolder.add( this.config, 'segments', 8, 256, 1 )
		geometryFolder.add( this.config, 'isClose' )
		geometryFolder.open()
		
		// Appearance folder
		const appearanceFolder = this.gui.addFolder( 'Appearance' )
		appearanceFolder.add( this.config, 'lineWidth', 0.01, 10, 0.01 )
		appearanceFolder.add( this.config, 'sizeAttenuation' ).name( 'Size Attenuation' )
		appearanceFolder.add( this.config, 'opacity', 0, 1, 0.01 )
		appearanceFolder.open()
		
		// Colors folder
		const colorsFolder = this.gui.addFolder( 'Colors' )
		colorsFolder.addColor( this.config, 'color' )
		colorsFolder.add( this.config, 'useGradient' )
		colorsFolder.addColor( this.config, 'gradientColor' )
		colorsFolder.open()
		
		// Dashes folder
		const dashFolder = this.gui.addFolder( 'Dashes' )
		dashFolder.add( this.config, 'useDashes' )
		dashFolder.add( this.config, 'dashCount', 1, 32, 1 )
		dashFolder.add( this.config, 'dashRatio', 0.1, 0.9, 0.01 )
		dashFolder.add( this.config, 'dashOffset', 0, 1, 0.01 )
		dashFolder.add( this.config, 'animateDashes' )
		
		// Advanced folder
		const advancedFolder = this.gui.addFolder( 'Advanced' )
		advancedFolder.add( this.config, 'wireframe' )
		advancedFolder.add( this.config, 'useMiterLimit' )
		advancedFolder.add( this.config, 'miterLimit', 1, 10, 0.1 )
		
		// Actions
		this.gui.add( { copyCode: () => this.copyCode() }, 'copyCode' ).name( '📋 Copy Code' )
	}
	
	setupWatchers() {
		// Watch for geometry changes that require recreation
		watch(
			() => ( { lineType: this.config.lineType, segments: this.config.segments, isClose: this.config.isClose } ),
			() => this.createLine()
		)
		
		// Watch for material changes
		watch(
			() => ( {
				color: this.config.color,
				lineWidth: this.config.lineWidth,
				opacity: this.config.opacity,
				useGradient: this.config.useGradient,
				gradientColor: this.config.gradientColor,
				useDashes: this.config.useDashes,
				dashCount: this.config.dashCount,
				dashRatio: this.config.dashRatio,
				dashOffset: this.config.dashOffset,
				sizeAttenuation: this.config.sizeAttenuation,
				wireframe: this.config.wireframe,
				useMiterLimit: this.config.useMiterLimit,
				miterLimit: this.config.miterLimit,
			} ),
			() => this.updateMaterial()
		)
	}
	
	getLinePositions() {
		switch ( this.config.lineType ) {
			case 'circle':
				return circlePositions( this.config.segments, 10 )
			case 'sine':
				return sineWavePositions( 2, this.config.segments, 1, 20 )
			case 'square':
				return squarePositions( 20, this.config.segments )
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
		
		this.line = new MeshLine()
			.lines( positions )
			.isClose( this.config.isClose )
			.color( this.config.color )
			.lineWidth( this.config.lineWidth )
			.opacity( this.config.opacity )
			.transparent( this.config.opacity < 1 )
			.sizeAttenuation( this.config.sizeAttenuation )
			.wireframe( this.config.wireframe )
		
		if ( this.config.useGradient ) {
			this.line.gradientColor( this.config.gradientColor )
		}
		
		if ( this.config.useDashes ) {
			this.line.dashes( this.config.dashCount, this.config.dashRatio, this.config.dashOffset )
		}
		
		if ( this.config.useMiterLimit ) {
			this.line.useMiterLimit( true, this.config.miterLimit )
		}
		
		this.line.build()
		stage3d.add( this.line )
		
		this.generateCode()
	}
	
	updateMaterial() {
		// For material changes, it's safer to recreate the line
		// This ensures all properties are properly initialized
		this.createLine()
	}
	
	generateCode() {
		let code = `import { MeshLine`
		
		// Add position helper import if needed
		if ( this.config.lineType === 'straight' ) {
			code += `, straightLine`
		} else {
			code += `, ${this.config.lineType}Positions`
		}
		code += ` } from 'meshline'\n\n`
		
		// Position generation
		if ( this.config.lineType === 'straight' ) {
			code += `const positions = straightLine( 20, ${this.config.segments} )\n\n`
		} else {
			code += `const positions = ${this.config.lineType}Positions( `
			if ( this.config.lineType === 'circle' ) {
				code += `${this.config.segments}, 10`
			} else if ( this.config.lineType === 'sine' ) {
				code += `2, ${this.config.segments}, 1, 4`
			} else if ( this.config.lineType === 'square' ) {
				code += `20, ${this.config.segments}`
			}
			code += ` )\n\n`
		}
		
		// MeshLine creation
		code += `const line = new MeshLine()\n`
		code += `\t.lines( positions )\n`
		
		if ( this.config.isClose ) {
			code += `\t.isClose( true )\n`
		}
		
		code += `\t.color( 0x${this.config.color.substring( 1 )} )\n`
		code += `\t.lineWidth( ${this.config.lineWidth} )\n`
		
		if ( this.config.opacity !== 1 ) {
			code += `\t.opacity( ${this.config.opacity} )\n`
		}
		
		if ( this.config.opacity < 1 ) {
			code += `\t.transparent( true )\n`
		}
		
		if ( this.config.sizeAttenuation ) {
			code += `\t.sizeAttenuation( true )\n`
		}
		
		if ( this.config.useGradient ) {
			code += `\t.gradientColor( 0x${this.config.gradientColor.substring( 1 )} )\n`
		}
		
		if ( this.config.useDashes ) {
			code += `\t.dashes( ${this.config.dashCount}, ${this.config.dashRatio}`
			if ( this.config.dashOffset !== 0 ) {
				code += `, ${this.config.dashOffset}`
			}
			code += ` )\n`
		}
		
		if ( this.config.wireframe ) {
			code += `\t.wireframe( true )\n`
		}
		
		if ( this.config.useMiterLimit ) {
			code += `\t.useMiterLimit( true, ${this.config.miterLimit} )\n`
		}
		
		code += `\t.build()\n\n`
		code += `scene.add( line )`
		
		if ( this.config.animateDashes && this.config.useDashes ) {
			code += `\n\n// Animation loop\nfunction animate() {\n`
			code += `\tline.material.dashOffset.value -= 0.01\n`
			code += `\trequestAnimationFrame( animate )\n}`
		}
		
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
	
	copyCode() {
		navigator.clipboard.writeText( this.config.generatedCode ).then( () => {
			// Show success feedback
			const button = this.gui.controllers.find( c => c.property === 'copyCode' )
			if ( button ) {
				const originalText = button._name
				button.name( '✅ Copied!' )
				setTimeout( () => button.name( originalText ), 2000 )
			}
		} )
	}
	
	updateDashes = ( dt ) => {
		if ( this.config.animateDashes && this.config.useDashes && this.line && this.line.material.dashOffset ) {
			this.line.material.dashOffset.value -= ( dt / 8 ) * 0.02
		}
	}
	
	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		window.removeEventListener( 'resize', this.onResize )
		
		if ( this.animationHandler ) {
			stage.onUpdate.delete( this.animationHandler )
		}
		
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}
		
		if ( this.gui ) {
			this.gui.destroy()
		}
		
		stage3d.control?.dispose()
		
		if ( this.app ) {
			this.app.unmount()
			this.app = null
		}
		if ( this.container ) {
			document.body.removeChild( this.container )
			this.container = null
		}
	}

	show() {
		// Animation is already running
	}

	hide( cb ) {
		if ( cb ) cb()
	}
}

export default new SandboxExample()