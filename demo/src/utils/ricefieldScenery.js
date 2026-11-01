/**
 * Ricefield scenery: the golden-hour sky and the flooded plain that mirrors it.
 * Neither uses MeshLine, they only give the rice something to stand in.
 */
import { atan, cameraPosition, clamp, color, dot, float, Fn, length, max, mix, normalize, positionWorld, positionWorldDirection, pow, reflect, reflector, sin, smoothstep, texture, time, vec2, vec3, vec4, viewportSize } from 'three/tsl'
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import { isMobile } from '@/makio/utils/detect'

// Golden hour: a low sun straight ahead of the opening camera, a warm haze on
// the horizon, and gusts that roll across the paddies toward the viewer.
export const SUN_DIRECTION = new Vector3( -0.86, 0.05, -0.5 ).normalize()
export const WIND_DIRECTION = new Vector2( 0.62, 0.78 ).normalize()
export const SKY_HORIZON = 0xFFBB74
export const SUN_GLOW = 0xFFD7A0
const SKY_ZENITH = 0x2A3767
const SKY_MAUVE = 0x9C7C9A
const SKY_APRICOT = 0xEFA27A
const HAZE = 0xF4B376

// The flooded plain runs on past the terraces and melts into the haze.
const WATER_EXTENT = 2400
const WATER_HEIGHT = -0.02
const WATER_BASE_REFLECTIVITY = 0.08
const WATER_DISTORTION = 0.002
// World-space UVs, so the ripples keep their size out to the horizon.
const RIPPLE_SCALE = 72
const REFLECTION_HD = isMobile ? { maxScale: 0.5, density: 0.75 } : { maxScale: 1, density: 1.25 }
const REFLECTION_ULTRA = isMobile ? { maxScale: 0.75, density: 1.1 } : { maxScale: 1.25, density: 2 }

function sampleSky( direction, noiseTexture, isUltra ) {
	const sun = vec3( SUN_DIRECTION )
	const elevation = direction.y
	const skyElevation = max( elevation, 0 )
	// Warm well above the horizon: the canals mirror this band of the sky.
	const lowSky = mix( color( SKY_HORIZON ), color( SKY_APRICOT ), smoothstep( 0, 0.3, skyElevation ) )
	const midSky = mix( lowSky, color( SKY_MAUVE ), smoothstep( 0.35, 0.75, skyElevation ) )
	const sky = mix( midSky, color( SKY_ZENITH ), smoothstep( 0.6, 1, skyElevation ) )
	// Thin cloud streaks low in the sky, lit from below by the sun.
	const cloudUV = direction.xz.div( skyElevation.add( 0.12 ) ).mul( vec2( 0.05, 0.16 ) ).add( 0.31 )
	const cloudNoise = texture( noiseTexture, cloudUV ).r
	const cloudMask = smoothstep( 0.55, 0.78, cloudNoise )
		.mul( smoothstep( 0.02, 0.065, elevation ) )
		.mul( smoothstep( 0.16, 0.42, elevation ).oneMinus() )
	const clouded = mix( sky, color( 0xF29A78 ), cloudMask.mul( 0.55 ) )
	// Below the horizon, keep a continuous warm mist that matches the horizon
	// base so the distant water plane dissolves into it without any seam.
	const lowerMist = mix( color( SKY_HORIZON ), color( HAZE ), smoothstep( 0, 0.25, elevation.negate() ) )
	const horizon = mix( lowerMist, clouded, smoothstep( -0.01, 0.015, elevation ) )
	// A far ridge line whose crest is distinct against the sky while its foot
	// melts into the horizon mist at elevation = 0.
	const azimuth = atan( direction.z, direction.x )
	const ridge = sin( azimuth.mul( 7 ) ).mul( 0.0045 )
		.add( sin( azimuth.mul( 23 ).add( 1.3 ) ).mul( 0.0032 ) )
		.add( sin( azimuth.mul( 61 ).add( 0.4 ) ).mul( 0.0018 ) )
		.add( 0.014 )
	const ridgeCrest = smoothstep( ridge.sub( 0.0025 ), ridge.add( 0.0012 ), elevation ).oneMinus()
	const ridgeFoot = smoothstep( 0, ridge.mul( 0.85 ), elevation )
	const treeLine = ridgeCrest.mul( ridgeFoot )
	const ridgeColor = mix( color( SKY_HORIZON ), color( 0x8C5A48 ), 0.36 )
	let base = mix( horizon, ridgeColor, treeLine )

	// Blend broad atmospheric warmth with mix() rather than raw addition so the
	// sky around the sun never clips into a blown-out yellow dome.
	const horizonDir = normalize( vec3( direction.x, skyElevation, direction.z ) )
	const horizonSun = max( dot( horizonDir, sun ), 0 )
	const belowHorizonAtten = smoothstep( -0.22, 0.02, elevation ).mul( 0.45 ).add( 0.55 )
	const atmosphericWarmth = pow( horizonSun, 4 ).mul( 0.14 )
		.add( pow( horizonSun, 18 ).mul( 0.16 ) )
		.mul( belowHorizonAtten )
	base = mix( base, color( SUN_GLOW ), atmosphericWarmth )

	// A small, soft-edged golden sun disk and tight halo behind the ridge.
	const sunAmount = max( dot( direction, sun ), 0 )
	const aboveRidge = smoothstep( ridge.sub( 0.0015 ), ridge.add( 0.0025 ), elevation )
	const solarCorona = pow( sunAmount, 420 ).mul( 0.18 ).mul( aboveRidge )
	const disk = smoothstep( 0.99987, 0.99996, sunAmount ).mul( 0.62 ).mul( aboveRidge )

	if ( !isUltra ) return base.add( color( SUN_GLOW ).mul( solarCorona.add( disk ) ) )

	// ULTRA HD: Add a distant second mountain range behind the first and a
	// delicate golden rim where the low sun kisses the ridge crest.
	const farRidge = sin( azimuth.mul( 5 ).add( 0.8 ) ).mul( 0.0055 )
		.add( sin( azimuth.mul( 17 ).add( 2.1 ) ).mul( 0.0038 ) )
		.add( sin( azimuth.mul( 43 ).add( 1.1 ) ).mul( 0.002 ) )
		.add( 0.023 )
	const farCrest = smoothstep( farRidge.sub( 0.003 ), farRidge.add( 0.0015 ), elevation ).oneMinus()
	const farFoot = smoothstep( ridge.mul( 0.6 ), farRidge.mul( 0.9 ), elevation )
	const farLayer = farCrest.mul( farFoot ).mul( ridgeCrest.oneMinus() )
	const farRidgeColor = mix( color( SKY_HORIZON ), color( 0x9E6B56 ), 0.2 )
	base = mix( base, farRidgeColor, farLayer )

	const ridgeRim = smoothstep( ridge.sub( 0.003 ), ridge, elevation )
		.mul( ridgeCrest )
		.mul( pow( horizonSun, 12 ) )
		.mul( 0.14 )

	const ultraGlow = solarCorona.add( disk ).add( ridgeRim )
	return base.add( color( SUN_GLOW ).mul( ultraGlow ) )
}

