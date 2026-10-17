import { animate, utils } from 'animejs'
import { MeshLine, rectanglePositions } from 'makio-meshline'
import { abs, add, atan, cameraPosition, clamp, color, dot, float, Fn, fract, If, instanceIndex, length, max, mix, mul, normalize, positionWorld, positionWorldDirection, pow, reflect, reflector, sin, smoothstep as tslSmoothstep, storage, sub, texture, time, uniform, vec2, vec3, vec4, viewportSize } from 'three/tsl'
import {
	MathUtils,
	Mesh,
	MeshBasicNodeMaterial,
	Plane,
	PlaneGeometry,
	Raycaster,
	RepeatWrapping,
	StaticDrawUsage,
	StorageInstancedBufferAttribute,
	TextureLoader,
	Vector2,
	Vector3,
} from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import QuadTree from '@/makio/generative/QuadTree'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import keyboard from '@/makio/utils/input/keyboard'
import { mouse, onClick, onMove } from '@/makio/utils/input/mouse'
import { smoothstep } from '@/makio/utils/math'
import random from '@/makio/utils/random'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'

const FIELD_WIDTH = 64
const FIELD_HEIGHT = 64
const STALK_SPACING = 0.3
const STALK_JITTER = 0.1
const STALK_SEGMENTS_HD = 3
const STALK_SEGMENTS_ULTRA = 6
const WATER_PADDING = 8
// The flooded plain runs on past the terraces and melts into the haze.
const WATER_EXTENT = 2400
const WATER_HEIGHT = -0.02
const REFLECTION_DESKTOP_DENSITY = 1.25
const REFLECTION_DESKTOP_SCALE = 1
const REFLECTION_MOBILE_DENSITY = 0.75
const REFLECTION_MOBILE_SCALE = 0.5
const REFLECTION_ULTRA_DESKTOP_DENSITY = 2
const REFLECTION_ULTRA_DESKTOP_SCALE = 1.25
const REFLECTION_ULTRA_MOBILE_DENSITY = 1.1
const REFLECTION_ULTRA_MOBILE_SCALE = 0.75
const WATER_BASE_REFLECTIVITY = 0.08
const WATER_DISTORTION = 0.002
// Golden hour: a low sun straight ahead of the opening camera, a warm haze on
// the horizon, and gusts that roll across the paddies toward the viewer.
const SUN_DIRECTION = new Vector3( -0.86, 0.05, -0.5 ).normalize()
const WIND_DIRECTION = new Vector2( 0.62, 0.78 ).normalize()
const SKY_ZENITH = 0x2A3767
const SKY_MAUVE = 0x9C7C9A
const SKY_APRICOT = 0xEFA27A
const SKY_HORIZON = 0xFFBB74
const SUN_GLOW = 0xFFD7A0
const HAZE = 0xF4B376
const HUD_STYLE_ID = 'RicefieldQualityHudStyle'
const _intersectPoint = new Vector3()

function ensureHudStyle() {
	if ( typeof document === 'undefined' || document.getElementById( HUD_STYLE_ID ) ) return
	const style = document.createElement( 'style' )
	style.id = HUD_STYLE_ID
	style.textContent = `
		.RicefieldQualityHud {
			position: fixed;
			top: calc(18px + var(--sait, 0px));
			left: 50%;
			transform: translateX(-50%);
			z-index: 1000;
			display: inline-flex;
			align-items: center;
			gap: 3px;
			padding: 4px;
			border-radius: 999px;
			background: rgba(8, 9, 12, 0.72);
			border: 1px solid rgba(255, 255, 255, 0.12);
			box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
			font: 650 11px/1 'Inter', system-ui, -apple-system, sans-serif;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			user-select: none;
		}
		.RicefieldQualityHud__btn {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			min-height: 30px;
			padding: 0 12px;
			border: 1px solid transparent;
			border-radius: 999px;
			background: transparent;
			color: rgba(244, 245, 247, 0.68);
			font: inherit;
			letter-spacing: inherit;
			text-transform: inherit;
			cursor: pointer;
			transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
		}
		.RicefieldQualityHud__btn:hover {
			color: #ffffff;
			background: rgba(255, 255, 255, 0.07);
		}
		.RicefieldQualityHud__btn.is-active {
			color: #fff7e6;
			background: rgba(251, 191, 36, 0.2);
			border-color: rgba(251, 191, 36, 0.48);
			box-shadow: 0 0 16px rgba(251, 191, 36, 0.18);
		}
		.RicefieldQualityHud__dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: currentColor;
			opacity: 0.6;
		}
		.RicefieldQualityHud__btn.is-active .RicefieldQualityHud__dot {
			background: #fbbf24;
			box-shadow: 0 0 8px #fbbf24;
			opacity: 1;
		}
		@media (max-width: 720px) {
			.RicefieldQualityHud {
				top: calc(12px + var(--sait, 0px));
				padding: 3px;
				font-size: 10px;
			}
			.RicefieldQualityHud__btn {
				min-height: 27px;
				padding: 0 10px;
			}
		}
	`
	document.head.appendChild( style )
}

class RicefieldExample {
	constructor() {
		const params = typeof window !== 'undefined' ? new URLSearchParams( window.location.search ) : null
		this.quality = params?.get( 'quality' ) === 'ultra' || params?.has( 'ultra' ) ? 'ultra' : 'hd'
		this.lines = null
		this.fieldBorder = null
		this.raycaster = new Raycaster()
		this.mouse = new Vector2()
		this.groundPlane = new Plane( new Vector3( 0, 1, 0 ), 0 ) // Y-up plane at Y=0
		this.mouseUniform = uniform( new Vector3( 1000, 0, 1000 ) ) // Initialize far away
		this.cutDistMin = uniform( 0 ) // Inner radius of shockwave
		this.cutDistMax = uniform( 0 ) // Outer radius of shockwave
		this.shockwaveOrigin = uniform( new Vector3( 0, 0, 0 ) ) // Fixed origin for shockwave
		this.mouseSpeedUniform = uniform( 1 ) // Mouse speed multiplier for interaction radius
		this.areaOfEffectUniform = uniform( 1 ) // Area of effect multiplier (0-1)
		this.cells = []
		this.riceInstances = []
		this.centerOffsetX = FIELD_WIDTH / 2
		this.centerOffsetZ = FIELD_HEIGHT / 2
		this.water = null
		this.reflection = null
		this.reflectionTarget = null
		this.noiseTexture = null
		this.mouseSpeed = 0
		this.targetMouseSpeed = 0
		this.bloom = null
		this.hint = null
		this.hud = null
		this.hudButtons = {}
	}

