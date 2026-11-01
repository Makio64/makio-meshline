import { rectanglePositions } from './rectanglePositions.js'

/**
 * Generate a square loop of points in the XY plane.
 * Use with `closed: true` to form a complete loop.
 * @param {number} [width=1] - Side length of the square
 * @param {number} [segments=1] - Number of subdivisions per side
 * @returns {Float32Array} Flat xyz array
 */
export const squarePositions = ( width = 1, segments = 1 ) => rectanglePositions( width, width, segments )
