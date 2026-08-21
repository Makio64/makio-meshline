// Shared, side-effect-free pieces of the GPU simplification lab.
//
// Everything the compute shaders do is mirrored here in plain JavaScript so the
// pipeline can be reasoned about — and unit tested — without a GPU. The CPU
// Douglas-Peucker below is the reference the GPU result is checked against at
// runtime, which is the only honest way to claim the port is faithful.

// Chunking seeds the recursion in parallel and bounds the forward scan for the
// next retained point. Its cost is that every chunk edge is pinned and can never
// be removed, which puts a hard floor of pointCount/chunkSegments under the
// result. At a fixed 128 segments France bottomed out at 1,231 points and the
// tolerance slider went completely inert above about level 68 — every drawn
// vertex was a chunk edge rather than a feature, which is exactly what the
// residual kinking was.
//
// The floor only binds when the tolerance is loose, and long chunks are only
// expensive when the tolerance is tight (that is where the recursion is deep and
// a single invocation scans a whole chunk). Those two facts point the same way,
// so the chunk length is derived from the tolerance: short chunks stay cheap
// where they are harmless, long chunks appear only where the floor would
// otherwise dominate. Measured across all four datasets and the whole slider,
// this tracks a fully unchunked Douglas-Peucker to within 1.36x.
//
// The cap is 4096 rather than higher on measured grounds. Raising it to 16384
// does cut "gratuitous" vertices — retained points whose deletion would still
// leave the widened chord inside the tolerance, so ones Douglas-Peucker would
// never have chosen — from 60 to 8 across the four datasets. But those remaining
// bends are far below a pixel at any zoom the lab offers: paired captures at the
// two settings are identical, while the loosest tolerance goes from 3.8 ms to
// 27.9 ms because a chunk is scanned serially by a single invocation. Quality
// that cannot be seen is not worth a 7x rebuild.
export const SIMPLIFICATION_CHUNK_MIN = 128
export const SIMPLIFICATION_CHUNK_MAX = 4096
export const SIMPLIFICATION_REFINE_PASSES = 48
const CHUNK_TOLERANCE_SCALE = 3

/**
 * Chunk length for a given tolerance, as a power of two so the seam lattice is
 * stable as the slider moves and the plan only has to be rebuilt on a real step.
 *
 * @param {number} relativeTolerance - Tolerance as a fraction of the world box.
 * @param {number} pointCount - Source points in the dataset.
 * @returns {number} Segments per chunk.
 */
export const resolveChunkSegments = ( relativeTolerance, pointCount ) => {
	if ( !( relativeTolerance > 0 ) || !( pointCount > 0 ) ) return SIMPLIFICATION_CHUNK_MIN
	const target = CHUNK_TOLERANCE_SCALE * relativeTolerance * pointCount
	const rounded = 2 ** Math.round( Math.log2( Math.max( 1, target ) ) )
	return Math.min( SIMPLIFICATION_CHUNK_MAX, Math.max( SIMPLIFICATION_CHUNK_MIN, rounded ) )
}

export const SIMPLIFICATION_LEVEL_MAX = 100
export const RIBBON_JOIN_SUPPORT_FRACTION = 0.45
export const RIBBON_CAMERA_PLANE_OFFSET_FRACTION = 0.9

// Relaxation runs *before* simplification: it pulls every point toward the
// midpoint of its neighbours, which is what takes the corners off a staircase.
// A plain Laplacian shrinks a closed ring a little more with every pass, so each
// iteration is a Taubin λ/μ pair — a positive step followed by a slightly larger
// negative one. That combination is a low-pass filter with no net shrinkage, so
// a coastline relaxes without quietly deflating.
//
// λ is deliberately not 0.5. A point-to-midpoint step of exactly one half has a
// gain of exactly (1 - 2λ) = 0 on the alternating mode, so a quantisation zigzag
// is annihilated in a single step and both of its rows land on precisely the
// same coordinates: 10,636 zero-length segments on France and 30,442 on the line
// art, versus at most 15 at any other λ. A segment with no length has no
// direction to offset a ribbon along. Backing off to 0.48 costs about 5% more
// retained points and removes the collapse.
export const RELAX_MAX_ITERATIONS = 24
export const RELAX_LAMBDA = 0.48
export const RELAX_MU = -0.53

