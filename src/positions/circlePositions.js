/**
 * Generate a flat circle of points in the XY plane.
 * Use with `closed: true` to form a complete loop.
 * @param {number} [segments=100] - Number of points around the circle
 * @param {number} [radius=1] - Circle radius
 * @returns {Float32Array} Flat xyz array (length = segments * 3)
 */
export const circlePositions = ( segments = 100, radius = 1 ) => {
	const positions = new Float32Array( segments * 3 )

	for ( let i = 0; i < segments; i++ ) {
		const angle = ( i / segments ) * Math.PI * 2
		const index = i * 3
		positions[ index ] = Math.sin( angle ) * radius
		positions[ index + 1 ] = Math.cos( angle ) * radius
		positions[ index + 2 ] = 0
	}

	return positions
}
