import assert from 'node:assert/strict'
import test from 'node:test'

import { BufferGeometry } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

// A dynamic surface keeps its buffers when its vertex count changes, which
// round joins do whenever the path bends. These tests replay what a renderer
// would upload and compare the result with a fresh build of the same path.

// A zigzag whose bend angles follow `sharpness`, so round joins re-tessellate.
const createPath = ( pointCount, sharpness, offset = 0 ) => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		points[i * 3] = i * 1.5 + offset
		points[i * 3 + 1] = Math.sin( i * 0.9 ) * 0.2
		points[i * 3 + 2] = ( i % 2 ? 1 : -1 ) * sharpness + Math.cos( i * 0.4 ) * 0.3
	}
	return points
}

// A closed outline whose corners sharpen with `wobble`.
const createLoop = ( pointCount, wobble, offset = 0 ) => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		const angle = i / pointCount * Math.PI * 2
		const radius = 6 + ( i % 2 ? wobble : -wobble )
		points[i * 3] = Math.cos( angle ) * radius + offset
		points[i * 3 + 1] = Math.sin( angle * 2 ) * 0.2
		points[i * 3 + 2] = Math.sin( angle ) * radius
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

const boundsOf = geometry => [
	...geometry.boundingBox.min.toArray(),
	...geometry.boundingBox.max.toArray(),
	...geometry.boundingSphere.center.toArray(),
	geometry.boundingSphere.radius,
]

// What the renderer draws must equal a fresh build of the same input.
function assertDrawsLike( geometry, gpu, reference, label ) {
	const data = gpu.render( geometry )
	assert.deepEqual( Object.keys( geometry.attributes ).sort(), Object.keys( reference.attributes ).sort(), `${label}: attributes` )
	assert.equal( geometry.vertexCount, reference.attributes.position.count, `${label}: vertexCount` )
	assert.equal( geometry.indexCount, reference.index.count, `${label}: indexCount` )
	for ( const [name, attribute] of Object.entries( reference.attributes ) ) {
		assert.ok( geometry.attributes[name].count >= attribute.count, `${label}: ${name} capacity` )
		assert.equal( geometry.attributes[name].count, geometry.attributes.position.count, `${label}: ${name} matches the position capacity` )
		assert.deepEqual(
			Array.from( data[name].subarray( 0, attribute.array.length ) ),
			Array.from( attribute.array ),
			`${label}: ${name}`
		)
	}
	const used = reference.index.count
	assert.deepEqual( Array.from( data.index.subarray( 0, used ) ), Array.from( reference.index.array ), `${label}: index` )
	// Spare indices are degenerate triangles, in the array and on the GPU.
	assert.ok( geometry.index.array.subarray( used ).every( value => value === 0 ), `${label}: spare indices` )
	assert.ok( data.index.subarray( used ).every( value => value === 0 ), `${label}: uploaded spare indices` )

	assert.deepEqual( geometry._lineRanges, reference._lineRanges, `${label}: line ranges` )
	assert.deepEqual( boundsOf( geometry ), boundsOf( reference ), `${label}: bounds` )
	// Three's own bounds scan would include the unused vertices.
	geometry.computeBoundingBox()
	geometry.computeBoundingSphere()
	reference.computeBoundingBox()
	reference.computeBoundingSphere()
	const recomputed = boundsOf( geometry )
	boundsOf( reference ).forEach( ( value, i ) => {
		assert.ok( Math.abs( recomputed[i] - value ) < 1e-5, `${label}: recomputed bounds` )
	} )
	reference.dispose()
}

const ROUND = { type: 'round', segments: 8 }
const PROFILES = {
	'round joins': { join: ROUND },
	'round joins and caps': { join: ROUND, cap: { type: 'round', segments: 6 } },
	'bevel joins': { join: 'bevel' },
	'miter strip': {},
	'miter with square caps': { cap: 'square' },
	'miter with round caps': { cap: { type: 'round', segments: 5 } },
	'miter past its limit': { join: { type: 'miter', limit: 1.2 } },
	'mapped': { join: ROUND, needsUV: true },
	'every attribute': { join: ROUND, needsUV: true, needsTangents: true, needsProgress: true, needsSide: true },
	'width callback': { join: ROUND, widthCallback: progress => 1 + progress },
	'banked': { join: ROUND, surface: { bank: 0.3 } },
	'fixed-up frame': { join: ROUND, surface: { frame: 'fixed-up' } },
}

