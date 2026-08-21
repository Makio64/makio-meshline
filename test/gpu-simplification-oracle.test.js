import assert from 'node:assert/strict'
import test from 'node:test'

import {
	buildChunkPlan,
	buildNeighbourPlan,
	isOuterRibbonSide,
	RELAX_MAX_ITERATIONS,
	relaxPositions,
	resolveCssPixelViewport,
	resolveProjectionSafeOffsetScale,
	resolveRelaxIterations,
	resolveRibbonNeighbours,
	resolveRibbonJoinOffset,
	resolveSimplificationSettings,
	RIBBON_CAMERA_PLANE_OFFSET_FRACTION,
	resolveChunkSegments,
	SIMPLIFICATION_CHUNK_MAX,
	SIMPLIFICATION_CHUNK_MIN,
	SIMPLIFICATION_LEVEL_MAX,
	simplifyChunkedDouglasPeucker,
	sourceGapHeat,
} from '../demo/src/utils/gpuSimplification.js'

const buildPositions = points => {
	const positions = new Float32Array( points.length * 4 )
	for ( let index = 0; index < points.length; index++ ) {
		positions[index * 4] = points[index][0]
		positions[index * 4 + 1] = points[index][1]
		positions[index * 4 + 2] = points[index][2] ?? 0
		positions[index * 4 + 3] = points[index][3] ?? 0
	}
	return positions
}

const distanceToSegment = ( positions, index, startIndex, endIndex ) => {
	const at = ( i, axis ) => positions[i * 4 + axis]
	const p = [0, 1, 2].map( axis => at( index, axis ) - at( startIndex, axis ) )
	const c = [0, 1, 2].map( axis => at( endIndex, axis ) - at( startIndex, axis ) )
	const lengthSquared = c.reduce( ( total, value ) => total + value * value, 0 )
	const t = lengthSquared > 0
		? Math.min( 1, Math.max( 0, p.reduce( ( total, value, axis ) => total + value * c[axis], 0 ) / lengthSquared ) )
		: 0
	return Math.hypot( ...p.map( ( value, axis ) => value - c[axis] * t ) )
}

const retainedIndices = keep => keep.reduce( ( list, flag, index ) => {
	if ( flag ) list.push( index )
	return list
}, [] )

const assertToleranceHolds = ( positions, keep, tolerance ) => {
	const selected = retainedIndices( keep )
	for ( let index = 0; index + 1 < selected.length; index++ ) {
		const start = selected[index]
		const end = selected[index + 1]
		for ( let point = start + 1; point < end; point++ ) {
			assert.ok(
				distanceToSegment( positions, point, start, end ) <= tolerance + 1e-9,
				`point ${point} exceeds the tolerance between retained ${start} and ${end}`,
			)
		}
	}
}

/**
 * A faithful JavaScript model of the compute passes: pinned chunk edges, a
 * bounded forward scan for the next retained point, a per-invocation left-spine
 * descent, a private settled flag, and the exact flush. If this diverges from
 * `simplifyChunkedDouglasPeucker` the shader is no longer Douglas-Peucker.
 */
