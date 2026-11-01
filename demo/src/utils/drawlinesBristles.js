/**
 * Bristles of the Draw Lines demo: trails of points led by a spring, chasing the
 * pointer or replaying a stroke. MeshLine only ever sees their flat positions.
 */
import { MathUtils, Vector3 } from 'three/webgpu'

import { smoothstep } from '@/makio/utils/math'
import random from '@/makio/utils/random'
import { samplePathPoint } from '@/utils/drawlinesStrokes'
import { times } from '@/utils/points'

export const NUM_POINTS = 32
// How strongly each trail point chases the one ahead: lower is a longer brush.
const TRAIL_FOLLOW = 0.34
// Strokes replay a little slower than they were drawn, which keeps fast
// flicks smooth instead of jumping between frames.
const REPLAY_SPEED = 0.6
// Keep resting trails non-degenerate so their dynamic buffers retain capacity.
const TOPOLOGY_EPSILON = 0.0001
const force3 = new Vector3()
const pathPoint3 = new Vector3()

export function createLineState( lineIndex ) {
	const angle = random( 0, Math.PI * 2 )
	const radius = 0.2 + random( -0.3, 0.3 )
	const offset = new Vector3( Math.cos( angle ) * radius, Math.sin( angle ) * radius, 0 )
	const line = {
		points: times( NUM_POINTS, () => offset.clone() ),
		positions: new Float32Array( NUM_POINTS * 3 ),
		positionRangeOptions: { lineIndex },
		offset,
		speed: 0,
		endFade: 1,
		finishing: false,
		target: new Vector3(),
		velocity: new Vector3(),
		spring: 0.06 + random( -0.02, 0.02 ),
		friction: 0.85 + random( -0.05, 0.05 ),
		pathTime: random( 0, 10000 ),
		justTeleported: false,
	}
	writePointsToArray( line.points, line.positions )
	return line
}

// The opening flourish starts mid-replay, so the motion shows before the first drag.
export function seedPreviewFollowers( followers, path ) {
	const range = path.endTime - path.startTime

	for ( let followerIndex = 0; followerIndex < followers.length; followerIndex++ ) {
		const line = followers[followerIndex]
		const angle = followerIndex / followers.length * Math.PI * 2
		const radius = 0.08 + followerIndex % 3 * 0.05
		const phase = 0.1 + followerIndex / followers.length * 0.8
		line.offset.set( Math.cos( angle ) * radius, Math.sin( angle ) * radius, 0 )
		line.spring = 0.055 + followerIndex * 0.001
		line.friction = 0.88
		line.pathTime = phase * range
		line.speed = 0.22 + followerIndex % 4 * 0.03

		samplePathPoint( path, phase, line.target ).add( line.offset )
		for ( let pointIndex = 0; pointIndex < NUM_POINTS; pointIndex++ ) {
			const trailProgress = Math.max( 0, phase - pointIndex / ( NUM_POINTS - 1 ) * 0.18 )
			samplePathPoint( path, trailProgress, line.points[pointIndex] ).add( line.offset )
		}
		writePointsToArray( line.points, line.positions )
	}
}

export function updateLineOnPointer( line, pointer, mouseSpeed ) {
	line.speed = MathUtils.lerp( line.speed, mouseSpeed, 0.15 )
	if ( mouseSpeed < 0.005 ) line.velocity.multiplyScalar( 0.7 )
	line.target.set( pointer.x, pointer.y, 0 ).add( line.offset )
}

export function updateLineOnPath( line, path, dt ) {
	const range = Math.max( 1, path.endTime - path.startTime )
	line.pathTime += dt * REPLAY_SPEED
	line.finishing = line.pathTime >= range
	line.endFade = 1

	if ( line.finishing ) {
		const endPoint = path.points.at( -1 )
		// Each bristle rests at the end plus its own offset; measuring from the bare
		// end point left wide bristles waiting there forever.
		pathPoint3.set( endPoint.x, endPoint.y, 0 ).add( line.offset )
		const tailDistance = pathPoint3.distanceTo( line.points[NUM_POINTS - 1] )
		const timeFade = 1 - smoothstep( range, range + 340, line.pathTime )
		const tailFade = smoothstep( 0.04, 0.45, tailDistance )
		line.endFade = Math.min( timeFade, tailFade )

		if ( line.endFade <= 0.001 ) {
			restartLine( line, samplePathPoint( path, 0, pathPoint3 ) )
			return
		}
	}

	samplePathPoint( path, Math.min( line.pathTime / range, 1 ), pathPoint3 ).add( line.offset )
	line.speed = MathUtils.lerp( line.speed, line.target.distanceTo( pathPoint3 ) * 0.5, 0.15 )
	line.target.copy( pathPoint3 )
}

// Tail first, so every point chases where the one ahead was last frame.
export function advanceTrail( line ) {
	if ( line.justTeleported ) {
		line.justTeleported = false
		return
	}

	const { points, target, velocity } = line
	for ( let k = NUM_POINTS - 1; k > 0; k-- ) points[k].lerp( points[k - 1], TRAIL_FOLLOW )

	if ( line.finishing ) {
		velocity.set( 0, 0, 0 )
		points[0].lerp( target, TRAIL_FOLLOW )
		return
	}
	force3.copy( target ).sub( points[0] ).multiplyScalar( line.spring )
	velocity.add( force3 ).multiplyScalar( line.friction )
	points[0].add( velocity )
}

export function collapseLine( line, { x, y } ) {
	line.speed = 0
	line.velocity.set( 0, 0, 0 )
	line.target.set( x, y, 0 ).add( line.offset )
	for ( let i = 0; i < NUM_POINTS; i++ ) line.points[i].copy( line.target )
}

export function restartLine( line, start ) {
	collapseLine( line, start )
	line.pathTime = 0
	line.endFade = 0
	line.finishing = false
	line.justTeleported = true
}

export function writePointsToArray( points, positions ) {
	for ( let i = 0; i < NUM_POINTS; i++ ) {
		const point = points[i]
		const offset = i * 3
		positions[offset] = point.x - i * TOPOLOGY_EPSILON
		positions[offset + 1] = point.y
		positions[offset + 2] = point.z
		// A trail drifting left closes its x gap through exactly the epsilon, and
		// Float32 rounding can then fold this point onto the previous one.
		if (
			i > 0 &&
			positions[offset] === positions[offset - 3] &&
			positions[offset + 1] === positions[offset - 2] &&
			positions[offset + 2] === positions[offset - 1]
		) {
			positions[offset] -= TOPOLOGY_EPSILON
		}
	}
}
