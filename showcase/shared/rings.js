/**
 * Pre-baked statue contour rings: no GLB decode, no BVH build, no 6,144 raycasts at runtime.
 *
 *   import { loadRings } from '@shared/rings.js'
 *   const [david, venus] = await Promise.all( [loadRings( 'david' ), loadRings( 'venus' )] )
 *   const stack = createRingStack( [david, venus] ) // same data shape as loadStatueRings()
 *
 * Same loader as loadStatueRings() (statues.js): baked float32 files in assets/rings
 * (<name>-64x96.bin and <name>-64x64.bin for david, venus, aurelius, nefertiti), any `size`
 * (scaled), other layouts trace at runtime with a warning. Re-bake: node showcase/scripts/bake-rings.mjs
 *
 * File format: see ringData.js (v2 float32, v1 int16 still decodes).
 */
import { encodeRings as encode } from './ringData.js'
import { loadStatueRings } from './statues.js'

export { decodeRings } from './ringData.js'

/** Serialize a ring set to an ArrayBuffer. Default int16 (v1, half the size); `{ format: 'f32' }` is exact. */
export function encodeRings( data, { format = 'i16' } = {} ) {
	return encode( data, { format } )
}

/**
 * Baked rings (one fetch + a typed-array view), else the BVH tracer.
 * @param {'david'|'venus'|'aurelius'|'nefertiti'} name
 * @param {{ rings?: number, samples?: number, size?: number }} [opts]
 */
export function loadRings( name, opts = {} ) {
	return loadStatueRings( name, opts )
}

export default loadRings
