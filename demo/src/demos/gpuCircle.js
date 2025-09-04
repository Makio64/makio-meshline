import GUI from 'lil-gui'
import { MeshLine } from 'makio-meshline'
import { cos, Fn, mix, sin, time, uniform, vec3 } from 'three/tsl'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const segments = 128

// TSL function generating a circle in the XZ plane from the per-vertex progress (0-1)
const circlePosition = Fn( ( [progress] ) => {
	const angle = progress.add( time.negate() ).mul( Math.PI )
	return vec3( cos( angle ), sin( angle ), 0  )
} )

// TSL function generating a wavy line in the XZ plane from the per-vertex progress (0-1)
const wavePosition = Fn( ( [progress] ) => {
	// make a wavy line
	const y = sin( progress.mul( Math.PI * 4  ).add( time.negate().mul( 4 ) ) )
	return vec3( progress.oneMinus().mul( 2 ).sub( 1 ), y.mul( 0.5 ), 0 )
} )

class GpuCircleExample {
	constructor() {
		this.line = null
		this.gui = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 4 )
		stage3d.control.maxRadius = 10
		stage3d.control.minRadius = 2
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
			.segments( segments )
			.gpuPositionNode( positionNode )
			.lineWidth( 0.1 )
			.gradientColor( 0x0000ff )
			.color( 0xffffff )
			.verbose( true )

		stage3d.add( this.line )

		// GUI slider
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
		this.gui = null
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

export default new GpuCircleExample() 