// Point count and bend sharpness of each update: growth, shrinking, gentle
// and sharp bends, and a return to the first shape.
const UPDATES = [[12, 1.2], [12, 0.2], [13, 1.6], [20, 0.9], [20, 2.4], [9, 0.4], [16, 1.1], [16, 0.05], [12, 0.6]]

// An animated shape: the same few points bending between gentle and sharp.
const BENDING = [[18, 2.4], [18, 0.3], [17, 1.2], [18, 1.9], [16, 0.1], [18, 0.8]]

test( 'a dynamic surface keeps its buffers while its vertex count changes', () => {
	for ( const [profile, options] of Object.entries( PROFILES ) ) {
		const gpu = createGpu()
		const first = createPath( 12, 0.6 )
		const geometry = new MeshLineSurfaceGeometry( { lines: first, lineWidth: 0.6, ...options, dynamic: true } )
		const check = ( points, label ) => assertDrawsLike(
			geometry, gpu,
			new MeshLineSurfaceGeometry( { lines: points.slice(), lineWidth: 0.6, ...options } ),
			`${profile} ${label}`
		)
		check( first, 'first build' )
		assert.equal( geometry.attributes.position.count, geometry.vertexCount, `${profile}: a first build is exact` )
		assert.equal( geometry.index.count, geometry.indexCount )

		for ( const [pointCount, sharpness] of UPDATES ) {
			const points = createPath( pointCount, sharpness, sharpness )
			geometry.setPositions( points )
			check( points, `${pointCount} points, sharpness ${sharpness}` )
		}

		// A surface that keeps bending within a few times its size settles: once
		// its buffers have grown to the largest shape, nothing new reaches the GPU.
		for ( const [pointCount, sharpness] of BENDING ) geometry.setPositions( createPath( pointCount, sharpness ) )
		gpu.render( geometry )
		const position = geometry.attributes.position
		const created = gpu.created
		for ( let pass = 0; pass < 2; pass++ ) {
			for ( const [pointCount, sharpness] of BENDING ) {
				const points = createPath( pointCount, sharpness, pass )
				geometry.setPositions( points )
				check( points, `bending ${pointCount} points, sharpness ${sharpness}` )
			}
		}
		assert.equal( geometry.attributes.position, position, `${profile}: position buffer reused` )
		assert.equal( gpu.created, created, `${profile}: no GPU buffer was created once grown` )

		// Outgrowing the capacity, or dropping far below it, resizes once.
		const large = createPath( 90, 1.4 )
		geometry.setPositions( large )
		check( large, 'outgrow' )
		assert.notEqual( geometry.attributes.position, position )
		const small = createPath( 3, 0.5 )
		geometry.setPositions( small )
		check( small, 'collapse' )
		assert.ok( geometry.attributes.position.count < geometry.vertexCount * 2 + 8, `${profile}: a far smaller surface gives the memory back` )
		geometry.dispose()
	}
} )

test( 'batches and closed loops rebuild correctly inside spare capacity', () => {
	const gpu = createGpu()
	const options = { lineWidth: 0.5, join: ROUND, needsUV: true }
	const steps = [
		[[createPath( 8, 1 ), createPath( 10, 0.4, 30 )], false],
		[[createPath( 8, 0.2 ), createPath( 10, 1.4, 30 )], false],
		[[createPath( 9, 1.2 ), createLoop( 9, 0.6, 30 ), createPath( 5, 1, 60 )], [false, true, false]],
		[createLoop( 14, 1.1 ), true],
		[createLoop( 14, 0.1 ), true],
		[createLoop( 14, 0.1 ), false],
		[[createLoop( 8, 1.5 ), createLoop( 6, 0.2, 30 )], [true, true]],
		[[createPath( 8, 1 ), createPath( 10, 0.4, 30 )], false],
	]
	const geometry = new MeshLineSurfaceGeometry( { lines: steps[0][0], closed: steps[0][1], ...options, dynamic: true } )
	steps.forEach( ( [lines, closed], step ) => {
		geometry.setLines( lines, closed )
		const copy = Array.isArray( lines ) ? lines.map( line => line.slice() ) : lines.slice()
		assertDrawsLike( geometry, gpu, new MeshLineSurfaceGeometry( { lines: copy, closed, ...options } ), `step ${step}` )
	} )
	geometry.dispose()
} )

