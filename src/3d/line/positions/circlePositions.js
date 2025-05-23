export const circlePositions = ( segments = 100 )=>{
	const positions = []
	// const segments = 100 // segments is now a parameter

	for ( let i = 0; i < segments; i++ ) {
		const angle = ( i / segments ) * Math.PI * 2
		positions.push( Math.sin( angle ), Math.cos( angle ), 0 )
	}

	return positions
}