const simulateGpuPipeline = ( positions, chunks, tolerance, {
	descent = 8,
	passes = 48,
	flush = true,
} = {} ) => {
	const pointCount = positions.length / 4
	const keep = new Uint8Array( pointCount )
	const settled = new Uint8Array( pointCount )

	// `bounds[p]` is the next pinned index after p, mirroring the uploaded buffer.
	const bounds = new Uint32Array( pointCount )
	const pinned = new Set()
	for ( const [start, end] of chunks ) {
		pinned.add( start )
		pinned.add( end )
	}
	const sorted = [...pinned].sort( ( a, b ) => a - b )
	for ( let index = 0; index < pointCount; index++ ) {
		bounds[index] = sorted.find( pin => pin > index ) ?? index
	}

	for ( const [start, end] of chunks ) {
		keep[start] = 1
		keep[end] = 1
	}

	const nextRetained = point => {
		for ( let index = point + 1; index < bounds[point]; index++ ) {
			if ( keep[index] ) return index
		}
		return bounds[point]
	}
	const worstIn = ( start, end ) => {
		let split = -1
		let worst = -1
		for ( let index = start + 1; index < end; index++ ) {
			const error = distanceToSegment( positions, index, start, end )
			if ( error > worst ) {
				worst = error
				split = index
			}
		}
		return { split, worst }
	}

	for ( let pass = 0; pass < passes; pass++ ) {
		const written = []
		for ( let point = 0; point < pointCount; point++ ) {
			if ( !keep[point] || settled[point] ) continue
			let end = nextRetained( point )
			for ( let step = 0; step < descent; step++ ) {
				if ( end - point < 2 ) {
					settled[point] = 1
					break
				}
				const { split, worst } = worstIn( point, end )
				if ( worst > tolerance ) {
					written.push( split )
					end = split
				} else {
					settled[point] = 1
					break
				}
			}
		}
		if ( written.length === 0 ) break
		for ( const index of written ) keep[index] = 1
	}

	if ( flush ) {
		for ( let point = 0; point < pointCount; point++ ) {
			if ( !keep[point] || settled[point] ) continue
			const end = nextRetained( point )
			if ( end - point < 2 ) continue
			if ( worstIn( point, end ).worst <= tolerance ) continue
			for ( let index = point + 1; index < end; index++ ) keep[index] = 1
		}
	}

	return keep
}

test( 'the GPU pass model reproduces textbook Douglas-Peucker exactly', () => {
	const points = Array.from( { length: 900 }, ( _, index ) => [
		index * 0.05,
		Math.sin( index * 0.037 ) * 3 + Math.sin( index * 0.31 ) * 0.4 + Math.sin( index * 1.7 ) * 0.05,
	] )
	const positions = buildPositions( points )
	const chunks = buildChunkPlan( [{ end: points.length - 1, start: 0 }], 128 )

	for ( const tolerance of [0.01, 0.05, 0.2, 1] ) {
		const oracle = simplifyChunkedDouglasPeucker( positions, chunks, tolerance )
		const simulated = simulateGpuPipeline( positions, chunks, tolerance )
		assert.deepEqual(
			retainedIndices( simulated ),
			retainedIndices( oracle.keep ),
			`tolerance ${tolerance} diverged from the recursive oracle`,
		)
		assertToleranceHolds( positions, simulated, tolerance )
	}
} )

test( 'a single-level descent needs more passes but converges to the same answer', () => {
	const points = Array.from( { length: 400 }, ( _, index ) => [
		index * 0.1,
		Math.round( Math.sin( index * 0.05 ) * 12 ) / 4,
	] )
	const positions = buildPositions( points )
	const chunks = buildChunkPlan( [{ end: points.length - 1, start: 0 }], 128 )
	const expected = retainedIndices( simplifyChunkedDouglasPeucker( positions, chunks, 0.2 ).keep )

	assert.deepEqual(
		retainedIndices( simulateGpuPipeline( positions, chunks, 0.2, { descent: 1, passes: 400 } ) ),
		expected,
	)
	assert.deepEqual(
		retainedIndices( simulateGpuPipeline( positions, chunks, 0.2, { descent: 16, passes: 400 } ) ),
		expected,
	)
} )

test( 'the flush trades points for a hard tolerance guarantee when passes run out', () => {
	// A staircase is the pathological case: Douglas-Peucker peels one point at a
	// time, so the recursion is far deeper than a balanced split would suggest.
	const points = Array.from( { length: 260 }, ( _, index ) => [index, Math.floor( index / 2 ) % 2] )
	const positions = buildPositions( points )
	const chunks = buildChunkPlan( [{ end: points.length - 1, start: 0 }], 128 )
	const tolerance = 0.25

	const starved = simulateGpuPipeline( positions, chunks, tolerance, { flush: false, passes: 2 } )
	const guarded = simulateGpuPipeline( positions, chunks, tolerance, { flush: true, passes: 2 } )

	assert.throws( () => assertToleranceHolds( positions, starved, tolerance ) )
	assertToleranceHolds( positions, guarded, tolerance )
	assert.ok(
		retainedIndices( guarded ).length > retainedIndices( starved ).length,
		'the flush only ever adds detail',
	)
} )

