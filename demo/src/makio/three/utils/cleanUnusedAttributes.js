// Concept
// delete unused attributes base on the index
// Author : David Ronai / @makio64

export default function ( bufferGeometry ) {
	let index = bufferGeometry.index.array

	for ( let key in bufferGeometry.attributes ) {
		let attribute = bufferGeometry.attributes[key]
		let itemSize = attribute.itemSize
		let values = attribute.array

		let newValues = new Float32Array( index.length * itemSize )
		let idx = 0

		for ( let i = 0; i < index.length; i++ ) {
			for ( let j = 0; j < itemSize; j++ ) {
				newValues[idx] = values[index[i] * itemSize + j]
				idx++
			}
		}

		attribute.array = newValues
		attribute.count = index.length * itemSize
		attribute.needsUpdate = true
	}

	let indexTable = {}
	let k = 0
	for ( let i = 0; i < index.length; i++ ) {
		if ( indexTable[index[i]] == undefined ) {
			indexTable[index[i]] = k
			k++
		}
	}
	for ( let i = 0; i < index.length; i++ ) {
		index[i] = indexTable[i]
	}

	bufferGeometry.index.needsUpdate = true
}
