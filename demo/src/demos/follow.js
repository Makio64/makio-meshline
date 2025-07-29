import { Vector3, MathUtils, Raycaster } from 'three/webgpu'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import { MeshLine } from 'meshline'
import { mouse, onMove } from '@/makio/utils/input/mouse'

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
		this.mouseSpeed = 0
		this.targetMouseSpeed = 0
	}

	// -------------------------------------------------- INIT
	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.disable()
		
		this.initLine()

		onMove.add( this.onMouseMove )
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
		// Use mouse.moveX and mouse.moveY for speed calculation
		const distance = Math.sqrt( mouse.moveX * mouse.moveX + mouse.moveY * mouse.moveY )
		this.targetMouseSpeed = distance / ( dt / 16 || 1 )
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, this.targetMouseSpeed * 0.01, 0.15 )
		const targetWidth = MathUtils.clamp( this.mouseSpeed, 0.01, 1 )
		console.log( targetWidth )

		// Smooth interpolation to avoid jitter
		this.line.material.lineWidth.value = MathUtils.lerp( this.line.material.lineWidth.value, targetWidth, 0.15 )
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

	onMouseMove = ( mouseData ) => {
		// Use normalized coordinates from mouse.js
		const mouse3D = new Vector3( mouseData.normalizedX, -mouseData.normalizedY, 0 )
		
		// Update the raycaster with the camera and mouse position
		this.raycaster.setFromCamera( mouse3D, stage3d.camera )
		
		// Get ray origin and direction
		const origin = this.raycaster.ray.origin
		const direction = this.raycaster.ray.direction
		
		// Calculate intersection with z=0 plane
		if ( Math.abs( direction.z ) < 0.0001 ) {
			// Ray is nearly parallel to the plane, use a default distance
			this.target.copy( origin ).add( direction.multiplyScalar( 10 ) )
			return
		}
		
		const t = -origin.z / direction.z
		
		// If t is negative, the intersection is behind the camera
		if ( t < 0 ) {
			// Project forward anyway with a reasonable distance
			this.target.copy( origin ).add( direction.multiplyScalar( 10 ) )
			return
		}
		
		// Calculate intersection point
		this.target.set(
			origin.x + t * direction.x,
			origin.y + t * direction.y,
			0 // z = 0 by definition
		)
	}

	onResize = () => {
		this.line?.resize()
	}


	// -------------------------------------------------- CLEANUP
	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		onMove.remove( this.onMouseMove )
		stage3d.remove( this.line )
		stage3d.control.dispose()
		this.line?.dispose()
		this.line = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new FollowExample()