test( 'chunk plans cover every segment once and never bridge two polylines', () => {
	const ranges = [{ end: 10, start: 0 }, { end: 25, start: 11 }, { end: 26, start: 26 }]
	const chunks = buildChunkPlan( ranges, 4 )

	assert.deepEqual( chunks, [
		[0, 4],
		[4, 8],
		[8, 10],
		[11, 15],
		[15, 19],
		[19, 23],
		[23, 25],
	] )
	const covered = chunks.flatMap( ( [start, end] ) =>
		Array.from( { length: end - start }, ( _, index ) => start + index ) )
	assert.equal( new Set( covered ).size, covered.length, 'no segment is owned twice' )
	assert.deepEqual( covered.filter( segment => segment === 10 ), [], 'no chunk spans the gap between lines' )
	assert.equal( buildChunkPlan( ranges, 4, 3 ).length, 3, 'capacity is respected' )
} )

test( 'every pinned chunk edge survives, whatever the tolerance', () => {
	const points = Array.from( { length: 300 }, ( _, index ) => [index, 0] )
	const positions = buildPositions( points )
	const chunks = buildChunkPlan( [{ end: 299, start: 0 }], 64 )
	const { keep } = simplifyChunkedDouglasPeucker( positions, chunks, 1e6 )

	assert.deepEqual( retainedIndices( keep ), [0, 64, 128, 192, 256, 299] )
} )

test( 'a spike no sampling scheme would visit still survives', () => {
	const points = Array.from( { length: 129 }, ( _, index ) => [index, index === 1 ? 100 : 0] )
	const positions = buildPositions( points )
	const chunks = buildChunkPlan( [{ end: 128, start: 0 }], 128 )
	const { keep } = simplifyChunkedDouglasPeucker( positions, chunks, 1 )

	assert.ok( keep[1], 'the spike is the farthest point and must be kept' )
	assertToleranceHolds( positions, keep, 1 )
	assert.deepEqual(
		retainedIndices( simulateGpuPipeline( positions, chunks, 1 ) ),
		retainedIndices( keep ),
	)
} )

test( 'a zero tolerance is a lossless pass-through', () => {
	const points = Array.from( { length: 40 }, ( _, index ) => [index, Math.sin( index ) ] )
	const positions = buildPositions( points )
	const chunks = buildChunkPlan( [{ end: 39, start: 0 }], 16 )
	const { count } = simplifyChunkedDouglasPeucker( positions, chunks, 0 )

	assert.equal( count, 40 )
} )

test( 'simplification is deterministic and orders retained points by source index', () => {
	const points = Array.from( { length: 500 }, ( _, index ) => [
		index * 0.2,
		Math.sin( index * 0.09 ) * 4 + Math.cos( index * 0.4 ) * 0.3,
	] )
	const positions = buildPositions( points )
	const chunks = buildChunkPlan( [{ end: 499, start: 0 }], 128 )
	const first = retainedIndices( simplifyChunkedDouglasPeucker( positions, chunks, 0.15 ).keep )
	const second = retainedIndices( simplifyChunkedDouglasPeucker( positions, chunks, 0.15 ).keep )

	assert.deepEqual( first, second )
	assert.equal( first[0], 0 )
	assert.equal( first[first.length - 1], 499 )
	assert.ok( first.every( ( value, index ) => index === 0 || first[index - 1] < value ) )
} )

test( 'tolerance mapping is bounded, monotonic, and lossless at level zero', () => {
	const zero = resolveSimplificationSettings( 0 )
	assert.equal( zero.worldTolerance, 0 )
	assert.equal( zero.pixelTolerance, 0 )

	let previousWorld = 0
	let previousPixel = 0
	for ( let level = 1; level <= SIMPLIFICATION_LEVEL_MAX; level++ ) {
		const settings = resolveSimplificationSettings( level )
		assert.ok( settings.worldTolerance > previousWorld, `level ${level} must grow the world budget` )
		assert.ok( settings.pixelTolerance > previousPixel, `level ${level} must grow the pixel budget` )
		previousWorld = settings.worldTolerance
		previousPixel = settings.pixelTolerance
	}

	assert.equal( resolveSimplificationSettings( 1e6 ).level, SIMPLIFICATION_LEVEL_MAX )
	assert.equal( resolveSimplificationSettings( -20 ).level, 0 )
	assert.equal( resolveSimplificationSettings( Number.NaN ).level, 0 )
	// The world budget scales with the box so every dataset reads the same.
	assert.ok( Math.abs(
		resolveSimplificationSettings( 50, 192 ).worldTolerance -
		resolveSimplificationSettings( 50, 96 ).worldTolerance * 2,
	) < 1e-9 )
} )

