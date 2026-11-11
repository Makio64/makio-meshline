/** Staging of the Road Builder demo: sky, fog, lights and the rolling terrain the road is fitted to. */
import { color, cos, Fn, fwidth, mix, normalWorld, positionWorld, positionWorldDirection, sin, texture, vec4 } from 'three/tsl'
import { DirectionalLight, Fog, HemisphereLight, Mesh, MeshStandardNodeMaterial, PlaneGeometry, RepeatWrapping, TextureLoader } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { terrainHeight } from '@/utils/surfaceRoadRoute'

// The haze on the horizon, which the fog fades the terrain into.
export const SKY_COLOR = 0xB9D6E3
const ZENITH_COLOR = 0x5C9CCF
const LUSH_COLOR = 0x3F7B3A
const DRY_COLOR = 0x93A852
const SURVEY_COLOR = 0xF4F8E6
const SHADOW_EXTENT = 78
// Metres from the camera where the haze starts. It is total at the far plane, so nothing is cut off at the horizon.
const FOG_NEAR = 120
// The terrain: 2.6 m cells over the middle, where roads are built, then a rim of cells that widen out to its edge.
const CORE = 210
const EDGE = 600
const CORE_CELLS = 160
const RIM_CELLS = 24

// Metres of height between two contour lines, and how many of them to an index line.
const CONTOUR_STEP = 0.5
const CONTOUR_INDEX = 4
const SURVEY_GRID = 10
const SURVEY_ARM = 0.6

function createSun() {
	const sun = new DirectionalLight( 0xFFF3DA, 3 )
	sun.position.set( -26, 44, 20 )
	sun.castShadow = true
	sun.shadow.mapSize.set( 2048, 2048 )
	sun.shadow.bias = -0.0005
	sun.shadow.normalBias = 0.05
	Object.assign( sun.shadow.camera, { near: 1, far: 170, left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT } )
	sun.shadow.camera.updateProjectionMatrix()
	return sun
}

/**
 * `terrainHeight()` for a shader: the height of the rolling ground under a world
 * XZ node. The road paints itself by how far it stands above this.
 */
export const terrainHeightNode = ground =>
	sin( ground.x.mul( 0.034 ) ).mul( 1.1 )
		.add( cos( ground.y.mul( 0.041 ) ).mul( 0.8 ) )
		.add( sin( ground.x.add( ground.y.mul( 0.6 ) ).mul( 0.019 ) ).mul( 0.7 ) )

/** Metres between the fragment being shaded and the ground under it. */
export const heightAboveGround = positionWorld.y.sub( terrainHeightNode( positionWorld.xz ) )

const sky = Fn( () => {
	const elevation = positionWorldDirection.normalize().y
	return vec4( mix( color( SKY_COLOR ), color( ZENITH_COLOR ), elevation.smoothstep( 0, 0.55 ) ), 1 )
} )

/**
 * The ground as a survey sheet: meadows that dry out towards the ridges, a contour
 * line every half metre of height and a cross every ten metres. All of it comes
 * from the world position, so the hills read at a glance and the ground has
 * something to rush past from the driver's seat. And so anything else can wear
 * the same grass: the road's verges and embankments grow into the meadow they
 * stand on. Those take `grass` alone, since no survey was drawn on an earthwork.
 */
