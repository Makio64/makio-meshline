/** Staging of the Road Builder demo: fog, lights and the rolling terrain the road is fitted to. */
import { BufferAttribute, DirectionalLight, Fog, HemisphereLight, MathUtils, Mesh, MeshStandardNodeMaterial, PlaneGeometry } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { terrainHeight } from '@/utils/surfaceRoadRoute'

export const SKY_COLOR = 0x9CC2D6
const SHADOW_EXTENT = 78

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

function createTerrain() {
	// Wide enough that the fog, not a hard edge, meets the sky at the horizon. The
	// hills are long and smooth, so 2.6 m cells still track the analytic height the
	// clearance fit uses to within a millimetre.
	const geometry = new PlaneGeometry( 420, 420, 160, 160 )
	geometry.rotateX( -Math.PI / 2 )
	const position = geometry.getAttribute( 'position' )
	const colors = new Float32Array( position.count * 3 )

	for ( let index = 0; index < position.count; index++ ) {
		const height = terrainHeight( position.getX( index ), position.getZ( index ) )
		position.setY( index, height )
		// Ridges dry out, hollows stay lush: cheap variation without a texture.
		const dryness = MathUtils.clamp( height * 0.22 + 0.5, 0, 1 )
		colors.set( [0.86 + dryness * 0.26, 1.02 - dryness * 0.12, 0.82 + dryness * 0.1], index * 3 )
	}

	geometry.setAttribute( 'color', new BufferAttribute( colors, 3 ) )
	geometry.computeVertexNormals()

	const terrain = new Mesh( geometry, new MeshStandardNodeMaterial( { color: 0x6D8A4E, roughness: 1, vertexColors: true } ) )
	terrain.receiveShadow = true
	return terrain
}

export function createRoadScenery() {
	stage3d.scene.fog = new Fog( SKY_COLOR, 70, 190 )
	stage3d.renderer.shadowMap.enabled = true
	stage3d.add( new HemisphereLight( 0xE9F4FF, 0x3F4A2C, 2.1 ), createSun(), createTerrain() )
}
