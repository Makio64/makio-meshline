import { randomBetween } from '../../utils/random'
import { Float32BufferAttribute } from 'three'

//item size : 2 for vec2, 3for vec3 etc..
//count number of item
export default function ( bufferGeometry, attributeName, min, max, itemSize = 1, count = -1 ) {
	if ( count == -1 ) {
		count = bufferGeometry.attributes.position.count
	}
	let array = new Float32Array( count * itemSize )
	let k = 0
	for ( let i = 0; i < count; i++ ) {
		k = i * itemSize
		for ( let j = 0; j < itemSize; j++ ) {
			array[k + j] = randomBetween( min, max )
		}
	}
	bufferGeometry.setAttribute( attributeName, new Float32BufferAttribute( array, itemSize ) )
	bufferGeometry.attributes[attributeName].needsUpdate = true
}
