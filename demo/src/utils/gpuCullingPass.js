import { MathUtils, Vector3 } from 'three/webgpu'

import { linePoints, times } from '@/utils/points'

/**
 * The alpine pass of the GPU Culling demo: a 4-lane banked highway and 18 elevation
 * contour loops, plus 250 freestanding open 3D tunnel arches along the route.
 */
const ROAD_STRANDS = 6
const OUTER_CONTOURS = 12
const INNER_CONTOURS = 6

const ROAD_OFFSETS = [-3.9, -2.45, -0.22, 0.22, 2.45, 3.9]
const TUNNEL_HALF_WIDTH = 4.35
const TUNNEL_BASE_LIFT = 0.08
const TUNNEL_CROWN = 5.35
const FRAME_STEP = 1.5e-3

export const LOOP_STRANDS = ROAD_STRANDS + OUTER_CONTOURS + INNER_CONTOURS
export const ARCH_COUNT = 250
export const MAP_BINS = 180

const ahead = new Vector3()
const behind = new Vector3()
const frameCentre = new Vector3()
const frameRight = new Vector3()

/** Centre of the winding alpine pass at `angle` around the valley route. */
export const passCentre = ( angle, target ) => {
	const r = 60 + Math.sin( angle * 2 - 0.45 ) * 11 + Math.cos( angle * 3 + 0.7 ) * 8
	const x = Math.cos( angle ) * r * 1.35 + Math.sin( angle * 2 + 0.5 ) * 9
	const y = Math.sin( angle * 2 - 0.3 ) * 0.12 + Math.cos( angle * 3 + 0.85 ) * 0.08
	const z = Math.sin( angle ) * r * 0.85 + Math.cos( angle * 3 - 0.3 ) * 7
	return target.set( x, y, z )
}

/** Local road frame (centre, true perpendicular right normal, and bank angle) at `angle`. */
export const samplePassFrame = ( angle, centre, right ) => {
	passCentre( angle, centre )
	passCentre( angle + FRAME_STEP, ahead )
	passCentre( angle - FRAME_STEP, behind )

	const dx = ahead.x - centre.x
	const dz = ahead.z - centre.z
	right.set( dz, 0, -dx ).normalize()

	const ddx = ahead.x - 2 * centre.x + behind.x
	const ddz = ahead.z - 2 * centre.z + behind.z
	const curvature = ( dx * ddz - dz * ddx ) / Math.pow( Math.hypot( dx, dz ), 3 )
	return Math.tanh( curvature * 14 ) * 0.05
}

/**
 * Parametric 3D mountain surface at `angle`, `side` (+1 outer range, -1 inner massif),
 * and normalized cross-slope coordinate `tierFrac` in [0, 1].
 */
const mountainSurface = ( angle, side, tierFrac ) => {
	const p1 = Math.pow( Math.max( 0, Math.cos( angle - 0.35 ) ), 2.2 ) * 28
	const p2 = Math.pow( Math.max( 0, Math.cos( angle - 1.55 ) ), 2.4 ) * 34
	const p3 = Math.pow( Math.max( 0, Math.cos( angle - 2.75 ) ), 2.1 ) * 24
	const p4 = Math.pow( Math.max( 0, Math.cos( angle - 3.95 ) ), 2.4 ) * 32
	const p5 = Math.pow( Math.max( 0, Math.cos( angle - 5.20 ) ), 2.3 ) * 26
	const sidePhase = side > 0 ? 0 : 1.25
	const ridge = 6.0
		+ ( p1 + p2 + p3 + p4 + p5 ) * ( side > 0 ? 1.08 : 0.78 )
		+ Math.sin( angle * 5 + sidePhase ) * 3.4
		+ Math.cos( angle * 9 - tierFrac * 3.2 + sidePhase ) * 1.6

	// Rise smoothly from above the tunnel crown into sculpted alpine peaks and ridges.
	const profile = Math.sin( tierFrac * Math.PI * 0.82 ) * Math.pow( tierFrac, 0.48 )
	const foothill = ( 1 - tierFrac ) * 2.2
	const height = 7.2 + profile * Math.max( 7.5, ridge ) + foothill

	const maxSpan = side > 0 ? 64 : 36
	const spur = 1 + Math.sin( angle * 6 + tierFrac * 2.2 + sidePhase ) * 0.08
	const lateral = ( 6.2 + tierFrac * maxSpan ) * spur
	return { lateral: side * lateral, height }
}

