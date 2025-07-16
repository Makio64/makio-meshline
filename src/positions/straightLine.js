export function straightLine( width = 1, segments = 2, isVertical = false ) {
	const positions = new Float32Array( ( segments + 1 ) * 3 )
	
	for ( let i = 0; i <= segments; i++ ) {
		const t = i / segments
		const index = i * 3

		positions[ index ] = isVertical ? 0 : t * width
		positions[ index + 1 ] = isVertical ? t * width : 0
		positions[ index + 2 ] = 0
	}

	return positions
}

export function straightLineBetween( start, end, segments = 1 ) {
	const positions = new Float32Array( ( segments + 1 ) * 3 )

	let x1 = start.x || start[0]
	let y1 = start.y || start[1]
	let z1 = start.z || start[2]
	let x2 = end.x || end[0]
	let y2 = end.y || end[1]
	let z2 = end.z || end[2]
	
	for ( let i = 0; i <= segments; i++ ) {
		const t = i / segments
		const index = i * 3

		positions[ index ] = x1 + t * ( x2 - x1 )
		positions[ index + 1 ] = y1 + t * ( y2 - y1 )
		positions[ index + 2 ] = z1 + t * ( z2 - z1 )
	}

	return positions
}
