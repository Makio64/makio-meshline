/**
 * Road centerline planner.
 *
 * The road drives through every authored control point, so corners are never cut.
 * A gentle bend is a plain interpolating curve: each knot's tangent is lengthened
 * until the route swings wide enough through the bend — the way a real road does
 * — to keep the curvature radius above the ribbon's half width. Below that radius
 * the inner edge of an extruded ribbon reaches the centre of the turn and the
 * road starts losing width, which is what makes naive road demos look broken.
 *
 * A cubic through three points cannot swing wide enough for a hard angle, so a
 * corner the curve cannot hold becomes an explicit fixed-radius turn: an arc that
 * still passes exactly through the control point, entered and left tangentially.
 * That is what a real switchback is, and it works at any angle up to a full
 * reversal — where the arc is simply a half circle around the point.
 *
 * Everything here is plain 2D math on the ground plane; height is applied later.
 */

const EPSILON = 1e-9
const SPAN_PROBES = 16
const DENSE_SAMPLES = 96

export const ROAD_PATH_DEFAULTS = {
	spacing: 0.4,
	minRadius: 2,
	foldRadius: 1.7,
	minTangent: 0.6,
	maxTangent: 2.1,
	tangentBias: 0.05,
	iterations: 40,
	cornerBudget: 0.7,
}

const hermite = ( ax, az, bx, bz, tax, taz, tbx, tbz, t, out ) => {
	const t2 = t * t
	const t3 = t2 * t
	const h00 = 2 * t3 - 3 * t2 + 1
	const h10 = t3 - 2 * t2 + t
	const h01 = -2 * t3 + 3 * t2
	const h11 = t3 - t2
	out[0] = h00 * ax + h10 * tax + h01 * bx + h11 * tbx
	out[1] = h00 * az + h10 * taz + h01 * bz + h11 * tbz
	return out
}

const rotate = ( x, z, angle ) => {
	const cos = Math.cos( angle )
	const sin = Math.sin( angle )
	return [x * cos - z * sin, x * sin + z * cos]
}

const circumRadius = ( ax, az, bx, bz, cx, cz ) => {
	const abx = bx - ax
	const abz = bz - az
	const bcx = cx - bx
	const bcz = cz - bz
	const ab = Math.hypot( abx, abz )
	const bc = Math.hypot( bcx, bcz )
	const ca = Math.hypot( ax - cx, az - cz )
	if ( ab < EPSILON || bc < EPSILON || ca < EPSILON ) return Infinity
	const area = Math.abs( abx * bcz - abz * bcx ) * 0.5
	if ( area < EPSILON ) return Infinity
	return ab * bc * ca / ( 4 * area )
}

const dedupeControls = ( controls, epsilon ) => {
	const cleaned = []
	for ( const control of controls ) {
		const x = control.x
		const z = control.z
		if ( !Number.isFinite( x ) || !Number.isFinite( z ) ) continue
		const last = cleaned[cleaned.length - 1]
		if ( last && Math.hypot( x - last[0], z - last[1] ) <= epsilon ) continue
		cleaned.push( [x, z] )
	}
	return cleaned
}

const measureLegs = knots => {
	const legs = new Float64Array( Math.max( 1, knots.length - 1 ) )
	const directions = new Array( Math.max( 1, knots.length - 1 ) )
	for ( let index = 0; index < knots.length - 1; index++ ) {
		const dx = knots[index + 1][0] - knots[index][0]
		const dz = knots[index + 1][1] - knots[index][1]
		const length = Math.hypot( dx, dz ) || 1
		legs[index] = length
		directions[index] = [dx / length, dz / length]
	}
	return { legs, directions }
}

const measureTurns = ( knots, legDirections ) => {
	const turns = new Float64Array( knots.length )
	for ( let index = 1; index < knots.length - 1; index++ ) {
		const incoming = legDirections[index - 1]
		const outgoing = legDirections[index]
		const dot = Math.max( -1, Math.min( 1, incoming[0] * outgoing[0] + incoming[1] * outgoing[1] ) )
		turns[index] = Math.acos( dot )
	}
	return turns
}

/**
 * Tangent direction on each side of a knot. A knot the curve still handles keeps
 * the shared bisector; a knot that has been given its own turn arc keeps the two
 * leg directions, because the curve now only has to reach the arc's entry and
 * leave its exit, tangentially in both cases.
 */
