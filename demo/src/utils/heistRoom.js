import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mix, reflector, vec3, vec4 } from 'three/tsl'
import { ACESFilmicToneMapping, AmbientLight, BoxGeometry, CylinderGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardNodeMaterial, PlaneGeometry, PMREMGenerator, SphereGeometry, SpotLight } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import { TWO_PI } from '@/makio/utils/math'
import random from '@/makio/utils/random'
import { centerAndScaleModel } from '@/utils/modelUtils'

export const ROOM_SIZE = 10
const ROOM_HEIGHT = 8

function initEnvironment() {
	const environment = new RoomEnvironment()
	const pmrem = new PMREMGenerator( stage3d.renderer )
	stage3d.scene.environment = stage3d.own( pmrem.fromScene( environment ).texture )
	stage3d.scene.environmentIntensity = 0.25
	environment.dispose()
	pmrem.dispose()
}

async function loadSuzanne( shadows ) {
	const { scene: suzanne } = await new GLTFLoader().loadAsync( '/models/suzanne.glb' )
	centerAndScaleModel( suzanne, 3 )

	suzanne.traverse( object => {
		if ( !object.isMesh ) return
		object.material = new MeshStandardNodeMaterial( { color: 0xd4a017, metalness: 0.95, roughness: 0.15 } )
		object.castShadow = shadows
		object.receiveShadow = shadows
	} )

	suzanne.position.y = 2.5
	stage3d.add( suzanne )
	return suzanne
}

function addFloor( shadows ) {
	// Reflective floor. The 0.04-wide lasers are sub-pixel in a reduced
	// reflection, so without multisampling they break into dotted dashes;
	// 4x MSAA on a half-resolution target keeps them continuous for far less
	// than a full-resolution reflection costs.
	const reflection = stage3d.own( reflector( {
		resolutionScale: isMobile ? 0.35 : 0.5,
		bounces: false,
		generateMipmaps: false,
		samples: isMobile ? 0 : 4,
	} ) )
	reflection.target.rotateX( -Math.PI / 2 )
	stage3d.add( reflection.target )

	const floorMaterial = new MeshStandardNodeMaterial( { metalness: 0.05, roughness: 0.15 } )
	floorMaterial.colorNode = vec4( mix( vec3( 0.03, 0.03, 0.04 ), reflection.rgb, 0.6 ), 1 )
	const floor = new Mesh( new PlaneGeometry( ROOM_SIZE, ROOM_SIZE ), floorMaterial )
	floor.rotation.x = -Math.PI / 2
	floor.position.y = 0.01
	floor.receiveShadow = shadows
	stage3d.add( floor )

	// Metallic cube under the reflector. Lowered slightly to avoid z-fighting with the floor at Y=0.01.
	const baseCube = new Mesh(
		new BoxGeometry( ROOM_SIZE, 1, ROOM_SIZE ),
		new MeshStandardNodeMaterial( { color: 0x3a3632, metalness: 0.05, roughness: 0.85 } ),
	)
	baseCube.position.y = -0.51
	baseCube.receiveShadow = shadows
	stage3d.add( baseCube )
}

function addPedestal( shadows ) {
	const pedestal = new Mesh(
		new CylinderGeometry( 0.8, 1, 1.5, 16 ),
		new MeshStandardNodeMaterial( { color: 0x2a2826, roughness: 0.7, metalness: 0.1 } ),
	)
	pedestal.position.y = 0.75
	pedestal.castShadow = shadows
	pedestal.receiveShadow = shadows
	stage3d.add( pedestal )
}

// A warm, focused key light gives the exhibit a clear visual hierarchy.
// Coarse/mobile devices keep the light but skip its extra shadow pass.
function addKeyLight( target, shadows ) {
	const spotlight = new SpotLight( 0xffdfb5, 22 )
	spotlight.position.set( -1.4, ROOM_HEIGHT - 1, 2.2 )
	spotlight.target = target
	spotlight.angle = 0.36
	spotlight.penumbra = 0.78
	spotlight.decay = 1.6
	spotlight.distance = 18
	spotlight.castShadow = shadows
	spotlight.shadow.mapSize.set( 512, 512 )
	spotlight.shadow.camera.near = 0.5
	spotlight.shadow.camera.far = 18
	spotlight.shadow.bias = -0.0002
	spotlight.shadow.normalBias = 0.025
	spotlight.shadow.radius = 3
	stage3d.add( spotlight )
}

/** The exhibit the lasers guard: a gold Suzanne on a pedestal, a reflective floor and its lights. */
export async function createHeistRoom( { shadows } ) {
	initEnvironment()
	const suzanne = await loadSuzanne( shadows )

	stage3d.renderer.toneMapping = ACESFilmicToneMapping
	stage3d.renderer.shadowMap.enabled = shadows

	addFloor( shadows )
	addPedestal( shadows )
	stage3d.add( new AmbientLight( 0x0c0c0d, 0.12 ) )
	addKeyLight( suzanne, shadows )
}

// Distance from origin (the pedestal) to segment A-B in the X/Z plane
const distToCenter = ( ax, az, bx, bz ) => Math.abs( bx * az - ax * bz ) / Math.hypot( bx - ax, bz - az )
const clusteredY = () => 0.2 + Math.pow( random( 0, 1 ), 2.5 ) * ( ROOM_HEIGHT * 0.9 )

export function generateBeams( count ) {
	const wall = ROOM_SIZE / 2
	const jitter = wall * 0.3
	const beams = []

	while ( beams.length < count ) {
		const isXAxis = random( 0, 1 ) > 0.5
		const lane = random( -wall * 0.8, wall * 0.8 )
		const startLane = lane + random( -jitter, jitter )
		const endLane = lane + random( -jitter, jitter )
		const [startX, startZ, endX, endZ] = isXAxis
			? [-wall, startLane, wall, endLane]
			: [startLane, -wall, endLane, wall]

		// Skip lasers passing through the central pedestal
		if ( distToCenter( startX, startZ, endX, endZ ) < 2.5 ) continue

		beams.push( {
			start: [startX, clusteredY(), startZ],
			end: [endX, clusteredY(), endZ],
			phase: random( 0, TWO_PI ),
		} )
	}

	return beams
}

// Emitter spheres at both ends of each laser
export function createEmitters( beams ) {
	const emitters = new InstancedMesh(
		new SphereGeometry( 0.08, 8, 8 ),
		new MeshStandardNodeMaterial( {
			color: 0x000000,
			emissive: 0xff0000,
			emissiveIntensity: 3,
			roughness: 0.9,
			metalness: 0.2,
		} ),
		beams.length * 2,
	)

	const matrix = new Matrix4()
	beams.flatMap( beam => [beam.start, beam.end] ).forEach( ( point, index ) => {
		emitters.setMatrixAt( index, matrix.makeTranslation( ...point ) )
	} )
	return emitters
}
