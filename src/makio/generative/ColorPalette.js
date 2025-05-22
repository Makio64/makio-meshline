export function paletteFromUrl( _url ) {
	const slashIndex = _url.lastIndexOf( '/' )
	const pallateStr = _url.slice( slashIndex + 1 )
	const arr = pallateStr.split( '-' )
	for ( let i = 0; i < arr.length; i++ ) {
		arr[i] = '#' + arr[i]
	}
	return arr
}

export function paletteFromUrls( urls ) {
	let palette = []
	for ( let url of urls ) {
		palette.push( paletteFromUrl( url ) )
	}
	return palette
}
