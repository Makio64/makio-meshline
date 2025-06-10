const calculateTextureSize = function ( count ) {
	let width = 2
	let height = 2
	let k = 0

	while ( width * height < count ) {
		k++
		if ( k % 2 == 0 ) {
			height *= 2
		} else {
			width *= 2
		}
	}

	return { width: width, height: height }
}

export default calculateTextureSize
export { calculateTextureSize }