const resolveTangentDirections = ( knots, legDirections, corners ) => {
	const count = knots.length
	const incoming = new Array( count )
	const outgoing = new Array( count )

	for ( let index = 0; index < count; index++ ) {
		const before = legDirections[index - 1]
		const after = legDirections[index]
		if ( !before || !after || corners[index] ) {
			incoming[index] = before ?? after
			outgoing[index] = after ?? before
			continue
		}
		const sumX = before[0] + after[0]
		const sumZ = before[1] + after[1]
		const length = Math.hypot( sumX, sumZ )
		if ( length <= 1e-6 ) {
			incoming[index] = before
			outgoing[index] = after
			continue
		}
		incoming[index] = [sumX / length, sumZ / length]
		outgoing[index] = incoming[index]
	}

	return { incoming, outgoing }
}

/**
 * Propose the fixed-radius turn for one control point.
 *
 * The arc is centred so that it passes exactly through the point and sweeps the
 * full turn, which leaves it tangent to both legs at its ends. Entry and exit sit
 * `2·radius·sin(turn/4)` back along each leg — the spread — so a wider arc eats
 * more of both legs. A reversal, which has no bisector, is simply the case where
 * the arc becomes a half circle around the point.
 */
const proposeCorner = ( knots, legDirections, turns, index, settings ) => {
	const before = legDirections[index - 1]
	const after = legDirections[index]
	const turn = turns[index]
	if ( !( turn > 1e-4 ) ) return null

	const cross = before[0] * after[1] - before[1] * after[0]
	const turnSign = cross >= 0 ? 1 : -1
	const sumX = before[0] + after[0]
	const sumZ = before[1] + after[1]
	const sumLength = Math.hypot( sumX, sumZ )
	// Direction from the control point towards the centre of the turn. A reversal
	// has no bisector, so the centre falls straight back along the incoming leg.
	const toCentre = sumLength > 1e-6
		? [-turnSign * sumZ / sumLength, turnSign * sumX / sumLength]
		: [-turnSign * before[0], -turnSign * before[1]]

	const half = turn * 0.5
	const spread = 2 * Math.sin( half * 0.5 )
	if ( !( spread > 1e-6 ) ) return null

	return {
		vertex: knots[index],
		toCentre,
		spread,
		// Signed so the arc turns the way the road does: the heading has to rotate
		// by the full turn between entry and exit, and sweeping the wrong way would
		// leave it off by twice the turn and hook the transition back on itself.
		sweep: turnSign * half,
		radius: settings.minRadius,
	}
}

const finalizeCorner = ( corner, settings ) => {
	const { vertex, toCentre, radius, sweep } = corner
	const outward = [-toCentre[0], -toCentre[1]]
	const entryRadial = rotate( outward[0], outward[1], -sweep )
	const exitRadial = rotate( outward[0], outward[1], sweep )

	return {
		...corner,
		outward,
		centre: [vertex[0] + toCentre[0] * radius, vertex[1] + toCentre[1] * radius],
		entry: [
			vertex[0] + ( toCentre[0] + entryRadial[0] ) * radius,
			vertex[1] + ( toCentre[1] + entryRadial[1] ) * radius,
		],
		exit: [
			vertex[0] + ( toCentre[0] + exitRadial[0] ) * radius,
			vertex[1] + ( toCentre[1] + exitRadial[1] ) * radius,
		],
		tight: radius < settings.foldRadius,
	}
}

/**
 * Size every turn arc together. Two arcs sharing a leg both eat into it, and if
 * they take all of it the curve between them has no room left to swap sides and
 * doubles back instead. Shrink whichever arcs overrun their shared leg until a
 * healthy fraction of it survives for the transition.
 */
const buildCorners = ( knots, legDirections, legs, turns, needsArc, settings, factor = 1 ) => {
	const proposals = knots.map( ( _, index ) => {
		if ( !needsArc[index] ) return null
		const proposal = proposeCorner( knots, legDirections, turns, index, settings )
		if ( proposal ) proposal.radius *= factor
		return proposal
	} )

	for ( let pass = 0; pass < 3; pass++ ) {
		let changed = false
		for ( let leg = 0; leg < legs.length; leg++ ) {
			const start = proposals[leg]
			const end = proposals[leg + 1]
			const footprint = ( start ? start.radius * start.spread : 0 ) +
				( end ? end.radius * end.spread : 0 )
			const available = legs[leg] * settings.cornerBudget
			if ( footprint <= available + EPSILON ) continue
			const scale = available / footprint
			if ( start ) start.radius *= scale
			if ( end ) end.radius *= scale
			changed = true
		}
		if ( !changed ) break
	}

	return proposals.map( proposal => proposal && finalizeCorner( proposal, settings ) )
}

