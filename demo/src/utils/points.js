/** Array of `count` items built by `fn( index )`. */
export const times = ( count, fn ) => Array.from( { length: count }, ( _, index ) => fn( index ) )

/**
 * Flat XYZ buffer of one line. `fn( t, index )` returns `[x, y, z]`, with `t` going
 * from 0 to 1, or stopping one step short of 1 on a `closed` loop.
 */
export function linePoints( count, fn, { closed = false } = {} ) {
	const points = new Float32Array( count * 3 )
	const steps = closed ? count : count - 1
	for ( let index = 0; index < count; index++ ) points.set( fn( index / steps, index ), index * 3 )
	return points
}
