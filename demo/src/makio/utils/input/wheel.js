/**
 * Wheel standartization
 * @author David Ronai / @Makio64
 */

import Signal from '../../core/Signal'
import stage from '../../core/stage'
import { isSafari, isFirefox, isMac } from '../detect'

// const FIREFOX_DELTA_MULTIPLIER = 0.9
const SAFARI_DELTA_MULTIPLIER = 0.9
const TIME_THRESHOLD = 200

export class Wheel extends Signal {
	constructor( domElement, shouldPreventDefault = true, singleEventMode = false ) {
		super()

		this.domElement = domElement
		this.shouldPreventDefault = shouldPreventDefault
		this.singleEventMode = singleEventMode
		this.currentDirection = 0
		this.lastTime = 0
		this.stopPropagation = true
		this.currentEvent = null
		this.previousEvent = null

		this.domElement.addEventListener( 'wheel', this.handleWheelEvent, { passive: false } )
		stage.onUpdate.add( this.handleUpdate )
	}

	getDelta = ( e ) => {
		const direction = ( e.deltaY && e.deltaY < 0 ) || e.detail < 0 || e.wheelDelta > 0 ? -1 : 1
		const delta = e.detail || e.wheelDelta || e.deltaY

		return {
			direction: delta === 0 && e.deltaY === 0 ? 0 : direction,
			delta,
			original: e,
		}
	}

	handleWheelEvent = ( e ) => {
		if ( this.shouldPreventDefault ) {
			e.preventDefault()
		}
		if ( this.stopPropagation ) {
			e.stopPropagation()
		}
		this.currentEvent = e
		return false
	}

	handleUpdate = ( dt ) => {
		if ( !this.currentEvent ) return

		const now = Date.now()
		const deltaData = this.currentEvent ? this.getDelta( this.currentEvent ) : this.getDelta( this.previousEvent )

		// if (isFirefox) { deltaData.delta *= FIREFOX_DELTA_MULTIPLIER }
		if ( isSafari ) { deltaData.delta *= SAFARI_DELTA_MULTIPLIER }
		if ( isMac ) { deltaData.delta *= 0.15 }

		if ( this.singleEventMode ) {
			if ( now - this.lastTime > TIME_THRESHOLD ) {
				this.lastTime = now
				this.currentDirection = deltaData.direction
				this.dispatch( deltaData )
			}
		} else {
			this.dispatch( deltaData )
		}

		this.currentEvent = null
	}

	dispose = () => {
		this.domElement.removeEventListener( 'wheel', this.handleWheelEvent, { passive: false } )
		stage.onUpdate.remove( this.handleUpdate )
		super.dispose()
	}
}

export const wheel = new Wheel( window, true )
export default wheel