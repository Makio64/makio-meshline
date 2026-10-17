import assert from 'node:assert/strict'
import test from 'node:test'

import { planRoadPath } from '../demo/src/utils/roadPath.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const ROAD_WIDTH = 6
const HALF = ROAD_WIDTH / 2
const TWO_PI = Math.PI * 2
const OPTIONS = {
	spacing: 0.45,
	maxAngle: Math.PI / 36,
	maxChordError: 0.015,
	maxBankAngle: Math.PI / 48,
	dedupeEpsilon: 1e-5,
	minRadius: HALF * 1.35,
	foldRadius: HALF * 1.05,
	up: [0, 1, 0],
}

const mulberry = seed => () => {
	seed |= 0
	seed = seed + 0x6D2B79F5 | 0
	let t = Math.imul( seed ^ seed >>> 15, 1 | seed )
	t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t
	return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296
}

const gentleRoad = () => Array.from( { length: 8 }, ( _, index ) => {
	const progress = index / 7
	return {
		x: ( progress - 0.5 ) * 70,
		y: Math.sin( progress * Math.PI * 3 ) * 6,
		z: Math.sin( progress * Math.PI * 2 ) * 13 + Math.sin( progress * Math.PI * 5 ) * 3.5,
		bank: Math.sin( progress * Math.PI * 2 ) * 0.6,
	}
} )

const LAYOUTS = {
	gentle: gentleRoad(),
	rightAngles: [
		{ x: -22, y: 0, z: -16, bank: 0 },
		{ x: 0, y: 4, z: -16, bank: 0.2 },
		{ x: 0, y: 8, z: 6, bank: -0.3 },
		{ x: 22, y: 2, z: 6, bank: 0.4 },
		{ x: 22, y: 10, z: 26, bank: 0 },
	],
	hairpin: [
		{ x: -24, y: 0, z: 0, bank: 0 },
		{ x: 0, y: 5, z: 0, bank: 0.4 },
		{ x: 0.6, y: 9, z: 14, bank: -0.4 },
		{ x: -23, y: 13, z: 14.6, bank: 0 },
	],
	reversal: [
		{ x: -20, y: 0, z: 0, bank: 0 },
		{ x: 0, y: 0, z: 0, bank: 3 },
		{ x: -19, y: 0, z: 0.8, bank: -3 },
		{ x: -19, y: 8, z: 18, bank: 0 },
	],
	slalom: Array.from( { length: 9 }, ( _, index ) => ( {
		x: -32 + index * 8,
		y: index % 3 * 3,
		z: index % 2 === 0 ? -8 : 8,
		bank: index % 2 === 0 ? -0.35 : 0.35,
	} ) ),
	crowded: [
		{ x: -14, y: 0, z: 0, bank: 0 },
		{ x: 0, y: 1, z: 0, bank: 0.2 },
		{ x: 2.2, y: 2, z: 3, bank: -0.2 },
		{ x: -0.6, y: 3, z: 6, bank: 0.3 },
		{ x: 14, y: 4, z: 8, bank: 0 },
	],
	duplicate: [
		{ x: -14, y: 0, z: 0, bank: 0 },
		{ x: 0, y: 2, z: 0, bank: 0.2 },
		{ x: 0.000001, y: 2, z: 0, bank: -0.4 },
		{ x: 14, y: 5, z: 4, bank: 0 },
	],
	pair: [
		{ x: -12, y: -4, z: -4, bank: -0.3 },
		{ x: 13, y: 7, z: 7, bank: 0.5 },
	],
}

for ( let seed = 0; seed < 20; seed++ ) {
	const random = mulberry( seed * 7919 + 13 )
	const count = 3 + Math.floor( random() * 8 )
	LAYOUTS[`random-${seed}`] = Array.from( { length: count }, () => ( {
		x: ( random() - 0.5 ) * 80,
		y: ( random() - 0.5 ) * 24,
		z: ( random() - 0.5 ) * 60,
		bank: ( random() - 0.5 ) * 1.6,
	} ) )
}

const controlBank = control => control.bank ?? control.roll ?? 0

