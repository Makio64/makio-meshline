import { MathUtils } from 'three/webgpu'

import { random, randomInt } from '@/makio/utils/random'
import { times } from '@/utils/points'
import { planRoadPath } from '@/utils/roadPath'

export const ROAD_LIFT = 0.08
export const MAX_CONTROLS = 24
export const MIN_CONTROLS = 2
export const MIN_CLEARANCE = -4
export const MAX_CLEARANCE = 30

// Rolling ground the road has to follow. The hills are broad rather than tall:
// the ribbon keeps a level cross-section, so what matters is not the height
// range but the cross-slope under a single road width, which stays near 0.2.
export const terrainHeight = ( x, z ) =>
	Math.sin( x * 0.034 ) * 1.1 +
	Math.cos( z * 0.041 ) * 0.8 +
	Math.sin( ( x + z * 0.6 ) * 0.019 ) * 0.7

export const roadHeight = ( x, z, clearance ) => terrainHeight( x, z ) + ROAD_LIFT + clearance

export const clearanceOf = control => control.y - terrainHeight( control.x, control.z ) - ROAD_LIFT

export const signedAngle = angle => MathUtils.euclideanModulo( angle + Math.PI, Math.PI * 2 ) - Math.PI

export const createControl = ( x, z, clearance = 0, bank = 0 ) => ( { x, y: roadHeight( x, z, clearance ), z, bank } )

export const defaultControls = () => times( 8, index => {
	const progress = index / 7
	return createControl(
		( progress - 0.5 ) * 70,
		Math.sin( progress * Math.PI * 2 ) * 13 + Math.sin( progress * Math.PI * 5 ) * 3.5,
	)
} )

// A banked loop that climbs, turns back and crosses its own approach on a
// bridge about eight metres above it.
export const elevatedControls = () => [
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

// One step of a walk that stays in the play area, or else turns back to its middle.
const nextStep = ( x, z, angle ) => {
	for ( let attempt = 0; attempt < 12; attempt++ ) {
		const heading = angle + random( -0.9, 0.9 )
		const length = random( 14, 22 )
		const nextX = x + Math.cos( heading ) * length
		const nextZ = z + Math.sin( heading ) * length
		if ( Math.abs( nextX ) <= 42 && Math.abs( nextZ ) <= 32 ) return { heading, length }
	}
	return { heading: Math.atan2( -z, -x ) + random( -0.55, 0.55 ), length: 14 }
}

// A wandering walk rather than scattered points: consecutive controls stay far
// enough apart for the planner to find a road instead of a knot.
const createRandomControls = () => {
	const count = randomInt( 5, 9 )
	let angle = random( 0, Math.PI * 2 )
	let x = random( -10, 10 )
	let z = random( -10, 10 )
	let clearance = 0
	let bank = 0
	const controls = [createControl( x, z )]
	for ( let index = 1; index < count; index++ ) {
		const step = nextStep( x, z, angle )
		angle = step.heading
		x += Math.cos( angle ) * step.length
		z += Math.sin( angle ) * step.length
		clearance = MathUtils.clamp( clearance + random( -4, 5 ), 0, 14 )
		bank = MathUtils.clamp( bank + random( -0.18, 0.18 ), -0.35, 0.35 )
		controls.push( createControl( x, z, clearance, bank ) )
	}
	return controls
}

// The ribbon's half width sets the radius the centreline must respect. minRadius is
// generous because a radius only just above it still trims a sliver off every inner
// row, thinning the outer bands along a bend. foldRadius is the real limit: at exactly
// the half width the inner edge reaches the centre of the turn, and below it the
// ribbon starts losing width, so the planner cuts a crisp corner instead.
export const planRoute = ( controls, half ) => planRoadPath( controls, {
	spacing: 36,
	maxAngle: Math.PI / 32,
	maxChordError: 0.085,
	maxBankAngle: Math.PI / 180,
	minRadius: half * 1.5,
	foldRadius: half * 1.05,
} )

const isDrivable = ( controls, half ) => {
	try {
		return planRoute( controls, half )?.stats.tightCount === 0
	} catch {
		return false
	}
}

export const randomControls = half => {
	for ( let attempt = 0; attempt < 20; attempt++ ) {
		const controls = createRandomControls()
		if ( isDrivable( controls, half ) ) return controls
	}
	return defaultControls()
}

/**
 * Where a new control costs the road the least in plan view (and in elevation
 * when double-clicking directly on an elevated span at `hintY`), with the
 * clearance and bank it should take there.
 */
export function findInsertion( controls, x, z, hintY ) {
	const heightCost = y => hintY === undefined ? 0 : Math.abs( y - hintY )
	const endCost = control => Math.hypot( control.x - x, control.z - z ) + heightCost( control.y )
	const first = controls[0]
	const last = controls[controls.length - 1]
	let best = { index: controls.length, cost: endCost( last ), clearance: clearanceOf( last ), bank: last.bank }
	if ( endCost( first ) < best.cost ) {
		best = { index: 0, cost: endCost( first ), clearance: clearanceOf( first ), bank: first.bank }
	}

	for ( let index = 0; index < controls.length - 1; index++ ) {
		const a = controls[index]
		const b = controls[index + 1]
		const abX = b.x - a.x
		const abZ = b.z - a.z
		const abLenSq = abX * abX + abZ * abZ
		const t = abLenSq > 1e-6 ? MathUtils.clamp( ( ( x - a.x ) * abX + ( z - a.z ) * abZ ) / abLenSq, 0, 1 ) : 0.5
		const detour2D = Math.hypot( a.x - x, a.z - z ) + Math.hypot( b.x - x, b.z - z ) - Math.sqrt( abLenSq )
		const cost = detour2D + heightCost( a.y + ( b.y - a.y ) * t ) * 1.5
		if ( cost >= best.cost ) continue
		best = {
			index: index + 1,
			cost,
			clearance: MathUtils.clamp( MathUtils.lerp( clearanceOf( a ), clearanceOf( b ), t ), MIN_CLEARANCE, MAX_CLEARANCE ),
			bank: signedAngle( a.bank + signedAngle( b.bank - a.bank ) * t ),
		}
	}
	return best
}
