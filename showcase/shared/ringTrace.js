/**
 * Statue contour ring tracer (BVH ray casts, like demo/src/demos/venus.js).
 *
 * Runs in node (scripts/bake-rings.mjs writes assets/rings/*.bin) and in the browser as the
 * fallback of loadStatueRings() when no baked file matches. Imports three core only.
 *
 *   const data = traceRings( gltf.scene, { rings: 64, samples: 96, size: 12 } )
 */
import { Box3, BufferAttribute, BufferGeometry, FrontSide, Ray, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, SAH } from 'three-mesh-bvh'

/** Same as demo/src/utils/modelUtils.js centerAndScaleModel. */
function centerAndScale( model, targetSize ) {
	model.position.set( 0, 0, 0 )
	model.rotation.set( 0, 0, 0 )
	model.scale.set( 1, 1, 1 )
	model.updateMatrixWorld( true )
	const box = new Box3().setFromObject( model )
	const size = box.getSize( new Vector3() )
	const center = box.getCenter( new Vector3() )
	const maxDimension = Math.max( size.x, size.y, size.z )
	if ( maxDimension > 0 ) {
		const scale = targetSize / maxDimension
		model.scale.setScalar( scale )
		center.multiplyScalar( scale )
	}
	model.position.sub( center )
	model.updateMatrixWorld( true )
	return new Box3().setFromObject( model )
}

/** Merge every mesh of a model into one world-space, position-only, indexed geometry. */
function mergedWorldGeometry( model ) {
	const parts = []
	model.traverse( ( obj ) => {
		if ( !obj.isMesh ) return
		const src = obj.geometry
		const g = new BufferGeometry()
		g.setAttribute( 'position', src.getAttribute( 'position' ).clone() )
		if ( src.index ) g.setIndex( src.index.clone() )
		else {
			const n = src.getAttribute( 'position' ).count
			const idx = new Uint32Array( n )
			for ( let i = 0; i < n; i++ ) idx[i] = i
			g.setIndex( new BufferAttribute( idx, 1 ) )
		}
		g.applyMatrix4( obj.matrixWorld )
		parts.push( g )
	} )
	const merged = parts.length === 1 ? parts[0] : mergeGeometries( parts, false )
	if ( parts.length > 1 ) for ( const p of parts ) p.dispose()
	return merged
}

/**
 * Trace `rings` closed contour rings of `samples` points around a model (normalized: max
 * dimension = `size`, centred at the origin, y up). Rays point inwards from a cylinder around it.
 * The model is re-positioned in place; its geometries are left to the caller.
 *
 * @param {import('three').Object3D} model e.g. gltf.scene
 * @param {{ rings?: number, samples?: number, size?: number, name?: string }} [o]
 * @returns {{ name: string, positions: Float32Array, active: Uint8Array, rings: number, samples: number, minY: number, maxY: number, radius: number }}
 *   active[r] = 0 when the ring missed the model (drawn invisible).
 */
export function traceRings( model, { rings = 64, samples = 96, size = 12, name = 'statue' } = {} ) {
	const bounds = centerAndScale( model, size )
	const geometry = mergedWorldGeometry( model )
	const bvh = new MeshBVH( geometry, { targetLeafSize: 1, strategy: SAH, indirect: true } )
	const sizeV = bounds.getSize( new Vector3() )
	const radius = 0.5 * Math.hypot( sizeV.x, sizeV.z ) * 1.2
	const cx = ( bounds.min.x + bounds.max.x ) * 0.5
	const cz = ( bounds.min.z + bounds.max.z ) * 0.5
	const minY = bounds.min.y
	const maxY = bounds.max.y
	const positions = new Float32Array( rings * samples * 3 )
	const active = new Uint8Array( rings )
	const ray = new Ray()
	const cos = new Float32Array( samples )
	const sin = new Float32Array( samples )
	for ( let i = 0; i < samples; i++ ) {
		const a = ( i / samples ) * Math.PI * 2
		cos[i] = Math.cos( a )
		sin[i] = Math.sin( a )
	}
	const hits = new Float32Array( samples * 3 )
	const hasHit = new Uint8Array( samples )
	for ( let r = 0; r < rings; r++ ) {
		const y = minY + ( r / ( rings - 1 ) ) * ( maxY - minY )
		hasHit.fill( 0 )
		let first = -1
		for ( let i = 0; i < samples; i++ ) {
			ray.origin.set( cx + cos[i] * radius, y, cz + sin[i] * radius )
			ray.direction.set( -cos[i], 0, -sin[i] )
			const hit = bvh.raycastFirst( ray, FrontSide )
			if ( hit ) {
				hits[i * 3] = hit.point.x
				hits[i * 3 + 1] = hit.point.y
				hits[i * 3 + 2] = hit.point.z
				hasHit[i] = 1
				if ( first < 0 ) first = i
			}
		}
		active[r] = first >= 0 ? 1 : 0
		// fill gaps with the previous valid point (wrap-aware), collapsed centre when nothing hit
		let px = cx
		let py = y
		let pz = cz
		if ( first >= 0 ) {
			// seed with the last hit so leading gaps wrap
			for ( let i = samples - 1; i >= 0; i-- ) {
				if ( hasHit[i] ) { px = hits[i * 3]; py = hits[i * 3 + 1]; pz = hits[i * 3 + 2]; break }
			}
		}
		for ( let i = 0; i < samples; i++ ) {
			if ( hasHit[i] ) { px = hits[i * 3]; py = hits[i * 3 + 1]; pz = hits[i * 3 + 2] }
			const o = ( r * samples + i ) * 3
			positions[o] = px
			positions[o + 1] = py
			positions[o + 2] = pz
		}
	}
	bvh.geometry.dispose()
	return { name, positions, active, rings, samples, minY, maxY, radius }
}

export default traceRings
