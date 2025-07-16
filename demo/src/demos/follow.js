import { Vector3, MathUtils, Raycaster } from 'three/webgpu'
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
		this.raycaster = new Raycaster()
	}

	// -------------------------------------------------- INIT
	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.disable()
		
		this.initLine()

		window.addEventListener( 'pointermove', this.onMove )
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	initLine() {
		this.line = new MeshLine()
			.lines( this.updatePosition( this.positionsF32 ), false )
			.lineWidth( 0.01 )
			.gradientColor( 0x00ff00 )
			.widthCallback( ( t ) => {
				const edge = 0.1
				if ( t < edge ) return MathUtils.lerp( 0.1, 1, t / edge )
				if ( t > 1 - edge ) return MathUtils.lerp( 0.1, 1, ( 1 - t ) / edge )
				return 1 // full width in the middle
			} )
			.verbose( true )

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
		this.line.setPositions( this.updatePosition( this.positionsF32 ) )

		// ------------------------------------------------ width based on mouse speed
		const speed = this.target.distanceTo( this.prevTarget ) / ( dt / 16 || 1 )
		const targetWidth = MathUtils.clamp( 0.001 + speed * 0.3, 0.01, 0.5 )

		// Smooth interpolation to avoid jitter
		this.line.material.lineWidth.value = MathUtils.lerp( this.line.material.lineWidth.value, targetWidth, 0.15 )
		this.prevTarget.copy( this.target )
	}

	// -------------------------------------------------- HELPERS
	updatePosition( arr ) {
		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const p = this.points[i]
			arr[i * 3] = p.x
			arr[i * 3 + 1] = p.y
			arr[i * 3 + 2] = p.z
		}
		return arr
	}

	_screenToWorld( x, y ) {
		// Convert mouse position to normalized device coordinates (-1 to +1)
		const mouse = new Vector3(
			( x / stage.width ) * 2 - 1,
			- ( y / stage.height ) * 2 + 1,
			0
		)
		
		// Update the raycaster with the camera and mouse position
		this.raycaster.setFromCamera( mouse, stage3d.camera )
		
		// Get ray origin and direction
		const origin = this.raycaster.ray.origin
		const direction = this.raycaster.ray.direction
		
		// Calculate intersection with z=0 plane
		// Ray equation: point = origin + t * direction
		// For z=0 plane: origin.z + t * direction.z = 0
		// Therefore: t = -origin.z / direction.z
		
		if ( Math.abs( direction.z ) < 0.0001 ) {
			// Ray is nearly parallel to the plane, use a default distance
			return origin.clone().add( direction.clone().multiplyScalar( 10 ) )
		}
		
		const t = -origin.z / direction.z
		
		// If t is negative, the intersection is behind the camera
		if ( t < 0 ) {
			// Project forward anyway with a reasonable distance
			return origin.clone().add( direction.clone().multiplyScalar( 10 ) )
		}
		
		// Calculate intersection point
		return new Vector3(
			origin.x + t * direction.x,
			origin.y + t * direction.y,
			0 // z = 0 by definition
		)
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
		stage3d.control.dispose()
		this.line?.dispose()
		this.line = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new FollowExample()