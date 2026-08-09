import assert from 'node:assert/strict'
import test from 'node:test'

const pointEquals = ( a, b ) => a[0] === b[0] && a[1] === b[1]

const distanceSquaredToSegment = ( point, start, end ) => {
	const dx = end[0] - start[0]
	const dy = end[1] - start[1]
	const lengthSquared = dx * dx + dy * dy
	if ( lengthSquared === 0 ) {
		const px = point[0] - start[0]
		const py = point[1] - start[1]
		return px * px + py * py
	}

	const projection = Math.max( 0, Math.min( 1,
		( ( point[0] - start[0] ) * dx + ( point[1] - start[1] ) * dy ) / lengthSquared
	) )
	const px = point[0] - ( start[0] + dx * projection )
	const py = point[1] - ( start[1] + dy * projection )
	return px * px + py * py
}

const normalizePoints = ( points, closed = false ) => {
	const normalized = []
	const sourceIndices = []

	for ( let i = 0; i < points.length; i++ ) {
		const point = points[i]
		if ( !Number.isFinite( point[0] ) || !Number.isFinite( point[1] ) ) continue
		if ( normalized.length > 0 && pointEquals( normalized[normalized.length - 1], point ) ) continue
		normalized.push( point )
		sourceIndices.push( i )
	}

	if ( closed ) {
		while ( normalized.length > 1 && pointEquals( normalized[0], normalized[normalized.length - 1] ) ) {
			normalized.pop()
			sourceIndices.pop()
		}
	}

	return { points: normalized, sourceIndices }
}

const cuspIndices = ( points, closed, threshold = -0.9999 ) => {
	const cusps = new Set()
	const start = closed ? 0 : 1
	const end = closed ? points.length : points.length - 1

	for ( let i = start; i < end; i++ ) {
		const previous = points[( i - 1 + points.length ) % points.length]
		const point = points[i]
		const next = points[( i + 1 ) % points.length]
		const incomingX = point[0] - previous[0]
		const incomingY = point[1] - previous[1]
		const outgoingX = next[0] - point[0]
		const outgoingY = next[1] - point[1]
		const incomingLength = Math.hypot( incomingX, incomingY )
		const outgoingLength = Math.hypot( outgoingX, outgoingY )
		if ( incomingLength === 0 || outgoingLength === 0 ) continue
		const cosine = ( incomingX * outgoingX + incomingY * outgoingY ) / ( incomingLength * outgoingLength )
		if ( cosine <= threshold ) cusps.add( i )
	}

	return cusps
}

const simplifyOrderedArc = ( points, order, tolerance, chunkSegments, mandatory ) => {
	const kept = new Set()
	const toleranceSquared = tolerance * tolerance

	for ( let chunkStart = 0; chunkStart < order.length - 1; chunkStart += chunkSegments ) {
		const chunkEnd = Math.min( order.length - 1, chunkStart + chunkSegments )
		const stack = [[chunkStart, chunkEnd]]
		kept.add( order[chunkStart] )
		kept.add( order[chunkEnd] )

		while ( stack.length > 0 ) {
			const [start, end] = stack.pop()
			let split = -1
			let maximumError = -1

			for ( let i = start + 1; i < end; i++ ) {
				const sourceIndex = order[i]
				const error = mandatory.has( sourceIndex )
					? Infinity
					: distanceSquaredToSegment( points[sourceIndex], points[order[start]], points[order[end]] )
				// Strict comparison gives the earliest source point deterministic tie ownership.
				if ( error > maximumError ) {
					maximumError = error
					split = i
				}
			}

			if ( split !== -1 && maximumError > toleranceSquared ) {
				kept.add( order[split] )
				stack.push( [split, end], [start, split] )
			}
		}
	}

	return kept
}

const simplifyOpen = ( points, { tolerance, chunkSegments = 64 } ) => {
	if ( points.length === 0 ) return []
	if ( points.length === 1 ) return [0]
	const mandatory = cuspIndices( points, false )
	mandatory.add( 0 )
	mandatory.add( points.length - 1 )
	const order = Array.from( { length: points.length }, ( _, index ) => index )
	return Array.from( simplifyOrderedArc( points, order, tolerance, chunkSegments, mandatory ) ).sort( ( a, b ) => a - b )
}

