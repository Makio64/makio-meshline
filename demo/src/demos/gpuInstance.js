import { MeshLine } from 'makio-meshline'
import { attribute, cos, float, Fn, instanceIndex, sin, time, vec3 } from 'three/tsl'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const GRID_SIZE = 10
const GRID_SPACING = 3
const INSTANCE_COUNT = GRID_SIZE * GRID_SIZE
const SEGMENTS = 64

class GpuInstanceExample {
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

		const gpuPositionNode = Fn( ( [progress] ) => {
			const offset = attribute( 'instanceOffset', 'vec3' )
			const radius = sin( time.add( float( instanceIndex ).div( 3 ) ) )
			const angle = progress.mul( Math.PI * 2 ).add( time.negate() )
			return vec3( cos( angle ), sin( angle ), 0 ).mul( radius ).add( offset )
		} )

		this.line = new MeshLine()
			.instances( INSTANCE_COUNT )
			.segments( SEGMENTS )
			.lineWidth( 0.2 )
			.color( 0xffffff )
			.gpuPositionNode( gpuPositionNode )
			.colorFn( Fn( () => {
				const column = float( instanceIndex ).mod( GRID_SIZE )
				const row = float( instanceIndex ).div( GRID_SIZE ).floor()
				const maxGridIndex = GRID_SIZE - 1
				return vec3(
					column.div( maxGridIndex ),
					row.div( maxGridIndex ),
					column.add( row ).div( maxGridIndex * 2 ).oneMinus()
				)
			} ) )

		// Add custom instance attributes
		const offsetAttribute = this.line.addInstanceAttribute( 'instanceOffset', 3 )

		// Fill the returned CPU buffer before its first upload. This avoids a
		// second staging array while still producing one initial GPU transfer.
		const offsets = offsetAttribute.array
		const gridCenter = ( GRID_SIZE - 1 ) * 0.5
		for ( let i = 0; i < INSTANCE_COUNT; i++ ) {
			const column = i % GRID_SIZE
			const row = Math.floor( i / GRID_SIZE )
			const offset = i * 3
			offsets[offset] = ( column - gridCenter ) * GRID_SPACING
			offsets[offset + 1] = ( row - gridCenter ) * GRID_SPACING
			offsets[offset + 2] = 0
		}
		stage3d.add( this.line )
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		window.removeEventListener( 'resize', this.onResize )
		stage3d.remove( this.line )
		this.line.dispose()
		stage3d.control.dispose()
	}

}

export default GpuInstanceExample
