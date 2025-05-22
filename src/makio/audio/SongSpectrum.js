window.AudioContext = window.AudioContext || window.webkitAudioContext
let context = new AudioContext()

export default class SoungSpectrum {
	constructor( startTime = 0, duration = -1 ) {
		this.audioContext = context
		this.samplings = null
		this.buffer = null
		this.dom = null
		this.width = 1024
		this.height = 60
		this.startTime = startTime
		this.duration = duration
	}

	load = ( url, callback ) => {
		var req = new XMLHttpRequest()
		req.open( 'GET', url, true )
		req.responseType = 'arraybuffer'
		req.onreadystatechange = () => {
			if ( req.readyState == 4 ) {
				if ( req.status == 200 ) {
					this.audioContext.decodeAudioData(
						req.response,
						( buffer ) => {
							this.buffer = buffer
							this.sampleBuffer( buffer )
							this.drawOnCanvas()
							if ( callback ) {
								callback()
							}
						},
						( e ) => {
							console.warn( 'error while decoding', e )
						}
					)
				} else {
					console.warn( 'error during the loading' )
				}
			}
		}
		req.send()
		// this.drawOnCanvas()
		// if(callback){
		// 	callback()
		// }
	}

	sampleBuffer( buffer ) {
		var leftChannel = buffer.getChannelData( 0 )
		var originalDuration = buffer.duration

		const samplings = []

		let duration = this.duration != -1 ? this.duration : originalDuration
		let length = leftChannel.length

		if ( this.startTime != 0 && this.duration == -1 ) {
			duration -= this.startTime
		}

		let durationLength = length * ( duration / originalDuration )

		const step = Math.ceil( durationLength / this.width )

		let max = 0
		let offset = Math.floor( this.startTime / originalDuration ) * length

		for ( let i = 0; i < durationLength; i += step ) {
			let average = 0
			for ( let j = 0; j < step; j++ ) {
				if ( leftChannel[offset + i + j] ) {
					average += leftChannel[offset + i + j]
				} else {
					break
				}
			}
			average = Math.abs( average )
			max = Math.max( average, max )
			samplings.push( average )
		}

		for ( let i = 0; i < samplings.length; i++ ) {
			samplings[i] = samplings[i] / max
		}

		this.samplings = samplings
		return samplings
	}

	resize( width, height ) {
		this.width = width
		this.height = height
		if ( this.buffer ) {
			this.sampleBuffer( this.buffer )
			this.drawOnCanvas()
		}
	}

	drawOnCanvas( canvas = null ) {
		const WIDTH = this.width
		const HEIGHT = this.height

		if ( !canvas ) {
			if ( this.dom ) {
				canvas = this.dom
			} else {
				canvas = document.createElement( 'canvas' )
				canvas.className = 'songSpectrum'
			}
		}
		canvas.width = WIDTH
		canvas.height = HEIGHT

		const context = canvas.getContext( '2d' )
		context.clearRect( 0, 0, WIDTH, HEIGHT )
		context.strokeStyle = '#fff'
		context.translate( 0, HEIGHT / 2 )

		if ( this.samplings ) {
			for ( let i = 0; i < this.samplings.length; i++ ) {
				let x = Math.floor( ( WIDTH * i ) / this.samplings.length )
				let y = ( this.samplings[i] * HEIGHT ) / 2
				context.beginPath()
				context.moveTo( x, -y )
				context.lineTo( x + 1, y )
				context.stroke()
			}
		}

		this.dom = canvas
	}
}
