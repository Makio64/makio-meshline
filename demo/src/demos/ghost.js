import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { MeshLine, circlePositions } from 'meshline'

class GhostExample {
	constructor() {
		this.line = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 6 )
		stage3d.control.maxRadius = 12
		stage3d.control.minRadius = 2
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		const positions = circlePositions( 96, 4 )

		this.line = new MeshLine()
			.lines( positions, true )
			.color( 0xffffff )
			.gradientColor( 0x66ccff )
			.lineWidth( 0.2 )
			.transparent( true )
			.opacity( 0.8 )

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
		stage3d.control?.dispose()
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new GhostExample()