const dedupe = controls => {
	const cleaned = []
	for ( const control of controls ) {
		const x = control?.x
		const y = control?.y ?? 0
		const z = control?.z
		if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) continue
		const previous = cleaned[cleaned.length - 1]
		if ( previous && Math.hypot( x - previous.x, y - previous.y, z - previous.z ) <= OPTIONS.dedupeEpsilon ) continue
		cleaned.push( control )
	}
	return cleaned
}

const pointDistance = ( points, first, second ) => Math.hypot(
	points[second * 3] - points[first * 3],
	points[second * 3 + 1] - points[first * 3 + 1],
	points[second * 3 + 2] - points[first * 3 + 2]
)

const angleError = ( first, second ) => {
	const wrapped = ( first - second + Math.PI ) % TWO_PI
	return Math.abs( ( wrapped < 0 ? wrapped + TWO_PI : wrapped ) - Math.PI )
}

const assertApprox = ( actual, expected, tolerance, message ) => {
	assert.ok( Math.abs( actual - expected ) <= tolerance, `${message}: expected ${expected}, saw ${actual}` )
}

const buildSurface = ( plan, up = OPTIONS.up ) => new MeshLineSurfaceGeometry( {
	lines: Float32Array.from( plan.points ),
	lineWidth: ROAD_WIDTH,
	needsUV: true,
	needsTangents: true,
	surface: {
		frame: 'fixed-up',
		up,
		bank: plan.bank,
		uvMode: 'distance',
		uvScale: 1,
	},
	join: { type: 'miter', limit: 2, segments: 12, inner: 'clip' },
	cap: { type: 'butt' },
} )

const assertStrictSamplingBudgets = ( plan, label ) => {
	assert.ok( plan.points instanceof Float64Array, `${label} points are not Float64Array` )
	assert.ok( plan.bank instanceof Float32Array, `${label} bank is not Float32Array` )
	assert.ok( plan.anchors instanceof Int32Array, `${label} anchors are not Int32Array` )
	assert.ok( plan.controlIndices instanceof Int32Array, `${label} control indices are not Int32Array` )
	assert.equal( plan.controlIndices.length, plan.anchors.length, `${label} control-index count does not match anchors` )
	assert.equal( plan.points.length % 3, 0, `${label} points are not XYZ triples` )
	assert.equal( plan.bank.length, plan.points.length / 3, `${label} bank count does not match points` )

	let maxSegmentLength = 0
	let maxBankStep = 0
	for ( let index = 1; index < plan.bank.length; index++ ) {
		const segmentLength = pointDistance( plan.points, index - 1, index )
		const bankStep = Math.abs( plan.bank[index] - plan.bank[index - 1] )
		assert.ok( Number.isFinite( segmentLength ) && segmentLength > 1e-7, `${label} emitted a degenerate segment at ${index}` )
		assert.ok( segmentLength <= OPTIONS.spacing + 1e-8, `${label} segment ${index} is ${segmentLength}, above spacing` )
		assert.ok( bankStep <= OPTIONS.maxBankAngle + 1e-6, `${label} bank step ${index} is ${bankStep}, above budget` )
		maxSegmentLength = Math.max( maxSegmentLength, segmentLength )
		maxBankStep = Math.max( maxBankStep, bankStep )
	}

	assertApprox( plan.stats.maxSegmentLength, maxSegmentLength, 1e-12, `${label} max segment stat` )
	assertApprox( plan.stats.maxBankStep, maxBankStep, 1e-12, `${label} max bank stat` )
}

