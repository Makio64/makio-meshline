import { Vector3, MathUtils } from 'three/webgpu'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import { MeshLine } from 'meshline'

const NUM_POINTS = 20
const LERP_FACTOR = 0.35 // smoothness of the follow behaviour

class FollowExample {
	constructor() {
		this.points = new Array( NUM_POINTS ).fill( null ).map( () => new Vector3() )
		this.positionsF32 = new Float32Array( NUM_POINTS * 3 )
		this.line = null
		this.target = new Vector3()
		this.prevTarget = new Vector3()
	}

	// -------------------------------------------------- INIT
	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		
		this.initLine()

		window.addEventListener( 'pointermove', this.onMove )
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	initLine() {
		const lineOptions = {
			lines: this._pointsToFloat32( this.positionsF32 ),
			lineWidth: 0.01,
			isClose: false,
			gradientColor: 0x00ff00,
			widthCallback: ( t ) => {
				const edge = 0.1
				if ( t < edge ) return MathUtils.lerp( 0.1, 1, t / edge )
				if ( t > 1 - edge ) return MathUtils.lerp( 0.1, 1, ( 1 - t ) / edge )
				return 1 // full width in the middle
			},
			verbose: true
		}
		this.line = new MeshLine( lineOptions )
		stage3d.add( this.line )
	}


	// -------------------------------------------------- UPDATE LOOP
	update = ( dt ) => {

		// First point heads towards the target
		this.points[0].lerp( this.target, LERP_FACTOR )

		// Each subsequent point chases the previous one
		for ( let i = 1; i < NUM_POINTS; i++ ) {
			this.points[i].lerp( this.points[i - 1], LERP_FACTOR )
		}

		
		// Efficiently update positions without rebuilding attributes
		this.line.geometry.setPositions( this._pointsToFloat32( this.positionsF32 ) )

		// ------------------------------------------------ width based on mouse speed
		const speed = this.target.distanceTo( this.prevTarget ) / ( dt / 16 || 1 )
		const targetWidth = MathUtils.clamp( 0.001 + speed, 0.15, 2 )

		// Smooth interpolation to avoid jitter
		this.line.material.lineWidth.value = MathUtils.lerp( this.line.material.lineWidth.value, targetWidth, 0.15 )
		this.prevTarget.copy( this.target )
	}

	// -------------------------------------------------- HELPERS
	_pointsToFloat32( arr ) {
		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const p = this.points[i]
			arr[i * 3] = p.x
			arr[i * 3 + 1] = p.y
			arr[i * 3 + 2] = p.z
		}
		return arr
	}

	_screenToWorld( x, y ) {
		const ndcX = ( x / stage.width ) * 2 - 1
		const ndcY = - ( y / stage.height ) * 2 + 1
		const vec = new Vector3( ndcX, ndcY, 0.5 )
		vec.unproject( stage3d.camera )
		const dir = vec.sub( stage3d.camera.position ).normalize()
		const distance = -stage3d.camera.position.z / dir.z
		return stage3d.camera.position.clone().add( dir.multiplyScalar( distance ) )
	}

	onResize = () => {
		this.line?.resize()
	}

	onMove = ( e ) => {
		this.target.copy( this._screenToWorld( e.clientX, e.clientY ) )
	}

	// -------------------------------------------------- CLEANUP
	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		window.removeEventListener( 'pointermove', this.onMove )
		stage3d.remove( this.line )
		this.line?.dispose()
		this.line = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new FollowExample() 