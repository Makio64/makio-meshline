import { MathUtils, Vector3 } from 'three/webgpu'

import { reducedMotion } from '@/makio/utils/detect'
import keyboard from '@/makio/utils/input/keyboard'
import mouse from '@/makio/utils/input/mouse'
import pinch from '@/makio/utils/input/pinch'
import wheel from '@/makio/utils/input/wheel'
import { clamp } from '@/makio/utils/math'
import { menuOpen } from '@/store'

import stage from '../../core/stage'

const _right = new Vector3()
const _up = new Vector3()
const _grabbed = new Vector3()
const _reached = new Vector3()

export default class OrbitControl {
	/**
	 * @param {PerspectiveCamera} camera
	 * @param {number} [radius] - Distance to the target; defaults to the camera's current one
	 * @param {object} [options] - `target` and `cameraOffset` as `[x, y, z]`, `theta`, `phi`,
	 * `interactionTarget`, and any public property below (minPhi, maxRadius, autoRotate...)
	 */
	constructor( camera, radius, { target = [], cameraOffset = [], theta = Math.PI * 0.5, phi = Math.PI * 0.5, interactionTarget = window, ...options } = {} ) {
		this.camera = camera

		this.target = new Vector3( ...target )
		this.targetOffset = new Vector3()

		// Pan system: Shift-drag slides the camera and what it looks at together.
		this.panOffset = new Vector3()
		// At 1 the point under the pointer stays under it.
		this.panSpeed = 1
		this.enablePan = true
		// False slides over the ground, as on a map, instead of across the screen.
		this.screenSpacePanning = true
		// How far the pan may take the view from where it started.
		this.maxPan = Infinity

		this.targetLookAt = new Vector3()
		this.cameraOffset = new Vector3( ...cameraOffset )
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

		this._phi = phi
		this._theta = theta
		this.autoRotate = 0 // radians per millisecond, paused while dragging

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

		Object.assign( this, options )

		this.interactionTarget = interactionTarget
		this._pinch = new pinch()
		this.enable()
		this.place()
	}

	get phi() { return this._phi }
	set phi( value ) { this._phi = value }
	get theta() { return this._theta }
	set theta( value ) { this._theta = value }
	get isDown() { return this._isDown }

	/** Jump to `radius` without the zoom easing. */
	snapRadius( radius ) {
		this.radius = this._radius = radius
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
		if ( menuOpen.value ) {
			return
		}

		this.extraTheta += ( this.extraThetaTarget - this.extraTheta ) * 0.03 * ( dt / 16 )
		this.extraPhi += ( this.extraPhiTarget - this.extraPhi ) * 0.03 * ( dt / 16 )

		if ( this.autoRotate && !this._isDown && !reducedMotion.matches ) this._theta += this.autoRotate * dt

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

		this.place()
	}

	// Moves the camera to the current angles and radius
	place() {
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
		).add( this.panOffset )

		this.targetLookAt.set(
			this.target.x + this.targetOffset.x,
			this.target.y + this.targetOffset.y,
			this.target.z + this.targetOffset.z
		).add( this.panOffset )
		this.camera.lookAt( this.targetLookAt )
		this.camera.position.add( this.offset )
		this.camera.updateMatrixWorld()
	}
	_isGuiEvent = e => {
		const el = e?.target
		return el && el.closest && el.closest( '.lil-gui' )
	}
	
	_onDown = ( e ) => {
		if ( this._isGuiEvent( e ) ) return
		this._isDown = true
		// The pointer knows about Shift even when the keyboard events went to another element.
		if ( e.shiftKey !== undefined ) this._isShiftDown = e.shiftKey
	}

	_onUp = ( e ) => {
		if ( this._isGuiEvent( e ) ) return
		this._isDown = false
	}

	_onMove = e => {
		if ( this._isGuiEvent( e ) ) return
		if ( e.touches && e.touches.length != 1 ) {
			return
		}

		this.extraThetaTarget = this.extraThetaMouse ? mouse.normalizedX : 0
		if ( this.extraPhiMouse )
			this.extraPhiTarget = mouse.normalizedY

		if ( this._isDown ) {
			if ( e.shiftKey !== undefined ) this._isShiftDown = e.shiftKey
			if ( this._isShiftDown && this.enablePan && !this.blockPan ) {
				this.pan( mouse.x, mouse.y, mouse.moveX, mouse.moveY )
			} else {
				// Normal orbit mode
				if ( !this.blockThetaMouse )
					this._vx += mouse.moveX * this.frictionVx
				if ( !this.blockPhiMouse )
					this._vy -= mouse.moveY * this.frictionVy
			}
		}
	}

	/**
	 * Slide the view by the drag of the pointer, now at `x`, `y`, by `dx`, `dy` pixels. The scene is
	 * grabbed: across the screen the target follows the pointer, and over the ground so does the
	 * very spot under it.
	 */
	pan( x, y, dx, dy ) {
		if ( this.screenSpacePanning ) {
			const phi = this._phi - this.extraPhi * this.extraPhiMax
			const theta = this._theta + this.extraTheta * this.extraThetaMax
			// World units a pixel spans at the distance of the target.
			const fov = MathUtils.degToRad( this.camera.fov ?? 50 )
			const scale = this.panSpeed * 2 * Math.tan( fov / 2 ) * this._radius / ( stage.height || 1 )
			_right.set( Math.sin( theta ), 0, -Math.cos( theta ) )
			_up.set( -Math.cos( phi ) * Math.cos( theta ), Math.sin( phi ), -Math.cos( phi ) * Math.sin( theta ) )
			this.panOffset.addScaledVector( _right, -dx * scale ).addScaledVector( _up, dy * scale )
		} else if ( this.groundAt( x - dx, y - dy, _grabbed ) && this.groundAt( x, y, _reached ) ) {
			this.panOffset.addScaledVector( _grabbed.sub( _reached ), this.panSpeed )
		}
		if ( this.panOffset.length() > this.maxPan ) this.panOffset.setLength( this.maxPan )
	}

	/** Where the pixel `x`, `y` looks onto the level of the target, or false towards the sky or too near the horizon. */
	groundAt( x, y, target ) {
		const { camera } = this
		target.set( x / ( stage.width || 1 ) * 2 - 1, 1 - y / ( stage.height || 1 ) * 2, 0.5 ).unproject( camera ).sub( camera.position ).normalize()
		const distance = ( this.targetLookAt.y - camera.position.y ) / target.y
		if ( !( distance > 0 && distance < this._radius * 6 ) ) return false
		target.multiplyScalar( distance ).add( camera.position )
		return true
	}

	onWheel = e => {
		if ( this._isGuiEvent( e ) ) return
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
		this._isDown = false
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
