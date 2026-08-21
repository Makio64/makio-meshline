import assert from 'node:assert/strict'
import test from 'node:test'

import MeshLineGeometry from '../src/MeshLineGeometry.js'

const clearUpdateRanges = geometry => {
	for ( const attribute of Object.values( geometry.attributes ) ) attribute.clearUpdateRanges()
	geometry.getIndex()?.clearUpdateRanges()
}

const assertRange = ( attribute, start, count ) => {
	assert.deepEqual( attribute.updateRanges, [{ start, count }] )
}

const assertClose = ( actual, expected, epsilon = 1e-6 ) => {
	assert.ok( Math.abs( actual - expected ) <= epsilon, `${actual} != ${expected}` )
}

const createStraightLine = ( start, pointCount ) => {
	const line = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) line[i * 3] = start + i
	return line
}

test( 'setPositionRange updates only the selected multi-line vertices and neighbor halo', () => {
	const geometry = new MeshLineGeometry( {
		lines: [createStraightLine( 0, 3 ), createStraightLine( 10, 5 )],
		needsProgress: false,
		dynamic: true,
	} )
	const index = geometry.getIndex()
	const side = geometry.getAttribute( 'side' )
	const indexVersion = index.version
	const sideVersion = side.version
	clearUpdateRanges( geometry )

	geometry.setPositionRange( new Float32Array( [11, 1, 0, 12, 1, 0] ), 1, { lineIndex: 1 } )

	const lineVertexOffset = 12
	const position = geometry.getAttribute( 'position' )
	const previous = geometry.getAttribute( 'previous' )
	const next = geometry.getAttribute( 'next' )
	assert.deepEqual(
		[position.getX( lineVertexOffset + 4 ), position.getY( lineVertexOffset + 4 )],
		[11, 1]
	)
	assert.deepEqual(
		[previous.getX( lineVertexOffset + 12 ), previous.getY( lineVertexOffset + 12 )],
		[12, 1]
	)
	assert.deepEqual(
		[next.getX( lineVertexOffset ), next.getY( lineVertexOffset )],
		[11, 1]
	)
	assertRange( position, 48, 24 )
	assertRange( previous, 36, 48 )
	assertRange( next, 36, 48 )
	assert.equal( index.version, indexVersion )
	assert.equal( side.version, sideVersion )
} )

test( 'setPositionRange refreshes arc-length progress, UV, and endpoint metadata for its line', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 4, 0, 0, 5, 0, 0] ),
		needsProgress: true,
		needsUV: true,
		needsEndpointMetadata: true,
	} )
	clearUpdateRanges( geometry )

	geometry.setPositionRange( new Float32Array( [2, 0, 0] ), 1 )

	const progress = geometry.getAttribute( 'progress' )
	const uv = geometry.getAttribute( 'uv' )
	const endpoint = geometry.getAttribute( 'endpoint' )
	for ( const [point, expected] of [0, 0.4, 0.8, 1].entries() ) {
		assertClose( progress.getX( point * 4 ), expected )
		assertClose( uv.getX( point * 4 ), expected )
	}
	assertClose( endpoint.getZ( 8 ), 0.4 )
	assertClose( endpoint.getW( 8 ), 0.2 )
	assertRange( geometry.getAttribute( 'position' ), 12, 12 )
	assertRange( progress, 0, 16 )
	assertRange( uv, 0, 32 )
	assertRange( endpoint, 0, 64 )
} )

test( 'setPositionRange keeps a closed CPU seam and wrapped neighbors coherent', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [
			0, 0, 0,
			1, 0, 0,
			1, 1, 0,
			0, 1, 0,
		] ),
		closed: true,
		needsProgress: false,
	} )
	clearUpdateRanges( geometry )

	geometry.setPositionRange( new Float32Array( [-1, 0, 0] ), 0 )

	const position = geometry.getAttribute( 'position' )
	const previous = geometry.getAttribute( 'previous' )
	const next = geometry.getAttribute( 'next' )
	assert.deepEqual( Array.from( geometry._lines[0].slice( -3 ) ), [-1, 0, 0] )
	assert.deepEqual( [position.getX( 0 ), position.getY( 0 )], [-1, 0] )
	assert.deepEqual( [position.getX( 16 ), position.getY( 16 )], [-1, 0] )
	assert.deepEqual( [previous.getX( 0 ), previous.getY( 0 )], [0, 1] )
	assert.deepEqual( [next.getX( 12 ), next.getY( 12 )], [-1, 0] )
	assert.deepEqual( [next.getX( 16 ), next.getY( 16 )], [1, 0] )
	assert.deepEqual( position.updateRanges, [{ start: 0, count: 12 }, { start: 48, count: 12 }] )
} )

