/**
 * Generate a sine wave in the XY plane along the X axis.
 * @param {number} [wavelengths=2] - Number of full sine wave cycles
 * @param {number} [segments=100] - Number of sample points
 * @param {number} [amplitude=1] - Wave amplitude (peak Y displacement)
 * @param {number} [length=4] - Total length along the X axis
 * @returns {Float32Array} Flat xyz array
 */
export const sineWavePositions = ( wavelengths = 2, segments = 100, amplitude = 1, length = 4 ) => {
	segments = Math.max( segments, 2 )
	const positions = new Float32Array( segments * 3 )
	const invLast = 1 / ( segments - 1 )
	const freq = wavelengths * Math.PI * 2

	for ( let i = 0, index = 0; i < segments; i++, index += 3 ) {
		const t = i * invLast
		positions[ index ] = ( t - 0.5 ) * length
		positions[ index + 1 ] = Math.sin( t * freq ) * amplitude
	}

	return positions
}