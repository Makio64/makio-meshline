export const sineWavePositions = ( wavelengths = 2, segments = 100, amplitude = 1, length = 4 ) => {
	const positions = new Float32Array( segments * 3 )
	
	for ( let i = 0; i < segments; i++ ) {
		const t = i / ( segments - 1 )
		const x = ( t - 0.5 ) * length
		const y = Math.sin( t * wavelengths * Math.PI * 2 ) * amplitude
		
		const index = i * 3
		positions[ index ] = x
		positions[ index + 1 ] = y
		positions[ index + 2 ] = 0
	}
	
	return positions
} 