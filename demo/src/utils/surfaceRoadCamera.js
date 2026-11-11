/** Camera of the Road Builder demo: the editor's orbit, a chase view and the driver's seat. None of it is MeshLine API. */
import { MathUtils, Quaternion, Vector3 } from 'three/webgpu'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import wheel from '@/makio/utils/input/wheel'
import { EYE, RoadCockpit } from '@/utils/surfaceRoadCockpit'
import { signedAngle, terrainHeight } from '@/utils/surfaceRoadRoute'

const BLEND_SECONDS = 0.9
const CHASE_DISTANCE = 9
const CHASE_MIN = 5
const CHASE_MAX = 30
// Sine of the steepest slope the chase boom takes: on a wall it would hang over the car and look back up the road.
const STEEPEST = 0.85
// How far the driver's head turns into a bend, per radian of steering lock.
const GLANCE = 0.45
// The driver's field of view at rest, and the degrees it opens per m/s: speed is felt at the edges of the screen.
const DRIVE_FOV = 62
const RUSH = 0.2

const _forward = new Vector3()
const _along = new Vector3()
const _above = new Vector3()
const _target = new Vector3()
const _seat = new Quaternion()
const _glance = new Quaternion()
const _up = new Vector3( 0, 1, 0 )
// A camera looks down its -Z, a car drives towards its +Z. The driver also looks a little down, at the road over the instruments.
const _aboutFace = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), Math.PI )
	.multiply( new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), -0.11 ) )

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
	fov = { edit: stage3d.camera.fov, follow: 55, drive: DRIVE_FOV }
	// The driver's eyes are a hand's width under the roof, nearer than the editor's near plane.
	near = { edit: stage3d.camera.near, follow: stage3d.camera.near, drive: 0.06 }
	blend = 1
	// True while the view being left is the driver's seat.
	leftSeat = false
	// False until the rig has been placed once on its car: it starts there, and the blend does the travelling.
	settled = false
	yaw = 0
	trail = 1
	rise = 0
	focus = new Vector3()
	look = new Quaternion()
	fromPosition = new Vector3()
	fromQuaternion = new Quaternion()
	fromFov = 0
	fromNear = 0

	constructor( traffic ) {
		this.traffic = traffic
		this.cockpit = new RoadCockpit( traffic.cars.length )
		// After every update of the frame: the orbit has placed the camera and the cars have moved.
		stage3d.listen( stage.onRender, this.update )
		stage3d.listen( wheel, this.onWheel )
	}

	/** Which car of the traffic is being ridden. A shorter road may have taken away the one that was. */
	get seat() {
		return this.carIndex % Math.max( 1, this.traffic.active )
	}

	get car() {
		return this.traffic.cars[this.seat]
	}

	/** Travel from the current camera to wherever the view puts it next. */
	startBlend() {
		const { camera } = stage3d
		this.fromPosition.copy( camera.position )
		this.fromQuaternion.copy( camera.quaternion )
		this.fromFov = camera.fov
		this.fromNear = camera.near
		this.blend = 0
		this.settled = false
	}

	setView( view ) {
		if ( view === this.view ) return
		this.startBlend()
		// The orbit only listens while it owns the camera.
		if ( this.view === 'edit' ) stage3d.control.disable()
		if ( view === 'edit' ) stage3d.control.enable()
		this.leftSeat = this.view === 'drive'
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
			camera.near = MathUtils.lerp( this.fromNear, this.near[this.view], ease )
			camera.updateProjectionMatrix()
		} else if ( camera.fov !== this.fov[this.view] ) {
			camera.fov = this.fov[this.view]
			camera.updateProjectionMatrix()
		}
		camera.updateMatrixWorld()
		// The cockpit stands round the driver's seat, and for as long as the camera is on its way out of it.
		this.cockpit.update( this.traffic, this.seat, this.view === 'drive' || ( this.leftSeat && this.blend < 1 ) )
	}

	/** Behind and above the car, swinging round to its heading rather than snapping to it. */
	chase( seconds ) {
		const { camera } = stage3d
		const { position, quaternion, phase } = this.car
		_forward.set( 0, 0, 1 ).applyQuaternion( quaternion )
		const heading = Math.atan2( _forward.x, _forward.z )
		// `trail` is which way along the road the boom lies. Through the turn at an end it comes
		// round with the yaw, so the boom stays over the road it is measured against.
		const travel = this.traffic.travel( phase )
		if ( this.settled ) {
			const swing = damp( 2.6, seconds )
			this.yaw += signedAngle( heading - this.yaw ) * swing
			this.trail += ( travel - this.trail ) * swing
			this.focus.lerp( position, damp( 14, seconds ) )
		} else {
			this.yaw = heading
			this.trail = travel
			this.focus.copy( position )
		}

		// The boom lies along the road under it, not along the horizon. Down a steep hill a level
		// boom ends up below the deck rising behind the car, looking at its underside.
		const slope = MathUtils.clamp( this.traffic.climb( phase, this.trail * this.distance ) / this.distance, -STEEPEST, STEEPEST )
		// Eased, or the boom would tick each time it passes a row of the road.
		this.rise += ( slope - this.rise ) * ( this.settled ? damp( 8, seconds ) : 1 )
		const { rise } = this
		const run = Math.sqrt( 1 - rise * rise )
		const x = Math.sin( this.yaw )
		const z = Math.cos( this.yaw )
		_along.set( x * run, rise, z * run )
		_above.set( -x * rise, run, -z * rise )
		camera.position.copy( this.focus ).addScaledVector( _along, -this.distance ).addScaledVector( _above, this.distance * 0.4 + 0.8 )
		// Hills stay under the camera.
		camera.position.y = Math.max( camera.position.y, terrainHeight( camera.position.x, camera.position.z ) + 1.2 )
		camera.lookAt( _target.copy( this.focus ).addScaledVector( _along, 3 ).addScaledVector( _above, 1 ) )
	}

	/** In the driver's seat: leaning with the body of the car, and looking into the bend it is steering for. */
	sit( seconds ) {
		const { camera } = stage3d
		const { body, steer, speed } = this.car
		this.fov.drive = DRIVE_FOV + speed * RUSH
		_seat.setFromRotationMatrix( body ).multiply( _glance.setFromAxisAngle( _up, steer * GLANCE ) ).multiply( _aboutFace )
		if ( this.settled ) this.look.slerp( _seat, damp( 16, seconds ) )
		else this.look.copy( _seat )
		camera.quaternion.copy( this.look )
		camera.position.copy( EYE ).applyMatrix4( body )
	}
}
