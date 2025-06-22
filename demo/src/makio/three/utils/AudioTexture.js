import { UVMapping, NearestFilter, RepeatWrapping, FloatType, DataTexture, LuminanceFormat } from 'three'

// Helper to convert an array data from audio source to a Texture and keep a trace in time
export default class AudioTexture extends DataTexture {
	constructor( { length = 128, history = 128 } = {} ) {
		const data = new Float32Array( length * history )

		for ( let i = 0; i < data.length; i++ ) {
			data[i] = 0.1
		}

		super( data, length, history, LuminanceFormat, FloatType, UVMapping, RepeatWrapping, RepeatWrapping, NearestFilter, NearestFilter, 1 )

		this.data = data
		this.length = length
		this.history = history

		this.needsUpdate = true
	}

	update = ( data, isPercent = false ) => {
		const width = this.length
		for ( let col = 0; col < this.length; col++ ) {
			let row = this.history + 1
			while ( --row > -1 ) {
				let idxDataCurr = row * width + col
				let idxDataPrev = ( row - 1 ) * width + col
				this.data[idxDataCurr] = this.data[idxDataPrev]
			}
		}

		const divideBy = isPercent ? 1 : 255
		for ( let i = 0; i < data.length; i++ ) {
			this.data[i] = data[i] / divideBy
		}

		this.needsUpdate = true
	}
}

export { AudioTexture }