/** The node to assign to `scene.backgroundNode`. */
export const skyBackground = ( noiseTexture, isUltra ) => Fn( () => {
	const direction = positionWorldDirection.normalize()
	return vec4( sampleSky( direction, noiseTexture, isUltra ), 1 )
} )()

// Resolve across adjacent reflector texels: this hides the CSS-resolution pixel grid.
function softenedReflection( reflection, reflectionUV, resolutionScale, theta ) {
	const reflectionTexel = vec2( 1 ).div( viewportSize.mul( resolutionScale ) )
	const softRadius = float( 0.75 ).add( float( 1 ).sub( theta ).mul( 0.75 ) )
	const softOffsetX = reflectionTexel.x.mul( 0.85 ).mul( softRadius )
	const softOffsetY = reflectionTexel.y.mul( 0.55 ).mul( softRadius )
	const reflectionA = reflection.sample( reflectionUV.add( vec2( softOffsetX, softOffsetY ) ) ).rgb
	const reflectionB = reflection.sample( reflectionUV.add( vec2( softOffsetX, softOffsetY.negate() ) ) ).rgb
	const reflectionC = reflection.sample( reflectionUV.add( vec2( softOffsetX.negate(), softOffsetY ) ) ).rgb
	const reflectionD = reflection.sample( reflectionUV.sub( vec2( softOffsetX, softOffsetY ) ) ).rgb
	return reflectionA.add( reflectionB ).add( reflectionC ).add( reflectionD ).mul( 0.25 )
}

// Like MeshLine, dispose() leaves the scene and frees everything it holds.
class Water extends Mesh {
	dispose() {
		this.removeFromParent()
		this.geometry.dispose()
		this.material.dispose()
		this.reflection.dispose()
		super.dispose()
	}
}

