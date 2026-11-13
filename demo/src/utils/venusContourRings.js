import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FrontSide, MathUtils, Ray, Vector3 } from 'three/webgpu'
import { MeshBVH } from 'three-mesh-bvh'

import { centerAndScaleModel } from '@/utils/modelUtils'
import { times } from '@/utils/points'

const MODEL_SIZE = 12

const ray = new Ray()

// Bake a scaled model into a single world-space BVH, so ring rays stay in world space.
function createModelBVH( model ) {
	const parts = []
	model.traverse( object => {
		if ( object.isMesh ) parts.push( object.geometry.clone().applyMatrix4( object.matrixWorld ) )
	} )
	return new MeshBVH( mergeGeometries( parts ), { indirect: true } )
}

// One closed contour at height `y`: rays shot inward from a circle keep the first surface they meet.
function sampleRing( bvh, y, radius, sampleCount ) {
	const hits = times( sampleCount, i => {
		const angle = i / sampleCount * Math.PI * 2
		ray.direction.set( -Math.cos( angle ), 0, -Math.sin( angle ) )
		ray.origin.set( 0, y, 0 ).addScaledVector( ray.direction, -radius )
		return bvh.raycastFirst( ray, FrontSide )?.point
	} )

	// A miss repeats the previous hit, and the leading gap wraps around to the last one.
	// A ring past the statue's ends hits nothing: it collapses beside the axis, along the last ray.
	let point = hits.filter( Boolean ).pop() ?? new Vector3( 0, y, 0 ).addScaledVector( ray.direction, 0.1 )
	const points = hits.map( hit => {
		point = hit ?? point
		return point
	} )

	return { points, alpha: hits.some( Boolean ) ? 1 : 0 }
}

/**
 * Load statues, fit them to the same size, and slice them into matching stacks of contour rings.
 * Each statue gives `ringCount` rings of `sampleCount` Vector3 `points`, with `alpha` 0 on rings that miss it.
 */
export async function sampleContourRings( names, ringCount, sampleCount ) {
	const draco = new DRACOLoader().setDecoderPath( '/draco/' )
	const loader = new GLTFLoader().setDRACOLoader( draco )
	const gltfs = await Promise.all( names.map( name => loader.loadAsync( `/models/${name}.glb` ) ) )
	draco.dispose()

	const models = gltfs.map( ( { scene } ) => ( { scene, ...centerAndScaleModel( scene, MODEL_SIZE ) } ) )
	const outerRadius = Math.max( ...models.map( model => model.outerRadius ) )
	const minY = Math.min( ...models.map( model => model.bounds.min.y ) )
	const maxY = Math.max( ...models.map( model => model.bounds.max.y ) )

	return models.map( ( { scene } ) => {
		const bvh = createModelBVH( scene )
		return times( ringCount, ring => {
			const y = MathUtils.lerp( minY, maxY, ring / ( ringCount - 1 ) )
			return sampleRing( bvh, y, outerRadius, sampleCount )
		} )
	} )
}
