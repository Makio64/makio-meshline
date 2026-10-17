import assert from 'node:assert/strict'
import test from 'node:test'

import {
	fitRoadControlsToSurface,
	measureRoadSurfaceClearance,
	spreadRoadClearanceToControls,
} from '../demo/src/utils/roadClearance.js'
import { planRoadPath } from '../demo/src/utils/roadPath.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const ROAD_WIDTH = 6
const VERGE_WIDTH = 0.7
const RIBBON_WIDTH = ROAD_WIDTH + VERGE_WIDTH * 2
const SPACING = 0.45
const ROAD_LIFT = 0.08
const MAX_TURN_STEP = Math.PI / 45
const MAX_BANK_STEP = Math.PI / 45
const MAX_CHORD_ERROR = 0.02
const TERRAIN_FIT_PASSES = 5
const CLEARANCE_TOLERANCE = 1e-4

const terrainHeight = ( x, z ) =>
	Math.sin( x * 0.034 ) * 1.1 +
	Math.cos( z * 0.041 ) * 0.8 +
	Math.sin( ( x + z * 0.6 ) * 0.019 ) * 0.7

const createControl = ( x, z, clearance = 0, bank = 0 ) => ( {
	x,
	y: terrainHeight( x, z ) + ROAD_LIFT + clearance,
	z,
	bank,
} )

const elevatedControls = () => [
	createControl( -40, 2, 0, 0 ),
	createControl( -18, 1, 0, 0 ),
	createControl( 4, 0, 0.4, 0.04 ),
	createControl( 22, 10, 3, 0.12 ),
	createControl( 14, 27, 6, 0.14 ),
	createControl( -6, 21, 8.5, 0.1 ),
	createControl( -9, 0, 9, 0 ),
	createControl( -5, -20, 5, -0.06 ),
	createControl( 10, -29, 1, 0 ),
]

const half = RIBBON_WIDTH * 0.5
const PLAN_OPTIONS = {
	spacing: SPACING,
	maxAngle: MAX_TURN_STEP,
	maxChordError: MAX_CHORD_ERROR,
	maxBankAngle: MAX_BANK_STEP,
	minRadius: half * 1.5,
	foldRadius: half * 1.05,
}

const buildRoadSurface = plan => new MeshLineSurfaceGeometry( {
	lines: Float32Array.from( plan.points ),
	lineWidth: RIBBON_WIDTH,
	needsProgress: true,
	surface: {
		frame: 'fixed-up',
		up: [0, 1, 0],
		bank: plan.bank,
		uvMode: 'distance',
		uvScale: 1,
	},
	join: { type: 'miter', limit: 2, segments: 12, inner: 'clip' },
	cap: { type: 'butt' },
} )

const inspectRoadSurface = plan => {
	const geometry = buildRoadSurface( plan )
	try {
		return measureRoadSurfaceClearance( plan.points, geometry, terrainHeight, ROAD_LIFT )
	} finally {
		geometry.dispose()
	}
}

const assertPlanBudgets = plan => {
	let measuredMaxSegment = 0
	let measuredMaxTurn = 0
	let measuredMaxBank = 0
	for ( let index = 1; index < plan.bank.length; index++ ) {
		const previous = ( index - 1 ) * 3
		const current = index * 3
		const incomingX = plan.points[current] - plan.points[previous]
		const incomingY = plan.points[current + 1] - plan.points[previous + 1]
		const incomingZ = plan.points[current + 2] - plan.points[previous + 2]
		const segmentLength = Math.hypot( incomingX, incomingY, incomingZ )
		const bankStep = Math.abs( plan.bank[index] - plan.bank[index - 1] )
		assert.ok( segmentLength <= SPACING + 1e-9, `final segment ${index} exceeds spacing: ${segmentLength}` )
		assert.ok( bankStep <= MAX_BANK_STEP + 1e-6, `final bank step ${index} exceeds budget: ${bankStep}` )
		measuredMaxSegment = Math.max( measuredMaxSegment, segmentLength )
		measuredMaxBank = Math.max( measuredMaxBank, bankStep )

		if ( index + 1 >= plan.bank.length ) continue
		const next = ( index + 1 ) * 3
		const outgoingX = plan.points[next] - plan.points[current]
		const outgoingY = plan.points[next + 1] - plan.points[current + 1]
		const outgoingZ = plan.points[next + 2] - plan.points[current + 2]
		const denominator = segmentLength * Math.hypot( outgoingX, outgoingY, outgoingZ )
		const cosine = (
			incomingX * outgoingX + incomingY * outgoingY + incomingZ * outgoingZ
		) / denominator
		const turn = Math.acos( Math.max( -1, Math.min( 1, cosine ) ) )
		assert.ok( turn <= MAX_TURN_STEP + 1e-9, `final turn ${index} exceeds budget: ${turn}` )
		measuredMaxTurn = Math.max( measuredMaxTurn, turn )
	}

	assert.ok( Math.abs( plan.stats.maxSegmentLength - measuredMaxSegment ) < 1e-12 )
	assert.ok( Math.abs( plan.stats.maxTurn - measuredMaxTurn ) < 1e-12 )
	assert.ok( Math.abs( plan.stats.maxBankStep - measuredMaxBank ) < 1e-12 )
}

