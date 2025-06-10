import { Vector3 } from 'three'
import stage from '../../core/stage'
import wheel from '@/makio/utils/input/wheel'
import pinch from '@/makio/utils/input/pinch'
import mouse from '@/makio/utils/input/mouse'
import keyboard from '@/makio/utils/input/keyboard'
import { clamp } from '@/makio/utils/math'

export default class OrbitControl {
	constructor( camera, radius, target = null, interactionTarget = window ) {
		this.camera = camera

		this.target = target || new Vector3()
		this.targetOffset = new Vector3()

		// Pan system
		this.panOffset = new Vector3()
		this.panSpeed = 0.002
		this.enablePan = true

		this.targetLookAt = new Vector3()
		this.cameraOffset = new Vector3()
		this.offset = new Vector3()

		const initialRadius = radius || camera.position.distanceTo( this.target ) || 1
		this.radius = initialRadius
		this._radius = initialRadius
		this.minRadius = 0
		this.maxRadius = Number.MAX_VALUE

		this._isDown = false
		this._isShiftDown = false
		this._vx = 0
		this._vy = 0
		this.speedMax = 1
		this.friction = 0.968
		this.frictionVx = 0.0008
		this.frictionVy = 0.0006

		this._phi = Math.PI * 0.5
		this._theta = Math.PI * 0.5

		this.blockThetaMouse = false
		this.blockPhiMouse = false
		this.blockZoom = false
		this.blockPan = false

		this.isPhiRestricted = true
		this.isThetaRestricted = false
		this.minPhi = 0.7
		this.maxPhi = Math.PI * 0.8
		this.minTheta = -1.7
		this.maxTheta = 1.7

		// extra adjustments
		this.extraTheta = 0
		this.extraPhi = 0
		this.extraThetaTarget = 0
		this.extraPhiTarget = 0

		// mouse influence
		this.extraThetaMouse = true
		this.extraPhiMouse = true
		this.extraPhiMin = -0.1
		this.extraPhiMax = 0.1
		this.extraThetaMin = -0.25
		this.extraThetaMax = 0.25

		this.interactionTarget = interactionTarget
		this._pinch = new pinch()
		this.enable()
		this.update()
		this.camera.updateMatrixWorld()
	}

	lock = () => {
		this.blockThetaMouse = true
		this.blockPhiMouse = true
		this.blockZoom = true
		this.blockPan = true
		this.extraThetaMouse = false
		this.extraPhiMouse = false
		this.isPhiRestricted = true
		this.isThetaRestricted = true
	}

	update = ( dt = 16 ) => {
		this.extraTheta += ( this.extraThetaTarget - this.extraTheta ) * 0.03 * ( dt / 16 )
		this.extraPhi += ( this.extraPhiTarget - this.extraPhi ) * 0.03 * ( dt / 16 )

		this._vx = clamp( this._vx, -this.speedMax, this.speedMax )
		this._vy = clamp( this._vy, -this.speedMax, this.speedMax )
		this._radius += ( this.radius - this._radius ) * 0.1  * ( dt / 16 )

		// Only apply orbit velocities when not in pan mode
		if ( !this._isShiftDown ) {
			this._vx *= this.friction
			this._vy *= this.friction

			this._phi += this._vy
			this._theta += this._vx
		} else {
			// In pan mode, gradually reduce velocities to stop orbiting
			this._vx *= 0.9
			this._vy *= 0.9
		}

		if ( this.isThetaRestricted )
			this._theta = clamp( this._theta, this.minTheta, this.maxTheta )

		if ( this.isPhiRestricted )
			this._phi = clamp( this._phi, this.minPhi, this.maxPhi )

		let phi = this._phi - this.extraPhi * this.extraPhiMax
		let theta = this._theta + this.extraTheta * this.extraThetaMax

		if ( this.isThetaRestricted )
			theta = clamp( theta, this.minTheta, this.maxTheta )

		if ( this.isPhiRestricted )
			phi = clamp( phi, this.minPhi, this.maxPhi )

		this.camera.position.set(
			this.cameraOffset.x + this._radius * Math.sin( phi ) * Math.cos( theta ),
			this.cameraOffset.y + this._radius * Math.cos( phi ),
			this.cameraOffset.z + this._radius * Math.sin( phi ) * Math.sin( theta )
		)

		this.targetLookAt.set(
			this.target.x + this.targetOffset.x,
			this.target.y + this.targetOffset.y,
			this.target.z + this.targetOffset.z
		)
		this.camera.lookAt( this.targetLookAt )
		this.camera.position.add( this.offset )
	}

