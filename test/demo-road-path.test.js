import assert from 'node:assert/strict'
import test from 'node:test'

import { planRoadPath } from '../demo/src/utils/roadPath.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const ROAD_WIDTH = 6
const HALF = ROAD_WIDTH / 2
const OPTIONS = {
	spacing: 0.45,
	minRadius: HALF * 1.35,
	foldRadius: HALF * 1.05,
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
		z: Math.sin( progress * Math.PI * 2 ) * 13 + Math.sin( progress * Math.PI * 5 ) * 3.5,
	}
} )

const LAYOUTS = {
	gentle: gentleRoad(),
	rightAngles: [
		{ x: -22, z: -16 }, { x: 0, z: -16 }, { x: 0, z: 6 }, { x: 22, z: 6 }, { x: 22, z: 26 },
	],
	hairpin: [{ x: -24, z: 0 }, { x: 0, z: 0 }, { x: 0.6, z: 14 }, { x: -23, z: 14.6 }],
	reversal: [{ x: -20, z: 0 }, { x: 0, z: 0 }, { x: -19, z: 0.8 }, { x: -19, z: 18 }],
	slalom: Array.from( { length: 9 }, ( _, index ) => ( { x: -32 + index * 8, z: index % 2 === 0 ? -8 : 8 } ) ),
	crowded: [
		{ x: -14, z: 0 }, { x: 0, z: 0 }, { x: 2.2, z: 3 }, { x: -0.6, z: 6 }, { x: 14, z: 8 },
	],
	duplicate: [{ x: -14, z: 0 }, { x: 0, z: 0 }, { x: 0.000001, z: 0 }, { x: 14, z: 4 }],
	pair: [{ x: -12, z: -4 }, { x: 13, z: 7 }],
}

for ( let seed = 0; seed < 20; seed++ ) {
	const random = mulberry( seed * 7919 + 13 )
	const count = 3 + Math.floor( random() * 8 )
	LAYOUTS[`random-${seed}`] = Array.from( { length: count }, () => ( {
		x: ( random() - 0.5 ) * 80,
		z: ( random() - 0.5 ) * 60,
	} ) )
}

const toPositions = points => {
	const count = points.length / 2
	const positions = new Float32Array( count * 3 )
	for ( let index = 0; index < count; index++ ) {
		positions[index * 3] = points[index * 2]
		positions[index * 3 + 2] = points[index * 2 + 1]
	}
	return positions
}

const buildSurface = points => new MeshLineSurfaceGeometry( {
	lines: toPositions( points ),
	lineWidth: ROAD_WIDTH,
	needsUV: true,
	surface: { frame: 'fixed-up', up: [0, 1, 0], uvMode: 'distance', uvScale: 1 },
	join: { type: 'round', limit: 2, segments: 12, inner: 'clip' },
	cap: { type: 'butt' },
} )

const dedupe = controls => controls.filter( ( control, index ) => {
	if ( index === 0 ) return true
	const previous = controls[index - 1]
	return Math.hypot( control.x - previous.x, control.z - previous.z ) > 0.2
} )

test( 'the planned road passes exactly through every control point', () => {
	for ( const [name, controls] of Object.entries( LAYOUTS ) ) {
		const plan = planRoadPath( controls, OPTIONS )
		assert.ok( plan, `${name} produced no plan` )
		const knots = dedupe( controls )
		assert.equal( plan.anchors.length, knots.length, `${name} lost a control point` )

		for ( let index = 0; index < knots.length; index++ ) {
			const anchor = plan.anchors[index]
			assert.ok( anchor >= 0, `${name} dropped anchor ${index}` )
			const offset = Math.hypot(
				plan.points[anchor * 2] - knots[index].x,
				plan.points[anchor * 2 + 1] - knots[index].z
			)
			assert.ok( offset < 1e-9, `${name} misses control ${index} by ${offset}` )
		}
	}
} )

test( 'anchors stay ordered and the sampling stays regular', () => {
	for ( const [name, controls] of Object.entries( LAYOUTS ) ) {
		const plan = planRoadPath( controls, OPTIONS )
		for ( let index = 1; index < plan.anchors.length; index++ ) {
			assert.ok( plan.anchors[index] > plan.anchors[index - 1], `${name} anchors are out of order` )
		}

		const count = plan.points.length / 2
		for ( let index = 1; index < count; index++ ) {
			const length = Math.hypot(
				plan.points[index * 2] - plan.points[( index - 1 ) * 2],
				plan.points[index * 2 + 1] - plan.points[( index - 1 ) * 2 + 1]
			)
			assert.ok( length > 1e-6, `${name} emitted a degenerate segment at ${index}` )
			assert.ok( Number.isFinite( length ), `${name} emitted a non-finite segment at ${index}` )
		}
	}
} )