test( 'relaxation pins open endpoints and welds a closed seam', () => {
	const open = [{ closed: false, end: 4, start: 0 }]
	assert.deepEqual( Array.from( buildNeighbourPlan( open, 5 ) ), [0, 0, 0, 2, 1, 3, 2, 4, 4, 4] )

	// A ring stores its first point again at the end, so both copies must see the
	// same two neighbours or the seam pulls apart as it relaxes.
	const ring = [{ closed: true, end: 4, start: 0 }]
	const neighbours = buildNeighbourPlan( ring, 5 )
	assert.deepEqual( Array.from( neighbours ), [3, 1, 0, 2, 1, 3, 2, 0, 3, 1] )

	const square = buildPositions( [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]] )
	const relaxed = relaxPositions( square, neighbours, 3 )
	assert.equal( relaxed[0], relaxed[16], 'the seam x stays welded' )
	assert.equal( relaxed[1], relaxed[17], 'the seam y stays welded' )

	const line = buildPositions( [[0, 0], [1, 5], [2, 0], [3, 5], [4, 0]] )
	const relaxedLine = relaxPositions( line, buildNeighbourPlan( open, 5 ), 4 )
	assert.deepEqual( Array.from( relaxedLine.slice( 0, 2 ) ), [0, 0] )
	assert.deepEqual( Array.from( relaxedLine.slice( 16, 18 ) ), [4, 0] )
	assert.ok( Math.abs( relaxedLine[5] ) < 5, 'the interior zigzag is eased toward the line' )
} )

test( 'relaxation cannot open a junction where an open line meets a ring', () => {
	// A square ring with a "river" whose mouth sits exactly on one of its points.
	// The river's endpoint is pinned; without a weld the ring point underneath it
	// relaxes away and the junction opens by a visible fraction of the ribbon.
	const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
	const river = [[10, 0], [14, 3], [18, 1], [22, 4]]
	const points = [...ring, ...river]
	const positions = buildPositions( points )
	const ranges = [
		{ closed: true, end: ring.length - 1, start: 0 },
		{ closed: false, end: points.length - 1, start: ring.length },
	]
	const junction = 1
	const mouth = ring.length

	const loose = relaxPositions( positions, buildNeighbourPlan( ranges, points.length ), 12 )
	const welded = relaxPositions( positions, buildNeighbourPlan( ranges, points.length, positions ), 12 )
	const gap = buffer => Math.hypot(
		buffer[junction * 4] - buffer[mouth * 4],
		buffer[junction * 4 + 1] - buffer[mouth * 4 + 1],
	)

	assert.ok( gap( loose ) > 0.1, 'without the weld the junction demonstrably drifts apart' )
	assert.equal( gap( welded ), 0, 'the weld holds the junction exactly' )
	// Welding must not freeze the rest of the ring.
	assert.notEqual( welded[2 * 4], positions[2 * 4] )
} )

test( 'the relaxation step never collapses two points onto each other', () => {
	// A pure alternating zigzag is the worst case: a point-to-midpoint step of
	// exactly one half has zero gain on this mode and would annihilate it in one
	// pass, landing both rows on the same coordinates.
	const points = Array.from( { length: 64 }, ( _, index ) => [index, index % 2 ? 1 : -1] )
	const positions = buildPositions( points )
	const ranges = [{ closed: false, end: points.length - 1, start: 0 }]
	const neighbours = buildNeighbourPlan( ranges, points.length )

	for ( const iterations of [1, 2, 4, 24] ) {
		const relaxed = relaxPositions( positions, neighbours, iterations )
		for ( let index = 0; index + 1 < points.length; index++ ) {
			const length = Math.hypot(
				relaxed[( index + 1 ) * 4] - relaxed[index * 4],
				relaxed[( index + 1 ) * 4 + 1] - relaxed[index * 4 + 1],
			)
			assert.ok( length > 0, `segment ${index} collapsed after ${iterations} iterations` )
		}
	}
} )

