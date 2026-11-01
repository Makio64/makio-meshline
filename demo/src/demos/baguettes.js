/**
 * Flying Baguettes — 30 animated loaves batched in a single MeshLine with fake 3D relief lighting.
 * Demonstrates: .lines( lineArrays, false ), .dynamic( true ), .needsProgress( false ), .map( texture ),
 * .normalFn( fn ), .fragmentColorFn( fn ), and custom per-vertex attributes via .addVertexAttribute().
 */
import { MeshLine } from 'makio-meshline'
import { attribute, color, dot, Fn, fract, max, mix, positionGeometry, positionWorldDirection, pow, sin, smoothstep, texture, time, uniform, vec3, vec4 } from 'three/tsl'
import { CatmullRomCurve3, Fog, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import random from '@/makio/utils/random'
import { crustShader, SUN_DIRECTION, vBake, vScreenDir, vWorldPos } from '@/utils/baguettesCrustShader'
import { createDemoControls, onShortcut } from '@/utils/demoControls'
import { createDemoHint } from '@/utils/demoHint'
import { times } from '@/utils/points'

const BAGUETTE_COUNT = 30
const SEGMENTS = 64
const PATH_POINTS = 8
const SPREAD = 40
const BAGUETTE_LENGTH = 10
const SHADING_MODES = ['lit', 'flat', 'normals']

// A bright summer sky: distant loaves melt into it instead of darkening.
const SKY_ZENITH = 0x2C6CD2
const SKY_HORIZON = 0xD5E7F6
const SKY_HAZE = 0xBFD9EF

// Stable per-loaf random in [0, 1) from the batched line index.
const loafRandom = Fn( () => fract( sin( attribute( 'lineIndex', 'float' ).mul( 12.9898 ).add( 4.1 ) ).mul( 43758.5453 ) ) )

const samplePoint = new Vector3()

const randomPoint = () => new Vector3( random( -SPREAD, SPREAD ), random( -SPREAD, SPREAD ), random( -SPREAD, SPREAD ) )

function createBaguette() {
	const curve = new CatmullRomCurve3( times( PATH_POINTS, randomPoint ), true, 'catmullrom' )
	const curveLength = curve.getLength()
	return {
		curve,
		positions: new Float32Array( SEGMENTS * 3 ),
		progress: random( 0, 1 ),
		// World units per second, so long and short loops fly at a similar pace.
		speed: random( 6, 11 ) / curveLength,
		// Curve fraction between two points: every loaf is BAGUETTE_LENGTH long.
		spacing: BAGUETTE_LENGTH / ( SEGMENTS - 1 ) / curveLength,
	}
}

function requestedShadingMode() {
	const params = new URLSearchParams( window.location.search )
	const mode = params.get( 'shading' ) || ( params.has( 'flat' ) ? 'flat' : 'lit' )
	return SHADING_MODES.includes( mode ) ? mode : 'lit'
}

export default class FlyingBaguettesExample {
	baguettes = times( BAGUETTE_COUNT, createBaguette )
	lineArrays = this.baguettes.map( baguette => baguette.positions )
	// 0 = flat, 1 = 3D fake normals + lighting, 2 = fake normal visualization
	shadingModeUniform = uniform( 1 )

	async init() {
		await stage3d.initRender( { background: SKY_HORIZON, far: 200 } )
		stage3d.orbit( 30, { autoRotate: 0.00004 } )
		stage3d.scene.fog = new Fog( SKY_HAZE, 38, 92 )

		const loader = new TextureLoader()
		this.texture = stage3d.own( loader.load( '/textures/baguette.png' ) )
		this.texture.colorSpace = SRGBColorSpace
		this.noise = stage3d.own( loader.load( '/textures/noises/perlin/rgb-256x256.png' ) )
		this.noise.wrapS = this.noise.wrapT = RepeatWrapping

		this.createSky()
		this.createLine()
		this.createControls()
		createDemoHint( `${BAGUETTE_COUNT} baguettes · one MeshLine · fake 3D normals & lights (L to toggle Flat)`, { accent: '#f5b453' } )
	}

	createSky() {
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
			const sunGlow = pow( max( dot( direction, SUN_DIRECTION ), 0 ), 6 ).mul( 0.35 )
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
			.widthFn( Fn( ( [width] ) => width.mul( loafRandom().mul( 0.3 ).add( 0.85 ) ) ) )
			.normalFn( Fn( ( [normal, dir] ) => {
				// `dir` is the exact unit 2D screen-space tangent along +uv.x, and
				// `vec2(-dir.y, dir.x)` is the exact screen direction of `side = +1`.
				vScreenDir.assign( dir )
				return normal
			} ) )
			.map( this.texture )
			.alphaTest( 0.1 )
			.colorFn( Fn( ( [baseColor] ) => {
				// Each loaf gets its own bake, from pale to well done: a warm,
				// believable spread instead of darker copies.
				const bake = loafRandom().toVar()
				const crust = mix( vec3( 1.06, 1.03, 0.97 ), vec3( 0.9, 0.78, 0.64 ), bake )

				vWorldPos.assign( positionGeometry )
				vBake.assign( bake )

				return vec4( baseColor.rgb.mul( crust ), 1 )
			} ) )
			.fragmentColorFn( crustShader( this.texture, this.noise, this.shadingModeUniform ) )
			.autoResize()

		// Every loaf shares one geometry, so each vertex carries the index of its own.
		const { count } = this.line.addVertexAttribute( 'lineIndex' )
		this.line.setVertexValues( 'lineIndex', times( count, vertex => Math.floor( vertex * BAGUETTE_COUNT / count ) ) )

		stage3d.add( this.line )
	}

	createControls() {
		this.controls = createDemoControls( [
			{ id: 'lit', label: '3D Lit', title: 'Fake 3D cylinder + slash relief normals, sun & sky lighting, crust sheen & SSS (L)', onClick: () => this.setShadingMode( 'lit' ) },
			{ id: 'flat', label: 'Flat', title: 'Original unlit flat texture mode (L)', onClick: () => this.setShadingMode( 'flat' ) },
			{ id: 'normals', label: 'Normals', title: 'Inspect reconstructed 3D cylinder + grigne relief normals (L)', onClick: () => this.setShadingMode( 'normals' ) },
		], { accent: '#f5b453', label: 'Baguette shading mode' } )

		onShortcut( 'l', () => {
			const next = ( SHADING_MODES.indexOf( this.shadingMode ) + 1 ) % SHADING_MODES.length
			this.setShadingMode( SHADING_MODES[next] )
		} )
		this.setShadingMode( requestedShadingMode() )
	}

	setShadingMode( mode ) {
		this.shadingMode = mode
		this.shadingModeUniform.value = mode === 'flat' ? 0 : mode === 'normals' ? 2 : 1
		this.controls.select( mode )
	}

	updatePositions( dt ) {
		for ( const baguette of this.baguettes ) {
			baguette.progress = ( baguette.progress + baguette.speed * dt * 0.001 ) % 1
			for ( let i = 0; i < SEGMENTS; i++ ) {
				const t = ( baguette.progress - i * baguette.spacing + 1 ) % 1
				baguette.curve.getPoint( t, samplePoint ).toArray( baguette.positions, i * 3 )
			}
		}
	}

	update = dt => {
		this.updatePositions( reducedMotion.matches ? dt * 0.3 : dt )
		this.line.setPositions( this.lineArrays )
	}
}