test( 'smooth corners keep the centerline clear of the ribbon fold radius', () => {
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

test( 'a road can be built at any turn angle, up to a full reversal', () => {
	// The whole point of the turn arcs: a corner the interpolating curve cannot
	// hold is replaced by a fixed-radius turn through the same point, so there is
	// no angle that produces a cusp, a collapsed corner, or a broken ribbon.
	for ( let degrees = 10; degrees <= 179.9; degrees += 5 ) {
		for ( const leg of [14, 22, 40] ) {
			const turn = degrees * Math.PI / 180
			const controls = [
				{ x: -leg, z: 0 },
				{ x: 0, z: 0 },
				{ x: Math.cos( turn ) * leg, z: Math.sin( turn ) * leg },
			]
			const label = `${degrees.toFixed( 1 )}° with ${leg} legs`
			const plan = planRoadPath( controls, OPTIONS )
			assert.ok( plan, `${label} produced no plan` )

			const count = plan.points.length / 2
			let maxTurn = 0
			for ( let index = 1; index < count - 1; index++ ) {
				const ax = plan.points[index * 2] - plan.points[( index - 1 ) * 2]
				const az = plan.points[index * 2 + 1] - plan.points[( index - 1 ) * 2 + 1]
				const bx = plan.points[( index + 1 ) * 2] - plan.points[index * 2]
				const bz = plan.points[( index + 1 ) * 2 + 1] - plan.points[index * 2 + 1]
				const lengths = Math.hypot( ax, az ) * Math.hypot( bx, bz )
				assert.ok( lengths > 0, `${label} emitted a degenerate segment` )
				maxTurn = Math.max( maxTurn, Math.acos( Math.max( -1, Math.min( 1, ( ax * bx + az * bz ) / lengths ) ) ) )
			}

			// Every vertex is a sample of a curve or an arc, never a corner: the
			// sharpest one may only turn as much as the tightest radius warrants.
			const budget = OPTIONS.spacing / Math.max( plan.stats.minRadius, 0.4 ) * 1.6 + 0.02
			assert.ok(
				maxTurn <= budget,
				`${label} kinks ${( maxTurn * 180 / Math.PI ).toFixed( 1 )}° at one vertex`
			)

			const anchor = plan.anchors[1]
			assert.ok(
				Math.hypot( plan.points[anchor * 2], plan.points[anchor * 2 + 1] ) < 1e-9,
				`${label} does not pass through the corner`
			)

			const geometry = buildSurface( plan.points )
			const position = geometry.getAttribute( 'position' ).array
			const index = geometry.getIndex().array
			let flipped = 0
			for ( let offset = 0; offset < index.length; offset += 3 ) {
				const a = index[offset] * 3
				const b = index[offset + 1] * 3
				const c = index[offset + 2] * 3
				const cross = ( position[b] - position[a] ) * ( position[c + 2] - position[a + 2] ) -
					( position[b + 2] - position[a + 2] ) * ( position[c] - position[a] )
				if ( cross > 1e-9 ) flipped++
			}
			assert.equal( flipped, 0, `${label} produced ${flipped} back-facing road triangles` )

			// Legs with room to spare must come out drivable, not merely buildable.
			if ( leg >= 22 ) {
				assert.ok(
					plan.stats.minRadius >= OPTIONS.foldRadius,
					`${label} came out at radius ${plan.stats.minRadius.toFixed( 2 )}, below the fold radius`
				)
			}
		}
	}
} )

test( 'every layout builds a surface without folded or degenerate triangles', () => {
	for ( const [name, controls] of Object.entries( LAYOUTS ) ) {
		const plan = planRoadPath( controls, OPTIONS )
		const geometry = buildSurface( plan.points )
		const position = geometry.getAttribute( 'position' ).array
		const index = geometry.getIndex().array

		let flipped = 0
		for ( let offset = 0; offset < index.length; offset += 3 ) {
			const a = index[offset] * 3
			const b = index[offset + 1] * 3
			const c = index[offset + 2] * 3
			const cross = ( position[b] - position[a] ) * ( position[c + 2] - position[a + 2] ) -
				( position[b + 2] - position[a + 2] ) * ( position[c] - position[a] )
			if ( cross > 1e-9 ) flipped++
		}

		assert.equal( flipped, 0, `${name} produced ${flipped} back-facing road triangles` )
		for ( let offset = 0; offset < position.length; offset++ ) {
			assert.ok( Number.isFinite( position[offset] ), `${name} produced a non-finite vertex` )
		}
	}
} )

test( 'dragging a control point re-plans without throwing at any offset', () => {
	const controls = gentleRoad()
	for ( let step = 0; step < 220; step++ ) {
		const angle = step / 220 * Math.PI * 2
		controls[3].x = Math.cos( angle ) * 26
		controls[3].z = Math.sin( angle ) * 22
		const plan = planRoadPath( controls, OPTIONS )
		assert.ok( plan, `drag step ${step} produced no plan` )
		assert.doesNotThrow( () => buildSurface( plan.points ), `drag step ${step} failed to build` )
	}
} )

test( 'a two point road is a straight ribbon and degenerate input is rejected', () => {
	const plan = planRoadPath( LAYOUTS.pair, OPTIONS )
	assert.equal( plan.corners.length, 0 )
	assert.equal( plan.stats.arcCount, 0 )

	assert.equal( planRoadPath( [], OPTIONS ), null )
	assert.equal( planRoadPath( [{ x: 1, z: 1 }], OPTIONS ), null )
	assert.equal( planRoadPath( [{ x: 1, z: 1 }, { x: 1, z: 1 }], OPTIONS ), null )
	assert.equal( planRoadPath( [{ x: NaN, z: 0 }, { x: 4, z: 0 }], OPTIONS ), null )
} )

test( 'option defaults survive undefined overrides', () => {
	const plan = planRoadPath( gentleRoad(), { spacing: undefined, minRadius: undefined } )
	assert.ok( plan.stats.pointCount > 0 )
	assert.ok( Number.isFinite( plan.stats.maxTurn ) )
} )
