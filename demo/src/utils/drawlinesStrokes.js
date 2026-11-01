/**
 * Timed strokes of the Draw Lines demo: recording a drag, the opening flourish,
 * and sampling a stroke at any point of its replay.
 */
import { MathUtils } from 'three/webgpu'

import { times } from '@/utils/points'

const PREVIEW_POINT_COUNT = 120
const PREVIEW_PATH_DURATION = 5600

const createPath = points => ( { points, startTime: points[0].time, endTime: points.at( -1 ).time } )

// A cursive flourish: loops written left to right, like a signature.
export function createPreviewPath() {
	return createPath( times( PREVIEW_POINT_COUNT, index => {
		const progress = index / ( PREVIEW_POINT_COUNT - 1 )
		const loops = progress * Math.PI * 2 * 3.5
		return {
			x: ( progress - 0.5 ) * 7.6 - Math.sin( loops ) * 0.9,
			y: Math.cos( loops ) * 1.15 + Math.sin( progress * Math.PI * 2 ) * 0.45,
			time: progress * PREVIEW_PATH_DURATION,
		}
	} ) )
}

export function addStrokePoint( stroke, { x, y } ) {
	const last = stroke.at( -1 )
	if ( !last || Math.hypot( x - last.x, y - last.y ) > 0.01 ) stroke.push( { x, y, time: performance.now() } )
}

export function createStrokePath( stroke ) {
	retimeFastStroke( stroke )
	return createPath( stroke )
}

// A flick can arrive as a couple of samples with almost no elapsed time; give it
// a plausible duration from its length so the followers can still replay it.
function retimeFastStroke( stroke ) {
	const duration = stroke.at( -1 ).time - stroke[0].time
	if ( duration >= 120 ) return
	let distance = 0
	for ( let i = 1; i < stroke.length; i++ ) {
		distance += Math.hypot( stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y )
		stroke[i].time = stroke[0].time + distance * 90
	}
}

/** Write the position at `percent` of the path's duration into `target`, and return it. */
export function samplePathPoint( path, percent, target ) {
	const { points, startTime, endTime } = path
	const targetTime = startTime + ( endTime - startTime ) * percent
	let low = 0
	let high = points.length - 2

	while ( low <= high ) {
		const mid = ( low + high ) >>> 1
		if ( targetTime < points[mid].time ) {
			high = mid - 1
		} else if ( targetTime > points[mid + 1].time ) {
			low = mid + 1
		} else {
			low = mid
			break
		}
	}

	const index = MathUtils.clamp( low, 0, points.length - 2 )
	const pointA = points[index]
	const pointB = points[index + 1]

	const segmentDuration = pointB.time - pointA.time
	const interpolation = segmentDuration > 0 ? ( targetTime - pointA.time ) / segmentDuration : 0
	return target.set(
		MathUtils.lerp( pointA.x, pointB.x, interpolation ),
		MathUtils.lerp( pointA.y, pointB.y, interpolation ),
		0
	)
}
