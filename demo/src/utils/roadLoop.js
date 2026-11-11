/**
 * A road that ends where it starts, planned with a planner that only knows open roads.
 *
 * The planner reads a few controls either side of a span and no further. So an
 * open road that runs on past both ends, through the controls of the lap before
 * and the lap after, has one whole lap in its middle that meets itself in place
 * and in direction.
 *
 * That lap is drawn as an open ribbon. So that its two end rows are cut square
 * to the same pair of segments, each is given the row beyond it on the other
 * side of the seam, dropped a little so the overlap hides under the deck.
 */

// A loop needs a third control: two can only run out and back along one line.
export const MIN_LOOP_CONTROLS = 3
// Controls of the neighbouring laps the loop is planned with.
const LAP_OVERLAP = 3
// How far the two rows that overlap the seam sit under the deck.
export const SEAM_DROP = 0.015

/**
 * Plan `controls` as a loop. `planPath( controls )` plans an open road through
 * the controls it is given and returns `{ points, bank, anchors, corners, stats }`.
 *
 * The plan that comes back has the same shape, and `closed: true`. Its first and
 * last rows are the overlap: the lap itself runs from row 1 to row `pointCount - 2`,
 * which are the same place. It has one anchor a control, and one more where the
 * lap comes back to the first.
 *
 * @returns {object | null} null when the controls cannot make a loop.
 */
export function planRoadLoop( controls, planPath ) {
	const count = controls?.length ?? 0
	if ( count < MIN_LOOP_CONTROLS ) return null
	const lapped = Array.from( { length: count + LAP_OVERLAP * 2 }, ( _, index ) => controls[( ( index - LAP_OVERLAP ) % count + count ) % count] )
	const plan = planPath( lapped )
	// Two controls on one spot are merged by the planner, and its anchors no longer line up with the laps.
	if ( !plan || plan.anchors.length !== lapped.length ) return null

	const start = plan.anchors[LAP_OVERLAP]
	const rows = plan.anchors[LAP_OVERLAP + count] - start + 1
	const points = new Float64Array( ( rows + 2 ) * 3 )
	const bank = new Float32Array( rows + 2 )
	// The rows of the lap, with the last row before the seam in front of them and the first row after it behind.
	for ( let row = 0; row < rows + 2; row++ ) {
		const source = start + ( row === 0 ? rows - 2 : row === rows + 1 ? 1 : row - 1 )
		points.set( plan.points.subarray( source * 3, source * 3 + 3 ), row * 3 )
		bank[row] = plan.bank[source]
	}
	points[1] -= SEAM_DROP
	points[points.length - 2] -= SEAM_DROP

	let length = 0
	for ( let row = 2; row <= rows; row++ ) {
		length += Math.hypot(
			points[row * 3] - points[row * 3 - 3],
			points[row * 3 + 1] - points[row * 3 - 2],
			points[row * 3 + 2] - points[row * 3 - 1]
		)
	}
	const corners = plan.corners
		.filter( corner => corner.knotIndex >= LAP_OVERLAP && corner.knotIndex < LAP_OVERLAP + count )
		.map( corner => ( { ...corner, knotIndex: corner.knotIndex - LAP_OVERLAP, sampleIndex: corner.sampleIndex - start + 1 } ) )
	// A fold found in the samples is counted over all three laps: if they have one, this lap has it too.
	const folded = plan.stats.tightCount > 0 && !plan.corners.some( corner => corner.tight )

	return {
		points,
		bank,
		anchors: Int32Array.from( { length: count + 1 }, ( _, index ) => plan.anchors[LAP_OVERLAP + index] - start + 1 ),
		controlIndices: Int32Array.from( { length: count + 1 }, ( _, index ) => index % count ),
		corners,
		closed: true,
		stats: {
			...plan.stats,
			pointCount: rows + 2,
			length,
			knotCount: count,
			arcCount: corners.filter( corner => corner.arc ).length,
			tightCount: Math.max( corners.filter( corner => corner.tight ).length, folded ? 1 : 0 ),
		},
	}
}