const assertValidSurface = ( geometry, label ) => {
	for ( const name of ['position', 'normal', 'tangent', 'uv'] ) {
		const attribute = geometry.getAttribute( name )
		assert.ok( attribute, `${label} is missing ${name}` )
		for ( const value of attribute.array ) assert.ok( Number.isFinite( value ), `${label} has non-finite ${name}` )
	}

	const position = geometry.getAttribute( 'position' ).array
	const normal = geometry.getAttribute( 'normal' ).array
	const indices = geometry.getIndex().array
	for ( const vertex of indices ) assert.ok( vertex >= 0 && vertex * 3 + 2 < position.length, `${label} has an invalid index` )

	for ( let offset = 0; offset < indices.length; offset += 3 ) {
		const a = indices[offset] * 3
		const b = indices[offset + 1] * 3
		const c = indices[offset + 2] * 3
		const abX = position[b] - position[a]
		const abY = position[b + 1] - position[a + 1]
		const abZ = position[b + 2] - position[a + 2]
		const acX = position[c] - position[a]
		const acY = position[c + 1] - position[a + 1]
		const acZ = position[c + 2] - position[a + 2]
		const crossX = abY * acZ - abZ * acY
		const crossY = abZ * acX - abX * acZ
		const crossZ = abX * acY - abY * acX
		const doubleArea = Math.hypot( crossX, crossY, crossZ )
		assert.ok( doubleArea > 1e-8, `${label} has a degenerate triangle at ${offset / 3}` )

		const normalX = normal[a] + normal[b] + normal[c]
		const normalY = normal[a + 1] + normal[b + 1] + normal[c + 1]
		const normalZ = normal[a + 2] + normal[b + 2] + normal[c + 2]
		const facing = crossX * normalX + crossY * normalY + crossZ * normalZ
		assert.ok( facing > 0, `${label} has reversed winding at triangle ${offset / 3}` )
	}

	assert.ok( geometry.boundingSphere && Number.isFinite( geometry.boundingSphere.radius ), `${label} has invalid bounds` )
}

test( 'the planned road preserves every authored XYZ and bank anchor', () => {
	for ( const [name, controls] of Object.entries( LAYOUTS ) ) {
		const plan = planRoadPath( controls, OPTIONS )
		assert.ok( plan, `${name} produced no plan` )
		const knots = dedupe( controls )
		assert.equal( plan.anchors.length, knots.length, `${name} lost a control point` )

		for ( let index = 0; index < knots.length; index++ ) {
			const anchor = plan.anchors[index]
			if ( index === 0 ) assert.equal( anchor, 0, `${name} does not begin at its first anchor` )
			else assert.ok( anchor > plan.anchors[index - 1], `${name} anchors are out of order` )
			assertApprox( plan.points[anchor * 3], knots[index].x, 1e-9, `${name} anchor ${index} x` )
			assertApprox( plan.points[anchor * 3 + 1], knots[index].y ?? 0, 1e-9, `${name} anchor ${index} y` )
			assertApprox( plan.points[anchor * 3 + 2], knots[index].z, 1e-9, `${name} anchor ${index} z` )
			assert.ok( angleError( plan.bank[anchor], controlBank( knots[index] ) ) < 1e-6, `${name} misses bank anchor ${index}` )
		}

		for ( const corner of plan.corners ) {
			assert.equal( corner.sampleIndex, plan.anchors[corner.knotIndex], `${name} corner sample is not its authored anchor` )
		}
	}
} )

test( 'adaptive samples obey strict 3D spacing and bank-step budgets', () => {
	for ( const [name, controls] of Object.entries( LAYOUTS ) ) {
		assertStrictSamplingBudgets( planRoadPath( controls, OPTIONS ), name )
	}
} )

test( 'straight 34m and 80m spans emit exactly the spacing row minimum', () => {
	const direction = [2 / 3, -1 / 3, 2 / 3]
	const start = [5, -2, 4]
	for ( const length of [34, 80] ) {
		const plan = planRoadPath( [
			{ x: start[0], y: start[1], z: start[2], bank: 0.2 },
			{
				x: start[0] + direction[0] * length,
				y: start[1] + direction[1] * length,
				z: start[2] + direction[2] * length,
				bank: 0.2,
			},
		], OPTIONS )
		const expectedRows = Math.ceil( length / OPTIONS.spacing ) + 1
		const label = `${length}m straight span`

		assert.equal( plan.stats.pointCount, expectedRows, `${label} was over- or under-tessellated` )
		assert.deepEqual( Array.from( plan.anchors ), [0, expectedRows - 1], `${label} anchors do not bound the rows` )
		assert.equal( plan.stats.adaptiveSplits, 0, `${label} entered adaptive curve subdivision` )
		assert.equal( plan.stats.adaptiveDepth, 0, `${label} consumed adaptive depth` )
		assert.ok( plan.stats.maxTurn <= OPTIONS.maxAngle + 1e-9, `${label} exceeded the turn budget` )
		assertStrictSamplingBudgets( plan, label )

		const geometry = buildSurface( plan )
		assert.equal( geometry._lineRanges[0].rowCount, expectedRows, `${label} changed row count while building` )
		assert.equal( geometry.getAttribute( 'position' ).count, expectedRows * 2, `${label} did not build one vertex pair per row` )
		assertValidSurface( geometry, label )
		geometry.dispose()
	}
} )

