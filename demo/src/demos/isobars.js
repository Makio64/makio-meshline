/**
 * Isobar Contours — marching-squares synoptic pressure contours morphing on the GPU.
 * Demonstrates: storagePositions( fromBuffer, { pointsPerLine, toBuffer, morph, closed: true } ),
 * .gpuPositionNode( fn ), .instances( capacity ), and a WebGL2 fallback through .lines( points ).
 */
import { MeshLine, storagePositions } from 'makio-meshline'
import { float, Fn, smoothstep, uniform } from 'three/tsl'
import { MathUtils, StorageBufferAttribute } from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import Isobars from '@/components/Isobars.vue'
import stage3d from '@/makio/three/stage3d'
import { noUI, reducedMotion } from '@/makio/utils/detect'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createChartFloor, createPairLookup, LINE_SEGMENTS, SYNOPTIC_STATES } from '@/utils/isobarsChart'

const POINTS_PER_LINE = LINE_SEGMENTS + 1
const STATE_COUNT = SYNOPTIC_STATES.length
const MORPH_DURATION = 2.6
const CYCLE_DURATION = MORPH_DURATION + 1.6 // Each state holds a moment before the next morph.

// There and back along each loop, so both ends of the gradient meet where the loop closes.
const periodicGradient = Fn( ( [factor] ) => float( 0.5 ).sub( factor.mul( Math.PI * 2 ).cos().mul( 0.5 ) ) )

// vec4 slots: three pads a vec3 storage buffer on its first upload, and this one is rewritten later.
function writePoints( { array }, points, lineIndex ) {
	for ( let point = 0, slot = lineIndex * POINTS_PER_LINE * 4; point < POINTS_PER_LINE; point++, slot += 4 ) {
		array[slot] = points[point * 3]
		array[slot + 1] = points[point * 3 + 1]
		array[slot + 2] = points[point * 3 + 2]
	}
}

// Contours sharing one style, each morphing between two sets of points.
class IsobarBank {
	constructor( morph, { capacity, color, gradientColor, lineWidth, opacity } ) {
		this.line = new MeshLine()
			.closed( true )
			.lineWidth( lineWidth )
			.color( color )
			.gradientColor( gradientColor )
			.gradientFn( periodicGradient )
			.opacity( opacity )
			.join( 'round' )
			.setFrustumCulled( false )
			.autoResize()

		if ( !stage3d.isWebGPU ) {
			this.line.dynamic( true )
			return
		}

		this.from = stage3d.own( new StorageBufferAttribute( capacity * POINTS_PER_LINE, 4 ) )
		this.to = stage3d.own( new StorageBufferAttribute( capacity * POINTS_PER_LINE, 4 ) )
		this.line
			.instances( capacity )
			.segments( LINE_SEGMENTS )
			.gpuPositionNode( storagePositions( this.from, {
				pointsPerLine: POINTS_PER_LINE,
				toBuffer: this.to,
				morph: smoothstep( 0, 1, morph ),
				closed: true,
				// One sample per stored point: read it, rather than blend it with its neighbour.
				snap: true,
			} ) )
			.build() // Before setTracks() lowers `count`, which build() resets to the capacity.
	}

	setTracks( tracks ) {
		this.tracks = tracks
		if ( !stage3d.isWebGPU ) {
			// What blendOnCPU() fills each frame: every point but the last one, a copy of the first that `closed` adds back.
			this.blended = tracks.map( () => new Float32Array( LINE_SEGMENTS * 3 ) )
			return
		}

		tracks.forEach( ( track, index ) => {
			writePoints( this.from, track.fromPoints, index )
			writePoints( this.to, track.toPoints, index )
		} )
		// Only the slots in use go to the GPU, not the whole capacity.
		for ( const buffer of [this.from, this.to] ) {
			buffer.clearUpdateRanges()
			buffer.addUpdateRange( 0, tracks.length * POINTS_PER_LINE * 4 )
			buffer.needsUpdate = true
		}
		this.line.count = tracks.length
	}

	// WebGL2 has no storage buffers: blend the points here, into the same arrays every frame.
	blendOnCPU( morph ) {
		const t = MathUtils.smoothstep( morph, 0, 1 )
		for ( let line = 0; line < this.tracks.length; line++ ) {
			const { fromPoints, toPoints } = this.tracks[line]
			const points = this.blended[line]
			for ( let i = 0; i < points.length; i++ ) points[i] = MathUtils.lerp( fromPoints[i], toPoints[i], t )
		}
		this.line.lines( this.blended )
	}
}

export default class IsobarsExample {
	uiComponent = markRaw( Isobars )
	ui = reactive( { visible: false, activeState: 0, percent: 0, playing: !reducedMotion.matches } )
	morph = uniform( 0 )
	fromIndex = 0
	toIndex = 1
	phaseTime = 0

	async init() {
		await stage3d.initRender( { background: 0x040914 } )
		stage3d.orbit( 17.5, { phi: 0.82, theta: 0, minRadius: 8, maxRadius: 24, maxPhi: Math.PI * 0.46 } )

		this.getPair = createPairLookup()
		this.primary = new IsobarBank( this.morph, { capacity: 20, color: 0xfff2bf, gradientColor: 0x7dd3fc, lineWidth: 0.11, opacity: 0.96 } )
		this.secondary = new IsobarBank( this.morph, { capacity: 36, color: 0x67e8f9, gradientColor: 0x38bdf8, lineWidth: 0.055, opacity: 0.58 } )
		stage3d.add( this.primary.line, this.secondary.line, createChartFloor() )

		createBloomPipeline( { strength: 0.45, radius: 0.3, threshold: 0.2 } )
		this.setPair( 0, 1 )
		this.ui.visible = !noUI
	}

	get nearestState() {
		return this.morph.value >= 0.5 ? this.toIndex : this.fromIndex
	}

	setPair( fromIndex, toIndex ) {
		this.fromIndex = fromIndex
		this.toIndex = toIndex
		this.pair = this.getPair( fromIndex, toIndex )
		this.primary.setTracks( this.pair.primary )
		this.secondary.setTracks( this.pair.secondary )
		this.setMorph( 0 )
		this.ui.activeState = fromIndex
	}

	setMorph( value ) {
		this.morph.value = value
		if ( !stage3d.isWebGPU ) {
			this.primary.blendOnCPU( value )
			this.secondary.blendOnCPU( value )
		}
		this.ui.percent = Math.round( value * 100 )
	}

	jumpToState( index ) {
		if ( index === this.toIndex && this.morph.value > 0.5 ) {
			this.scrub( 1 )
			return
		}
		const current = this.nearestState
		const previous = ( index + STATE_COUNT - 1 ) % STATE_COUNT
		this.phaseTime = 0
		this.setPair( current === index ? previous : current, index )
		this.ui.playing = true
	}

	scrub( value ) {
		this.ui.playing = false
		this.setMorph( value )
	}

	togglePlaying() {
		this.ui.playing = !this.ui.playing
	}

	update = dt => {
		if ( !this.ui.playing ) return

		this.phaseTime += dt * 0.001
		if ( this.phaseTime >= CYCLE_DURATION ) {
			this.phaseTime -= CYCLE_DURATION
			this.setPair( this.toIndex, ( this.toIndex + 1 ) % STATE_COUNT )
			return
		}
		const morph = Math.min( 1, this.phaseTime / MORPH_DURATION )
		// A state holds after its morph: nothing moves, so nothing is blended or uploaded again.
		if ( morph !== this.morph.value ) this.setMorph( morph )
		this.ui.activeState = this.nearestState
	}
}
