import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'
import { Group, MathUtils, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3 } from 'three/webgpu'

import { linePoints, times } from '@/utils/points'

/**
 * The alpine range of the GPU Culling demo: a square of ridged mountains drawn as parallel
 * ridgelines, with a valley carved along a looping pass and a tunnel over its road.
 */
export const TERRAIN_SIZE = 320

const HALF = TERRAIN_SIZE * 0.5
const PEAK = 34
const TUNNEL_HALF_WIDTH = 5
export const TUNNEL_HEIGHT = 6.2
// Below 1 an arch squares up: straighter walls and a flatter ceiling, with round shoulders.
const ARCH_ROUNDING = 0.62
// Where the rails run along the arches, from the left foot (-1) over the crown (0) to the
// right foot (1), and where the lane lines run across the road.
const RAILS = times( 13, rail => ( rail - 6 ) * 0.15 )
const LANES = [-1, -0.33, 0.33, 1]

/** Lines that run a whole lap of the tunnel: its rails, then its lanes. */
export const TUNNEL_LAPS = RAILS.length + LANES.length

const perlin = new ImprovedNoise()
const centre = new Vector3()
const tangent = new Vector3()

const passRadius = angle => 92 + Math.sin( angle * 2 - 0.45 ) * 14 + Math.cos( angle * 3 + 0.7 ) * 9

/** Point of the pass at `angle` around the range, on the valley floor. */
export const passPoint = ( angle, target ) => {
	const radius = passRadius( angle )
	return target.set( Math.cos( angle ) * radius, 0, Math.sin( angle ) * radius )
}

/** Height of the range at `x`, `z`: ridged noise, flat under the road and at the rim. */
export const terrainHeight = ( x, z ) => {
	let ridges = 0
	for ( let octave = 0, frequency = 0.011, gain = 1; octave < 4; octave++, frequency *= 2.1, gain *= 0.5 ) {
		ridges += ( 1 - Math.abs( perlin.noise( x * frequency, octave * 9.1, z * frequency ) ) ) ** 2 * gain
	}
	const fromPass = Math.abs( Math.hypot( x, z ) - passRadius( Math.atan2( z, x ) ) )
	const valley = MathUtils.smoothstep( fromPass, TUNNEL_HALF_WIDTH + 2, 44 )
	const rim = 1 - MathUtils.smoothstep( Math.max( Math.abs( x ), Math.abs( z ) ), HALF - 22, HALF )
	return Math.max( 0, ridges - 0.7 ) ** 1.3 * PEAK * valley * rim
}

/** `rows` ridgelines of `pointsPerRow` points each, running along X and spread along Z. */
export const buildRidgelines = ( rows, pointsPerRow ) => times( rows, row => {
	const z = ( ( row + 0.5 ) / rows - 0.5 ) * TERRAIN_SIZE
	return linePoints( pointsPerRow, t => {
		const x = ( t - 0.5 ) * TERRAIN_SIZE
		return [x, terrainHeight( x, z ), z]
	} )
} )

/** Point of the tunnel at `angle` around the pass, `across` the road and `height` above it. */
const tunnelPoint = ( angle, across, height ) => {
	passPoint( angle, centre )
	passPoint( angle + 1e-3, tangent ).sub( centre ).normalize()
	return [centre.x + tangent.z * across, height, centre.z - tangent.x * across]
}

/** Point of the arch at `angle`: `bend` goes from its left foot (-1) over the crown (0) to its right foot (1). */
const archPoint = ( angle, bend ) => {
	const across = Math.sin( bend * Math.PI * 0.5 )
	const up = Math.max( 0, Math.cos( bend * Math.PI * 0.5 ) )
	return tunnelPoint(
		angle,
		Math.sign( across ) * Math.abs( across ) ** ARCH_ROUNDING * TUNNEL_HALF_WIDTH,
		up ** ARCH_ROUNDING * TUNNEL_HEIGHT,
	)
}

/**
 * The tunnel over the pass: `arches` ribs across the road, then the rails along them and
 * the lane lines on the road, each one lap of `pointsPerLap` points.
 */
export const buildTunnel = ( arches, pointsPerArch, pointsPerLap ) => [
	...times( arches, arch => linePoints( pointsPerArch, t => archPoint( arch / arches * Math.PI * 2, t * 2 - 1 ) ) ),
	...RAILS.map( bend => linePoints( pointsPerLap, t => archPoint( t * Math.PI * 2, bend ) ) ),
	...LANES.map( lane => linePoints( pointsPerLap, t => tunnelPoint( t * Math.PI * 2, lane * TUNNEL_HALF_WIDTH, 0.06 ) ) ),
]

/**
 * The ground under the ridgelines, so a mountain hides the lines behind it, on a floor
 * in the `background` colour that hides whatever dips below the range.
 */
export const buildGround = ( color, background ) => {
	const geometry = new PlaneGeometry( TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SIZE ).rotateX( -Math.PI * 0.5 )
	const position = geometry.getAttribute( 'position' )
	for ( let i = 0; i < position.count; i++ ) {
		position.setY( i, terrainHeight( position.getX( i ), position.getZ( i ) ) - 0.3 )
	}
	const floor = new Mesh( new PlaneGeometry( 4000, 4000 ).rotateX( -Math.PI * 0.5 ), new MeshBasicNodeMaterial( { color: background, fog: false } ) )
	floor.position.y = -1
	return new Group().add( new Mesh( geometry, new MeshBasicNodeMaterial( { color } ) ), floor )
}
