import { MeshLine } from 'makio-meshline'
import { attribute, cos, float, Fn, instanceIndex, sin, time, vec3 } from 'three/tsl'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

class InstancedGpuExample {
	constructor() {
		this.line = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 30 )
		stage3d.control.maxRadius = 60
		stage3d.control.minRadius = 30
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		const instanceCount = 100
		const segments = 64

		const gpuPositionNode = Fn( ( [progress] ) => {
			const offset = attribute( 'instanceOffset', 'vec3' )
			let radius = float( 1 )// attribute( 'instanceRadius', 'float' )
			radius = radius.mul( sin( time.add( float( instanceIndex ).div( 3 ) ) ) )
			const angle = progress.mul( Math.PI * 2 ).add( time.negate() )
			return vec3( cos( angle ), sin( angle ), 0 ).mul( radius ).add( offset ) 
		} )

		this.line = new MeshLine()
			.instances( instanceCount )
			.segments( segments )
			.lineWidth( 0.2 )
			.color( 0xffffff )
			.verbose( true )
			.gpuPositionNode( gpuPositionNode )
			.colorFn( Fn( ( [progress] ) => {
				const col = float( instanceIndex ).mod( 10 )
				const row = float( instanceIndex ).div( 10 )
				return vec3( col.div( 9 ), row.div( 9 ), ( col.add( row ) ).div( 18 ).oneMinus() )
			} ) )

		// Add custom instance attributes
		this.line.addInstanceAttribute( 'instanceOffset', 3 )
		this.line.addInstanceAttribute( 'instanceRadius', 1 )

		// Set per-instance data
		for ( let i = 0; i < instanceCount; i++ ) {
			const col = i % 10
			const row = Math.floor( i / 10 )
			const x = ( col - 4.5 ) * 3
			const y = ( row - 4.5 ) * 3
			const z = 0
			this.line.setInstanceValue( 'instanceOffset', i, [x, y, z] )

			const radius = 0.1 + ( col / 9 ) * 1
			this.line.setInstanceValue( 'instanceRadius', i, radius )
		}

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

export default new InstancedGpuExample() 