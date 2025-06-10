/**
 * Pinch signal dispatcher
 * @author David Ronai / @Makio64
 */
import Signal from '../../core/Signal'

export default class pinch {
	constructor( element = window ) {
		this.element = element
		this.onRotate = new Signal()
		this.onZoom = new Signal()
		this.onPinchIn = new Signal()
		this.onPinchOut = new Signal()

		this.thresholds = {
			scale: 0.1, // percentage difference.
			rotation: 1, // degrees.
		}
	}

	enable() {
		this.element.addEventListener( 'touchstart', this.handleTouchStart )
		this.element.addEventListener( 'touchmove', this.handleTouchMove )
	}

	disable() {
		this.element.removeEventListener( 'touchstart', this.handleTouchStart )
		this.element.removeEventListener( 'touchmove', this.handleTouchMove )
	}

	handleTouchStart = ( e ) => {
		var touches = e.touches
		if ( touches.length == 2 ) {
			this.referencePair = new TouchPair( touches )
		}
	}

	handleTouchMove = ( e ) => {
		if ( e.touches.length === 2 ) {
			e.preventDefault()
			const currentPair = new TouchPair( e.touches )
			const center = currentPair.center()
			this.handleRotation( currentPair, center )
			this.handleZoom( currentPair, center )
		}
	}

	handleRotation( currentPair, center ) {
		const angle = currentPair.angleSince( this.referencePair )
		if ( Math.abs( angle ) > this.thresholds.rotation ) {
			this.onRotate.dispatch( { rotation: angle, x: center.x, y: center.y } )
		}
	}

	handleZoom( currentPair, center ) {
		const scale = currentPair.scaleSince( this.referencePair )
		if ( Math.abs( scale - 1 ) > this.thresholds.scale ) {
			if ( scale < 1 ) {
				this.onPinchIn.dispatch( scale )
			} else {
				this.onPinchOut.dispatch( scale )
			}
			this.onZoom.dispatch( { scale: scale, x: center.x, y: center.y } )
		}
	}

	dispose = () => {
		this.disable()
		this.onRotate.dispose()
		this.onZoom.dispose()
		this.onPinchIn.dispose()
		this.onPinchOut.dispose()
	}
}

class Touch {
	constructor( x, y ) {
		this.x = x
		this.y = y
	}
}

class TouchPair {
	constructor( touchList ) {
		// Grab the first two touches from the list.
		this.touch1 = new Touch( touchList[0].pageX, touchList[0].pageY )
		this.touch2 = new Touch( touchList[1].pageX, touchList[1].pageY )
	}

	angleDifferenceFrom( referencePair ) {
		const directDifference = this.getAngle() - referencePair.getAngle()
		const wrappedDifference = directDifference >= 0 ? directDifference - 360 : directDifference + 360

		return Math.abs( wrappedDifference ) < Math.abs( directDifference ) ? wrappedDifference : directDifference
	}

	scaleDifferenceFrom( referencePair ) {
		return this.getSpan() / referencePair.getSpan()
	}

	getCenter() {
		return new Touch( ( this.touch1.x + this.touch2.x ) / 2, ( this.touch1.y + this.touch2.y ) / 2 )
	}

	getSpan() {
		const dx = this.touch1.x - this.touch2.x
		const dy = this.touch1.y - this.touch2.y
		return Math.sqrt( dx * dx + dy * dy )
	}

	getAngle() {
		const dx = this.touch1.x - this.touch2.x
		const dy = this.touch1.y - this.touch2.y
		return ( Math.atan2( dy, dx ) * 180 ) / Math.PI
	}
}

export { pinch }
