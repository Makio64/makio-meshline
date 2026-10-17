import { MeshLine } from 'makio-meshline'
import { attribute, color, dot, float, Fn, fract, max, mix, positionWorldDirection, pow, sin, smoothstep, texture, time, vec3, vec4 } from 'three/tsl'
import { CatmullRomCurve3, Fog, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import random from '@/makio/utils/random'
import { createDemoHint } from '@/utils/demoHint'

const BAGUETTE_COUNT = 30
const SEGMENTS = 64
const BILLBOARD_VERTICES_PER_POINT = 4
const PATH_POINTS = 8
const SPREAD = 40
const BAGUETTE_LENGTH = 10
const FLIGHT_SPEED_MIN = 6
const FLIGHT_SPEED_MAX = 11
const AUTO_ROTATE_SPEED = 0.00004

// A bright summer sky: distant loaves melt into it instead of darkening.
const SKY_ZENITH = 0x2C6CD2
const SKY_HORIZON = 0xD5E7F6
const SKY_HAZE = 0xBFD9EF
const SUN_DIRECTION = new Vector3( 0.45, 0.5, -0.74 ).normalize()

// Stable per-loaf random in [0, 1) from the batched line index.
const hash = Fn( ( [value] ) => fract( sin( value.mul( 12.9898 ).add( 4.1 ) ).mul( 43758.5453 ) ) )
const hashValue = value => {
	const x = Math.sin( value * 12.9898 + 4.1 ) * 43758.5453
	return x - Math.floor( x )
}

class FlyingBaguettesExample {
	constructor() {
		this.curves = []
		this.baguettes = []
		this.lineArrays = []
		this.lineIndices = new Float32Array( SEGMENTS * BILLBOARD_VERTICES_PER_POINT * BAGUETTE_COUNT )
		this.line = null
		this.texture = null
		this.noise = null
		this.hint = null
		this.samplePoint = new Vector3()
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true

		let vertexOffset = 0
		for ( let lineIndex = 0; lineIndex < BAGUETTE_COUNT; lineIndex++ ) {
			const points = Array.from( { length: PATH_POINTS }, () => new Vector3(
				random( -SPREAD, SPREAD ),
				random( -SPREAD, SPREAD ),
				random( -SPREAD, SPREAD )
			) )
			const curve = new CatmullRomCurve3( points, true, 'catmullrom', 0.5 )
			const curveLength = curve.getLength()
			const baguette = {
				positions: new Float32Array( SEGMENTS * 3 ),
				progress: random( 0, 1 ),
				// World units per second, so long and short loops fly at a similar pace.
				speed: random( FLIGHT_SPEED_MIN, FLIGHT_SPEED_MAX ) / curveLength,
				curveLength,
			}

			this.curves.push( curve )
			this.baguettes.push( baguette )
			this.lineArrays.push( baguette.positions )

			for ( let i = 0; i < SEGMENTS * BILLBOARD_VERTICES_PER_POINT; i++ ) {
				this.lineIndices[vertexOffset++] = lineIndex
			}
		}
	}

	async init() {
		await stage3d.initRender( { background: SKY_HORIZON } )
		stage3d.camera.far = 200
		stage3d.camera.updateProjectionMatrix()
		stage3d.control = new OrbitControl( stage3d.camera, 30 )
		stage3d.scene.fog = new Fog( SKY_HAZE, 38, 92 )

		const loader = new TextureLoader()
		this.texture = loader.load( '/textures/baguette.png' )
		this.texture.colorSpace = SRGBColorSpace
		this.noise = loader.load( '/textures/noises/perlin/rgb-256x256.png' )
		this.noise.wrapS = RepeatWrapping
		this.noise.wrapT = RepeatWrapping
		this.createSky()
		this.createLine()
		this.hint = createDemoHint( `${BAGUETTE_COUNT} baguettes · one MeshLine · one draw call`, { accent: '#f5b453', hideAfter: 9000 } )

		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createSky() {
		const sun = vec3( SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z )
		stage3d.scene.backgroundNode = Fn( () => {
			const direction = positionWorldDirection.normalize()
			const elevation = direction.y
			const sky = mix( color( SKY_HORIZON ), color( SKY_ZENITH ), smoothstep( -0.35, 0.6, elevation ) )
			// Slow, soft cumulus on a dome projection, thinning toward the horizon.
			const cloudUV = direction.xz.div( elevation.abs().add( 0.32 ) ).mul( 0.2 ).add( time.mul( 0.003 ) )
			const cloudNoise = texture( this.noise, cloudUV ).r.mul( 0.65 )
				.add( texture( this.noise, cloudUV.mul( 2.7 ) ).g.mul( 0.35 ) )
			const cloud = smoothstep( 0.52, 0.7, cloudNoise ).mul( smoothstep( -0.08, 0.25, elevation ) )
			const clouded = mix( sky, color( 0xFFFFFF ), cloud.mul( 0.9 ) )
			const sunGlow = pow( max( dot( direction, sun ), 0 ), 6 ).mul( 0.35 )
			return vec4( clouded.add( color( 0xFFE2B0 ).mul( sunGlow ) ), 1 )
		} )()
	}

	createLine() {
		this.updatePositions( 0 )

		this.line = new MeshLine()
			.lines( this.lineArrays, false )
			.dynamic( true )
			.needsProgress( false )
			.lineWidth( 1.4 )
			// Loaves come in slightly different sizes; the width stays constant
			// along each one so the texture keeps its proportions.
			.widthCallback( ( progress, pointIndex, lineIndex ) => 0.85 + hashValue( lineIndex ) * 0.3 )
			.map( this.texture )
			.alphaTest( 0.1 )
			.colorFn( Fn( ( [baseColor] ) => {
				// Each loaf gets its own bake, from pale to well done: a warm,
				// believable spread instead of darker copies.
				const bake = hash( attribute( 'lineIndex', 'float' ) )
				const crust = mix( vec3( 1.06, 1.03, 0.97 ), vec3( 0.9, 0.78, 0.64 ), bake )
				return vec4( baseColor.rgb.mul( crust ), float( 1 ) )
			} ) )

		this.line.addVertexAttribute( 'lineIndex', 1 )
		this.line.setVertexValues( 'lineIndex', this.lineIndices )

		stage3d.add( this.line )
	}

	updatePositions( dt ) {
		const stepDistance = BAGUETTE_LENGTH / ( SEGMENTS - 1 )
		for ( let baguetteIndex = 0; baguetteIndex < BAGUETTE_COUNT; baguetteIndex++ ) {
			const baguette = this.baguettes[baguetteIndex]
			const curve = this.curves[baguetteIndex]
			const curveLength = baguette.curveLength
			const invCurveLength = 1 / curveLength
			baguette.progress += baguette.speed * dt * 0.001
			if ( baguette.progress > 1 ) baguette.progress -= 1
			const startDistance = baguette.progress * curveLength

			for ( let i = 0; i < SEGMENTS; i++ ) {
				let pointDistance = startDistance - i * stepDistance

				if ( pointDistance < 0 ) pointDistance += curveLength
				if ( pointDistance > curveLength ) pointDistance -= curveLength

				const position = curve.getPoint( pointDistance * invCurveLength, this.samplePoint )
				const offset = i * 3

				baguette.positions[offset] = position.x
				baguette.positions[offset + 1] = position.y
				baguette.positions[offset + 2] = position.z
			}
		}
	}

	update = ( dt ) => {
		const delta = Math.min( dt, 100 )
		this.updatePositions( this.reducedMotion ? delta * 0.3 : delta )
		this.line.setPositions( this.lineArrays )
		const control = stage3d.control
		if ( control && !control._isDown && !this.reducedMotion ) control._theta += delta * AUTO_ROTATE_SPEED
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		stage3d.remove( this.line )
		stage3d.control?.dispose()
		this.line?.dispose()
		this.line = null
		this.hint?.remove()
		this.hint = null

		stage3d.scene.fog = null
		stage3d.scene.backgroundNode = null

		this.texture?.dispose()
		this.texture = null
		this.noise?.dispose()
		this.noise = null
	}

}

export default FlyingBaguettesExample
