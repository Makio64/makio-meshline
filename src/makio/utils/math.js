// Constants for commonly used math values
export const PI = Math.PI
export const TWO_PI = PI * 2

// Returns the sign of a number
export const sign = ( value ) => ( value > 0 ) - ( value < 0 )

// Restricts a number to stay within a certain range
export const clamp = ( value, min = 0, max = 1 ) => Math.max( min, Math.min( value, max ) )

// Linearly interpolates between two numbers
export const lerp = ( value1, value2, t ) => ( 1 - t ) * value1 + t * value2

// Alias for lerp
export const mix = lerp

// Maps a number from one range to a normalized range (0 - 1)
export const map = ( value, min, max ) => clamp( ( value - min ) / ( max - min ) )

// Scales a number from one range to another
export const range = ( oldValue, oldMin, oldMax, newMin, newMax, clamped = false ) => {
	const oldRange = oldMax - oldMin
	const newRange = newMax - newMin
	const newValue = ( ( oldValue - oldMin ) * newRange ) / oldRange + newMin

	// Clamps the value within the new range if required
	return clamped ? clamp( newValue, newMin, newMax ) : newValue
}

// Performs smoothstep interpolation between two values
export const smoothstep = ( min, max, value ) => clamp( ( value - min ) / ( max - min ) )

// Calculates the smallest difference between two angles
export const angleDistance = ( alpha, beta ) => {
	const phi = Math.abs( beta - alpha ) % TWO_PI
	return phi > PI ? TWO_PI - phi : phi
}

// Computes the signed difference between two angles
export const angleDistanceSign = ( alpha, beta ) => {
	const sign = ( alpha - beta >= 0 && alpha - beta <= PI ) || ( alpha - beta <= -PI && alpha - beta >= -TWO_PI ) ? 1 : -1
	return angleDistance( alpha, beta ) * sign
}

// Interpolates between two angles considering the shortest path
export const interpolateAngle = ( fromAngle, toAngle, t ) => {
	let diff = Math.abs( fromAngle - toAngle ) % TWO_PI
	if ( diff > PI ) {
		if ( fromAngle > toAngle ) fromAngle -= TWO_PI
		else toAngle -= TWO_PI
	}
	return lerp( fromAngle, toAngle, t )
}

// Computes the shortest angle distance
export const shortestAngleDist = ( fromAngle, toAngle ) => {
	const max = TWO_PI
	const da = ( toAngle - fromAngle ) % max
	return ( ( 2 * da ) % max ) - da
}

// Maps a value to a power within a given range
export const mapToPower = ( value, min, max, power ) => {
	value = Math.pow( ( sign( value ) * ( value - min ) ) / ( max - min ), Math.abs( power ) )
	value = sign( value ) > 0 ? value : 1 - value
	return value * ( max - min ) + min
}

// Computes the Euclidean distance between two points
export const distance = ( x1, y1, x2, y2 ) => {
	const dx = x1 - x2
	const dy = y1 - y2
	return Math.sqrt( dx * dx + dy * dy )
}

// Computes the square of the Euclidean distance (useful for distance comparisons)
export const distanceCompare = ( x1, y1, x2, y2 ) => {
	const dx = x1 - x2
	const dy = y1 - y2
	return dx * dx + dy * dy
}

// Computes the next power of 2 for a given number
export const nextPower2 = ( n ) => {
	n--
	n |= n >> 1
	n |= n >> 2
	n |= n >> 4
	n |= n >> 8
	n |= n >> 16
	return ++n
}

// Rounds a number to the nearest even number
export const even = ( num ) => 2 * Math.round( num / 2 )