	async init() {
		await stage3d.initRender( { background: SKY_HORIZON } )
		stage3d.control = new OrbitControl( stage3d.camera, 56 )
		// Low over the paddies and facing the sun, so the canals mirror the sky.
		stage3d.control._phi = 1.2
		stage3d.control._theta = 0.5
		stage3d.control.target.set( 0, 6.5, 0 )
		stage3d.control.maxRadius = 100
		stage3d.control.minRadius = 20
		stage3d.control.minPhi = 0.1
		stage3d.control.maxPhi = Math.PI * 0.45
		stage3d.camera.far = 1600
		stage3d.camera.updateProjectionMatrix()
		this.bloom = createBloomPipeline( { strength: 0.3, radius: 0.5, threshold: 0.85 } )
		this.initScene()
		this.applyBloomPreset()
		this.initHud()
		this.hint = createDemoHint( 'Move to part the rice · click for a shockwave · toggle Ultra HD', { accent: '#fbbf24', hideAfter: 10000 } )
		stage.onResize.add( this.onResize )
		onMove.add( this.onMouseMove )
		onClick.add( this.onMouseClick )
		keyboard.onDown.add( this.onKeyDown )
	}

	initScene() {
		// Load shared noise texture first
		const textureLoader = new TextureLoader()
		this.noiseTexture = textureLoader.load( '/textures/noises/perlin/rgb-256x256.png' )
		this.noiseTexture.wrapS = RepeatWrapping
		this.noiseTexture.wrapT = RepeatWrapping
		
		this.initQuadtree()
		this.initRiceData()
		this.initSky()
		this.initWater()
		this.initRiceMeshes()
		this.initCompute()
	}

	initHud() {
		if ( typeof document === 'undefined' || new URLSearchParams( window.location.search ).has( 'noUI' ) ) return
		ensureHudStyle()

		const hud = document.createElement( 'div' )
		hud.className = 'RicefieldQualityHud'
		hud.setAttribute( 'role', 'group' )
		hud.setAttribute( 'aria-label', 'Visual quality mode' )

		const modes = [
			{ id: 'hd', label: 'HD' },
			{ id: 'ultra', label: 'Ultra HD' },
		]

		modes.forEach( ( mode ) => {
			const btn = document.createElement( 'button' )
			btn.type = 'button'
			btn.className = 'RicefieldQualityHud__btn'
			btn.title = mode.id === 'ultra'
				? 'Ultra HD: sun reflection path, crepuscular rays, curved 6-segment stalks & anisotropic leaf sheen (U)'
				: 'HD: standard golden-hour paddy scene (U)'

			const dot = document.createElement( 'span' )
			dot.className = 'RicefieldQualityHud__dot'

			const text = document.createElement( 'span' )
			text.textContent = mode.label

			btn.append( dot, text )
			btn.addEventListener( 'pointerdown', e => e.stopPropagation() )
			btn.addEventListener( 'click', ( e ) => {
				e.stopPropagation()
				this.setQuality( mode.id )
			} )

			hud.appendChild( btn )
			this.hudButtons[mode.id] = btn
		} )

		document.body.appendChild( hud )
		this.hud = hud
		this.updateHud()
	}

	updateHud() {
		for ( const [id, btn] of Object.entries( this.hudButtons ) ) {
			const active = this.quality === id
			btn.classList.toggle( 'is-active', active )
			btn.setAttribute( 'aria-pressed', String( active ) )
		}
	}

	onKeyDown = ( key, event ) => {
		if ( event?.metaKey || event?.ctrlKey || event?.altKey ) return
		if ( key === 'u' || key === 'U' ) {
			this.setQuality( this.quality === 'ultra' ? 'hd' : 'ultra' )
		}
	}

	setQuality( mode ) {
		const next = mode === 'ultra' ? 'ultra' : 'hd'
		if ( this.quality === next ) return
		this.quality = next
		this.disposeVisualMeshes()
		this.initSky()
		this.initWater()
		this.initRiceMeshes()
		this.applyBloomPreset()
		this.updateHud()
	}

	applyBloomPreset() {
		if ( !this.bloom?.bloomPass ) return
		if ( this.quality === 'ultra' ) {
			this.bloom.bloomPass.strength.value = 0.25
			this.bloom.bloomPass.radius.value = 0.48
			this.bloom.bloomPass.threshold.value = 0.88
		} else {
			this.bloom.bloomPass.strength.value = 0.18
			this.bloom.bloomPass.radius.value = 0.42
			this.bloom.bloomPass.threshold.value = 0.9
		}
	}

