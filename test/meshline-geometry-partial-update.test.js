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

test( 'range edits keep scheduling uploads after a first upload that left ranges pending', () => {
	const geometry = new MeshLineGeometry( {
		lines: createStraightLine( 0, 5 ),
		needsProgress: false,
		dynamic: true,
	} )
	const position = geometry.getAttribute( 'position' )
	const previous = geometry.getAttribute( 'previous' )
	clearUpdateRanges( geometry )

	// An edit before the first draw: three creates the GPU buffer from the full
	// array and records the version, but never clears the pending ranges.
	geometry.setPositionRange( new Float32Array( [2, 1, 0] ), 2 )
	const uploadedVersion = position.version
	const uploadedPreviousVersion = previous.version
	assert.ok( position.updateRanges.length > 0 )

	geometry.setPositionRange( new Float32Array( [2, 2, 0] ), 2 )
	assert.ok( position.version > uploadedVersion, 'later edits must still bump the position version' )
	assert.ok( previous.version > uploadedPreviousVersion, 'later edits must still bump neighbor versions' )
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

test( 'partial buildLine keeps points written by in-place updates', () => {
	const geometry = new MeshLineGeometry( { lines: createStraightLine( 0, 3 ) } )
	const moved = createStraightLine( 5, 3 )
	geometry.setPositions( moved )
	geometry.buildLine( { lineWidth: 2 } )
	assert.equal( geometry.options.lines, moved )
	assert.deepEqual( Array.from( geometry._lines[0] ), Array.from( moved ) )

	// A closed loop stores a seam copy, so a range edit never reaches the
	// caller's array: the source moves to the stored points, seam excluded.
	const square = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] )
	const loop = new MeshLineGeometry( { lines: square, closed: true } )
	loop.setPositionRange( new Float32Array( [-1, -1, 0] ), 0 )
	const source = loop.options.lines
	loop.setPositionRange( new Float32Array( [2, 0, 0] ), 1 )
	assert.equal( loop.options.lines, source, 'later edits reuse the moved source' )
	assert.deepEqual( Array.from( square ), [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] )

	loop.buildLine( { lineWidth: 2 } )
	assert.deepEqual( Array.from( loop._lines[0] ), [-1, -1, 0, 2, 0, 0, 1, 1, 0, 0, 1, 0, -1, -1, 0] )
	loop.buildLine( { closed: false } )
	assert.deepEqual( Array.from( loop._lines[0] ), [-1, -1, 0, 2, 0, 0, 1, 1, 0, 0, 1, 0] )
} )

test( 'range edits keep each batch line at its caller index in the source', () => {
	// Open Float32Array lines are stored as given, so the edit already reached
	// the caller's array and the batch stays the source.
	const open = [createStraightLine( 0, 2 ), createStraightLine( 10, 2 )]
	const aliased = new MeshLineGeometry( { lines: open } )
	aliased.setPositionRange( new Float32Array( [11, 1, 0] ), 1, { lineIndex: 1 } )
	assert.equal( aliased.options.lines, open )
	assert.deepEqual( Array.from( open[1] ), [10, 0, 0, 11, 1, 0] )

	// A closed line is stored as a copy: the source becomes a new batch and the
	// caller's batch and arrays keep their points.
	const square = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] )
	const mixed = [createStraightLine( 10, 2 ), square]
	const looped = new MeshLineGeometry( { lines: mixed, closed: [false, true] } )
	looped.setPositionRange( new Float32Array( [0, -1, 0] ), 0, { lineIndex: 1 } )
	assert.notEqual( looped.options.lines, mixed )
	assert.equal( mixed[1], square )
	assert.equal( square[1], 0 )
	looped.buildLine( { lineWidth: 2 } )
	assert.deepEqual( looped._lineLoops, [false, true] )
	assert.deepEqual( Array.from( looped._lines[1].subarray( 0, 3 ) ), [0, -1, 0] )

	// A dropped single-point line stays in the copy, so the per-line flags
	// still select the loop.
	const sparse = [new Float32Array( [9, 9, 9] ), square.slice()]
	const dropped = new MeshLineGeometry( { lines: sparse, closed: [false, true] } )
	dropped.setPositionRange( new Float32Array( [0, -1, 0] ), 0 )
	assert.equal( dropped.options.lines[0], sparse[0] )
	dropped.buildLine( { lineWidth: 2 } )
	assert.deepEqual( dropped._lineLoops, [true] )
	assert.deepEqual( Array.from( dropped._lines[0].subarray( 0, 3 ) ), [0, -1, 0] )
} )