test( 'the elevated preset fits its exact built level surface above terrain without breaking planner budgets', () => {
	const controls = elevatedControls()
	const fitted = fitRoadControlsToSurface(
		controls,
		candidate => planRoadPath( candidate, PLAN_OPTIONS ),
		inspectRoadSurface,
		{ maxPasses: TERRAIN_FIT_PASSES }
	)

	assert.equal( fitted.converged, true, `terrain fit retained ${fitted.maxLift}m penetration` )
	assert.ok( fitted.plan, 'terrain fit returned no final plan' )
	assert.ok( fitted.passes > 1, 'elevated preset did not exercise a clearance correction pass' )
	assert.ok(
		fitted.controls.some( ( control, index ) => control.y > controls[index].y + CLEARANCE_TOLERANCE ),
		'elevated preset did not lift any authored span'
	)
	assertPlanBudgets( fitted.plan )

	const geometry = buildRoadSurface( fitted.plan )
	try {
		const position = geometry.getAttribute( 'position' )
		const progress = geometry.getAttribute( 'progress' )
		assert.ok( position, 'built road is missing positions' )
		assert.ok( progress, 'clearance measurement requires built vertex progress' )
		assert.equal( position.count, fitted.plan.stats.pointCount * 2, 'miter build did not emit one exact edge pair per row' )

		for ( let vertex = 0; vertex < position.count; vertex++ ) {
			const x = position.getX( vertex )
			const y = position.getY( vertex )
			const z = position.getZ( vertex )
			const requiredHeight = terrainHeight( x, z ) + ROAD_LIFT
			assert.ok(
				y >= requiredHeight - CLEARANCE_TOLERANCE,
				`built vertex ${vertex} penetrates analytic terrain by ${requiredHeight - y}m`
			)
		}

		const finalMeasurement = measureRoadSurfaceClearance(
			fitted.plan.points,
			geometry,
			terrainHeight,
			ROAD_LIFT
		)
		assert.ok( finalMeasurement.maxLift <= CLEARANCE_TOLERANCE, `final built ribbon needs ${finalMeasurement.maxLift}m more lift` )
	} finally {
		geometry.dispose()
	}
} )

test( 'the overpass preset crosses its own approach with bridge clearance', () => {
	const fitted = fitRoadControlsToSurface(
		elevatedControls(),
		candidate => planRoadPath( candidate, PLAN_OPTIONS ),
		inspectRoadSurface,
		{ maxPasses: TERRAIN_FIT_PASSES }
	)
	const points = fitted.plan.points
	const rows = points.length / 3
	// Samples this far apart along the route cannot be neighbours in the same bend.
	const minimumPathGap = Math.ceil( RIBBON_WIDTH * 4 / SPACING )
	let overlaps = 0
	let minimumSeparation = Infinity
	for ( let a = 0; a < rows; a++ ) {
		for ( let b = a + minimumPathGap; b < rows; b++ ) {
			const horizontal = Math.hypot( points[a * 3] - points[b * 3], points[a * 3 + 2] - points[b * 3 + 2] )
			if ( horizontal >= RIBBON_WIDTH ) continue
			overlaps++
			minimumSeparation = Math.min( minimumSeparation, Math.abs( points[a * 3 + 1] - points[b * 3 + 1] ) )
		}
	}

	assert.ok( overlaps > 0, 'the overpass preset never passes over itself' )
	assert.ok( minimumSeparation > 6, `stacked decks are only ${minimumSeparation}m apart` )
} )

