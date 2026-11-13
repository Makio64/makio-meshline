/**
 * Binary statue-ring files: one codec for the bake script (node), statues.js and rings.js.
 * No three.js import, so node can use it as is.
 *
 * Layout (little endian, 32-byte header):
 *   u32 magic 'RNGS' · u32 version (1 = int16 positions × scale, 2 = float32 positions)
 *   u32 rings · u32 samples · f32 minY · f32 maxY · f32 radius · f32 scale (v1 only)
 *   u8 active[rings] padded to 4 bytes
 *   positions[rings * samples * 3], ring r point i at ( r * samples + i ) * 3, rings bottom→top
 *
 * Baked files live in showcase/assets/rings/<name>-<rings>x<samples>.bin (v2, float32, exact),
 * written by `node showcase/scripts/bake-rings.mjs`.
 */

export const RING_MAGIC = 0x53474e52 // 'RNGS'

/** Statues with a GLB in demo/public/models and baked ring files. */
export const STATUE_NAMES = ['david', 'venus', 'aurelius', 'nefertiti']
const HEADER = 32

/** Model size the files are baked at (max dimension). Other sizes scale the baked data. */
export const BAKED_SIZE = 12

/** Ring layouts baked for every statue: 64 × 96 (default) and 64 × 64 (phones). */
export const BAKED_LAYOUTS = [[64, 96], [64, 64]]

export const ringFileName = ( name, rings, samples ) => `${name}-${rings}x${samples}.bin`

/**
 * Serialize a ring set (loadStatueRings / proceduralRings shape).
 * @param {{ rings: number, samples: number, positions: Float32Array, active?: Uint8Array, minY: number, maxY: number, radius?: number }} data
 * @param {{ format?: 'f32'|'i16' }} [o] f32 (v2, exact) or i16 (v1, half the size, max error ≈ 1e-4 units)
 * @returns {ArrayBuffer}
 */
export function encodeRings( data, { format = 'f32' } = {} ) {
	const { rings, samples, positions, active } = data
	const n = rings * samples * 3
	if ( positions.length !== n ) throw new Error( `encodeRings: expected ${n} floats, got ${positions.length}` )
	const i16 = format === 'i16'
	let scale = 1
	if ( i16 ) {
		let maxAbs = 0
		for ( let i = 0; i < n; i++ ) maxAbs = Math.max( maxAbs, Math.abs( positions[i] ) )
		scale = maxAbs > 0 ? maxAbs / 32767 : 1
	}
	const activeBytes = ( rings + 3 ) & ~3
	const buffer = new ArrayBuffer( HEADER + activeBytes + n * ( i16 ? 2 : 4 ) )
	const view = new DataView( buffer )
	view.setUint32( 0, RING_MAGIC, true )
	view.setUint32( 4, i16 ? 1 : 2, true )
	view.setUint32( 8, rings, true )
	view.setUint32( 12, samples, true )
	view.setFloat32( 16, data.minY, true )
	view.setFloat32( 20, data.maxY, true )
	view.setFloat32( 24, data.radius ?? 0, true )
	view.setFloat32( 28, scale, true )
	new Uint8Array( buffer, HEADER, rings ).set( active ?? new Uint8Array( rings ).fill( 1 ) )
	if ( i16 ) {
		const q = new Int16Array( buffer, HEADER + activeBytes, n )
		for ( let i = 0; i < n; i++ ) q[i] = Math.round( positions[i] / scale )
	} else {
		new Float32Array( buffer, HEADER + activeBytes, n ).set( positions )
	}
	return buffer
}

/**
 * Parse a ring file (v1 or v2).
 * @param {ArrayBuffer} buffer
 * @param {string} [name]
 * @param {{ scale?: number }} [o] multiply every length (positions, minY, maxY, radius), e.g. size / BAKED_SIZE
 * @returns {{ name: string, positions: Float32Array, active: Uint8Array, rings: number, samples: number, minY: number, maxY: number, radius: number }}
 */
export function decodeRings( buffer, name = 'rings', { scale = 1 } = {} ) {
	const view = new DataView( buffer )
	if ( buffer.byteLength < HEADER || view.getUint32( 0, true ) !== RING_MAGIC ) throw new Error( `decodeRings: ${name} is not a ring file` )
	const version = view.getUint32( 4, true )
	const rings = view.getUint32( 8, true )
	const samples = view.getUint32( 12, true )
	const activeBytes = ( rings + 3 ) & ~3
	const n = rings * samples * 3
	const active = new Uint8Array( buffer, HEADER, rings ).slice()
	let positions
	if ( version === 1 ) {
		const q = new Int16Array( buffer, HEADER + activeBytes, n )
		const k = view.getFloat32( 28, true ) * scale
		positions = new Float32Array( n )
		for ( let i = 0; i < n; i++ ) positions[i] = q[i] * k
	} else if ( version === 2 ) {
		positions = new Float32Array( buffer, HEADER + activeBytes, n )
		if ( scale !== 1 ) {
			positions = positions.slice()
			for ( let i = 0; i < n; i++ ) positions[i] *= scale
		}
	} else {
		throw new Error( `decodeRings: ${name} has unknown version ${version}` )
	}
	return {
		name,
		positions,
		active,
		rings,
		samples,
		minY: view.getFloat32( 16, true ) * scale,
		maxY: view.getFloat32( 20, true ) * scale,
		radius: view.getFloat32( 24, true ) * scale,
	}
}