test( 'a static surface stays exact and spare capacity never leaks out', () => {
	const options = { lineWidth: 0.6, join: ROUND, needsUV: true }
	const exact = new MeshLineSurfaceGeometry( { lines: createPath( 12, 0.4 ), ...options } )
	for ( const [pointCount, sharpness] of UPDATES ) {
		exact.setPositions( createPath( pointCount, sharpness ) )
		assert.equal( exact.attributes.position.count, exact.vertexCount )
		assert.equal( exact.index.count, exact.indexCount )
	}
	exact.dispose()

	const dynamic = new MeshLineSurfaceGeometry( { lines: createPath( 20, 2 ), ...options, dynamic: true } )
	dynamic.setPositions( createPath( 20, 0.1 ) )
	assert.ok( dynamic.attributes.position.count > dynamic.vertexCount )

	// copyToGeometry() hands out only what is in use.
	const reference = new MeshLineSurfaceGeometry( { lines: createPath( 20, 0.1 ), ...options } )
	const copy = dynamic.copyToGeometry( new BufferGeometry() )
	for ( const name of ['position', 'normal', 'uv'] ) {
		assert.deepEqual( Array.from( copy.attributes[name].array ), Array.from( reference.attributes[name].array ), name )
	}
	assert.deepEqual( Array.from( copy.index.array ), Array.from( reference.index.array ) )
	const plain = { attributes: {}, setAttribute( name, array ) { this.attributes[name] = array }, setIndex( array ) { this.index = array } }
	dynamic.copyToGeometry( plain )
	assert.equal( plain.attributes.position.length, reference.attributes.position.array.length )
	assert.equal( plain.index.length, reference.index.count )

	// A clone holds the same buffers and knows how much of them is in use.
	const clone = dynamic.clone()
	assert.equal( clone.vertexCount, dynamic.vertexCount )
	assert.equal( clone.indexCount, dynamic.indexCount )
	assert.equal( clone.attributes.position.count, dynamic.attributes.position.count )
	clone.dispose()

	// A draw range the caller set survives every rebuild.
	dynamic.setDrawRange( 6, 12 )
	dynamic.setPositions( createPath( 20, 1.5 ) )
	dynamic.setPositions( createPath( 14, 0.2 ) )
	assert.deepEqual( { ...dynamic.drawRange }, { start: 6, count: 12 } )

	// A rejected update clears the surface; the next accepted one starts clean.
	assert.throws( () => dynamic.setPositions( new Float32Array( [0, 0, 0, Number.NaN, 0, 0] ) ) )
	assert.equal( dynamic.vertexCount, 0 )
	assert.equal( dynamic.indexCount, 0 )
	dynamic.setPositions( createPath( 10, 0.7 ) )
	assert.equal( dynamic.attributes.position.count, dynamic.vertexCount )
	reference.dispose()
	dynamic.dispose()
} )

test( 'the facade keeps a dynamic surface in its buffers', () => {
	const gpu = createGpu()
	const line = new MeshLine().lines( createPath( 12, 0.5 ) ).surface( true ).join( ROUND ).lineWidth( 0.6 ).dynamic( true ).build()
	gpu.render( line.geometry )
	line.setPositions( createPath( 12, 2 ) )
	gpu.render( line.geometry )
	const position = line.geometry.attributes.position
	const created = gpu.created
	for ( const [pointCount, sharpness] of [[12, 0.3], [11, 1.7], [12, 2], [10, 0.9]] ) {
		const points = createPath( pointCount, sharpness )
		line.setPositions( points )
		assertDrawsLike(
			line.geometry, gpu,
			new MeshLineSurfaceGeometry( { ...line.geometry.options, lines: points.slice(), usage: undefined, dynamic: false } ),
			`facade ${pointCount}/${sharpness}`
		)
	}
	assert.equal( line.geometry.attributes.position, position )
	assert.equal( gpu.created, created )
	line.dispose()
} )