export function createWater( noiseTexture, isUltra ) {
	// Keep the reflection at or below CSS-pixel resolution in HD; in Ultra HD
	// boost the planar reflection resolution for crisp stalk & sky reflections.
	const { maxScale, density } = isUltra ? REFLECTION_ULTRA : REFLECTION_HD
	const resolutionScale = Math.min( maxScale, density / stage.devicePixelRatio )
	const reflection = reflector( { resolutionScale, bounces: false } )

	// Adapt the dual-flow normal treatment from Three.js' WebGPU water example.
	// Sampling the shared noise map in two coordinate frames avoids a visibly
	// repeating scroll without adding another texture to memory.
	const waterUV = positionWorld.xz.div( RIPPLE_SCALE )
	const flowTime = time.mul( 0.025 )
	const waveUV0 = waterUV.mul( vec2( 5, 7 ) ).add( vec2( flowTime, flowTime.mul( 0.7 ) ) )
	const waveUV1 = vec2( waterUV.y, waterUV.x.negate() )
		.mul( vec2( 8, 5 ) )
		.add( vec2( flowTime.mul( -0.55 ), flowTime.mul( 0.9 ) ) )
	const wave0 = texture( noiseTexture, waveUV0 ).rg.mul( 2 ).sub( 1 )
	const wave1 = texture( noiseTexture, waveUV1 ).gb.mul( 2 ).sub( 1 )
	const waterWave = wave0.add( wave1.mul( 0.6 ) ).mul( 0.625 ).toVar( 'waterWave' )

	const material = new MeshBasicNodeMaterial()
	material.colorNode = Fn( () => {
		const radialDist = length( positionWorld.xz )
		const detailFade = smoothstep( 42, 240, radialDist ).oneMinus()
		const dampedWave = waterWave.mul( detailFade )
		const surfaceNormal = normalize( vec3( dampedWave.x.mul( 0.14 ), 1, dampedWave.y.mul( 0.14 ) ) )
		const toEye = normalize( cameraPosition.sub( positionWorld ) )
		const viewDir = toEye.negate()
		const theta = max( dot( toEye, surfaceNormal ), 0 )
		const fresnel = pow( float( 1 ).sub( theta ), 5 )
			.mul( 1 - WATER_BASE_REFLECTIVITY )
			.add( WATER_BASE_REFLECTIVITY )

		const reflectionUV = reflection.uvNode.add( dampedWave.mul( WATER_DISTORTION ) )
		const reflected = isMobile
			? reflection.sample( reflectionUV ).rgb
			: softenedReflection( reflection, reflectionUV, resolutionScale, theta )
		const facingTint = clamp( theta.mul( 0.8 ), 0, 1 )
		const waterTint = mix(
			vec3( 0.055, 0.04, 0.03 ),
			vec3( 0.12, 0.088, 0.06 ),
			facingTint
		)
		const reflectedWater = reflected.mul( vec3( 1, 0.94, 0.86 ) )
		const reflectionWeight = fresnel.mul( 0.62 ).add( 0.36 )
		// The low sun strikes sparks off the wave normals.
		const sunDirection = vec3( SUN_DIRECTION )
		const glint = pow( max( dot( reflect( viewDir, surfaceNormal ), sunDirection ), 0 ), 700 )
			.mul( 1.8 )
			.mul( detailFade )

		const waterSurface = mix( waterTint, reflectedWater, reflectionWeight ).add( color( SUN_GLOW ).mul( glint ) )
		// Blend the plain directly into the directional sky haze so the water's
		// outer boundary matches backgroundNode pixel-for-pixel.
		const horizonMist = sampleSky( viewDir, noiseTexture, isUltra )
		const mistFade = pow( smoothstep( 34, 380, radialDist ), 0.8 )

		if ( !isUltra ) return vec4( mix( waterSurface, horizonMist, mistFade ), 1 )

		// ULTRA HD: 3rd wind-aligned capillary ripple octave + natural broken
		// sun shimmer on tilted wave facets along the sun reflection path.
		const windVec = vec2( WIND_DIRECTION )
		const windPerp = vec2( -WIND_DIRECTION.y, WIND_DIRECTION.x )
		const capillaryUV = vec2(
			dot( waterUV, windVec ).mul( 18 ),
			dot( waterUV, windPerp ).mul( 10 )
		).sub( vec2( time.mul( 0.085 ), time.mul( 0.025 ) ) )
		const capillaryWave = texture( noiseTexture, capillaryUV ).rg.mul( 2 ).sub( 1 )
		const combinedWave = waterWave.add( capillaryWave.mul( 0.35 ) )

		// Wave-tilted normal for sun specular glints across the water ripples
		const glintFade = smoothstep( 65, 340, radialDist ).oneMinus()
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
		const waveFacetMask = smoothstep( -0.1, 0.55, combinedWave.x.mul( 0.6 ).add( combinedWave.y.mul( 0.6 ) ) )

		const softSunShimmer = pow( sunSpecAlign, 90 ).mul( waveFacetMask ).mul( 0.24 )
		const crispSunGlints = pow( sunSpecAlign, 520 ).mul( 1.1 )
		const sunShimmer = softSunShimmer.add( crispSunGlints ).mul( glintFade )
		const shimmerColor = mix( color( SUN_GLOW ), color( 0xFFF5DE ), clamp( crispSunGlints, 0, 1 ) )

		const blendedMist = mix( waterSurface, horizonMist, mistFade )
		return vec4( blendedMist.add( shimmerColor.mul( sunShimmer ) ), 1 )
	} )()

	const water = new Water( new PlaneGeometry( WATER_EXTENT, WATER_EXTENT ), material )
	water.rotation.x = - Math.PI / 2
	water.position.y = WATER_HEIGHT
	water.reflection = reflection
	water.add( reflection.target )
	return water
}
