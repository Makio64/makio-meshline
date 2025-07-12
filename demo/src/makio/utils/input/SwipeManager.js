import Signal from '../../core/Signal'
import mouse, { onDown, onLeave, onMove, onUp } from './mouse'
import keyboard from './keyboard'

/**
 * Swipe gestures manager
 * Offers fallback to keyboard for easy testing
 * @author David Ronai / @Makio64
 */
class SwipeManager {
	constructor() {
		this.onSwipe = new Signal()

		this.swipeDistance = 20

		this.swipeStartTime = 0
		this.swipeStartX = 0
		this.swipeStartY = 0
		this.lastMouseX = 0
		this.lastMouseY = 0
		this.lastSwipeTime = 0
		this.moveX = 0
		this.moveY = 0
		this.swiped = false

		onDown.add( () => {
			this.swipeStartTime = Date.now()
			this.swipeStartX = mouse.x
			this.swipeStartY = mouse.y
			this.lastMouseX = this.swipeStartX
			this.lastMouseY = this.swipeStartY
		} )

		onMove.add( () => {
			this.lastMouseX = mouse.x
			this.lastMouseY = mouse.y
			this.moveX = this.lastMouseX - this.swipeStartX
			this.moveY = this.lastMouseY - this.swipeStartY
			this.checkSwipe()
		} )

		keyboard.onDown.add( ( key ) => {
			switch ( key ) {
				case 'ArrowLeft':
					this.onSwipe.dispatch( 'right' )
					break
				case 'ArrowRight':
					this.onSwipe.dispatch( 'left' )
					break
				case 'ArrowUp':
					this.onSwipe.dispatch( 'top' )
					break
				case 'ArrowDown':
					this.onSwipe.dispatch( 'bottom' )
					break
			}
		} )

		onUp.add( this.onEnd )
		onLeave.add( this.onEnd )
	}

	onEnd = () => {
		this.swiped = false
	}

	checkSwipe = () => {
		if ( this.swiped ) {
			return
		}
		// if (Date.now() - this.swipeStartTime > 6000) {
		// 	return
		// }
		// if (50 > Date.now() - this.lastSwipeTime) {
		// 	return
		// }
		this.lastSwipeTime = Date.now()

		// Minimal swipe distance detection
		const xDiff = this.lastMouseX - this.swipeStartX
		const yDiff = this.lastMouseY - this.swipeStartY
		const angle = Math.atan2( -yDiff, xDiff )

		if ( Math.abs( xDiff ) > Math.abs( yDiff ) ) {
			if ( xDiff < -this.swipeDistance ) {
				this.swiped = true
				this.onSwipe.dispatch( 'right', angle )
			}
			if ( xDiff > this.swipeDistance ) {
				this.swiped = true
				this.onSwipe.dispatch( 'left', angle )
			}
		} else {
			if ( yDiff < -this.swipeDistance ) {
				this.swiped = true
				this.onSwipe.dispatch( 'top', angle, xDiff, yDiff )
			}
			if ( yDiff > this.swipeDistance ) {
				this.swiped = true
				this.onSwipe.dispatch( 'bottom', angle )
			}
		}
	}
}

export default new SwipeManager()
