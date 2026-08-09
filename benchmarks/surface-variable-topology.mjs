import { performance } from 'node:perf_hooks'

import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const cliArguments = process.argv.slice( 2 ).filter( argument => argument !== '--' )
const POINT_COUNT = Number.parseInt( cliArguments[0] || '50000', 10 )
const ITERATIONS = Number.parseInt( cliArguments[1] || '7', 10 )

if ( !Number.isInteger( POINT_COUNT ) || POINT_COUNT < 2 ) {
	throw new Error( 'point count must be an integer greater than one' )
}
if ( !Number.isInteger( ITERATIONS ) || ITERATIONS < 1 ) {
	throw new Error( 'iterations must be a positive integer' )
}

const points = new Float32Array( POINT_COUNT * 3 )
for ( let point = 0; point < POINT_COUNT; point++ ) {
	const offset = point * 3
	points[offset] = point * 0.02
	points[offset + 1] = Math.sin( point * 0.071 ) * 0.12
	points[offset + 2] = Math.sin( point * 0.137 ) * 0.3
}

const sharpPoints = new Float32Array( POINT_COUNT * 3 )
const sharpTurn = 160 * Math.PI / 180
let sharpHeading = 0
for ( let point = 1; point < POINT_COUNT; point++ ) {
	if ( point > 1 ) sharpHeading += point % 2 === 0 ? -sharpTurn : sharpTurn
	const offset = point * 3
	sharpPoints[offset] = sharpPoints[offset - 3] + Math.cos( sharpHeading ) * 20
	sharpPoints[offset + 2] = sharpPoints[offset - 1] + Math.sin( sharpHeading ) * 20
}

const cases = {
	'miter-butt': {
		join: { type: 'miter', limit: 4, segments: 8 },
		cap: { type: 'butt', segments: 8 },
	},
	'bevel-butt': {
		join: { type: 'bevel', limit: 4, segments: 8 },
		cap: { type: 'butt', segments: 8 },
	},
	'round8-butt': {
		join: { type: 'round', limit: 4, segments: 8 },
		cap: { type: 'butt', segments: 8 },
	},
	'miter-round8': {
		join: { type: 'miter', limit: 4, segments: 8 },
		cap: { type: 'round', segments: 8 },
	},
	'sharp160-miter2': {
		lines: sharpPoints,
		lineWidth: 2,
		join: { type: 'miter', limit: 2, segments: 8 },
		cap: { type: 'butt', segments: 8 },
	},
}

const geometryBytes = geometry => {
	let bytes = geometry.getIndex()?.array.byteLength || 0
	for ( const attribute of Object.values( geometry.attributes ) ) bytes += attribute.array.byteLength
	return bytes
}

const entries = Object.entries( cases )
const samples = Object.fromEntries( entries.map( ([name]) => [name, []] ) )
const cpuSamples = Object.fromEntries( entries.map( ([name]) => [name, []] ) )
const results = {}
for ( let warmup = 0; warmup < 3; warmup++ ) {
	for ( const [, options] of entries ) {
		new MeshLineSurfaceGeometry( { lines: points, lineWidth: 0.1, ...options } ).dispose()
	}
}
for ( let iteration = 0; iteration < ITERATIONS; iteration++ ) {
	for ( let entryOffset = 0; entryOffset < entries.length; entryOffset++ ) {
		const [name, options] = entries[( iteration + entryOffset ) % entries.length]
		globalThis.gc?.()
		const start = performance.now()
		const cpuStart = process.cpuUsage()
		const geometry = new MeshLineSurfaceGeometry( { lines: points, lineWidth: 0.1, ...options } )
		samples[name].push( performance.now() - start )
		const cpu = process.cpuUsage( cpuStart )
		cpuSamples[name].push( ( cpu.user + cpu.system ) / 1000 )
		results[name] = {
			vertices: geometry.getAttribute( 'position' ).count,
			indices: geometry.getIndex().count,
			bytes: geometryBytes( geometry ),
		}
		geometry.dispose()
	}
}
for ( const [name] of entries ) {
	samples[name].sort( ( a, b ) => a - b )
	cpuSamples[name].sort( ( a, b ) => a - b )
	results[name].buildMedianMs = samples[name][Math.floor( samples[name].length / 2 )]
	results[name].buildMedianCpuMs = cpuSamples[name][Math.floor( cpuSamples[name].length / 2 )]
}

console.log( JSON.stringify( {
	pointCount: POINT_COUNT,
	iterations: ITERATIONS,
	attributes: ['position', 'normal'],
	results,
}, null, 2 ) )