const simplifyClosed = ( points, { tolerance, chunkSegments = 64 } ) => {
	if ( points.length < 3 ) return Array.from( { length: points.length }, ( _, index ) => index )
	const mandatory = cuspIndices( points, true )
	mandatory.add( 0 )

	let anchor = 1
	let farthestDistance = -1
	for ( let i = 1; i < points.length; i++ ) {
		const dx = points[i][0] - points[0][0]
		const dy = points[i][1] - points[0][1]
		const distance = dx * dx + dy * dy
		if ( distance > farthestDistance ) {
			farthestDistance = distance
			anchor = i
		}
	}
	mandatory.add( anchor )

	const firstArc = Array.from( { length: anchor + 1 }, ( _, index ) => index )
	const secondArc = Array.from( { length: points.length - anchor + 1 }, ( _, index ) => ( anchor + index ) % points.length )
	const kept = simplifyOrderedArc( points, firstArc, tolerance, chunkSegments, mandatory )
	for ( const index of simplifyOrderedArc( points, secondArc, tolerance, chunkSegments, mandatory ) ) kept.add( index )

	// A closed ribbon cannot be represented by fewer than three unique rows.
	for ( let i = 0; kept.size < 3 && i < points.length; i++ ) kept.add( i )
	return Array.from( kept ).sort( ( a, b ) => a - b )
}

const createChunkPlan = ( pointCount, chunkSegments ) => {
	const chunks = []
	for ( let segmentStart = 0; segmentStart < Math.max( 0, pointCount - 1 ); segmentStart += chunkSegments ) {
		const segmentCount = Math.min( chunkSegments, pointCount - 1 - segmentStart )
		chunks.push( {
			pointStart: segmentStart,
			pointEnd: segmentStart + segmentCount,
			segmentStart,
			segmentCount,
		} )
	}
	return chunks
}

const createStableScatterPlan = ( flags, workgroupSize ) => {
	const pointCount = flags.length
	const blockCount = Math.ceil( pointCount / workgroupSize )
	const localRanks = new Uint32Array( pointCount )
	const blockCounts = new Uint32Array( blockCount )
	const blockOffsets = new Uint32Array( blockCount )

	for ( let block = 0; block < blockCount; block++ ) {
		let rank = 0
		const end = Math.min( pointCount, ( block + 1 ) * workgroupSize )
		for ( let point = block * workgroupSize; point < end; point++ ) {
			rank += flags[point] ? 1 : 0
			localRanks[point] = rank
		}
		blockCounts[block] = rank
	}

	let retainedCount = 0
	for ( let block = 0; block < blockCount; block++ ) {
		blockOffsets[block] = retainedCount
		retainedCount += blockCounts[block]
	}

	const compacted = new Uint32Array( retainedCount )
	for ( let point = 0; point < pointCount; point++ ) {
		const block = Math.floor( point / workgroupSize )
		const previousRank = point % workgroupSize === 0 ? 0 : localRanks[point - 1]
		const rank = localRanks[point]
		if ( rank > previousRank ) compacted[blockOffsets[block] + rank - 1] = point
	}

	return {
		blockCounts,
		blockOffsets,
		compacted,
		localRanks,
		retainedCount,
		vertexCount: Math.max( 0, retainedCount - 1 ) * 6,
	}
}

const createLineSegmentRecords = ( linePointCounts, selectedByLine, closedByLine = [] ) => {
	const records = []
	let pointOffset = 0

	for ( let lineIndex = 0; lineIndex < linePointCounts.length; lineIndex++ ) {
		const selected = selectedByLine[lineIndex]
		for ( let i = 0; i + 1 < selected.length; i++ ) {
			records.push( [pointOffset + selected[i], pointOffset + selected[i + 1]] )
		}
		if ( closedByLine[lineIndex] && selected.length >= 3 ) {
			records.push( [pointOffset + selected[selected.length - 1], pointOffset + selected[0]] )
		}
		pointOffset += linePointCounts[lineIndex]
	}

	return records
}

