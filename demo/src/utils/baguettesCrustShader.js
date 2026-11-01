/**
 * Crust of the Flying Baguettes demo: a fake 3D loaf for .fragmentColorFn(), with
 * cylinder + slash relief normals, sun and sky light and a crust sheen.
 */
import { cameraPosition, clamp, dot, Fn, max, mix, modelViewMatrix, normalize, pow, select, smoothstep, sqrt, texture, varyingProperty, vec2, vec3, vec4 } from 'three/tsl'
import { Vector3 } from 'three/webgpu'

export const SUN_DIRECTION = vec3( new Vector3( 0.45, 0.5, -0.74 ).normalize() )

// Written by the line's vertex hooks in the demo.
export const vWorldPos = varyingProperty( 'vec3', 'vBaguetteWorldPos' )
export const vScreenDir = varyingProperty( 'vec2', 'vBaguetteScreenDir' )
export const vBake = varyingProperty( 'float', 'vBaguetteBake' )

export function crustShader( map, noise, shadingMode ) {
	// Local slash & crumb relief heightfield from the baguette texture.
	// Note: Three.js flipY=true places the bottom of baguette.png at uv.y=0,
	// so we neutralize the photo's baked bottom shadow first so it doesn't
	// bias the slope or flip shadows when a loaf flies right-to-left.
	const sampleRelief = Fn( ( [uvPoint] ) => {
		const clampedUV = clamp( uvPoint, vec2( 0.002 ), vec2( 0.998 ) )
		const unshadow = smoothstep( 0.42, 0.04, clampedUV.y ).mul( 0.38 ).add( 1 )
		const rgb = texture( map, clampedUV ).rgb.mul( unshadow )
		const lum = dot( rgb, vec3( 0.33, 0.47, 0.20 ) )
		const golden = clamp( rgb.r.sub( rgb.b ).mul( 1.9 ), 0, 1 )
		return golden.mul( 0.55 ).add( lum.mul( 0.45 ) )
	} )

	return Fn( ( [flatColor, uvCoords, , side] ) => {
		// 1. Exact 2D screen/view frame of the line segment:
		// T2 points along the line (+uv.x); B2 points toward the `side = +1` edge (uv.y = 0).
		const T2 = normalize( vScreenDir.add( vec2( 1e-5, 0 ) ) ).toVar()
		const B2 = vec2( T2.y.negate(), T2.x ).toVar()

		// 2. Interior slash (grignes) & crumb relief (aspect-corrected for 668x97).
		const du = 0.0032
		const dv = 0.022
		const hCenter = sampleRelief( uvCoords ).toVar()
		const hPlusT = sampleRelief( uvCoords.add( vec2( du, 0 ) ) ).toVar()
		const hMinusT = sampleRelief( uvCoords.sub( vec2( du, 0 ) ) ).toVar()
		// uv.y = 0 is `side = +1` (+B2); uv.y = 1 is `side = -1` (-B2).
		const hPlusB = sampleRelief( uvCoords.sub( vec2( 0, dv ) ) ).toVar()
		const hMinusB = sampleRelief( uvCoords.add( vec2( 0, dv ) ) ).toVar()

		const blisterUV = vec2( uvCoords.x.mul( 5.5 ).add( vBake.mul( 3.7 ) ), uvCoords.y.mul( 0.9 ).add( vBake.mul( 1.9 ) ) )
		const blister = texture( noise, blisterUV ).rg.sub( 0.5 )

		// Fade relief near the silhouette so the outer cylinder edge stays smoothly rounded.
		const interiorMask = smoothstep( 0.96, 0.35, side.abs() )
		const bumpT = hMinusT.sub( hPlusT ).mul( interiorMask ).add( blister.x.mul( 0.08 ) )
		const bumpB = hMinusB.sub( hPlusB ).mul( interiorMask ).add( blister.y.mul( 0.08 ) )

		// 3. 3D Cylinder + rounded end-caps in the line's (T2, B2) frame, rotated into View Space:
		// Because B2 is `vec2(-T2.y, T2.x)` and `side` is signed across B2, `B2 * cylB`
		// ALWAYS points outward in true screen/view space regardless of line direction!
		const cylB = clamp( side.mul( 1.12 ), -0.95, 0.95 ).toVar()
		const tipT = smoothstep( 0.86, 0.99, uvCoords.x ).mul( 0.78 )
			.sub( smoothstep( 0.14, 0.01, uvCoords.x ).mul( 0.78 ) ).toVar()
		const nT = tipT.add( bumpT.mul( 0.55 ) ).toVar()
		const nB = cylB.add( bumpB.mul( 0.45 ) ).toVar()
		const nZ = sqrt( max( cylB.mul( cylB ).oneMinus().sub( tipT.mul( tipT ).mul( 0.7 ) ), 0.08 ) ).toVar()

		const viewNormal = normalize( vec3( T2.mul( nT ).add( B2.mul( nB ) ), nZ ) ).toVar()

		// 4. Material masks & equalize the photo's baked bottom shadow at uv.y near 0.
		const texRaw = texture( map, uvCoords ).toVar()
		const bakedShadowLift = smoothstep( 0.44, 0.04, uvCoords.y )
		const albedo = flatColor.rgb.mul( mix( vec3( 1 ), vec3( 1.32, 1.38, 1.48 ), bakedShadowLift ) ).toVar()
		const crustMask = smoothstep( 0.20, 0.40, texRaw.r.sub( texRaw.b.mul( 0.85 ) ) ).toVar()

		const neighborAvg = hPlusT.add( hMinusT ).add( hPlusB ).add( hMinusB ).mul( 0.25 )
		const cavity = neighborAvg.sub( hCenter ).mul( interiorMask )
		const creviceAO = clamp( cavity.mul( 1.8 ).oneMinus(), 0.68, 1.08 )
		const earRidge = clamp( cavity.negate().mul( 3.5 ), 0, 1 )

		// 5. Consistent directional sun & sky lighting in View Space:
		// Transform world sun into view space while keeping the sun high above (+Y)
		// and at a grazing forward angle (z = 0.28) so EVERY baguette has its
		// sunlit highlight on the upper/sunward side and its shadow on the underside.
		const sunViewRaw = modelViewMatrix.mul( vec4( SUN_DIRECTION, 0 ) ).xyz
		const keyLight = normalize( vec3( sunViewRaw.x.mul( 0.65 ), max( sunViewRaw.y, 0.68 ), 0.28 ) ).toVar()

		const NdotL = dot( viewNormal, keyLight ).toVar()
		const sunDiffuse = smoothstep( -0.45, 0.75, NdotL ).toVar()

		// Warm bakery subsurface scatter along the light-to-shadow terminator.
		const wrapBand = smoothstep( -0.65, 0.05, NdotL ).mul( smoothstep( -0.05, 0.55, NdotL ).oneMinus() )
		const sssLight = vec3( 1.0, 0.44, 0.08 ).mul( wrapBand ).mul( crustMask.mul( 0.20 ).add( 0.34 ) )

		// Hemispherical summer sky fill: upper side (+Y) gets bright sky, lower side (-Y) gets cool shadow.
		const skyUp = clamp( viewNormal.y.mul( 0.5 ).add( 0.5 ), 0, 1 )
		const skyShadow = mix( vec3( 0.38, 0.45, 0.64 ), vec3( 0.56, 0.64, 0.80 ), skyUp )
		const sunLitColor = vec3( 1.26, 1.14, 0.95 )

		const directLight = mix( skyShadow, sunLitColor, sunDiffuse ).add( sssLight )
		const litRGB = albedo.mul( directLight ).mul( creviceAO ).toVar()

		// Crispy glazed crust specular + bright highlights on the raised slash ears (grignes).
		const halfVec = normalize( keyLight.add( vec3( 0, 0, 1 ) ) )
		const NdotH = max( dot( viewNormal, halfVec ), 0 )
		const specGate = smoothstep( -0.05, 0.40, NdotL )
		const specBroad = pow( NdotH, 16 ).mul( crustMask ).mul( 0.22 )
		const specCrisp = pow( NdotH, 42 ).mul( crustMask.mul( 0.5 ).add( earRidge.mul( 1.4 ) ) ).mul( 0.28 )
		litRGB.addAssign( vec3( 1.0, 0.90, 0.66 ).mul( specBroad.add( specCrisp ) ).mul( specGate ) )

		// 3D Fresnel rim on the sunlit upper edge + solar backlight when passing in front of the sun.
		const V = normalize( cameraPosition.sub( vWorldPos ) )
		const fresnel = pow( clamp( viewNormal.z, 0, 1 ).oneMinus(), 2.6 )
		const sunBacklight = pow( max( dot( V.negate(), SUN_DIRECTION ), 0 ), 3 ).mul( 0.5 )
		const rimStrength = fresnel.mul( smoothstep( 0.0, 0.7, NdotL ).mul( 0.30 ).add( sunBacklight ) )
		litRGB.addAssign( vec3( 1.0, 0.85, 0.54 ).mul( rimStrength ).mul( crustMask.mul( 0.55 ).add( 0.45 ) ) )

		// Normal-map inspection view shows the true 3D view-space normal (X=right, Y=up, Z=front).
		const normalPreview = viewNormal.mul( 0.5 ).add( 0.5 )
		const isNormals = shadingMode.greaterThan( 1.5 )
		const shadedColor = select( isNormals, normalPreview, litRGB )

		const isFlat = shadingMode.lessThan( 0.5 )
		return vec4( select( isFlat, flatColor.rgb, shadedColor ), flatColor.a )
	} )
}
