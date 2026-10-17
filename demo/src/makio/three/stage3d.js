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
		this.maxPixelRatio = options.maxPixelRatio ?? Infinity
		if ( !this.renderer ) {
			this.renderer = new WebGPURenderer( {
				antialias: true,
				reverseDepth: true,
				alpha: false,
				// `?webgl` exercises every demo's WebGL2 fallback on a WebGPU browser.
				forceWebGL: new URLSearchParams( window.location.search ).has( 'webgl' ),
				// `?timing` records GPU pass durations into `renderer.info.*.timestamp`.
				trackTimestamp: new URLSearchParams( window.location.search ).has( 'timing' ),
			} )

			this.renderer.setPixelRatio( Math.min( stage.devicePixelRatio, this.maxPixelRatio ) )
			this.renderer.setSize( stage.width, stage.height )
			this.renderer.domElement.classList.add( 'three' )

			if ( import.meta.env.DEV && new URLSearchParams( window.location.search ).has( 'inspector' ) ) {
				const { Inspector } = await import( 'three/addons/inspector/Inspector.js' )
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
		// A collapsed or hidden host (a 0×0 iframe, a closed panel) has no
		// swapchain to draw into; rendering would only raise validation errors.
		if ( !this.renderer || stage.width === 0 || stage.height === 0 ) {
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
		// Timestamp pools only hold a couple of thousand queries, so drain them
		// every frame; each resolve reports the latest frame's GPU time.
		if ( this.renderer.backend?.trackTimestamp ) {
			this.renderer.resolveTimestampsAsync( 'render' )
			this.renderer.resolveTimestampsAsync( 'compute' )
		}
	}

	//---------------------------------------------------------- ADD / REMOVE OBJECT3D
	add = ( ...objects ) => { this.scene.add( ...objects ) }
	remove = ( ...objects ) => { this.scene.remove( ...objects ) }

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
		if ( w === 0 || h === 0 ) return
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

		this.renderer?.setPixelRatio( Math.min( stage.devicePixelRatio, this.maxPixelRatio ?? Infinity ) )
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
