/**
 * Waves — synthwave sunset horizon with multi-line batched ocean crests.
 * Demonstrates: .lines( multiLineArray ), .dynamic( true ), .setPositions( flatBuffer ),
 * and per-vertex colors via .vertexColors( array ) + TSL .colorFn().
 */
import { MeshLine } from 'makio-meshline'
import { color, Fn, mix, modelViewMatrix, positionGeometry, positionWorldDirection, smoothstep, vec4 } from 'three/tsl'
import { Color, MathUtils } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { linePoints, times } from '@/utils/points'

const LINE_COUNT = 56
const POINTS_PER_LINE = 180
const SEA_WIDTH = 72
const SEA_NEAR = 36
const SEA_FAR = -36
const SUN_RADIUS = 14
const SUN_STRIPES = 32
const SUN_CENTER_Y = 9.5
const SUN_DEPTH = -35

const SKY_ZENITH = 0x060516
const SKY_HORIZON = 0x5E1B6B
const SKY_DUSK = 0x281048
const SEA_SHADOW = 0x050312
const FOG_COLOR = 0x240C3B
const SEA_EDGE = new Color( 0x3B2A9E )
const SEA_MID = new Color( 0xFF3D8B )
const SEA_GLINT = new Color( 0xFFD56B )

const waveHeight = ( x, z, time ) =>
	Math.sin( x * 0.21 + z * 0.13 + time * 1.05 ) * 0.48
	+ Math.sin( x * 0.47 - z * 0.29 - time * 0.82 ) * 0.22
	+ Math.sin( ( x + z ) * 0.93 + time * 1.9 ) * 0.07

// A warm glint column under the sun that cools toward the edges of the sea.
const seaColor = x => new Color()
	.copy( SEA_EDGE )
	.lerp( SEA_MID, Math.exp( -( ( x / 13 ) ** 2 ) ) )
	.lerp( SEA_GLINT, Math.exp( -( ( x / 2.6 ) ** 2 ) ) )

const seaX = t => ( t - 0.5 ) * SEA_WIDTH

const skyGradient = Fn( () => {
	const elevation = positionWorldDirection.normalize().y
	const lower = mix( color( SEA_SHADOW ), color( SKY_HORIZON ), smoothstep( -0.45, 0, elevation ) )
	const upper = mix( color( SKY_HORIZON ), color( SKY_DUSK ), smoothstep( 0, 0.25, elevation ) )
	const sky = mix( upper, color( SKY_ZENITH ), smoothstep( 0.15, 0.7, elevation ) )
	return vec4( mix( lower, sky, smoothstep( -0.08, 0.08, elevation ) ), 1 )
} )

export default class WavesExample {
	time = 0

	async init() {
		await stage3d.initRender( { background: SKY_ZENITH, fov: 50, near: 0.5, far: 400 } )
		stage3d.scene.backgroundNode = skyGradient()
		stage3d.orbit( 46, {
			target: [0, 3, -8],
			cameraOffset: [0, 2, -4],
			phi: 1.48,
			minPhi: 0.2,
			maxPhi: Math.PI * 0.52,
			minRadius: 10,
			maxRadius: 95,
			extraThetaMax: 0.35,
			extraPhiMax: 0.14,
		} )

		this.createSea()
		this.createSun()
		createBloomPipeline( { strength: 0.45, radius: 0.5, threshold: 0.3 } )
	}

	createSea() {
		// x and z never move: each frame only rewrites the y of these rows.
		this.rows = times( LINE_COUNT, row => {
			const z = MathUtils.lerp( SEA_NEAR, SEA_FAR, row / ( LINE_COUNT - 1 ) )
			return linePoints( POINTS_PER_LINE, t => [seaX( t ), waveHeight( seaX( t ), z, 0 ), z] )
		} )

		// One RGB per point, and every row repeats the same palette.
		const palette = times( POINTS_PER_LINE, i => seaColor( seaX( i / ( POINTS_PER_LINE - 1 ) ) ).toArray() )
		const colors = new Float32Array( times( LINE_COUNT, () => palette ).flat( 2 ) )

		this.sea = new MeshLine()
			.lines( this.rows, false )
			.dynamic( true )
			// Hooks keep a progress array by default: this one reads none, which spares an arc-length pass per frame.
			.needsProgress( false )
			.vertexColors( colors )
			.lineWidth( 0.055 )
			.colorFn( Fn( ( [lineColor] ) => {
				const depth = modelViewMatrix.mul( vec4( positionGeometry, 1 ) ).z.negate()
				const haze = smoothstep( 50, 140, depth ).mul( 0.5 )
				return vec4( mix( lineColor.rgb, color( FOG_COLOR ), haze ), 1 )
			} ) )
			.autoResize()

		stage3d.add( this.sea )
	}

	// A classic retro sun: horizontal stripes sitting right behind the waves.
	createSun() {
		const spacing = SUN_RADIUS * 2 / SUN_STRIPES
		const stripes = []
		for ( let stripe = 0; stripe < SUN_STRIPES; stripe++ ) {
			const y = SUN_RADIUS - ( stripe + 0.5 ) * spacing
			if ( SUN_CENTER_Y + y < 0 ) continue
			const halfChord = Math.sqrt( SUN_RADIUS * SUN_RADIUS - y * y )
			stripes.push( new Float32Array( [-halfChord, y, 0, halfChord, y, 0] ) )
		}

		const sun = new MeshLine()
			.lines( stripes, false )
			.lineWidth( spacing )
			.widthCallback( ( progress, pointIndex, stripe ) => {
				return 0.72 - MathUtils.smoothstep( stripe / ( stripes.length - 1 ), 0.2, 1 ) * 0.56
			} )
			.colorFn( Fn( ( [sunColor] ) => {
				const height = positionGeometry.y.add( SUN_CENTER_Y ).div( SUN_RADIUS + SUN_CENTER_Y ).clamp( 0, 1 )
				return vec4( mix( color( 0xFF2E88 ), color( 0xFFE27A ), smoothstep( 0.05, 0.95, height ) ).mul( sunColor.rgb ), 1 )
			} ) )
			.autoResize()

		sun.position.set( 0, SUN_CENTER_Y, SUN_DEPTH )
		stage3d.add( sun )
	}

	update = dt => {
		this.time += dt * 0.001 * ( reducedMotion.matches ? 0.2 : 1 )

		for ( const row of this.rows ) {
			for ( let i = 0; i < row.length; i += 3 ) row[i + 1] = waveHeight( row[i], row[2], this.time )
		}
		this.sea.setPositions( this.rows )
	}
}
