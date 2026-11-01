/**
 * Ricefield shading: the wind field every stalk samples, and the colors of the rice and its bunds.
 * None of it is MeshLine API. The demo only hands these nodes to its hooks.
 */
import { abs, cameraPosition, clamp, color, dot, float, Fn, fract, instanceIndex, max, mix, normalize, positionWorld, pow, reflect, sin, smoothstep, storage, texture, time, vec2, vec3, vec4 } from 'three/tsl'

import { SUN_DIRECTION, SUN_GLOW, WIND_DIRECTION } from '@/utils/ricefieldScenery'

export const FIELD_WIDTH = 64
export const FIELD_HEIGHT = 64
export const STALK_HEIGHT = 3

export function riceNodes( transformBuffer, scaleBuffer, noiseTexture ) {
	// These values are invariant for the current/previous/next samples that
	// MeshLine evaluates for each vertex. Share them so wind and storage reads
	// are emitted once instead of three times in the vertex shader.
	const instanceTransform = storage( transformBuffer ).element( instanceIndex ).toVar( 'riceInstanceTransform' )
	const instanceState = storage( scaleBuffer ).element( instanceIndex ).toVar( 'riceInstanceState' )
	const storageScale = instanceState.x
	const parcelDarkness = instanceState.y
	const finalScale = instanceTransform.w.mul( storageScale ).toVar( 'riceFinalScale' )
	const scaleInfluence = smoothstep( 0.55, 1, finalScale ).toVar( 'riceScaleInfluence' )
	const colorVariation = fract( sin( float( instanceIndex ).mul( 12.9898 ) ).mul( 43758.5453 ) ).toVar( 'riceColorVariation' )
	// Static low-frequency noise creates broad, coherent green patches. Unlike
	// the wind sample below, this UV never moves, so each parcel keeps its tint.
	const fieldTintUV = vec2(
		instanceTransform.x.div( FIELD_WIDTH ).mul( 2.15 ).add( 0.37 ),
		instanceTransform.z.div( FIELD_HEIGHT ).mul( 1.75 ).add( 0.19 )
	).toVar( 'riceFieldTintUV' )
	const fieldTintSample = texture( noiseTexture, fieldTintUV ).rgb.toVar( 'riceFieldTintSample' )
	const fieldTint = smoothstep( 0.32, 0.68, fieldTintSample.r.mul( 0.75 ).add( fieldTintSample.g.mul( 0.25 ) ) ).toVar( 'riceFieldTint' )

	// Domain-warped two-octave wind field: advect a coarse noise layer along
	// WIND_DIRECTION and use it to warp a finer layer and the gust phase so
	// wind waves curve and billow organically instead of forming straight stripes.
	const fieldUV = vec2( instanceTransform.x.div( FIELD_WIDTH ), instanceTransform.z.div( FIELD_HEIGHT ) ).toVar( 'riceFieldUV' )
	const windDrift = vec2( WIND_DIRECTION ).mul( time.mul( 0.075 ) )
	const windPrimary = texture( noiseTexture, fieldUV.mul( 0.75 ).sub( windDrift ) ).rgb.toVar( 'riceWindPrimary' )
	const windSecondaryUV = fieldUV.mul( 1.45 )
		.sub( windDrift.mul( 1.65 ) )
		.add( windPrimary.rg.sub( 0.5 ).mul( 0.38 ) )
	const windSecondary = texture( noiseTexture, windSecondaryUV ).rgb.toVar( 'riceWindSecondary' )
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
	const gustEnvelope = smoothstep( 0.24, 0.78, windPrimary.b.mul( 0.55 ).add( windSecondary.r.mul( 0.45 ) ) )
	const gust = pow( gustWave, 2.2 ).mul( gustEnvelope ).toVar( 'riceGust' )
	const widthMultiplier = smoothstep( 0.1, 1, storageScale ).mul( 0.7 ).add( 0.3 )

	return { colorVariation, fieldTint, fieldTintSample, finalScale, gust, gustAlong, instanceTransform, parcelDarkness, scaleInfluence, widthMultiplier, windDirection, windSecondary, windStrength }
}

