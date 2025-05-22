export default function ( json ) {
	const sortedJSON = {}
	const keys = Object.keys( json ).sort()

	for ( const key of keys ) {
		sortedJSON[key] = json[key]
	}

	return sortedJSON
}
