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
		stage3d.control.maxRadius = 45
		stage3d.control.minRadius = 25
		stage3d.camera.far = 1000
		stage3d.camera.updateProjectionMatrix()
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		// Clear existing line
		if ( this.lines ) {
			stage3d.remove( this.lines )
			this.lines.dispose()
		}

		this.lines = new MeshLine()
			.lines( this.createWaveLines(), false )
			.lineWidth( 0.5 )
			.gradientColor( 0xff0000 )
			.verbose( true )

		stage3d.add( this.lines )

		stage.onUpdate.add( this.update )
	}

	createWaveLines( times = 0 ) {
		// Total number of points per line and corresponding float count
		const pointsPerLine = lineLength * 4
		const floatsPerLine = pointsPerLine * 3 // 3 floats (x,y,z) per point

		this.linesPositions = new Array( numLines )

		for ( let z = 0; z < numLines; z++ ) {
			// we avoid creating new array each time the function is called
			let lineArray = this.linesPositions[z]
			if ( !lineArray ) {
				lineArray = new Float32Array( floatsPerLine )
				this.linesPositions[z] = lineArray
			}

			const baseZ = z - numLines / 2

			for ( let i = 0; i < pointsPerLine; i++ ) {
				const floatIndex = i * 3
				lineArray[floatIndex] = i / 4 - lineLength / 2         // x
				lineArray[floatIndex + 1] = baseZ + Math.sin( i / 8 + times ) * 0.25           // y
				lineArray[floatIndex + 2] = 0               // z
			}
		}
		return this.linesPositions
	}

	update = ( dt ) => {
		this.time += dt * 0.001 // Control animation speed
		
		// Update all line positions with new wave animation
		const animatedLines = this.createWaveLines( this.time )
		
		// Use setPositions to update all lines efficiently
		this.lines.setPositions( animatedLines )
	}

	onResize = () => {
		if ( this.lines ) {
			this.lines.resize()
		}
	}

	dispose() {
		if ( this.lines ) {
			stage3d.remove( this.lines )
			this.lines.dispose()
			this.lines = null
		}
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		this.waveLines = null
		this.basePositions = null
		stage3d.control.dispose()
		console.log( 'wave dispose' )
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new WavesExample()