test( 'height-only controls remain distinct and build a vertical banked road', () => {
	const controls = [
		{ x: 0, y: 0, z: 0, bank: 0 },
		{ x: 0, y: 8, z: 0, bank: 0.5 },
		{ x: 0, y: 16, z: 0, bank: 1 },
	]
	const up = [0, 0, 1]
	const plan = planRoadPath( controls, { ...OPTIONS, up } )

	assert.equal( plan.anchors.length, controls.length )
	assert.equal( plan.stats.minY, 0 )
	assert.equal( plan.stats.maxY, 16 )
	assertStrictSamplingBudgets( plan, 'height-only' )
	const geometry = buildSurface( plan, up )
	assertValidSurface( geometry, 'height-only' )
	geometry.dispose()
} )

test( 'planning is invariant under rigid rotation and translation', () => {
	const controls = [
		{ x: -18, y: 0, z: -4, bank: -0.2 },
		{ x: -4, y: 7, z: 8, bank: 0.4 },
		{ x: 12, y: -2, z: 13, bank: -0.3 },
		{ x: 25, y: 9, z: -1, bank: 0.6 },
	]
	const axisLength = Math.hypot( 0.3, 0.7, 0.2 )
	const axis = [0.3 / axisLength, 0.7 / axisLength, 0.2 / axisLength]
	const angle = 1.137
	const translation = [10, -3, 5]
	const rotate = vector => {
		const cosine = Math.cos( angle )
		const sine = Math.sin( angle )
		const projection = ( axis[0] * vector[0] + axis[1] * vector[1] + axis[2] * vector[2] ) * ( 1 - cosine )
		return [
			vector[0] * cosine + ( axis[1] * vector[2] - axis[2] * vector[1] ) * sine + axis[0] * projection,
			vector[1] * cosine + ( axis[2] * vector[0] - axis[0] * vector[2] ) * sine + axis[1] * projection,
			vector[2] * cosine + ( axis[0] * vector[1] - axis[1] * vector[0] ) * sine + axis[2] * projection,
		]
	}
	const transformed = controls.map( control => {
		const point = rotate( [control.x, control.y, control.z] )
		return {
			x: point[0] + translation[0],
			y: point[1] + translation[1],
			z: point[2] + translation[2],
			bank: control.bank,
		}
	} )
	const rotatedUp = rotate( OPTIONS.up )
	const plan = planRoadPath( controls, OPTIONS )
	const transformedPlan = planRoadPath( transformed, { ...OPTIONS, up: rotatedUp } )

	assert.deepEqual( Array.from( transformedPlan.anchors ), Array.from( plan.anchors ) )
	assert.equal( transformedPlan.points.length, plan.points.length )
	assert.deepEqual( transformedPlan.corners.map( corner => corner.arc ), plan.corners.map( corner => corner.arc ) )
	for ( let index = 0; index < plan.bank.length; index++ ) {
		const expected = rotate( [plan.points[index * 3], plan.points[index * 3 + 1], plan.points[index * 3 + 2]] )
		assertApprox( transformedPlan.points[index * 3], expected[0] + translation[0], 1e-9, `rotated point ${index} x` )
		assertApprox( transformedPlan.points[index * 3 + 1], expected[1] + translation[1], 1e-9, `rotated point ${index} y` )
		assertApprox( transformedPlan.points[index * 3 + 2], expected[2] + translation[2], 1e-9, `rotated point ${index} z` )
		assert.equal( transformedPlan.bank[index], plan.bank[index], `rotated bank ${index}` )
	}
	for ( const key of ['length', 'minRadius', 'maxTurn', 'maxSegmentLength', 'maxBankStep'] ) {
		assertApprox( transformedPlan.stats[key], plan.stats[key], 1e-8, `rotation-invariant ${key}` )
	}
	for ( let index = 0; index < plan.corners.length; index++ ) {
		assertApprox( transformedPlan.corners[index].radius, plan.corners[index].radius, 1e-8, `rotated corner ${index} radius` )
		assertApprox( transformedPlan.corners[index].turn, plan.corners[index].turn, 1e-8, `rotated corner ${index} turn` )
	}

	const geometry = buildSurface( transformedPlan, rotatedUp )
	assertValidSurface( geometry, 'rigidly transformed' )
	geometry.dispose()
} )

