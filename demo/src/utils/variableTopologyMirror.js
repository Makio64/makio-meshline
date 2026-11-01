import { cameraFar, cameraNear, cos, float, length, max, perspectiveDepthToViewZ, positionLocal, positionView, pow, reflector, screenUV, smoothstep, transformNormalToView, vec2, vec3 } from 'three/tsl'
import { AdditiveBlending, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

const MIRROR_SPAN = 48
const MIRROR_STRENGTH = 0.14
const MIRROR_DARKNESS = 0.2
const MIRROR_BLUR = 0.5
const MIRROR_DEPTH_FADE = 5
const MIRROR_NORMAL_STRENGTH = 0.14
const MIRROR_NORMAL_FREQUENCY = 0.45
const MIRROR_NORMAL_PROJECTION = 0.025
const MIRROR_TINT = vec3( 0.68, 0.82, 1 )

/** The glossy floor under the Joins & Caps table: a blurred planar reflection that fades with depth. */
export function createMirror() {
	const reflection = stage3d.own( reflector( {
		resolutionScale: 0.5,
		generateMipmaps: true,
		bounces: false,
		depth: true,
		samples: 0,
	} ) )
	reflection.levelNode = float( MIRROR_BLUR * 5 )

	// A shallow procedural normal field bends the sampled reflection while the
	// reflector itself stays planar. The matching depth UV prevents fade halos.
	const normalCoordinate = positionLocal.xy.mul( MIRROR_NORMAL_FREQUENCY )
	const normalDirectionA = vec2( 0.82, 0.57 )
	const normalDirectionB = vec2( -0.34, 0.94 )
	const normalDirectionC = vec2( 0.61, -0.79 )
	const normalNoise = normalDirectionA.mul( cos( normalCoordinate.dot( normalDirectionA ) ) )
		.add( normalDirectionB.mul(
			cos( normalCoordinate.dot( normalDirectionB ).mul( 1.73 ).add( 1.7 ) ).mul( 0.45 )
		) )
		.add( normalDirectionC.mul(
			cos( normalCoordinate.dot( normalDirectionC ).mul( 3.07 ).add( 4.2 ) ).mul( 0.16 )
		) )
	const flatViewNormal = transformNormalToView( vec3( 0, 0, 1 ) )
	const bumpedViewNormal = transformNormalToView(
		vec3( normalNoise.mul( MIRROR_NORMAL_STRENGTH ), 1 ).normalize()
	)
	const normalBend = vec2(
		bumpedViewNormal.x.sub( flatViewNormal.x ).negate(),
		bumpedViewNormal.y.sub( flatViewNormal.y )
	).mul( MIRROR_NORMAL_PROJECTION )
	const mirrorUV = screenUV.flipX().add( normalBend )
	reflection.uvNode = mirrorUV
	const mirrorDepth = reflection.getDepthNode()
	mirrorDepth.uvNode = mirrorUV

	const behindMirror = max(
		0,
		perspectiveDepthToViewZ( mirrorDepth, cameraNear, cameraFar )
			.negate()
			.sub( positionView.z.negate() )
	)
	const depthFade = float( 1 ).sub( smoothstep( 0, MIRROR_DEPTH_FADE, behindMirror ) )
	const edgeFade = float( 1 ).sub(
		smoothstep( 0.04, 0.3, length( positionLocal.xy.div( MIRROR_SPAN ) ) )
	)

	const material = new MeshBasicNodeMaterial()
	material.toneMapped = false
	material.transparent = true
	material.depthWrite = false
	material.blending = AdditiveBlending
	const contrast = float( 1 + MIRROR_DARKNESS * 1.4 )
	material.colorNode = pow( max( reflection.rgb, vec3( 0 ) ), vec3( contrast ) )
		.mul( MIRROR_TINT )
		.mul( MIRROR_STRENGTH )
		.mul( depthFade )
		.mul( edgeFade )

	const mirror = new Mesh( new PlaneGeometry( MIRROR_SPAN, MIRROR_SPAN ), material )
	mirror.rotation.x = -Math.PI / 2
	mirror.position.set( 0, 0, -1.4 )
	mirror.renderOrder = -100
	mirror.frustumCulled = false
	mirror.add( reflection.target )
	stage3d.add( mirror )
}
