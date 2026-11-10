/**
 * The compute half of the GPU simplification lab: Taubin relaxation, chunk-parallel
 * Douglas-Peucker refinement, then a prefix-sum compaction that gathers the survivors
 * and writes their indirect draw commands. Each pass is one dispatch;
 * SimplificationPipeline decides how often each one repeats.
 */
import {
	abs,
	Break,
	clamp,
	dot,
	float,
	Fn,
	If,
	instanceIndex,
	invocationLocalIndex,
	Loop,
	max,
	min,
	storage,
	uint,
	vec3,
	vec4,
	workgroupArray,
	workgroupBarrier,
	workgroupId,
} from 'three/tsl'
import { StorageBufferAttribute } from 'three/webgpu'

import { RELAX_LAMBDA, RELAX_MU } from '@/utils/gpuSimplification'

export const POINT_CAPACITY = 262_144
export const OUTPUT_CAPACITY = POINT_CAPACITY
export const CHUNK_CAPACITY = 4096
export const LINE_CAPACITY = 256
export const RIBBON_VERTICES_PER_SEGMENT = 12
export const WIREFRAME_VERTICES_PER_SEGMENT = 6
export const LINE_VERTICES_PER_SEGMENT = 2
export const DRAW_COMMAND_UINTS = 4
export const EPSILON = 1e-6

const WORKGROUP_SIZE = 256
const BLOCK_COUNT = Math.ceil( POINT_CAPACITY / WORKGROUP_SIZE )
const BLOCKS_PER_PREFIX_LANE = Math.ceil( BLOCK_COUNT / WORKGROUP_SIZE )
// Recursion levels a single invocation descends per refinement dispatch.
const REFINE_DESCENT = 8

export const DECLARED_GPU_BYTES =
	POINT_CAPACITY * 4 * Float32Array.BYTES_PER_ELEMENT +
	POINT_CAPACITY * 3 * Uint32Array.BYTES_PER_ELEMENT +
	OUTPUT_CAPACITY * 4 * Float32Array.BYTES_PER_ELEMENT +
	OUTPUT_CAPACITY * Uint32Array.BYTES_PER_ELEMENT +
	BLOCK_COUNT * 2 * Uint32Array.BYTES_PER_ELEMENT +
	CHUNK_CAPACITY * 2 * Uint32Array.BYTES_PER_ELEMENT +
	( 4 + DRAW_COMMAND_UINTS * 3 ) * Uint32Array.BYTES_PER_ELEMENT

const uintStorage = count => storage( new StorageBufferAttribute( count, 1, Uint32Array ), 'uint', count )
const vec4Storage = count => storage( new StorageBufferAttribute( count, 4 ), 'vec4', count )

// Doubling prefix sum: after the last round every lane holds the sum up to itself.
const prefixSumAcrossWorkgroup = ( shared, localIndex ) => {
	for ( let offset = 1; offset < WORKGROUP_SIZE; offset *= 2 ) {
		const addition = uint( 0 ).toVar()
		If( localIndex.greaterThanEqual( uint( offset ) ), () => {
			addition.assign( shared.element( localIndex.sub( uint( offset ) ) ) )
		} )
		workgroupBarrier()
		shared.element( localIndex ).addAssign( addition )
		workgroupBarrier()
	}
}

const inverseSquare = tolerance => min( tolerance.mul( tolerance ), float( 1e30 ) ).toVar()

const forEachInteriorPoint = ( pointIndex, end, body ) => Loop(
	{ condition: '<', end, start: pointIndex.add( uint( 1 ) ), type: 'uint' },
	( { i } ) => {
		body( i )
	},
)

/**
 * @param {object} attributes - Buffers shared with the renderer and the uploads:
 * `source`, `neighbours`, `chunks`, `outputRuns`, `output`, `outputGaps`, `state`, `simplifiedDraw`
 * @param {object} uniforms - `pointCount`, `chunkCount`, `inverseWorldTolerance`,
 * `inversePixelTolerance`, `screenEnabled`, `projectionView`, `viewport`
 */