test( 'smooth corners keep the centreline clear of the ribbon fold radius', () => {
	for ( const [name, controls] of Object.entries( LAYOUTS ) ) {
		const plan = planRoadPath( controls, OPTIONS )
		for ( const corner of plan.corners ) {
			if ( corner.arc ) continue
			assert.ok(
				corner.radius >= OPTIONS.foldRadius,
				`${name} left corner ${corner.knotIndex} at radius ${corner.radius}, below the ${OPTIONS.foldRadius} fold radius`
			)
		}
	}
} )

test( 'a banked road can be built across the full practical turn-angle range', () => {
	const degreesToTest = [...Array.from( { length: 34 }, ( _, index ) => 10 + index * 5 ), 179.9]
	for ( const degrees of degreesToTest ) {
		for ( const leg of [14, 22, 40] ) {
			const turn = degrees * Math.PI / 180
			const controls = [
				{ x: -leg, y: 0, z: 0, bank: 0 },
				{ x: 0, y: 0, z: 0, bank: 0.4 },
				{ x: Math.cos( turn ) * leg, y: 0, z: Math.sin( turn ) * leg, bank: -0.3 },
			]
			const label = `${degrees.toFixed( 1 )}° with ${leg} legs`
			const plan = planRoadPath( controls, OPTIONS )
			assert.ok( plan, `${label} produced no plan` )
			assertStrictSamplingBudgets( plan, label )
			const anchor = plan.anchors[1]
			assert.ok( Math.hypot( plan.points[anchor * 3], plan.points[anchor * 3 + 1], plan.points[anchor * 3 + 2] ) < 1e-9, `${label} misses its corner` )
			assert.ok( plan.stats.maxTurn <= OPTIONS.maxAngle * 1.15, `${label} leaves an excessive sampled kink` )
			if ( leg >= 22 && degrees <= 175 ) {
				assert.ok( plan.stats.minRadius >= OPTIONS.foldRadius, `${label} came out below the fold radius` )
			}

			const geometry = buildSurface( plan )
			assertValidSurface( geometry, label )
			geometry.dispose()
		}
	}
} )

test( 'an exact 3D reversal uses the preferred-up turn plane instead of a cusp', () => {
	const controls = [
		{ x: -20, y: -4, z: 0, bank: 0 },
		{ x: 0, y: 4, z: 0, bank: 0.5 },
		{ x: -20, y: -4, z: 0, bank: -0.5 },
	]
	const plan = planRoadPath( controls, OPTIONS )

	assert.equal( plan.stats.arcCount, 1 )
	assert.equal( plan.corners[0].arc, true )
	assert.ok( plan.stats.maxTurn <= OPTIONS.maxAngle, 'exact reversal left a sampled cusp' )
	assertStrictSamplingBudgets( plan, 'exact reversal' )
	const geometry = buildSurface( plan )
	assertValidSurface( geometry, 'exact reversal' )
	geometry.dispose()
} )

