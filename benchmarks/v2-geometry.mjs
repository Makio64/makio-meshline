import { performance } from 'node:perf_hooks'

import MeshLineGeometry from '../src/MeshLineGeometry.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const SCREEN_SIZES = [1_000, 10_000, 50_000, 200_000]
const SURFACE_SIZES = [1_000, 10_000, 50_000]

const createPath = pointCount => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		const progress = i / Math.max( 1, pointCount - 1 )
		const offset = i * 3
		points[offset] = progress * 100
		points[offset + 1] = Math.sin( progress * Math.PI * 6 )
		points[offset + 2] = Math.cos( progress * Math.PI * 4 ) * 0.5
	}
	return points
}

const measure = ( callback, iterations ) => {
	const samples = []
	for ( let i = 0; i < 5; i++ ) callback()
	for ( let i = 0; i < iterations; i++ ) {
		const start = performance.now()
		callback()
		samples.push( performance.now() - start )
	}
	samples.sort( ( a, b ) => a - b )
	return samples[Math.floor( samples.length / 2 )]
}

const geometryBytes = geometry => {
	let bytes = geometry.index?.array?.byteLength ?? 0
	for ( const attribute of Object.values( geometry.attributes ) ) {
		bytes += attribute.array?.byteLength ?? 0
	}
	return bytes
}

const screenResults = SCREEN_SIZES.map( pointCount => {
	const points = createPath( pointCount )
	const buildMs = measure( () => {
		const geometry = new MeshLineGeometry( { lines: points, dynamic: true, needsProgress: false } )
		geometry.dispose()
	}, pointCount >= 200_000 ? 5 : 12 )
	const geometry = new MeshLineGeometry( { lines: points, dynamic: true, needsProgress: false } )
	const updateMs = measure( () => geometry.setPositions( points, false ), pointCount >= 200_000 ? 12 : 30 )
	const updateBoundsMs = measure( () => geometry.setPositions( points, true ), pointCount >= 200_000 ? 8 : 20 )
	const bytes = geometryBytes( geometry )
	geometry.dispose()

	return { pointCount, buildMs, updateMs, updateBoundsMs, bytes }
} )

const surfaceResults = SURFACE_SIZES.map( pointCount => {
	const points = createPath( pointCount )
	const options = {
		lines: points,
		lineWidth: 1,
		dynamic: true,
		surface: { frame: 'transport', uvMode: 'distance', uvScale: 2 },
	}
	const buildMs = measure( () => {
		const geometry = new MeshLineSurfaceGeometry( options )
		geometry.dispose()
	}, pointCount >= 50_000 ? 3 : 8 )
	const geometry = new MeshLineSurfaceGeometry( options )
	const position = geometry.getAttribute( 'position' )
	const normal = geometry.getAttribute( 'normal' )
	const index = geometry.getIndex()
	const updateMs = measure( () => geometry.setPositions( points ), pointCount >= 50_000 ? 5 : 12 )
	const reusedBuffers = geometry.getAttribute( 'position' ) === position &&
		geometry.getAttribute( 'normal' ) === normal &&
		geometry.getIndex() === index
	const bytes = geometryBytes( geometry )
	geometry.dispose()

	return { pointCount, buildMs, updateMs, reusedBuffers, bytes }
} )

console.log( JSON.stringify( { screen: screenResults, surface: surfaceResults }, null, 2 ) )