test( 'setPositionRange refreshes both wrapped neighbors for closed procedural templates', () => {
	const geometry = new MeshLineGeometry( {
		lines: createStraightLine( 0, 5 ),
		closed: true,
		gpuPositionNode: () => null,
	} )
	const progress = geometry.getAttribute( 'progress' )
	const progressVersion = progress.version
	clearUpdateRanges( geometry )

	geometry.setPositionRange( new Float32Array( [3, 1, 0] ), 3 )
	assert.deepEqual(
		[geometry.getAttribute( 'previous' ).getX( 0 ), geometry.getAttribute( 'previous' ).getY( 0 )],
		[3, 1]
	)

	clearUpdateRanges( geometry )
	geometry.setPositionRange( new Float32Array( [1, 2, 0] ), 1 )
	const next = geometry.getAttribute( 'next' )
	assert.deepEqual( [next.getX( next.count - 1 ), next.getY( next.count - 1 )], [1, 2] )
	assert.equal( progress.version, progressVersion )
	assert.deepEqual( progress.updateRanges, [] )
} )

test( 'setPositionRange rejects topology changes and rolls back rejected width callbacks', () => {
	let rejectWidth = false
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 4, 0, 0] ),
		needsWidth: true,
		widthCallback: ( progress, pointIndex ) => rejectWidth && pointIndex === 2 ? Number.NaN : 1 + progress,
	} )
	const originalLine = geometry._lines[0].slice()
	const originalPosition = geometry.getAttribute( 'position' ).array.slice()
	const originalWidth = geometry.getAttribute( 'width' ).array.slice()

	assert.throws(
		() => geometry.setPositionRange( new Float32Array( [1, 0, 0] ), 0 ),
		/duplicate consecutive points/
	)
	assert.deepEqual( geometry._lines[0], originalLine )

	rejectWidth = true
	assert.throws(
		() => geometry.setPositionRange( new Float32Array( [2, 0, 0] ), 1 ),
		/widthCallback returned a non-finite value/
	)
	assert.deepEqual( geometry._lines[0], originalLine )
	assert.deepEqual( geometry.getAttribute( 'position' ).array, originalPosition )
	assert.deepEqual( geometry.getAttribute( 'width' ).array, originalWidth )

	const smooth = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 0, 0.1, 0] ),
		smoothSharpBends: true,
	} )
	assert.throws( () => smooth.setPositionRange( new Float32Array( [0.5, 0, 0] ), 1 ), /smoothSharpBends/ )
} )

test( 'pending full uploads subsume range updates and identical topology preserves indices', () => {
	const geometry = new MeshLineGeometry( {
		lines: createStraightLine( 0, 5 ),
		needsProgress: false,
	} )
	const index = geometry.getIndex()
	const side = geometry.getAttribute( 'side' )
	const indexValues = index.array.slice()
	const indexVersion = index.version
	const sideVersion = side.version
	assert.equal( geometry.getAttribute( 'endpoint' ), undefined )

	geometry.buildLine( { lineWidth: 2 } )
	assert.equal( geometry.getIndex(), index )
	assert.equal( index.version, indexVersion )
	assert.deepEqual( index.array, indexValues )
	assert.equal( side.version, sideVersion )
	assert.equal( geometry.getAttribute( 'endpoint' ), undefined )

	const position = geometry.getAttribute( 'position' )
	assertRange( position, 0, position.array.length )
	geometry.setPositionRange( new Float32Array( [2, 1, 0] ), 2 )
	assertRange( position, 0, position.array.length )

	clearUpdateRanges( geometry )
	geometry.setPositionRange( new Float32Array( [2, 2, 0] ), 2 )
	assertRange( position, 24, 12 )
} )

test( 'same totals with different per-line point counts regenerate connectivity', () => {
	const geometry = new MeshLineGeometry( {
		lines: [createStraightLine( 0, 2 ), createStraightLine( 10, 4 )],
		needsProgress: false,
	} )
	const index = geometry.getIndex()
	const original = index.array.slice()
	const version = index.version

	geometry.setLines( [createStraightLine( 0, 3 ), createStraightLine( 10, 3 )] )

	assert.equal( geometry.getIndex(), index )
	assert.equal( index.version, version + 1 )
	assert.notDeepEqual( index.array, original )
	assert.deepEqual( Array.from( index.array ), [
		2, 3, 4, 4, 3, 5,
		6, 7, 8, 8, 7, 9,
		14, 15, 16, 16, 15, 17,
		18, 19, 20, 20, 19, 21,
	] )
} )
