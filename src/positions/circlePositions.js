/**
 * Generate a flat circle of points in the XY plane.
 * Use with `closed: true` to form a complete loop.
 * @param {number} [segments=100] - Number of points around the circle
 * @param {number} [radius=1] - Circle radius
 * @returns {Float32Array} Flat xyz array (length = segments * 3)
 */
export const circlePositions = ( segments = 100, radius = 1 ) => {
	const positions = new Float32Array( segments * 3 )
	const tau = Math.PI * 2

	for ( let i = 0, index = 0; i < segments; i++, index += 3 ) {
		const angle = ( i / segments ) * tau
		positions[ index ] = Math.sin( angle ) * radius
		positions[ index + 1 ] = Math.cos( angle ) * radius
	}

	return positions
}