function createGroundColors() {
	const noise = stage3d.own( new TextureLoader().load( '/textures/noises/perlin/rgb-256x256.png' ) )
	noise.wrapS = RepeatWrapping
	noise.wrapT = RepeatWrapping

	const grass = Fn( () => {
		const ground = positionWorld.xz
		// Three octaves of one noise: meadows from above, tufts from a car, blades from the driver's seat.
		const meadows = texture( noise, ground.div( 150 ) ).r
		const tufts = texture( noise, ground.div( 13 ) ).g
		const blades = texture( noise, ground.div( 1.7 ) ).b
		const dryness = positionWorld.y.mul( 0.2 ).add( meadows ).smoothstep( 0.2, 0.9 )
		return mix( color( LUSH_COLOR ), color( DRY_COLOR ), dryness ).mul( tufts.mul( 0.2 ).add( blades.mul( 0.16 ) ).add( 0.82 ) )
	} )()

	const surveyed = Fn( () => {
		const ground = positionWorld.xz
		const height = positionWorld.y
		const slope = normalWorld.xz.length().div( normalWorld.y ).max( 1e-4 )

		// A line `pixels` wide wherever the height crosses a multiple of `interval`.
		const contour = ( interval, pixels ) => {
			const level = height.div( interval )
			const toLine = level.sub( 0.5 ).fract().sub( 0.5 ).abs()
			const perPixel = fwidth( level )
			return toLine.div( perPixel ).smoothstep( pixels - 0.5, pixels + 0.5 ).oneMinus()
				// Level ground would spread its line into a blotch: keep it under a metre wide.
				.mul( toLine.mul( interval ).div( slope ).smoothstep( 0.3, 0.5 ).oneMinus() )
				// Lines a few pixels apart fade out rather than shimmer.
				.mul( perPixel.smoothstep( 0.1, 0.35 ).oneMinus() )
		}
		const contours = contour( CONTOUR_STEP, 0.6 ).mul( 0.16 ).add( contour( CONTOUR_STEP * CONTOUR_INDEX, 1.1 ).mul( 0.2 ) )

		// Metres to the nearest grid line on each axis: a cross is a short stroke of both.
		const toGrid = ground.div( SURVEY_GRID ).sub( 0.5 ).fract().sub( 0.5 ).abs().mul( SURVEY_GRID )
		const perPixel = fwidth( ground )
		const stroke = toGrid.div( perPixel ).smoothstep( 0.4, 1.4 ).oneMinus()
		const arm = toGrid.smoothstep( SURVEY_ARM - 0.1, SURVEY_ARM + 0.1 ).oneMinus()
		const cross = stroke.x.mul( arm.y ).max( stroke.y.mul( arm.x ) )
			.mul( perPixel.length().smoothstep( 0.1, 0.4 ).oneMinus() )

		return mix( grass.mul( contours.oneMinus() ), color( SURVEY_COLOR ), cross.mul( 0.26 ) )
	} )()
	return { grass, surveyed }
}

/** Where a coordinate of the unit plane lands on the ground: evenly across the core, then wider and wider out to the edge. */
const spread = ( u, core ) => {
	const reach = Math.abs( u )
	if ( reach <= core ) return u / core * CORE
	const rim = ( reach - core ) / ( 1 - core )
	return Math.sign( u ) * ( CORE + ( EDGE - CORE ) * rim * ( 0.35 + 0.65 * rim ) )
}

function createTerrain( surveyed ) {
	// Wide enough that the fog, not a hard edge, meets the sky at the horizon, wherever the orbit is panned.
	// The hills are long and smooth, so the 2.6 m cells of the core still track the analytic height the
	// clearance fit uses to within a millimetre, and the rim, where no road goes, gets by with wider ones.
	const cells = CORE_CELLS + RIM_CELLS * 2
	const geometry = new PlaneGeometry( 2, 2, cells, cells )
	geometry.rotateX( -Math.PI / 2 )
	const position = geometry.getAttribute( 'position' )
	for ( let index = 0; index < position.count; index++ ) {
		const x = spread( position.getX( index ), CORE_CELLS / cells )
		const z = spread( position.getZ( index ), CORE_CELLS / cells )
		position.setXYZ( index, x, terrainHeight( x, z ), z )
	}
	geometry.computeVertexNormals()

	const material = new MeshStandardNodeMaterial( { roughness: 1 } )
	material.colorNode = surveyed
	const terrain = new Mesh( geometry, material )
	terrain.receiveShadow = true
	return terrain
}

/** Build the staging, and hand back the colour node of its grass for whatever is to blend into the meadow. */
export function createRoadScenery() {
	const { grass, surveyed } = createGroundColors()
	stage3d.scene.backgroundNode = sky()
	stage3d.scene.fog = new Fog( SKY_COLOR, FOG_NEAR, stage3d.camera.far )
	stage3d.renderer.shadowMap.enabled = true
	stage3d.add( new HemisphereLight( 0xE9F4FF, 0x3F4A2C, 2.1 ), createSun(), createTerrain( surveyed ) )
	return { grass }
}
