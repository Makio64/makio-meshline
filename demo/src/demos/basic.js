import { animate, utils } from 'animejs'
import { circlePositions, MeshLine } from 'makio-meshline'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { Fn, step, uniform, uv } from 'three/tsl'
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const GRID_SIZE = 4
const SPACING = 4.5
const BASE_POSITIONS = circlePositions( 64 )

const LINE_CONFIGS = [
	{ title: 'Basic', color: 0xCE4257, closed: true, lineWidth: 0.2 },
	{ title: 'Thick Line', color: 0xCBDFBD, closed: true, lineWidth: 0.5 },
	{ title: 'Open End', color: 0xFCD581, closed: false, lineWidth: 0.3 },
	{ title: 'Wireframe', color: 0x0A99FF, closed: true, lineWidth: 0.3, wireframe: true },
	{ title: 'Dashed 4', color: 0xC0F254, closed: true, lineWidth: 0.3, dash: { count: 4, ratio: 0.5 } },
	{ title: 'Dashed 8', color: 0xF35B04, closed: true, lineWidth: 0.3, dash: { count: 8, ratio: 0.6 } },
	{ title: 'Dashed 16', color: 0x7678ED, closed: true, lineWidth: 0.3, dash: { count: 16, ratio: 0.3 } },
	{ title: 'Long Dashes', color: 0x00FF80, closed: true, lineWidth: 0.5, dash: { count: 6, ratio: 0.8 } },
	{ title: 'Map Texture', color: 0xFF0080, closed: true, lineWidth: 0.3, map: 'stripes' },
	{ title: 'Dash + Gradient', color: 0x00FF00, closed: true, lineWidth: 0.4, dash: { count: 10, ratio: 0.7 }, gradientColor: 0xFF0000 },
	{ title: 'Gradient Only', color: 0xFF00FF, closed: true, lineWidth: 0.1, gradientColor: 0x00FFFF },
	{ title: 'Gradient', color: 0xFFFF00, closed: true, lineWidth: 0.3, gradientColor: 0x0000FF },
	{ title: 'Opacity', color: 0x8080FF, closed: true, lineWidth: 0.5, opacity: 0.6, background: true },
	{ title: 'Alpha Map', color: 0xFF00FF, closed: true, lineWidth: 0.3, alphaMap: 'alpha', background: true },
	{ title: 'Size Attenuation', color: 0x80FF80, closed: true, lineWidth: 0.5, sizeAttenuation: true },
	{ title: 'All Features', color: 0xFFFFFF, closed: true, lineWidth: 0.5, dash: { count: 8, ratio: 0.5 }, gradientColor: 0xFF0000 }
]

class BasicExample {
	constructor() {
		this.lines = []
		this.labels = []
		this.backgroundPlanes = []
		this.textures = null
		this.cssRenderer = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 20 )
		stage3d.control.blockZoom = true
		this.createCssRenderer()
		this.createScene()
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createCssRenderer() {
		this.cssRenderer = new CSS2DRenderer()
		this.cssRenderer.domElement.style.position = 'absolute'
		this.cssRenderer.domElement.style.top = '0px'
		this.cssRenderer.domElement.style.pointerEvents = 'none'
		document.body.appendChild( this.cssRenderer.domElement )
		this.onResize()
	}

	createScene() {
		this.clearScene()
		this.textures = this.createTextures()

		LINE_CONFIGS.forEach( ( config, index ) => {
			const row = Math.floor( index / GRID_SIZE )
			const col = index % GRID_SIZE
			const x = ( col - GRID_SIZE / 2 + 0.5 ) * SPACING
			const y = -( row - GRID_SIZE / 2 + 0.5 ) * SPACING
			const z = 0
			const line = this.createLine( config )
			line.position.set( x, y, z )
			stage3d.add( line )
			this.lines.push( line )

			if ( config.background ) {
				const plane = new Mesh(
					new PlaneGeometry( 2.2, 2.2 ),
					new MeshBasicMaterial( { map: this.textures.checker } )
				)
				plane.position.set( x, y, z - 0.3 )
				plane.userData.isMeshlineDemoBg = true
				stage3d.add( plane )
				this.backgroundPlanes.push( plane )
			}

			const element = document.createElement( 'div' )
			element.className = 'line-label'
			element.textContent = config.title
			element.style.color = 'white'
			element.style.fontFamily = 'Arial, sans-serif'
			element.style.fontSize = '12px'
			element.style.backgroundColor = 'rgba(0,0,0,0.7)'
			element.style.padding = '2px 6px'
			element.style.borderRadius = '3px'
			element.style.textAlign = 'center'
			element.style.minWidth = '60px'

			const label = new CSS2DObject( element )
			label.position.set( x, y - 1.2, z )
			stage3d.add( label )
			this.labels.push( label )
		} )
	}

