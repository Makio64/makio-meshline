import Signal from '../../core/Signal'
import stage from '../../core/stage'
import { mouse, onClick, onMove } from '../input/mouse'

/**
 * Inativity detector - detects inactivity of the user
 * @author David Ronai | @Makio64
 */
export default class InactivityDetector {

	constructor( duration, wheel ) {
		this.isInactive = false
		this.duration = duration
		this.inactiveTime = 0
		this.lastAction = ''
		this.onInactive = new Signal()

		onMove.add( () => {
			if ( mouse.isDown ) {
				this.reset()
			}
		} )
		onClick.add( this.reset )
		if ( wheel ) {
			this.wheel = wheel
			wheel.add( this.onWheel )
		}

		stage.onUpdate.add( this.update )
	}

	update = ( dt ) => {
		if ( mouse.isDown ) {
			this.reset()
			return
		}
		this.inactiveTime += dt
		const last = this.isInactive
		this.isInactive = this.inactiveTime >= this.duration

		if ( last !== this.isInactive && this.isInactive ) {
			this.onInactive.dispatch()
		}
	}

	reset = () => {
		this.lastAction = 'mouse'
		this.inactiveTime = 0
	}

	onWheel = ( e ) => {
		this.reset()
		this.lastAction = 'wheel'
	}

	dispose = () => {
		if ( this.wheel ) {
			this.wheel.remove( this.onWheel )
		}
		onMove.remove( this.reset )
		onClick.remove( this.reset )
		stage.onUpdate.remove( this.update )
	}
}

export { InactivityDetector }
