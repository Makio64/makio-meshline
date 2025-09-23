import { MeshLine } from 'makio-meshline'

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

	// Add colored line helper
	addLine( colors, yOffset ) {
		const positions = new Float32Array( NUM_POINTS * 3 )
		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const t = i / ( NUM_POINTS - 1 )
			positions[i * 3] =  ( t - 0.5 ) * 15
			positions[i * 3 + 1] = Math.sin( t * Math.PI * 3 )
			positions[i * 3 + 2] = yOffset
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
			colors[i * 3] = 1 - t      // Red
			colors[i * 3 + 1] = 0      // Green
			colors[i * 3 + 2] = t      // Blue
		}

		this.addLine( colors, 2 )
	}

	createRainbowLine() {
		const colors = new Float32Array( NUM_POINTS * 3 )

		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const hue = ( i / NUM_POINTS ) * 6
			colors[i * 3] = Math.sin( hue ) * 0.5 + 0.5
			colors[i * 3 + 1] = Math.sin( hue + 2 ) * 0.5 + 0.5
			colors[i * 3 + 2] = Math.sin( hue + 4 ) * 0.5 + 0.5
		}

		this.addLine( colors, 0 ).dash( { count: 10 } )
	}

	createRedLine() {
		const colors = new Float32Array( NUM_POINTS * 3 )

		for ( let i = 0; i < NUM_POINTS; i++ ) {
			let p =  i / NUM_POINTS
			colors[i * 3] = p
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

	show() {}

	hide( cb ) {
		if ( cb ) cb()
	}
}

export default new VertexColorsExample()