test( 'relaxation removes turning without deflating a closed ring', () => {
	const points = []
	for ( let index = 0; index < 200; index++ ) {
		const angle = index / 200 * Math.PI * 2
		// A quantised circle: the staircase is the thing relaxation should remove.
		points.push( [
			Math.round( Math.cos( angle ) * 20 * 4 ) / 4,
			Math.round( Math.sin( angle ) * 20 * 4 ) / 4,
		] )
	}
	points.push( points[0].slice() )
	const positions = buildPositions( points )
	const neighbours = buildNeighbourPlan( [{ closed: true, end: points.length - 1, start: 0 }], points.length )

	const turning = buffer => {
		let total = 0
		for ( let index = 1; index + 1 < points.length; index++ ) {
			const ax = buffer[index * 4] - buffer[( index - 1 ) * 4]
			const ay = buffer[index * 4 + 1] - buffer[( index - 1 ) * 4 + 1]
			const bx = buffer[( index + 1 ) * 4] - buffer[index * 4]
			const by = buffer[( index + 1 ) * 4 + 1] - buffer[index * 4 + 1]
			total += Math.abs( Math.atan2( ax * by - ay * bx, ax * bx + ay * by ) )
		}
		return total
	}
	const radius = buffer => {
		let total = 0
		for ( let index = 0; index + 1 < points.length; index++ ) {
			total += Math.hypot( buffer[index * 4], buffer[index * 4 + 1] )
		}
		return total / ( points.length - 1 )
	}

	const relaxed = relaxPositions( positions, neighbours, 8 )
	assert.ok( turning( relaxed ) < turning( positions ) * 0.5, 'relaxation must take the corners off' )
	// Plain Laplacian smoothing would shrink this by several percent per pass.
	assert.ok( Math.abs( radius( relaxed ) - radius( positions ) ) < 0.05, 'the Taubin pair must not deflate it' )
} )

test( 'relaxing first lets the simplifier keep far fewer points', () => {
	const points = []
	for ( let index = 0; index < 1_200; index++ ) {
		const t = index / 40
		// Smooth shape, stored on a coarse grid: exactly the staircase that forces
		// Douglas-Peucker to keep points it gains nothing from.
		points.push( [index * 0.1, Math.round( Math.sin( t ) * 6 * 3 ) / 3] )
	}
	const positions = buildPositions( points )
	const ranges = [{ closed: false, end: points.length - 1, start: 0 }]
	const chunks = buildChunkPlan( ranges, 128 )
	const neighbours = buildNeighbourPlan( ranges, points.length )
	const tolerance = 0.15

	const raw = simplifyChunkedDouglasPeucker( positions, chunks, tolerance ).count
	const relaxed = simplifyChunkedDouglasPeucker(
		relaxPositions( positions, neighbours, 8 ),
		chunks,
		tolerance,
	).count

	assert.ok( relaxed < raw * 0.6, `relaxing first should cut the survivors (${raw} → ${relaxed})` )
} )

test( 'relaxation is a no-op at zero passes and never mutates its input', () => {
	const points = Array.from( { length: 20 }, ( _, index ) => [index, Math.sin( index ) * 3] )
	const positions = buildPositions( points )
	const original = Float32Array.from( positions )
	const neighbours = buildNeighbourPlan( [{ closed: false, end: 19, start: 0 }], 20 )

	assert.deepEqual( Array.from( relaxPositions( positions, neighbours, 0 ) ), Array.from( original ) )
	relaxPositions( positions, neighbours, 6 )
	assert.deepEqual( Array.from( positions ), Array.from( original ), 'the source buffer is untouched' )

	// The polyline id in `w` has to survive, or the renderer joins separate strokes.
	const tagged = buildPositions( points.map( ( point, index ) => [...point, 0, index < 10 ? 3 : 7] ) )
	const carried = relaxPositions( tagged, neighbours, 5 )
	for ( let index = 0; index < 20; index++ ) {
		assert.equal( carried[index * 4 + 3], index < 10 ? 3 : 7 )
	}

	assert.equal( resolveRelaxIterations( -5 ), 0 )
	assert.equal( resolveRelaxIterations( 1e6 ), RELAX_MAX_ITERATIONS )
	assert.equal( resolveRelaxIterations( Number.NaN ), 0 )
} )

