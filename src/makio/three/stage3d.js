import { Scene, PerspectiveCamera, WebGPURenderer, TimestampQuery } from 'three/webgpu'
import WebGPU from 'three/addons/capabilities/WebGPU'
import stage from '../core/stage'
import { PlaneGeometry } from 'three'
import Stats from 'stats-gl'

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
				logarithmicDepthBuffer: false,
				alpha: false,
			} )
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
		if( this.control && this.control.enabled ) {
			this.control?.update( dt )
		}
		this.render()
	}

	render = async () => {
		if ( this.composer ) {
			this.composer.render()
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

	initPostFX() {
		this.postFX = new PostProcess( this.renderer )
		this.composer = this.postFX.composer
		this.postFX.init( this.scene, this.camera )
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

	//---------------------------------------------------------- COMPILE
	async gpuUpload( objects ) {
		const compileScene = this.compileScene ||= new Scene()
		const compileCamera = this.compileCamera ||= new PerspectiveCamera( 60, stage.width / stage.height, 0.0001, 10000 )
		compileCamera.position.set( 0, 0, 10000 )
		compileCamera.lookAt( 0, 0, 0 )
		const compileGeometry = this.compileGeometry ||= new PlaneGeometry( 1, 1 )
		compileScene.environment = this.scene.environment

		const states = new Map()

		for ( const obj of objects ) {
			if ( !obj || obj.isLight || obj.isCamera ) continue
			if ( obj.isTexture ) {
				// console.log('[compile] add texture', obj)
				obj.needsUpdate = true
				this.renderer.initTexture( obj )
			}
			else if ( obj.isMaterial ) {
				// console.log('[compile] add material', obj)
				const mesh = new Mesh( compileGeometry, obj )
				compileScene.add( mesh )
				for ( const map of ['map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap'] ) {
					if ( obj[map] ) this.renderer.initTexture( obj[map] )
				}
			}
			else if ( obj.isObject3D ) {
				// console.log('[compile] add object', obj)

				states.set( obj, { parent: obj.parent, frustumCulled: obj.frustumCulled } )
				obj.frustumCulled = false
				compileScene.add( obj )
			}
		}

		await this.renderer.compileAsync( compileScene, compileCamera, this.scene )

		for ( const [obj, { parent, frustumCulled }] of states ) {
			if ( parent ) parent.add( obj )
			obj.frustumCulled = frustumCulled
		}

		compileGeometry.dispose()
	}

}

export default new Stage3D()
