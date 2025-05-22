import AudioAnalyser from './AudioAnalyser'

class Audio {
	constructor() {
		this.volume = 0
		this.globalVolume = 1

		this.currentPlay = -1
		this.isPlaying = false
		this.isInit = false
	}

	//-------------------------------------------------------------------------- START : SETUP

	init() {
		this.isInit = true
		this.context = new ( window.AudioContext || window.webkitAudioContext )()
		this.masterGain = this.context.createGain()
		this.analyze()
	}

	analyze() {
		this.analyzer = new AudioAnalyser( this )
	}

	start( { onLoad = null, autoPlay = true, live = false, debug = false, playlist = ['audio/galvanize.mp3'], mute = false } = {} ) {
		if ( !this.isInit ) {
			this.init()
		}

		this.debug = debug
		this.playlist = playlist
		this.live = live
		this.autoPlay = autoPlay

		if ( !live ) {
			if ( !mute ) {
				this.masterGain.connect( this.context.destination )
			}
			this.playNext( onLoad )
		} else {
			navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia
			navigator.getUserMedia(
				{ audio: true, video: false },
				( stream ) => {
					let mediaStream = this.context.createMediaStreamSource( stream )
					let tracks = stream.getAudioTracks()
					mediaStream.connect( this.masterGain )
					if ( onLoad ) {
						onLoad()
					}
				},
				( e ) => console.log( 'fail load stream\n', e )
			)
		}
	}

	//-------------------------------------------------------------------------- PLAY / PAUSE / PLAYNEXT

	play = ( time = 0 ) => {
		if ( this.isPlaying ) {
			return
		}
		this.audio.play()
		this.audio.currentTime = time
		this.isPlaying = true
	}

	pause = () => {
		if ( !this.isPlaying ) {
			return
		}
		this.audio.pause()
		this.isPlaying = false
	}

	playNext = ( callback ) => {
		this.isPlaying = false
		this.currentPlay++
		this.currentPlay %= this.playlist.length

		this.audio = document.createElement( 'audio' )
		this.audio.src = this.playlist[this.currentPlay]
		this.audio.loop = false
		this.audio.addEventListener( 'ended', this.playNext )

		if ( this.audioSource ) {
			this.audioSource.disconnect( this.masterGain )
		}

		this.audioSource = this.context.createMediaElementSource( this.audio )
		this.audio.addEventListener( 'loadedmetadata', () => {
			if ( callback ) callback()
		} )
		this.audioSource.connect( this.masterGain )
		if ( this.autoPlay ) {
			this.play()
		}
	}

	//--------------------------------------------------------------------------- GETTER / SETTER

	get duration() {
		return this.audio ? this.audio.duration : 0
	}

	get currentTime() {
		return this.audio.currentTime
	}

	//---------------------------------------------------------------------------- MIDI

	connectToMidi = ( midi ) => {
		if ( midi.xl ) {
			midi.xl.add( this, 'globalVolume', 13, false ).minMax( 0, 5 )
			// midi.xl.add(this,'BEAT_DECAY_RATE',15,false).minMax(0.95,0.9999)
			// midi.xl.add(this,'BEAT_HOLD_TIME',14,false).minMax(0,1000)
		}
	}
}

const audio = new Audio()
export default audio
export { audio }
