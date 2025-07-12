import { animate, utils } from 'animejs'
import { CanvasTexture, PlaneGeometry, MeshBasicMaterial, Mesh } from 'three/webgpu'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import { MeshLine, circlePositions } from 'meshline'

class BasicExample {
	constructor() {
		this.lines = []
		this.labels = []
		this.cssRenderer = null
		this.checkerTexture = null
		this.mapTexture = null
		this.alphaTexture = null
		this.backgroundPlane = null
		this.backgroundPlanes = []
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 13 )
		this.initCSSRenderer()
		this.initScene()
	}

	initCSSRenderer() {
		this.cssRenderer = new CSS2DRenderer()
		this.cssRenderer.setSize( window.innerWidth, window.innerHeight )
		this.cssRenderer.domElement.style.position = 'absolute'
		this.cssRenderer.domElement.style.top = '0px'
		this.cssRenderer.domElement.style.pointerEvents = 'none'
		document.body.appendChild( this.cssRenderer.domElement )

		// Handle resize
		window.addEventListener( 'resize', () => {
			this.cssRenderer.setSize( window.innerWidth, window.innerHeight )
			for ( let line of this.lines ) {
				line.resize()
			}
		}, false )
	}

	initScene() {
		// Clear existing lines and labels
		this.lines.forEach( line => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.labels.forEach( label => {
			stage3d.remove( label )
		} )
		if ( this.backgroundPlane ) {
			stage3d.remove( this.backgroundPlane )
		}
		// Clear additional background planes
		if ( this.backgroundPlanes ) {
			this.backgroundPlanes.forEach( plane => {
				stage3d.remove( plane )
			} )
			this.backgroundPlanes = []
		}
		this.lines = []
		this.labels = []

		// Create textures
		this.checkerTexture = this.createCheckerTexture() // For background planes
		this.mapTexture = this.createStripeTexture() // Better for line mapping
		this.alphaTexture = this.createAlphaTexture() // Better for alpha mapping

		// 16 different configurations to test all features
		const configs = [
			{ title: "Basic", color: 0xff0000, lineWidth: 0.2, isClose: true },
			{ title: "Thick Line", color: 0x00ff00, lineWidth: 0.5, isClose: true },
			{ title: "Open", color: 0x0000ff, isClose: false },
			{ title: "Wireframe", color: 0xff8080, wireframe: true, lineWidth: 0.3, isClose: true },

			{ title: "Dashed 4", color: 0xffff00, useDash: true, dashCount: 4, dashRatio: 0.5, isClose: true },
			{ title: "Dashed 8", color: 0xff8000, useDash: true, dashCount: 8, dashRatio: 0.6, isClose: true },
			{ title: "Dashed 16", color: 0x8000ff, useDash: true, dashCount: 16, dashRatio: 0.3, isClose: true },
			{ title: "Long Dashes", color: 0x00ff80, useDash: true, dashCount: 6, lineWidth: 0.5, dashRatio: 0.8, isClose: true },

			{ title: "Map Texture", color: 0xff4080, useMap: true, map: this.mapTexture, lineWidth: 0.3, isClose: true },
			{ title: "Dash + Gradient", color: 0x80ff40, isClose: true, useDash: true, lineWidth: 0.4, dashCount: 10, dashRatio: 0.7, useGradient: true, gradientColor: 0xff0040 },
			{ title: "Gradient Only", color: 0xff0080, isClose: true, useGradient: true, lineWidth: 0.1, gradientColor: 0x0080ff },
			{ title: "Gradient", color: 0xff00ff, useGradient: true, gradientColor: 0x00ffff, isClose: true },

			{ title: "Opacity", color: 0x8080ff, opacity: 0.6, lineWidth: 0.5, isClose: true },
			{ title: "Alpha Map", color: 0xff40ff, useAlphaMap: true, alphaMap: this.alphaTexture, lineWidth: 0.3, isClose: true },
			{ title: "Size Atten.", color: 0x80ff80, sizeAttenuation: true, lineWidth: 5, isClose: true },
			{ title: "All Features", color: 0xffffff, useGradient: true, gradientColor: 0xff0000, useDash: true, dashCount: 8, dashRatio: 0.5, isClose: true, lineWidth: 0.5 }
		]

		const positions = circlePositions( 64 )
		const gridSize = 4 // 4x4 grid
		const spacing = 3.3
		const defaultConfig = {
			usePercent: true,
			verbose: true
		}

		for ( let i = 0; i < configs.length; i++ ) {
			const config = configs[i]
			const row = Math.floor( i / gridSize )
			const col = i % gridSize

			// Create line with inverted Y (so Basic is top-left)
			const line = new MeshLine( { ...defaultConfig, ...config, lines: positions } )
			line.position.x = ( col - gridSize / 2 + 0.5 ) * spacing
			line.position.y = -( row - gridSize / 2 + 0.5 ) * spacing  // Inverted Y
			line.position.z = 0

			this.lines.push( line )
			stage3d.add( line )

			// Create background plane for Alpha Map example
			if ( config.title === "Alpha Map" ) {
				const planeGeometry = new PlaneGeometry( 2.2, 2.2 )
				const planeMaterial = new MeshBasicMaterial( {
					map: this.checkerTexture,
					transparent: false
				} )
				const alphaBackgroundPlane = new Mesh( planeGeometry, planeMaterial )
				alphaBackgroundPlane.position.copy( line.position )
				alphaBackgroundPlane.position.z = -0.3 // Behind the line

				// Store reference for cleanup
				if ( !this.backgroundPlanes ) this.backgroundPlanes = []
				this.backgroundPlanes.push( alphaBackgroundPlane )
				stage3d.add( alphaBackgroundPlane )
			}

			// Create background plane for opacity example
			if ( config.title === "Opacity" ) {
				const planeGeometry = new PlaneGeometry( 2.2, 2.2 )
				const planeMaterial = new MeshBasicMaterial( {
					map: this.checkerTexture,
					transparent: false
				} )
				this.backgroundPlane = new Mesh( planeGeometry, planeMaterial )
				this.backgroundPlane.position.copy( line.position )
				this.backgroundPlane.position.z = -0.3 // Further behind the line
				stage3d.add( this.backgroundPlane )
			}

			// Create label
			const labelDiv = document.createElement( 'div' )
			labelDiv.className = 'line-label'
			labelDiv.textContent = config.title
			labelDiv.style.color = 'white'
			labelDiv.style.fontFamily = 'Arial, sans-serif'
			labelDiv.style.fontSize = '12px'
			labelDiv.style.backgroundColor = 'rgba(0,0,0,0.7)'
			labelDiv.style.padding = '2px 6px'
			labelDiv.style.borderRadius = '3px'
			labelDiv.style.textAlign = 'center'
			labelDiv.style.minWidth = '60px'

			const label = new CSS2DObject( labelDiv )
			label.position.set( line.position.x, line.position.y - 1.2, line.position.z )

			this.labels.push( label )
			stage3d.add( label )
		}

		stage.onUpdate.add( this.update )
	}

	update = ( dt ) => {
		// Render CSS labels
		if ( this.cssRenderer ) {
			this.cssRenderer.render( stage3d.scene, stage3d.camera )
		}
	}

	show() {
		this.lines.forEach( ( line, i ) => {
			// Animate lines in, perhaps with a stagger
			line.percent.value = -0.01
			line.percent2.value = 1.01
			animate( line.percent, { duration: 1, value: 1.01, delay: i * 0.05, ease: 'easeOut' } )
			animate( line.percent2, { duration: 1, value: -0.01, delay: 3 + i * 0.05, ease: 'easeOut', onComplete: () => { if ( i === this.lines.length - 1 ) this.show() } } )
		} )
	}

	hide( cb ) {
		this.lines.forEach( ( line, i, arr ) => {
			utils.remove( line )
			animate( line.percent2, {
				duration: 0.2,
				value: 0,
				delay: i * 0.02,
				ease: 'easeOut',
				onComplete: i === arr.length - 1 ? cb : undefined
			} )
		} )
	}

	dispose() {
		console.log( 'lines dispose' )
		// Clean up lines and labels
		this.lines.forEach( line => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.labels.forEach( label => {
			stage3d.remove( label )
		} )
		if ( this.backgroundPlane ) {
			stage3d.remove( this.backgroundPlane )
			this.backgroundPlane.geometry.dispose()
			this.backgroundPlane.material.dispose()
			this.backgroundPlane = null
		}
		// Dispose additional background planes
		if ( this.backgroundPlanes ) {
			this.backgroundPlanes.forEach( plane => {
				stage3d.remove( plane )
				plane.geometry.dispose()
				plane.material.dispose()
			} )
			this.backgroundPlanes = []
		}
		this.lines = []
		this.labels = []

		// Remove CSS renderer
		if ( this.cssRenderer && this.cssRenderer.domElement.parentNode ) {
			this.cssRenderer.domElement.parentNode.removeChild( this.cssRenderer.domElement )
		}
		stage.onUpdate.remove( this.update )
		stage3d.control.dispose()
	}

	// Create a checker pattern texture
	createCheckerTexture( size = 64, divisions = 8 ) {
		const canvas = document.createElement( 'canvas' )
		canvas.width = size
		canvas.height = size
		const ctx = canvas.getContext( '2d' )

		const squareSize = size / divisions

		for ( let i = 0; i < divisions; i++ ) {
			for ( let j = 0; j < divisions; j++ ) {
				const isWhite = ( i + j ) % 2 === 0
				ctx.fillStyle = isWhite ? '#ffffff' : '#000000'
				ctx.fillRect( i * squareSize, j * squareSize, squareSize, squareSize )
			}
		}

		const texture = new CanvasTexture( canvas )
		texture.wrapS = texture.wrapT = 1000 // RepeatWrapping
		texture.repeat.set( 2, 2 )
		return texture
	}

	// Create a stripe pattern that works well with lines
	createStripeTexture( size = 64 ) {
		const canvas = document.createElement( 'canvas' )
		canvas.width = size
		canvas.height = size
		const ctx = canvas.getContext( '2d' )

		// Create horizontal stripes
		const stripeHeight = size / 8
		for ( let i = 0; i < 8; i++ ) {
			const isLight = i % 2 === 0
			ctx.fillStyle = isLight ? '#ffffff' : '#666666'
			ctx.fillRect( 0, i * stripeHeight, size, stripeHeight )
		}

		const texture = new CanvasTexture( canvas )
		texture.wrapS = texture.wrapT = 1000 // RepeatWrapping
		texture.repeat.set( 12, 1 ) // Many repeats along the line
		return texture
	}

	// Create an alpha pattern for better alpha mapping
	createAlphaTexture( size = 32 ) {
		const canvas = document.createElement( 'canvas' )
		canvas.width = size
		canvas.height = size
		const ctx = canvas.getContext( '2d' )

		// Fill with gradient from transparent to opaque
		const gradient = ctx.createLinearGradient( 0, 0, size, 0 )
		gradient.addColorStop( 0, '#000000' )    // Transparent areas
		gradient.addColorStop( 0.3, '#000000' )  // Transparent areas
		gradient.addColorStop( 0.7, '#ffffff' )  // Opaque areas
		gradient.addColorStop( 1, '#ffffff' )    // Opaque areas

		ctx.fillStyle = gradient
		ctx.fillRect( 0, 0, size, size )

		const texture = new CanvasTexture( canvas )
		texture.wrapS = texture.wrapT = 1000 // RepeatWrapping
		texture.repeat.set( 6, 1 ) // Repeat pattern along the line
		return texture
	}
}

export default new BasicExample()