test( 'chunk length follows the tolerance so the pinned seams never become the output', () => {
	const points = 156_000
	// A tight tolerance keeps the lattice short: chunks are only expensive there,
	// and the seam floor is irrelevant when the result keeps tens of thousands.
	assert.equal( resolveChunkSegments( 0.00004, points ), SIMPLIFICATION_CHUNK_MIN )
	assert.equal( resolveChunkSegments( 0.0005, points ), 256 )
	// A loose tolerance stretches it, so the floor stays far below what
	// Douglas-Peucker actually wants to keep.
	assert.equal( resolveChunkSegments( 0.02, points ), SIMPLIFICATION_CHUNK_MAX )

	let previous = 0
	for ( let level = 1; level <= SIMPLIFICATION_LEVEL_MAX; level++ ) {
		const { relativeTolerance } = resolveSimplificationSettings( level )
		const segments = resolveChunkSegments( relativeTolerance, points )
		assert.ok( segments >= previous, 'chunk length must never shrink as tolerance grows' )
		assert.ok( Number.isInteger( Math.log2( segments ) ), 'chunk length stays a power of two' )
		assert.ok( segments >= SIMPLIFICATION_CHUNK_MIN && segments <= SIMPLIFICATION_CHUNK_MAX )
		previous = segments
	}

	// Degenerate inputs fall back to the short lattice rather than NaN.
	assert.equal( resolveChunkSegments( 0, points ), SIMPLIFICATION_CHUNK_MIN )
	assert.equal( resolveChunkSegments( Number.NaN, points ), SIMPLIFICATION_CHUNK_MIN )
	assert.equal( resolveChunkSegments( 0.01, 0 ), SIMPLIFICATION_CHUNK_MIN )
} )

test( 'the seam floor stays far below what Douglas-Peucker wants at a loose tolerance', () => {
	// A smooth arc sampled far more finely than its shape needs: at a loose
	// tolerance DP wants a handful of points, and a short chunk lattice would
	// swamp that with pinned edges instead.
	const points = Array.from( { length: 20_001 }, ( _, index ) => {
		const t = index / 20_000 * Math.PI
		return [Math.cos( t ) * 40, Math.sin( t ) * 40]
	} )
	const positions = buildPositions( points )
	const ranges = [{ closed: false, end: points.length - 1, start: 0 }]
	const tolerance = 0.5

	const short = simplifyChunkedDouglasPeucker( positions, buildChunkPlan( ranges, SIMPLIFICATION_CHUNK_MIN ), tolerance )
	const adaptive = simplifyChunkedDouglasPeucker( positions, buildChunkPlan( ranges, SIMPLIFICATION_CHUNK_MAX ), tolerance )
	const unchunked = simplifyChunkedDouglasPeucker( positions, [[0, points.length - 1]], tolerance )

	assert.ok( short.count > unchunked.count * 5, 'a short lattice is dominated by its own seams' )
	assert.ok( adaptive.count < unchunked.count * 1.5, 'a long lattice tracks the unchunked answer' )
	assertToleranceHolds( positions, adaptive.keep, tolerance )
} )