const spanEndpoints = ( shape, index ) => ( {
	start: shape.corners[index] ? shape.corners[index].exit : shape.knots[index],
	end: shape.corners[index + 1] ? shape.corners[index + 1].entry : shape.knots[index + 1],
} )

const sampleSpan = ( shape, index, divisions, push ) => {
	const { start, end } = spanEndpoints( shape, index )
	const chord = Math.hypot( end[0] - start[0], end[1] - start[1] )
	const startTangent = shape.tangents.outgoing[index]
	const endTangent = shape.tangents.incoming[index + 1]
	const startScale = shape.scales[index] * chord
	const endScale = shape.scales[index + 1] * chord
	const point = [0, 0]

	for ( let step = 0; step <= divisions; step++ ) {
		hermite(
			start[0], start[1], end[0], end[1],
			startTangent[0] * startScale, startTangent[1] * startScale,
			endTangent[0] * endScale, endTangent[1] * endScale,
			step / divisions, point
		)
		push( point[0], point[1], step )
	}
}

/**
 * Curvature report for one span: the tightest radius overall, plus the tightest
 * radius seen in the third of the span nearest each of its two knots.
 */
const probeSpan = ( shape, index ) => {
	const samples = []
	sampleSpan( shape, index, SPAN_PROBES, ( x, z ) => samples.push( x, z ) )
	const report = { worst: Infinity, nearStart: Infinity, nearEnd: Infinity }

	for ( let step = 1; step < SPAN_PROBES; step++ ) {
		const radius = circumRadius(
			samples[( step - 1 ) * 2], samples[( step - 1 ) * 2 + 1],
			samples[step * 2], samples[step * 2 + 1],
			samples[( step + 1 ) * 2], samples[( step + 1 ) * 2 + 1]
		)
		report.worst = Math.min( report.worst, radius )
		const t = step / SPAN_PROBES
		if ( t <= 0.34 ) report.nearStart = Math.min( report.nearStart, radius )
		if ( t >= 0.66 ) report.nearEnd = Math.min( report.nearEnd, radius )
	}
	return report
}

/**
 * How badly a span violates the target radius. Squared shortfall keeps the
 * solver pushing on every tight spot instead of plateauing on the worst one.
 */
const spanPenalty = ( report, target ) => {
	const shortfall = Math.max( 0, target - report.worst )
	return shortfall * shortfall
}

const knotRadius = ( reports, index ) => Math.min(
	reports[index - 1]?.nearEnd ?? Infinity,
	reports[index]?.nearStart ?? Infinity
)

/**
 * Emit the turn arc, with the control point itself as an exact sample at its
 * midpoint. Both halves are sampled separately so that stays true.
 */
const emitCorner = ( corner, spacing, points ) => {
	const steps = Math.max( 1, Math.round( corner.radius * Math.abs( corner.sweep ) / spacing ) )
	const push = angle => {
		const radial = rotate( corner.outward[0], corner.outward[1], angle )
		points.push(
			corner.centre[0] + radial[0] * corner.radius,
			corner.centre[1] + radial[1] * corner.radius
		)
	}

	for ( let step = 0; step < steps; step++ ) push( -corner.sweep * ( 1 - step / steps ) )
	const anchor = points.length / 2
	points.push( corner.vertex[0], corner.vertex[1] )
	for ( let step = 1; step <= steps; step++ ) push( corner.sweep * step / steps )
	return anchor
}

/**
 * Emit the interior samples of one span, arc-length spaced. Both endpoints are
 * left to the knot pieces on either side, which own the exact control points.
 */
const emitSpanInterior = ( shape, index, spacing, points ) => {
	const dense = []
	sampleSpan( shape, index, DENSE_SAMPLES, ( x, z ) => dense.push( x, z ) )
	const denseCount = dense.length / 2
	const cumulative = new Float64Array( denseCount )
	for ( let step = 1; step < denseCount; step++ ) {
		cumulative[step] = cumulative[step - 1] + Math.hypot(
			dense[step * 2] - dense[( step - 1 ) * 2],
			dense[step * 2 + 1] - dense[( step - 1 ) * 2 + 1]
		)
	}
	const length = cumulative[denseCount - 1]
	const divisions = Math.max( 1, Math.round( length / spacing ) )

	let cursor = 1
	for ( let division = 1; division < divisions; division++ ) {
		const target = length * division / divisions
		while ( cursor < denseCount - 1 && cumulative[cursor] < target ) cursor++
		const previous = cumulative[cursor - 1]
		const span = cumulative[cursor] - previous
		const ratio = span > EPSILON ? ( target - previous ) / span : 0
		points.push(
			dense[( cursor - 1 ) * 2] + ( dense[cursor * 2] - dense[( cursor - 1 ) * 2] ) * ratio,
			dense[( cursor - 1 ) * 2 + 1] + ( dense[cursor * 2 + 1] - dense[( cursor - 1 ) * 2 + 1] ) * ratio
		)
	}
}