	createTextures() {
		const createTexture = ( width, height, repeatX, repeatY, draw ) => {
			const canvas = document.createElement( 'canvas' )
			canvas.width = width
			canvas.height = height
			const ctx = canvas.getContext( '2d' )

			if ( ctx ) {
				draw( ctx, width, height )
			}

			const texture = new CanvasTexture( canvas )
			texture.wrapS = RepeatWrapping
			texture.wrapT = RepeatWrapping
			texture.repeat.set( repeatX, repeatY )
			return texture
		}

		return {
			checker: createTexture( 64, 64, 2, 2, ( ctx, width ) => {
				const squareSize = width / 8
				for ( let x = 0; x < 8; x++ ) {
					for ( let y = 0; y < 8; y++ ) {
						ctx.fillStyle = ( x + y ) % 2 === 0 ? '#ffffff' : '#000000'
						ctx.fillRect( x * squareSize, y * squareSize, squareSize, squareSize )
					}
				}
			} ),
			stripes: createTexture( 64, 64, 12, 1, ( ctx, width, height ) => {
				const stripeHeight = height / 8
				for ( let i = 0; i < 8; i++ ) {
					ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#666666'
					ctx.fillRect( 0, i * stripeHeight, width, stripeHeight )
				}
			} ),
			alpha: createTexture( 32, 32, 6, 1, ( ctx, width, height ) => {
				const gradient = ctx.createLinearGradient( 0, 0, width, 0 )
				gradient.addColorStop( 0, '#000000' )
				gradient.addColorStop( 0.3, '#000000' )
				gradient.addColorStop( 0.7, '#ffffff' )
				gradient.addColorStop( 1, '#ffffff' )
				ctx.fillStyle = gradient
				ctx.fillRect( 0, 0, width, height )
			} )
		}
	}

	createLine( config ) {
		const line = new MeshLine()
			.lines( BASE_POSITIONS, config.closed )
			.color( config.color )
			.lineWidth( config.lineWidth )
			.wireframe( config.wireframe ?? false )

		line.percent1 = uniform( 0 )
		line.percent2 = uniform( 1 )
		line.discardFn( Fn( () => {
			return step( uv().x, line.percent1 ).mul( step( uv().x.oneMinus(), line.percent2 ) ).lessThan( 0.00001 )
		} ) )

		if ( config.dash ) line.dash( config.dash )
		if ( config.gradientColor ) line.gradientColor( config.gradientColor )
		if ( config.map ) line.map( this.textures[config.map] )
		if ( config.opacity !== undefined ) line.opacity( config.opacity )
		if ( config.alphaMap ) line.alphaMap( this.textures[config.alphaMap] )
		if ( 'sizeAttenuation' in config ) line.sizeAttenuation( config.sizeAttenuation )

		return line
	}

	clearScene() {
		this.lines.forEach( line => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.labels.forEach( label => {
			stage3d.remove( label )
		} )
		this.backgroundPlanes.forEach( plane => {
			this.disposeBackgroundPlane( plane )
		} )
		this.purgeBackgroundPlanes()

		this.lines = []
		this.labels = []
		this.backgroundPlanes = []
		this.disposeTextures()
	}

	purgeBackgroundPlanes() {
		const children = [...stage3d.scene.children]

		children.forEach( child => {
			if ( child?.userData?.isMeshlineDemoBg ) {
				this.disposeBackgroundPlane( child )
			}
		} )
	}

	disposeBackgroundPlane( plane ) {
		if ( !plane ) {
			return
		}

		stage3d.remove( plane )
		plane.geometry?.dispose?.()
		plane.material?.dispose?.()
	}

	disposeTextures() {
		if ( !this.textures ) {
			return
		}

		Object.values( this.textures ).forEach( texture => texture.dispose() )
		this.textures = null
	}

	update = () => {
		this.cssRenderer?.render( stage3d.scene, stage3d.camera )
	}

	onResize = () => {
		this.cssRenderer?.setSize( window.innerWidth, window.innerHeight )
		this.lines.forEach( line => line.resize() )
	}

	show() {
		this.lines.forEach( ( line, index ) => {
			const onComplete = index === this.lines.length - 1 ? () => this.show() : undefined
			line.percent1.value = -0.01
			line.percent2.value = 1.01
			animate( line.percent1, { duration: 1, value: 1.01, delay: index * 0.05, ease: 'easeOut' } )
			animate( line.percent2, {
				duration: 1,
				value: -0.01,
				delay: 3 + index * 0.05,
				ease: 'easeOut',
				onComplete
			} )
		} )
	}

	hide( cb ) {
		this.backgroundPlanes.forEach( plane => {
			plane.visible = false
		} )
		this.labels.forEach( label => {
			label.visible = false
		} )

		this.lines.forEach( ( line, index, lines ) => {
			utils.remove( line )
			animate( line.percent2, {
				duration: 0.2,
				value: 0,
				delay: index * 0.02,
				ease: 'easeOut',
				onComplete: index === lines.length - 1 ? cb : undefined
			} )
		} )
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		this.clearScene()

		if ( this.cssRenderer?.domElement.parentNode ) {
			this.cssRenderer.domElement.parentNode.removeChild( this.cssRenderer.domElement )
		}
		this.cssRenderer = null
		stage3d.control?.dispose()
	}
}

export default new BasicExample()
