import assert from 'node:assert/strict'
import test from 'node:test'

import { DynamicDrawUsage, StreamDrawUsage } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLineGeometry from '../src/MeshLineGeometry.js'

// A dynamic billboard line keeps its buffers when its point count changes.
// These tests replay what a renderer would upload and compare the result with
// a fresh build of the same points, so both the reuse and the partial uploads
// it relies on are checked.

const createPath = ( pointCount, phase = 0 ) => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		points[i * 3] = i * 0.25
		points[i * 3 + 1] = Math.sin( i * 0.37 + phase ) * 2
		points[i * 3 + 2] = Math.cos( i * 0.21 + phase )
	}
	return points
}

// The GPU side of each attribute: a first upload sends the whole array, later
// ones only the pending update ranges, or everything when there are none.
function createGpu() {
	const buffers = new Map()
	let created = 0
	const upload = attribute => {
		let buffer = buffers.get( attribute )
		if ( !buffer ) {
			buffer = { data: attribute.array.slice(), version: attribute.version }
			buffers.set( attribute, buffer )
			created++
		} else if ( buffer.version !== attribute.version ) {
			assert.equal( attribute.array.length, buffer.data.length, 'a GPU buffer never changes size' )
			if ( attribute.updateRanges.length === 0 ) buffer.data.set( attribute.array )
			for ( const { start, count } of attribute.updateRanges ) {
				buffer.data.set( attribute.array.subarray( start, start + count ), start )
			}
			buffer.version = attribute.version
		}
		attribute.clearUpdateRanges()
		return buffer.data
	}
	return {
		get created() {
			return created
		},
		render( geometry ) {
			const data = {}
			for ( const [name, attribute] of Object.entries( geometry.attributes ) ) data[name] = upload( attribute )
			data.index = upload( geometry.index )
			return data
		},
	}
}

// What the renderer draws must equal a fresh build of the same input.
function assertDrawsLike( geometry, gpu, reference, label ) {
	const data = gpu.render( geometry )
	assert.deepEqual( Object.keys( geometry.attributes ).sort(), Object.keys( reference.attributes ).sort(), `${label}: attributes` )
	for ( const [name, attribute] of Object.entries( reference.attributes ) ) {
		assert.ok( geometry.attributes[name].count >= attribute.count, `${label}: ${name} capacity` )
		assert.deepEqual(
			Array.from( data[name].subarray( 0, attribute.array.length ) ),
			Array.from( attribute.array ),
			`${label}: ${name}`
		)
	}
	const drawn = Math.min( geometry.drawRange.count, geometry.index.count )
	assert.equal( geometry.drawRange.start, 0, `${label}: draw range start` )
	assert.equal( drawn, reference.index.count, `${label}: drawn index count` )
	assert.equal( geometry.indexCount, reference.index.count, `${label}: indexCount` )
	assert.equal( geometry.vertexCount, reference.attributes.position.count, `${label}: vertexCount` )
	assert.deepEqual( Array.from( data.index.subarray( 0, drawn ) ), Array.from( reference.index.array ), `${label}: index` )
	// Spare indices are zero on both sides, so the whole buffer is safe to read.
	assert.ok( geometry.index.array.subarray( drawn ).every( value => value === 0 ), `${label}: spare indices` )
	assert.ok( data.index.subarray( drawn ).every( value => value === 0 ), `${label}: uploaded spare indices` )
	reference.dispose()
}

const PROFILES = {
	default: { needsProgress: false },
	progress: { needsProgress: true },
	progressUV: { needsProgress: true, needsUV: true },
	width: { needsProgress: true, needsWidth: true, widthCallback: progress => 1 + progress },
	colors: { needsProgress: false, needsVertexColor: true, vertexColors: new Float32Array( 400 * 3 ).fill( 0.5 ) },
	bevel: { needsProgress: false, join: 'bevel' },
	side: { needsProgress: false, needsSide: true },
}

test( 'a dynamic line keeps its buffers while its point count changes', () => {
	for ( const [profile, options] of Object.entries( PROFILES ) ) {
		const gpu = createGpu()
		const geometry = new MeshLineGeometry( { lines: createPath( 100 ), ...options, dynamic: true } )
		const check = ( points, label ) => {
			assertDrawsLike( geometry, gpu, new MeshLineGeometry( { lines: points.slice(), ...options } ), `${profile} ${label}` )
		}
		check( createPath( 100 ), 'first build' )
		assert.equal( geometry.attributes.position.count, 400, 'a first build is exact' )
		assert.equal( geometry.drawRange.count, Infinity )

		// Appending points: one reallocation with headroom, then reuse.
		const full = createPath( 400 )
		for ( let count = 101; count <= 140; count++ ) {
			const points = full.slice( 0, count * 3 )
			geometry.setPositions( points )
			check( points, `append to ${count}` )
		}
		const grown = geometry.attributes.position
		assert.ok( grown.count > 140 * 4, 'the buffers hold spare capacity' )
		const buffersAfterGrowth = gpu.created

		// Shrinking, editing the middle, replacing everything and growing again
		// all stay inside the same buffers.
		for ( const count of [139, 120, 121, 60, 61, 100, 140, 150] ) {
			const points = full.slice( 0, count * 3 )
			geometry.setPositions( points )
			check( points, `resize to ${count}` )
		}
		const edited = full.slice( 0, 151 * 3 )
		edited[70 * 3 + 1] += 3
		geometry.setPositions( edited )
		check( edited, 'grow with a changed point' )
		const replaced = createPath( 130, 1.7 )
		geometry.setPositions( replaced )
		check( replaced, 'replace every point' )
		const sameCount = createPath( 130, 0.4 )
		geometry.setPositions( sameCount )
		check( sameCount, 'same count' )
		assert.equal( geometry.attributes.position, grown, `${profile}: position buffer reused` )
		assert.equal( gpu.created, buffersAfterGrowth, `${profile}: no GPU buffer was created after the growth` )

		// Outgrowing the capacity, or dropping far below it, resizes once.
		const large = createPath( 400, 0.2 )
		geometry.setPositions( large )
		check( large, 'outgrow' )
		assert.notEqual( geometry.attributes.position, grown )
		const small = createPath( 12, 0.9 )
		geometry.setPositions( small )
		check( small, 'collapse' )
		assert.ok( geometry.attributes.position.count <= 12 * 4 * 1.5 + 4, 'a far smaller line gives the memory back' )
		geometry.dispose()
	}
} )

