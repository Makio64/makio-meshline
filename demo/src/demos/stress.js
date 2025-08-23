import { MeshLine } from 'makio-meshline'
import { cos, Fn, sin, time, uniform, vec3 } from 'three/tsl'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const segments = 1000000 // 1 million points

class StressExample {
	constructor() {
		this.line = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 30 ) // Larger distance for bigger scene
		stage3d.camera.far = 10000 // Increase far plane for large geometry
		stage3d.camera.updateProjectionMatrix()
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		// Procedural position function for a animated 3D spiral
		const positionNode = Fn( ( [counter] ) => {
			const turns = uniform( 200 ) // Many turns for long line
			const height = uniform( 1000 ) // Tall spiral
			const radius = uniform( 5 )
			const angle = counter.mul( Math.PI * 2 ).mul( turns ).add( time.negate() )
			const x = cos( angle ).mul( radius )
			const y = sin( angle ).mul( radius )
			const z = counter.mul( height ).sub( height.div( 2 ) )
			return vec3( x, y, z )
		} )

		// Dummy positions array - length determines vertex count
		const positions = new Float32Array( segments * 3 )

		this.line = new MeshLine()
			.lines( positions, false )
			.gpuPositionNode( positionNode )
			.lineWidth( 0.2 )
			.gradientColor( 0x0000ff )
			.color( 0xffffff )
			.verbose( true )

		stage3d.add( this.line )
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		window.removeEventListener( 'resize', this.onResize )
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}
		stage3d.control.dispose()
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new StressExample() 