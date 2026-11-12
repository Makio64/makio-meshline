/**
 * Multi-channel wind-tunnel soundscape: four synchronized stereo stems
 * (sub-blower turbine, laminar airflow rush, high-velocity aero shear, and
 * acceleration spool-up / crosswind buffet) whose pitch, filter cutoff, stereo
 * field and mix follow the wind speed (80–500 km/h) and its rate of change.
 *
 * Automatically hot-swaps in ElevenLabs stems from `/sounds/wind-*.mp3` when
 * present, and synthesizes seamless stereo loop buffers out of the box.
 */
import { MathUtils } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

const STEMS = [
	{ id: 'low', url: '/sounds/wind-low.mp3', filter: 'lowpass', baseFreq: 75, spanFreq: 140, q: 0.9 },
	{ id: 'mid', url: '/sounds/wind-mid.mp3', filter: 'bandpass', baseFreq: 260, spanFreq: 820, q: 0.7 },
	{ id: 'high', url: '/sounds/wind-high.mp3', filter: 'bandpass', baseFreq: 950, spanFreq: 3400, q: 1.4 },
	{ id: 'accel', url: '/sounds/wind-accel.mp3', filter: 'bandpass', baseFreq: 420, spanFreq: 1850, q: 1.1 },
]

const LOOP_SECONDS = 6

