import stage3d from '@/makio/three/stage3d'
import Ticker from '@/makio/utils/time/Ticker'
import Signal from '@/makio/core/Signal'
import { PlaneGeometry, MeshBasicMaterial, Mesh, Scene } from 'three'

const DELAY_BETWEEN_BIND = 32

class GPUBinder {
	constructor() {
		this.meshs = []
		this.scene = new Scene()
		this.onComplete = new Signal()
		this.planeGeometry = new PlaneGeometry()
		this.ticker = new Ticker( DELAY_BETWEEN_BIND, this.onTick )
	}

	addTexture( t ) {
		const mesh = new Mesh( this.planeGeometry, new MeshBasicMaterial( { map: t } ) )
		this.meshs.push( mesh )
	}

	addGeometry( g ) {
		this.meshs.push( new Mesh( g ) )
	}

	addMesh( mesh ) {
		this.meshs.push( mesh )
	}

	addMaterial( material ) {
		this.meshs.push( new Mesh( this.planeGeometry, material ) )
	}

	onTick = () => {
		let t = Date.now()
		let t2 = t
		while ( t - t2 <= 6 && this.meshs.length > 0 ) {
			this.bindNext()
			t = Date.now()
		}
	}

	bindNext = () => {
		if ( this.meshs.length == 0 ) {
			return
		}
		let mesh = this.meshs.pop()
		let tmp = stage3d.scene
		stage3d.scene = this.scene
		stage3d.add( mesh, 'binding' )
		stage3d.render()
		stage3d.remove( mesh, 'binding' )
		stage3d.scene = tmp
		if ( this.meshs.length == 0 ) {
			this.onComplete.dispatch()
		}
	}

	pushAllOnGPU() {
		for ( let mesh of this.meshs ) {
			let tmp = mesh.frustumCulled
			mesh.frustumCulled = false
			stage3d.add( mesh )
			mesh.frustumCulled = tmp
		}
		stage3d.render()
		for ( let mesh of this.meshs ) {
			stage3d.remove( mesh )
		}
	}

	clear() {
		this.meshs = []
	}

	get isBinding() {
		return this.meshs.length > 0
	}
}

export default new GPUBinder()
export { GPUBinder }
