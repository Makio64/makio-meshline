import random from '../../utils/random'
import { BufferAttribute, BufferGeometry as Buffer } from 'three'

export default class BufferGeometry extends Buffer {
	constructor() {
		super()
	}

	addAttributeFill( name, length, min, max, count ) {
		if ( !count ) {
			count = this.count
		}
		let array = new Float32Array( count * length )
		let k = 0
		for ( let i = 0; i < count; i++ ) {
			k = i * length
			for ( let j = 0; j < length; j++ ) {
				array[k + j] = random() * ( max - min ) + min
			}
		}
		this.setAttribute( name, new BufferAttribute( array, length ) )
		this.attributes[name].needsUpdate = true
	}
}
