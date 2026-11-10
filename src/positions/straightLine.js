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
	const step = width / segments

	for ( let i = 0, index = axisOffset; i <= segments; i++, index += 3 ) {
		positions[ index ] = i * step
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
	const invSegments = 1 / segments
	const dx = ( ( end.x ?? end[0] ?? 0 ) - x1 ) * invSegments
	const dy = ( ( end.y ?? end[1] ?? 0 ) - y1 ) * invSegments
	const dz = ( ( end.z ?? end[2] ?? 0 ) - z1 ) * invSegments

	for ( let i = 0, index = 0; i <= segments; i++, index += 3 ) {
		positions[ index ] = x1 + i * dx
		positions[ index + 1 ] = y1 + i * dy
		positions[ index + 2 ] = z1 + i * dz
	}

	return positions
}
