/**
 * Generate a rectangle loop of points in the XY plane.
 * Use with `closed: true` to form a complete loop.
 * @param {number} [width=1] - Rectangle width
 * @param {number} [height=1] - Rectangle height
 * @param {number} [segments=1] - Number of subdivisions per side
 * @returns {Float32Array} Flat xyz array
 */
export const rectanglePositions = ( width = 1, height = 1, segments = 1 ) => {
	const halfW = width * 0.5
	const halfH = height * 0.5
	const sideStride = segments * 3
	const positions = new Float32Array( sideStride * 4 )
	const s1 = sideStride
	const s2 = sideStride * 2
	const s3 = sideStride * 3

	for ( let j = 0, o = 0; j < segments; j++, o += 3 ) {
		const t = j / segments
		const dx = width * t
		const dy = height * t
		positions[o] = -halfW + dx
		positions[o + 1] = -halfH
		positions[s1 + o] = halfW
		positions[s1 + o + 1] = -halfH + dy
		positions[s2 + o] = halfW - dx
		positions[s2 + o + 1] = halfH
		positions[s3 + o] = -halfW
		positions[s3 + o + 1] = halfH - dy
	}
	return positions
}