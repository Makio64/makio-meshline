import { circlePositions, MeshLine } from 'makio-meshline'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { createDemoHint } from '@/utils/demoHint'

const POINTS = circlePositions( 64, 3 )

class BasicExample {
	constructor() {
		this.line = null
		this.control = null
		this.hint = null
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
		this.hint = createDemoHint( '64-segment closed loop · gradient stroke · drag to orbit', { accent: '#ff8800', hideAfter: 9000 } )
		window.addEventListener( 'resize', this.onWindowResize )
	}

	onWindowResize = () => {
		this.line?.resize()
	}

	dispose() {
		window.removeEventListener( 'resize', this.onWindowResize )
		this.hint?.remove()
		this.hint = null
		stage3d.remove( this.line )
		this.line?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.line = null
		this.control = null
	}
}

export default BasicExample
