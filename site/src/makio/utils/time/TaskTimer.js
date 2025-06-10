/**
 * TaskTimer - Utility for measuring task durations.
 * @author David Ronai | @Makio64
 */
class TaskTimer {
	start() {
		performance.mark( 'start' )
	}

	lap( name ) {
		performance.mark( 'end' )
		performance.measure( name, 'start', 'end' )
		const duration = performance.getEntriesByName( name )[0].duration
		console.log( `${name}: ${duration.toFixed( 2 )}ms` )
		this.onLap?.( `${name}: ${duration.toFixed( 2 )}ms` )
		performance.clearMarks( 'start' )
		performance.clearMarks( 'end' )
		this.start()
	}

	clear() {
		performance.clearMarks( 'start' )
		performance.clearMarks( 'end' )
	}

	onLap( callback ) {
		this.onLap = callback
	}
}

export default new TaskTimer()
