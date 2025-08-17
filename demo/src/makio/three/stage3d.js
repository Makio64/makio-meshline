import { Scene, PerspectiveCamera, WebGPURenderer, TimestampQuery } from 'three/webgpu'
import WebGPU from 'three/addons/capabilities/WebGPU'
import stage from '../core/stage'
import Stats from 'stats-gl'
import { ACESFilmicToneMapping } from 'three'

const showStats = window.location.search.includes( 'debug' )

class Stage3D {
	constructor() {
		this.scene = new Scene()
		this.camera = new PerspectiveCamera( 55, stage.width / stage.height, 1, 100 )
		this.camera.position.set( 0, 0, 10 )
		this.camera.lookAt( 0, 0, 0 )
		this.isWebGPU = WebGPU.isAvailable()
	}

	async initRender( options = {} ) {
		this.opt = false
		if ( !this.renderer ) {

			this.renderer = new WebGPURenderer( {
				antialias: true,
				reverseDepth: true,
				alpha: false,
			} )
			this.renderer.toneMapping = ACESFilmicToneMapping

			this.renderer.setPixelRatio( stage.devicePixelRatio )
			this.renderer.setSize( stage.width, stage.height )
			this.renderer.setClearColor( options.background || 0x000000, options.clearAlpha || 1 )
			this.renderer.domElement.classList.add( 'three' )

			console.log( `BackEnd ${this.isWebGPU ? 'WebGPU' : 'WebGL2'}` )

			await this.renderer.init()
			document.body.appendChild( this.renderer.domElement )

			if ( showStats ) {
				this.stats = new Stats( {
					trackGPU: true,
				} )
				document.body.appendChild( this.stats.dom )
				this.stats.init( this.renderer )
			}

		}

		this.forceRatio = options.forceRatio ?? 1
		this.isPaused = false

		stage.onResize.add( this.resize )
		stage.onRender.add( this.update )

		this.resize()
	}

	//---------------------------------------------------------- RENDER
	update = ( dt ) => {
		if ( this.isPaused || !this.renderer ) {
			return
		}
		if ( this.control && this.control.enabled ) {
			this.control?.update( dt )
		}
		this.render()
	}

	render = async () => {
		if ( this.postProcessing ) {
			this.postProcessing.render()
		} else {
			if ( this.stats ) {
				await this.renderer.renderAsync( this.scene, this.camera ) // await necessary else negative value output
				this.renderer.resolveTimestampsAsync( TimestampQuery.RENDER )
				this.stats.update()
			} else {
				this.renderer.renderAsync( this.scene, this.camera )
			}
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
		if ( this.isPaused ) return
		this.isPaused = true
		this.control && ( this.control.isActive = false )
	}

	resume = () => {
		if ( !this.isPaused ) return
		this.isPaused = false
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
		this.removeAll()
		this.control?.disable()
		stage.onResize.remove( this.resize )
		stage.onUpdate.remove( this.render )
		this.renderer?.clear()
		this.renderer?.dispose()
	}

}

export default new Stage3D()
