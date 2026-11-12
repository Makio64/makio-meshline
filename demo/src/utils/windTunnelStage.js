/** Staging of the Wind Tunnel demo: the live reflections of the car, the wet floor, the ducts and the glow pass. */
import { MeshLine } from 'makio-meshline'
import { cameraPosition, color, cubeTexture, exp, float, Fn, interleavedGradientNoise, length, mix, modelWorldMatrix, normalView, output, positionGeometry, positionLocal, positionViewDirection, positionWorld, positionWorldDirection, reflector, reflectVector, screenCoordinate, screenUV, smoothstep, vec2, vec3, vec4 } from 'three/tsl'
import { ACESFilmicToneMapping, AdditiveBlending, BackSide, CircleGeometry, CubeCamera, CubeRenderTarget, Group, HalfFloatType, HemisphereLight, LinearMipmapLinearFilter, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, PMREMGenerator, Scene, SphereGeometry } from 'three/webgpu'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { linePoints } from '@/utils/points'
import { Z_RESET, Z_SPAWN } from '@/utils/windTunnelCar'

// Layer of what the car mirrors live: enable it on anything worth a reflection.
export const REFLECTED = 1

const HORIZON = 0x0a111e
const ZENITH = 0x010204

// The nozzle the smoke leaves and the collector that swallows it stand this far
// past the two ends of the visible flow.
const NOZZLE_Z = Z_SPAWN + 0.5
const COLLECTOR_Z = Z_RESET + 0.4

// Haze on the horizon towards `direction`, lit down each duct where the tunnel
// carries on out of sight. The sky rises from it and the floor melts into it.
const haze = Fn( ( [direction] ) => color( HORIZON ).add( color( 0x0a2138 ).mul( direction.z.abs().pow( 8 ) ) ) )

const sky = Fn( () => vec4( mix( haze( positionWorldDirection ), color( ZENITH ), smoothstep( 0, 0.45, positionWorldDirection.y.abs() ) ), 1 ) )

/**
 * Light `carRoot`, build the tunnel around it and set up the glow pass.
 * Returns the group to add and the smoke-rake bar the demo moves with the pointer.
 */
export function createTunnelStage( carRoot ) {
	const environment = createLightTunnel()
	stage3d.scene.backgroundNode = sky()
	stage3d.scene.environment = environment
	stage3d.renderer.toneMapping = ACESFilmicToneMapping
	createGlowPass()

	const group = new Group()
	const floor = createFloor( environment )
	const rakeBar = createRakeBar()
	// The light bars draw the highlights; this fill shapes the paint from above without adding any.
	group.add( new HemisphereLight( 0xffffff, 0x0a1020, 1 ), floor, createDucts(), createFloorMarks(), rakeBar )
	mirrorTunnel( carRoot, floor )

	return { group, rakeBar }
}

// Bake a dark hall horizon into the environment so the car has subtle base form,
// while every line highlight on the bodywork and glass comes live from the smoke.
function createLightTunnel() {
	const scene = new Scene()

	const hall = new MeshBasicNodeMaterial( { side: BackSide } )
	hall.colorNode = mix( color( 0x04070c ), color( 0x121e33 ), smoothstep( 0.45, 0, positionLocal.normalize().y.abs() ) )
	scene.add( new Mesh( new SphereGeometry( 30, 32, 16 ), hall ) )

	const pmrem = new PMREMGenerator( stage3d.renderer )
	const target = stage3d.own( pmrem.fromScene( scene ) )
	pmrem.dispose()
	scene.traverse( object => {
		object.geometry?.dispose()
		object.material?.dispose()
	} )
	return target.texture
}

