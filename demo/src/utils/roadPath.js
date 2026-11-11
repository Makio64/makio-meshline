/**
 * Adaptive 3D road centreline planner.
 *
 * The route passes through every authored XYZ control point. Smooth knots use
 * cubic Hermite spans whose tangents are widened until the requested minimum
 * curvature is met. A knot the cubic cannot make drivable becomes a circular
 * turn in the plane of the two directions it meets its legs in: their plan
 * headings, at grades a flat arc can carry round the bend. Exact reversals
 * have no unique plane, so `up` explicitly chooses one.
 *
 * Output tessellation has hard geometric budgets instead of a fixed lookup
 * table: maximum 3D curve length, chord error, tangent turn, and bank delta.
 * Distance UVs therefore see a faithful polyline without oversampling straight
 * spans or leaving long triangles on steep and tightly curved sections.
 *
 * Each stretch between two controls is sampled as one curve: the half turn
 * leaving its first control, the span, and the half turn entering its second.
 * Every sample takes the same share of the budgets where it lies, so samples
 * change length only as the road changes shape, and none is left so short
 * beside a long one that the inside edge of the ribbon has no room for the turn
 * they share.
 *
 * Edits stay local. A smooth knot's tangent is split into a plan direction and
 * a grade: the plan direction ignores height, and the grade is a monotone
 * harmonic mean of the neighbouring legs, so raising one control never dips or
 * bends the road beside it. Tangent widening and arc conversion are solved per
 * region of difficult knots, so a tight bend elsewhere on the route cannot
 * reshape a span the edit never touched.
 *
 * The road is shaped by its turns on the map alone, and what that cannot shape
 * is reported. Heights and banks are authored, and a deck banked into a sharp
 * crest or dip has to turn within itself however straight the map is: where
 * the finished samples turn their deck on less than the fold radius, the
 * nearest control is marked tight, as it is for a bend with no room to turn.
 */

const EPSILON = 1e-9
const SPAN_PROBES = 32
const SCALE_FACTORS = [1.22, 0.82]
const CORNER_FACTORS = [1, 0.72, 0.5, 0.34]
const REVERSAL_TURN = Math.PI - 1e-4
// Plan/grade tangents fade back to plain 3D tangents on near-vertical legs
// (horizontal run fraction), where a horizontal heading stops being meaningful.
const PROFILE_RUN_MIN = 0.2
const PROFILE_RUN_FULL = 0.45
// Samples aim at this share of the turn, chord-error and bank budgets. Once
// placed, each one is held to the whole budget.
const BUDGET_SHARE = 0.9
// Cells per sample: fine enough to follow the budgets as they change along a curve.
const CELLS_PER_STEP = 2
// A cubic is read at nine points at least, so a short span cannot hide a tight spot between them.
const MIN_CUBIC_DEPTH = 2
const LENGTH_STEPS = 16
const MAX_RETRIES = 8
// The sampled road counts as folding a little before it does.
const FOLD_MARGIN = 0.98

export const ROAD_PATH_DEFAULTS = {
	spacing: 0.4,
	maxAngle: Math.PI / 45,
	maxChordError: 0.02,
	maxBankAngle: Math.PI / 45,
	dedupeEpsilon: 1e-5,
	maxDepth: 16,
	maxPoints: 16384,
	minRadius: 2,
	foldRadius: 1.7,
	minTangent: 0.6,
	maxTangent: 2.1,
	tangentBias: 0.05,
	iterations: 40,
	cornerBudget: 0.7,
	up: [0, 1, 0],
}

const clamp = ( value, minimum, maximum ) => Math.max( minimum, Math.min( maximum, value ) )

const smoothstep = ( edge0, edge1, value ) => {
	const t = clamp( ( value - edge0 ) / ( edge1 - edge0 ), 0, 1 )
	return t * t * ( 3 - 2 * t )
}

const dot = ( a, b ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const distance = ( a, b ) => Math.hypot( b[0] - a[0], b[1] - a[1], b[2] - a[2] )

const cross = ( a, b, out ) => {
	out[0] = a[1] * b[2] - a[2] * b[1]
	out[1] = a[2] * b[0] - a[0] * b[2]
	out[2] = a[0] * b[1] - a[1] * b[0]
	return out
}

const normalize = ( x, y, z, out ) => {
	const length = Math.hypot( x, y, z )
	if ( length <= EPSILON ) return false
	out[0] = x / length
	out[1] = y / length
	out[2] = z / length
	return true
}

const rotateAroundAxis = ( vector, axis, angle, out ) => {
	const cosine = Math.cos( angle )
	const sine = Math.sin( angle )
	const projection = dot( axis, vector ) * ( 1 - cosine )
	out[0] = vector[0] * cosine + ( axis[1] * vector[2] - axis[2] * vector[1] ) * sine + axis[0] * projection
	out[1] = vector[1] * cosine + ( axis[2] * vector[0] - axis[0] * vector[2] ) * sine + axis[1] * projection
	out[2] = vector[2] * cosine + ( axis[0] * vector[1] - axis[1] * vector[0] ) * sine + axis[2] * projection
	return out
}

const readBank = control => {
	for ( const key of ['bank', 'roll'] ) {
		const value = control?.[key]
		if ( value === undefined ) continue
		if ( !Number.isFinite( value ) ) throw new TypeError( `[roadPath] control.${key} must be finite` )
		return value
	}
	return 0
}

const resolveSettings = options => {
	const settings = { ...ROAD_PATH_DEFAULTS }
	for ( const [key, value] of Object.entries( options ) ) {
		if ( value !== undefined ) settings[key] = value
	}
	if ( options.maxSegmentLength !== undefined && options.spacing === undefined ) {
		settings.spacing = options.maxSegmentLength
	}

	for ( const key of [
		'spacing',
		'maxAngle',
		'maxChordError',
		'maxBankAngle',
		'dedupeEpsilon',
		'minRadius',
		'foldRadius',
		'minTangent',
		'maxTangent',
	] ) {
		if ( !Number.isFinite( settings[key] ) || settings[key] <= 0 ) {
			throw new RangeError( `[roadPath] ${key} must be greater than zero` )
		}
	}
	if ( settings.maxTangent < settings.minTangent ) {
		throw new RangeError( '[roadPath] maxTangent must be at least minTangent' )
	}
	if ( !Number.isFinite( settings.tangentBias ) || settings.tangentBias < 0 ) {
		throw new RangeError( '[roadPath] tangentBias must be non-negative' )
	}
	if ( !Number.isFinite( settings.cornerBudget ) || settings.cornerBudget <= 0 || settings.cornerBudget > 1 ) {
		throw new RangeError( '[roadPath] cornerBudget must be within (0, 1]' )
	}
	for ( const key of ['iterations', 'maxDepth', 'maxPoints'] ) {
		if ( !Number.isInteger( settings[key] ) || settings[key] < 1 ) {
			throw new RangeError( `[roadPath] ${key} must be a positive integer` )
		}
	}

	const up = settings.up
	const upX = Array.isArray( up ) || ArrayBuffer.isView( up ) ? up[0] : up?.x
	const upY = Array.isArray( up ) || ArrayBuffer.isView( up ) ? up[1] : up?.y
	const upZ = Array.isArray( up ) || ArrayBuffer.isView( up ) ? up[2] : up?.z
	settings.up = [0, 0, 0]
	if ( !Number.isFinite( upX ) || !Number.isFinite( upY ) || !Number.isFinite( upZ ) ||
		!normalize( upX, upY, upZ, settings.up ) ) {
		throw new TypeError( '[roadPath] up must be a finite, non-zero 3D vector' )
	}

	return settings
}

const hermiteDerivative = ( curve, t, out ) => {
	const t2 = t * t
	const h00 = 6 * t2 - 6 * t
	const h10 = 3 * t2 - 4 * t + 1
	const h01 = -6 * t2 + 6 * t
	const h11 = 3 * t2 - 2 * t
	out[0] = h00 * curve.start[0] + h10 * curve.startTangent[0] + h01 * curve.end[0] + h11 * curve.endTangent[0]
	out[1] = h00 * curve.start[1] + h10 * curve.startTangent[1] + h01 * curve.end[1] + h11 * curve.endTangent[1]
	out[2] = h00 * curve.start[2] + h10 * curve.startTangent[2] + h01 * curve.end[2] + h11 * curve.endTangent[2]
	return out
}

const hermiteSecondDerivative = ( curve, t, out ) => {
	const h00 = 12 * t - 6
	const h10 = 6 * t - 4
	const h01 = -12 * t + 6
	const h11 = 6 * t - 2
	out[0] = h00 * curve.start[0] + h10 * curve.startTangent[0] + h01 * curve.end[0] + h11 * curve.endTangent[0]
	out[1] = h00 * curve.start[1] + h10 * curve.startTangent[1] + h01 * curve.end[1] + h11 * curve.endTangent[1]
	out[2] = h00 * curve.start[2] + h10 * curve.startTangent[2] + h01 * curve.end[2] + h11 * curve.endTangent[2]
	return out
}

const dedupeControls = ( controls, epsilon ) => {
	const cleaned = []
	const sourceIndices = []
	for ( let sourceIndex = 0; sourceIndex < controls.length; sourceIndex++ ) {
		const control = controls[sourceIndex]
		const x = control?.x
		const y = control?.y ?? 0
		const z = control?.z
		if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) continue
		const last = cleaned[cleaned.length - 1]
		if ( last && Math.hypot( x - last[0], y - last[1], z - last[2] ) <= epsilon ) continue
		cleaned.push( [x, y, z, readBank( control )] )
		sourceIndices.push( sourceIndex )
	}
	cleaned.sourceIndices = sourceIndices
	return cleaned
}

