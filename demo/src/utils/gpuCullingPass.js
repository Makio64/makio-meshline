import { MathUtils, Vector3 } from 'three/webgpu'

import { linePoints, times } from '@/utils/points'

/**
 * The alpine pass of the GPU Culling demo: a closed route around a valley, road
 * strands along it, and mountain contours stepping up on both sides.
 */
const ROAD_STRANDS = 8
const OUTER_TIERS = 14
const INNER_TIERS = 10
const ROAD_OFFSETS = [-3.2, -2.6, -1.6, -0.18, 0.18, 1.6, 2.6, 3.2]
const FRAME_STEP = 1.5e-3

export const STRANDS = ROAD_STRANDS + OUTER_TIERS + INNER_TIERS
export const MAP_BINS = 180

const ahead = new Vector3()
const behind = new Vector3()
const frameCentre = new Vector3()
const frameRight = new Vector3()

/** Centre of the winding alpine pass at `angle` around the valley route. */
export const passCentre = ( angle, target ) => {
	const r = 58 + Math.sin( angle * 2 - 0.45 ) * 11 + Math.cos( angle * 3 + 0.7 ) * 8.5
	const x = Math.cos( angle ) * r * 1.34 + Math.sin( angle * 2 + 0.5 ) * 9
	const y = Math.sin( angle * 2 - 0.3 ) * 1.8 + Math.cos( angle * 3 + 0.85 ) * 0.9
	const z = Math.sin( angle ) * r * 0.82 + Math.cos( angle * 3 - 0.3 ) * 7
	return target.set( x, y, z )
}

/** Smooth outward radial frame (never cusps or self-intersects on tight bends). Returns the bank angle. */
export const samplePassFrame = ( angle, centre, right ) => {
	passCentre( angle, centre )
	passCentre( angle + FRAME_STEP, ahead )
	passCentre( angle - FRAME_STEP, behind )

	// Smooth outward direction from the valley floor so wide contour tiers never loop at bends.
	right.set(
		Math.cos( angle ) * 1.34 + Math.cos( angle * 2 + 0.5 ) * 0.18,
		0,
		Math.sin( angle ) * 0.82 - Math.sin( angle * 3 - 0.3 ) * 0.14,
	).normalize()

	const dx = ahead.x - centre.x
	const dz = ahead.z - centre.z
	const ddx = ahead.x - 2 * centre.x + behind.x
	const ddz = ahead.z - 2 * centre.z + behind.z
	const curvature = ( dx * ddz - dz * ddx ) / Math.pow( Math.hypot( dx, dz ), 3 )
	return MathUtils.clamp( curvature * 32, -0.28, 0.28 )
}

/** Sculpted alpine mountain ridges rising on both sides of the canyon pass. */
const mountainProfile = ( angle, side, tier, maxTiers ) => {
	const tierFrac = ( tier + 1 ) / maxTiers
	const p1 = Math.pow( Math.max( 0, Math.cos( angle - 0.35 ) ), 2.0 ) * 22
	const p2 = Math.pow( Math.max( 0, Math.cos( angle - 1.85 ) ), 2.4 ) * 28
	const p3 = Math.pow( Math.max( 0, Math.cos( angle - 3.25 ) ), 2.0 ) * 20
	const p4 = Math.pow( Math.max( 0, Math.cos( angle - 4.65 ) ), 2.3 ) * 26
	const p5 = Math.pow( Math.max( 0, Math.cos( angle - 5.55 ) ), 2.5 ) * 18
	const sidePhase = side > 0 ? 0 : 1.1
	const ridge = 6.5
		+ ( p1 + p2 + p3 + p4 + p5 ) * ( side > 0 ? 1.0 : 0.78 )
		+ Math.sin( angle * 5 + sidePhase ) * 3.2
		+ Math.cos( angle * 9 - tier * 0.4 + sidePhase ) * 1.6
	const height = 3.6 + Math.pow( tierFrac, 1.12 ) * Math.max( 6, ridge )
	const maxSpan = side > 0 ? 32 : 21
	const spur = 1 + Math.sin( angle * 6 + tier * 0.3 + sidePhase ) * 0.08
	const lateral = ( 4.4 + tierFrac * maxSpan ) * spur
	return { lateral: side * lateral, height }
}

const framePoint = ( lateral, height ) => [
	frameCentre.x + frameRight.x * lateral,
	frameCentre.y + height,
	frameCentre.z + frameRight.z * lateral,
]

/** A lane banked into the bends, with the guardrails lifted above it. */
const roadPoint = ( strand, bank ) => {
	const offset = ROAD_OFFSETS[strand]
	const lift = strand === 0 || strand === ROAD_STRANDS - 1 ? 0.22 : 0.04
	return framePoint( offset * Math.cos( bank ), offset * Math.sin( bank ) + lift )
}

const contourPoint = ( contour, angle ) => {
	const isOuter = contour < OUTER_TIERS
	const tier = isOuter ? contour : contour - OUTER_TIERS
	const { lateral, height } = mountainProfile( angle, isOuter ? 1 : -1, tier, isOuter ? OUTER_TIERS : INNER_TIERS )
	return framePoint( lateral, height )
}

const strandPoint = ( strand, angle ) => {
	const bank = samplePassFrame( angle, frameCentre, frameRight )
	return strand < ROAD_STRANDS ? roadPoint( strand, bank ) : contourPoint( strand - ROAD_STRANDS, angle )
}

/** Every strand of the pass as a closed line: the road first, then the contours. */
export const buildPassStrands = pointsPerStrand => times( STRANDS, strand =>
	linePoints( pointsPerStrand, t => strandPoint( strand, t * Math.PI * 2 ), { closed: true } ) )