export function stalkColorFn( rice, isUltra ) {
	const { colorVariation, fieldTint, fieldTintSample, finalScale, gust, instanceTransform, parcelDarkness, scaleInfluence, windDirection, windSecondary, windStrength } = rice
	const sunDirection = vec3( SUN_DIRECTION )

	return Fn( ( [lineColor, progress, side] ) => {
		// Lush paddy greens at the root and body, warming toward ripe
		// chartreuse-gold only near the upper tips.
		const rootColor = mix( color( 0x0D2416 ), color( 0x202A0B ), fieldTint )
		const bodyColor = mix( color( 0x235E33 ), color( 0x5A781E ), fieldTint )
		const tipColor = mix( color( 0x629644 ), color( 0xB5A438 ), fieldTint )
		const bladeBody = mix( rootColor, bodyColor, smoothstep( 0, 0.55, progress ) )
		const bladeBase = mix( bladeBody, tipColor, smoothstep( 0.56, 1, progress ) )

		// Calm troughs between gusts reveal deeper emerald-olive canopy shadow,
		// while passing gusts bend the upper blades into warm lime and amber-gold.
		const activeGust = gust.mul( scaleInfluence )
		const troughMask = smoothstep( 0, 0.35, activeGust ).oneMinus()
			.mul( smoothstep( 0.22, 0.72, windSecondary.b ).oneMinus() )
			.mul( smoothstep( 0.15, 0.85, progress ) )
		const troughColor = mix( color( 0x133822 ), color( 0x2D4412 ), fieldTint )
		const withTrough = mix( bladeBase, troughColor, troughMask.mul( 0.38 ) )

		const windMidColor = mix( color( 0x7EB53B ), color( 0xAFC23D ), fieldTint )
		const windTipColor = mix( color( 0xD8A63C ), color( 0xF0C054 ), fieldTint )
		const windPalette = mix( windMidColor, windTipColor, smoothstep( 0.45, 0.95, progress ) )
		const windColorMix = clamp( activeGust.mul( smoothstep( 0.22, 0.9, progress ) ).mul( 0.95 ), 0, 0.82 )
		const windShifted = mix( withTrough, windPalette, windColorMix )

		const sideShade = side.mul( 0.075 ).add( 0.925 )
		const parcelShade = parcelDarkness.mul( 0.18 ).add( 0.82 )
		const noiseShade = fieldTintSample.b.mul( 0.12 ).add( 0.9 )
		const stalkShade = colorVariation.mul( 0.06 ).add( 0.97 )
		const shaded = windShifted.mul( sideShade ).mul( parcelShade ).mul( noiseShade ).mul( stalkShade )

		// Subtle warm rim shimmer on the steepest gust crests and backlit tips.
		const stalkPosition = vec3( instanceTransform.x, progress.mul( STALK_HEIGHT ).mul( finalScale ), instanceTransform.z )
		const viewVec = cameraPosition.sub( stalkPosition ).normalize()
		const towardSun = max( dot( viewVec.negate(), sunDirection ), 0 )
		const crestRim = pow( activeGust, 2.2 ).mul( 0.18 )
			.add( pow( towardSun, 5 ).mul( 0.14 ) )
			.mul( pow( progress, 2.6 ) )
			.mul( scaleInfluence )
		const lit = shaded.add( color( 0xFFBF5E ).mul( crestRim ) )

		if ( !isUltra ) return vec4( lit, lineColor.a )

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
			.mul( smoothstep( 0.25, 0.95, progress ) )
			.mul( float( 1 ).sub( abs( side ).mul( 0.45 ) ) )
			.mul( activeGust.mul( 0.65 ).add( 0.35 ) )
			.mul( 0.22 )

		// Subsurface light transmission through thin leaf edges toward the low sun
		const edgeTranslucency = abs( side ).mul( 0.55 ).add( 0.45 )
		const sss = pow( towardSun, 3.2 )
			.mul( edgeTranslucency )
			.mul( smoothstep( 0.2, 0.95, progress ) )
			.mul( scaleInfluence )
			.mul( 0.24 )
		const sssColor = mix( color( 0x9CE042 ), color( 0xFFCA58 ), progress )

		// Golden bounce light reflected upward from the sunlit paddy water
		const waterBounceMask = smoothstep( 0.04, 0.22, progress )
			.mul( smoothstep( 0.24, 0.58, progress ).oneMinus() )
		const waterBounce = color( 0xFFAE52 ).mul( waterBounceMask.mul( 0.12 ) )
		const rootAO = smoothstep( 0, 0.14, progress ).mul( 0.22 ).add( 0.78 )

		const ultraLit = lit
			.mul( rootAO )
			.add( waterBounce )
			.add( sssColor.mul( sss ) )
			.add( color( 0xFFE3A8 ).mul( anisoSpec ) )

		return vec4( ultraLit, lineColor.a )
	} )
}

// ULTRA HD: Shade paddy bunds as damp earthen dykes with soil grain and a wet
// specular glint facing the low sun.
export const bundColorFn = noiseTexture => Fn( ( [baseColor, , side] ) => {
	const soilSample = texture( noiseTexture, positionWorld.xz.mul( 0.14 ) ).rgb
	const dryEarth = mix( color( 0x5E4328 ), color( 0x9A7244 ), soilSample.r )
	const dampEdge = mix( dryEarth, color( 0x2E1F12 ), pow( abs( side ), 1.4 ).mul( 0.65 ) )
	const crownNormal = normalize( vec3( side.mul( 0.35 ), float( 1 ), side.mul( 0.2 ) ) )
	const toEye = normalize( cameraPosition.sub( positionWorld ) )
	const wetGlint = pow( max( dot( reflect( toEye.negate(), crownNormal ), vec3( SUN_DIRECTION ) ), 0 ), 36 )
		.mul( soilSample.g.mul( 0.7 ).add( 0.3 ) )
		.mul( 0.55 )
	return vec4( dampEdge.add( color( SUN_GLOW ).mul( wetGlint ) ), baseColor.a )
} )
