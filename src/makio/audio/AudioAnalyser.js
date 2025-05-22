import FrequencyRangeAnalyser from './FrequencyRangeAnalyser'
import { isMobile } from '@/makio/utils/detect'
import stage from '@/makio/core/stage'

export default class AudioAnalyser {
	constructor( audio, createGlobalRange = true, autoCute = 8 ) {
		this.audio = audio

		this.analyser = audio.context.createAnalyser()
		this.analyser.smoothingTimeConstant = 0.3
		this.analyser.fftSize = isMobile ? 256 : 512

		this.binCount = this.analyser.frequencyBinCount
		this.freqByteData = new Uint8Array( this.binCount )
		this.timeByteData = new Uint8Array( this.binCount )

		audio.masterGain.connect( this.analyser )

		this.updateFreq = true
		this.updateWave = false

		this.ranges = []

		if ( createGlobalRange ) {
			this.globalRange = new FrequencyRangeAnalyser( 0, this.binCount, this )
			audio.onBeat = this.globalRange.onBeat
		}

		if ( autoCute > 0 ) {
			let step = Math.floor( this.binCount / autoCute )
			let s = 0
			for ( let i = 0; i < autoCute; i++ ) {
				this.addRangeAnalyzer( s, s + step )
				s += step
			}
		}

		stage.onRender.add( this.update )
	}

	addRangeAnalyzer( start, end ) {
		let range = new FrequencyRangeAnalyser( start, end, this )
		this.ranges.push( range )
	}

	update = ( dt ) => {
		if ( this.updateFreq ) {
			this.analyser.getByteFrequencyData( this.freqByteData )
		}

		if ( this.updateWave ) {
			this.analyser.getByteTimeDomainData( this.timeByteData )
			for ( let i = 0; i < this.analyser.frequencyBinCount; i++ ) {
				this.waveData[i] = ( this.timeByteData[i] - 128 ) / 128
			}
		}

		if ( this.globalRange ) {
			this.globalRange.update( dt )
			this.volume = this.audio.volume = this.globalRange.volume * this.audio.globalVolume
		}

		for ( let r of this.ranges ) {
			r.update( dt )
		}

		if ( this.debuger ) {
			this.debuger.draw()
		}
	}

	dispose = () => {
		for ( let r of this.ranges ) {
			r.dispose()
		}
		this.ranges = null

		this.audio.masterGain.connect( this.analyser )
		this.audio = null

		stage.onRender.remove( this.update )
	}
}