test( 'a 1cm exact 3D reversal stays inside turn and adaptive-depth budgets', () => {
	const leg = 0.01
	const direction = [2 / 3, 1 / 3, 2 / 3]
	const endpoint = {
		x: -direction[0] * leg,
		y: -direction[1] * leg,
		z: -direction[2] * leg,
	}
	const maxDepth = 8
	const plan = planRoadPath( [
		{ ...endpoint, bank: 0 },
		{ x: 0, y: 0, z: 0, bank: 0.05 },
		{ ...endpoint, bank: -0.05 },
	], { ...OPTIONS, maxDepth } )

	assert.ok( plan, '1cm exact reversal produced no plan' )
	assert.equal( plan.stats.arcCount, 1 )
	assert.equal( plan.corners[0].arc, true )
	assert.ok( plan.stats.adaptiveDepth < maxDepth, `1cm reversal exhausted maxDepth ${maxDepth}` )
	assert.ok( plan.stats.maxTurn <= OPTIONS.maxAngle + 1e-9, `1cm reversal exceeded the ${OPTIONS.maxAngle} turn budget` )
	assertStrictSamplingBudgets( plan, '1cm exact reversal' )
} )

test( 'steep, multi-level, and near-reversal roads keep valid level surfaces', () => {
	const cases = {
		steep: [
			{ x: -18, y: 0, z: 0, bank: -0.2 },
			{ x: -8, y: 12, z: 1, bank: 0.35 },
			{ x: 4, y: -3, z: 9, bank: -0.45 },
			{ x: 18, y: 14, z: 3, bank: 0.25 },
		],
		multiLevel: [
			{ x: -18, y: 0, z: -12, bank: 0 },
			{ x: 0, y: 0, z: 0, bank: 0.15 },
			{ x: 18, y: 0, z: 12, bank: 0 },
			{ x: 18, y: 8, z: -12, bank: -0.2 },
			{ x: 0, y: 9, z: 0, bank: 0.3 },
			{ x: -18, y: 9, z: 12, bank: 0 },
		],
		nearReversal: [
			{ x: -28, y: 4, z: 0, bank: 0 },
			{ x: 0, y: 4, z: 0, bank: 0.3 },
			{ x: -27.99, y: 4, z: 0.2, bank: -0.3 },
			{ x: -28, y: 12, z: 20, bank: 0 },
		],
	}

	for ( const [name, controls] of Object.entries( cases ) ) {
		const plan = planRoadPath( controls, OPTIONS )
		assert.ok( plan.stats.maxY - plan.stats.minY >= 8, `${name} lost its vertical extent` )
		assertStrictSamplingBudgets( plan, name )
		const geometry = buildSurface( plan )
		assertValidSurface( geometry, name )
		geometry.dispose()
	}
} )

test( 'every deterministic and seeded layout builds a valid level surface', () => {
	for ( const [name, controls] of Object.entries( LAYOUTS ) ) {
		const plan = planRoadPath( controls, OPTIONS )
		const geometry = buildSurface( plan )
		assertValidSurface( geometry, name )
		geometry.dispose()
	}
} )

test( 'dragging a control through XYZ and bank re-plans without invalid geometry', () => {
	const controls = gentleRoad()
	for ( let step = 0; step < 220; step++ ) {
		const angle = step / 220 * Math.PI * 2
		controls[3].x = Math.cos( angle ) * 26
		controls[3].y = Math.sin( angle * 2 ) * 9
		controls[3].z = Math.sin( angle ) * 22
		controls[3].bank = Math.sin( angle * 3 ) * 1.1
		const label = `drag step ${step}`
		const plan = planRoadPath( controls, OPTIONS )
		assert.ok( plan, `${label} produced no plan` )
		assertStrictSamplingBudgets( plan, label )
		const geometry = buildSurface( plan )
		assertValidSurface( geometry, label )
		geometry.dispose()
	}
} )

