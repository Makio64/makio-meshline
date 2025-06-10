export const squarePositions = ( segments = 1 ) => {
	const corners = [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
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
