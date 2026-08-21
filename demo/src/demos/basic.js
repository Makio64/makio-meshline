import { circlePositions, MeshLine } from 'makio-meshline'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const POINTS = circlePositions( 64, 3 )

class BasicExample {
	constructor() {
		this.line = null
		this.control = null
	}

	async init() {
		await stage3d.initRender()

		this.control = new OrbitControl( stage3d.camera, 10 )
		stage3d.control = this.control

		this.line = new MeshLine()
			.lines( POINTS, true )
			.lineWidth( 0.2 )
			.color( 0xff8800 )
			.gradientColor( 0xffffff )

		stage3d.add( this.line )
		window.addEventListener( 'resize', this.onWindowResize )
	}

	onWindowResize = () => {
		this.line?.resize()
	}

	dispose() {
		window.removeEventListener( 'resize', this.onWindowResize )
		stage3d.remove( this.line )
		this.line?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.line = null
		this.control = null
	}
}

export default BasicExample