export function createWindTunnelAudio( onStateChange ) {
	let ctx = null
	let master = null
	let channels = null
	let enabled = true
	let unlocked = false
	let disposed = false
	let prevWind = 1
	let smoothedAccel = 0

	// Build a seamless 6-second stereo loop buffer for `kind` using crossfaded
	// pink/brown/harmonic noise so loop boundaries have zero click.
	function synthesizeStem( audioCtx, kind ) {
		const sampleRate = audioCtx.sampleRate
		const length = sampleRate * LOOP_SECONDS
		const fade = Math.floor( sampleRate * 0.75 )
		const buffer = audioCtx.createBuffer( 2, length, sampleRate )

		for ( let ch = 0; ch < 2; ch++ ) {
			const out = buffer.getChannelData( ch )
			const raw = new Float32Array( length + fade )
			let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, brown = 0
			let seed = ( ch + 1 ) * 16807 + kind.charCodeAt( 0 ) * 997

			const rand = () => {
				seed = ( seed * 16807 ) % 2147483647
				return ( seed / 1073741823.5 ) - 1
			}

			for ( let i = 0; i < raw.length; i++ ) {
				const t = i / sampleRate
				const w = rand()
				b0 = 0.99886 * b0 + w * 0.0555179
				b1 = 0.99332 * b1 + w * 0.0750759
				b2 = 0.96900 * b2 + w * 0.1538520
				b3 = 0.86650 * b3 + w * 0.3104856
				b4 = 0.55000 * b4 + w * 0.5329522
				b5 = -0.7616 * b5 - w * 0.0168980
				const pink = ( b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362 ) * 0.045
				brown = ( brown + w * 0.02 ) * 0.996

				if ( kind === 'low' ) {
					// Deep tunnel fan: brown rumble + 2nd/3rd blade-pass harmonics.
					const blade = Math.sin( t * Math.PI * 2 * 52 + ch * 0.4 ) * 0.18
						+ Math.sin( t * Math.PI * 2 * 104 + Math.sin( t * Math.PI * 2 / LOOP_SECONDS ) * 0.5 ) * 0.09
					raw[i] = brown * 0.55 + pink * 0.35 + blade
				} else if ( kind === 'mid' ) {
					// Smooth laminar air sheet with slow stereo pressure waves.
					const swell = 0.82 + 0.18 * Math.sin( ( t / LOOP_SECONDS ) * Math.PI * 4 + ch * 1.3 )
					raw[i] = ( pink * 0.8 + brown * 0.25 ) * swell
				} else if ( kind === 'high' ) {
					// High-speed boundary shear + subtle canopy edge whistle harmonics.
					const whistle = Math.sin( t * Math.PI * 2 * 1480 + pink * 1.8 ) * 0.06
						+ Math.sin( t * Math.PI * 2 * 2220 + brown * 1.4 ) * 0.035
					raw[i] = ( w * 0.08 + pink * 0.72 + whistle )
				} else {
					// Turbine spool-up / wake buffet with rhythmic vortex shedding pulses.
					const pulse = 0.7 + 0.3 * Math.sin( ( t / LOOP_SECONDS ) * Math.PI * 10 + ch * 0.8 )
					raw[i] = ( pink * 0.75 + brown * 0.35 ) * pulse
				}
			}

			// Equal-power crossfade of the tail into the head for a seamless loop.
			for ( let i = 0; i < length; i++ ) {
				if ( i < fade ) {
					const a = i / fade
					out[i] = raw[i] * Math.sin( a * Math.PI * 0.5 ) + raw[length + i] * Math.cos( a * Math.PI * 0.5 )
				} else {
					out[i] = raw[i]
				}
			}
		}

		return buffer
	}

	function startSource( channel, buffer ) {
		if ( disposed || !ctx ) return
		if ( channel.source ) {
			try { channel.source.stop() } catch {}
			channel.source.disconnect()
		}
		const source = ctx.createBufferSource()
		source.buffer = buffer
		source.loop = true
		source.playbackRate.value = channel.rate
		source.connect( channel.filter )
		source.start( 0, ( Math.random() * buffer.duration ) % buffer.duration )
		channel.source = source
	}

	async function loadExternalStem( channel ) {
		try {
			const response = await fetch( channel.url )
			if ( !response.ok ) return
			const contentType = response.headers.get( 'content-type' ) || ''
			if ( !contentType.includes( 'audio' ) && !contentType.includes( 'octet-stream' ) ) return
			const arrayBuffer = await response.arrayBuffer()
			if ( disposed || !ctx || arrayBuffer.byteLength < 1024 ) return
			const decoded = await ctx.decodeAudioData( arrayBuffer )
			if ( !disposed ) startSource( channel, decoded )
		} catch {
			// Synthesized stem stays active when no external MP3 is present.
		}
	}

	function ensureGraph() {
		if ( ctx || disposed || typeof window === 'undefined' ) return
		const AudioCtx = window.AudioContext || window.webkitAudioContext
		if ( !AudioCtx ) return

		ctx = new AudioCtx()
		master = ctx.createGain()
		master.gain.value = 0
		master.connect( ctx.destination )

		channels = STEMS.map( stem => {
			const filter = ctx.createBiquadFilter()
			filter.type = stem.filter
			filter.frequency.value = stem.baseFreq
			filter.Q.value = stem.q

			const panner = ctx.createStereoPanner()
			const gain = ctx.createGain()
			gain.gain.value = 0

			filter.connect( panner )
			panner.connect( gain )
			gain.connect( master )

			const channel = { ...stem, filter, panner, gain, source: null, rate: 1 }
			startSource( channel, synthesizeStem( ctx, stem.id ) )
			loadExternalStem( channel )
			return channel
		} )
	}

	function unlock() {
		if ( disposed ) return
		ensureGraph()
		if ( ctx && ctx.state === 'suspended' ) {
			ctx.resume().catch( () => {} )
		}
		unlocked = true
		onStateChange?.( enabled )
	}

	if ( typeof window !== 'undefined' ) {
		stage3d.listen( window, 'pointerdown', unlock, { passive: true } )
		stage3d.listen( window, 'keydown', unlock, { passive: true } )
	}

	const api = {
		get enabled() { return enabled },
		toggle() {
			ensureGraph()
			if ( !unlocked ) {
				enabled = true
				unlock()
			} else {
				enabled = !enabled
				if ( enabled && ctx?.state === 'suspended' ) ctx.resume().catch( () => {} )
			}
			if ( master && ctx ) {
				master.gain.setTargetAtTime( enabled ? 0.55 : 0, ctx.currentTime, 0.08 )
			}
			onStateChange?.( enabled )
			return enabled
		},
		update( dt, wind, targetWind, crosswind, rakeX ) {
			if ( !ctx || !channels || ! unlocked || disposed ) return
			const now = ctx.currentTime
			const seconds = Math.max( dt * 0.001, 0.001 )

			// 80 km/h (wind = 0.4) → 0, 500 km/h (wind = 2.5) → 1.
			const speed01 = MathUtils.clamp( ( wind * 200 - 80 ) / ( 500 - 80 ), 0, 1 )
			const rawDelta = ( wind - prevWind ) / seconds
			prevWind = wind

			// Combine instantaneous velocity change and remaining slider target gap
			// so the turbine spools up audibly the moment the slider moves.
			const targetGap = targetWind - wind
			const instantAccel = MathUtils.clamp( Math.abs( rawDelta ) * 0.9 + Math.abs( targetGap ) * 0.85, 0, 1.5 )
			smoothedAccel = MathUtils.damp( smoothedAccel, instantAccel, 8, seconds )
			const signedPull = MathUtils.clamp( targetGap * 0.6 + rawDelta * 0.4, -0.6, 0.8 )
			const yaw = MathUtils.clamp( crosswind / 1.35, 0, 1 )

			master.gain.setTargetAtTime( enabled ? 0.55 : 0, now, 0.08 )

			const [low, mid, high, accel] = channels

			// Ch 1 (low): sub-blower turbine drone — anchors low speed, rises in pitch.
			low.rate = 0.72 + speed01 * 0.82 + signedPull * 0.14
			low.source?.playbackRate.setTargetAtTime( low.rate, now, 0.06 )
			low.filter.frequency.setTargetAtTime( low.baseFreq + speed01 * low.spanFreq + smoothedAccel * 45, now, 0.06 )
			low.gain.gain.setTargetAtTime( 0.24 + speed01 * 0.26 + smoothedAccel * 0.12, now, 0.06 )
			low.panner.pan.setTargetAtTime( rakeX * 0.15, now, 0.08 )

			// Ch 2 (mid): laminar tunnel airflow rush — sweeps bandpass across the body.
			mid.rate = 0.78 + speed01 * 0.96 + signedPull * 0.2
			mid.source?.playbackRate.setTargetAtTime( mid.rate, now, 0.06 )
			mid.filter.frequency.setTargetAtTime( mid.baseFreq + speed01 * mid.spanFreq + smoothedAccel * 180, now, 0.06 )
			mid.gain.gain.setTargetAtTime( 0.16 + Math.pow( speed01, 0.75 ) * 0.34, now, 0.06 )
			mid.panner.pan.setTargetAtTime( MathUtils.clamp( rakeX * 0.45 - yaw * 0.25, -0.8, 0.8 ), now, 0.08 )

			// Ch 3 (high): high-velocity boundary shear & canopy whistle (200–500 km/h).
			const highCurve = Math.pow( speed01, 1.45 )
			high.rate = 0.84 + speed01 * 1.28 + signedPull * 0.28
			high.source?.playbackRate.setTargetAtTime( high.rate, now, 0.05 )
			high.filter.frequency.setTargetAtTime( high.baseFreq + highCurve * high.spanFreq + smoothedAccel * 420, now, 0.05 )
			high.gain.gain.setTargetAtTime( 0.03 + highCurve * 0.42 + Math.max( 0, signedPull ) * 0.14, now, 0.05 )
			high.panner.pan.setTargetAtTime( MathUtils.clamp( -rakeX * 0.35 + yaw * 0.3, -0.8, 0.8 ), now, 0.08 )

			// Ch 4 (accel): turbine spool-up transient & crosswind wake buffet.
			accel.rate = 0.8 + speed01 * 1.15 + Math.max( 0, signedPull ) * 0.45
			accel.source?.playbackRate.setTargetAtTime( accel.rate, now, 0.04 )
			accel.filter.frequency.setTargetAtTime( accel.baseFreq + speed01 * accel.spanFreq + smoothedAccel * 600, now, 0.04 )
			accel.gain.gain.setTargetAtTime( smoothedAccel * 0.46 + yaw * 0.22 + Math.pow( speed01, 2 ) * 0.18, now, 0.04 )
			accel.panner.pan.setTargetAtTime( MathUtils.clamp( yaw * 0.55 + rakeX * 0.3, -0.9, 0.9 ), now, 0.06 )
		},
		dispose() {
			disposed = true
			if ( channels ) {
				for ( const ch of channels ) {
					try { ch.source?.stop() } catch {}
					ch.source?.disconnect()
					ch.filter.disconnect()
					ch.panner.disconnect()
					ch.gain.disconnect()
				}
				channels = null
			}
			if ( ctx ) {
				ctx.close().catch( () => {} )
				ctx = null
			}
		},
	}

	return stage3d.own( api )
}
