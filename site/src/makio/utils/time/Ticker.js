import stage from '@/makio/core/stage'

/**
 * Ticker - A utility class to call a function at a set interval.
 * @author David Ronai | @Makio64
 */
export default class Ticker {
	/**
	 * Class constructor. Sets initial properties and sets up ticker.
	 * @param {number} duration - The duration of the ticker.
	 * @param {function} callback - The function to call when the ticker reaches the duration.
	 */
	constructor( duration, callback ) {
		this.duration = duration
		this.time = duration
		this.callback = callback

		stage.onUpdate.add( this.onUpdate )
	}

	/**
	 * Resets the ticker time to the duration.
	 */
	reset = () => {
		this.time = this.duration
	}

	/**
	 * Updates the ticker time and checks if it has reached the duration.
	 */
	onUpdate = ( dt ) => {
		this.time -= dt
		if ( this.time < 0 ) {
			this.callback()
			this.time += this.duration
		}
	}

	/**
	 * Removes ticker and cleanup.
	 */
	dispose = () => {
		stage.onUpdate.remove( this.onUpdate )
		this.callback = null
	}
}
