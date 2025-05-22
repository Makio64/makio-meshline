import { addAbsolute } from 'mnf/utils/dom'
import dragndropEl from 'mnf/utils/dragndropEl'

const MARGIN = 3
const H_INFO_BAR = 12
const H_BEAT_BAR = 20
const W_BAR = 50
const SPACE_BAR = 1
const MAIN_BEAT_WIDTH = 50

export default class AudioDebuger {
	constructor( analyser, width = 250, height = 50 ) {
		this.analyser = analyser
		this.width = width
		this.height = height

		this.canvas = document.createElement( 'canvas' )
		this.canvas.width = width
		this.canvas.height = height

		this.ctx = this.canvas.getContext( '2d' )
		this.ctx.font = '9px Arial'

		addAbsolute( this.canvas )

		new dragndropEl( this.canvas, document.body, 'audio-debugger' )
	}

	draw() {
		this.ctx.clearRect( 0, 0, this.width, this.height )

		this.ctx.fillStyle = '#2c3e50'
		this.ctx.fillRect( 0, 0, this.canvas.width, this.canvas.height )

		let x = MARGIN
		this.drawRange( x, MAIN_BEAT_WIDTH, this.analyser.globalRange, 'vol ' + parseFloat( this.analyser.audio.volume ).toFixed( 2 ) )

		if ( this.analyser.ranges.length > 0 ) {
			x += MARGIN + MAIN_BEAT_WIDTH
			let totalWidth = this.width - x
			let width = totalWidth / this.analyser.ranges.length - MARGIN
			let k = -1
			for ( let r of this.analyser.ranges ) {
				this.drawRange( x, width, r, ++k )
				x += width + MARGIN
			}
		}
	}

	drawRange( x, width, range, text = null ) {
		let h = 0,
			barH = this.height - MARGIN * 2

		this.ctx.beginPath()
		this.ctx.rect( x, MARGIN, width, barH )
		this.ctx.fillStyle = '#34495e'
		this.ctx.fill()

		this.ctx.beginPath()
		this.ctx.fillStyle = '#2980b9'
		h = this.getHCutOff( range )
		this.ctx.rect( x, barH + MARGIN - h, width, h )
		this.ctx.fill()

		this.ctx.beginPath()
		h = this.getHVolume( range )
		this.ctx.rect( x, barH + MARGIN - h, width, h )
		this.ctx.fillStyle = '#3498db'
		this.ctx.fill()

		if ( text != null ) {
			this.ctx.fillStyle = 'rgba(0,0,0,1)'
			this.ctx.fillText( text, x + 1, this.height - MARGIN - 1 )
		}
	}

	getHCutOff( frequencyRange ) {
		if ( frequencyRange.lastBeat == 0 || frequencyRange.beatCutOff == 0 ) return 0
		return Math.max( ( frequencyRange.beatCutOff / frequencyRange.lastBeat ) * this.height - MARGIN * 2, 0 )
	}

	getHVolume( frequencyRange ) {
		if ( frequencyRange.lastBeat == 0 || frequencyRange.volume == 0 ) return 0
		return Math.max( ( frequencyRange.volume / frequencyRange.lastBeat ) * this.height - MARGIN * 2, 0 )
	}

	show() {
		if ( this.canvas.parentNode ) {
			return
		}
		document.body.appendChild( this.canvas )
	}

	hide() {
		if ( !this.canvas.parentNode ) {
			return
		}
		document.body.removeChild( this.canvas )
	}
}