	sampleSky( direction, isUltra = false ) {
		const sun = vec3( SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z )
		const elevation = direction.y
		const skyElevation = max( elevation, 0 )
		// Warm well above the horizon: the canals mirror this band of the sky.
		const lowSky = mix( color( SKY_HORIZON ), color( SKY_APRICOT ), tslSmoothstep( 0, 0.3, skyElevation ) )
		const midSky = mix( lowSky, color( SKY_MAUVE ), tslSmoothstep( 0.35, 0.75, skyElevation ) )
		const sky = mix( midSky, color( SKY_ZENITH ), tslSmoothstep( 0.6, 1, skyElevation ) )
		// Thin cloud streaks low in the sky, lit from below by the sun.
		const cloudUV = direction.xz.div( skyElevation.add( 0.12 ) ).mul( vec2( 0.05, 0.16 ) ).add( 0.31 )
		const cloudNoise = texture( this.noiseTexture, cloudUV ).r
		const cloudMask = tslSmoothstep( 0.55, 0.78, cloudNoise )
			.mul( tslSmoothstep( 0.02, 0.065, elevation ) )
			.mul( tslSmoothstep( 0.16, 0.42, elevation ).oneMinus() )
		const clouded = mix( sky, color( 0xF29A78 ), cloudMask.mul( 0.55 ) )
		// Below the horizon, keep a continuous warm mist that matches the horizon
		// base so the distant water plane dissolves into it without any seam.
		const lowerMist = mix( color( SKY_HORIZON ), color( HAZE ), tslSmoothstep( 0, 0.25, elevation.negate() ) )
		const horizon = mix( lowerMist, clouded, tslSmoothstep( -0.01, 0.015, elevation ) )
		// A far ridge line whose crest is distinct against the sky while its foot
		// melts into the horizon mist at elevation = 0.
		const azimuth = atan( direction.z, direction.x )
		const ridge = sin( azimuth.mul( 7 ) ).mul( 0.0045 )
			.add( sin( azimuth.mul( 23 ).add( 1.3 ) ).mul( 0.0032 ) )
			.add( sin( azimuth.mul( 61 ).add( 0.4 ) ).mul( 0.0018 ) )
			.add( 0.014 )
		const ridgeCrest = tslSmoothstep( ridge.sub( 0.0025 ), ridge.add( 0.0012 ), elevation ).oneMinus()
		const ridgeFoot = tslSmoothstep( 0, ridge.mul( 0.85 ), elevation )
		const treeLine = ridgeCrest.mul( ridgeFoot )
		const ridgeColor = mix( color( SKY_HORIZON ), color( 0x8C5A48 ), 0.36 )
		let base = mix( horizon, ridgeColor, treeLine )

		// Blend broad atmospheric warmth with mix() rather than raw addition so the
		// sky around the sun never clips into a blown-out yellow dome.
		const horizonDir = normalize( vec3( direction.x, skyElevation, direction.z ) )
		const horizonSun = max( dot( horizonDir, sun ), 0 )
		const belowHorizonAtten = tslSmoothstep( -0.22, 0.02, elevation ).mul( 0.45 ).add( 0.55 )
		const atmosphericWarmth = pow( horizonSun, 4 ).mul( 0.14 )
			.add( pow( horizonSun, 18 ).mul( 0.16 ) )
			.mul( belowHorizonAtten )
		base = mix( base, color( SUN_GLOW ), atmosphericWarmth )

		// A small, soft-edged golden sun disk and tight halo behind the ridge.
		const sunAmount = max( dot( direction, sun ), 0 )
		const aboveRidge = tslSmoothstep( ridge.sub( 0.0015 ), ridge.add( 0.0025 ), elevation )
		const solarCorona = pow( sunAmount, 420 ).mul( 0.18 ).mul( aboveRidge )
		const disk = tslSmoothstep( 0.99987, 0.99996, sunAmount ).mul( 0.62 ).mul( aboveRidge )

		if ( !isUltra ) {
			return base.add( color( SUN_GLOW ).mul( solarCorona.add( disk ) ) )
		}

		// ULTRA HD: Add a distant second mountain range behind the first and a
		// delicate golden rim where the low sun kisses the ridge crest.
		const farRidge = sin( azimuth.mul( 5 ).add( 0.8 ) ).mul( 0.0055 )
			.add( sin( azimuth.mul( 17 ).add( 2.1 ) ).mul( 0.0038 ) )
			.add( sin( azimuth.mul( 43 ).add( 1.1 ) ).mul( 0.002 ) )
			.add( 0.023 )
		const farCrest = tslSmoothstep( farRidge.sub( 0.003 ), farRidge.add( 0.0015 ), elevation ).oneMinus()
		const farFoot = tslSmoothstep( ridge.mul( 0.6 ), farRidge.mul( 0.9 ), elevation )
		const farLayer = farCrest.mul( farFoot ).mul( ridgeCrest.oneMinus() )
		const farRidgeColor = mix( color( SKY_HORIZON ), color( 0x9E6B56 ), 0.2 )
		base = mix( base, farRidgeColor, farLayer )

		const ridgeRim = tslSmoothstep( ridge.sub( 0.003 ), ridge, elevation )
			.mul( ridgeCrest )
			.mul( pow( horizonSun, 12 ) )
			.mul( 0.14 )

		const ultraGlow = solarCorona.add( disk ).add( ridgeRim )
		return base.add( color( SUN_GLOW ).mul( ultraGlow ) )
	}

	initSky() {
		const isUltra = this.quality === 'ultra'
		stage3d.scene.backgroundNode = Fn( () => {
			const direction = positionWorldDirection.normalize()
			return vec4( this.sampleSky( direction, isUltra ), 1 )
		} )()
	}

	initQuadtree() {
		const quadtree = new QuadTree( FIELD_WIDTH, FIELD_HEIGHT, {
			maxDepth: 8,
			minSize: 1,
			jitter: 0.4,
			minPadding: 1,
			maxPadding: 2,
			randomNext: 0.2,
			total: 14 // Set a total number of cells to generate
		} )

		this.cells = quadtree.compute()
	}

