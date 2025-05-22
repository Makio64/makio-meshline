import Signal from '@/makio/core/Signal'

export default class FrequencyRangeAnalyser {
	constructor( start, end, analyzer ) {
		this.BEAT_HOLD_TIME = 300
		this.BEAT_DECAY_RATE = 0.992
		this.BEAT_MIN = 0.1

		this.start = start
		this.end = end
		this.analyzer = analyzer

		this.volume = 0
		this.beatCutOff = 0
		this.beatTime = 0
		this.lastBeat = 0

		this.onBeat = new Signal()
	}

	update = ( dt, freqByteData ) => {
		this.volume = 0

		for ( let i = this.start; i < this.end; i++ ) {
			this.volume += this.analyzer.freqByteData[i]
		}
		this.volume /= ( this.end - this.start ) * 256

		this.detectBeat( dt )
	}

	detectBeat = ( dt ) => {
		if ( this.beatTime >= this.BEAT_HOLD_TIME && this.volume > this.beatCutOff && this.volume > this.BEAT_MIN ) {
			this.onBeat.dispatch()
			this.beatCutOff = this.volume * 1.15
			this.lastBeat = this.beatCutOff
			this.beatTime = 0
		} else {
			if ( this.beatTime <= this.BEAT_HOLD_TIME ) {
				this.beatTime += dt
			} else {
				this.beatCutOff *= this.BEAT_DECAY_RATE
				this.beatCutOff = Math.max( this.beatCutOff, this.BEAT_MIN )
			}
		}
	}
}
