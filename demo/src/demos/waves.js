import { MeshLine } from 'makio-meshline'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const LINE_COUNT = 29
const LINE_LENGTH = 21
const POINTS_PER_LINE = LINE_LENGTH * 4
const FLOATS_PER_LINE = POINTS_PER_LINE * 3

class WavesExample {
	constructor() {
		this.lines = null
		this.linePositions = null
		this.time = 0
	}

	async init() {
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

		stage3d.add( this.lines )

		stage.onUpdate.add( this.update )
	}

	createWaveLines( time = 0 ) {
		if ( !this.linePositions ) {
			this.linePositions = Array.from(
				{ length: LINE_COUNT },
				() => new Float32Array( FLOATS_PER_LINE )
			)
		}

		for ( let lineIndex = 0; lineIndex < LINE_COUNT; lineIndex++ ) {
			const positions = this.linePositions[lineIndex]
			const baseY = lineIndex - ( LINE_COUNT - 1 ) / 2

			for ( let pointIndex = 0; pointIndex < POINTS_PER_LINE; pointIndex++ ) {
				const offset = pointIndex * 3
				const progress = pointIndex / ( POINTS_PER_LINE - 1 )
				positions[offset] = ( progress - 0.5 ) * LINE_LENGTH
				positions[offset + 1] = baseY + Math.sin( pointIndex / 8 + time ) * 0.25
				positions[offset + 2] = 0
			}
		}

		return this.linePositions
	}

	update = ( dt ) => {
		this.time += dt * 0.001

		const animatedLines = this.createWaveLines( this.time )
		this.lines.setPositions( animatedLines )
	}

	onResize = () => {
		if ( this.lines ) {
			this.lines.resize()
		}
	}

	dispose() {
		stage3d.remove( this.lines )
		this.lines.dispose()
		this.linePositions = null
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		stage3d.control.dispose()
	}

}

export default WavesExample
