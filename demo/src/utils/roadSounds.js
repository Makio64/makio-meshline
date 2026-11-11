/**
 * Interface sounds for the road builder. Each cue is a short ElevenLabs sound
 * effect (Sound Effects v2, trimmed to its transient and levelled to about
 * -18 dBFS RMS) from `/sounds/road/`, fetched up front and decoded once the context
 * exists; until it is (or when it fails) the cue falls back to a few synthesized
 * oscillators or a burst of filtered noise.
 *
 * The context is only woken by a user gesture, so a cue fired while the page
 * loads (a restored road, a first plan) stays silent instead of playing late.
 */
const STORAGE_KEY = 'makio-meshline:road-sound'
const MASTER_GAIN = 0.32
const SAMPLE_GAIN = 0.9
const SAMPLE_URL = name => `/sounds/road/${name}.mp3`
// Per-cue level on top of the files' shared loudness, for cues heard far more often than others.
const SAMPLE_LEVELS = { step: 0.45, grab: 0.7, drop: 0.8, click: 0.8 }
// Pitched cues bend their sample's playback rate: a notch by where it sits, a structure by its level.
const SAMPLE_RATES = {
	step: ( amount = 0.5 ) => 0.82 + amount * 0.5,
	build: ( level = 0 ) => 2 ** ( level * 3 / 12 ),
}
// The same cue twice within this many seconds plays once: Random retries, key repeat, a fast slider.
const REPEAT_GAP = 0.035
// A route flickering in and out of tight under a drag warns once, not on every move.
const CUE_GAPS = { warn: 0.8 }

const readEnabled = () => {
	try {
		return localStorage.getItem( STORAGE_KEY ) !== 'off'
	} catch {
		return true
	}
}

const writeEnabled = enabled => {
	try {
		localStorage.setItem( STORAGE_KEY, enabled ? 'on' : 'off' )
	} catch {
		// Blocked storage only forgets the choice.
	}
}

const hasUserActivation = () => typeof navigator === 'undefined' || navigator.userActivation?.isActive !== false