	initWater() {
		const isUltra = this.quality === 'ultra'
		// Keep the reflection at or below CSS-pixel resolution in HD; in Ultra HD
		// boost the planar reflection resolution for crisp stalk & sky reflections.
		const maxResolutionScale = isUltra
			? ( isMobile ? REFLECTION_ULTRA_MOBILE_SCALE : REFLECTION_ULTRA_DESKTOP_SCALE )
			: ( isMobile ? REFLECTION_MOBILE_SCALE : REFLECTION_DESKTOP_SCALE )
		const pixelDensity = isUltra
			? ( isMobile ? REFLECTION_ULTRA_MOBILE_DENSITY : REFLECTION_ULTRA_DESKTOP_DENSITY )
			: ( isMobile ? REFLECTION_MOBILE_DENSITY : REFLECTION_DESKTOP_DENSITY )
		const resolutionScale = Math.min( maxResolutionScale, pixelDensity / stage.devicePixelRatio )
		const reflection = reflector( {
			resolutionScale,
			bounces: false,
			generateMipmaps: false,
			samples: 0,
		} )
		this.reflection = reflection
		this.reflectionTarget = reflection.target

		const geo = new PlaneGeometry( WATER_EXTENT, WATER_EXTENT, 1, 1 )
		const material = new MeshBasicNodeMaterial()
		material.fog = false

		// Adapt the dual-flow normal treatment from Three.js' WebGPU water example.
		// Sampling the shared noise map in two coordinate frames avoids a visibly
		// repeating scroll without adding another texture to memory.
		// World-space wave coordinates keep the ripple scale of the original
		// field-sized pond now that the plane reaches the horizon.
		const waterUV = positionWorld.xz.div( FIELD_WIDTH + WATER_PADDING )
		const flowTime = time.mul( 0.025 )
		const waveUV0 = waterUV.mul( vec2( 5, 7 ) ).add( vec2( flowTime, flowTime.mul( 0.7 ) ) )
		const waveUV1 = vec2( waterUV.y, waterUV.x.negate() )
			.mul( vec2( 8, 5 ) )
			.add( vec2( flowTime.mul( -0.55 ), flowTime.mul( 0.9 ) ) )
		const wave0 = texture( this.noiseTexture, waveUV0 ).rg.mul( 2 ).sub( 1 )
		const wave1 = texture( this.noiseTexture, waveUV1 ).gb.mul( 2 ).sub( 1 )
		const waterWave = wave0.add( wave1.mul( 0.6 ) ).mul( 0.625 ).toVar( 'waterWave' )

		material.colorNode = Fn( () => {
			const radialDist = length( positionWorld.xz )
			const detailFade = tslSmoothstep( 42, 240, radialDist ).oneMinus()
			const dampedWave = waterWave.mul( detailFade )
			const surfaceNormal = normalize( vec3( dampedWave.x.mul( 0.14 ), 1, dampedWave.y.mul( 0.14 ) ) )
			const toEye = normalize( cameraPosition.sub( positionWorld ) )
			const viewDir = toEye.negate()
			const theta = max( dot( toEye, surfaceNormal ), 0 )
			const fresnel = pow( float( 1 ).sub( theta ), 5 )
				.mul( 1 - WATER_BASE_REFLECTIVITY )
				.add( WATER_BASE_REFLECTIVITY )

			// Resolve across adjacent reflector texels. This hides the CSS-resolution
			// pixel grid while keeping the reflection sharper and cheaper than the old
			// eight-fetch bicubic path.
			const reflectionUV = reflection.uvNode.add( dampedWave.mul( WATER_DISTORTION ) )
			let softenedReflection
			if ( isMobile ) {
				softenedReflection = reflection.sample( reflectionUV ).rgb
			} else {
				const reflectionTexel = vec2( 1 ).div( viewportSize.mul( resolutionScale ) )
				const softRadius = float( 0.75 ).add( float( 1 ).sub( theta ).mul( 0.75 ) )
				const softOffsetX = reflectionTexel.x.mul( 0.85 ).mul( softRadius )
				const softOffsetY = reflectionTexel.y.mul( 0.55 ).mul( softRadius )
				const reflectionA = reflection.sample( reflectionUV.add( vec2( softOffsetX, softOffsetY ) ) ).rgb
				const reflectionB = reflection.sample( reflectionUV.add( vec2( softOffsetX, softOffsetY.negate() ) ) ).rgb
				const reflectionC = reflection.sample( reflectionUV.add( vec2( softOffsetX.negate(), softOffsetY ) ) ).rgb
				const reflectionD = reflection.sample( reflectionUV.sub( vec2( softOffsetX, softOffsetY ) ) ).rgb
				softenedReflection = reflectionA.add( reflectionB ).add( reflectionC ).add( reflectionD ).mul( 0.25 )
			}
			const facingTint = clamp( theta.mul( 0.8 ), 0, 1 )
			const waterTint = mix(
				vec3( 0.055, 0.04, 0.03 ),
				vec3( 0.12, 0.088, 0.06 ),
				facingTint
			)
			const reflectedWater = softenedReflection.mul( vec3( 1, 0.94, 0.86 ) )
			const reflectionWeight = fresnel.mul( 0.62 ).add( 0.36 )
			// The low sun strikes sparks off the wave normals.
			const sunDirection = vec3( SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z )
			const glint = pow( max( dot( reflect( viewDir, surfaceNormal ), sunDirection ), 0 ), 700 )
				.mul( 1.8 )
				.mul( detailFade )

			const waterSurface = mix( waterTint, reflectedWater, reflectionWeight ).add( color( SUN_GLOW ).mul( glint ) )
			// Blend the plain directly into the directional sky haze so the water's
			// outer boundary matches backgroundNode pixel-for-pixel.
			const horizonMist = this.sampleSky( viewDir, isUltra )
			const mistFade = pow( tslSmoothstep( 34, 380, radialDist ), 0.8 )

			if ( !isUltra ) {
				return vec4( mix( waterSurface, horizonMist, mistFade ), 1 )
			}

			// ULTRA HD: 3rd wind-aligned capillary ripple octave + natural broken
			// sun shimmer on tilted wave facets along the sun reflection path.
			const windVec = vec2( WIND_DIRECTION.x, WIND_DIRECTION.y )
			const windPerp = vec2( -WIND_DIRECTION.y, WIND_DIRECTION.x )
			const capillaryUV = vec2(
				dot( waterUV, windVec ).mul( 18 ),
				dot( waterUV, windPerp ).mul( 10 )
			).sub( vec2( time.mul( 0.085 ), time.mul( 0.025 ) ) )
			const capillaryWave = texture( this.noiseTexture, capillaryUV ).rg.mul( 2 ).sub( 1 )
			const combinedWave = waterWave.add( capillaryWave.mul( 0.35 ) )

			// Wave-tilted normal for sun specular glints across the water ripples
			const glintFade = tslSmoothstep( 65, 340, radialDist ).oneMinus()
			const rippleNormal = normalize( vec3(
				combinedWave.x.mul( 0.18 ),
				float( 1 ),
				combinedWave.y.mul( 0.28 )
			) )
			const reflectedRay = reflect( viewDir, rippleNormal )
			// Stretch the reflection lobe slightly in elevation so wave slopes catch
			// the low sun naturally without painting an artificial stripe.
			const anisoSunDir = normalize( vec3(
				sunDirection.x,
				sunDirection.y.sub( viewDir.y.mul( 0.55 ) ),
				sunDirection.z
			) )
			const sunSpecAlign = max( dot( reflectedRay, anisoSunDir ), 0 )
			const waveFacetMask = tslSmoothstep( -0.1, 0.55, combinedWave.x.mul( 0.6 ).add( combinedWave.y.mul( 0.6 ) ) )

			const softSunShimmer = pow( sunSpecAlign, 90 ).mul( waveFacetMask ).mul( 0.24 )
			const crispSunGlints = pow( sunSpecAlign, 520 ).mul( 1.1 )
			const sunShimmer = softSunShimmer.add( crispSunGlints ).mul( glintFade )
			const shimmerColor = mix( color( SUN_GLOW ), color( 0xFFF5DE ), clamp( crispSunGlints, 0, 1 ) )

			const blendedMist = mix( waterSurface, horizonMist, mistFade )
			return vec4( blendedMist.add( shimmerColor.mul( sunShimmer ) ), 1 )
		} )()

		this.water = new Mesh( geo, material )
		this.water.rotation.x = - Math.PI / 2
		this.water.position.y = WATER_HEIGHT
		this.water.add( this.reflectionTarget )
		stage3d.add( this.water )
	}

