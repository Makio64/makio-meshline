/**
 * Generate a straight line from the origin along the X (or Y) axis.
 * @param {number} [width=1] - Length of the line
 * @param {number} [segments=2] - Number of subdivisions (points = segments + 1)
 * @param {boolean} [isVertical=false] - When `true`, the line runs along Y instead of X
 * @returns {Float32Array} Flat xyz array
 */
export function straightLine( width = 1, segments = 2, isVertical = false ) {
	const positions = new Float32Array( ( segments + 1 ) * 3 )
	const axisOffset = isVertical ? 1 : 0

	for ( let i = 0, index = axisOffset; i <= segments; i++, index += 3 ) {
		positions[ index ] = ( i / segments ) * width
	}

	return positions
}

/**
 * Generate a straight line between two 3D points.
 * @param {{x?: number, y?: number, z?: number} | number[]} start - Start point
 * @param {{x?: number, y?: number, z?: number} | number[]} end - End point
 * @param {number} [segments=1] - Number of subdivisions (points = segments + 1)
 * @returns {Float32Array} Flat xyz array
 */
export function straightLineBetween( start, end, segments = 1 ) {
	const positions = new Float32Array( ( segments + 1 ) * 3 )

	const x1 = start.x ?? start[0] ?? 0
	const y1 = start.y ?? start[1] ?? 0
	const z1 = start.z ?? start[2] ?? 0
	const dx = ( end.x ?? end[0] ?? 0 ) - x1
	const dy = ( end.y ?? end[1] ?? 0 ) - y1
	const dz = ( end.z ?? end[2] ?? 0 ) - z1

	for ( let i = 0, index = 0; i <= segments; i++, index += 3 ) {
		const t = i / segments

		positions[ index ] = x1 + t * dx
		positions[ index + 1 ] = y1 + t * dy
		positions[ index + 2 ] = z1 + t * dz
	}

	return positions
}