const assertOpenTolerance = ( points, selected, tolerance ) => {
	const limit = tolerance * tolerance + 1e-10
	for ( let selectedIndex = 0; selectedIndex + 1 < selected.length; selectedIndex++ ) {
		const start = selected[selectedIndex]
		const end = selected[selectedIndex + 1]
		for ( let point = start + 1; point < end; point++ ) {
			assert.ok(
				distanceSquaredToSegment( points[point], points[start], points[end] ) <= limit,
				`point ${point} exceeds the tolerance between retained points ${start} and ${end}`
			)
		}
	}
}

const assertClosedTolerance = ( points, selected, tolerance ) => {
	const limit = tolerance * tolerance + 1e-10
	for ( let selectedIndex = 0; selectedIndex < selected.length; selectedIndex++ ) {
		const start = selected[selectedIndex]
		const end = selected[( selectedIndex + 1 ) % selected.length]
		let point = ( start + 1 ) % points.length
		while ( point !== end ) {
			assert.ok(
				distanceSquaredToSegment( points[point], points[start], points[end] ) <= limit,
				`closed point ${point} exceeds the tolerance between retained points ${start} and ${end}`
			)
			point = ( point + 1 ) % points.length
		}
	}
}

test( 'stable block scan and scatter preserve source order across partial workgroups', () => {
	const flags = [1, 0, 1, 1, 0, 1, 0, 0, 1, 0]
	const plan = createStableScatterPlan( flags, 4 )

	assert.deepEqual( Array.from( plan.localRanks ), [1, 1, 2, 3, 0, 1, 1, 1, 1, 1] )
	assert.deepEqual( Array.from( plan.blockCounts ), [3, 1, 1] )
	assert.deepEqual( Array.from( plan.blockOffsets ), [0, 3, 4] )
	assert.deepEqual( Array.from( plan.compacted ), [0, 2, 3, 5, 8] )
	assert.equal( plan.retainedCount, 5 )
	assert.equal( plan.vertexCount, 24 )
} )

test( 'stable scatter matches a serial filter at workgroup and capacity boundaries', () => {
	for ( const workgroupSize of [1, 2, 7, 64, 256] ) {
		for ( const pointCount of [1, workgroupSize, workgroupSize + 1, workgroupSize * 2 + 3] ) {
			const flags = Array.from( { length: pointCount }, ( _, index ) => index === 0 || index === pointCount - 1 || ( index * 17 ) % 11 < 3 )
			const expected = flags.flatMap( ( keep, index ) => keep ? [index] : [] )
			const plan = createStableScatterPlan( flags, workgroupSize )
			assert.deepEqual( Array.from( plan.compacted ), expected )
			assert.equal( plan.vertexCount, Math.max( 0, expected.length - 1 ) * 6 )
			assert.ok( plan.vertexCount <= Math.max( 0, pointCount - 1 ) * 6 )
		}
	}
} )

test( 'open endpoints remain owned when every interior point is discarded', () => {
	const points = Array.from( { length: 33 }, ( _, index ) => [index, 0] )
	const selected = simplifyOpen( points, { tolerance: 1_000, chunkSegments: 64 } )
	const flags = points.map( ( _, index ) => selected.includes( index ) )
	const scatter = createStableScatterPlan( flags, 16 )

	assert.deepEqual( selected, [0, 32] )
	assert.deepEqual( Array.from( scatter.compacted ), [0, 32] )
	assert.equal( scatter.vertexCount, 6 )
} )

test( 'chunk seams share read points but own every source segment exactly once', () => {
	const chunks = createChunkPlan( 11, 3 )
	const ownedSegments = chunks.flatMap( chunk =>
		Array.from( { length: chunk.segmentCount }, ( _, index ) => chunk.segmentStart + index )
	)

	assert.deepEqual( chunks.map( chunk => [chunk.pointStart, chunk.pointEnd] ), [[0, 3], [3, 6], [6, 9], [9, 10]] )
	assert.deepEqual( ownedSegments, Array.from( { length: 10 }, ( _, index ) => index ) )
	assert.equal( new Set( ownedSegments ).size, ownedSegments.length )
	for ( let i = 1; i < chunks.length; i++ ) assert.equal( chunks[i - 1].pointEnd, chunks[i].pointStart )
} )