	initRiceData() {
		// Calculate total rice stalks needed once; shared across HD / Ultra HD
		this.riceInstances = []

		this.cells.forEach( ( cell ) => {
			// Generate rice positions within this cell
			const cellPadding = cell.padding || 0.3 // Use cell's padding or default
			const borderOffset = 0.5 // Same as border offset
			const totalPadding = cellPadding + borderOffset
			
			// Calculate available space for rice
			const availableWidth = cell.width - totalPadding * 2
			const availableHeight = cell.height - totalPadding * 2
			
			// Only generate rice if there's enough space
			if ( availableWidth > STALK_SPACING && availableHeight > STALK_SPACING ) {
				const riceCountX = Math.max( 1, Math.floor( availableWidth / STALK_SPACING ) )
				const riceCountZ = Math.max( 1, Math.floor( availableHeight / STALK_SPACING ) )
				
				// Center the rice grid within the available space
				const startX = cell.x + totalPadding + ( availableWidth - riceCountX * STALK_SPACING ) / 2
				const startZ = cell.y + totalPadding + ( availableHeight - riceCountZ * STALK_SPACING ) / 2
				
				// Per-parcel darkness : We keep ~half of the ricefield with the "basic color" the rest is multiply by 0.4 -> 1.2
				const cellDarkness = random() > 0.5 ? random( 0.4, 1.2 ) : 1
				
				for ( let x = 0; x < riceCountX; x++ ) {
					for ( let z = 0; z < riceCountZ; z++ ) {
						// Constrain jitter to prevent rice from going outside boundaries
						const maxJitter = Math.min( STALK_JITTER, STALK_SPACING * 0.4 )
						const baseX = startX + x * STALK_SPACING + STALK_SPACING / 2 + random( -0.5, 0.5 ) * maxJitter - this.centerOffsetX
						const baseZ = startZ + z * STALK_SPACING + STALK_SPACING / 2 + random( -0.5, 0.5 ) * maxJitter - this.centerOffsetZ
						const height = random( 2.5, 4 )
						
						// Store instance data: position and scale
						this.riceInstances.push( {
							position: [baseX, 0, baseZ],
							scale: height / 3, // Normalize to base height of 3
							darkness: cellDarkness
						} )
					}
				}
			}
		} )
		
		// Create storage buffer BEFORE MeshLine
		// Three.js r181+ requires storage buffers to exist when shader hooks reference them
		this.scaleStorageBuffer = new StorageInstancedBufferAttribute( this.riceInstances.length, 2 )
		this.transformStorageBuffer = new StorageInstancedBufferAttribute( this.riceInstances.length, 4 )
		for ( let i = 0; i < this.riceInstances.length; i++ ) {
			const instance = this.riceInstances[i]
			this.scaleStorageBuffer.setXY( i, 1, instance.darkness )
			this.transformStorageBuffer.setXYZW(
				i,
				instance.position[0],
				instance.position[1],
				instance.position[2],
				instance.scale
			)
		}
		this.scaleStorageBuffer.needsUpdate = true
		this.transformStorageBuffer.needsUpdate = true
	}