// What moves is mirrored live. Every frame a probe at the heart of the car
// photographs what is on the REFLECTED layer with mipmaps, so the clearcoat and
// canopy mirror crisp filaments (level 0) while the metallic paint and carbon
// trim catch their soft moving glow (level 2.2) in real time.
function mirrorTunnel( carRoot, floor ) {
	const target = stage3d.own( new CubeRenderTarget( 512, {
		type: HalfFloatType,
		generateMipmaps: true,
		minFilter: LinearMipmapLinearFilter,
	} ) )
	const probe = new CubeCamera( 0.05, 60, target )
	probe.position.set( 0, 0.72, 0.05 )
	probe.layers.set( REFLECTED )

	// Local parallax offset so streamlines right above the hood, canopy and fenders
	// reflect onto the surface directly beneath them instead of at infinity.
	const dir = positionWorld.sub( vec3( 0, 0.72, 0.05 ) ).mul( vec3( 0.38, 0.28, 0.24 ) ).add( reflectVector ).normalize()
	const map = cubeTexture( target.texture, dir )
	const coat = map.level( 0 ).rgb
	const sheen = map.level( 2.2 ).rgb
	const grazing = normalView.dot( positionViewDirection ).saturate().oneMinus().pow( 1.8 )
	const fresnel = grazing.mul( 0.55 ).add( 0.45 )

	const mirroredPaint = coat.mul( 5.5 ).add( sheen.mul( 11.0 ) ).mul( fresnel )
	const mirroredGlass = coat.mul( 8.5 ).add( sheen.mul( 4.5 ) ).mul( grazing.mul( 0.4 ).add( 0.6 ) )
	carRoot.traverse( node => {
		if ( node.material?.isMeshPhysicalNodeMaterial ) {
			node.material.emissiveNode = node.material.ior === 2 ? mirroredGlass : mirroredPaint
		}
	} )

	stage3d.listen( stage.onUpdate, () => {
		carRoot.visible = floor.visible = false
		probe.update( stage3d.renderer, stage3d.scene )
		carRoot.visible = floor.visible = true
	} )
}

// 0 on a line the orbiting camera has come up to, 1 on a distant one: the ducts
// and the rake dissolve instead of barring the view.
const clearOfCamera = Fn( () => smoothstep( 4, 10, cameraPosition.distance( modelWorldMatrix.mul( vec4( positionGeometry, 1 ) ).xyz ) ) )

// Taps of the floor's reflection, as [screen rows, weight]: reflections smear
// down the screen, the way they do on a wet floor.
const WET_TAPS = [[0, 0.3], [-1, 0.22], [1, 0.22], [-2, 0.13], [2, 0.13]]

// A wet floor: a smeared mirror of the scene that strengthens at grazing
// angles, over a dark base that melts into the horizon.
function createFloor( environment ) {
	const mirror = stage3d.own( reflector( { resolutionScale: 0.5, generateMipmaps: true, bounces: false } ) )
	// Each pixel shifts its taps by its own fraction of a row, so they blend into a smear instead of five ghosts.
	const jitter = interleavedGradientNoise( screenCoordinate ).sub( 0.5 )
	const mirrored = WET_TAPS.reduce( ( sum, [row, weight] ) => {
		return sum.add( mirror.sample( screenUV.flipX().add( vec2( 0, jitter.add( row ).mul( 0.016 ) ) ) ).level( 2.2 ).rgb.mul( weight ) )
	}, vec3( 0 ) )

	// The studio only grazes the floor, or its far side would glow as a band under the horizon.
	const material = new MeshStandardNodeMaterial( { color: 0x05070b, roughness: 0.5, metalness: 0, envMap: environment, envMapIntensity: 0.3 } )
	const toCamera = cameraPosition.sub( positionWorld ).normalize()
	material.emissiveNode = mirrored.mul( float( 1 ).sub( toCamera.y ).pow( 2.5 ).mul( 0.7 ).add( 0.06 ) )
	material.outputNode = vec4( mix( output.rgb, haze( toCamera ), smoothstep( 6, 20, length( positionWorld.xz ) ) ), 1 )

	const floor = new Mesh( new CircleGeometry( 60, 64 ), material )
	floor.rotation.x = -Math.PI / 2
	floor.add( mirror.target )
	return floor
}

// An arch standing on the floor at depth `z`, as one open polyline.
function arch( width, height, z, radius = 0.7, steps = 10 ) {
	const half = width / 2
	const points = [-half, 0, z]
	for ( const side of [-1, 1] ) {
		for ( let i = 0; i <= steps; i++ ) {
			const angle = ( i / steps ) * Math.PI / 2
			// The left corner sweeps from the wall up to the roof, the right one back down.
			const [x, y] = side < 0 ? [-Math.cos( angle ), Math.sin( angle )] : [Math.sin( angle ), Math.cos( angle )]
			points.push( side * ( half - radius ) + x * radius, height - radius + y * radius, z )
		}
	}
	points.push( half, 0, z )
	return new Float32Array( points )
}

