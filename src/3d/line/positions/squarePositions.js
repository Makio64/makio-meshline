export const squarePositions = ( segments = 1 ) => {
	const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
	const positions = []
	for ( let i = 0; i < 4; i++ ) {
		const [x0, y0] = corners[ i ]
		const [x1, y1] = corners[ ( i + 1 ) % 4 ]
		for ( let j = 0; j < segments; j++ ) { // segments per side
			const t = j / segments
			const x = x0 + ( x1 - x0 ) * t
			const y = y0 + ( y1 - y0 ) * t
			positions.push( x, y, 0 )
		}
	}
	return positions
}