test( 'a closed ring wraps across its seam instead of capping twice', () => {
	const ring = { closed: true, end: 8, start: 0 }
	// The seam point is stored twice, at `start` and at `end`. Both copies must
	// resolve to the same pair of real neighbours, or the ribbon renders two
	// independent butt caps stacked on one position and the seam is severed.
	assert.deepEqual( resolveRibbonNeighbours( 0, ring ), { next: 1, previous: 7 } )
	assert.deepEqual( resolveRibbonNeighbours( 8, ring ), { next: 1, previous: 7 } )
	assert.deepEqual( resolveRibbonNeighbours( 4, ring ), { next: 5, previous: 3 } )

	// An open line still pins its ends, so it keeps its caps.
	const line = { closed: false, end: 8, start: 0 }
	assert.deepEqual( resolveRibbonNeighbours( 0, line ), { next: 1, previous: 0 } )
	assert.deepEqual( resolveRibbonNeighbours( 8, line ), { next: 8, previous: 7 } )
	assert.deepEqual( resolveRibbonNeighbours( 4, line ), { next: 5, previous: 3 } )

	// A run that is not the first in the buffer must not wrap to index 0.
	const offset = { closed: true, end: 20, start: 12 }
	assert.deepEqual( resolveRibbonNeighbours( 12, offset ), { next: 13, previous: 19 } )
	assert.deepEqual( resolveRibbonNeighbours( 20, offset ), { next: 13, previous: 19 } )

	// Degenerate runs must stay in range rather than underflow.
	for ( const run of [
		{ closed: true, end: 0, start: 0 },
		{ closed: true, end: 1, start: 0 },
		{ closed: false, end: 0, start: 0 },
	] ) {
		for ( const index of [run.start, run.end] ) {
			const { next, previous } = resolveRibbonNeighbours( index, run )
			assert.ok( previous >= run.start && previous <= run.end, `previous ${previous} left the run` )
			assert.ok( next >= run.start && next <= run.end, `next ${next} left the run` )
		}
	}
} )

test( 'heatmap is finite, clamped, and logarithmically ordered by collapsed source span', () => {
	const limit = SIMPLIFICATION_CHUNK_MAX
	const gaps = [0, 1, 4, 16, 64, limit, limit * 4, Infinity, NaN]
	const heat = gaps.map( gap => sourceGapHeat( gap, limit ) )

	assert.ok( heat.every( Number.isFinite ) )
	assert.equal( heat[0], 0, 'a degenerate gap reads as no compression' )
	assert.equal( heat[1], 0, 'a one-to-one segment reads as no compression' )
	assert.equal( heat[5], 1, 'a full-chunk span saturates the ramp' )
	assert.equal( heat[6], 1, 'anything beyond a chunk stays clamped' )
	assert.equal( heat[7], 1 )
	assert.equal( heat[8], 0, 'NaN falls back to no compression rather than propagating' )
	assert.ok( heat[2] < heat[3] && heat[3] < heat[4] && heat[4] < heat[5] )
	// Logarithmic, so equal ratios are equal steps.
	assert.ok( Math.abs( ( heat[3] - heat[2] ) - ( heat[4] - heat[3] ) ) < 1e-9 )
} )

test( 'screen error uses CSS pixels and is invariant to drawing-buffer pixel ratio', () => {
	assert.deepEqual( resolveCssPixelViewport( 1353, 725, 1 ), { width: 1353, height: 725 } )
	assert.deepEqual( resolveCssPixelViewport( 2706, 1450, 2 ), { width: 1353, height: 725 } )
	assert.deepEqual( resolveCssPixelViewport( 4059, 2175, 3 ), { width: 1353, height: 725 } )
	assert.deepEqual( resolveCssPixelViewport( 2706, 1450, 0 ), { width: 2706, height: 1450 } )
} )

test( 'outer bevel selection emits exactly one ribbon side for either turn sign', () => {
	assert.equal( isOuterRibbonSide( -1, true ), true )
	assert.equal( isOuterRibbonSide( -1, false ), false )
	assert.equal( isOuterRibbonSide( 1, true ), false )
	assert.equal( isOuterRibbonSide( 1, false ), true )
	assert.equal( [false, true].filter( side => isOuterRibbonSide( -1, side ) ).length, 1 )
	assert.equal( [false, true].filter( side => isOuterRibbonSide( 1, side ) ).length, 1 )
} )