// Each duct is a run of arches that widen and dim as it recedes.
function createDucts() {
	const arches = []
	for ( const [mouth, direction] of [[NOZZLE_Z, 1], [COLLECTOR_Z, -1]] ) {
		for ( let i = 0; i < 7; i++ ) {
			const depth = i * ( 0.7 + i * 0.2 )
			const scale = 1 + depth * 0.075
			arches.push( arch( 5 * scale, 3 * scale, mouth + direction * depth ) )
		}
	}

	const ducts = new MeshLine()
		.lines( arches, false )
		.lineWidth( 0.024 )
		.color( 0x8fd3ff )
		.colorFn( Fn( ( [tint] ) => {
			const depth = positionGeometry.z.sub( positionGeometry.z.greaterThan( 0 ).select( NOZZLE_Z, COLLECTOR_Z ) ).abs()
			return vec4( tint.rgb.mul( exp( depth.mul( -0.42 ) ) ).mul( clearOfCamera() ).mul( 0.55 ), 1 )
		} ) )
		.transparent( true )
		.autoResize()
		.build()
	ducts.material.blending = AdditiveBlending
	ducts.material.depthWrite = false
	ducts.layers.enable( REFLECTED )
	return ducts
}

// Turntable ring under the car and two graduated rails along the test section.
function createFloorMarks() {
	const y = 0.006
	const lines = [linePoints( 129, t => [Math.cos( t * Math.PI * 2 ) * 3.35, y, Math.sin( t * Math.PI * 2 ) * 3.35] )]

	for ( const side of [-1, 1] ) {
		const x = side * 3.6
		lines.push( new Float32Array( [x, y, NOZZLE_Z, x, y, COLLECTOR_Z] ) )
		for ( let z = Math.ceil( COLLECTOR_Z ); z < NOZZLE_Z; z++ ) {
			lines.push( new Float32Array( [x, y, z, x + side * ( z % 5 === 0 ? 0.3 : 0.14 ), y, z] ) )
		}
	}

	const marks = new MeshLine()
		.lines( lines, false )
		.lineWidth( 0.014 )
		.color( 0x5d86b8 )
		.opacity( 0.34 )
		.autoResize()
		.build()
	marks.material.blending = AdditiveBlending
	marks.material.depthWrite = false
	return marks
}

// The emitter bar shown in Smoke Rake mode, moved with the pointer.
function createRakeBar() {
	const rakeBar = new MeshLine()
		.lines( [
			new Float32Array( [-1.3, 0, 0, 1.3, 0, 0] ),
			new Float32Array( [-1.3, -0.14, 0, -1.3, 0.14, 0] ),
			new Float32Array( [1.3, -0.14, 0, 1.3, 0.14, 0] ),
		], false )
		.lineWidth( 0.014 )
		.color( 0xe0f2fe )
		.colorFn( Fn( ( [tint] ) => vec4( tint.rgb.mul( clearOfCamera() ).mul( 0.6 ), 1 ) ) )
		.transparent( true )
		.autoResize()
		.build()
	rakeBar.material.blending = AdditiveBlending
	rakeBar.material.depthWrite = false
	rakeBar.position.z = Z_SPAWN
	rakeBar.visible = false
	return rakeBar
}

// Bloom on the smoke and the lamps, then a vignette that keeps the eye on the car.
function createGlowPass() {
	const { renderPipeline, scenePass, bloomPass } = createBloomPipeline( { strength: 0.4, radius: 0.6, threshold: 0.45 } )
	const vignette = smoothstep( 1.05, 0.3, length( screenUV.sub( 0.5 ).mul( vec2( 1.15, 1.4 ) ) ) ).mul( 0.6 ).add( 0.4 )
	// A grain too fine to see keeps the dark gradients from banding.
	const grain = interleavedGradientNoise( screenCoordinate ).sub( 0.5 ).mul( 0.0012 )
	renderPipeline.outputNode = scenePass.getTextureNode( 'output' ).add( bloomPass ).mul( vignette ).add( grain )
	renderPipeline.needsUpdate = true
}
