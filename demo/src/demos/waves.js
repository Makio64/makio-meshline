import { MeshLine } from 'makio-meshline'
import { color, float, Fn, mix, modelViewMatrix, positionGeometry, smoothstep, uv, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, MathUtils, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector2 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { onMove } from '@/makio/utils/input/mouse'
import { createBloomPipeline } from '@/utils/bloomPipeline'

const LINE_COUNT = 56
const POINTS_PER_LINE = 180
const FLOATS_PER_LINE = POINTS_PER_LINE * 3
const SEA_WIDTH = 72
const SEA_NEAR = 5
const SEA_FAR = -85
const SUN_RADIUS = 15
const SUN_STRIPES = 34
const SUN_CENTER_Y = 6.5
const SUN_DEPTH = -110

const SKY_ZENITH = 0x07061A
const SKY_HORIZON = 0xFF6A88
const SKY_DUSK = 0x5B1E78
const SEA_SHADOW = 0x090418
const FOG_COLOR = 0x4A1450
const SEA_EDGE = new Color( 0x3B2A9E )
const SEA_MID = new Color( 0xFF3D8B )
const SEA_GLINT = new Color( 0xFFD56B )

const mixed = new Color()

class WavesExample {
	constructor() {
		this.lines = null
		this.sun = null
		this.halo = null
		this.bloom = null
		this.linePositions = null
		this.time = 0
		this.pointer = new Vector2()
		this.parallax = new Vector2()
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true
	}

	async init() {
		await stage3d.initRender( { background: SKY_ZENITH } )
		stage3d.camera.near = 0.5
		stage3d.camera.far = 400
		stage3d.camera.fov = 50
		stage3d.camera.updateProjectionMatrix()
		this.placeCamera()

		this.createSky()
		this.initScene()
		this.createSun()
		this.bloom = createBloomPipeline( { strength: 0.45, radius: 0.5, threshold: 0.3 } )

		onMove.add( this.onPointerMove )
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createSky() {
		// The background sphere's v coordinate follows latitude: 0.5 is the horizon.
		stage3d.scene.backgroundNode = Fn( () => {
			const elevation = uv().y.sub( 0.5 )
			const dusk = mix( color( SKY_HORIZON ), color( SKY_DUSK ), smoothstep( 0, 0.05, elevation ) )
			const sky = mix( dusk, color( SKY_ZENITH ), smoothstep( 0.03, 0.14, elevation ) )
			const sea = mix( color( SEA_SHADOW ), color( FOG_COLOR ), smoothstep( -0.12, 0, elevation ) )
			return vec4( mix( sea, sky, smoothstep( -0.001, 0.001, elevation ) ), 1 )
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
			// The vertex color arrives premultiplied into `color`; fade it into the
			// horizon haze by view depth so far rows melt into the sky.
			.colorFn( Fn( ( [lineColor] ) => {
				const depth = modelViewMatrix.mul( vec4( positionGeometry, 1 ) ).z.negate()
				const haze = smoothstep( 18, 95, depth )
				return vec4( mix( lineColor.rgb, color( FOG_COLOR ), haze ), 1 )
			} ) )

		stage3d.add( this.lines )
	}

	createSun() {
		const spacing = SUN_RADIUS * 2 / SUN_STRIPES
		const stripes = []
		for ( let stripe = 0; stripe < SUN_STRIPES; stripe++ ) {
			const y = SUN_RADIUS - ( stripe + 0.5 ) * spacing
			const halfChord = Math.sqrt( Math.max( SUN_RADIUS * SUN_RADIUS - y * y, 0 ) )
			stripes.push( [-halfChord, y, 0, halfChord, y, 0] )
		}

		// Classic retro sun: stripes thin out toward the bottom, opening gaps.
		this.sun = new MeshLine()
			.lines( stripes, false )
			.lineWidth( spacing )
			.widthCallback( ( progress, pointIndex, stripe ) => {
				const fromTop = stripe / ( SUN_STRIPES - 1 )
				return 0.72 - smoothstepValue( 0.2, 1, fromTop ) * 0.56
			} )
			.colorFn( Fn( ( [sunColor] ) => {
				const height = positionGeometry.y.div( SUN_RADIUS * 2 ).add( 0.5 )
				return vec4( mix( color( 0xFF2E88 ), color( 0xFFE27A ), smoothstep( 0.05, 0.95, height ) ).mul( sunColor.rgb ), 1 )
			} ) )
		this.sun.position.set( 0, SUN_CENTER_Y, SUN_DEPTH )
		stage3d.add( this.sun )

		const haloMaterial = new MeshBasicNodeMaterial( { transparent: true, depthWrite: false } )
		haloMaterial.blending = AdditiveBlending
		haloMaterial.colorNode = Fn( () => {
			const distance = uv().sub( 0.5 ).length().mul( 2 )
			const glow = float( 1 ).sub( smoothstep( 0.2, 1, distance ) ).pow( 2.2 )
			return vec4( color( 0xFF5C8A ).mul( glow.mul( 0.3 ) ), 1 )
		} )()
		this.halo = new Mesh( new PlaneGeometry( SUN_RADIUS * 5, SUN_RADIUS * 5 ), haloMaterial )
		this.halo.position.set( 0, SUN_CENTER_Y, SUN_DEPTH - 2 )
		stage3d.add( this.halo )
	}

	createWaveLines( time = 0 ) {
		if ( !this.linePositions ) {
			this.linePositions = Array.from(
				{ length: LINE_COUNT },
				( _, lineIndex ) => {
					const positions = new Float32Array( FLOATS_PER_LINE )
					// Rows get denser toward the horizon so the sea reads as a surface.
					const depth = ( lineIndex / ( LINE_COUNT - 1 ) ) ** 1.35
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

		this.parallax.x = MathUtils.damp( this.parallax.x, this.pointer.x, 2, delta )
		this.parallax.y = MathUtils.damp( this.parallax.y, this.pointer.y, 2, delta )
		this.placeCamera()
	}

	placeCamera() {
		const camera = stage3d.camera
		camera.position.set( this.parallax.x * 2.4, 2.6 - this.parallax.y * 0.8, 10 )
		camera.lookAt( this.parallax.x * 4, 3.4, -60 )
	}

	onPointerMove = ( mouseData ) => {
		this.pointer.set( mouseData.normalizedX, mouseData.normalizedY )
	}

	onResize = () => {
		this.lines?.resize()
		this.sun?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		onMove.remove( this.onPointerMove )
		window.removeEventListener( 'resize', this.onResize )
		this.bloom?.dispose()
		this.bloom = null
		stage3d.scene.backgroundNode = null
		for ( const line of [this.lines, this.sun] ) {
			stage3d.remove( line )
			line?.dispose()
		}
		if ( this.halo ) {
			stage3d.remove( this.halo )
			this.halo.geometry.dispose()
			this.halo.material.dispose()
		}
		this.lines = null
		this.sun = null
		this.halo = null
		this.linePositions = null
	}

}

function smoothstepValue( edge0, edge1, value ) {
	const t = Math.max( 0, Math.min( 1, ( value - edge0 ) / ( edge1 - edge0 ) ) )
	return t * t * ( 3 - 2 * t )
}

export default WavesExample