test( 'tight variable-topology vertices map their clearance lift to the adjacent authored spans', () => {
	const points = new Float64Array( [
		-6, 2, 0,
		0, 2, 0,
		0, 2, 0.4,
		-6, 2, 0.4,
	] )
	const anchors = new Int32Array( [0, 1, 2, 3] )
	const geometry = new MeshLineSurfaceGeometry( {
		lines: Float32Array.from( points ),
		lineWidth: 2,
		needsProgress: true,
		surface: { frame: 'transport', up: [0, 1, 0], bank: 0 },
		join: { type: 'miter', limit: 1.05, segments: 8, inner: 'clip' },
		cap: { type: 'butt' },
	} )

	try {
		const position = geometry.getAttribute( 'position' )
		const progress = geometry.getAttribute( 'progress' )
		assert.ok( position.count > points.length / 3 * 2, 'tight joins did not enter variable topology' )
		assert.equal( progress.count, position.count, 'variable vertices lost their path progress' )

		// This narrow bump misses every centre row and touches only outer vertices
		// emitted by the two tight miter joins.
		const tightVertexTerrain = ( x, z ) => x > 0.75 && x < 1.25 && z > -0.1 && z < 0.5 ? 2.5 : 0
		for ( let index = 0; index < points.length; index += 3 ) {
			assert.equal( tightVertexTerrain( points[index], points[index + 2] ), 0 )
		}
		let terrainVertexCount = 0
		for ( let vertex = 0; vertex < position.count; vertex++ ) {
			if ( tightVertexTerrain( position.getX( vertex ), position.getZ( vertex ) ) > 0 ) terrainVertexCount++
		}
		assert.ok( terrainVertexCount > 0, 'test bump did not reach an emitted variable-topology vertex' )

		const measurement = measureRoadSurfaceClearance( points, geometry, tightVertexTerrain )
		assert.equal( measurement.maxLift, 0.5 )
		assert.deepEqual( Array.from( measurement.lifts ), [0, 0.5, 0.5, 0] )
		assert.deepEqual(
			Array.from( spreadRoadClearanceToControls( measurement.lifts, anchors ) ),
			[0.5, 0.5, 0.5, 0],
			'variable vertex progress mapped the lift outside its adjacent authored spans'
		)
	} finally {
		geometry.dispose()
	}
} )

test( 'terrain fitting reports explicit nonconvergence when its pass budget is exhausted', () => {
	const controls = elevatedControls()
	const fitted = fitRoadControlsToSurface(
		controls,
		candidate => planRoadPath( candidate, PLAN_OPTIONS ),
		inspectRoadSurface,
		{ maxPasses: 1 }
	)

	assert.equal( fitted.converged, false )
	assert.equal( fitted.passes, 1 )
	assert.ok( fitted.plan, 'nonconverged fit discarded its last valid plan' )
	assert.ok( fitted.maxLift > CLEARANCE_TOLERANCE, 'nonconverged fit did not report the remaining penetration' )
	for ( let index = 0; index < controls.length; index++ ) {
		assert.equal( fitted.controls[index].y, controls[index].y, `single-pass fit unexpectedly mutated control ${index}` )
	}
	assertPlanBudgets( fitted.plan )
} )

// The demo's opening road: eight terrain-hugging controls.
const defaultControls = () => Array.from( { length: 8 }, ( _, index ) => {
	const progress = index / 7
	return createControl(
		( progress - 0.5 ) * 70,
		Math.sin( progress * Math.PI * 2 ) * 13 + Math.sin( progress * Math.PI * 5 ) * 3.5,
	)
} )

test( 'raising or banking one control leaves the far end of the fitted road where it was', () => {
	const fit = controls => fitRoadControlsToSurface(
		controls,
		candidate => planRoadPath( candidate, PLAN_OPTIONS ),
		inspectRoadSurface,
		{ maxPasses: TERRAIN_FIT_PASSES }
	)
	const base = defaultControls()
	const baseFit = fit( base )
	const baseGeometry = buildRoadSurface( baseFit.plan )

	for ( const [label, edit] of [
		['raising control 3 by 6m', control => { control.y += 6 }],
		['banking control 3 by 0.5rad', control => { control.bank = 0.5 }],
	] ) {
		const controls = defaultControls()
		edit( controls[3] )
		const edited = fit( controls )
		assert.equal( edited.converged, true, `${label} did not fit the terrain` )

		// A transported frame rolled everything past a climbing turn, and the fit
		// then lifted those far controls to keep the tilted edges above ground.
		for ( const index of [6, 7] ) {
			const before = baseFit.controls[index].y - base[index].y
			const after = edited.controls[index].y - controls[index].y
			assert.ok( Math.abs( after - before ) < 0.01, `${label} changed the terrain lift of control ${index} by ${after - before}m` )
		}

		const geometry = buildRoadSurface( edited.plan )
		try {
			const before = baseGeometry.getAttribute( 'position' )
			const after = geometry.getAttribute( 'position' )
			for ( let span = 6; span < baseFit.plan.anchors.length - 1; span++ ) {
				const rows = baseFit.plan.anchors[span + 1] - baseFit.plan.anchors[span]
				assert.equal( edited.plan.anchors[span + 1] - edited.plan.anchors[span], rows, `${label} retessellated far span ${span}` )
				for ( let row = 0; row <= rows; row++ ) {
					for ( let side = 0; side < 2; side++ ) {
						const a = ( baseFit.plan.anchors[span] + row ) * 2 + side
						const b = ( edited.plan.anchors[span] + row ) * 2 + side
						const moved = Math.hypot( after.getX( b ) - before.getX( a ), after.getY( b ) - before.getY( a ), after.getZ( b ) - before.getZ( a ) )
						assert.ok( moved < 0.01, `${label} moved far span ${span} edge vertex by ${moved}m` )
					}
				}
			}
		} finally {
			geometry.dispose()
		}
	}
	baseGeometry.dispose()
} )
