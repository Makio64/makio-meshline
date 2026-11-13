/**
 * Venus & David: morphs 64 instanced contour rings between two BVH-sampled
 * classical sculptures on the GPU using 2D float `DataTexture` lookups.
 *
 * Key APIs:
 * - `.instances( RINGS ).segments( SAMPLES ).closed( true )`
 * - `.gpuPositionNode()` sampling two `DataTexture` buffers and blending by `morph`
 * - `.colorFn()`, `.opacityFn()`, and `.widthFn()` driven by `instanceIndex`
 */
import { animate, utils } from 'animejs'
import { MeshLine } from 'makio-meshline'
import { attribute, float, Fn, fract, instanceIndex, mix, texture, uniform, vec2, vec3 } from 'three/tsl'
import { ACESFilmicToneMapping, DataTexture, FloatType, RepeatWrapping, RGBAFormat } from 'three/webgpu'
import { markRaw } from 'vue'

import Venus from '@/components/Venus.vue'
import stage3d from '@/makio/three/stage3d'
import { backInOut } from '@/makio/tsl/easing'
import { isMobile } from '@/makio/utils/detect'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { sampleContourRings } from '@/utils/venusContourRings'

const RINGS = 64
const SAMPLES = isMobile ? 64 : 96

// Theta A keeps an extra turn, so morphing swings the camera around the statue.
const DAVID_AND_VENUS = { models: ['david', 'venus'], thetaA: 2.3 + Math.PI * 2, thetaB: 2.3 }
const AURELIUS_AND_NEFERTITI = { models: ['aurelius', 'nefertiti'], thetaA: 1.8 + Math.PI * 2, thetaB: 2.6 + Math.PI }

// One row per ring, one texel per sample: what `gpuPositionNode` reads back.
const createRingTexture = rings => {
	const texels = rings.flatMap( ring => ring.points ).flatMap( ( { x, y, z } ) => [x, y, z, 0] )
	const map = stage3d.own( new DataTexture( new Float32Array( texels ), SAMPLES, RINGS, RGBAFormat, FloatType ) )
	map.wrapS = RepeatWrapping
	map.needsUpdate = true
	return texture( map )
}

// Rises from 0 to 1 and back over the morph.
const swell = percent => percent.sub( 0.5 ).abs().mul( 2 ).oneMinus().abs()

export default class VenusExample {
	uiComponent = markRaw( Venus )
	morph = uniform( 0 )
	opacity = uniform( 0 )
	pair = new URLSearchParams( window.location.search ).has( 'cleopatra' ) ? AURELIUS_AND_NEFERTITI : DAVID_AND_VENUS

	async init() {
		await stage3d.initRender()
		const control = stage3d.orbit( 16, { theta: this.pair.thetaA, minRadius: 6, maxRadius: 30 } )
		stage3d.own( () => utils.remove( [this.opacity, this.morph, control] ) )

		const [ringsA, ringsB] = await sampleContourRings( this.pair.models, RINGS, SAMPLES )
		stage3d.renderer.toneMapping = ACESFilmicToneMapping
		this.createLine( ringsA, ringsB )
		createBloomPipeline( { strength: 0.5, radius: 0.01, threshold: 0.4, resolutionScale: 1 } )

		// Render one hidden frame and wait for the GPU: the reveal then starts with every
		// pipeline compiled instead of running while the first image is still on its way.
		stage3d.render()
		await stage3d.renderer.backend.device?.queue.onSubmittedWorkDone()
		animate( this.opacity, { value: 1, duration: 1.8, delay: 0.02, ease: 'outExpo' } )
	}

	createLine( ringsA, ringsB ) {
		const texA = createRingTexture( ringsA )
		const texB = createRingTexture( ringsB )
		const ringAlpha = attribute( 'ringAlpha', 'vec2' )
		const ringY = float( instanceIndex ).div( RINGS ) // 0 -> 1
		const ringV = ringY.add( 0.5 / RINGS ) // Middle of the ring's texture row

		// The morph climbs the statue: each ring starts a little after the one below.
		const percent = Fn( () => backInOut( this.morph.mul( 2 ).sub( ringY ).clamp() ).toVar() )()
		const alpha = mix( ringAlpha.x, ringAlpha.y, percent )

		const line = new MeshLine()
			.instances( RINGS )
			.segments( SAMPLES )
			.closed( true )
			.transparent( true )
			.lineWidth( 0.02 )
			.gpuPositionNode( Fn( ( [progress] ) => {
				const uv = vec2( fract( progress ), ringV )
				const bulge = swell( percent.clamp() ).toVar()
				const pos = mix( texA.sample( uv ).xyz, texB.sample( uv ).xyz, percent )
				pos.xz.mulAssign( bulge.mul( 0.6 ).add( 1 ) )
				return pos
			} ) )
			.colorFn( Fn( () => vec3( 1, ringY.smoothstep( 0, 1 ), percent.smoothstep( 0, 0.5 ) ).mul( alpha ) ) )
			.opacityFn( Fn( () => {
				const fade = this.opacity.oneMinus()
				return ringV.oneMinus().smoothstep( fade.sub( 0.1 ), fade )
			} ) )
			.widthFn( Fn( ( [width] ) => width.add( swell( percent ).mul( 0.1 ) ).mul( alpha ) ) )
			.autoResize()

		line.addInstanceAttribute( 'ringAlpha', 2 )
		line.setInstanceValues( 'ringAlpha', ringsA.flatMap( ( ring, index ) => [ring.alpha, ringsB[index].alpha] ) )
		stage3d.add( line )
	}

	morphTo( value, theta ) {
		animate( this.morph, { value, duration: 2, ease: 'linear' } )
		animate( stage3d.control, { theta, duration: 1.5, ease: 'inOutQuad' } )
	}

	venus() {
		this.morphTo( 1, this.pair.thetaB )
	}

	david() {
		this.morphTo( 0, this.pair.thetaA )
	}
}