const measureLegs = knots => {
	const legs = new Float64Array( Math.max( 1, knots.length - 1 ) )
	const directions = new Array( Math.max( 1, knots.length - 1 ) )
	for ( let index = 0; index < knots.length - 1; index++ ) {
		const dx = knots[index + 1][0] - knots[index][0]
		const dy = knots[index + 1][1] - knots[index][1]
		const dz = knots[index + 1][2] - knots[index][2]
		const length = Math.hypot( dx, dy, dz ) || 1
		legs[index] = length
		directions[index] = [dx / length, dy / length, dz / length]
	}
	return { legs, directions }
}

const measureTurns = ( knots, legDirections ) => {
	const turns = new Float64Array( knots.length )
	for ( let index = 1; index < knots.length - 1; index++ ) {
		turns[index] = Math.acos( clamp( dot( legDirections[index - 1], legDirections[index] ), -1, 1 ) )
	}
	return turns
}

const resolveTangentDirections = ( knots, legDirections, corners ) => {
	const count = knots.length
	const incoming = new Array( count )
	const outgoing = new Array( count )

	for ( let index = 0; index < count; index++ ) {
		const before = legDirections[index - 1]
		const after = legDirections[index]
		if ( !before || !after || corners[index] ) {
			incoming[index] = corners[index]?.incoming ?? before ?? after
			outgoing[index] = corners[index]?.outgoing ?? after ?? before
			continue
		}
		const tangent = [0, 0, 0]
		if ( !normalize( before[0] + after[0], before[1] + after[1], before[2] + after[2], tangent ) ) {
			incoming[index] = before
			outgoing[index] = after
			continue
		}
		incoming[index] = tangent
		outgoing[index] = tangent
	}

	return { incoming, outgoing }
}

/**
 * Split each knot into a plan heading and the grades of its two legs. The
 * heading only reads horizontal leg directions, so raising a control can never
 * swing the road beside it sideways, and a hairpin that climbs still turns in
 * plan: the 3D bisector of its two legs points up the hill, not round the bend.
 */
const resolveKnotProfiles = ( knots, legDirections, up ) => {
	const profiles = new Array( knots.length ).fill( null )
	const beforeRun = [0, 0, 0]
	const afterRun = [0, 0, 0]
	for ( let index = 1; index < knots.length - 1; index++ ) {
		const before = legDirections[index - 1]
		const after = legDirections[index]
		const beforeRise = dot( before, up )
		const afterRise = dot( after, up )
		for ( let axis = 0; axis < 3; axis++ ) {
			beforeRun[axis] = before[axis] - up[axis] * beforeRise
			afterRun[axis] = after[axis] - up[axis] * afterRise
		}
		const beforeRunLength = Math.hypot( beforeRun[0], beforeRun[1], beforeRun[2] )
		const afterRunLength = Math.hypot( afterRun[0], afterRun[1], afterRun[2] )
		const weight = smoothstep( PROFILE_RUN_MIN, PROFILE_RUN_FULL, Math.min( beforeRunLength, afterRunLength ) )
		if ( !( weight > 0 ) ) continue

		const runs = [[0, 0, 0], [0, 0, 0]]
		for ( let axis = 0; axis < 3; axis++ ) {
			runs[0][axis] = beforeRun[axis] / beforeRunLength
			runs[1][axis] = afterRun[axis] / afterRunLength
		}
		// The heading bisects the two runs. A road that doubles straight back
		// leaves nothing to bisect, so `up` has it turn to the left.
		const heading = [0, 0, 0]
		if ( !normalize( runs[0][0] + runs[1][0], runs[0][1] + runs[1][1], runs[0][2] + runs[1][2], heading ) ) {
			cross( up, runs[0], heading )
		}

		profiles[index] = {
			weight,
			heading,
			runs,
			turn: Math.acos( clamp( dot( runs[0], runs[1] ), -1, 1 ) ),
			beforeGrade: beforeRise / beforeRunLength,
			afterGrade: afterRise / afterRunLength,
		}
	}
	return profiles
}

/**
 * Monotone knot grade: zero at a crest, sag, or flat approach, otherwise the
 * harmonic mean of both legs. That mean never exceeds twice the gentler grade,
 * and the cap keeps a widened tangent inside the cubic's no-overshoot range.
 */
const profileGrade = ( profile, scale ) => {
	const { beforeGrade, afterGrade } = profile
	if ( !( beforeGrade * afterGrade > 0 ) ) return 0
	const grade = 2 * beforeGrade * afterGrade / ( beforeGrade + afterGrade )
	const limit = 3 * Math.min( Math.abs( beforeGrade ), Math.abs( afterGrade ) ) / scale
	return Math.abs( grade ) > limit ? Math.sign( grade ) * limit : grade
}

/**
 * Hermite tangent of one knot as seen from one adjacent span. Both spans share
 * the knot's direction, so the joint stays G1; only the length follows the span.
 * With a full profile weight the horizontal part is `scale * run * heading`,
 * which no height edit can change.
 */
const knotTangent = ( shape, knot, span, start, end ) => {
	const chord = distance( start, end )
	const scale = shape.scales[knot]
	const direction = knot === span ? shape.tangents.outgoing[knot] : shape.tangents.incoming[knot]
	const profile = shape.corners[knot] ? null : shape.profiles[knot]
	if ( !profile ) {
		const length = scale * chord
		return [direction[0] * length, direction[1] * length, direction[2] * length]
	}

	const up = shape.up
	const grade = profileGrade( profile, scale )
	const slope = Math.hypot( 1, grade )
	const rise = ( end[0] - start[0] ) * up[0] + ( end[1] - start[1] ) * up[1] + ( end[2] - start[2] ) * up[2]
	const run = Math.sqrt( Math.max( 0, chord * chord - rise * rise ) )
	const weight = profile.weight
	const x = direction[0] + ( ( profile.heading[0] + up[0] * grade ) / slope - direction[0] ) * weight
	const y = direction[1] + ( ( profile.heading[1] + up[1] * grade ) / slope - direction[1] ) * weight
	const z = direction[2] + ( ( profile.heading[2] + up[2] * grade ) / slope - direction[2] ) * weight
	const directionLength = Math.hypot( x, y, z )
	if ( directionLength <= EPSILON ) {
		const length = scale * chord
		return [direction[0] * length, direction[1] * length, direction[2] * length]
	}
	const length = scale * ( chord + ( run * slope - chord ) * weight ) / directionLength
	return [x * length, y * length, z * length]
}

const reversalAxis = ( direction, up ) => {
	const projection = dot( direction, up )
	const axis = [0, 0, 0]
	if ( normalize(
		up[0] - direction[0] * projection,
		up[1] - direction[1] * projection,
		up[2] - direction[2] * projection,
		axis
	) ) return axis

	const fallback = Math.abs( direction[0] ) <= Math.abs( direction[1] ) && Math.abs( direction[0] ) <= Math.abs( direction[2] )
		? [1, 0, 0]
		: Math.abs( direction[1] ) <= Math.abs( direction[2] ) ? [0, 1, 0] : [0, 0, 1]
	const fallbackProjection = dot( direction, fallback )
	normalize(
		fallback[0] - direction[0] * fallbackProjection,
		fallback[1] - direction[1] * fallbackProjection,
		fallback[2] - direction[2] * fallbackProjection,
		axis
	)
	return axis
}

/**
 * The two directions a rounded corner turns between. They keep the plan
 * headings of its legs, but not always their grades: a flat arc cannot climb
 * all the way round a bend, and the plane of two legs that double back while
 * they climb stands on its edge, which takes the road up a wall. So the arc
 * carries through its control no more grade than a smooth knot would there,
 * and meets each leg no steeper than that leg and never against its slope.
 */