const framePoint = ( lateral, height ) => [
	frameCentre.x + frameRight.x * lateral,
	frameCentre.y + height,
	frameCentre.z + frameRight.z * lateral,
]

const bankedPoint = ( lateral, height, bank ) => framePoint(
	lateral * Math.cos( bank ) - height * Math.sin( bank ) * 0.18,
	lateral * Math.sin( bank ) + height,
)

/** Banked highway lanes and outer guardrails. */
const roadPoint = ( strand, bank ) => bankedPoint( ROAD_OFFSETS[strand], 0, bank )

/** Horizontal elevation contour lines stepping outward across both mountain ranges. */
const contourPoint = ( contourIndex, angle ) => {
	const isOuter = contourIndex < OUTER_CONTOURS
	const tier = isOuter ? contourIndex : contourIndex - OUTER_CONTOURS
	const count = isOuter ? OUTER_CONTOURS : INNER_CONTOURS
	const tierFrac = ( tier + 0.55 ) / count
	const { lateral, height } = mountainSurface( angle, isOuter ? 1 : -1, tierFrac )

	const rx = Math.cos( angle ) * 1.35
	const rz = Math.sin( angle ) * 0.85
	const rLen = Math.hypot( rx, rz )
	const blend = Math.min( 1, tierFrac * 0.85 + 0.25 )
	const nx = MathUtils.lerp( frameRight.x, rx / rLen, blend )
	const nz = MathUtils.lerp( frameRight.z, rz / rLen, blend )
	const nLen = Math.hypot( nx, nz )

	return [
		frameCentre.x + ( nx / nLen ) * lateral,
		frameCentre.y + height,
		frameCentre.z + ( nz / nLen ) * lateral,
	]
}

const loopStrandPoint = ( strand, angle ) => {
	const bank = samplePassFrame( angle, frameCentre, frameRight )
	if ( strand < ROAD_STRANDS ) return roadPoint( strand, bank )
	return contourPoint( strand - ROAD_STRANDS, angle )
}

/** A single freestanding open 3D tunnel arch rib perpendicular to the highway at `archIndex`. */
const buildArchPoints = ( archIndex, pointsPerArch ) => {
	const angle = ( archIndex / ARCH_COUNT ) * Math.PI * 2
	const bank = samplePassFrame( angle, frameCentre, frameRight )
	const crown = TUNNEL_CROWN * ( 1 + Math.sin( angle * 5 ) * 0.06 )
	return linePoints( pointsPerArch, t => {
		const theta = ( t * 2 - 1 ) * ( Math.PI * 0.5 )
		const lateral = Math.sin( theta ) * TUNNEL_HALF_WIDTH
		const height = TUNNEL_BASE_LIFT + Math.pow( Math.max( 0, Math.cos( theta ) ), 0.82 ) * crown
		return bankedPoint( lateral, height, bank )
	} )
}

/**
 * Build all polylines of the pass: 24 closed loops (road lanes + elevation contours)
 * followed by 250 separate open tunnel arches (`closed = false`).
 */
export const buildPassLines = ( pointsPerStrand, pointsPerArch ) => {
	const loops = times( LOOP_STRANDS, strand =>
		linePoints( pointsPerStrand, t => loopStrandPoint( strand, t * Math.PI * 2 ), { closed: true } ) )
	const arches = times( ARCH_COUNT, archIndex => buildArchPoints( archIndex, pointsPerArch ) )
	const closed = [
		...times( LOOP_STRANDS, () => true ),
		...times( ARCH_COUNT, () => false ),
	]
	return { lines: [...loops, ...arches], closed }
}