export function createSimplificationPasses( attributes, uniforms ) {
	const { chunkCount, inversePixelTolerance, inverseWorldTolerance, pointCount, projectionView, screenEnabled, viewport } = uniforms

	const source = storage( attributes.source, 'vec4', POINT_CAPACITY ).toReadOnly()
	const neighbours = storage( attributes.neighbours, 'uvec2', POINT_CAPACITY ).toReadOnly()
	const chunks = storage( attributes.chunks, 'uvec2', CHUNK_CAPACITY ).toReadOnly()
	const outputRuns = storage( attributes.outputRuns, 'uint', LINE_CAPACITY * 2 )
	// Everything downstream of relaxation reads `geometry`, never `source`.
	// With zero relax passes it is a straight copy, so the simplifier does not
	// need to know whether the curve was relaxed first.
	const geometry = vec4Storage( POINT_CAPACITY )
	const relaxScratch = vec4Storage( POINT_CAPACITY )
	const keep = uintStorage( POINT_CAPACITY )
	const settled = uintStorage( POINT_CAPACITY )
	const localRanks = uintStorage( POINT_CAPACITY )
	const compacted = uintStorage( POINT_CAPACITY )
	const blockCounts = uintStorage( BLOCK_COUNT )
	const blockOffsets = uintStorage( BLOCK_COUNT )
	const output = storage( attributes.output, 'vec4', OUTPUT_CAPACITY )
	const outputGap = storage( attributes.outputGaps, 'uint', OUTPUT_CAPACITY )
	const state = storage( attributes.state, 'uint', 4 )
	const simplifiedDraw = storage( attributes.simplifiedDraw, 'uint', 12 )
	const scanShared = workgroupArray( 'uint', WORKGROUP_SIZE )
	const blockScanShared = workgroupArray( 'uint', WORKGROUP_SIZE )

	const projectToPixel = Fn( ( [point] ) => {
		const clip = projectionView.mul( vec4( point, 1 ) ).toVar()
		const safeW = max( abs( clip.w ), EPSILON )
		return vec3( clip.xy.div( safeW ).mul( viewport.mul( 0.5 ) ), clip.w )
	} )

	const clear = Fn( () => {
		const pointIndex = instanceIndex.toUint()
		If( pointIndex.lessThan( uint( POINT_CAPACITY ) ), () => {
			keep.element( pointIndex ).assign( uint( 0 ) )
			settled.element( pointIndex ).assign( uint( 0 ) )
			geometry.element( pointIndex ).assign( source.element( pointIndex ) )
		} )
	} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

	// One relaxation half-step: pull every point a fraction of the way toward
	// the midpoint of its two neighbours. Run with a positive weight it takes
	// the corners off; run again with a slightly larger negative weight it
	// pushes the low frequencies back out, so the shape relaxes without
	// deflating. Pinned endpoints neighbour themselves and never move.
	const relaxStep = ( read, write, weightNode ) => Fn( () => {
		const pointIndex = instanceIndex.toUint()
		If( pointIndex.lessThan( pointCount ), () => {
			const point = read.element( pointIndex ).toVar()
			const pair = neighbours.element( pointIndex )
			const average = read.element( pair.x ).xyz.add( read.element( pair.y ).xyz ).mul( 0.5 )
			write.element( pointIndex ).assign(
				vec4( point.xyz.add( average.sub( point.xyz ).mul( weightNode ) ), point.w ),
			)
		} )
	} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

	const relaxShrink = relaxStep( geometry, relaxScratch, float( RELAX_LAMBDA ) )
	const relaxUnshrink = relaxStep( relaxScratch, geometry, float( RELAX_MU ) )

	// A retained point stores `end + 1` in `keep[pointIndex]`, where `end` is
	// the right endpoint of the interval it owns (or `pointIndex` itself at the
	// end of a polyline). `0` means not retained. Encoding both the flag and the
	// right endpoint into a single 32-bit word makes interval lookup O(1) instead
	// of an O(chunk) forward scan on every pass.
	const seed = Fn( () => {
		const chunkIndex = instanceIndex.toUint()
		If( chunkIndex.lessThan( chunkCount ), () => {
			const chunk = chunks.element( chunkIndex )
			keep.element( chunk.x ).assign( chunk.y.add( uint( 1 ) ) )
			const nextIndex = chunkIndex.add( uint( 1 ) )
			const closesRun = nextIndex.greaterThanEqual( chunkCount )
				.or( chunks.element( nextIndex ).x.equal( chunk.y ).not() )
			If( closesRun, () => {
				keep.element( chunk.y ).assign( chunk.y.add( uint( 1 ) ) )
			} )
		} )
	} )().compute( CHUNK_CAPACITY, [WORKGROUP_SIZE] )

	// Runs `body( pointIndex, end )` on every retained point with an unsettled interval.
	const forEachOpenInterval = body => Fn( () => {
		const pointIndex = instanceIndex.toUint()
		If( pointIndex.lessThan( pointCount ), () => {
			const keepValue = keep.element( pointIndex ).toVar()
			const active = keepValue.greaterThan( uint( 0 ) )
				.and( settled.element( pointIndex ).equal( uint( 0 ) ) )
			If( active, () => {
				body( pointIndex, keepValue.sub( uint( 1 ) ).toVar() )
			} )
		} )
	} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

	// What the error test needs to know about the chord from `pointIndex` to `end`.
	// The screen-space half only stays on while both ends are in front of the camera.
	const chordFrame = ( pointIndex, end, screenActive ) => {
		const startPos = geometry.element( pointIndex ).xyz.toVar()
		const endPos = geometry.element( end ).xyz.toVar()
		const chord = endPos.sub( startPos ).toVar()
		const invChordLenSq = float( 1 ).div( max( dot( chord, chord ), EPSILON ) ).toVar()

		const projectedStart = vec3( 0, 0, 0 ).toVar()
		const projectedEnd = vec3( 0, 0, 0 ).toVar()
		const screenChord = vec3( 0, 0, 0 ).xy.toVar()
		const invScreenChordLenSq = float( 0 ).toVar()
		const checkScreen = screenActive.toVar()

		If( checkScreen, () => {
			projectedStart.assign( projectToPixel( startPos ) )
			projectedEnd.assign( projectToPixel( endPos ) )
			If( projectedStart.z.lessThanEqual( EPSILON ).or( projectedEnd.z.lessThanEqual( EPSILON ) ), () => {
				checkScreen.assign( false )
			} ).Else( () => {
				screenChord.assign( projectedEnd.xy.sub( projectedStart.xy ) )
				invScreenChordLenSq.assign( float( 1 ).div( max( dot( screenChord, screenChord ), EPSILON ) ) )
			} )
		} )

		return { checkScreen, chord, invChordLenSq, invScreenChordLenSq, projectedStart, screenChord, startPos }
	}

	// Squared distance from a point to the chord, in tolerances: above 1 is over budget.
	const pointErrorSq = ( i, frame, invWorldTolSq, invPixelTolSq ) => {
		const { checkScreen, chord, invChordLenSq, invScreenChordLenSq, projectedStart, screenChord, startPos } = frame
		const point = geometry.element( i ).xyz
		const rel = point.sub( startPos )
		const t = clamp( dot( rel, chord ).mul( invChordLenSq ), 0, 1 )
		const diff = rel.sub( chord.mul( t ) )
		const errorSq = dot( diff, diff ).mul( invWorldTolSq ).toVar()

		If( checkScreen, () => {
			const projectedPoint = projectToPixel( point )
			If( projectedPoint.z.greaterThan( EPSILON ), () => {
				const screenRel = projectedPoint.xy.sub( projectedStart.xy )
				const screenT = clamp( dot( screenRel, screenChord ).mul( invScreenChordLenSq ), 0, 1 )
				const screenDiff = screenRel.sub( screenChord.mul( screenT ) )
				errorSq.assign( max( errorSq, dot( screenDiff, screenDiff ).mul( invPixelTolSq ) ) )
			} )
		} )

		return errorSq
	}

	// One refinement pass drives the Douglas-Peucker recursion forward for every
	// open interval at once. The interval between two retained points is owned
	// by its left endpoint, and that owner is the only invocation that ever
	// writes inside it, so the whole pass is race-free without atomics.
	//
	// A split hands the right half to the newly retained point and keeps the
	// left half, so the owner can descend its own left spine several levels in
	// one dispatch instead of costing one dispatch per level. Wide chunks split
	// once per pass so both halves run in parallel on the next dispatch rather
	// than stalling one invocation across thousands of points.
	const refine = forEachOpenInterval( ( pointIndex, end ) => {
		const invWorldTolSq = inverseSquare( inverseWorldTolerance )
		const invPixelTolSq = inverseSquare( inversePixelTolerance )
		const screenActive = screenEnabled.greaterThan( 0 ).toVar()

		Loop( { condition: '<', end: uint( REFINE_DESCENT ), start: uint( 0 ), type: 'uint' }, ( { i: step } ) => {
			const span = end.sub( pointIndex )
			If( span.lessThan( uint( 2 ) ), () => {
				settled.element( pointIndex ).assign( uint( 1 ) )
				Break()
			} )
			If( step.greaterThan( uint( 0 ) ).and( span.greaterThan( uint( 256 ) ) ), () => {
				Break()
			} )

			const frame = chordFrame( pointIndex, end, screenActive )
			const worstSq = float( -1 ).toVar()
			const split = uint( 0 ).toVar()
			forEachInteriorPoint( pointIndex, end, i => {
				const errorSq = pointErrorSq( i, frame, invWorldTolSq, invPixelTolSq )
				If( errorSq.greaterThan( worstSq ), () => {
					worstSq.assign( errorSq )
					split.assign( i )
				} )
			} )

			If( worstSq.greaterThan( float( 1 ) ), () => {
				keep.element( split ).assign( end.add( uint( 1 ) ) )
				end.assign( split )
				keep.element( pointIndex ).assign( split.add( uint( 1 ) ) )
			} ).Else( () => {
				settled.element( pointIndex ).assign( uint( 1 ) )
				Break()
			} )
		} )
	} )

	// Whatever the refinement budget could not resolve is expanded to full
	// detail, so the tolerance is a guarantee rather than a hope.
	const flush = forEachOpenInterval( ( pointIndex, end ) => {
		If( end.sub( pointIndex ).greaterThan( uint( 1 ) ), () => {
			const invWorldTolSq = inverseSquare( inverseWorldTolerance )
			const invPixelTolSq = inverseSquare( inversePixelTolerance )
			const frame = chordFrame( pointIndex, end, screenEnabled.greaterThan( 0 ) )

			const exceeded = uint( 0 ).toVar()
			forEachInteriorPoint( pointIndex, end, i => {
				const errorSq = pointErrorSq( i, frame, invWorldTolSq, invPixelTolSq )
				If( errorSq.greaterThan( float( 1 ) ), () => {
					exceeded.assign( uint( 1 ) )
					Break()
				} )
			} )
			If( exceeded.greaterThan( uint( 0 ) ), () => {
				forEachInteriorPoint( pointIndex, end, i => {
					keep.element( i ).assign( uint( 1 ) )
				} )
			} )
		} )
	} )

	const scan = Fn( () => {
		const pointIndex = instanceIndex.toUint()
		const localIndex = invocationLocalIndex.toUint()
		const flag = uint( 0 ).toVar()
		If( pointIndex.lessThan( pointCount ), () => {
			flag.assign( keep.element( pointIndex ).greaterThan( uint( 0 ) ).select( uint( 1 ), uint( 0 ) ) )
		} )

		scanShared.element( localIndex ).assign( flag )
		workgroupBarrier()
		prefixSumAcrossWorkgroup( scanShared, localIndex )

		localRanks.element( pointIndex ).assign( scanShared.element( localIndex ) )
		If( localIndex.equal( uint( WORKGROUP_SIZE - 1 ) ), () => {
			blockCounts.element( workgroupId.x ).assign( scanShared.element( localIndex ) )
		} )
	} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

	const blockPrefix = Fn( () => {
		const localIndex = invocationLocalIndex.toUint()
		const firstBlock = localIndex.mul( uint( BLOCKS_PER_PREFIX_LANE ) )
		const laneTotal = uint( 0 ).toVar()

		for ( let blockOffset = 0; blockOffset < BLOCKS_PER_PREFIX_LANE; blockOffset++ ) {
			const blockIndex = firstBlock.add( uint( blockOffset ) )
			If( blockIndex.lessThan( uint( BLOCK_COUNT ) ), () => {
				laneTotal.addAssign( blockCounts.element( blockIndex ) )
			} )
		}

		blockScanShared.element( localIndex ).assign( laneTotal )
		workgroupBarrier()
		prefixSumAcrossWorkgroup( blockScanShared, localIndex )

		const running = uint( 0 ).toVar()
		If( localIndex.greaterThan( uint( 0 ) ), () => {
			running.assign( blockScanShared.element( localIndex.sub( uint( 1 ) ) ) )
		} )
		for ( let blockOffset = 0; blockOffset < BLOCKS_PER_PREFIX_LANE; blockOffset++ ) {
			const blockIndex = firstBlock.add( uint( blockOffset ) )
			If( blockIndex.lessThan( uint( BLOCK_COUNT ) ), () => {
				blockOffsets.element( blockIndex ).assign( running )
				running.addAssign( blockCounts.element( blockIndex ) )
			} )
		}

		If( localIndex.equal( uint( 0 ) ), () => {
			const retained = blockScanShared.element( uint( WORKGROUP_SIZE - 1 ) ).toVar()
			const segments = retained.greaterThan( uint( 1 ) )
				.select( retained.sub( uint( 1 ) ), uint( 0 ) )
				.toVar()

			state.element( uint( 0 ) ).assign( retained )
			state.element( uint( 1 ) ).assign( retained )
			state.element( uint( 2 ) ).assign( segments )
			state.element( uint( 3 ) ).assign( uint( 0 ) )

			simplifiedDraw.element( uint( 0 ) ).assign( segments.mul( uint( RIBBON_VERTICES_PER_SEGMENT ) ) )
			simplifiedDraw.element( uint( 4 ) ).assign( segments.mul( uint( LINE_VERTICES_PER_SEGMENT ) ) )
			simplifiedDraw.element( uint( 8 ) ).assign( segments.mul( uint( WIREFRAME_VERTICES_PER_SEGMENT ) ) )
			for ( const command of [0, 4, 8] ) {
				simplifiedDraw.element( uint( command + 1 ) ).assign( uint( 1 ) )
				simplifiedDraw.element( uint( command + 2 ) ).assign( uint( 0 ) )
				simplifiedDraw.element( uint( command + 3 ) ).assign( uint( 0 ) )
			}
		} )
	} )().compute( WORKGROUP_SIZE, [WORKGROUP_SIZE] )

	const scatter = Fn( () => {
		const pointIndex = instanceIndex.toUint()
		If( pointIndex.lessThan( pointCount ), () => {
			const localIndex = pointIndex.mod( uint( WORKGROUP_SIZE ) )
			const rank = localRanks.element( pointIndex )
			const previousRank = uint( 0 ).toVar()
			If( localIndex.greaterThan( uint( 0 ) ), () => {
				previousRank.assign( localRanks.element( pointIndex.sub( uint( 1 ) ) ) )
			} )
			If( rank.greaterThan( previousRank ), () => {
				const blockIndex = pointIndex.div( uint( WORKGROUP_SIZE ) )
				compacted.element( blockOffsets.element( blockIndex ).add( rank ).sub( uint( 1 ) ) )
					.assign( pointIndex )
			} )
		} )
	} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

	// Gathers the survivors into one contiguous buffer the renderer can walk
	// without an index, and records how many source points each emitted
	// segment stands in for so the heatmap has something true to show.
	//
	// It also records where each polyline begins and ends in output space, so
	// the ribbon can wrap a closed ring across its seam. That write needs its
	// own race argument, and here it is: compaction is stable, so every line id
	// occupies one contiguous span of output indices, and the predicate "the
	// previous survivor belongs to another line" is therefore true for exactly
	// one invocation per line. Each bound is written once, by one invocation,
	// with no read-modify-write — the same footing as the refinement pass. This
	// depends on the scatter staying stable; a non-stable scheme would break it.
	const resolve = Fn( () => {
		const outputIndex = instanceIndex.toUint()
		If( outputIndex.lessThan( state.element( uint( 0 ) ) ), () => {
			const lastRetained = max( uint( 1 ), state.element( uint( 0 ) ) ).sub( uint( 1 ) )
			const source1 = compacted.element( outputIndex ).toVar()
			const source2 = compacted.element( min( outputIndex.add( uint( 1 ) ), lastRetained ) ).toVar()
			const point1 = geometry.element( source1 ).toVar()
			const sameLine = point1.w.equal( geometry.element( source2 ).w )

			output.element( outputIndex ).assign( point1 )
			outputGap.element( outputIndex ).assign(
				sameLine.select( source2.sub( source1 ), uint( 1 ) ),
			)

			// Read line ids through `geometry`, never through `output` — this
			// dispatch is writing `output`, so reading a neighbour's entry there
			// would be a genuine race.
			const line = min( point1.w.toUint(), uint( LINE_CAPACITY - 1 ) ).toVar()
			const previousSource = compacted.element( max( uint( 1 ), outputIndex ).sub( uint( 1 ) ) )
			const startsRun = outputIndex.equal( uint( 0 ) )
				.or( geometry.element( previousSource ).w.equal( point1.w ).not() )
			If( startsRun, () => {
				outputRuns.element( line.mul( uint( 2 ) ) ).assign( outputIndex )
			} )
			If( outputIndex.greaterThanEqual( lastRetained ).or( sameLine.not() ), () => {
				outputRuns.element( line.mul( uint( 2 ) ).add( uint( 1 ) ) ).assign( outputIndex )
			} )
		} )
	} )().compute( OUTPUT_CAPACITY, [WORKGROUP_SIZE] )

	return { blockPrefix, clear, flush, refine, relaxShrink, relaxUnshrink, resolve, scan, scatter, seed }
}