test( 'a non-sampled spike demonstrates why candidate heuristics are not tolerance guarantees', () => {
	const points = Array.from( { length: 17 }, ( _, index ) => [index, index === 1 ? 100 : 0] )
	const sampledCandidates = points
		.map( ( _, index ) => index === 0 || index === points.length - 1 || index % 8 === 0 ? index : -1 )
		.filter( index => index >= 0 )
	const oracle = simplifyOpen( points, { tolerance: 1, chunkSegments: 64 } )

	assert.equal( sampledCandidates.includes( 1 ), false )
	assert.ok( distanceSquaredToSegment( points[1], points[0], points[8] ) > 1 )
	assert.ok( oracle.includes( 1 ) )
	assertOpenTolerance( points, oracle, 1 )
} )

test( 'chunked oracle is deterministic and enforces the requested maximum error', () => {
	const points = Array.from( { length: 193 }, ( _, index ) => [
		index * 0.25,
		Math.sin( index * 0.11 ) * 2 + Math.sin( index * 0.53 ) * 0.2,
	] )
	const options = { tolerance: 0.125, chunkSegments: 32 }
	const first = simplifyOpen( points, options )
	const second = simplifyOpen( points, options )

	assert.deepEqual( first, second )
	assert.equal( first[0], 0 )
	assert.equal( first[first.length - 1], points.length - 1 )
	assert.ok( first.every( ( sourceIndex, index ) => index === 0 || first[index - 1] < sourceIndex ) )
	for ( let seam = options.chunkSegments; seam < points.length - 1; seam += options.chunkSegments ) {
		assert.ok( first.includes( seam ), `chunk seam ${seam} must be retained` )
	}
	assertOpenTolerance( points, first, options.tolerance )
} )

test( 'normalization removes duplicate runs and mandatory cusps preserve retraced topology', () => {
	const duplicateInput = [[0, 0], [0, 0], [1, 0], [1, 0], [2, 1], [2, 1]]
	const normalized = normalizePoints( duplicateInput )
	assert.deepEqual( normalized.points, [[0, 0], [1, 0], [2, 1]] )
	assert.deepEqual( normalized.sourceIndices, [0, 2, 4] )

	const retraced = [[0, 0], [1, 0], [0, 0], [1, 0], [2, 0]]
	const selected = simplifyOpen( retraced, { tolerance: 1_000, chunkSegments: 64 } )
	assert.ok( selected.includes( 1 ), 'the first exact reversal must survive' )
	assert.ok( selected.includes( 2 ), 'the second exact reversal must survive' )
	assert.deepEqual( selected, [0, 1, 2, 4] )
} )

test( 'closed paths remove duplicate seams, retain three rows, and close exactly once', () => {
	const input = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0], [0, 0]]
	const normalized = normalizePoints( input, true )
	const selected = simplifyClosed( normalized.points, { tolerance: 0.25, chunkSegments: 8 } )
	const records = createLineSegmentRecords( [normalized.points.length], [selected], [true] )

	assert.equal( normalized.points.length, 4 )
	assert.equal( selected[0], 0 )
	assert.ok( selected.length >= 3 )
	assert.equal( records.length, selected.length )
	assert.deepEqual( records[records.length - 1], [selected[selected.length - 1], selected[0]] )
	assertClosedTolerance( normalized.points, selected, 0.25 )
} )

test( 'multi-line segment planning never bridges independently simplified paths', () => {
	const lines = [
		Array.from( { length: 5 }, ( _, index ) => [index, 0] ),
		[[0, 0], [1, 8], [2, 0]],
		[[0, 0], [1, 0], [1, 1], [0, 1]],
	]
	const selected = [
		simplifyOpen( lines[0], { tolerance: 100, chunkSegments: 64 } ),
		simplifyOpen( lines[1], { tolerance: 0.5, chunkSegments: 64 } ),
		simplifyClosed( lines[2], { tolerance: 0.1, chunkSegments: 64 } ),
	]
	const records = createLineSegmentRecords( lines.map( line => line.length ), selected, [false, false, true] )
	const forbiddenBridges = new Set( ['4,5', '7,8'] )

	assert.ok( records.every( record => !forbiddenBridges.has( record.join( ',' ) ) ) )
	assert.ok( records.some( record => record[0] === 5 && record[1] === 6 ) )
	assert.ok( records.some( record => record[0] >= 8 && record[1] >= 8 ) )
} )