test( 'closed loops, batches and topology flips rebuild correctly inside spare capacity', () => {
	const gpu = createGpu()
	const options = { needsProgress: true }
	const geometry = new MeshLineGeometry( { lines: createPath( 80 ), ...options, dynamic: true } )
	const steps = [
		['grow', createPath( 90 ), false],
		['close', createPath( 90 ), true],
		['closed grow', createPath( 95, 0.3 ), true],
		['open again', createPath( 95, 0.3 ), false],
		['batch', [createPath( 30 ), createPath( 40, 1 ), createPath( 20, 2 )], false],
		['batch resize', [createPath( 31 ), createPath( 38, 1 ), createPath( 22, 2 )], false],
		['batch mixed loops', [createPath( 31 ), createPath( 38, 1 ), createPath( 22, 2 )], [true, false, true]],
		['single again', createPath( 70, 0.5 ), false],
		['append', createPath( 71, 0.5 ), false],
	]
	for ( const [label, lines, closed] of steps ) {
		geometry.setLines( lines, closed )
		const copy = Array.isArray( lines ) ? lines.map( line => line.slice() ) : lines.slice()
		assertDrawsLike( geometry, gpu, new MeshLineGeometry( { lines: copy, closed, ...options } ), label )
	}
	geometry.dispose()
} )

test( 'appending to one open line uploads only the new end', () => {
	const gpu = createGpu()
	const full = createPath( 5000 )
	const geometry = new MeshLineGeometry( { lines: full.slice( 0, 4000 * 3 ), needsProgress: false, dynamic: true } )
	gpu.render( geometry )
	geometry.setPositions( full.slice( 0, 4001 * 3 ) )
	gpu.render( geometry )

	const pendingFloats = attribute => attribute.updateRanges.reduce( ( total, range ) => total + range.count, 0 )
	for ( let count = 4002; count < 4010; count++ ) {
		const points = full.slice( 0, count * 3 )
		geometry.setPositions( points )
		// The previous last point gets a new neighbour, the appended point is new.
		for ( const name of ['position', 'previous', 'next'] ) {
			assert.equal( pendingFloats( geometry.attributes[name] ), 2 * 12, `${name} at ${count}` )
		}
		assert.equal( pendingFloats( geometry.index ), 6, `index at ${count}` )
		assert.equal( geometry.attributes.joinRole.updateRanges.length, 0 )
		assertDrawsLike( geometry, gpu, new MeshLineGeometry( { lines: points.slice(), needsProgress: false } ), `append ${count}` )
	}

	const clone = geometry.clone()
	assert.equal( clone.vertexCount, geometry.vertexCount )
	assert.equal( clone.indexCount, geometry.indexCount )
	clone.dispose()

	// Dropping points from the end only fixes the new last point, and zeroes
	// the indices of the four segments that went away.
	const shorter = full.slice( 0, 4005 * 3 )
	geometry.setPositions( shorter )
	assert.equal( pendingFloats( geometry.attributes.position ), 12 )
	assert.equal( pendingFloats( geometry.index ), 4 * 6 )
	assert.equal( geometry.indexCount, 4004 * 6 )
	assert.equal( geometry.vertexCount, 4005 * 4 )
	assertDrawsLike( geometry, gpu, new MeshLineGeometry( { lines: shorter.slice(), needsProgress: false } ), 'trim' )
	geometry.dispose()
} )

test( 'a static line stays exact, and the facade follows its usage hint', () => {
	const exact = new MeshLineGeometry( { lines: createPath( 50 ), needsProgress: false } )
	exact.setPositions( createPath( 60 ) )
	assert.equal( exact.attributes.position.count, 60 * 4 )
	assert.equal( exact.drawRange.count, Infinity )
	exact.setPositions( createPath( 40 ) )
	assert.equal( exact.attributes.position.count, 40 * 4 )
	exact.dispose()

	for ( const configure of [line => line.dynamic( true ), line => line.usage( DynamicDrawUsage ), line => line.usage( StreamDrawUsage )] ) {
		const gpu = createGpu()
		const line = configure( new MeshLine().lines( createPath( 50 ) ) ).build()
		gpu.render( line.geometry )
		line.lines( createPath( 51 ) )
		const position = line.geometry.attributes.position
		assert.ok( position.count > 51 * 4 )
		for ( const count of [52, 60, 45, 70] ) {
			line.lines( createPath( count ) )
			assert.equal( line.geometry.attributes.position, position )
			assert.equal( line.geometry.drawRange.count, ( count - 1 ) * 6 )
			assertDrawsLike( line.geometry, gpu, new MeshLineGeometry( { lines: createPath( count ), needsProgress: false, needsSide: false } ), `facade ${count}` )
		}
		// Back to static: the next reshaping build is exact again.
		line.dynamic( false )
		line.lines( createPath( 30 ) )
		assert.equal( line.geometry.attributes.position.count, 30 * 4 )
		assert.equal( line.geometry.drawRange.count, Infinity )
		line.dispose()
	}
} )
