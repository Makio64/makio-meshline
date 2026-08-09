import { performance } from 'node:perf_hooks'

import MeshLineGeometry from '../src/MeshLineGeometry.js'

const POINT_COUNTS = [10_000, 100_000, 200_000]
const PARTIAL_POINT_COUNT = 128

const createPath = pointCount => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		const progress = i / Math.max( 1, pointCount - 1 )
		const offset = i * 3
		points[offset] = progress * 100
		points[offset + 1] = Math.sin( progress * Math.PI * 8 )
		points[offset + 2] = Math.cos( progress * Math.PI * 5 ) * 0.5
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

const measureBatched = ( callback, iterations, batchSize ) => {
	for ( let i = 0; i < 8 * batchSize; i++ ) callback( i )
	const samples = new Array( iterations )
	for ( let i = 0; i < iterations; i++ ) {
		const start = performance.now()
		for ( let batch = 0; batch < batchSize; batch++ ) callback( i * batchSize + batch )
		samples[i] = ( performance.now() - start ) / batchSize
	}
	return median( samples )
}

const clearUpdateRanges = geometry => {
	for ( const attribute of Object.values( geometry.attributes ) ) attribute.clearUpdateRanges()
	geometry.getIndex()?.clearUpdateRanges()
}

const pendingUploadBytes = geometry => {
	let bytes = 0
	for ( const attribute of Object.values( geometry.attributes ) ) {
		for ( const range of attribute.updateRanges ) bytes += range.count * attribute.array.BYTES_PER_ELEMENT
	}
	return bytes
}

const benchmarkCase = ( pointCount, options, iterations ) => {
	const points = createPath( pointCount )
	let offset = 0
	const geometry = new MeshLineGeometry( { lines: points, dynamic: true, ...options } )
	const update = updateBounding => measure( iteration => {
		offset = ( iteration & 1 ) * 0.0001
		points[1] = offset
		geometry.setPositions( points, updateBounding )
	}, iterations )

	const rangePointCount = Math.min( PARTIAL_POINT_COUNT, pointCount - 2 )
	const rangeStart = Math.floor( ( pointCount - rangePointCount ) / 2 )
	const range = points.slice( rangeStart * 3, ( rangeStart + rangePointCount ) * 3 )
	const updateMs = update( false )
	const updateBoundsMs = update( true )
	const rebuildMs = measure( iteration => {
		points[1] = ( iteration & 1 ) * 0.0001
		geometry.buildLine( { lines: points } )
	}, Math.max( 5, Math.floor( iterations / 2 ) ) )
	const partialBatchSize = options.needsProgress === false ? 20 : 1
	const partialMs = measureBatched( iteration => {
		clearUpdateRanges( geometry )
		range[1] = ( iteration & 1 ) * 0.0001
		geometry.setPositionRange( range, rangeStart )
	}, Math.max( 50, iterations ), partialBatchSize )
	clearUpdateRanges( geometry )
	geometry.setPositionRange( range, rangeStart )

	const result = {
		updateMs,
		updateBoundsMs,
		partialMs,
		partialUploadBytes: pendingUploadBytes( geometry ),
		fullPositionNeighborBytes: ['position', 'previous', 'next'].reduce(
			( total, name ) => total + ( geometry.getAttribute( name )?.array.byteLength || 0 ),
			0
		),
		rebuildMs,
	}
	geometry.dispose()
	return result
}

const results = {}

for ( const pointCount of POINT_COUNTS ) {
	const iterations = pointCount >= 200_000 ? 12 : ( pointCount >= 100_000 ? 20 : 50 )
	results[pointCount] = {
		default: benchmarkCase( pointCount, { needsProgress: false }, iterations ),
		progressUv: benchmarkCase( pointCount, { needsProgress: true, needsUV: true }, iterations ),
		endpointMetadata: benchmarkCase( pointCount, { needsProgress: true, needsEndpointMetadata: true }, iterations ),
		widthCallback: benchmarkCase( pointCount, {
			needsProgress: true,
			needsWidth: true,
			widthCallback: progress => 0.5 + progress,
		}, iterations ),
	}
}

console.log( JSON.stringify( results, null, 2 ) )
