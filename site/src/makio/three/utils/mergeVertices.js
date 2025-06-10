// Concept
// merge vertices, it doesnt delete the unused attributes
// Author : David Ronai / @makio64

export default function ( bufferGeometry ) {
	let positions = bufferGeometry.attributes.position.array

	let npositions = []

	let nindex = []
	let k = 0
	for ( let i = 0; i < positions.length / 3; i++ ) {
		let x = positions[i * 3]
		let y = positions[i * 3 + 1]
		let z = positions[i * 3 + 2]
		let found = false
		for ( let j = 0; j < npositions.length; j++ ) {
			let p = npositions[j]
			let dx = x - p.x
			let dy = y - p.y
			let dz = z - p.z
			let distance = dx * dx + dy * dy + dz * dz
			if ( distance < 0.01 ) {
				nindex[i] = p.idx
				found = true
				k++
				break
			}
		}
		if ( !found ) {
			npositions.push( { idx: i, x: x, y: y, z: z } )
			nindex[i] = i
		}
	}

	let index = bufferGeometry.index.array
	for ( let i = 0; i < index.length; i++ ) {
		index[i] = nindex[index[i]]
	}
	bufferGeometry.index.needsUpdate = true
}
