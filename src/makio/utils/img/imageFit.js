const imageFit = function ( wImg, hImg, wHolder, hHolder, isFull = false ) {
	const sw = wImg / wHolder
	const sh = hImg / hHolder

	let ratio = 0
	if ( isFull ) {
		if ( sw < sh ) {
			ratio = sh
		} else {
			ratio = sw
		}
	} else {
		if ( sw > sh ) {
			ratio = sh
		} else {
			ratio = sw
		}
	}
	ratio = 1 / ratio

	const w = wImg * ratio
	const h = hImg * ratio
	const x = ( wHolder - w ) >> 1
	const y = ( hHolder - h ) >> 1

	return { x: x, y: y, width: w, height: h }
}

export default imageFit
export { imageFit }
