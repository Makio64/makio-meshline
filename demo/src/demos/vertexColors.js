import { MeshLine } from 'makio-meshline'
import { Color } from 'three/webgpu'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const NUM_POINTS = 100

class VertexColorsExample {
	constructor() {
		this.lines = []
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 10 )

		this.createGradientLine()
		this.createRainbowLine()
		this.createRedLine()

		window.addEventListener( 'resize', this.onResize )
	}

	// Create one wave and move it vertically so the examples stay distinct.
	addLine( colors, yOffset ) {
		const positions = new Float32Array( NUM_POINTS * 3 )
		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const t = i / ( NUM_POINTS - 1 )
			const offset = i * 3
			positions[offset] = ( t - 0.5 ) * 15
			positions[offset + 1] = Math.sin( t * Math.PI * 3 ) + yOffset
			positions[offset + 2] = 0
		}

		const line = new MeshLine()
			.lines( positions )
			.vertexColors( colors )
			.lineWidth( 0.05 )

		stage3d.add( line )
		this.lines.push( line )
		return line
	}

	createGradientLine() {
		const colors = new Float32Array( NUM_POINTS * 3 )

		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const t = i / ( NUM_POINTS - 1 )
			const offset = i * 3
			colors[offset] = 1 - t
			colors[offset + 1] = 0
			colors[offset + 2] = t
		}

		this.addLine( colors, 2 )
	}

	createRainbowLine() {
		const colors = new Float32Array( NUM_POINTS * 3 )
		const color = new Color()

		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const hue = i / ( NUM_POINTS - 1 )
			color.setHSL( hue, 1, 0.5 ).toArray( colors, i * 3 )
		}

		this.addLine( colors, 0 ).dash( { count: 10 } )
	}

	createRedLine() {
		const colors = new Float32Array( NUM_POINTS * 3 )

		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const progress = i / ( NUM_POINTS - 1 )
			colors[i * 3] = progress
		}

		this.addLine( colors, -2 )
	}

	onResize = () => {
		this.lines.forEach( line => line.resize() )
	}

	dispose() {
		window.removeEventListener( 'resize', this.onResize )
		this.lines.forEach( line => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.lines = []
		stage3d.control?.dispose()
	}

}

export default VertexColorsExample