// Largest distance from a sample of span `span` in `after` to the same span's polyline in `before`.
const spanDeviation = ( before, after, span, axes = [0, 1, 2] ) => {
	const component = ( points, index, axis ) => axes.includes( axis ) ? points[index * 3 + axis] : 0
	let worst = 0
	for ( let index = after.anchors[span]; index <= after.anchors[span + 1]; index++ ) {
		const point = [0, 1, 2].map( axis => component( after.points, index, axis ) )
		let nearest = Infinity
		for ( let row = before.anchors[span]; row < before.anchors[span + 1]; row++ ) {
			const start = [0, 1, 2].map( axis => component( before.points, row, axis ) )
			const end = [0, 1, 2].map( axis => component( before.points, row + 1, axis ) )
			const delta = end.map( ( value, axis ) => value - start[axis] )
			const offset = point.map( ( value, axis ) => value - start[axis] )
			const lengthSquared = delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]
			const t = lengthSquared > 0
				? Math.max( 0, Math.min( 1, ( offset[0] * delta[0] + offset[1] * delta[1] + offset[2] * delta[2] ) / lengthSquared ) )
				: 0
			nearest = Math.min( nearest, Math.hypot( offset[0] - delta[0] * t, offset[1] - delta[1] * t, offset[2] - delta[2] * t ) )
		}
		worst = Math.max( worst, nearest )
	}
	return worst
}

test( 'moving one control only reshapes the spans around it', () => {
	const base = gentleRoad()
	const plan = planRoadPath( base, OPTIONS )
	for ( let moved = 0; moved < base.length; moved++ ) {
		for ( const [axis, delta] of [['x', 3], ['x', -3], ['y', 4], ['y', -4], ['z', 3], ['z', -3]] ) {
			const controls = gentleRoad()
			controls[moved][axis] += delta
			const edited = planRoadPath( controls, OPTIONS )
			const label = `moving control ${moved} by ${delta} in ${axis}`

			// The cubic itself reaches two spans back and one forward; a knot whose
			// widening or arc changed reshapes only its own two spans.
			const reshaped = new Set( [moved - 2, moved - 1, moved, moved + 1] )
			for ( let index = 0; index < plan.corners.length; index++ ) {
				const before = plan.corners[index]
				const after = edited.corners[index]
				if ( before.arc === after.arc && Math.abs( before.tangentScale - after.tangentScale ) < 1e-12 ) continue
				assert.ok( Math.abs( after.knotIndex - moved ) <= 2, `${label} re-solved distant knot ${after.knotIndex}` )
				reshaped.add( after.knotIndex - 1 ).add( after.knotIndex )
			}
			for ( let span = 0; span < plan.anchors.length - 1; span++ ) {
				if ( reshaped.has( span ) ) continue
				assert.ok( spanDeviation( plan, edited, span ) < 1e-9, `${label} reshaped distant span ${span}` )
			}
		}
	}
} )

test( 'raising a control never dips, overshoots, or swings the road beside it', () => {
	const flat = Array.from( { length: 7 }, ( _, index ) => ( { x: index * 14, y: 0, z: Math.sin( index * 0.9 ) * 6, bank: 0 } ) )
	const flatPlan = planRoadPath( flat, OPTIONS )
	for ( const rise of [2, 6, 10] ) {
		const raised = flat.map( control => ( { ...control } ) )
		raised[3].y = rise
		const plan = planRoadPath( raised, OPTIONS )
		for ( let index = 0; index < plan.points.length / 3; index++ ) {
			const y = plan.points[index * 3 + 1]
			assert.ok( y >= -1e-9 && y <= rise + 1e-9, `${rise}m rise left the profile at ${y}` )
		}
		for ( let span = 0; span < plan.anchors.length - 1; span++ ) {
			const planView = spanDeviation( flatPlan, plan, span, [0, 2] )
			assert.ok( planView < OPTIONS.maxChordError * 2, `${rise}m rise moved span ${span} ${planView}m sideways` )
			if ( span === 2 || span === 3 ) continue
			assert.ok( spanDeviation( flatPlan, plan, span ) < 1e-9, `${rise}m rise reshaped untouched span ${span}` )
		}
	}

	const base = gentleRoad()
	const basePlan = planRoadPath( base, OPTIONS )
	for ( let moved = 0; moved < base.length; moved++ ) {
		const controls = gentleRoad()
		controls[moved].y += 4
		const plan = planRoadPath( controls, OPTIONS )
		for ( let span = 0; span < basePlan.anchors.length - 1; span++ ) {
			const planView = spanDeviation( basePlan, plan, span, [0, 2] )
			assert.ok( planView < OPTIONS.maxChordError * 2, `raising control ${moved} moved span ${span} ${planView}m sideways` )
		}
	}
} )

