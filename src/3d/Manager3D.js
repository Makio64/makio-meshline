import { animate } from 'animejs'

import { Mesh, BoxGeometry, MeshBasicNodeMaterial, AmbientLight, DirectionalLight, EquirectangularReflectionMapping, PMREMGenerator } from 'three/webgpu'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import Assets from '@/makio/three/Assets'
import { stage } from '@/makio/core/stage'
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader'
import { color, Fn, uv } from 'three/tsl'
import { gradient } from '@/makio/tsl/gradient'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment'
import Line from './Line'
class Manager3D {
	constructor() {
		this.isInit = false
	}

	async init() {
		if( !this.isInit ) {
			this.isInit = true
			await stage3d.initRender()
			stage3d.control = new OrbitControl( stage3d.camera, 5 )
			this.addLight()
			// await this.loadHDR()
			await this.initHDR()
			await this.loadAssets()
		}

		this.initScene()
	}

	initScene() {
		this.line = new Line()
		stage3d.add( this.line )
		this.box = new Mesh( new BoxGeometry( 1, 1, 1 ), new MeshBasicNodeMaterial( { wireframe: false, transparent: true, opacity: 0, color: 0xff0000 } ) )
		this.box.material.colorNode = gradient( [color( 0xff0000 ), color( 0x00ff00 ), color( 0x0000ff ), color( 0x000000 )], [0.5, 0.51, 0.6, 1], uv().y )
		stage3d.add( this.box )
		stage.onUpdate.add( this.update )
	}

	addLight() {
		const ambient = new AmbientLight( 0xffffff, 1 ) // Soft white light
		const sun = new DirectionalLight( 0xffffff, 2 )
		sun.position.set( 5, 3, 5 ) // Position the sun
		stage3d.add( ambient )
		stage3d.add( sun )
	}

	async initHDR() {
		const env = new RoomEnvironment()
		const pmrem = new PMREMGenerator( stage3d.renderer )
		pmrem.compileCubemapShader()
		const envMap = await pmrem.fromScene( env ).texture
		stage3d.scene.environment = envMap
	}

	async loadHDR() {
		let loader = this.loaderHDR = this.loaderHDR || new UltraHDRLoader()
		// loader.setDataType( THREE[ type ] );
		let texture = await loader.loadAsync( '/hdr/royal_esplanade_256x128.jpg' )
		texture.mapping = EquirectangularReflectionMapping
		texture.needsUpdate = true
		// stage3d.scene.background = texture
		stage3d.scene.environment = texture
		stage3d.render()
	}

	async loadAssets() {
		return new Promise( ( resolve ) => {
			resolve()
			Assets.onLoadComplete.addOnce( resolve )
		} )
	}


	update = ( dt ) => {
		this.box.rotateX( 0.01 )
	}

	show() {
		this.line.show()
		animate( this.box.material, { duration: 1, opacity: 1 } )
		animate( this.box.position, { duration: 1, y: [-3, 0], ease: 'outQuad' } )
	}

	hide( cb ) {
		animate( this.box.material, { duration: 1, opacity: 0 } )
		animate( this.box.position, { duration: 1, y: 3, ease: 'inQuad', onComplete: () => {	this.dispose(); cb()} } )
	}

	dispose() {
		stage3d.remove( this.box )
		stage.onUpdate.remove( this.update )
	}
}

export default new Manager3D()