	_onDown = () => {
		this._isDown = true
	}

	_onUp = () => {
		this._isDown = false
	}

	_onMove = e => {
		if ( e.touches && e.touches.length != 1 ) {
			return
		}

		this.extraThetaTarget = this.extraThetaMouse ? mouse.normalizedX : 0
		if ( this.extraPhiMouse )
			this.extraPhiTarget = mouse.normalizedY

		if ( this._isDown ) {
			// Check if shift key is pressed for panning
			if ( this._isShiftDown && this.enablePan && !this.blockPan ) {
				// Pan mode - move the target instead of rotating
				const panDeltaX = mouse.moveX * this.panSpeed * this._radius
				const panDeltaY = mouse.moveY * this.panSpeed * this._radius

				// Calculate pan direction based on camera orientation
				const phi = this._phi - this.extraPhi * this.extraPhiMax
				const theta = this._theta + this.extraTheta * this.extraThetaMax

				// Right vector (cross product of up and forward)
				const rightX = Math.cos( theta + Math.PI * 0.5 )
				const rightZ = Math.sin( theta + Math.PI * 0.5 )

				// Up vector (relative to camera orientation)
				const upX = -Math.sin( phi ) * Math.cos( theta )
				const upY = Math.cos( phi )
				const upZ = -Math.sin( phi ) * Math.sin( theta )

				// Apply pan offset
				this.target.x += rightX * panDeltaX + upX * panDeltaY
				this.target.y += upY * panDeltaY
				this.target.z += rightZ * panDeltaX + upZ * panDeltaY
			} else {
				// Normal orbit mode
				if ( !this.blockThetaMouse )
					this._vx += mouse.moveX * this.frictionVx
				if ( !this.blockPhiMouse )
					this._vy -= mouse.moveY * this.frictionVy
			}
		}
	}

	onWheel = e => {
		if ( this.blockZoom ) return
		this.isPinching = true
		e.delta < 0 ? this.zoomOut() : this.zoomIn()
	}

	zoomIn = ( rad = 0.94 ) => {
		this.radius *= rad
		if ( this.radius < this.minRadius )
			this.radius = this.minRadius
	}

	zoomOut = ( rad = 1.06 ) => {
		this.radius *= rad
		if ( this.radius > this.maxRadius )
			this.radius = this.maxRadius
	}

	onPinchIn = () => {
		if ( this.blockZoom ) return
		this.isPinching = true
		this.zoomOut( 1.02 )
	}

	onPinchOut = () => {
		if ( this.blockZoom ) return
		this.isPinching = true
		this.zoomIn( 0.98 )
	}

	_onKeyDown = ( key, event ) => {
		if ( key === 'Shift' ) {
			this._isShiftDown = true
		}
	}

	_onKeyUp = ( key, event ) => {
		if ( key === 'Shift' ) {
			this._isShiftDown = false
		}
	}

	enable() {
		this._pinch.enable()
		this.interactionTarget.addEventListener( 'pointerdown', this._onDown )
		this.interactionTarget.addEventListener( 'pointerup', this._onUp )
		this.interactionTarget.addEventListener( 'pointermove', this._onMove )
		keyboard.onDown.add( this._onKeyDown )
		keyboard.onUp.add( this._onKeyUp )
		wheel.add( this.onWheel )
		this._pinch.onPinchIn.add( this.onPinchIn )
		this._pinch.onPinchOut.add( this.onPinchOut )
		stage.onUpdate.add( this.update )
	}

	disable() {
		console.log( 'disable' )
		this._pinch.disable()
		this.interactionTarget.removeEventListener( 'pointerdown', this._onDown )
		this.interactionTarget.removeEventListener( 'pointerup', this._onUp )
		this.interactionTarget.removeEventListener( 'pointermove', this._onMove )
		keyboard.onDown.remove( this._onKeyDown )
		keyboard.onUp.remove( this._onKeyUp )
		wheel.remove( this.onWheel )
		this._pinch.onPinchIn.remove( this.onPinchIn )
		this._pinch.onPinchOut.remove( this.onPinchOut )
		stage.onUpdate.remove( this.update )
	}

	dispose = () => {
		this.disable()
		this._pinch.dispose()
		this._pinch = null
		this.camera = null
		this.target = null
		this.offset = null
		this.targetOffset = null
		this.targetLookAt = null
		this.panOffset = null
	}
}

export { OrbitControl }