// Tolerance range, expressed as a fraction of the world box so every dataset
// reads the same way. 0.00004 keeps sub-pixel wiggle, 0.02 is brutal.
const RELATIVE_TOLERANCE_MIN = 0.00004
const RELATIVE_TOLERANCE_MAX = 0.02
const PIXEL_TOLERANCE_MIN = 0.08
const PIXEL_TOLERANCE_MAX = 12

export const resolveCssPixelViewport = ( width, height, pixelRatio = 1 ) => {
	const ratio = Number.isFinite( pixelRatio ) && pixelRatio > 0 ? pixelRatio : 1
	return {
		height: Math.max( 1, Number( height ) || 1 ) / ratio,
		width: Math.max( 1, Number( width ) || 1 ) / ratio,
	}
}

/**
 * Maps the 0-100 slider onto the two error budgets the shader compares against.
 * Level 0 is an exact pass-through: with a zero tolerance no chord can ever be
 * accepted, so every source point survives.
 */
export const resolveSimplificationSettings = ( level, worldSize = 96 ) => {
	const resolvedLevel = Math.round(
		Math.min( SIMPLIFICATION_LEVEL_MAX, Math.max( 0, Number( level ) || 0 ) ),
	)
	if ( resolvedLevel === 0 ) {
		return {
			level: 0,
			pixelTolerance: 0,
			relativeTolerance: 0,
			worldTolerance: 0,
		}
	}

	const t = ( resolvedLevel - 1 ) / ( SIMPLIFICATION_LEVEL_MAX - 1 )
	const relative = RELATIVE_TOLERANCE_MIN * ( RELATIVE_TOLERANCE_MAX / RELATIVE_TOLERANCE_MIN ) ** t
	return {
		level: resolvedLevel,
		pixelTolerance: PIXEL_TOLERANCE_MIN * ( PIXEL_TOLERANCE_MAX / PIXEL_TOLERANCE_MIN ) ** t,
		relativeTolerance: relative,
		worldTolerance: relative * worldSize,
	}
}

export const resolveRelaxIterations = value => Math.round(
	Math.min( RELAX_MAX_ITERATIONS, Math.max( 0, Number( value ) || 0 ) ),
)

/**
 * Per-point neighbour indices, so the relaxation shader never has to know where
 * a polyline starts or ends. An open line pins its two endpoints by pointing
 * them at themselves; a closed ring wraps across the seam, so the duplicated
 * first/last point relaxes identically from both sides and stays welded.
 *
 * When `positions` is supplied, any point that starts out exactly on top of an
 * open line's endpoint is pinned too. Otherwise a river mouth stays put while
 * the coastline it sits on relaxes away from it, and the junction opens by up to
 * a third of the ribbon width.
 *
 * @param {Array<{start: number, end: number, closed?: boolean}>} ranges
 * @param {number} pointCount - Length of the buffer to fill.
 * @param {Float32Array} [positions] - Flat xyz+lineId buffer, for junction welds.
 * @returns {Uint32Array} Interleaved `[previous, next]` per point.
 */
export const buildNeighbourPlan = ( ranges, pointCount, positions = null ) => {
	const neighbours = new Uint32Array( pointCount * 2 )
	for ( let index = 0; index < pointCount; index++ ) {
		neighbours[index * 2] = index
		neighbours[index * 2 + 1] = index
	}

	for ( const range of ranges ) {
		const { end, start } = range
		if ( end <= start ) continue
		// A closed ring repeats its first point at the end, so the ring's distinct
		// points are start..end-1 and the seam's real neighbours live either side.
		const span = range.closed ? end - start : end - start + 1
		for ( let index = start; index <= end; index++ ) {
			const local = index - start
			let previous = index - 1
			let next = index + 1
			if ( range.closed ) {
				previous = start + ( ( local - 1 + span ) % span )
				next = start + ( ( local + 1 ) % span )
			} else {
				if ( index === start || index === end ) {
					previous = index
					next = index
				}
			}
			neighbours[index * 2] = previous
			neighbours[index * 2 + 1] = next
		}
	}

	if ( positions === null ) return neighbours

	const anchors = new Set()
	const key = index => `${positions[index * 4]},${positions[index * 4 + 1]},${positions[index * 4 + 2]}`
	for ( const range of ranges ) {
		if ( range.closed || range.end <= range.start ) continue
		anchors.add( key( range.start ) )
		anchors.add( key( range.end ) )
	}
	if ( anchors.size === 0 ) return neighbours
	for ( let index = 0; index < pointCount; index++ ) {
		if ( !anchors.has( key( index ) ) ) continue
		neighbours[index * 2] = index
		neighbours[index * 2 + 1] = index
	}

	return neighbours
}