const cornerDirections = ( before, after, profile, up ) => {
	if ( !profile ) return [before, after]
	const { weight, runs, beforeGrade, afterGrade } = profile
	const mean = ( beforeGrade + afterGrade ) * 0.5
	const carried = Math.abs( profileGrade( profile, 1 ) ) * Math.cos( profile.turn * 0.5 )
	const through = Math.sign( mean ) * Math.min( Math.abs( mean ), carried )
	const split = clamp(
		( beforeGrade - afterGrade ) * 0.5,
		Math.max( Math.min( 0, beforeGrade ) - through, through - Math.max( 0, afterGrade ) ),
		Math.min( Math.max( 0, beforeGrade ) - through, through - Math.min( 0, afterGrade ) )
	)
	return [[before, runs[0], through + split], [after, runs[1], through - split]].map( ( [leg, run, grade] ) => {
		const slope = Math.hypot( 1, grade )
		const direction = [0, 0, 0]
		for ( let axis = 0; axis < 3; axis++ ) {
			direction[axis] = leg[axis] + ( ( run[axis] + up[axis] * grade ) / slope - leg[axis] ) * weight
		}
		normalize( direction[0], direction[1], direction[2], direction )
		return direction
	} )
}

/** Propose a fixed-radius 3D turn through one authored control point. */
const proposeCorner = ( knots, legDirections, index, settings, profile ) => {
	const up = settings.up
	const [before, after] = cornerDirections( legDirections[index - 1], legDirections[index], profile, up )
	const turn = Math.acos( clamp( dot( before, after ), -1, 1 ) )
	if ( !( turn > 1e-4 ) ) return null

	const axis = [0, 0, 0]
	const sum = [before[0] + after[0], before[1] + after[1], before[2] + after[2]]
	const sumLength = Math.hypot( sum[0], sum[1], sum[2] )
	cross( before, after, axis )
	const axisLength = Math.hypot( axis[0], axis[1], axis[2] )
	const toCentre = [0, 0, 0]

	if ( axisLength > 1e-6 && sumLength > 1e-6 ) {
		axis[0] /= axisLength
		axis[1] /= axisLength
		axis[2] /= axisLength
		sum[0] /= sumLength
		sum[1] /= sumLength
		sum[2] /= sumLength
		cross( axis, sum, toCentre )
		normalize( toCentre[0], toCentre[1], toCentre[2], toCentre )
	} else {
		const resolvedAxis = reversalAxis( before, up )
		axis[0] = resolvedAxis[0]
		axis[1] = resolvedAxis[1]
		axis[2] = resolvedAxis[2]
		toCentre[0] = -before[0]
		toCentre[1] = -before[1]
		toCentre[2] = -before[2]
		// An exact reversal still climbs through its control as steeply as a
		// near one does: the turn plane leans about the line to its centre.
		const grade = profile ? profileGrade( profile, 1 ) * profile.weight : 0
		if ( grade !== 0 ) {
			cross( axis, before, sum )
			normalize( sum[0] + up[0] * grade, sum[1] + up[1] * grade, sum[2] + up[2] * grade, sum )
			cross( before, sum, axis )
		}
	}

	const half = turn * 0.5
	const spread = 2 * Math.sin( half * 0.5 )
	if ( !( spread > 1e-6 ) ) return null

	return {
		vertex: knots[index],
		axis,
		toCentre,
		spread,
		sweep: half,
		radius: settings.minRadius,
	}
}

const finalizeCorner = ( corner, settings ) => {
	const { vertex, toCentre, radius, sweep, axis } = corner
	const outward = [-toCentre[0], -toCentre[1], -toCentre[2]]
	const entryRadial = rotateAroundAxis( outward, axis, -sweep, [0, 0, 0] )
	const exitRadial = rotateAroundAxis( outward, axis, sweep, [0, 0, 0] )
	const tangent = cross( axis, outward, [0, 0, 0] )

	return {
		...corner,
		outward,
		// The directions the road arrives and leaves in, which the spans either side take up.
		incoming: rotateAroundAxis( tangent, axis, -sweep, [0, 0, 0] ),
		outgoing: rotateAroundAxis( tangent, axis, sweep, [0, 0, 0] ),
		centre: [
			vertex[0] + toCentre[0] * radius,
			vertex[1] + toCentre[1] * radius,
			vertex[2] + toCentre[2] * radius,
		],
		entry: [
			vertex[0] + ( toCentre[0] + entryRadial[0] ) * radius,
			vertex[1] + ( toCentre[1] + entryRadial[1] ) * radius,
			vertex[2] + ( toCentre[2] + entryRadial[2] ) * radius,
		],
		exit: [
			vertex[0] + ( toCentre[0] + exitRadial[0] ) * radius,
			vertex[1] + ( toCentre[1] + exitRadial[1] ) * radius,
			vertex[2] + ( toCentre[2] + exitRadial[2] ) * radius,
		],
		tight: radius < settings.foldRadius,
	}
}

/**
 * Size the arcs of one region. Legs leaving the region end at a smooth knot,
 * so the shared-leg budget never couples two regions.
 */