test( 'a throwing width callback rolls back like a non-finite width', () => {
	let rejectAt = -1
	const widthCallback = ( progress, pointIndex ) => {
		if ( pointIndex === rejectAt ) throw new Error( 'rejected' )
		return 1 + progress
	}
	const snapshot = geometry => Object.fromEntries(
		Object.entries( geometry.attributes ).map( ( [name, attribute] ) => [name, Array.from( attribute.array )] )
	)
	// Power-of-two segment lengths keep every progress and width exact.
	const geometry = new MeshLineGeometry( { lines: createStraightLine( 0, 5 ), needsWidth: true, widthCallback } )
	// Prime the arc-length cache, so the range edit below takes the fused writer.
	geometry.setPositionRange( new Float32Array( [1, 0, 0] ), 1 )
	const before = snapshot( geometry )
	const moved = createStraightLine( 0, 5 )
	moved[12] = 8

	// Both fused writers have written points 1 and 2 when point 3 throws, and
	// every point but the last when the last one throws.
	for ( const point of [3, 4] ) {
		rejectAt = point
		assert.throws( () => geometry.setPositions( moved ), /rejected/ )
		assert.deepEqual( snapshot( geometry ), before, `setPositions, point ${point}` )
		assert.throws( () => geometry.setPositionRange( new Float32Array( [8, 0, 0] ), 4 ), /rejected/ )
		assert.deepEqual( snapshot( geometry ), before, `setPositionRange, point ${point}` )
	}
} )

test( 'a rejected setPositions keeps the width maxima that pad the bounds', () => {
	let rejecting = false
	const widthCallback = ( progress, pointIndex, lineIndex ) => {
		if ( !rejecting ) return lineIndex + 1
		if ( lineIndex === 1 ) throw new Error( 'rejected' )
		return 5
	}
	const lines = () => [createStraightLine( 0, 3 ), createStraightLine( 10, 3 )]
	const geometry = new MeshLineGeometry( { lines: lines(), needsWidth: true, lineWidth: 1, widthCallback } )
	const padding = geometry.getBoundingPadding()

	// Line 0 widens to 5 before line 1 rejects the update.
	rejecting = true
	assert.throws( () => geometry.setPositions( lines() ), /rejected/ )
	rejecting = false
	assert.equal( geometry.getBoundingPadding(), padding )

	// A range edit pads by the widest line again, so line 0 must still be 1 wide.
	geometry.setPositionRange( new Float32Array( [11, 1, 0] ), 1, { lineIndex: 1 } )
	assert.equal( geometry.getBoundingPadding(), padding )
} )

test( 'range edits move only the edited line to its stored points', () => {
	// The other lines keep the closing point they were given, which still
	// draws once the loops open.
	const square = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0] )
	const triangle = new Float32Array( [3, 0, 0, 4, 0, 0, 4, 1, 0] )
	const geometry = new MeshLineGeometry( { lines: [square, triangle], closed: true } )
	geometry.setPositionRange( new Float32Array( [4, -1, 0] ), 1, { lineIndex: 1 } )
	assert.equal( geometry.options.lines[0], square )
	geometry.buildLine( { closed: false } )
	assert.deepEqual( Array.from( geometry._lines[0] ), Array.from( square ) )

	// A loop of two distinct points is drawn open from a view of the caller's
	// array without its closing point, which the edit leaves behind as a third.
	const pair = new Float32Array( [0, 0, 0, 1, 0, 0, 0, 0, 0] )
	const open = new MeshLineGeometry( { lines: pair, closed: true } )
	open.setPositionRange( new Float32Array( [-1, 0, 0] ), 0 )
	open.buildLine( { lineWidth: 2 } )
	assert.deepEqual( open._lineLoops, [false] )
	assert.deepEqual( Array.from( open._lines[0] ), [-1, 0, 0, 1, 0, 0] )
} )

test( 'range edits after point 0 keep a batch of loops given with their closing point', () => {
	// A gpuPositionNode loop draws a shorter view of the caller's array, whose
	// closing point still copies point 0 until an edit starts there. The batch
	// stays the source instead of becoming a copy on every edit.
	const ring = radius => {
		const points = new Float32Array( 9 * 3 )
		for ( let i = 0; i < 8; i++ ) {
			points[i * 3] = Math.cos( i / 4 * Math.PI ) * radius
			points[i * 3 + 1] = Math.sin( i / 4 * Math.PI ) * radius
		}
		return points.copyWithin( 24, 0, 3 )
	}
	const batch = [ring( 1 ), ring( 2 )]
	const geometry = new MeshLineGeometry( { lines: batch, closed: true, gpuPositionNode: {} } )
	geometry.setPositionRange( new Float32Array( [5, 5, 0] ), 3, { lineIndex: 1 } )
	assert.equal( geometry.options.lines, batch )

	// An edit at point 0 moves the line to its stored points.
	geometry.setPositionRange( new Float32Array( [6, 6, 0] ), 0, { lineIndex: 1 } )
	geometry.buildLine( { lineWidth: 2 } )
	assert.deepEqual( geometry._lineLoops, [true, true] )
	assert.equal( geometry._lines[1].length, 8 * 3 )
	assert.deepEqual( Array.from( geometry._lines[1].subarray( 0, 3 ) ), [6, 6, 0] )
	assert.deepEqual( Array.from( geometry._lines[1].subarray( 9, 12 ) ), [5, 5, 0] )
} )
