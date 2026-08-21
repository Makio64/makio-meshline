import GUI from 'lil-gui'
import { MeshLine } from 'makio-meshline'
import { cos, Fn, mix, sin, time, uniform, vec3 } from 'three/tsl'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const SEGMENTS = 128
const TWO_PI = Math.PI * 2

// Generate a circle in the XY plane from normalized per-vertex progress.
const circlePosition = Fn( ( [progress] ) => {
	const angle = progress.add( time.negate() ).mul( TWO_PI )
	return vec3( cos( angle ), sin( angle ), 0 )
} )

// Generate a wave in the XY plane from the same normalized progress.
const wavePosition = Fn( ( [progress] ) => {
	const y = sin( progress.mul( Math.PI * 4 ).add( time.negate().mul( 4 ) ) )
	return vec3( progress.oneMinus().mul( 2 ).sub( 1 ), y.mul( 0.5 ), 0 )
} )

class GpuCircleExample {
	constructor() {
		this.line = null
		this.gui = null
		this.control = null
	}

	async init() {
		await stage3d.initRender()
		this.control = new OrbitControl( stage3d.camera, 4 )
		this.control.maxRadius = 10
		this.control.minRadius = 2
		stage3d.control = this.control
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		const useWave = uniform( 0 )
		const positionNode = Fn( ( [progress] ) => {
			return mix( circlePosition( progress ), wavePosition( progress ), useWave )
		} )

		this.line = new MeshLine()
			.segments( SEGMENTS )
			.closed( true )
			.gpuPositionNode( positionNode )
			.lineWidth( 0.1 )
			.gradientColor( 0x0000ff )
			.color( 0xffffff )

		stage3d.add( this.line )

		const urlParams = new URLSearchParams( window.location.search )
		const hasNoMenu = urlParams.has( 'noUI' )

		this.gui = new GUI( { width: hasNoMenu ? 220 : 300 } )
		this.gui.domElement.style.right = hasNoMenu ? '0' : '60px'
		this.gui.add( { blend: 0 }, 'blend', 0, 1, 0.01 ).name( 'Wave ⇆ Circle' ).onChange( v => {
			useWave.value = v
		} )
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		this.gui?.destroy()
		window.removeEventListener( 'resize', this.onResize )
		stage3d.remove( this.line )
		this.line?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.line = null
		this.control = null
	}

}

export default GpuCircleExample