/**
 * CPU mirror of the relaxation passes, used by the runtime oracle and the tests.
 * Reads and writes whole buffers per half-step exactly like the ping-ponged
 * storage buffers do, so a point never sees a half-updated neighbour.
 *
 * @param {Float32Array} positions - Flat xyz+lineId buffer.
 * @param {Uint32Array} neighbours - From `buildNeighbourPlan`.
 * @param {number} iterations - Taubin λ/μ pairs to run.
 * @returns {Float32Array} A relaxed copy; the input is untouched.
 */
export const relaxPositions = ( positions, neighbours, iterations ) => {
	const passes = resolveRelaxIterations( iterations )
	let current = Float32Array.from( positions )
	if ( passes === 0 ) return current
	let target = Float32Array.from( positions )
	const pointCount = positions.length / 4

	const step = weight => {
		for ( let index = 0; index < pointCount; index++ ) {
			const previous = neighbours[index * 2]
			const next = neighbours[index * 2 + 1]
			for ( let axis = 0; axis < 3; axis++ ) {
				const value = current[index * 4 + axis]
				const average = ( current[previous * 4 + axis] + current[next * 4 + axis] ) * 0.5
				target[index * 4 + axis] = value + ( average - value ) * weight
			}
			target[index * 4 + 3] = current[index * 4 + 3]
		}
		const swap = current
		current = target
		target = swap
	}

	for ( let pass = 0; pass < passes; pass++ ) {
		step( RELAX_LAMBDA )
		step( RELAX_MU )
	}
	return current
}

/**
 * Splits every polyline into chunks of at most `chunkSegments` segments. The
 * chunk ends are pinned before refinement starts, which is what lets thousands
 * of independent recursions run at once instead of one serial descent per line.
 */
export const buildChunkPlan = ( ranges, chunkSegments = SIMPLIFICATION_CHUNK_MIN, capacity = Infinity ) => {
	const chunks = []
	for ( const range of ranges ) {
		const start = range.start
		const end = range.end
		if ( end <= start ) continue
		for ( let chunkStart = start; chunkStart < end; chunkStart += chunkSegments ) {
			if ( chunks.length >= capacity ) return chunks
			chunks.push( [chunkStart, Math.min( end, chunkStart + chunkSegments )] )
		}
	}
	return chunks
}

const distanceToSegment = ( positions, index, startIndex, endIndex ) => {
	const px = positions[index * 4] - positions[startIndex * 4]
	const py = positions[index * 4 + 1] - positions[startIndex * 4 + 1]
	const pz = positions[index * 4 + 2] - positions[startIndex * 4 + 2]
	const cx = positions[endIndex * 4] - positions[startIndex * 4]
	const cy = positions[endIndex * 4 + 1] - positions[startIndex * 4 + 1]
	const cz = positions[endIndex * 4 + 2] - positions[startIndex * 4 + 2]
	const chordLengthSquared = cx * cx + cy * cy + cz * cz
	const t = chordLengthSquared > 0
		? Math.min( 1, Math.max( 0, ( px * cx + py * cy + pz * cz ) / chordLengthSquared ) )
		: 0
	const dx = px - cx * t
	const dy = py - cy * t
	const dz = pz - cz * t
	return Math.sqrt( dx * dx + dy * dy + dz * dz )
}

/**
 * Textbook Douglas-Peucker over the same chunk plan the GPU uses, with the same
 * "first maximum wins" tie-break. This is the oracle, not a lookalike: the demo
 * runs it against the GPU result and reports the difference.
 *
 * @param {Float32Array} positions - Flat xyz+lineId buffer.
 * @param {Array<Array<number>>} chunks - `[startIndex, endIndex]` pairs.
 * @param {number} tolerance - Maximum allowed deviation in world units.
 * @returns {{ count: number, keep: Uint8Array }} Retained flags and their count.
 */
