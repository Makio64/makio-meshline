import { performance } from 'node:perf_hooks'

import MeshLine from '../src/MeshLine.js'

// Padding-only bound refreshes (`lineWidth()`, `join()` limit, and
// `sizeAttenuation()`) run every frame when widths animate. They should cost
// O(lines), not O(points), while a position update still rescans its points.
const POINT_COUNTS = [10_000, 100_000, 200_000]
const LINE_COUNTS = [1, 64]

const createPath = ( pointCount, offset ) => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		const progress = i / Math.max( 1, pointCount - 1 )
		const index = i * 3
		points[index] = progress * 100
		points[index + 1] = Math.sin( progress * Math.PI * 8 ) + offset
		points[index + 2] = Math.cos( progress * Math.PI * 5 ) * 0.5
	}
	return points
}

const median = samples => {
	samples.sort( ( a, b ) => a - b )
	return samples[Math.floor( samples.length / 2 )]
}

const measure = ( callback, iterations ) => {
	for ( let i = 0; i < 8; i++ ) callback( i )
	const samples = new Array( iterations )
	for ( let i = 0; i < iterations; i++ ) {
		const start = performance.now()
		callback( i )
		samples[i] = performance.now() - start
	}
	return median( samples )
}

const results = {}

for ( const pointCount of POINT_COUNTS ) {
	for ( const lineCount of LINE_COUNTS ) {
		const perLine = Math.max( 2, Math.floor( pointCount / lineCount ) )
		const lines = Array.from( { length: lineCount }, ( _, index ) => createPath( perLine, index ) )
		const line = new MeshLine( { lines: lineCount === 1 ? lines[0] : lines, lineWidth: 0.5 } ).build()
		const iterations = pointCount >= 100_000 ? 60 : 200

		results[`${pointCount}x${lineCount}`] = {
			lineWidthMs: measure( iteration => line.lineWidth( 0.5 + ( iteration % 16 ) * 0.01 ), iterations ),
			miterLimitMs: measure( iteration => line.join( { type: 'miter', limit: 2 + ( iteration % 4 ) } ), iterations ),
			// Reference: a real position update must still rescan every point.
			setPositionsBoundsMs: measure( () => line.setPositions( lineCount === 1 ? lines[0] : lines, true ), Math.ceil( iterations / 4 ) ),
		}
		line.dispose()
	}
}

console.log( JSON.stringify( results, null, 2 ) )
