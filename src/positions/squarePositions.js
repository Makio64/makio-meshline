/**
 * Generate a square loop of points in the XY plane.
 * Use with `closed: true` to form a complete loop.
 * @param {number} [width=1] - Side length of the square
 * @param {number} [segments=1] - Number of subdivisions per side
 * @returns {Float32Array} Flat xyz array
 */
export const squarePositions = ( width = 1, segments = 1 ) => {
	const corners = [
		[-width / 2, -width / 2],
		[width / 2, -width / 2],
		[width / 2, width / 2],
		[-width / 2, width / 2],
	]
	const numVertices = 4 * segments
	const positions = new Float32Array( numVertices * 3 )

	for ( let i = 0; i < 4; i++ ) {
		const [x0, y0] = corners[i]
		const [x1, y1] = corners[( i + 1 ) % 4]
		for ( let j = 0; j < segments; j++ ) {
			// segments per side
			const t = j / segments
			const x = x0 + ( x1 - x0 ) * t
			const y = y0 + ( y1 - y0 ) * t
			const index = ( i * segments + j ) * 3
			positions[index] = x
			positions[index + 1] = y
			positions[index + 2] = 0
		}
	}
	return positions
}
