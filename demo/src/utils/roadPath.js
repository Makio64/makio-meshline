/**
 * Adaptive 3D road centreline planner.
 *
 * The route passes through every authored XYZ control point. Smooth knots use
 * cubic Hermite spans whose tangents are widened until the requested minimum
 * curvature is met. A knot the cubic cannot make drivable becomes a circular
 * turn in the plane of its incoming and outgoing legs. Exact reversals have no
 * unique plane, so `up` explicitly chooses one.
 *
 * Output tessellation has hard geometric budgets instead of a fixed lookup
 * table: maximum 3D curve length, chord error, tangent turn, and bank delta.
 * Distance UVs therefore see a faithful polyline without oversampling straight
 * spans or leaving long triangles on steep and tightly curved sections.
 *
 * Edits stay local. A smooth knot's tangent is split into a plan direction and
 * a grade: the plan direction ignores height, and the grade is a monotone
 * harmonic mean of the neighbouring legs, so raising one control never dips or
 * bends the road beside it. Tangent widening and arc conversion are solved per
 * region of difficult knots, so a tight bend elsewhere on the route cannot
 * reshape a span the edit never touched.
 */

const EPSILON = 1e-9
const SPAN_PROBES = 32
const SCALE_FACTORS = [1.22, 0.82]
const CORNER_FACTORS = [1, 0.72, 0.5, 0.34]
const REVERSAL_TURN = Math.PI - 1e-4
// Plan/grade tangents fade back to plain 3D tangents on near-vertical legs
// (horizontal run fraction) and on near-reversals in plan view, where a
// horizontal heading stops being meaningful.
const PROFILE_RUN_MIN = 0.2
const PROFILE_RUN_FULL = 0.45
const PROFILE_HEADING_MIN = 0.05
const PROFILE_HEADING_FULL = 0.25

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
			incoming[index] = before ?? after
			outgoing[index] = after ?? before
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
 * Split each smooth knot into a plan heading and the grades of its two legs.
 * The heading only reads horizontal leg directions, so raising a control can
 * never swing the road beside it sideways.
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
		const level = smoothstep( PROFILE_RUN_MIN, PROFILE_RUN_FULL, Math.min( beforeRunLength, afterRunLength ) )
		if ( !( level > 0 ) ) continue

		const headingX = beforeRun[0] / beforeRunLength + afterRun[0] / afterRunLength
		const headingY = beforeRun[1] / beforeRunLength + afterRun[1] / afterRunLength
		const headingZ = beforeRun[2] / beforeRunLength + afterRun[2] / afterRunLength
		const headingLength = Math.hypot( headingX, headingY, headingZ )
		const weight = level * smoothstep( PROFILE_HEADING_MIN, PROFILE_HEADING_FULL, headingLength )
		if ( !( weight > 0 ) ) continue

		profiles[index] = {
			weight,
			heading: [headingX / headingLength, headingY / headingLength, headingZ / headingLength],
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

/** Propose a fixed-radius 3D turn through one authored control point. */
const proposeCorner = ( knots, legDirections, turns, index, settings ) => {
	const before = legDirections[index - 1]
	const after = legDirections[index]
	const turn = turns[index]
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
		const resolvedAxis = reversalAxis( before, settings.up )
		axis[0] = resolvedAxis[0]
		axis[1] = resolvedAxis[1]
		axis[2] = resolvedAxis[2]
		toCentre[0] = -before[0]
		toCentre[1] = -before[1]
		toCentre[2] = -before[2]
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

	return {
		...corner,
		outward,
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
const buildRegionCorners = ( region, knots, legDirections, legs, turns, needsArc, settings, factor = 1 ) => {
	const proposals = new Array( knots.length ).fill( null )
	for ( let index = region.first; index <= region.last; index++ ) {
		if ( !needsArc[index] ) continue
		const proposal = proposeCorner( knots, legDirections, turns, index, settings )
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
 * Turning radius a level road actually feels. Crest and sag curvature bend the
 * ribbon along its length and cannot fold it, so the part of the curvature
 * vector that points along `up` is dropped while the tangent is mostly level.
 * Near-vertical tangents fade back to the full 3D curvature.
 */
const lateralRadius = ( curvatureX, curvatureY, curvatureZ, tangentRise, up ) => {
	const total = curvatureX * curvatureX + curvatureY * curvatureY + curvatureZ * curvatureZ
	const level = 1 - tangentRise * tangentRise
	const weight = smoothstep( PROFILE_RUN_MIN, PROFILE_RUN_FULL, Math.sqrt( Math.max( 0, level ) ) )
	const vertical = curvatureX * up[0] + curvatureY * up[1] + curvatureZ * up[2]
	const lateral = weight > 0 ? Math.max( 0, total - weight * vertical * vertical / level ) : total
	return lateral > EPSILON * EPSILON ? 1 / Math.sqrt( lateral ) : Infinity
}

/** Analytic lateral-curvature report for one cubic span. */
const probeSpan = ( shape, index ) => {
	const curve = createSpanCurve( shape, index )
	const first = [0, 0, 0]
	const second = [0, 0, 0]
	const up = shape.up
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
				up
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

const maxArcStep = ( radius, settings ) => {
	const angleBudget = settings.maxAngle * 0.9
	if ( settings.maxChordError >= radius ) return angleBudget
	const chordAngle = 2 * Math.acos( clamp( 1 - settings.maxChordError / radius, -1, 1 ) )
	return Math.min( angleBudget, chordAngle )
}

/** Emit a circular turn with the authored knot as an exact middle sample. */
const emitCorner = ( corner, settings, points ) => {
	const angle = Math.abs( corner.sweep )
	const steps = Math.max(
		1,
		Math.ceil( corner.radius * angle / settings.spacing ),
		Math.ceil( angle / maxArcStep( corner.radius, settings ) )
	)
	const radial = [0, 0, 0]
	const push = rotation => {
		rotateAroundAxis( corner.outward, corner.axis, rotation, radial )
		appendPoint(
			points,
			corner.centre[0] + radial[0] * corner.radius,
			corner.centre[1] + radial[1] * corner.radius,
			corner.centre[2] + radial[2] * corner.radius,
			settings
		)
	}

	for ( let step = 0; step < steps; step++ ) push( -corner.sweep * ( 1 - step / steps ) )
	const anchor = appendPoint( points, corner.vertex[0], corner.vertex[1], corner.vertex[2], settings )
	for ( let step = 1; step <= steps; step++ ) push( corner.sweep * step / steps )
	return anchor
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

const midpoint = ( a, b ) => [
	( a[0] + b[0] ) * 0.5,
	( a[1] + b[1] ) * 0.5,
	( a[2] + b[2] ) * 0.5,
]

const vectorAngle = ( ax, ay, az, bx, by, bz ) => {
	const lengthA = Math.hypot( ax, ay, az )
	const lengthB = Math.hypot( bx, by, bz )
	if ( lengthA <= EPSILON || lengthB <= EPSILON ) return Math.PI
	const denominator = lengthA * lengthB
	return Math.acos( clamp( ( ax * bx + ay * by + az * bz ) / denominator, -1, 1 ) )
}

const splitBezier = segment => {
	const q0 = midpoint( segment.p0, segment.p1 )
	const q1 = midpoint( segment.p1, segment.p2 )
	const q2 = midpoint( segment.p2, segment.p3 )
	const r0 = midpoint( q0, q1 )
	const r1 = midpoint( q1, q2 )
	const centre = midpoint( r0, r1 )
	return {
		left: { p0: segment.p0, p1: q0, p2: r0, p3: centre },
		right: { p0: centre, p1: r1, p2: q2, p3: segment.p3 },
	}
}

const bezierNeedsSplit = ( segment, halves, settings ) => {
	const controlLength = distance( segment.p0, segment.p1 ) +
		distance( segment.p1, segment.p2 ) + distance( segment.p2, segment.p3 )
	if ( controlLength > settings.spacing * ( 1 + 1e-9 ) ) return true

	const flatness = Math.max(
		pointSegmentDistance( segment.p1, segment.p0, segment.p3 ),
		pointSegmentDistance( segment.p2, segment.p0, segment.p3 )
	)
	if ( flatness > settings.maxChordError ) return true

	const startX = segment.p1[0] - segment.p0[0]
	const startY = segment.p1[1] - segment.p0[1]
	const startZ = segment.p1[2] - segment.p0[2]
	const middleX = halves.left.p3[0] - halves.left.p2[0]
	const middleY = halves.left.p3[1] - halves.left.p2[1]
	const middleZ = halves.left.p3[2] - halves.left.p2[2]
	const endX = segment.p3[0] - segment.p2[0]
	const endY = segment.p3[1] - segment.p2[1]
	const endZ = segment.p3[2] - segment.p2[2]
	const angleBudget = settings.maxAngle * 0.9
	return vectorAngle( startX, startY, startZ, endX, endY, endZ ) > angleBudget ||
		vectorAngle( startX, startY, startZ, middleX, middleY, middleZ ) > angleBudget ||
		vectorAngle( middleX, middleY, middleZ, endX, endY, endZ ) > angleBudget
}

const emitStraightSpanInterior = ( segment, settings, points, sampling ) => {
	const dx = segment.p3[0] - segment.p0[0]
	const dy = segment.p3[1] - segment.p0[1]
	const dz = segment.p3[2] - segment.p0[2]
	const chord = Math.hypot( dx, dy, dz )
	if ( chord <= EPSILON ) return false
	const inverseChord = 1 / chord
	const directionX = dx * inverseChord
	const directionY = dy * inverseChord
	const directionZ = dz * inverseChord
	const projection = point =>
		( point[0] - segment.p0[0] ) * directionX +
		( point[1] - segment.p0[1] ) * directionY +
		( point[2] - segment.p0[2] ) * directionZ
	const first = projection( segment.p1 )
	const second = projection( segment.p2 )
	const tolerance = Math.max( EPSILON * 4, Math.min( settings.maxChordError * 0.01, chord * 1e-8 ) )
	if (
		pointSegmentDistance( segment.p1, segment.p0, segment.p3 ) > tolerance ||
		pointSegmentDistance( segment.p2, segment.p0, segment.p3 ) > tolerance ||
		first < -tolerance || second < first - tolerance || second > chord + tolerance
	) return false

	const segments = Math.max( 1, Math.ceil( chord / settings.spacing ) )
	for ( let segmentIndex = 1; segmentIndex < segments; segmentIndex++ ) {
		const progress = segmentIndex / segments
		appendPoint(
			points,
			segment.p0[0] + dx * progress,
			segment.p0[1] + dy * progress,
			segment.p0[2] + dz * progress,
			settings
		)
	}
	sampling.straightSpans++
	sampling.linearSegments += segments
	return true
}

/** Iteratively emit only the interior points of one cubic span. */
const emitSpanInterior = ( shape, index, settings, points, sampling ) => {
	const curve = createSpanCurve( shape, index )
	const root = {
		p0: curve.start,
		p1: [
			curve.start[0] + curve.startTangent[0] / 3,
			curve.start[1] + curve.startTangent[1] / 3,
			curve.start[2] + curve.startTangent[2] / 3,
		],
		p2: [
			curve.end[0] - curve.endTangent[0] / 3,
			curve.end[1] - curve.endTangent[1] / 3,
			curve.end[2] - curve.endTangent[2] / 3,
		],
		p3: curve.end,
	}
	if ( emitStraightSpanInterior( root, settings, points, sampling ) ) return
	const stack = [{ segment: root, depth: 0, emitEnd: false }]

	while ( stack.length > 0 ) {
		const item = stack.pop()
		const halves = splitBezier( item.segment )
		if ( bezierNeedsSplit( item.segment, halves, settings ) ) {
			if ( item.depth >= settings.maxDepth ) {
				throw new RangeError( `[roadPath] Adaptive tessellation reached maxDepth (${settings.maxDepth}) on span ${index}` )
			}
			sampling.splits++
			sampling.maxDepth = Math.max( sampling.maxDepth, item.depth + 1 )
			stack.push(
				{ segment: halves.right, depth: item.depth + 1, emitEnd: item.emitEnd },
				{ segment: halves.left, depth: item.depth + 1, emitEnd: true },
			)
			continue
		}
		if ( item.emitEnd ) appendPoint( points, item.segment.p3[0], item.segment.p3[1], item.segment.p3[2], settings )
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

/** Lateral radius of the circle through three consecutive samples. */
const sampleLateralRadius = ( points, previous, current, next, up ) => {
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
	if ( p2 < EPSILON * EPSILON || q2 < EPSILON * EPSILON || chord < EPSILON ) return Infinity
	const normalX = pY * qZ - pZ * qY
	const normalY = pZ * qX - pX * qZ
	const normalZ = pX * qY - pY * qX
	const normal2 = normalX * normalX + normalY * normalY + normalZ * normalZ
	if ( Math.sqrt( normal2 ) < EPSILON ) return Infinity
	// Circumcentre offset from the middle sample; its inverse length is the curvature.
	const mixX = p2 * qX - q2 * pX
	const mixY = p2 * qY - q2 * pY
	const mixZ = p2 * qZ - q2 * pZ
	const scale = 1 / ( 2 * normal2 )
	const offsetX = ( mixY * normalZ - mixZ * normalY ) * scale
	const offsetY = ( mixZ * normalX - mixX * normalZ ) * scale
	const offsetZ = ( mixX * normalY - mixY * normalX ) * scale
	const offset2 = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ
	return lateralRadius(
		offsetX / offset2,
		offsetY / offset2,
		offsetZ / offset2,
		( chordX * up[0] + chordY * up[1] + chordZ * up[2] ) / chord,
		up
	)
}

const analyzeSamples = ( points, bank, up ) => {
	const pointCount = points.length / 3
	let minRadius = Infinity
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
		minRadius = Math.min( minRadius, sampleLateralRadius( points, previous, current, next, up ) )
	}

	return { pointCount, minRadius, maxTurn, maxSegmentLength, maxBankStep, length, minY, maxY }
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
			setRegionCorners( region, buildRegionCorners( region, knots, legDirections, legs, turns, needsArc, settings, factor ) )
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

	const rawPoints = []
	const rawAnchors = new Int32Array( count )
	const sampling = { splits: 0, maxDepth: 0, straightSpans: 0, linearSegments: 0 }
	for ( let index = 0; index < count; index++ ) {
		const corner = shape.corners[index]
		if ( corner ) {
			rawAnchors[index] = emitCorner( corner, settings, rawPoints )
		} else {
			rawAnchors[index] = appendPoint( rawPoints, knots[index][0], knots[index][1], knots[index][2], settings )
		}
		if ( index < count - 1 ) emitSpanInterior( shape, index, settings, rawPoints, sampling )
	}

	const rawBanks = buildSampleBanks( rawPoints, rawAnchors, knots )
	const refined = refineBankSteps( rawPoints, rawBanks, rawAnchors, settings )
	const sampleStats = analyzeSamples( refined.points, refined.bank, settings.up )
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
	const tightCount = Math.max(
		corners.filter( corner => corner.tight ).length,
		sampleStats.minRadius < settings.foldRadius * 0.98 ? 1 : 0
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
			linearSegments: sampling.linearSegments,
		},
	}
}