export function createRoadSounds() {
	let ctx = null
	let master = null
	let noiseBuffer = null
	let enabled = readEnabled()
	let disposed = false
	const lastPlayed = new Map()
	// Encoded files start downloading now, without a context; they are decoded once one exists.
	const encoded = new Map()
	const samples = new Map()

	function ensureContext() {
		if ( ctx || disposed || typeof window === 'undefined' ) return ctx
		const AudioCtx = window.AudioContext || window.webkitAudioContext
		if ( !AudioCtx ) return null
		ctx = new AudioCtx()
		master = ctx.createGain()
		master.gain.value = MASTER_GAIN
		master.connect( ctx.destination )

		noiseBuffer = ctx.createBuffer( 1, ctx.sampleRate, ctx.sampleRate )
		const data = noiseBuffer.getChannelData( 0 )
		for ( let i = 0; i < data.length; i++ ) data[i] = Math.random() * 2 - 1

		for ( const [name, download] of encoded ) {
			download
				.then( bytes => bytes && ctx?.decodeAudioData( bytes ) )
				.then( buffer => buffer && samples.set( name, buffer ), () => {} )
		}
		return ctx
	}

	function fetchSample( name ) {
		if ( typeof fetch === 'undefined' ) return
		encoded.set( name, fetch( SAMPLE_URL( name ) )
			.then( response => {
				const type = response.headers.get( 'content-type' ) || ''
				// A missing file comes back as the app's HTML page, which is not a sound.
				return response.ok && /audio|octet-stream/.test( type ) ? response.arrayBuffer() : null
			} )
			.catch( () => null ) )
	}

	/** The cue's recorded sound, pitched for a cue that takes an argument. */
	function sample( name, buffer, args ) {
		const source = ctx.createBufferSource()
		const env = ctx.createGain()
		source.buffer = buffer
		source.playbackRate.value = SAMPLE_RATES[name]?.( ...args ) ?? 1
		env.gain.value = SAMPLE_GAIN * ( SAMPLE_LEVELS[name] ?? 1 )
		source.connect( env ).connect( master )
		source.start()
		source.onended = () => env.disconnect()
	}

	/** An oscillator gliding from `from` to `to` Hz under a fast attack and an exponential tail. */
	function tone( { type = 'sine', from, to = from, at = 0, duration, gain = 0.4, attack = 0.004 } ) {
		const start = ctx.currentTime + at
		const osc = ctx.createOscillator()
		const env = ctx.createGain()
		osc.type = type
		osc.frequency.setValueAtTime( from, start )
		if ( to !== from ) osc.frequency.exponentialRampToValueAtTime( to, start + duration * 0.8 )
		env.gain.setValueAtTime( 0.0001, start )
		env.gain.exponentialRampToValueAtTime( gain, start + attack )
		env.gain.exponentialRampToValueAtTime( 0.0001, start + duration )
		osc.connect( env ).connect( master )
		osc.start( start )
		osc.stop( start + duration + 0.02 )
		osc.onended = () => env.disconnect()
	}

	/** Noise through a band-pass whose centre sweeps from `from` to `to` Hz: air, not pitch. */
	function noise( { from, to = from, at = 0, duration, gain = 0.3, q = 1.2 } ) {
		const start = ctx.currentTime + at
		const source = ctx.createBufferSource()
		const filter = ctx.createBiquadFilter()
		const env = ctx.createGain()
		source.buffer = noiseBuffer
		filter.type = 'bandpass'
		filter.Q.value = q
		filter.frequency.setValueAtTime( from, start )
		filter.frequency.exponentialRampToValueAtTime( to, start + duration )
		env.gain.setValueAtTime( 0.0001, start )
		env.gain.exponentialRampToValueAtTime( gain, start + duration * 0.35 )
		env.gain.exponentialRampToValueAtTime( 0.0001, start + duration )
		source.connect( filter ).connect( env ).connect( master )
		source.start( start, Math.random() * 0.5 )
		source.stop( start + duration + 0.02 )
		source.onended = () => env.disconnect()
	}

	const CUES = {
		// Any plain button.
		click: () => tone( { type: 'triangle', from: 1900, to: 1500, duration: 0.045, gain: 0.22 } ),
		// A switch turned on climbs, turned off falls.
		on: () => {
			tone( { type: 'triangle', from: 740, duration: 0.06, gain: 0.2 } )
			tone( { type: 'triangle', from: 1110, at: 0.055, duration: 0.09, gain: 0.22 } )
		},
		off: () => {
			tone( { type: 'triangle', from: 1110, duration: 0.06, gain: 0.2 } )
			tone( { type: 'triangle', from: 740, at: 0.055, duration: 0.09, gain: 0.18 } )
		},
		// A point appears: a bubble that pops upwards, with a glint on top.
		add: () => {
			tone( { from: 260, to: 920, duration: 0.16, gain: 0.5, attack: 0.006 } )
			tone( { type: 'triangle', from: 1840, to: 2200, at: 0.05, duration: 0.12, gain: 0.12 } )
		},
		// A point goes: the same bubble sucked back down, with a puff of air.
		remove: () => {
			tone( { from: 820, to: 170, duration: 0.17, gain: 0.45 } )
			noise( { from: 1800, to: 400, duration: 0.14, gain: 0.12, q: 0.8 } )
		},
		// Picking a point up and setting it down.
		grab: () => tone( { type: 'triangle', from: 520, to: 640, duration: 0.05, gain: 0.2 } ),
		drop: () => tone( { from: 360, to: 210, duration: 0.09, gain: 0.32 } ),
		// One notch of a dragged height or bank, pitched by where the value sits in its range.
		step: ( amount = 0.5 ) => tone( { type: 'triangle', from: 600 + amount * 900, duration: 0.025, gain: 0.08, attack: 0.002 } ),
		// The editor refused: no more points, or too few to make a loop.
		deny: () => {
			tone( { type: 'square', from: 190, duration: 0.07, gain: 0.07 } )
			tone( { type: 'square', from: 160, at: 0.085, duration: 0.09, gain: 0.07 } )
		},
		// The route turned too tight to build.
		warn: () => {
			tone( { type: 'triangle', from: 660, duration: 0.1, gain: 0.18 } )
			tone( { type: 'triangle', from: 622, at: 0.11, duration: 0.16, gain: 0.18 } )
		},
		// A whole new road sweeps in.
		whoosh: () => {
			noise( { from: 280, to: 2600, duration: 0.42, gain: 0.32, q: 1.4 } )
			tone( { from: 180, to: 420, duration: 0.3, gain: 0.12 } )
		},
		// The camera moves to another view or car.
		swish: () => noise( { from: 900, to: 3200, duration: 0.22, gain: 0.2, q: 2 } ),
		// The structure steps up a level; `level` 0 is the bare ribbon.
		build: ( level = 0 ) => {
			const base = 330 * 2 ** ( level * 4 / 12 )
			tone( { type: 'triangle', from: base, duration: 0.08, gain: 0.2 } )
			tone( { from: base * 1.5, at: 0.06, duration: 0.14, gain: 0.18 } )
			noise( { from: 1400, duration: 0.06, gain: 0.08, q: 3 } )
		},
		// A road saved: a small two-note chime.
		save: () => {
			tone( { from: 988, duration: 0.22, gain: 0.22 } )
			tone( { from: 1480, at: 0.09, duration: 0.34, gain: 0.2 } )
		},
	}

	function render( name, args ) {
		const now = ctx.currentTime
		if ( now - ( lastPlayed.get( name ) ?? -Infinity ) < ( CUE_GAPS[name] ?? REPEAT_GAP ) ) return
		lastPlayed.set( name, now )
		const buffer = samples.get( name )
		if ( buffer ) sample( name, buffer, args )
		else CUES[name]( ...args )
	}

	for ( const name of Object.keys( CUES ) ) fetchSample( name )

	return {
		get enabled() {
			return enabled
		},

		play( name, ...args ) {
			if ( !enabled || !CUES[name] || !ensureContext() ) return
			if ( ctx.state === 'running' ) {
				render( name, args )
				return
			}
			// Only a gesture can wake the context, and a cue it did not ask for is dropped rather than played late.
			if ( !hasUserActivation() ) return
			ctx.resume().then( () => ctx && render( name, args ), () => {} )
		},

		toggle() {
			enabled = !enabled
			writeEnabled( enabled )
			if ( enabled ) this.play( 'on' )
			return enabled
		},

		dispose() {
			disposed = true
			ctx?.close().catch( () => {} )
			ctx = null
		},
	}
}