	initRiceMeshes() {
		const isUltra = this.quality === 'ultra'
		const stalkSegments = isUltra ? STALK_SEGMENTS_ULTRA : STALK_SEGMENTS_HD

		// Create a single rice stalk template (vertical line)
		const templatePositions = new Float32Array( stalkSegments * 3 )
		for ( let i = 0; i < stalkSegments; i++ ) {
			const t = i / ( stalkSegments - 1 )
			templatePositions[i * 3] = 0      // x
			templatePositions[i * 3 + 1] = t * 3  // y (base height of 3)
			templatePositions[i * 3 + 2] = 0      // z
		}

		// These values are invariant for the current/previous/next samples that
		// MeshLine evaluates for each vertex. Share them so wind and storage reads
		// are emitted once instead of three times in the vertex shader.
		const transformStorage = storage( this.transformStorageBuffer, 'vec4', this.riceInstances.length )
		const instanceTransform = transformStorage.element( instanceIndex ).toVar( 'riceInstanceTransform' )
		const instanceStateStorage = storage( this.scaleStorageBuffer, 'vec2', this.riceInstances.length )
		const instanceState = instanceStateStorage.element( instanceIndex ).toVar( 'riceInstanceState' )
		const storageScale = instanceState.x
		const parcelDarkness = instanceState.y
		const finalScale = instanceTransform.w.mul( storageScale ).toVar( 'riceFinalScale' )
		const scaleInfluence = tslSmoothstep( 0.55, 1, finalScale ).toVar( 'riceScaleInfluence' )
		const colorVariation = fract( sin( float( instanceIndex ).mul( 12.9898 ) ).mul( 43758.5453 ) )
			.toVar( 'riceColorVariation' )
		// Static low-frequency noise creates broad, coherent green patches. Unlike
		// the wind sample below, this UV never moves, so each parcel keeps its tint.
		const fieldTintUV = vec2(
			instanceTransform.x.div( FIELD_WIDTH ).mul( 2.15 ).add( 0.37 ),
			instanceTransform.z.div( FIELD_HEIGHT ).mul( 1.75 ).add( 0.19 )
		).toVar( 'riceFieldTintUV' )
		const fieldTintSample = texture( this.noiseTexture, fieldTintUV ).rgb.toVar( 'riceFieldTintSample' )
		const fieldTint = tslSmoothstep(
			0.32,
			0.68,
			fieldTintSample.r.mul( 0.75 ).add( fieldTintSample.g.mul( 0.25 ) )
		).toVar( 'riceFieldTint' )

		// Domain-warped two-octave wind field: advect a coarse noise layer along
		// WIND_DIRECTION and use it to warp a finer layer and the gust phase so
		// wind waves curve and billow organically instead of forming straight stripes.
		const fieldUV = vec2(
			instanceTransform.x.div( FIELD_WIDTH ),
			instanceTransform.z.div( FIELD_HEIGHT )
		).toVar( 'riceFieldUV' )
		const windDrift = vec2( WIND_DIRECTION.x, WIND_DIRECTION.y ).mul( time.mul( 0.075 ) )
		const windPrimary = texture( this.noiseTexture, fieldUV.mul( 0.75 ).sub( windDrift ) ).rgb.toVar( 'riceWindPrimary' )
		const windSecondaryUV = fieldUV.mul( 1.45 )
			.sub( windDrift.mul( 1.65 ) )
			.add( windPrimary.rg.sub( 0.5 ).mul( 0.38 ) )
		const windSecondary = texture( this.noiseTexture, windSecondaryUV ).rgb.toVar( 'riceWindSecondary' )
		const windDirection = windPrimary.rg.sub( 0.32 )
			.add( windSecondary.rg.sub( 0.38 ).mul( 0.65 ) )
			.toVar( 'riceWindDirection' )
		const windStrength = sin( time.mul( 0.45 ) ).mul( 0.25 ).add( 0.95 ).toVar( 'riceWindStrength' )

		const gustAlong = instanceTransform.x.mul( WIND_DIRECTION.x ).add( instanceTransform.z.mul( WIND_DIRECTION.y ) )
		const gustAcross = instanceTransform.x.mul( -WIND_DIRECTION.y ).add( instanceTransform.z.mul( WIND_DIRECTION.x ) )
		const gustPhaseWarp = windPrimary.r.sub( 0.5 ).mul( 8.5 )
			.add( windSecondary.g.sub( 0.5 ).mul( 4.2 ) )
			.add( sin( gustAcross.mul( 0.085 ).add( time.mul( 0.35 ) ) ).mul( 2.2 ) )
		const gustWave = sin( gustAlong.mul( 0.21 ).add( gustPhaseWarp ).sub( time.mul( 1.75 ) ) ).mul( 0.5 ).add( 0.5 )
		const gustEnvelope = tslSmoothstep( 0.24, 0.78, windPrimary.b.mul( 0.55 ).add( windSecondary.r.mul( 0.45 ) ) )
		const gust = pow( gustWave, 2.2 ).mul( gustEnvelope ).toVar( 'riceGust' )
		const widthMultiplier = tslSmoothstep( 0.1, 1, storageScale ).mul( 0.7 ).add( 0.3 )
		const sunDirection = vec3( SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z )
		
		// Create instanced MeshLine without width variation to reduce attributes
		this.lines = new MeshLine()
			.lines( templatePositions, false )
			.instances( this.riceInstances.length )
			.color( 0x29330c )
			.lineWidth( 0.1 )
			.widthCallback( ( t ) => ( 1 - smoothstep( 0.4, 1, t ) ) )
			.colorFn( Fn( ( [lineColor, progress, side] ) => {
				// Lush paddy greens at the root and body, warming toward ripe
				// chartreuse-gold only near the upper tips.
				const rootColor = mix( color( 0x0D2416 ), color( 0x202A0B ), fieldTint )
				const bodyColor = mix( color( 0x235E33 ), color( 0x5A781E ), fieldTint )
				const tipColor = mix( color( 0x629644 ), color( 0xB5A438 ), fieldTint )
				const bladeBody = mix( rootColor, bodyColor, tslSmoothstep( 0, 0.55, progress ) )
				const bladeBase = mix( bladeBody, tipColor, tslSmoothstep( 0.56, 1, progress ) )

				// Calm troughs between gusts reveal deeper emerald-olive canopy shadow,
				// while passing gusts bend the upper blades into warm lime and amber-gold.
				const activeGust = gust.mul( scaleInfluence )
				const troughMask = tslSmoothstep( 0, 0.35, activeGust ).oneMinus()
					.mul( tslSmoothstep( 0.22, 0.72, windSecondary.b ).oneMinus() )
					.mul( tslSmoothstep( 0.15, 0.85, progress ) )
				const troughColor = mix( color( 0x133822 ), color( 0x2D4412 ), fieldTint )
				const withTrough = mix( bladeBase, troughColor, troughMask.mul( 0.38 ) )

				const windMidColor = mix( color( 0x7EB53B ), color( 0xAFC23D ), fieldTint )
				const windTipColor = mix( color( 0xD8A63C ), color( 0xF0C054 ), fieldTint )
				const windPalette = mix( windMidColor, windTipColor, tslSmoothstep( 0.45, 0.95, progress ) )
				const windColorMix = clamp( activeGust.mul( tslSmoothstep( 0.22, 0.9, progress ) ).mul( 0.95 ), 0, 0.82 )
				const windShifted = mix( withTrough, windPalette, windColorMix )

				const sideShade = side.mul( 0.075 ).add( 0.925 )
				const parcelShade = parcelDarkness.mul( 0.18 ).add( 0.82 )
				const noiseShade = fieldTintSample.b.mul( 0.12 ).add( 0.9 )
				const stalkShade = colorVariation.mul( 0.06 ).add( 0.97 )
				const shaded = windShifted.mul( sideShade ).mul( parcelShade ).mul( noiseShade ).mul( stalkShade )

				// Subtle warm rim shimmer on the steepest gust crests and backlit tips.
				const stalkPosition = vec3( instanceTransform.x, progress.mul( 3 ).mul( finalScale ), instanceTransform.z )
				const viewVec = cameraPosition.sub( stalkPosition ).normalize()
				const towardSun = max( dot( viewVec.negate(), sunDirection ), 0 )
				const crestRim = pow( activeGust, 2.2 ).mul( 0.18 )
					.add( pow( towardSun, 5 ).mul( 0.14 ) )
					.mul( pow( progress, 2.6 ) )
					.mul( scaleInfluence )
				const lit = shaded.add( color( 0xFFBF5E ).mul( crestRim ) )

				if ( !isUltra ) {
					return vec4( lit, lineColor.a )
				}

				// ULTRA HD: Anisotropic Kajiya-Kay leaf sheen, backlit subsurface
				// translucency (SSS), warm water-surface bounce light, and waterline AO.
				const bendSlope = progress.mul( 0.7 ).mul( scaleInfluence )
				const tangentX = windDirection.x.mul( windStrength ).add( activeGust.mul( WIND_DIRECTION.x ).mul( 1.45 ) ).mul( bendSlope )
				const tangentZ = windDirection.y.mul( windStrength ).add( activeGust.mul( WIND_DIRECTION.y ).mul( 1.45 ) ).mul( bendSlope )
				const bladeTangent = normalize( vec3( tangentX, float( 1 ), tangentZ ) )
				const halfVec = normalize( viewVec.add( sunDirection ) )
				const tDotH = dot( bladeTangent, halfVec )
				const sinTH = max( float( 1 ).sub( tDotH.mul( tDotH ) ), 0 )
				const anisoSpec = pow( sinTH, 24 )
					.mul( tslSmoothstep( 0.25, 0.95, progress ) )
					.mul( float( 1 ).sub( abs( side ).mul( 0.45 ) ) )
					.mul( activeGust.mul( 0.65 ).add( 0.35 ) )
					.mul( 0.22 )

				// Subsurface light transmission through thin leaf edges toward the low sun
				const edgeTranslucency = abs( side ).mul( 0.55 ).add( 0.45 )
				const sss = pow( towardSun, 3.2 )
					.mul( edgeTranslucency )
					.mul( tslSmoothstep( 0.2, 0.95, progress ) )
					.mul( scaleInfluence )
					.mul( 0.24 )
				const sssColor = mix( color( 0x9CE042 ), color( 0xFFCA58 ), progress )

				// Golden bounce light reflected upward from the sunlit paddy water
				const waterBounceMask = tslSmoothstep( 0.04, 0.22, progress )
					.mul( tslSmoothstep( 0.24, 0.58, progress ).oneMinus() )
				const waterBounce = color( 0xFFAE52 ).mul( waterBounceMask.mul( 0.12 ) )
				const rootAO = tslSmoothstep( 0, 0.14, progress ).mul( 0.22 ).add( 0.78 )

				const ultraLit = lit
					.mul( rootAO )
					.add( waterBounce )
					.add( sssColor.mul( sss ) )
					.add( color( 0xFFE3A8 ).mul( anisoSpec ) )

				return vec4( ultraLit, lineColor.a )
			} ) )
			// Add width function that varies with scale
			.widthFn( Fn( ( [width] ) => {
				return width.mul( widthMultiplier )
			} ) )
			.positionFn( Fn( ( [position] ) => {
				// Apply scale to height
				const scaledY = position.y.mul( finalScale )
				
				// Apply wind displacement based on height (more at top) and scale (small rice less affected)
				const heightFactor = position.y.div( 3 ) // 0 to 1 along height
				const bend = heightFactor.mul( heightFactor ).mul( scaleInfluence )
				const windDisplacement = bend.mul( windStrength )
				const gustDisplacement = bend.mul( gust ).mul( 1.35 )
								
				// Final position with the ambient sway plus the passing gust
				const finalX = instanceTransform.x.add( windDirection.x.mul( windDisplacement ) ).add( gustDisplacement.mul( WIND_DIRECTION.x ) )
				const finalZ = instanceTransform.z.add( windDirection.y.mul( windDisplacement ) ).add( gustDisplacement.mul( WIND_DIRECTION.y ) )
				// Bent blades dip a little, so a gust front visibly flattens the rice.
				const finalY = scaledY.sub( gustDisplacement.mul( 0.35 ) )
				
				if ( !isUltra ) {
					return vec3( finalX, finalY, finalZ )
				}

				// ULTRA HD: Smooth 6-segment panicle arch (heavy grain ears bow over near
				// the tip) plus a secondary high-frequency tip flutter in the wind.
				const panicleArch = pow( tslSmoothstep( 0.42, 1, heightFactor ), 1.85 ).mul( scaleInfluence )
				const flutterPhase = time.mul( 5.2 ).add( colorVariation.mul( 6.28 ) ).add( gustAlong.mul( 0.4 ) )
				const tipFlutter = sin( flutterPhase ).mul( 0.08 ).mul( panicleArch ).mul( gust.add( 0.35 ) )
				const archDir = normalize( windDirection.add( vec2( WIND_DIRECTION.x, WIND_DIRECTION.y ).mul( 0.65 ) ) )
				const ultraX = finalX.add( archDir.x.mul( panicleArch.mul( 0.38 ).add( tipFlutter ) ) )
				const ultraZ = finalZ.add( archDir.y.mul( panicleArch.mul( 0.38 ).add( tipFlutter ) ) )
				const ultraY = finalY.sub( panicleArch.mul( 0.22 ) )

				return vec3( ultraX, ultraY, ultraZ )
			} ) )
			.build()

		stage3d.add( this.lines )
		
		// Create field borders around each quadtree cell - batch into single MeshLine
		const allBorderPositions = []
		const borderLoops = []
		
		// Add field borders
		this.cells.forEach( ( cell ) => {
			// Calculate border size: cell size minus padding on both sides, minus 0.5 units from rice
			const cellPadding = cell.padding || 0.3
			const borderOffset = 0.5 // Distance from rice stalks to border
			const actualBorderWidth = cell.width - ( cellPadding + borderOffset ) * 2
			const actualBorderHeight = cell.height - ( cellPadding + borderOffset ) * 2
			
			// Only create border if it's large enough
			if ( actualBorderWidth > 0 && actualBorderHeight > 0 ) {
				// Create positions in XY plane (rectanglePositions returns x,y,0)
				const positions = rectanglePositions( actualBorderWidth, actualBorderHeight, 4 )
				
				// Convert to XZ plane and apply cell offset
				const cellOffsetX = cell.x + cell.width / 2 - this.centerOffsetX
				const cellOffsetZ = cell.y + cell.height / 2 - this.centerOffsetZ
				
				// Create Float32Array for this border
				const borderPositions = new Float32Array( positions.length )
				
				for ( let i = 0; i < positions.length; i += 3 ) {
					borderPositions[i] = positions[i] + cellOffsetX
					borderPositions[i + 1] = 0.02
					borderPositions[i + 2] = positions[i + 1] + cellOffsetZ // original y becomes z
				}
				
				allBorderPositions.push( borderPositions )
				borderLoops.push( true )
			}
		} )
		
		// Create single MeshLine with all borders
		if ( allBorderPositions.length > 0 ) {
			const borderLine = new MeshLine()
				.lines( allBorderPositions, borderLoops )
				.color( 0x8E6A40 ) // Sunlit earth for the field borders
				.lineWidth( isUltra ? 0.18 : 0.15 )
				.join( { type: 'miter', limit: 8 } )
				.usage( StaticDrawUsage )

			if ( isUltra ) {
				// ULTRA HD: Shade paddy bunds as damp earthen dykes with soil grain
				// and a wet specular glint facing the low sun.
				borderLine.colorFn( Fn( ( [baseColor, , side] ) => {
					const soilUV = positionWorld.xz.mul( 0.14 )
					const soilSample = texture( this.noiseTexture, soilUV ).rgb
					const dryEarth = mix( color( 0x5E4328 ), color( 0x9A7244 ), soilSample.r )
					const dampEdge = mix( dryEarth, color( 0x2E1F12 ), pow( abs( side ), 1.4 ).mul( 0.65 ) )
					const crownNormal = normalize( vec3( side.mul( 0.35 ), float( 1 ), side.mul( 0.2 ) ) )
					const toEye = normalize( cameraPosition.sub( positionWorld ) )
					const wetGlint = pow( max( dot( reflect( toEye.negate(), crownNormal ), sunDirection ), 0 ), 36 )
						.mul( soilSample.g.mul( 0.7 ).add( 0.3 ) )
						.mul( 0.55 )
					return vec4( dampEdge.add( color( SUN_GLOW ).mul( wetGlint ) ), baseColor.a )
				} ) )
			}

			this.fieldBorder = borderLine
			stage3d.add( this.fieldBorder )
		}
	}
	