/**
 * Plan a drivable centerline through every control point.
 *
 * @param {Array<{x:number,z:number}>} controls ground-plane control points
 * @param {object} [options]
 * @returns {{points: Float64Array, anchors: Int32Array, corners: Array, stats: object} | null}
 */
export function planRoadPath( controls, options = {} ) {
	const settings = { ...ROAD_PATH_DEFAULTS }
	for ( const [key, value] of Object.entries( options ) ) {
		if ( value !== undefined ) settings[key] = value
	}
	const knots = dedupeControls( controls ?? [], Math.max( 1e-4, settings.spacing * 0.25 ) )
	const count = knots.length
	if ( count < 2 ) return null

	const { legs, directions: legDirections } = measureLegs( knots )
	const turns = measureTurns( knots, legDirections )
	const shape = {
		knots,
		corners: new Array( count ).fill( null ),
		scales: new Float64Array( count ).fill( 1 ),
		tangents: null,
	}
	shape.tangents = resolveTangentDirections( knots, legDirections, shape.corners )

	const scales = shape.scales
	let reports = []

	// Coordinate descent on the total curvature shortfall. Only the two spans
	// touching a knot change when its tangent changes, so each trial is cheap.
	const solve = () => {
		reports = []
		for ( let index = 0; index < count - 1; index++ ) reports.push( probeSpan( shape, index ) )

		const totalPenalty = () => {
			let total = 0
			for ( let index = 0; index < reports.length; index++ ) total += spanPenalty( reports[index], settings.minRadius )
			for ( let index = 1; index < count - 1; index++ ) {
				if ( shape.corners[index] ) continue
				const drift = scales[index] - 1
				total += drift * drift * settings.tangentBias
			}
			return total
		}

		// Widening one knot while its neighbours stay tight just trades a knot
		// pinch for a mid-span pinch, so coordinate descent alone stalls at the
		// starting scale. Sweep a shared scale first to land in the right basin.
		let penalty = totalPenalty()
		let bestShared = null
		for ( let shared = settings.minTangent; shared <= settings.maxTangent + 1e-6; shared += 0.25 ) {
			for ( let index = 1; index < count - 1; index++ ) {
				if ( !shape.corners[index] ) scales[index] = shared
			}
			for ( let index = 0; index < count - 1; index++ ) reports[index] = probeSpan( shape, index )
			const candidate = totalPenalty()
			if ( bestShared === null || candidate < bestShared.penalty ) bestShared = { penalty: candidate, shared }
		}
		if ( bestShared ) {
			for ( let index = 1; index < count - 1; index++ ) {
				if ( !shape.corners[index] ) scales[index] = bestShared.shared
			}
			for ( let index = 0; index < count - 1; index++ ) reports[index] = probeSpan( shape, index )
			penalty = bestShared.penalty
		}

		for ( let iteration = 0; iteration < settings.iterations && penalty > 0; iteration++ ) {
			let improved = false
			for ( let index = 1; index < count - 1; index++ ) {
				if ( shape.corners[index] ) continue
				for ( const factor of [1.22, 0.82] ) {
					const previous = scales[index]
					const candidate = Math.min( settings.maxTangent, Math.max( settings.minTangent, previous * factor ) )
					if ( Math.abs( candidate - previous ) < 1e-4 ) continue
					const before = [reports[index - 1], reports[index]]
					scales[index] = candidate
					reports[index - 1] = probeSpan( shape, index - 1 )
					reports[index] = probeSpan( shape, index )
					const next = totalPenalty()
					if ( next < penalty - 1e-9 ) {
						penalty = next
						improved = true
						break
					}
					scales[index] = previous
					reports[index - 1] = before[0]
					reports[index] = before[1]
				}
			}
			if ( !improved ) break
		}
	}

	solve()

	// Any bend the curve cannot hold above the fold radius gets its own turn arc.
	// Giving one knot an arc reshapes its neighbours, so re-solve and re-check
	// until the remaining curves clear. Each round converts at least one more
	// knot, so this cannot run longer than the knot count.
	const needsArc = new Uint8Array( count )
	const applyCorners = factor => {
		shape.corners = buildCorners( knots, legDirections, legs, turns, needsArc, settings, factor )
		shape.tangents = resolveTangentDirections( knots, legDirections, shape.corners )
		solve()
	}

	// The worst radius anywhere on the route: along a curve, or on an arc itself.
	const worstRadius = () => {
		let worst = Infinity
		for ( const report of reports ) worst = Math.min( worst, report.worst )
		for ( const corner of shape.corners ) {
			if ( corner ) worst = Math.min( worst, corner.radius )
		}
		return worst
	}

	// A wider arc is gentler at the corner but eats the leg the transition needs,
	// so the widest arc that fits is rarely the best one. Sweep the size and keep
	// whichever leaves the tightest spot on the whole route as wide as possible.
	const sizeCorners = () => {
		let best = null
		for ( const factor of [1, 0.72, 0.5, 0.34] ) {
			scales.fill( 1 )
			applyCorners( factor )
			const score = worstRadius()
			if ( !best || score > best.score ) {
				best = { score, corners: shape.corners, scales: Float64Array.from( scales ) }
			}
			if ( score >= settings.minRadius ) break
		}
		shape.corners = best.corners
		scales.set( best.scales )
		shape.tangents = resolveTangentDirections( knots, legDirections, shape.corners )
		reports = []
		for ( let index = 0; index < count - 1; index++ ) reports.push( probeSpan( shape, index ) )
	}

	// Any bend the curve cannot hold above the fold radius gets its own turn arc.
	// Sizing the arcs reshapes the curves around them, so re-check afterwards and
	// keep going until nothing is left below the fold radius. Each round converts
	// at least one more knot, so this cannot run longer than the knot count.
	for ( let round = 0; round < count; round++ ) {
		let converted = false
		for ( let index = 1; index < count - 1; index++ ) {
			if ( needsArc[index] || knotRadius( reports, index ) >= settings.foldRadius ) continue
			needsArc[index] = 1
			converted = true
		}
		if ( !converted ) break
		sizeCorners()
	}

	const rawPoints = []
	const anchors = new Int32Array( count )
	for ( let index = 0; index < count; index++ ) {
		const corner = shape.corners[index]
		if ( corner ) {
			anchors[index] = emitCorner( corner, settings.spacing, rawPoints )
		} else {
			anchors[index] = rawPoints.length / 2
			rawPoints.push( knots[index][0], knots[index][1] )
		}
		if ( index < count - 1 ) emitSpanInterior( shape, index, settings.spacing, rawPoints )
	}

	const points = Float64Array.from( rawPoints )
	const pointCount = points.length / 2
	let minRadius = Infinity
	let maxTurn = 0
	for ( let index = 1; index < pointCount - 1; index++ ) {
		const ax = points[index * 2] - points[( index - 1 ) * 2]
		const az = points[index * 2 + 1] - points[( index - 1 ) * 2 + 1]
		const bx = points[( index + 1 ) * 2] - points[index * 2]
		const bz = points[( index + 1 ) * 2 + 1] - points[index * 2 + 1]
		const lengths = Math.hypot( ax, az ) * Math.hypot( bx, bz )
		if ( lengths > EPSILON ) {
			maxTurn = Math.max( maxTurn, Math.acos( Math.max( -1, Math.min( 1, ( ax * bx + az * bz ) / lengths ) ) ) )
		}
		minRadius = Math.min( minRadius, circumRadius(
			points[( index - 1 ) * 2], points[( index - 1 ) * 2 + 1],
			points[index * 2], points[index * 2 + 1],
			points[( index + 1 ) * 2], points[( index + 1 ) * 2 + 1]
		) )
	}

	const corners = []
	for ( let index = 1; index < count - 1; index++ ) {
		const corner = shape.corners[index]
		corners.push( {
			knotIndex: index,
			sampleIndex: anchors[index],
			turn: turns[index],
			radius: corner ? corner.radius : knotRadius( reports, index ),
			arc: !!corner,
			tangentScale: scales[index],
			// Only reachable when the control points sit closer together than the
			// road is wide: even the widest arc that fits is below the fold radius.
			tight: corner ? corner.tight : knotRadius( reports, index ) < settings.minRadius * 0.98,
		} )
	}

	return {
		points,
		anchors,
		corners,
		stats: {
			pointCount,
			knotCount: count,
			minRadius,
			maxTurn,
			arcCount: corners.filter( corner => corner.arc ).length,
			tightCount: corners.filter( corner => corner.tight ).length,
		},
	}
}