test( 'ribbon offsets cannot cross the camera plane from either side', () => {
	const requestedLength = 2.56
	for ( const clipW of [-0.1, 0.1] ) {
		const scale = resolveProjectionSafeOffsetScale( clipW, requestedLength )
		const resolvedLength = requestedLength * scale
		assert.ok( resolvedLength <= Math.abs( clipW ) * RIBBON_CAMERA_PLANE_OFFSET_FRACTION )
		assert.ok( Math.abs( clipW ) - resolvedLength > 0 )
	}

	assert.equal( resolveProjectionSafeOffsetScale( -4, requestedLength ), 1 )
	assert.equal( resolveProjectionSafeOffsetScale( 0, requestedLength ), 0 )
	assert.equal( resolveProjectionSafeOffsetScale( Number.NaN, requestedLength ), 0 )
} )

test( 'finite-leg join guard falls back to full-width body sides and keeps rails moving forward', () => {
	const points = [
		[0, 0, 0],
		[0.1, 0, 0],
		[0.14, 0.09, 0],
		[1.2, 0.12, 0],
	]
	const rawOffsets = [
		[0, 0.64, 0],
		[-1.8, 1.8, 0],
		[1.4, 1.4, 0],
		[0, 0.64, 0],
	]
	const startOffsets = []
	const endOffsets = []
	for ( let index = 0; index < points.length - 1; index++ ) {
		const chord = points[index + 1].map( ( value, axis ) => value - points[index][axis] )
		const chordLength = Math.hypot( ...chord )
		const bodySide = [-chord[1] / chordLength, chord[0] / chordLength, 0]
		const resolveAt = ( pointIndex, offset ) => {
			const previous = points[Math.max( 0, pointIndex - 1 )]
			const next = points[Math.min( points.length - 1, pointIndex + 1 )]
			const incoming = pointIndex === 0
				? next.map( ( value, axis ) => value - points[pointIndex][axis] )
				: points[pointIndex].map( ( value, axis ) => value - previous[axis] )
			const outgoing = pointIndex === points.length - 1
				? points[pointIndex].map( ( value, axis ) => value - previous[axis] )
				: next.map( ( value, axis ) => value - points[pointIndex][axis] )
			return resolveRibbonJoinOffset( offset, incoming, outgoing, bodySide, 0.64 )
		}
		startOffsets.push( resolveAt( index, rawOffsets[index] ) )
		endOffsets.push( resolveAt( index + 1, rawOffsets[index + 1] ) )
	}

	for ( let index = 0; index < points.length - 1; index++ ) {
		const chord = points[index + 1].map( ( value, axis ) => value - points[index][axis] )
		const chordLengthSquared = chord.reduce( ( total, value ) => total + value * value, 0 )
		for ( const side of [-1, 1] ) {
			const rail = points[index + 1].map( ( value, axis ) =>
				value + endOffsets[index][axis] * side - points[index][axis] - startOffsets[index][axis] * side
			)
			const progress = rail.reduce( ( total, value, axis ) => total + value * chord[axis], 0 ) /
				chordLengthSquared
			assert.ok( progress >= 0.099999, `rail ${index} side ${side} moves backward (${progress})` )
		}
		assert.ok( Math.abs( Math.hypot( ...startOffsets[index] ) - 0.64 ) < 1e-12 )
		assert.ok( Math.abs( Math.hypot( ...endOffsets[index] ) - 0.64 ) < 1e-12 )
	}
	assert.notDeepEqual( startOffsets[1], rawOffsets[1] )
	assert.notDeepEqual( endOffsets[1], rawOffsets[2] )
} )

test( 'finite-leg join guard handles zero and non-finite legs without NaN offsets', () => {
	assert.deepEqual( resolveRibbonJoinOffset( [1, 2, 3], [0, 0, 0], [1, 0, 0], [0, 1, 0], 2 ), [0, 2, 0] )
	assert.deepEqual( resolveRibbonJoinOffset( [1, 2, 3], [Infinity, 0, 0], [1, 0, 0], [0, 1, 0], 2 ), [0, 2, 0] )
	assert.ok( resolveRibbonJoinOffset( [1, 2, 3], [1, 0, 0], [0, 1, 0], [0, 1, 0], 2 ).every( Number.isFinite ) )
} )