	initCompute() {
		// Storage buffer already created in initRiceData() before MeshLine hooks
		// Create compute shader for scale animation
		this.createComputeShader()
	}
	
	createComputeShader() {
		const count = this.riceInstances.length
		
		// Reuse transformStorageBuffer (xyz = instance position, w = base scale)
		const scaleAttribute = storage( this.scaleStorageBuffer, 'vec2', count )
		const transformAttribute = storage( this.transformStorageBuffer, 'vec4', count )
		
		const currentScale = scaleAttribute.element( instanceIndex ).x
		const instancePos = transformAttribute.element( instanceIndex )
		
		// Create compute update function
		this.computeUpdate = Fn( () => {
			// Calculate distance to mouse for normal interaction
			const mousePos = this.mouseUniform
			const worldPos = vec3( instancePos.x, float( 0 ), instancePos.z )
			const mouseDist = length( sub( worldPos, mousePos ) )
			
			// Calculate distance to shockwave origin for shockwave effect
			const shockwaveOrigin = this.shockwaveOrigin
			const shockwaveDist = length( sub( worldPos, shockwaveOrigin ) )
			
			// Check if within shockwave ring (using fixed shockwave origin)
			const withinShockwave = shockwaveDist.greaterThanEqual( this.cutDistMin ).and( shockwaveDist.lessThanEqual( this.cutDistMax ) )
			
			// If within shockwave, instantly cut the rice
			If( withinShockwave, () => {
				currentScale.assign( 0.01 )
			} ).Else( () => {
				// Normal mouse interaction - Target scale based on distance (3m to 7m falloff)
				// Apply mouse speed multiplier to adjust the interaction radius
				// Also apply area of effect uniform to scale the interaction area
				const adjustedMinDist = float( 1 ).mul( this.mouseSpeedUniform ).mul( this.areaOfEffectUniform )
				const adjustedMaxDist = float( 5 ).mul( this.mouseSpeedUniform ).mul( this.areaOfEffectUniform )
				const targetScale = add( mul( tslSmoothstep( adjustedMinDist, adjustedMaxDist, mouseDist ), 0.99 ), 0.01 )
				
				// Check if we're shrinking (target < current) or growing (target > current)
				If( targetScale.lessThan( currentScale ), () => {
					// Instant shrinking when mouse is near
					currentScale.assign( targetScale )
				} ).Else( () => {
					// Slow growth when mouse moves away
					const growthSpeed = float( 0.1 ) // Fixed growth speed
					const frameTime = float( 0.016 ) // Assuming 60fps, ~16ms per frame
					const diff = sub( targetScale, currentScale )
					
					// Check if we're below 50% for linear growth, or above for bounce easing
					If( currentScale.lessThan( 0.5 ), () => {
						currentScale.addAssign( mul( mul( diff, growthSpeed ), frameTime ) )
					} ).Else( () => {
						currentScale.addAssign( targetScale.sub( currentScale ).mul( 0.05 ) )
					} )
				} )
			} )
			
			// Clamp to valid range
			currentScale.assign( clamp( currentScale, 0.01, 1.0 ) )
			
		} )().compute( count )
	}

