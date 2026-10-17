import { MeshLine } from 'makio-meshline'
import { color, Fn, mix, modelViewMatrix, positionGeometry, positionWorldDirection, smoothstep, vec4 } from 'three/tsl'
import { Color, MathUtils } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'

const LINE_COUNT = 56
const POINTS_PER_LINE = 180
const FLOATS_PER_LINE = POINTS_PER_LINE * 3
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

const mixed = new Color()

class WavesExample {
	constructor() {
		this.lines = null
		this.sun = null
		this.bloom = null
		this.control = null
		this.hint = null
		this.linePositions = null
		this.time = 0
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true
	}

	async init() {
		await stage3d.initRender( { background: SKY_ZENITH } )
		stage3d.camera.near = 0.5
		stage3d.camera.far = 400
		stage3d.camera.fov = 50
		stage3d.camera.updateProjectionMatrix()

		this.control = new OrbitControl( stage3d.camera, 46 )
		this.control.cameraOffset.set( 0, 2, -4 )
		this.control.target.set( 0, 3, -8 )
		this.control._theta = Math.PI * 0.5
		this.control._phi = 1.48
		this.control.minPhi = 0.2
		this.control.maxPhi = Math.PI * 0.52
		this.control.minRadius = 10
		this.control.maxRadius = 95
		this.control.isThetaRestricted = false
		this.control.extraThetaMax = 0.35
		this.control.extraPhiMax = 0.14
		this.control.update()
		stage3d.control = this.control

		this.createSky()
		this.initScene()
		this.createSun()
		this.bloom = createBloomPipeline( { strength: 0.45, radius: 0.5, threshold: 0.3 } )
		this.hint = createDemoHint( `${LINE_COUNT} dynamic wave lines · ${SUN_STRIPES} retro sun stripes`, { accent: '#ff3d8b', hideAfter: 9000 } )

		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createSky() {
		// Simple, smooth vertical gradient around the scene.
		stage3d.scene.backgroundNode = Fn( () => {
			const elevation = positionWorldDirection.normalize().y
			const lower = mix( color( SEA_SHADOW ), color( SKY_HORIZON ), smoothstep( -0.45, 0, elevation ) )
			const upper = mix( color( SKY_HORIZON ), color( SKY_DUSK ), smoothstep( 0, 0.25, elevation ) )
			const sky = mix( upper, color( SKY_ZENITH ), smoothstep( 0.15, 0.7, elevation ) )
			return vec4( mix( lower, sky, smoothstep( -0.08, 0.08, elevation ) ), 1 )
		} )()
	}

	initScene() {
		// One RGB per point: a warm glint column under the sun that cools toward
		// the edges of the sea. Every row repeats the same palette.
		const colors = new Float32Array( LINE_COUNT * FLOATS_PER_LINE )
		for ( let pointIndex = 0; pointIndex < POINTS_PER_LINE; pointIndex++ ) {
			const x = ( pointIndex / ( POINTS_PER_LINE - 1 ) - 0.5 ) * SEA_WIDTH
			const warmth = Math.exp( -( ( x / 13 ) ** 2 ) )
			const glint = Math.exp( -( ( x / 2.6 ) ** 2 ) )
			mixed.copy( SEA_EDGE ).lerp( SEA_MID, warmth ).lerp( SEA_GLINT, glint )
			for ( let lineIndex = 0; lineIndex < LINE_COUNT; lineIndex++ ) {
				mixed.toArray( colors, ( lineIndex * POINTS_PER_LINE + pointIndex ) * 3 )
			}
		}

		this.lines = new MeshLine()
			.lines( this.createWaveLines(), false )
			.dynamic( true )
			.vertexColors( colors )
			.lineWidth( 0.055 )
			.colorFn( Fn( ( [lineColor] ) => {
				const depth = modelViewMatrix.mul( vec4( positionGeometry, 1 ) ).z.negate()
				const haze = smoothstep( 50, 140, depth ).mul( 0.5 )
				return vec4( mix( lineColor.rgb, color( FOG_COLOR ), haze ), 1 )
			} ) )

		stage3d.add( this.lines )
	}

	createSun() {
		const spacing = SUN_RADIUS * 2 / SUN_STRIPES
		const stripes = []
		for ( let stripe = 0; stripe < SUN_STRIPES; stripe++ ) {
			const y = SUN_RADIUS - ( stripe + 0.5 ) * spacing
			if ( SUN_CENTER_Y + y < 0 ) continue
			const halfChord = Math.sqrt( Math.max( SUN_RADIUS * SUN_RADIUS - y * y, 0 ) )
			stripes.push( [-halfChord, y, 0, halfChord, y, 0] )
		}

		// Classic retro sun of lines positioned directly on the back of the waves.
		this.sun = new MeshLine()
			.lines( stripes, false )
			.lineWidth( spacing )
			.widthCallback( ( progress, pointIndex, stripe ) => {
				const fromTop = stripe / Math.max( stripes.length - 1, 1 )
				return 0.72 - smoothstepValue( 0.2, 1, fromTop ) * 0.56
			} )
			.colorFn( Fn( ( [sunColor] ) => {
				const height = positionGeometry.y.add( SUN_CENTER_Y ).div( SUN_RADIUS + SUN_CENTER_Y ).clamp( 0, 1 )
				return vec4( mix( color( 0xFF2E88 ), color( 0xFFE27A ), smoothstep( 0.05, 0.95, height ) ).mul( sunColor.rgb ), 1 )
			} ) )
		this.sun.position.set( 0, SUN_CENTER_Y, SUN_DEPTH )
		stage3d.add( this.sun )
	}

	createWaveLines( time = 0 ) {
		if ( !this.linePositions ) {
			this.linePositions = Array.from(
				{ length: LINE_COUNT },
				( _, lineIndex ) => {
					const positions = new Float32Array( FLOATS_PER_LINE )
					const depth = lineIndex / ( LINE_COUNT - 1 )
					const z = MathUtils.lerp( SEA_NEAR, SEA_FAR, depth )
					for ( let pointIndex = 0; pointIndex < POINTS_PER_LINE; pointIndex++ ) {
						const progress = pointIndex / ( POINTS_PER_LINE - 1 )
						positions[pointIndex * 3] = ( progress - 0.5 ) * SEA_WIDTH
						positions[pointIndex * 3 + 2] = z
					}
					return positions
				}
			)
		}

		for ( let lineIndex = 0; lineIndex < LINE_COUNT; lineIndex++ ) {
			const positions = this.linePositions[lineIndex]
			const z = positions[2]

			for ( let pointIndex = 0; pointIndex < POINTS_PER_LINE; pointIndex++ ) {
				const x = positions[pointIndex * 3]
				positions[pointIndex * 3 + 1] = Math.sin( x * 0.21 + z * 0.13 + time * 1.05 ) * 0.48
					+ Math.sin( x * 0.47 - z * 0.29 - time * 0.82 ) * 0.22
					+ Math.sin( ( x + z ) * 0.93 + time * 1.9 ) * 0.07
			}
		}

		return this.linePositions
	}

	update = ( dt ) => {
		const delta = Math.min( dt, 100 ) * 0.001
		this.time += delta * ( this.reducedMotion ? 0.2 : 1 )

		const animatedLines = this.createWaveLines( this.time )
		this.lines.setPositions( animatedLines )
	}

	onResize = () => {
		this.lines?.resize()
		this.sun?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		this.hint?.remove()
		this.hint = null
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		this.control = null
		this.bloom?.dispose()
		this.bloom = null
		stage3d.scene.backgroundNode = null
		for ( const line of [this.lines, this.sun] ) {
			stage3d.remove( line )
			line?.dispose()
		}
		this.lines = null
		this.sun = null
		this.linePositions = null
	}

}

function smoothstepValue( edge0, edge1, value ) {
	const t = Math.max( 0, Math.min( 1, ( value - edge0 ) / ( edge1 - edge0 ) ) )
	return t * t * ( 3 - 2 * t )
}

export default WavesExample