export const simplifyChunkedDouglasPeucker = ( positions, chunks, tolerance ) => {
	const pointCount = positions.length / 4
	const keep = new Uint8Array( pointCount )
	const stack = []

	for ( const [chunkStart, chunkEnd] of chunks ) {
		keep[chunkStart] = 1
		keep[chunkEnd] = 1
		stack.push( chunkStart, chunkEnd )

		while ( stack.length > 0 ) {
			const end = stack.pop()
			const start = stack.pop()
			if ( end - start < 2 ) continue

			let split = -1
			let maximum = -1
			for ( let index = start + 1; index < end; index++ ) {
				const error = distanceToSegment( positions, index, start, end )
				if ( error > maximum ) {
					maximum = error
					split = index
				}
			}

			if ( split < 0 || maximum <= tolerance ) continue
			keep[split] = 1
			stack.push( start, split, split, end )
		}
	}

	let count = 0
	for ( let index = 0; index < pointCount; index++ ) count += keep[index]
	return { count, keep }
}

/**
 * Neighbour indices the ribbon should use for a point, given the run its
 * polyline occupies. A closed ring repeats its first point at the end, so
 * clamping at the run edges would render it as an open stroke with two butt caps
 * stacked on one position and leave up to 82% of the stroke width unpainted at
 * the seam. Wrapping makes the seam an ordinary join.
 *
 * The vertex shader mirrors this exactly; keep the two in step.
 *
 * @param {number} pointIndex
 * @param {{ start: number, end: number, closed: boolean }} run
 * @returns {{ previous: number, next: number }}
 */
export const resolveRibbonNeighbours = ( pointIndex, run ) => {
	const { closed, end, start } = run
	const atStart = pointIndex <= start
	const atEnd = pointIndex >= end
	return {
		next: atEnd
			? ( closed ? Math.min( start + 1, end ) : pointIndex )
			: pointIndex + 1,
		previous: atStart
			? ( closed ? Math.max( start + 1, end ) - 1 : pointIndex )
			: pointIndex - 1,
	}
}

export const sourceGapHeat = ( sourceGap, maximumGap = SIMPLIFICATION_CHUNK_MAX ) => {
	const gap = Math.max( 1, Number( sourceGap ) || 1 )
	const limit = Math.max( 2, Number( maximumGap ) || 2 )
	return Math.min( 1, Math.max( 0, Math.log2( gap ) / Math.log2( limit ) ) )
}

export const isOuterRibbonSide = ( turn, positiveSide ) => positiveSide === ( turn < 0 )

export const resolveProjectionSafeOffsetScale = (
	clipW,
	offsetLength,
	fraction = RIBBON_CAMERA_PLANE_OFFSET_FRACTION,
) => {
	if ( !Number.isFinite( clipW ) || !Number.isFinite( offsetLength ) || offsetLength <= 0 ) return 0
	const safeFraction = Math.min( 0.99, Math.max( 0, Number( fraction ) || 0 ) )
	return Math.min( 1, Math.abs( clipW ) * safeFraction / offsetLength )
}

export const resolveRibbonJoinOffset = (
	offset,
	incomingVector,
	outgoingVector,
	bodySide,
	halfWidth,
	supportFraction = RIBBON_JOIN_SUPPORT_FRACTION,
) => {
	const incomingLength = Math.hypot( ...incomingVector )
	const outgoingLength = Math.hypot( ...outgoingVector )
	const offsetFinite = offset.every( Number.isFinite )

	const dotWithUnit = vector => Math.abs(
		offset.reduce( ( total, component, index ) => total + component * vector[index], 0 ) /
		Math.hypot( ...vector )
	)
	const support = offsetFinite && incomingLength > 0 && outgoingLength > 0
		? Math.max( dotWithUnit( incomingVector ), dotWithUnit( outgoingVector ) )
		: Infinity
	const available = Math.max( 0, Math.min( 0.5, Number( supportFraction ) || 0 ) ) *
		Math.min( incomingLength, outgoingLength )
	if ( support <= available ) return [...offset]

	const bodySideLength = Math.hypot( ...bodySide )
	if ( !Number.isFinite( bodySideLength ) || bodySideLength === 0 || !Number.isFinite( halfWidth ) ) {
		return offset.map( () => 0 )
	}
	return bodySide.map( component => component * Math.abs( halfWidth ) / bodySideLength )
}
