import { MeshLine } from 'makio-meshline'
import { DirectionalLight, HemisphereLight } from 'three/webgpu'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const CENTERLINE = new Float32Array( [
	-4,
	0,
	-1,
	-2,
	0.2,
	0.5,
	0,
	0,
	1,
	2,
	-0.1,
	0.5,
	4,
	0,
	-1,
] )

class SurfaceExample {
	constructor() {
		this.line = null
		this.control = null
		this.lights = []
	}

	async init() {
		await stage3d.initRender( { background: 0x101318 } )

		stage3d.camera.position.set( 0, 6, 10 )
		stage3d.camera.lookAt( 0, 0, 0 )
		this.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control = this.control

		this.line = new MeshLine()
			.lines( CENTERLINE )
			.lineWidth( 0.8 )
			.color( 0xff8844 )
			.surface( {
				frame: 'fixed-up',
				up: [0, 1, 0],
				roughness: 0.85,
				metalness: 0,
			} )
			.join( { type: 'round', limit: 3, segments: 8 } )
			.cap( { type: 'round', segments: 8 } )
			.build()

		this.lights = [
			new HemisphereLight( 0xbfdcff, 0x202028, 2 ),
			new DirectionalLight( 0xffffff, 3 ),
		]
		this.lights[1].position.set( 4, 8, 6 )

		stage3d.add( this.line )
		this.lights.forEach( light => stage3d.add( light ) )
	}

	dispose() {
		stage3d.remove( this.line )
		this.line?.dispose()
		this.lights.forEach( light => stage3d.remove( light ) )
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.line = null
		this.control = null
		this.lights = []
	}
}

export default SurfaceExample
