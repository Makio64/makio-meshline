export const circlePositions = ( segments = 100 ) => {
	const positions = new Float32Array( segments * 3 )

	for ( let i = 0; i < segments; i++ ) {
		const angle = ( i / segments ) * Math.PI * 2
		const index = i * 3
		positions[ index ] = Math.sin( angle )
		positions[ index + 1 ] = Math.cos( angle )
		positions[ index + 2 ] = 0
	}

	return positions
}
