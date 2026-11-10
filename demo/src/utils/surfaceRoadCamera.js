/** Camera of the Road Builder demo: the editor's orbit, a chase view and the driver's seat. None of it is MeshLine API. */
import { MathUtils, Quaternion, Vector3 } from 'three/webgpu'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import wheel from '@/makio/utils/input/wheel'
import { signedAngle, terrainHeight } from '@/utils/surfaceRoadRoute'

const BLEND_SECONDS = 0.9
const CHASE_DISTANCE = 9
const CHASE_MIN = 5
const CHASE_MAX = 30
// The driver's eyes, in the car's own frame: under the windscreen, with the bonnet in view.
const EYE = new Vector3( 0, 0.95, 0.3 )

const _forward = new Vector3()
const _target = new Vector3()
const _seat = new Quaternion()
// A camera looks down its -Z, a car drives towards its +Z. The driver also looks a little down, at the road.
const _aboutFace = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), Math.PI )
	.multiply( new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), -0.07 ) )

/** Share of the way to a target that a spring closing `rate` of the gap per second covers in `seconds`. */
const damp = ( rate, seconds ) => 1 - Math.exp( -rate * seconds )

/**
 * `edit` leaves the camera to the orbit control, `follow` trails a car and
 * `drive` sits in it. Every switch blends from wherever the camera was, so the
 * view never cuts.
 */
export class RoadCamera {
	view = 'edit'
	carIndex = 0
	distance = CHASE_DISTANCE
	fov = { edit: stage3d.camera.fov, follow: 55, drive: 72 }
	blend = 1
	// False until the rig has been placed once on its car: it starts there, and the blend does the travelling.
	settled = false
	yaw = 0
	focus = new Vector3()
	look = new Quaternion()
	fromPosition = new Vector3()
	fromQuaternion = new Quaternion()
	fromFov = 0

	constructor( traffic ) {
		this.traffic = traffic
		// After every update of the frame: the orbit has placed the camera and the cars have moved.
		stage3d.listen( stage.onRender, this.update )
		stage3d.listen( wheel, this.onWheel )
	}

	get car() {
		return this.traffic.cars[this.carIndex % Math.max( 1, this.traffic.active )]
	}

	/** Travel from the current camera to wherever the view puts it next. */
	startBlend() {
		const { camera } = stage3d
		this.fromPosition.copy( camera.position )
		this.fromQuaternion.copy( camera.quaternion )
		this.fromFov = camera.fov
		this.blend = 0
		this.settled = false
	}

	setView( view ) {
		if ( view === this.view ) return
		this.startBlend()
		// The orbit only listens while it owns the camera.
		if ( this.view === 'edit' ) stage3d.control.disable()
		if ( view === 'edit' ) stage3d.control.enable()
		this.view = view
	}

	setCar( index ) {
		this.carIndex = MathUtils.euclideanModulo( index, Math.max( 1, this.traffic.active ) )
		if ( this.view !== 'edit' ) this.startBlend()
	}

	onWheel = event => {
		if ( this.view !== 'follow' ) return
		this.distance = MathUtils.clamp( this.distance * ( event.delta < 0 ? 1.06 : 0.94 ), CHASE_MIN, CHASE_MAX )
	}

	update = dt => {
		const { camera, control } = stage3d
		if ( this.view === 'edit' && this.blend >= 1 ) return
		const seconds = dt / 1000

		if ( this.view === 'edit' ) control.place()
		else if ( this.view === 'follow' ) this.chase( seconds )
		else this.sit( seconds )
		this.settled = true

		if ( this.blend < 1 ) {
			this.blend = Math.min( 1, this.blend + seconds / BLEND_SECONDS )
			const ease = MathUtils.smootherstep( this.blend, 0, 1 )
			camera.position.lerpVectors( this.fromPosition, camera.position, ease )
			camera.quaternion.slerpQuaternions( this.fromQuaternion, _seat.copy( camera.quaternion ), ease )
			camera.fov = MathUtils.lerp( this.fromFov, this.fov[this.view], ease )
			camera.updateProjectionMatrix()
		}
		camera.updateMatrixWorld()
	}

	/** Behind and above the car, swinging round to its heading rather than snapping to it. */
	chase( seconds ) {
		const { camera } = stage3d
		const { position, quaternion } = this.car
		_forward.set( 0, 0, 1 ).applyQuaternion( quaternion )
		const heading = Math.atan2( _forward.x, _forward.z )
		if ( this.settled ) {
			this.yaw += signedAngle( heading - this.yaw ) * damp( 2.6, seconds )
			this.focus.lerp( position, damp( 14, seconds ) )
		} else {
			this.yaw = heading
			this.focus.copy( position )
		}

		const x = Math.sin( this.yaw )
		const z = Math.cos( this.yaw )
		camera.position.set( this.focus.x - x * this.distance, this.focus.y + this.distance * 0.4 + 0.8, this.focus.z - z * this.distance )
		// Hills stay under the camera.
		camera.position.y = Math.max( camera.position.y, terrainHeight( camera.position.x, camera.position.z ) + 1.2 )
		camera.lookAt( _target.set( this.focus.x + x * 3, this.focus.y + 1, this.focus.z + z * 3 ) )
	}

	/** In the driver's seat, banking and climbing with the car. */
	sit( seconds ) {
		const { camera } = stage3d
		const { position, quaternion } = this.car
		_seat.copy( quaternion ).multiply( _aboutFace )
		if ( this.settled ) this.look.slerp( _seat, damp( 16, seconds ) )
		else this.look.copy( _seat )
		camera.quaternion.copy( this.look )
		camera.position.copy( EYE ).applyQuaternion( quaternion ).add( position )
	}
}
