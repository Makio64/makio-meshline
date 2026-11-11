import assert from 'node:assert/strict'
import test from 'node:test'

import { MIN_LOOP_CONTROLS, planRoadLoop, SEAM_DROP } from '../demo/src/utils/roadLoop.js'
import { planRoadPath } from '../demo/src/utils/roadPath.js'

const HALF = 3.7
const SETTINGS = {
	spacing: 36,
	maxAngle: Math.PI / 32,
	maxChordError: 0.085,
	maxBankAngle: Math.PI / 180,
	minRadius: HALF * 1.5,
	foldRadius: HALF * 1.05,
}
const planPath = controls => planRoadPath( controls, SETTINGS )

const ring = ( count, radius, climb = 0, bank = 0 ) => Array.from( { length: count }, ( _, index ) => {
	const angle = index / count * Math.PI * 2
	return {
		x: Math.cos( angle ) * radius,
		y: climb * ( 1 + Math.sin( index * 2.1 ) ),
		z: Math.sin( angle ) * radius * 0.7,
		bank: bank * Math.cos( index * 1.3 ),
	}
} )

const LOOPS = {
	triangle: ring( 3, 24 ),
	square: ring( 4, 24 ),
	oval: ring( 6, 26 ),
	hilly: ring( 8, 30, 4, 0.25 ),
	tight: ring( 12, 14 ),
}

const row = ( points, index ) => [points[index * 3], points[index * 3 + 1], points[index * 3 + 2]]
const between = ( from, to ) => [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
const turn = ( a, b ) => Math.acos( Math.max( -1, Math.min( 1, ( a[0] * b[0] + a[1] * b[1] + a[2] * b[2] ) / ( Math.hypot( ...a ) * Math.hypot( ...b ) ) ) ) )

test( 'a loop comes back to its first control in place and in direction', () => {
	for ( const [name, controls] of Object.entries( LOOPS ) ) {
		const plan = planRoadLoop( controls, planPath )
		assert.equal( plan?.closed, true, `${name} did not close` )
		const { points, bank } = plan
		const rows = points.length / 3
		assert.equal( plan.stats.pointCount, rows, `${name} miscounts its rows` )

		// The lap runs from row 1 to the row before the last, which are one place.
		const first = row( points, 1 )
		const last = row( points, rows - 2 )
		assert.deepEqual( last, first, `${name} leaves a gap at the seam` )
		assert.equal( bank[rows - 2], bank[1], `${name} banks differently either side of the seam` )

		// Across the seam the road turns no more than it may between any two rows.
		const kink = turn( between( row( points, rows - 3 ), last ), between( first, row( points, 2 ) ) )
		assert.ok( kink <= SETTINGS.maxAngle + 1e-9, `${name} turns ${kink} across the seam` )

		let length = 0
		for ( let index = 2; index <= rows - 2; index++ ) length += Math.hypot( ...between( row( points, index - 1 ), row( points, index ) ) )
		assert.ok( Math.abs( plan.stats.length - length ) < 1e-9, `${name} reports ${plan.stats.length}m for a ${length}m lap` )
	}
} )

test( 'the two rows that overlap the seam are the rows across it, under the deck', () => {
	for ( const [name, controls] of Object.entries( LOOPS ) ) {
		const { points, bank } = planRoadLoop( controls, planPath )
		const rows = points.length / 3
		// With the same neighbours on both sides, the ribbon cuts its two end rows square to the same pair of segments.
		for ( const [overlap, source] of [[0, rows - 3], [rows - 1, 2]] ) {
			const [x, y, z] = row( points, overlap )
			const [sourceX, sourceY, sourceZ] = row( points, source )
			assert.equal( x, sourceX, `${name} overlap row ${overlap} is off the road in x` )
			assert.equal( z, sourceZ, `${name} overlap row ${overlap} is off the road in z` )
			assert.ok( Math.abs( sourceY - y - SEAM_DROP ) < 1e-12, `${name} overlap row ${overlap} is not ${SEAM_DROP}m under the deck` )
			assert.equal( bank[overlap], bank[source], `${name} overlap row ${overlap} is banked differently` )
		}
	}
} )

test( 'every control of a loop is an anchored sample with a corner of its own', () => {
	for ( const [name, controls] of Object.entries( LOOPS ) ) {
		const plan = planRoadLoop( controls, planPath )
		const count = controls.length
		assert.equal( plan.anchors.length, count + 1, `${name} needs one anchor a control and one where the lap closes` )
		assert.deepEqual( Array.from( plan.controlIndices ), [...controls.keys(), 0] )
		for ( let index = 0; index <= count; index++ ) {
			const control = controls[index % count]
			const [x, y, z] = row( plan.points, plan.anchors[index] )
			assert.ok( Math.hypot( x - control.x, y - control.y, z - control.z ) < 1e-9, `${name} control ${index % count} is not a sample` )
		}
		assert.equal( plan.anchors[0], 1 )
		assert.equal( plan.anchors[count], plan.points.length / 3 - 2 )

		// An open road has no corner at its ends. Round a loop every control is passed through.
		assert.equal( plan.stats.knotCount, count )
		assert.deepEqual( plan.corners.map( corner => corner.knotIndex ), [...controls.keys()] )
		for ( const corner of plan.corners ) assert.equal( corner.sampleIndex, plan.anchors[corner.knotIndex] )
		assert.equal( plan.stats.tightCount, 0, `${name} should be buildable` )
	}
} )

test( 'a loop too tight to build says so, and too few controls make no loop', () => {
	const pinched = [{ x: -20, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, { x: 20, y: 0, z: 0 }, { x: 22, y: 0, z: 4 }]
	assert.ok( planRoadLoop( pinched, planPath ).stats.tightCount > 0 )

	assert.equal( MIN_LOOP_CONTROLS, 3 )
	assert.equal( planRoadLoop( ring( 2, 20 ), planPath ), null )
	assert.equal( planRoadLoop( [], planPath ), null )
	// Two controls on one spot are merged by the planner: the laps would no longer line up.
	const doubled = ring( 4, 24 )
	doubled.splice( 1, 0, { ...doubled[0] } )
	assert.equal( planRoadLoop( doubled, planPath ), null )
} )
