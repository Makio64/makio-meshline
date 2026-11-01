/** Turns the mouse into what the rope solvers read: a swept world-space ray, a fading brush velocity and plucks. */
import { Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { onDown, onLeave, onMove, onUp } from '@/makio/utils/input/mouse'
import { createPluckRipples } from '@/utils/verletRopesRipple'

const POINTER_VELOCITY_DECAY = 9
const POINTER_ENGAGE_DECAY = 5
const MAX_POINTER_SPEED = 15

const _pointerNDC = new Vector2()
const _pointerWorld = new Vector3()
const _pointerVelocityTarget = new Vector3()
const _planeNormal = new Vector3()
const _interactionPlane = new Plane()
const _raycaster = new Raycaster()

export const coarsePointer = matchMedia( '(pointer: coarse)' )

export class RopePointer {
	rayOriginFrom = new Vector3( 0, 0, 18 )
	rayOriginTarget = new Vector3( 0, 0, 18 )
	rayDirFrom = new Vector3( 0, 0, -1 )
	rayDirTarget = new Vector3( 0, 0, -1 )
	lastPointerWorld = new Vector3()
	lastPointerTime = 0
	hasPointerPosition = false
	downScreenPos = new Vector2()
	pointerDragged = false
	pluckRipple = createPluckRipples()

	constructor( sim, control, hint ) {
		this.sim = sim
		this.control = control
		this.hint = hint
		stage3d.listen( onMove, this.onPointerMove )
		stage3d.listen( onDown, this.onPointerDown )
		stage3d.listen( onUp, this.onPointerUp )
		stage3d.listen( onLeave, this.onPointerLeave )
	}

	refreshPointerRay( trackVelocity ) {
		stage3d.camera.getWorldDirection( _planeNormal )
		_interactionPlane.setFromNormalAndCoplanarPoint( _planeNormal, this.control.target )

		_raycaster.setFromCamera( _pointerNDC, stage3d.camera )
		const { ray } = _raycaster
		ray.intersectPlane( _interactionPlane, _pointerWorld )

		const now = performance.now()
		const elapsed = ( now - this.lastPointerTime ) * 0.001
		const isOrbiting = this.control.isDown && this.pointerDragged

		if ( trackVelocity && !isOrbiting && this.hasPointerPosition && elapsed > 0 && elapsed < 0.12 ) {
			const pointerVelocity = this.sim.pointerVelocity.value
			_pointerVelocityTarget.subVectors( _pointerWorld, this.lastPointerWorld ).divideScalar( elapsed ).clampLength( 0, MAX_POINTER_SPEED )
			pointerVelocity.lerp( _pointerVelocityTarget, 0.45 )
			const speedFactor = Math.min( 1, pointerVelocity.length() / 1.6 )
			this.sim.pointerEngage.value = Math.max( this.sim.pointerEngage.value, speedFactor )
		}

		this.lastPointerWorld.copy( _pointerWorld )
		this.lastPointerTime = now
		if ( !this.hasPointerPosition ) {
			this.rayOriginFrom.copy( ray.origin )
			this.rayDirFrom.copy( ray.direction )
		}
		this.hasPointerPosition = true
		this.rayOriginTarget.copy( ray.origin )
		this.rayDirTarget.copy( ray.direction )
	}

	pluck( mouseData ) {
		_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.refreshPointerRay( false )

		this.sim.pluckOrigin.value.copy( _pointerWorld )
		this.sim.pluck.value = 1
		this.pluckRipple( mouseData.x, mouseData.y )
		this.hint.hide()
	}

	onPointerMove = mouseData => {
		if ( this.control.isDown && this.downScreenPos.distanceTo( mouseData ) > 6 ) {
			this.pointerDragged = true
			this.hint.hide()
		}
		_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.refreshPointerRay( true )
	}

	onPointerDown = mouseData => {
		this.downScreenPos.copy( mouseData )
		this.pointerDragged = false
		_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.refreshPointerRay( false )
	}

	onPointerUp = mouseData => {
		if ( !this.pointerDragged ) this.pluck( mouseData )
		this.pointerDragged = false
		if ( coarsePointer.matches ) this.onPointerLeave()
	}

	onPointerLeave = () => {
		this.sim.pointerEngage.value = 0
		this.sim.pointerVelocity.value.set( 0, 0, 0 )
		this.hasPointerPosition = false
	}

	update( frameDt ) {
		const { sim } = this
		if ( this.hasPointerPosition ) this.refreshPointerRay( false )
		sim.pointerVelocity.value.multiplyScalar( Math.exp( -POINTER_VELOCITY_DECAY * frameDt ) )
		if ( this.control.isDown && this.pointerDragged ) {
			sim.pointerEngage.value = 0
			sim.pointerVelocity.value.set( 0, 0, 0 )
		} else {
			sim.pointerEngage.value *= Math.exp( -POINTER_ENGAGE_DECAY * frameDt )
			if ( sim.pointerEngage.value < 0.001 ) sim.pointerEngage.value = 0
		}
	}

	/** Moves the solvers' ray `alpha` of the way from last frame's pose to this frame's. */
	sweepRay( alpha ) {
		this.sim.rayOrigin.value.lerpVectors( this.rayOriginFrom, this.rayOriginTarget, alpha )
		this.sim.rayDir.value.lerpVectors( this.rayDirFrom, this.rayDirTarget, alpha ).normalize()
	}

	endSweep() {
		this.rayOriginFrom.copy( this.rayOriginTarget )
		this.rayDirFrom.copy( this.rayDirTarget )
	}
}