	onResize = () => {
		this.lines?.resize()
		this.fieldBorder?.resize()
	}
	
	onMouseMove = ( mouseData ) => {
		// Convert mouse position to normalized device coordinates
		this.mouse.x = mouseData.normalizedX
		this.mouse.y = -mouseData.normalizedY
		
		// Update raycaster with camera and mouse position
		this.raycaster.setFromCamera( this.mouse, stage3d.camera )
		
		// Calculate intersection with ground plane
		const intersection = this.raycaster.ray.intersectPlane( this.groundPlane, _intersectPoint )
		if ( intersection ) this.mouseUniform.value.copy( intersection )
	}
	
	onMouseClick = ( mouseData ) => {
		if ( mouseData?.e?.target?.closest?.( 'button, a, input, select, .lil-gui, .RicefieldQualityHud' ) ) return
		this.mouse.x = mouseData.normalizedX
		this.mouse.y = -mouseData.normalizedY
		this.raycaster.setFromCamera( this.mouse, stage3d.camera )
		const intersection = this.raycaster.ray.intersectPlane( this.groundPlane, _intersectPoint )
		if ( intersection ) this.createShockwave( intersection )
		this.hint?.hide()
	}
	
	createShockwave( clickPoint ) {
		if ( this.shockwaveTarget ) utils.remove( this.shockwaveTarget )
		this.shockwaveTarget = { min: 1, max: 6 }
		this.cutDistMin.value = 0
		this.cutDistMax.value = 0
		
		this.shockwaveOrigin.value.set( clickPoint.x, 0, clickPoint.z )
		
		animate( this.shockwaveTarget, {
			min: 70, // Final inner radius
			max: 95, // Final outer radius
			duration: 1.1,
			ease: 'inOutQuad',
			onUpdate: () => {
				if ( !this.shockwaveTarget ) return
				this.cutDistMin.value = this.shockwaveTarget.min
				this.cutDistMax.value = this.shockwaveTarget.max
			},
			onComplete: () => {
				this.cutDistMin.value = 0
				this.cutDistMax.value = 0
			}
		} )
	}

	disposeVisualMeshes() {
		const disposeObj = ( o ) => {
			if ( !o ) return null
			stage3d.remove( o )
			// Prefer the object's own dispose() when defined — MeshLine cleans up
			// auto-resize listeners and instance buffers internally.
			if ( typeof o.dispose === 'function' ) o.dispose()
			else {
				o.geometry?.dispose()
				o.material?.dispose()
			}
			return null
		}
		for ( const k of ['lines', 'fieldBorder', 'water'] ) {
			this[k] = disposeObj( this[k] )
		}

		this.reflectionTarget?.removeFromParent()
		this.reflectionTarget = null
		this.reflection?.dispose()
		this.reflection = null
	}

	dispose() {
		if ( this.shockwaveTarget ) {
			utils.remove( this.shockwaveTarget )
			this.shockwaveTarget = null
		}
		stage.onResize.remove( this.onResize )
		stage.onUpdate.remove( this.updateCompute )
		stage.onUpdate.remove( this.updateMouseSpeed )
		onMove.remove( this.onMouseMove )
		onClick.remove( this.onMouseClick )
		keyboard.onDown.remove( this.onKeyDown )

		this.disposeVisualMeshes()

		this.noiseTexture?.dispose()
		this.noiseTexture = null
		this.computeUpdate?.dispose()
		this.scaleStorageBuffer = null
		this.transformStorageBuffer = null
		this.computeUpdate = null
		this.cells = []
		this.riceInstances = []
		stage3d.control?.dispose()
		stage3d.scene.backgroundNode = null
		stage3d.scene.fog = null
		this.bloom?.dispose()
		this.bloom = null
		this.hint?.remove()
		this.hint = null
		this.hud?.remove()
		this.hud = null
		this.hudButtons = {}
	}

	show() {
		// Start the compute shader updates
		if ( this.computeUpdate ) {
			stage.onUpdate.add( this.updateCompute )
		}
		// Add mouse speed tracking
		stage.onUpdate.add( this.updateMouseSpeed )
	}
	
	hide( cb ) { 
		// Stop compute shader updates
		stage.onUpdate.remove( this.updateCompute )
		stage.onUpdate.remove( this.updateMouseSpeed )
		if ( cb ) cb() 
	}
	
	updateCompute = () => {
		// Run the compute shader each frame
		if ( this.computeUpdate && stage3d.renderer ) {
			stage3d.renderer.compute( this.computeUpdate )
		}
	}
	
	updateMouseSpeed = ( dt ) => {
		const distance = Math.sqrt( mouse.moveX * mouse.moveX + mouse.moveY * mouse.moveY )
		this.targetMouseSpeed = distance / ( dt / 16 || 1 )
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, this.targetMouseSpeed, 0.15 )
		this.mouseSpeedUniform.value = MathUtils.clamp( 1 + this.mouseSpeed * 0.1, 1, 3 )
		
		// Update area of effect based on mouse movement
		const isMouseMoving = distance > 1 // Threshold to detect if mouse is moving

		if ( isMouseMoving ) {
			this.areaOfEffectUniform.value += ( 1 - this.areaOfEffectUniform.value ) * 0.15
		} else {
			// Mouse stopped - decrease by 0.95 per frame
			this.areaOfEffectUniform.value *= 0.95
		}
	}
	
}

export default RicefieldExample
