import { Inspector } from 'three/addons/inspector/Inspector.js'
import { NoToneMapping, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'

import stage from '../core/stage'

class Stage3D {
	constructor() {
		this.scene = new Scene()
		this.camera = new PerspectiveCamera( 55, stage.width / stage.height, 1, 100 )
		this.camera.position.set( 0, 0, 10 )
		this.camera.lookAt( 0, 0, 0 )
		this.isWebGPU = false
		this.backend = 'uninitialized'
		this.isResizeSubscribed = false
	}

	async initRender( options = {} ) {
		if ( !this.renderer ) {
			this.renderer = new WebGPURenderer( {
				antialias: true,
				reverseDepth: true,
				alpha: false,
			} )

			this.renderer.setPixelRatio( stage.devicePixelRatio )
			this.renderer.setSize( stage.width, stage.height )
			this.renderer.domElement.classList.add( 'three' )

			if ( import.meta.env.DEV ) {
				this.renderer.inspector = new Inspector()
				const style = document.createElement( 'style' )
				style.textContent = `#profiler-toggle:not(.position-right.panel-open) { right: 56px; }`
				document.head.appendChild( style )
			}

			await this.renderer.init()
			this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true
			this.backend = this.isWebGPU ? 'webgpu' : 'webgl2'
			console.info( `[meshline demo] ${this.backend.toUpperCase()} backend` )
			document.body.appendChild( this.renderer.domElement )

			if ( this.renderer.inspector?.domElement ) {
				document.body.appendChild( this.renderer.inspector.domElement )
			}

			this.renderer.setAnimationLoop( this.update )

		}

		this.resetForDemo( options )
		this.forceRatio = options.forceRatio ?? 1

		if ( !this.isResizeSubscribed ) {
			stage.onResize.add( this.resize )
			this.isResizeSubscribed = true
		}

		this.resize()
	}

	resetForDemo( options = {} ) {
		const background = options.background ?? 0x000000
		const clearAlpha = options.clearAlpha ?? 1

		this.renderer.setClearColor( background, clearAlpha )
		this.renderer.toneMapping = NoToneMapping
		this.renderer.shadowMap.enabled = false
		this.renderer.shadowMap.transmitted = false

		this.scene.background = null
		this.scene.backgroundNode = null
		this.scene.environment = null
		this.scene.environmentIntensity = 1
		this.scene.fog = null

		this.camera.fov = 55
		this.camera.near = 1
		this.camera.far = 100
		this.camera.zoom = 1
		this.camera.up.set( 0, 1, 0 )
		this.camera.position.set( 0, 0, 10 )
		this.camera.lookAt( 0, 0, 0 )
		this.camera.updateProjectionMatrix()

		this.control = null
		this.renderPipeline = null
		this.postFX = null
	}

	//---------------------------------------------------------- RENDER
	update = ( dt ) => {
		if ( !this.renderer ) {
			return
		}
		if ( this.control && this.control.enabled ) {
			this.control?.update( dt )
		}
		this.render()
	}

	render = () => {
		if ( this.renderPipeline ) {
			this.renderPipeline.render()
		} else {
			this.renderer.render( this.scene, this.camera )
		}
	}

	//---------------------------------------------------------- ADD / REMOVE OBJECT3D
	add = ( obj ) => { this.scene.add( obj ) }
	remove = ( obj ) => { this.scene.remove( obj ) }

	removeAll = () => {
		while ( this.scene.children.length > 0 ) {
			this.scene.remove( this.scene.children[0] )
		}
	}

	//---------------------------------------------------------- PAUSE / RESUME
	pause = () => {
		this.renderer?.setAnimationLoop( null )
		this.control && ( this.control.isActive = false )
	}

	resume = () => {
		this.renderer?.setAnimationLoop( this.update )
		this.control && ( this.control.isActive = true )
	}

	//---------------------------------------------------------- RESIZE
	resize = () => {
		let w = stage.width
		let h = stage.height
		let aspect = w / h

		if ( this.camera.isOrthographicCamera ) {
			this.camera.left = ( -this.frustumSize * aspect ) / 2
			this.camera.right = ( this.frustumSize * aspect ) / 2
			this.camera.top = this.frustumSize / 2
			this.camera.bottom = -this.frustumSize / 2
		} else {
			this.camera.aspect = aspect
		}

		this.camera.updateProjectionMatrix()

		this.renderer?.setSize( w, h )
		this.postFX?.resize( w, h )

		this.render()
	}

	//---------------------------------------------------------- GETTERS / SETTERS
	set fov( value ) {
		this.camera.fov = value
		this.camera.updateProjectionMatrix()
	}
	get fov() { return this.camera.fov }

	//---------------------------------------------------------- DISPOSE
	dispose() {
		this.renderer?.setAnimationLoop( null )
		this.removeAll()
		this.control?.disable()
		if ( this.isResizeSubscribed ) {
			stage.onResize.remove( this.resize )
			this.isResizeSubscribed = false
		}
		this.renderer?.clear()
		this.renderer?.dispose()
		this.renderer?.domElement.remove()
		this.renderer = null
		this.control = null
		this.renderPipeline = null
		this.postFX = null
	}

}

export default new Stage3D()
