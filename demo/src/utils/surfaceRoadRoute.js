import { MathUtils } from 'three/webgpu'

import { times } from '@/utils/points'
import { MIN_LOOP_CONTROLS, planRoadLoop } from '@/utils/roadLoop'
import { planRoadPath } from '@/utils/roadPath'

export const ROAD_LIFT = 0.08
export const MAX_CONTROLS = 24
export const MIN_CONTROLS = 2
export const MIN_LOOP = MIN_LOOP_CONTROLS
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
	const angle = index / 8 * Math.PI * 2
	return createControl(
		Math.cos( angle ) * 34,
		Math.sin( angle ) * 22 + Math.sin( angle * 2 ) * 3,
	)
} )

// The shared eight-point circuit, preserving its authored world heights and bank.
export const elevatedControls = () => [
	{ x: -31.6443, y: -0.5336, z: -5.044, bank: 0 },
	{ x: -8.9068, y: 1.9254, z: 1.6705, bank: 0 },
	{ x: 22, y: 4.917, z: 10, bank: 0.607484 },
	{ x: -6, y: 8.966, z: 21, bank: 0.35836 },
	{ x: -22.1205, y: 15.7491, z: 2.2895, bank: 1.32 },
	{ x: 14.624, y: 2.0319, z: -24.5263, bank: -0.366422 },
	{ x: -12, y: -0.22, z: -34, bank: 0 },
	{ x: -18.0639, y: -0.2598, z: -19.1154, bank: 0 },
]

// The ribbon's half width sets the radius the centreline must respect. minRadius is
// generous because a radius only just above it still trims a sliver off every inner
// row, thinning the outer bands along a bend. foldRadius is the real limit: at exactly
// the half width the inner edge reaches the centre of the turn, and below it the
// ribbon starts losing width, so the planner cuts a crisp corner instead.
export const planRoute = ( controls, half, closed = false ) => {
	const settings = {
		spacing: 36,
		maxAngle: Math.PI / 32,
		maxChordError: 0.085,
		maxBankAngle: Math.PI / 180,
		minRadius: half * 1.5,
		foldRadius: half * 1.05,
	}
	return closed && controls.length >= MIN_LOOP
		? planRoadLoop( controls, lapped => planRoadPath( lapped, settings ) )
		: planRoadPath( controls, settings )
}

/**
 * Where a new control costs the road the least in plan view (and in elevation
 * when double-clicking directly on an elevated span at `hintY`), with the
 * clearance and bank it should take there.
 */
export function findInsertion( controls, x, z, hintY, closed = false ) {
	const heightCost = y => hintY === undefined ? 0 : Math.abs( y - hintY )
	const endCost = control => Math.hypot( control.x - x, control.z - z ) + heightCost( control.y )
	const first = controls[0]
	const last = controls[controls.length - 1]
	// A loop has no ends to extend, but one more leg to split: from its last control back to its first.
	let best = { index: controls.length, cost: closed ? Infinity : endCost( last ), clearance: clearanceOf( last ), bank: last.bank }
	if ( !closed && endCost( first ) < best.cost ) {
		best = { index: 0, cost: endCost( first ), clearance: clearanceOf( first ), bank: first.bank }
	}

	for ( let index = 0; index < controls.length - ( closed ? 0 : 1 ); index++ ) {
		const a = controls[index]
		const b = controls[( index + 1 ) % controls.length]
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