const buildRegionCorners = ( region, knots, legDirections, legs, profiles, needsArc, settings, factor = 1 ) => {
	const proposals = new Array( knots.length ).fill( null )
	for ( let index = region.first; index <= region.last; index++ ) {
		if ( !needsArc[index] ) continue
		const proposal = proposeCorner( knots, legDirections, index, settings, profiles[index] )
		if ( proposal ) proposal.radius *= factor
		proposals[index] = proposal
	}

	for ( let pass = 0; pass < 3; pass++ ) {
		let changed = false
		for ( let leg = region.first - 1; leg <= region.last; leg++ ) {
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

const createSpanCurve = ( shape, index ) => {
	const start = shape.corners[index] ? shape.corners[index].exit : shape.knots[index]
	const end = shape.corners[index + 1] ? shape.corners[index + 1].entry : shape.knots[index + 1]
	return {
		start,
		end,
		startTangent: knotTangent( shape, index, index, start, end ),
		endTangent: knotTangent( shape, index + 1, index, start, end ),
	}
}

/**
 * Split a curvature vector into the part that turns a level ribbon sideways and
 * the part that takes it over a crest or through a dip.
 */
const splitCurvature = ( tangent, curvature, up, out ) => {
	const rise = dot( up, tangent )
	const level = 1 - rise * rise
	if ( level < 1e-6 ) {
		// Straight up: no level side to speak of, so all of it counts as sideways.
		out.lateral = Math.hypot( curvature[0], curvature[1], curvature[2] )
		out.vertical = 0
		return
	}
	const scale = 1 / Math.sqrt( level )
	const normalX = ( up[0] - tangent[0] * rise ) * scale
	const normalY = ( up[1] - tangent[1] * rise ) * scale
	const normalZ = ( up[2] - tangent[2] * rise ) * scale
	out.vertical = curvature[0] * normalX + curvature[1] * normalY + curvature[2] * normalZ
	out.lateral =
		curvature[0] * ( normalY * tangent[2] - normalZ * tangent[1] ) +
		curvature[1] * ( normalZ * tangent[0] - normalX * tangent[2] ) +
		curvature[2] * ( normalX * tangent[1] - normalY * tangent[0] )
}

/**
 * Turning radius a level road actually feels. Crest and sag curvature bend the
 * ribbon along its length and cannot fold it, so the part of the curvature
 * vector that points along `up` is dropped while the tangent is mostly level
 * and the deck is not rolled onto its side. Near-vertical tangents or steeply
 * banked walls fade back to the full 3D curvature.
 *
 * This is the radius the planner shapes the road by: it depends on the map
 * alone, so raising or banking a control never moves the road sideways.
 */
const lateralRadius = ( curvatureX, curvatureY, curvatureZ, tangentRise, up, bank = 0 ) => {
	const total = curvatureX * curvatureX + curvatureY * curvatureY + curvatureZ * curvatureZ
	const level = 1 - tangentRise * tangentRise
	const bankWeight = 1 - smoothstep( 0.65, 1.0, Math.abs( Math.sin( bank ) ) )
	const weight = smoothstep( PROFILE_RUN_MIN, PROFILE_RUN_FULL, Math.sqrt( Math.max( 0, level ) ) ) * bankWeight
	const vertical = curvatureX * up[0] + curvatureY * up[1] + curvatureZ * up[2]
	const lateral = weight > 0 ? Math.max( 0, total - weight * vertical * vertical / level ) : total
	return lateral > EPSILON * EPSILON ? 1 / Math.sqrt( lateral ) : Infinity
}

const SPLIT = { lateral: 0, vertical: 0 }

/**
 * Radius the ribbon turns on within its own deck, which is what its inside edge
 * has to fit. A level deck takes all of a sideways turn and none of a crest or
 * a sag, which only bend it along its length. A deck banked by `b` takes
 * `cos( b )` of the turn and `sin( b )` of the crest: tilted into a sharp
 * enough one, it folds on a road that is straight on the map. Near-vertical
 * tangents have no level side and fade back to the full 3D curvature.
 *
 * Heights and banks are authored, so the planner cannot open such a fold. It
 * reads this radius off the finished samples and reports the road as too tight.
 */
const deckRadius = ( tangent, curvature, up, bank = 0 ) => {
	const rise = dot( up, tangent )
	const weight = smoothstep( PROFILE_RUN_MIN, PROFILE_RUN_FULL, Math.sqrt( Math.max( 0, 1 - rise * rise ) ) )
	splitCurvature( tangent, curvature, up, SPLIT )
	const within = SPLIT.lateral * Math.cos( bank ) + SPLIT.vertical * Math.sin( bank )
	const bend = weight * within * within + ( 1 - weight ) * dot( curvature, curvature )
	return bend > EPSILON * EPSILON ? 1 / Math.sqrt( bend ) : Infinity
}

/** Analytic lateral-curvature report for one cubic span. */
const probeSpan = ( shape, index ) => {
	const curve = createSpanCurve( shape, index )
	const first = [0, 0, 0]
	const second = [0, 0, 0]
	const up = shape.up
	const startBank = shape.banks ? shape.banks[index] : 0
	const bankDelta = shape.banks ? shape.banks[index + 1] - startBank : 0
	const report = { worst: Infinity, nearStart: Infinity, nearEnd: Infinity }

	for ( let step = 0; step <= SPAN_PROBES; step++ ) {
		const t = step / SPAN_PROBES
		hermiteDerivative( curve, t, first )
		hermiteSecondDerivative( curve, t, second )
		const speedSquared = dot( first, first )
		let radius = 0
		if ( speedSquared > EPSILON * EPSILON ) {
			// The curvature vector is the part of r'' normal to r', over |r'|².
			const along = dot( first, second ) / speedSquared
			const inverse = 1 / speedSquared
			radius = lateralRadius(
				( second[0] - first[0] * along ) * inverse,
				( second[1] - first[1] * along ) * inverse,
				( second[2] - first[2] * along ) * inverse,
				dot( first, up ) / Math.sqrt( speedSquared ),
				up,
				startBank + bankDelta * t
			)
		}
		report.worst = Math.min( report.worst, radius )
		if ( t <= 0.34 ) report.nearStart = Math.min( report.nearStart, radius )
		if ( t >= 0.66 ) report.nearEnd = Math.min( report.nearEnd, radius )
	}
	return report
}

const spanPenalty = ( report, target ) => {
	const shortfall = Math.max( 0, target - report.worst )
	return shortfall * shortfall
}

const knotRadius = ( reports, index ) => Math.min(
	reports[index - 1]?.nearEnd ?? Infinity,
	reports[index]?.nearStart ?? Infinity
)

const appendPoint = ( points, x, y, z, settings ) => {
	if ( points.length / 3 >= settings.maxPoints ) {
		throw new RangeError( `[roadPath] Adaptive tessellation exceeded maxPoints (${settings.maxPoints})` )
	}
	points.push( x, y, z )
	return points.length / 3 - 1
}

/** Largest turn one sample may take on a bend of `radius`. */
const maxArcStep = ( radius, settings ) => {
	const angleBudget = settings.maxAngle * BUDGET_SHARE
	const sagitta = settings.maxChordError * BUDGET_SHARE
	if ( sagitta >= radius ) return angleBudget
	return Math.min( angleBudget, 2 * Math.acos( 1 - sagitta / radius ) )
}

/** Longest sample the budgets allow where the road has this curvature. `cap` holds the spacing and bank budgets. */
const budgetStep = ( curvature, cap, settings ) => {
	if ( !( curvature * cap > EPSILON ) ) return cap
	const radius = 1 / curvature
	return Math.min( cap, radius * maxArcStep( radius, settings ) )
}

const pointSegmentDistance = ( point, start, end ) => {
	const dx = end[0] - start[0]
	const dy = end[1] - start[1]
	const dz = end[2] - start[2]
	const lengthSquared = dx * dx + dy * dy + dz * dz
	if ( lengthSquared <= EPSILON * EPSILON ) return distance( point, start )
	const projection = clamp(
		( ( point[0] - start[0] ) * dx + ( point[1] - start[1] ) * dy + ( point[2] - start[2] ) * dz ) / lengthSquared,
		0,
		1
	)
	return Math.hypot(
		point[0] - ( start[0] + dx * projection ),
		point[1] - ( start[1] + dy * projection ),
		point[2] - ( start[2] + dz * projection )
	)
}

const vectorAngle = ( ax, ay, az, bx, by, bz ) => {
	const lengthA = Math.hypot( ax, ay, az )
	const lengthB = Math.hypot( bx, by, bz )
	if ( lengthA <= EPSILON || lengthB <= EPSILON ) return Math.PI
	const denominator = lengthA * lengthB
	return Math.acos( clamp( ( ax * bx + ay * by + az * bz ) / denominator, -1, 1 ) )
}

/** A rounded corner, by its rotation away from the control: negative on the way in, positive on the way out. */
const createArc = ( corner, up ) => {
	const radial = [0, 0, 0]
	const tangent = [0, 0, 0]
	const arc = {
		lateral: 0,
		vertical: 0,
		point( rotation, out ) {
			rotateAroundAxis( corner.outward, corner.axis, rotation, radial )
			out[0] = corner.centre[0] + radial[0] * corner.radius
			out[1] = corner.centre[1] + radial[1] * corner.radius
			out[2] = corner.centre[2] + radial[2] * corner.radius
		},
		/** Read `lateral` and `vertical` curvature at `rotation`. */
		probe( rotation ) {
			rotateAroundAxis( corner.outward, corner.axis, rotation, radial )
			cross( corner.axis, radial, tangent )
			radial[0] /= -corner.radius
			radial[1] /= -corner.radius
			radial[2] /= -corner.radius
			splitCurvature( tangent, radial, up, arc )
		},
	}
	return arc
}

const createLinePoint = ( start, end ) => ( t, out ) => {
	out[0] = start[0] + ( end[0] - start[0] ) * t
	out[1] = start[1] + ( end[1] - start[1] ) * t
	out[2] = start[2] + ( end[2] - start[2] ) * t
}

/** One cubic span as a Bezier, with the speed and curvature the budgets are read from. */
const createCubic = ( p0, p1, p2, p3, up ) => {
	const first = [0, 0, 0]
	const second = [0, 0, 0]
	const cubic = {
		speed: 0,
		curvature: 0,
		lateral: 0,
		vertical: 0,
		point( t, out ) {
			const s = 1 - t
			const w0 = s * s * s
			const w1 = 3 * s * s * t
			const w2 = 3 * s * t * t
			const w3 = t * t * t
			out[0] = w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0]
			out[1] = w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1]
			out[2] = w0 * p0[2] + w1 * p1[2] + w2 * p2[2] + w3 * p3[2]
		},
		/** Read `speed`, `curvature` and its `lateral` and `vertical` parts at `t`. */
		probe( t ) {
			const s = 1 - t
			for ( let axis = 0; axis < 3; axis++ ) {
				const a = p1[axis] - p0[axis]
				const b = p2[axis] - p1[axis]
				const c = p3[axis] - p2[axis]
				first[axis] = 3 * ( s * s * a + 2 * s * t * b + t * t * c )
				second[axis] = 6 * ( s * ( b - a ) + t * ( c - b ) )
			}
			const speed = Math.hypot( first[0], first[1], first[2] )
			cubic.speed = speed
			if ( !( speed > EPSILON ) ) {
				cubic.curvature = cubic.lateral = cubic.vertical = 0
				return speed
			}
			// The curvature vector is the part of r'' square to r', over |r'|².
			const along = dot( first, second ) / ( speed * speed )
			for ( let axis = 0; axis < 3; axis++ ) {
				second[axis] = ( second[axis] - first[axis] * along ) / ( speed * speed )
				first[axis] /= speed
			}
			cubic.curvature = Math.hypot( second[0], second[1], second[2] )
			splitCurvature( first, second, up, cubic )
			return speed
		},
		length() {
			let sum = cubic.probe( 0 ) + cubic.probe( 1 )
			for ( let step = 1; step < LENGTH_STEPS; step++ ) sum += cubic.probe( step / LENGTH_STEPS ) * ( step % 2 ? 4 : 2 )
			return sum / ( LENGTH_STEPS * 3 )
		},
	}
	return cubic
}

/** Whether a span's cubic is a straight run from its start to its end. */
const isStraightSpan = ( p0, p1, p2, p3, settings ) => {
	const dx = p3[0] - p0[0]
	const dy = p3[1] - p0[1]
	const dz = p3[2] - p0[2]
	const chord = Math.hypot( dx, dy, dz )
	if ( chord <= EPSILON ) return false
	const projection = point => ( ( point[0] - p0[0] ) * dx + ( point[1] - p0[1] ) * dy + ( point[2] - p0[2] ) * dz ) / chord
	const first = projection( p1 )
	const second = projection( p2 )
	const tolerance = Math.max( EPSILON * 4, Math.min( settings.maxChordError * 0.01, chord * 1e-8 ) )
	return pointSegmentDistance( p1, p0, p3 ) <= tolerance &&
		pointSegmentDistance( p2, p0, p3 ) <= tolerance &&
		first >= -tolerance && second >= first - tolerance && second <= chord + tolerance
}

/**
 * The road cut into cells, each a short run of one arc, line or cubic with the
 * sample length the budgets ask for there and how fast the ribbon bends within
 * its own surface. Samples are placed from these rather than from the curves,
 * so a stretch made of three different curves is sampled as one.
 */
const createCells = () => ( {
	point: [],
	from: [],
	to: [],
	length: [],
	step: [],
	bend: [],
	stretch: [],
	// The stretch being added: its index, how far into it the next cell starts,
	// and the bank there, which changes evenly with the distance travelled.
	index: 0,
	travelled: 0,
	bank: 0,
	bankRate: 0,
} )

const pushCell = ( cells, point, from, to, length, step, bend, stretch ) => {
	cells.point.push( point )
	cells.from.push( from )
	cells.to.push( to )
	cells.length.push( length )
	cells.step.push( step )
	cells.bend.push( bend )
	cells.stretch.push( stretch )
}

/**
 * Add the next cell of the current stretch. What its inside edge has to make
 * room for is the curvature along the banked side of the ribbon: all of a level
 * turn, and of a crest or a dip only as much as the deck is tilted into it.
 */
const addCell = ( cells, point, from, to, length, step, lateral, vertical ) => {
	const bank = cells.bank + cells.bankRate * ( cells.travelled + length * 0.5 )
	cells.travelled += length
	pushCell( cells, point, from, to, length, step, Math.abs( lateral * Math.cos( bank ) + vertical * Math.sin( bank ) ), cells.index )
}

const addArcCells = ( corner, arc, from, to, cap, settings, cells ) => {
	const step = budgetStep( 1 / corner.radius, cap, settings )
	const length = corner.radius * ( to - from )
	const count = Math.max( 1, Math.ceil( length / step * CELLS_PER_STEP ) )
	for ( let cell = 0; cell < count; cell++ ) {
		const start = from + ( to - from ) * cell / count
		const end = from + ( to - from ) * ( cell + 1 ) / count
		arc.probe( ( start + end ) * 0.5 )
		addCell( cells, arc.point, start, end, length / count, step, arc.lateral, arc.vertical )
	}
}

/** Halve the cubic until every cell is a fraction of the sample the budgets allow anywhere on it. */
const addCubicCells = ( cubic, cap, spanIndex, settings, cells, sampling ) => {
	const probe = t => {
		const speed = cubic.probe( t )
		return { speed, density: speed / budgetStep( cubic.curvature, cap, settings ), lateral: cubic.lateral, vertical: cubic.vertical }
	}
	const forced = Math.min( MIN_CUBIC_DEPTH, settings.maxDepth )
	const stack = [{ from: 0, to: 1, depth: 0, start: probe( 0 ), middle: probe( 0.5 ), end: probe( 1 ) }]
	while ( stack.length > 0 ) {
		const { from, to, depth, start, middle, end } = stack.pop()
		const span = to - from
		const densest = Math.max( start.density, middle.density, end.density )
		if ( depth >= forced && span * densest * CELLS_PER_STEP <= 1 ) {
			const length = span * ( start.speed + 4 * middle.speed + end.speed ) / 6
			const samples = span * ( start.density + 4 * middle.density + end.density ) / 6
			addCell( cells, cubic.point, from, to, length, samples > 0 ? length / samples : cap, middle.lateral, middle.vertical )
			continue
		}
		if ( depth >= settings.maxDepth ) {
			throw new RangeError( `[roadPath] Adaptive tessellation reached maxDepth (${settings.maxDepth}) on span ${spanIndex}` )
		}
		sampling.splits++
		sampling.maxDepth = Math.max( sampling.maxDepth, depth + 1 )
		const centre = ( from + to ) * 0.5
		stack.push(
			{ from: centre, to, depth: depth + 1, start: middle, middle: probe( ( centre + to ) * 0.5 ), end },
			{ from, to: centre, depth: depth + 1, start, middle: probe( ( from + centre ) * 0.5 ), end: middle }
		)
	}
}

/**
 * Add the cells of the stretch from control `index` to the next one: the second
 * half of the corner at its first control, the span, and the first half of the
 * corner at its second.
 */
const addStretchCells = ( shape, index, arcs, settings, cells, sampling ) => {
	const exit = shape.corners[index]
	const entry = shape.corners[index + 1]
	const curve = createSpanCurve( shape, index )
	const p0 = curve.start
	const p3 = curve.end
	const p1 = [p0[0] + curve.startTangent[0] / 3, p0[1] + curve.startTangent[1] / 3, p0[2] + curve.startTangent[2] / 3]
	const p2 = [p3[0] - curve.endTangent[0] / 3, p3[1] - curve.endTangent[1] / 3, p3[2] - curve.endTangent[2] / 3]
	const straight = isStraightSpan( p0, p1, p2, p3, settings )
	const cubic = straight ? null : createCubic( p0, p1, p2, p3, shape.up )
	const spanLength = straight ? distance( p0, p3 ) : cubic.length()

	// Bank is spread evenly over the travelled distance between two controls, so
	// its budget is one more cap on how long a sample of this stretch may be.
	const length = ( exit ? exit.radius * exit.sweep : 0 ) + spanLength + ( entry ? entry.radius * entry.sweep : 0 )
	const bankDelta = shape.banks[index + 1] - shape.banks[index]
	const bankStep = settings.maxBankAngle * BUDGET_SHARE
	const cap = Math.abs( bankDelta ) * settings.spacing > bankStep * length
		? Math.max( EPSILON, bankStep * length / Math.abs( bankDelta ) )
		: settings.spacing
	cells.index = index
	cells.travelled = 0
	cells.bank = shape.banks[index]
	cells.bankRate = length > EPSILON ? bankDelta / length : 0

	if ( exit ) addArcCells( exit, arcs[index], 0, exit.sweep, cap, settings, cells )
	if ( straight ) {
		addCell( cells, createLinePoint( p0, p3 ), 0, 1, spanLength, cap, 0, 0 )
		sampling.straightSpans++
	} else {
		addCubicCells( cubic, cap, index, settings, cells, sampling )
	}
	if ( entry ) addArcCells( entry, arcs[index + 1], -entry.sweep, 0, cap, settings, cells )
}

/**
 * Cut long cells down next to short ones, so that no cell is more than twice
 * the length of the one beside it. A sample that has to be shortened next to a
 * tight bend is then shortened over a cell its own size, not over the whole
 * length of a long, gentle one.
 */
const gradeCells = ( cells, settings ) => {
	const { point, from, to, length, step, bend, stretch } = cells
	const count = step.length
	// Cells this short are not worth matching: a few metres further the road is back to full-length samples.
	const floor = settings.foldRadius * maxArcStep( settings.foldRadius, settings ) / ( CELLS_PER_STEP * 4 )
	// The length a cell may have where two of them meet: twice the shorter one,
	// and further away no more than that plus the distance from it.
	const size = new Float64Array( count + 1 )
	for ( let edge = 0; edge <= count; edge++ ) {
		size[edge] = 2 * Math.max( floor, Math.min( edge > 0 ? length[edge - 1] : Infinity, edge < count ? length[edge] : Infinity ) )
	}
	for ( let edge = 1; edge <= count; edge++ ) size[edge] = Math.min( size[edge], size[edge - 1] + length[edge - 1] )
	for ( let edge = count - 1; edge >= 0; edge-- ) size[edge] = Math.min( size[edge], size[edge + 1] + length[edge] )

	const graded = createCells()
	for ( let cell = 0; cell < count; cell++ ) {
		const whole = length[cell]
		const span = to[cell] - from[cell]
		for ( let done = 0; done < whole; ) {
			// Long enough for where it starts, and for where it will end.
			let piece = Math.min( size[cell] + done, ( size[cell + 1] + whole - done ) * 0.5 )
			if ( !( piece < ( whole - done ) * ( 1 - 1e-9 ) ) || whole - done - piece < piece * 0.5 ) piece = whole - done
			pushCell(
				graded,
				point[cell],
				from[cell] + span * done / whole,
				piece === whole - done ? to[cell] : from[cell] + span * ( done + piece ) / whole,
				piece,
				step[cell],
				bend[cell],
				stretch[cell]
			)
			done += piece
		}
		if ( !( whole > 0 ) ) pushCell( graded, point[cell], from[cell], to[cell], 0, step[cell], bend[cell], stretch[cell] )
	}
	graded.length = Float64Array.from( graded.length )
	graded.step = Float64Array.from( graded.step )
	graded.bend = Float64Array.from( graded.bend )
	return graded
}

/**
 * Leave every sample room for the turns next to it.
 *
 * The inside edge of a join steps back by half the ribbon width times the
 * tangent of half its turn, and a sample has to hold the setbacks of both its
 * joins. One much shorter than its neighbour cannot once that neighbour turns
 * through a real angle: the surface would have to trim the join, which leaves a
 * notch in the verge and a sliver standing on edge across the road. So a
 * sample `s` long where the ribbon bends by `k` lets the samples beside it turn
 * by at most `s * ( 2 / w - k )`, with the fold radius standing in for the half
 * width `w`, and whatever that shortens limits its own neighbours in turn.
 * Where the budgets already ask for the same turn from one sample to the next,
 * which is most of any road, nothing changes.
 */
const easeSteps = ( cells, settings ) => {
	const { length, step, bend, stretch } = cells
	const count = step.length
	const start = new Float64Array( count + 1 )
	for ( let cell = 0; cell < count; cell++ ) start[cell + 1] = start[cell] + length[cell]
	// A bend tighter than the fold radius folds the ribbon whatever its samples
	// are, so it counts as that radius: a sample then never asks the ones beside
	// it to be shorter than itself, and a fold cannot shrink the road around it.
	const tightestBend = 1 / settings.foldRadius
	// Shorten the sample at `cell` to what the shorter ones on one side of it leave room for.
	const ease = ( cell, direction ) => {
		// A sample reaching from here to there bends as fast as the tightest cell
		// between them. It never reaches past a control, which is a sample itself:
		// beyond one, only this side of it counts, and a stretch is re-sampled for
		// its neighbour's sake only when its own first sample would be in the way.
		let tightest = Math.min( bend[cell], tightestBend )
		for ( let beside = cell + direction; beside >= 0 && beside < count; beside += direction ) {
			const gap = direction > 0 ? start[beside] - start[cell + 1] : start[cell] - start[beside + 1]
			// Only a shorter sample can crowd this one, and only from less than its own length away.
			if ( gap >= step[cell] * 2 ) break
			if ( bend[beside] > tightest && stretch[beside] === stretch[cell] ) tightest = Math.min( bend[beside], tightestBend )
			if ( !( tightest > 0 ) ) continue
			const room = step[beside] * ( 2 * tightestBend - Math.min( bend[beside], tightestBend ) ) / tightest
			// A sample that long would sit right next to the short one.
			if ( room < step[cell] && gap - step[beside] < room ) step[cell] = room
		}
	}
	for ( let cell = 1; cell < count; cell++ ) ease( cell, -1 )
	for ( let cell = count - 2; cell >= 0; cell-- ) ease( cell, 1 )
}

let placed = new Float64Array( 768 )
const SAMPLE = [0, 0, 0]
const SEGMENT_START = [0, 0, 0]
const SEGMENT_END = [0, 0, 0]

/**
 * Place `rows` samples over cells `first` to `end`, each with the point halfway
 * to it: sample `n` lands at offset `( n * 2 - 1 ) * 3` of `placed`, the halfway
 * point before it three values earlier.
 *
 * Every sample takes the same share of what the budgets allow where it lies, so
 * the turn from one to the next changes only as the road does. Rounding the row
 * count up leaves a little to spare, and the middle of the stretch takes most of
 * it: the samples either side of a control then stay close in length even when
 * one of its stretches is only a few rows long.
 */
const placeSamples = ( cells, first, end, total, rows ) => {
	const { point, from, to, length, step } = cells
	const count = rows * 2 - 1
	if ( placed.length < count * 3 ) placed = new Float64Array( count * 6 )
	const spare = total > 0 ? ( rows / total - 1 ) * 0.5 : 0
	let cell = first
	let before = 0
	let samples = length[cell] / step[cell]
	for ( let half = 1; half <= count; half++ ) {
		const progress = half / ( rows * 2 )
		const at = total * ( progress + spare * progress * ( 1 - progress ) * ( 1 - 2 * progress ) )
		while ( cell < end - 1 && at > before + samples ) {
			before += samples
			cell++
			samples = length[cell] / step[cell]
		}
		const share = samples > 0 ? clamp( ( at - before ) / samples, 0, 1 ) : 0
		point[cell]( from[cell] + ( to[cell] - from[cell] ) * share, SAMPLE )
		placed.set( SAMPLE, ( half - 1 ) * 3 )
	}
}

/** Whether the samples just placed, from the last emitted point to `target`, hold the spacing, chord and turn budgets. */
const samplesKeepBudgets = ( rows, points, target, settings ) => {
	const anchor = points.length - 3
	let previousX = 0
	let previousY = 0
	let previousZ = 0
	let hasPrevious = anchor >= 3
	if ( hasPrevious ) {
		previousX = points[anchor] - points[anchor - 3]
		previousY = points[anchor + 1] - points[anchor - 2]
		previousZ = points[anchor + 2] - points[anchor - 1]
	}
	SEGMENT_START[0] = points[anchor]
	SEGMENT_START[1] = points[anchor + 1]
	SEGMENT_START[2] = points[anchor + 2]
	for ( let row = 1; row <= rows; row++ ) {
		const offset = ( row * 2 - 1 ) * 3
		SEGMENT_END[0] = row < rows ? placed[offset] : target[0]
		SEGMENT_END[1] = row < rows ? placed[offset + 1] : target[1]
		SEGMENT_END[2] = row < rows ? placed[offset + 2] : target[2]
		const x = SEGMENT_END[0] - SEGMENT_START[0]
		const y = SEGMENT_END[1] - SEGMENT_START[1]
		const z = SEGMENT_END[2] - SEGMENT_START[2]
		if ( Math.hypot( x, y, z ) > settings.spacing * ( 1 + 1e-9 ) ) return false
		SAMPLE[0] = placed[offset - 3]
		SAMPLE[1] = placed[offset - 2]
		SAMPLE[2] = placed[offset - 1]
		if ( pointSegmentDistance( SAMPLE, SEGMENT_START, SEGMENT_END ) > settings.maxChordError ) return false
		if ( hasPrevious && vectorAngle( previousX, previousY, previousZ, x, y, z ) > settings.maxAngle ) return false
		previousX = x
		previousY = y
		previousZ = z
		hasPrevious = true
		SEGMENT_START[0] = SEGMENT_END[0]
		SEGMENT_START[1] = SEGMENT_END[1]
		SEGMENT_START[2] = SEGMENT_END[2]
	}
	return true
}

/** Emit the samples between the control just emitted and `target`, the next one. */
const emitStretch = ( cells, first, end, target, settings, points ) => {
	let total = 0
	for ( let cell = first; cell < end; cell++ ) total += cells.length[cell] / cells.step[cell]
	// The cells only estimate what each sample will measure, so the samples are
	// checked once placed, and rows are added a few times over if they fail.
	let rows = Math.max( 1, Math.ceil( total - 1e-9 ) )
	for ( let attempt = 0; ; attempt++ ) {
		if ( points.length / 3 + rows > settings.maxPoints ) {
			throw new RangeError( `[roadPath] Adaptive tessellation exceeded maxPoints (${settings.maxPoints})` )
		}
		placeSamples( cells, first, end, total, rows )
		if ( attempt >= MAX_RETRIES || samplesKeepBudgets( rows, points, target, settings ) ) break
		rows += Math.max( 1, rows >> 5 )
	}
	for ( let row = 1; row < rows; row++ ) {
		const offset = ( row * 2 - 1 ) * 3
		appendPoint( points, placed[offset], placed[offset + 1], placed[offset + 2], settings )
	}
}

const unwrapBanks = knots => {
	const banks = new Float64Array( knots.length )
	banks[0] = knots[0][3]
	for ( let index = 1; index < knots.length; index++ ) {
		let delta = knots[index][3] - knots[index - 1][3]
		delta = ( delta + Math.PI ) % ( Math.PI * 2 )
		if ( delta < 0 ) delta += Math.PI * 2
		delta -= Math.PI
		banks[index] = banks[index - 1] + delta
	}
	return banks
}

const buildSampleBanks = ( points, anchors, knots ) => {
	const count = points.length / 3
	const distances = new Float64Array( count )
	for ( let index = 1; index < count; index++ ) {
		distances[index] = distances[index - 1] + Math.hypot(
			points[index * 3] - points[( index - 1 ) * 3],
			points[index * 3 + 1] - points[( index - 1 ) * 3 + 1],
			points[index * 3 + 2] - points[( index - 1 ) * 3 + 2]
		)
	}
	const banks = new Float64Array( count )
	const controlBanks = unwrapBanks( knots )
	for ( let knot = 0; knot < anchors.length - 1; knot++ ) {
		const start = anchors[knot]
		const end = anchors[knot + 1]
		const length = distances[end] - distances[start]
		for ( let index = start; index <= end; index++ ) {
			const progress = length > EPSILON ? ( distances[index] - distances[start] ) / length : 0
			banks[index] = controlBanks[knot] + ( controlBanks[knot + 1] - controlBanks[knot] ) * progress
		}
	}
	return banks
}

/** Add rows only where a large authored bank delta needs them. */
const refineBankSteps = ( rawPoints, rawBanks, rawAnchors, settings ) => {
	const rawCount = rawPoints.length / 3
	const points = []
	const banks = []
	const oldToNew = new Int32Array( rawCount )
	appendPoint( points, rawPoints[0], rawPoints[1], rawPoints[2], settings )
	banks.push( rawBanks[0] )

	for ( let index = 0; index < rawCount - 1; index++ ) {
		const offset = index * 3
		const nextOffset = offset + 3
		const segmentLength = Math.hypot(
			rawPoints[nextOffset] - rawPoints[offset],
			rawPoints[nextOffset + 1] - rawPoints[offset + 1],
			rawPoints[nextOffset + 2] - rawPoints[offset + 2]
		)
		const bankDelta = rawBanks[index + 1] - rawBanks[index]
		const divisions = Math.max(
			1,
			Math.ceil( segmentLength / settings.spacing ),
			Math.ceil( Math.abs( bankDelta ) / settings.maxBankAngle )
		)

		for ( let division = 1; division <= divisions; division++ ) {
			const progress = division / divisions
			appendPoint(
				points,
				rawPoints[offset] + ( rawPoints[nextOffset] - rawPoints[offset] ) * progress,
				rawPoints[offset + 1] + ( rawPoints[nextOffset + 1] - rawPoints[offset + 1] ) * progress,
				rawPoints[offset + 2] + ( rawPoints[nextOffset + 2] - rawPoints[offset + 2] ) * progress,
				settings
			)
			banks.push( rawBanks[index] + bankDelta * progress )
		}
		oldToNew[index + 1] = points.length / 3 - 1
	}

	const anchors = new Int32Array( rawAnchors.length )
	for ( let index = 0; index < anchors.length; index++ ) anchors[index] = oldToNew[rawAnchors[index]]
	return { points: Float64Array.from( points ), bank: Float32Array.from( banks ), anchors }
}

const SAMPLE_TANGENT = [0, 0, 0]
const SAMPLE_CURVATURE = [0, 0, 0]
const SAMPLE_RADII = { level: Infinity, deck: Infinity }

/**
 * Radii of the circle through three consecutive samples: `level`, the turn a
 * level road feels there, and `deck`, the turn within the banked deck.
 */
const readSampleRadii = ( points, previous, current, next, up, bank, out ) => {
	out.level = out.deck = Infinity
	const pX = points[previous] - points[current]
	const pY = points[previous + 1] - points[current + 1]
	const pZ = points[previous + 2] - points[current + 2]
	const qX = points[next] - points[current]
	const qY = points[next + 1] - points[current + 1]
	const qZ = points[next + 2] - points[current + 2]
	const p2 = pX * pX + pY * pY + pZ * pZ
	const q2 = qX * qX + qY * qY + qZ * qZ
	const chordX = qX - pX
	const chordY = qY - pY
	const chordZ = qZ - pZ
	const chord = Math.hypot( chordX, chordY, chordZ )
	if ( p2 < EPSILON * EPSILON || q2 < EPSILON * EPSILON || chord < EPSILON ) return
	const normalX = pY * qZ - pZ * qY
	const normalY = pZ * qX - pX * qZ
	const normalZ = pX * qY - pY * qX
	const normal2 = normalX * normalX + normalY * normalY + normalZ * normalZ
	if ( Math.sqrt( normal2 ) < EPSILON ) return
	// Circumcentre offset from the middle sample; its inverse length is the curvature.
	const mixX = p2 * qX - q2 * pX
	const mixY = p2 * qY - q2 * pY
	const mixZ = p2 * qZ - q2 * pZ
	const scale = 1 / ( 2 * normal2 )
	const offsetX = ( mixY * normalZ - mixZ * normalY ) * scale
	const offsetY = ( mixZ * normalX - mixX * normalZ ) * scale
	const offsetZ = ( mixX * normalY - mixY * normalX ) * scale
	const offset2 = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ
	SAMPLE_TANGENT[0] = chordX / chord
	SAMPLE_TANGENT[1] = chordY / chord
	SAMPLE_TANGENT[2] = chordZ / chord
	SAMPLE_CURVATURE[0] = offsetX / offset2
	SAMPLE_CURVATURE[1] = offsetY / offset2
	SAMPLE_CURVATURE[2] = offsetZ / offset2
	out.level = lateralRadius( SAMPLE_CURVATURE[0], SAMPLE_CURVATURE[1], SAMPLE_CURVATURE[2], dot( SAMPLE_TANGENT, up ), up, bank )
	out.deck = deckRadius( SAMPLE_TANGENT, SAMPLE_CURVATURE, up, bank )
}

/** Measure the finished samples. `folds` lists the ones where the deck turns on less than `foldRadius`. */
const analyzeSamples = ( points, bank, up, foldRadius ) => {
	const pointCount = points.length / 3
	const folds = []
	let minRadius = Infinity
	let minDeckRadius = Infinity
	let maxTurn = 0
	let maxSegmentLength = 0
	let maxBankStep = 0
	let length = 0
	let minY = Infinity
	let maxY = -Infinity

	for ( let index = 0; index < pointCount; index++ ) {
		minY = Math.min( minY, points[index * 3 + 1] )
		maxY = Math.max( maxY, points[index * 3 + 1] )
		if ( index === 0 ) continue
		const segment = Math.hypot(
			points[index * 3] - points[( index - 1 ) * 3],
			points[index * 3 + 1] - points[( index - 1 ) * 3 + 1],
			points[index * 3 + 2] - points[( index - 1 ) * 3 + 2]
		)
		length += segment
		maxSegmentLength = Math.max( maxSegmentLength, segment )
		maxBankStep = Math.max( maxBankStep, Math.abs( bank[index] - bank[index - 1] ) )
	}

	for ( let index = 1; index < pointCount - 1; index++ ) {
		const previous = ( index - 1 ) * 3
		const current = index * 3
		const next = ( index + 1 ) * 3
		const incomingX = points[current] - points[previous]
		const incomingY = points[current + 1] - points[previous + 1]
		const incomingZ = points[current + 2] - points[previous + 2]
		const outgoingX = points[next] - points[current]
		const outgoingY = points[next + 1] - points[current + 1]
		const outgoingZ = points[next + 2] - points[current + 2]
		const denominator = Math.hypot( incomingX, incomingY, incomingZ ) * Math.hypot( outgoingX, outgoingY, outgoingZ )
		if ( denominator > EPSILON ) {
			maxTurn = Math.max( maxTurn, Math.acos( clamp(
				( incomingX * outgoingX + incomingY * outgoingY + incomingZ * outgoingZ ) / denominator,
				-1,
				1
			) ) )
		}
		readSampleRadii( points, previous, current, next, up, bank[index], SAMPLE_RADII )
		minRadius = Math.min( minRadius, SAMPLE_RADII.level )
		minDeckRadius = Math.min( minDeckRadius, SAMPLE_RADII.deck )
		if ( SAMPLE_RADII.deck < foldRadius ) folds.push( index )
	}

	return { folds, stats: { pointCount, minRadius, minDeckRadius, maxTurn, maxSegmentLength, maxBankStep, length, minY, maxY } }
}

/**
 * Plan a drivable, adaptively tessellated 3D centreline.
 *
 * Each control accepts `{ x, y, z, bank }`; `y` and `bank` default to zero.
 * Bank is in radians and interpolates by travelled distance along the shortest
 * angular route. `up` disambiguates the turn plane of an exact reversal.
 *
 * @param {Array<{x:number,y?:number,z:number,bank?:number,roll?:number}>} controls
 * @param {object} [options]
 * @returns {{points: Float64Array, bank: Float32Array, anchors: Int32Array, controlIndices: Int32Array, corners: Array, stats: object} | null}
 */
export function planRoadPath( controls, options = {} ) {
	const settings = resolveSettings( options )
	const knots = dedupeControls( controls ?? [], settings.dedupeEpsilon )
	const count = knots.length
	if ( count < 2 ) return null

	const { legs, directions: legDirections } = measureLegs( knots )
	const turns = measureTurns( knots, legDirections )
	const shape = {
		knots,
		banks: unwrapBanks( knots ),
		up: settings.up,
		corners: new Array( count ).fill( null ),
		scales: new Float64Array( count ).fill( 1 ),
		tangents: null,
		profiles: resolveKnotProfiles( knots, legDirections, settings.up ),
	}
	shape.tangents = resolveTangentDirections( knots, legDirections, shape.corners )

	// A knot's scale and arc only reshape its two adjacent spans, so regions of
	// difficult knots split by at least one untouched knot are solved alone: an
	// edit can only reshape the region it lands in.
	const scales = shape.scales
	const reports = []
	for ( let index = 0; index < count - 1; index++ ) reports.push( probeSpan( shape, index ) )
	const needsArc = new Uint8Array( count )

	const probeRegion = region => {
		for ( let span = region.first - 1; span <= region.last; span++ ) reports[span] = probeSpan( shape, span )
	}
	const regionPenalty = region => {
		let total = 0
		for ( let span = region.first - 1; span <= region.last; span++ ) total += spanPenalty( reports[span], settings.minRadius )
		for ( let index = region.first; index <= region.last; index++ ) {
			if ( shape.corners[index] ) continue
			const drift = scales[index] - 1
			total += drift * drift * settings.tangentBias
		}
		return total
	}

	const solve = region => {
		probeRegion( region )
		let penalty = regionPenalty( region )
		if ( penalty <= 1e-12 ) return
		const { first, last } = region
		const initialScales = scales.slice( first, last + 1 )
		const initialReports = reports.slice( first - 1, last + 1 )
		let bestShared = { penalty, shared: null }
		for ( let shared = settings.minTangent; shared <= settings.maxTangent + 1e-6; shared += 0.25 ) {
			for ( let index = first; index <= last; index++ ) {
				if ( !shape.corners[index] ) scales[index] = shared
			}
			probeRegion( region )
			const candidate = regionPenalty( region )
			if ( candidate < bestShared.penalty ) bestShared = { penalty: candidate, shared }
		}
		if ( bestShared.shared !== null ) {
			for ( let index = first; index <= last; index++ ) {
				if ( !shape.corners[index] ) scales[index] = bestShared.shared
			}
			probeRegion( region )
			penalty = bestShared.penalty
		} else {
			scales.set( initialScales, first )
			for ( let offset = 0; offset < initialReports.length; offset++ ) reports[first - 1 + offset] = initialReports[offset]
		}

		for ( let iteration = 0; iteration < settings.iterations && penalty > 0; iteration++ ) {
			let improved = false
			for ( let index = first; index <= last; index++ ) {
				if ( shape.corners[index] ) continue
				for ( const factor of SCALE_FACTORS ) {
					const previous = scales[index]
					const candidate = clamp( previous * factor, settings.minTangent, settings.maxTangent )
					if ( Math.abs( candidate - previous ) < 1e-4 ) continue
					const before = [reports[index - 1], reports[index]]
					const previousLocalPenalty = spanPenalty( before[0], settings.minRadius ) +
						spanPenalty( before[1], settings.minRadius ) +
						( previous - 1 ) * ( previous - 1 ) * settings.tangentBias
					scales[index] = candidate
					reports[index - 1] = probeSpan( shape, index - 1 )
					reports[index] = probeSpan( shape, index )
					const candidateLocalPenalty = spanPenalty( reports[index - 1], settings.minRadius ) +
						spanPenalty( reports[index], settings.minRadius ) +
						( candidate - 1 ) * ( candidate - 1 ) * settings.tangentBias
					const next = penalty - previousLocalPenalty + candidateLocalPenalty
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

	const setRegionCorners = ( region, corners ) => {
		for ( let index = region.first; index <= region.last; index++ ) shape.corners[index] = corners[index]
		shape.tangents = resolveTangentDirections( knots, legDirections, shape.corners )
	}
	const worstRadius = region => {
		let worst = Infinity
		for ( let span = region.first - 1; span <= region.last; span++ ) worst = Math.min( worst, reports[span].worst )
		for ( let index = region.first; index <= region.last; index++ ) {
			if ( shape.corners[index] ) worst = Math.min( worst, shape.corners[index].radius )
		}
		return worst
	}
	const sizeCorners = region => {
		let best = null
		for ( const factor of CORNER_FACTORS ) {
			for ( let index = region.first; index <= region.last; index++ ) scales[index] = 1
			setRegionCorners( region, buildRegionCorners( region, knots, legDirections, legs, shape.profiles, needsArc, settings, factor ) )
			solve( region )
			const score = worstRadius( region )
			if ( !best || score > best.score ) {
				best = { score, corners: shape.corners.slice(), scales: scales.slice( region.first, region.last + 1 ) }
			}
			if ( score >= settings.minRadius ) break
		}
		setRegionCorners( region, best.corners )
		scales.set( best.scales, region.first )
		probeRegion( region )
	}

	const solveRegion = region => {
		for ( let index = region.first; index <= region.last; index++ ) {
			scales[index] = 1
			needsArc[index] = 0
			shape.corners[index] = null
		}
		shape.tangents = resolveTangentDirections( knots, legDirections, shape.corners )
		solve( region )
		for ( let round = region.first; round <= region.last; round++ ) {
			let converted = false
			for ( let index = region.first; index <= region.last; index++ ) {
				const reversal = turns[index] >= REVERSAL_TURN
				if ( needsArc[index] || ( !reversal && knotRadius( reports, index ) >= settings.foldRadius ) ) continue
				needsArc[index] = 1
				converted = true
			}
			if ( !converted ) break
			sizeCorners( region )
		}
	}

	// Seed regions from the default shape, then widen one knot at a time only
	// where a solved region still leaves an unsafe span on its border.
	let regions = []
	for ( let index = 1; index < count - 1; index++ ) {
		if (
			turns[index] < REVERSAL_TURN &&
			reports[index - 1].worst >= settings.minRadius &&
			reports[index].worst >= settings.minRadius
		) continue
		const previous = regions[regions.length - 1]
		if ( previous && previous.last === index - 1 ) previous.last = index
		else regions.push( { first: index, last: index, solved: false } )
	}
	while ( regions.length > 0 ) {
		for ( const region of regions ) {
			if ( region.solved ) continue
			solveRegion( region )
			region.solved = true
		}
		let grown = false
		const next = []
		for ( const region of regions ) {
			const first = region.first > 1 && reports[region.first - 1].worst < settings.foldRadius
				? region.first - 1
				: region.first
			const last = region.last < count - 2 && reports[region.last].worst < settings.foldRadius
				? region.last + 1
				: region.last
			const changed = first !== region.first || last !== region.last
			grown ||= changed
			const previous = next[next.length - 1]
			if ( previous && first <= previous.last + 1 ) {
				previous.last = Math.max( previous.last, last )
				previous.solved = false
			} else {
				next.push( changed ? { first, last, solved: false } : region )
			}
		}
		regions = next
		if ( !grown ) break
	}

	// Sample the road one stretch between two controls at a time, so that every
	// control stays an exact sample and an edit re-samples only what it reshapes.
	const rawPoints = []
	const rawAnchors = new Int32Array( count )
	const sampling = { splits: 0, maxDepth: 0, straightSpans: 0 }
	const arcs = shape.corners.map( corner => corner && createArc( corner, settings.up ) )
	let cells = createCells()
	for ( let index = 0; index < count - 1; index++ ) addStretchCells( shape, index, arcs, settings, cells, sampling )
	cells = gradeCells( cells, settings )
	easeSteps( cells, settings )
	const stretches = new Int32Array( count ).fill( cells.step.length )
	for ( let cell = cells.step.length - 1; cell >= 0; cell-- ) stretches[cells.stretch[cell]] = cell
	for ( let index = 0; index < count; index++ ) {
		rawAnchors[index] = appendPoint( rawPoints, knots[index][0], knots[index][1], knots[index][2], settings )
		if ( index < count - 1 ) emitStretch( cells, stretches[index], stretches[index + 1], knots[index + 1], settings, rawPoints )
	}

	const rawBanks = buildSampleBanks( rawPoints, rawAnchors, knots )
	const refined = refineBankSteps( rawPoints, rawBanks, rawAnchors, settings )
	const { folds, stats: sampleStats } = analyzeSamples( refined.points, refined.bank, settings.up, settings.foldRadius * FOLD_MARGIN )
	const corners = []
	for ( let index = 1; index < count - 1; index++ ) {
		const corner = shape.corners[index]
		corners.push( {
			knotIndex: index,
			sampleIndex: refined.anchors[index],
			turn: turns[index],
			radius: corner ? corner.radius : knotRadius( reports, index ),
			arc: !!corner,
			tangentScale: scales[index],
			tight: corner ? corner.tight : knotRadius( reports, index ) < settings.foldRadius,
		} )
	}
	// A banked deck can fold over a crest between two controls, or beside one the
	// map calls smooth. Point at the control nearest to each such fold: the first
	// and last have no corner of their own, so theirs go to the next one in.
	for ( const fold of folds ) {
		let knot = 1
		while ( knot < count - 1 && refined.anchors[knot] <= fold ) knot++
		if ( fold - refined.anchors[knot - 1] < refined.anchors[knot] - fold ) knot--
		const corner = corners[clamp( knot, 1, count - 2 ) - 1]
		if ( corner ) corner.tight = true
	}
	const tightCount = Math.max(
		corners.filter( corner => corner.tight ).length,
		folds.length > 0 || sampleStats.minRadius < settings.foldRadius * FOLD_MARGIN ? 1 : 0
	)

	return {
		points: refined.points,
		bank: refined.bank,
		anchors: refined.anchors,
		controlIndices: Int32Array.from( knots.sourceIndices ),
		corners,
		stats: {
			...sampleStats,
			knotCount: count,
			arcCount: corners.filter( corner => corner.arc ).length,
			tightCount,
			adaptiveSplits: sampling.splits,
			adaptiveDepth: sampling.maxDepth,
			straightSpans: sampling.straightSpans,
		},
	}
}
