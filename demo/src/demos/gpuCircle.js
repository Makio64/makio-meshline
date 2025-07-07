import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { MeshLine } from 'meshline'
import { Fn, vec3, cos, sin, float, uniform, time, mix } from 'three/tsl'

const segments = 128

// TSL function generating a circle in the XZ plane from the per-vertex counter (0-1)
const circlePosition = Fn( ( [counter] ) => {
	const angle = counter.add( time.negate() ).mul( Math.PI )
	return vec3( cos( angle ), sin( angle ), 0  )
} )

// TSL function generating a wavy line in the XZ plane from the per-vertex counter (0-1)
const wavePosition = Fn( ( [counter] ) => {
	// make a wavy line
	const y = sin( counter.mul( Math.PI * 4  ).add( time ) )
	return vec3( counter.mul( 4 ).sub( 2 ), y, 0 )
} )

class GpuCircleExample {
	constructor() {
		this.line = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 4 )
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		// Dummy positions – only length matters so counters attribute is generated
		const positions = new Float32Array( ( segments * 3 ) )

		const useWave = uniform( 0 )
		const positionNode = Fn( ( [counter] ) => {
			return mix( circlePosition( counter ), wavePosition( counter ), useWave )
		} )
		
		this.line = new MeshLine( {
			lines: positions,
			isClose: false,
			gpuPositionNode: positionNode,
			lineWidth: 0.1,
			gradientColor: 0x0000ff,
			color: 0xffffff,
			verbose: true,
		} )
		stage3d.add( this.line )
	}

	onResize = () => {
		this.line?.resize( window.innerWidth, window.innerHeight )
	}

	dispose() {
		window.removeEventListener( 'resize', this.onResize )
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new GpuCircleExample() 