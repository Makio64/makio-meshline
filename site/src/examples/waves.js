import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import { MeshLine } from 'meshline'

const numLines = 29 // Number of lines along Z axis
const lineLength = 21

class WavesExample {
	constructor() {
		this.line = null
		this.time = 0
		this.waveLines = []
	}

	async init() {
		console.log( 'waves init' )
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 25 )
		stage3d.camera.far = 1000
		stage3d.camera.updateProjectionMatrix()
		this.initScene()
	}

	initScene() {
		// Clear existing line
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		this.waveLines = this.createWaveLines()

		// Create a single Line object using setLines for all waves
		const config = {
			lineWidth: 0.5,
			isClose: false,
			percent: 1,
			percent2: 1,
			gradientColor: 0xff0000
		}

		this.line = new MeshLine( this.waveLines, config )
		stage3d.add( this.line )

		stage.onUpdate.add( this.update )
	}

	createWaveLines() {
		const lines = []
		for ( let z = 0; z < numLines; z++ ) {
			const points = []

			for ( let i = 0; i < lineLength * 4; i++ ) {

				points.push( [i / 4 - lineLength / 2, z - numLines / 2, 0] )
			}

			lines.push( points )
		}
		return lines
	}

	update = ( dt ) => {
		this.time += dt * 0.001 // Control animation speed
	}

	dispose() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}
		stage.onUpdate.remove( this.update )
		this.waveLines = null
	}

	show() {}
	hide( cb ) { if( cb )cb() }
}

export default new WavesExample()