test( 'tight bends in one stretch never reshape another stretch of the road', () => {
	const zigzag = () => [
		{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 6 }, { x: 20, y: 0, z: -1.8 }, { x: 30, y: 0, z: 5.4 },
		{ x: 54, y: 0, z: 8 }, { x: 80, y: 0, z: 6 },
		{ x: 104, y: 0, z: 2 }, { x: 114, y: 0, z: 8 }, { x: 124, y: 0, z: 0.2 }, { x: 134, y: 0, z: 7.4 },
	]
	const plan = planRoadPath( zigzag(), OPTIONS )
	assert.equal( plan.stats.tightCount, 0 )
	const widened = plan.corners.filter( corner => Math.abs( corner.tangentScale - 1 ) > 1e-6 ).map( corner => corner.knotIndex )
	assert.ok( widened.includes( 1 ) && widened.includes( 7 ), `both stretches should need wider tangents, saw ${widened}` )
	assert.ok( !widened.includes( 4 ) && !widened.includes( 5 ), `the gentle middle was widened to suit distant bends: ${widened}` )

	for ( const moved of [1, 2, 3] ) {
		const controls = zigzag()
		controls[moved].z += 1
		const edited = planRoadPath( controls, OPTIONS )
		for ( let span = 5; span < plan.anchors.length - 1; span++ ) {
			assert.ok( spanDeviation( plan, edited, span ) < 1e-9, `editing control ${moved} reshaped far span ${span}` )
		}
	}
} )

test( 'two-point roads work while degenerate or invalid input is rejected', () => {
	const plan = planRoadPath( LAYOUTS.pair, OPTIONS )
	assert.equal( plan.corners.length, 0 )
	assert.equal( plan.stats.arcCount, 0 )
	assertStrictSamplingBudgets( plan, 'two-point' )
	assert.deepEqual(
		Array.from( planRoadPath( LAYOUTS.duplicate, OPTIONS ).controlIndices ),
		[0, 1, 3],
		'deduplicated anchors lost their authored control mapping'
	)

	assert.equal( planRoadPath( [], OPTIONS ), null )
	assert.equal( planRoadPath( [{ x: 1, y: 1, z: 1 }], OPTIONS ), null )
	assert.equal( planRoadPath( [{ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }], OPTIONS ), null )
	assert.equal( planRoadPath( [{ x: NaN, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }], OPTIONS ), null )
	assert.ok( planRoadPath( [{ x: 1, y: 0, z: 1 }, { x: 1, y: 4, z: 1 }], OPTIONS ), 'height-only points were deduplicated' )
	assert.throws( () => planRoadPath( [{ x: 0, z: 0 }, { x: 4, z: 0, bank: NaN }], OPTIONS ), /bank must be finite/ )
	assert.throws( () => planRoadPath( LAYOUTS.pair, { ...OPTIONS, spacing: 0 } ), /spacing must be greater than zero/ )
	assert.throws( () => planRoadPath( LAYOUTS.pair, { ...OPTIONS, up: [0, 0, 0] } ), /up must be a finite, non-zero 3D vector/ )
} )

test( 'option defaults survive undefined adaptive overrides', () => {
	const plan = planRoadPath( gentleRoad(), {
		spacing: undefined,
		maxAngle: undefined,
		maxChordError: undefined,
		maxBankAngle: undefined,
		dedupeEpsilon: undefined,
		up: undefined,
	} )
	assert.ok( plan.stats.pointCount > 0 )
	assert.ok( Number.isFinite( plan.stats.maxTurn ) )
	assert.ok( Number.isFinite( plan.stats.length ) )
} )
