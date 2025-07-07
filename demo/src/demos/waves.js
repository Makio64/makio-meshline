import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import { MeshLine } from 'meshline'

const numLines = 29 // Number of lines along Z axis
const lineLength = 21

class WavesExample {
	constructor() {
		this.lines = null
		this.time = 0
		this.waveLines = []
	}

	async init() {
		console.log( 'waves init' )
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 35 )
		stage3d.camera.far = 1000
		stage3d.camera.updateProjectionMatrix()
		this.initScene()
		window.addEventListener( 'resize', this.lines.resize )
	}

	initScene() {
		// Clear existing line
		if ( this.lines ) {
			stage3d.remove( this.lines )
			this.lines.dispose()
		}

		// Create a single Line object using setLines for all waves
		const options = {
			lines: this.createWaveLines(),
			lineWidth: 0.5,
			isClose: false,
			gradientColor: 0xff0000,
			verbose: true
		}

		this.lines = new MeshLine( options )
		stage3d.add( this.lines )

		stage.onUpdate.add( this.update )
	}

	createWaveLines() {
		// Total number of points per line and corresponding float count
		const pointsPerLine = lineLength * 4
		const floatsPerLine = pointsPerLine * 3 // 3 floats (x,y,z) per point

		const lines = new Array( numLines )

		// Pre-compute the X coordinates once since they are identical for every Z slice
		const xCoords = new Float32Array( pointsPerLine )
		for ( let i = 0; i < pointsPerLine; i++ ) {
			xCoords[i] = i / 4 - lineLength / 2
		}

		for ( let z = 0; z < numLines; z++ ) {
			const lineArray = new Float32Array( floatsPerLine )
			const baseZ = z - numLines / 2

			for ( let i = 0; i < pointsPerLine; i++ ) {
				const floatIndex = i * 3
				lineArray[floatIndex] = xCoords[i]          // x
				lineArray[floatIndex + 1] = baseZ           // y
				lineArray[floatIndex + 2] = 0               // z
			}
			lines[z] = lineArray
		}
		return lines
	}

	update = ( dt ) => {
		this.time += dt * 0.001 // Control animation speed
	}

	dispose() {
		if ( this.lines ) {
			stage3d.remove( this.lines )
			this.lines.dispose()
			this.lines = null
		}
		stage.onUpdate.remove( this.update )
		this.waveLines = null
		console.log( 'wave dispose' )
	}

	show() {}
	hide( cb ) { if ( cb )cb() }
}

export default new WavesExample()
