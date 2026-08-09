import assert from 'node:assert/strict'
import test from 'node:test'

import {
	Matrix4,
	Vector4,
	WebGLCoordinateSystem,
	WebGPUCoordinateSystem,
} from 'three'

const WEBGL = 'webgl'
const WEBGPU = 'webgpu'
const PARAMETER_EPSILON = 1e-12

const closeTo = ( actual, expected, epsilon = 1e-12 ) => {
	assert.ok(
		Math.abs( actual - expected ) <= epsilon,
		`expected ${actual} to be within ${epsilon} of ${expected}`
	)
}

const clipPlanes = ( {
	coordinateSystem,
	reversedDepth = false,
	clipXY = true,
	xyPadding = [0, 0],
	minimumW = 0,
} ) => {
	if ( coordinateSystem !== WEBGL && coordinateSystem !== WEBGPU ) {
		throw new Error( `unknown coordinate system: ${coordinateSystem}` )
	}

	const planes = []
	if ( minimumW > 0 ) {
		planes.push( { name: 'positive-w guard', distance: p => p[3] - minimumW } )
	}
	if ( clipXY ) {
		const [padX, padY] = xyPadding
		planes.push(
			{ name: 'left', distance: p => p[0] + ( 1 + padX ) * p[3] },
			{ name: 'right', distance: p => ( 1 + padX ) * p[3] - p[0] },
			{ name: 'bottom', distance: p => p[1] + ( 1 + padY ) * p[3] },
			{ name: 'top', distance: p => ( 1 + padY ) * p[3] - p[1] },
		)
	}

	// Reversed depth uses a zero-to-one clip range on both Three backends.
	// The geometric volume is still 0 <= z <= w, but near/far swap meaning.
	if ( reversedDepth ) {
		planes.push(
			{ name: 'far', distance: p => p[2] },
			{ name: 'near', distance: p => p[3] - p[2] },
		)
	} else if ( coordinateSystem === WEBGPU ) {
		planes.push(
			{ name: 'near', distance: p => p[2] },
			{ name: 'far', distance: p => p[3] - p[2] },
		)
	} else {
		planes.push(
			{ name: 'near', distance: p => p[3] + p[2] },
			{ name: 'far', distance: p => p[3] - p[2] },
		)
	}
	return planes
}

// Liang-Barsky/Cyrus-Beck in homogeneous clip coordinates. The returned
// parameters always refer to the original, unclipped source segment.
const clipHomogeneous = ( start, end, options ) => {
	let enter = 0
	let exit = 1
	let enterPlane = null
	let exitPlane = null

	for ( const plane of clipPlanes( options ) ) {
		const startDistance = plane.distance( start )
		const endDistance = plane.distance( end )
		if ( !Number.isFinite( startDistance ) || !Number.isFinite( endDistance ) ) {
			return { accepted: false, drawable: false, reason: 'non-finite' }
		}
		if ( startDistance < 0 && endDistance < 0 ) {
			return { accepted: false, drawable: false, reason: plane.name }
		}
		if ( startDistance < 0 || endDistance < 0 ) {
			const denominator = startDistance - endDistance
			assert.notEqual( denominator, 0, 'opposite classifications require a finite crossing' )
			const crossing = startDistance / denominator
			if ( startDistance < 0 && crossing > enter ) {
				enter = crossing
				enterPlane = plane.name
			} else if ( endDistance < 0 && crossing < exit ) {
				exit = crossing
				exitPlane = plane.name
			}
		}
		if ( enter > exit ) return { accepted: false, drawable: false, reason: plane.name }
	}

	const lerp = t => start.map( ( value, index ) => value + ( end[index] - value ) * t )
	return {
		accepted: true,
		drawable: exit - enter > PARAMETER_EPSILON,
		start: lerp( enter ),
		end: lerp( exit ),
		range: [enter, exit],
		enterPlane,
		exitPlane,
	}
}

const transform = ( matrix, point ) => {
	const transformed = new Vector4( ...point ).applyMatrix4( matrix )
	return transformed.toArray()
}

const perspectiveMatrix = ( coordinateSystem, reversedDepth ) => new Matrix4().makePerspective(
	-1,
	1,
	1,
	-1,
	1,
	100,
	coordinateSystem,
	reversedDepth
)

const screenFractionForHomogeneousParameter = ( t, w0, w1 ) => (
	t * w1 / ( ( 1 - t ) * w0 + t * w1 )
)

const perspectiveInterpolate = ( a0, a1, screenFraction, w0, w1 ) => {
	const numerator = ( 1 - screenFraction ) * a0 / w0 + screenFraction * a1 / w1
	const denominator = ( 1 - screenFraction ) / w0 + screenFraction / w1
	return numerator / denominator
}

const isReversal = ( previous, current, next, thresholdRadians ) => {
	const incomingX = current[0] - previous[0]
	const incomingY = current[1] - previous[1]
	const outgoingX = next[0] - current[0]
	const outgoingY = next[1] - current[1]
	const incomingLengthSquared = incomingX * incomingX + incomingY * incomingY
	const outgoingLengthSquared = outgoingX * outgoingX + outgoingY * outgoingY
	if ( incomingLengthSquared === 0 || outgoingLengthSquared === 0 ) return true
	const directionDot = incomingX * outgoingX + incomingY * outgoingY
	const directionCross = incomingX * outgoingY - incomingY * outgoingX
	const lengthProduct = incomingLengthSquared * outgoingLengthSquared
	const boundaryTolerance = 8 * Number.EPSILON * lengthProduct
	return (
		directionDot < 0 &&
		directionCross * directionCross <= (
			Math.sin( thresholdRadians ) ** 2 * lengthProduct + boundaryTolerance
		)
	)
}

const partitionOpenSegmentsAtReversals = ( points, thresholdRadians ) => {
	const breaks = new Set()
	for ( let point = 1; point < points.length - 1; point++ ) {
		if ( isReversal( points[point - 1], points[point], points[point + 1], thresholdRadians ) ) {
			breaks.add( point )
		}
	}

	const runs = []
	let run = []
	for ( let segment = 0; segment < points.length - 1; segment++ ) {
		if ( segment > 0 && breaks.has( segment ) ) {
			runs.push( run )
			run = []
		}
		run.push( segment )
	}
	if ( run.length > 0 ) runs.push( run )
	return { breaks, runs }
}

const partitionClosedSegmentsAtReversals = ( points, thresholdRadians ) => {
	const count = points.length
	const breaks = new Set()
	for ( let point = 0; point < count; point++ ) {
		if ( isReversal(
			points[( point + count - 1 ) % count],
			points[point],
			points[( point + 1 ) % count],
			thresholdRadians
		) ) breaks.add( point )
	}
	if ( breaks.size === 0 ) {
		return { breaks, runs: [Array.from( { length: count }, ( _, segment ) => segment )], closed: true }
	}

	// The smallest logical source vertex is the canonical seam. A GPU prefix
	// pass can obtain the same choice with an atomic minimum.
	const start = Math.min( ...breaks )
	const runs = []
	let run = []
	for ( let offset = 0; offset < count; offset++ ) {
		const segment = ( start + offset ) % count
		if ( offset > 0 && breaks.has( segment ) ) {
			runs.push( run )
			run = []
		}
		run.push( segment )
	}
	if ( run.length > 0 ) runs.push( run )
	return { breaks, runs, closed: false }
}

test( 'Three projection matrices match WebGL, WebGPU, and reversed clip contracts', () => {
	const cases = [
		{ coordinate: WebGLCoordinateSystem, oracle: WEBGL, reversed: false, nearNDC: -1, farNDC: 1 },
		{ coordinate: WebGPUCoordinateSystem, oracle: WEBGPU, reversed: false, nearNDC: 0, farNDC: 1 },
		{ coordinate: WebGLCoordinateSystem, oracle: WEBGL, reversed: true, nearNDC: 1, farNDC: 0 },
		{ coordinate: WebGPUCoordinateSystem, oracle: WEBGPU, reversed: true, nearNDC: 1, farNDC: 0 },
	]

	for ( const { coordinate, oracle, reversed, nearNDC, farNDC } of cases ) {
		const matrix = perspectiveMatrix( coordinate, reversed )
		const near = transform( matrix, [0, 0, -1, 1] )
		const far = transform( matrix, [0, 0, -100, 1] )
		closeTo( near[2] / near[3], nearNDC )
		closeTo( far[2] / far[3], farNDC, 1e-10 )
		assert.equal( clipHomogeneous( near, far, {
			coordinateSystem: oracle,
			reversedDepth: reversed,
		} ).drawable, true )
	}
} )

test( 'normal WebGL uses -w <= z while WebGPU and reversed WebGL use 0 <= z', () => {
	const start = [0, 0, -0.5, 1]
	const end = [0, 0, 0.5, 1]
	const gl = clipHomogeneous( start, end, { coordinateSystem: WEBGL } )
	const gpu = clipHomogeneous( start, end, { coordinateSystem: WEBGPU } )
	const reversedGL = clipHomogeneous( start, end, {
		coordinateSystem: WEBGL,
		reversedDepth: true,
	} )

	assert.deepEqual( gl.range, [0, 1] )
	closeTo( gpu.range[0], 0.5 )
	closeTo( reversedGL.range[0], 0.5 )
	assert.equal( gpu.enterPlane, 'near' )
	assert.equal( reversedGL.enterPlane, 'far' )
} )

test( 'reversed depth swaps semantic near and far without changing the zero-to-one volume', () => {
	const result = clipHomogeneous(
		[0, 0, 1.5, 1],
		[0, 0, 0.5, 1],
		{ coordinateSystem: WEBGPU, reversedDepth: true }
	)

	closeTo( result.range[0], 0.5 )
	closeTo( result.start[2], result.start[3] )
	assert.equal( result.enterPlane, 'near' )
} )

test( 'camera-plane crossings enter through a real homogeneous plane before perspective divide', () => {
	const result = clipHomogeneous(
		[0.25, 0, 0, -1],
		[0.25, 0, 0.1, 1],
		{ coordinateSystem: WEBGPU }
	)

	closeTo( result.range[0], 0.625 )
	closeTo( result.start[3], 0.25 )
	closeTo( result.start[0] / result.start[3], 1 )
	assert.ok( result.start.every( Number.isFinite ) )
	assert.equal( result.enterPlane, 'right' )
} )

test( 'homogeneous clipping is invariant under positive projective rescaling', () => {
	const start = [0.25, 0, 0, -1]
	const end = [0.25, 0, 0.1, 1]
	for ( const scale of [1e-20, 1, 1e20] ) {
		const result = clipHomogeneous(
			start.map( value => value * scale ),
			end.map( value => value * scale ),
			{ coordinateSystem: WEBGPU }
		)
		closeTo( result.range[0], 0.625 )
		closeTo( result.start[0] / result.start[3], 1 )
	}
} )

test( 'an exact projective origin needs an explicit positive-w policy', () => {
	const unguarded = clipHomogeneous(
		[0, 0, 0, 0],
		[0, 0, 0.5, 1],
		{ coordinateSystem: WEBGPU }
	)
	assert.equal( unguarded.start[3], 0 )
	assert.equal( Number.isNaN( unguarded.start[0] / unguarded.start[3] ), true )

	const guarded = clipHomogeneous(
		[0, 0, 0, 0],
		[0, 0, 0.5, 1],
		{ coordinateSystem: WEBGPU, minimumW: 1e-6 }
	)
	closeTo( guarded.range[0], 1e-6 )
	closeTo( guarded.start[2] / guarded.start[3], 0.5 )
	assert.ok( guarded.start[3] > 0 )
} )

test( 'boundary contacts are accepted but zero-length intervals are not drawable topology', () => {
	const boundary = [-1, 0, 0.5, 1]
	const inside = [0, 0, 0.5, 1]
	const outside = [-2, 0, 0.5, 1]

	assert.deepEqual(
		clipHomogeneous( boundary, inside, { coordinateSystem: WEBGPU } ).range,
		[0, 1]
	)
	assert.equal(
		clipHomogeneous( boundary, outside, { coordinateSystem: WEBGPU } ).drawable,
		false
	)
	assert.equal(
		clipHomogeneous( outside, boundary, { coordinateSystem: WEBGPU } ).drawable,
		false
	)
} )

test( 'homogeneous clipping preserves source parameter and perspective varyings', () => {
	// Both endpoints straddle x + w = 0 by equal homogeneous distances, so the
	// source intersection is t=.5. Their very different w values put the same
	// boundary at screen-linear fraction 10/11, which must not drive attributes.
	const start = [-2, 0, 0.5, 1]
	const end = [-9, 0, 5, 10]
	const result = clipHomogeneous( start, end, { coordinateSystem: WEBGPU } )
	const t = result.range[0]
	const screenFraction = screenFractionForHomogeneousParameter( t, start[3], end[3] )

	closeTo( t, 0.5 )
	closeTo( result.start[0] / result.start[3], -1 )
	closeTo( screenFraction, 10 / 11 )
	closeTo( perspectiveInterpolate( 0, 1, screenFraction, start[3], end[3] ), t )
	assert.notEqual( screenFraction, t )
} )

test( 'canonical side clipping must be padded for a wide offscreen centerline', () => {
	const start = [1.01, -0.5, 0.5, 1]
	const end = [1.01, 0.5, 0.5, 1]
	const canonical = clipHomogeneous( start, end, { coordinateSystem: WEBGPU } )
	const depthOnly = clipHomogeneous( start, end, {
		coordinateSystem: WEBGPU,
		clipXY: false,
	} )
	const padded = clipHomogeneous( start, end, {
		coordinateSystem: WEBGPU,
		xyPadding: [0.02, 0.02],
	} )

	assert.equal( canonical.accepted, false )
	assert.equal( depthOnly.drawable, true )
	assert.equal( padded.drawable, true )
} )

test( 'random adversarial segments are endpoint-order symmetric and finish inside every plane', () => {
	let state = 0x5eed1234
	const random = () => {
		state = ( Math.imul( state, 1664525 ) + 1013904223 ) >>> 0
		return state / 0x100000000
	}
	const conventions = [
		{ coordinateSystem: WEBGL, reversedDepth: false },
		{ coordinateSystem: WEBGPU, reversedDepth: false },
		{ coordinateSystem: WEBGL, reversedDepth: true },
		{ coordinateSystem: WEBGPU, reversedDepth: true },
	]

	for ( const convention of conventions ) {
		const planes = clipPlanes( convention )
		for ( let iteration = 0; iteration < 2000; iteration++ ) {
			const start = Array.from( { length: 4 }, () => random() * 10 - 5 )
			const end = Array.from( { length: 4 }, () => random() * 10 - 5 )
			const forward = clipHomogeneous( start, end, convention )
			const backward = clipHomogeneous( end, start, convention )
			assert.equal( forward.accepted, backward.accepted )
			assert.equal( forward.drawable, backward.drawable )
			if ( !forward.accepted ) continue

			closeTo( forward.range[0], 1 - backward.range[1], 1e-10 )
			closeTo( forward.range[1], 1 - backward.range[0], 1e-10 )
			for ( const endpoint of [forward.start, forward.end] ) {
				const scale = Math.max( 1, ...endpoint.map( Math.abs ) )
				for ( const plane of planes ) {
					assert.ok( plane.distance( endpoint ) >= -1e-12 * scale, plane.name )
				}
			}
		}
	}
} )

test( 'exact and sign-perturbed near reversals split into independent runs', () => {
	const threshold = Math.PI / 180
	for ( const perturbation of [0, 1e-6, -1e-6] ) {
		const { breaks, runs } = partitionOpenSegmentsAtReversals( [
			[0, 0],
			[1, 0],
			[0, perturbation],
			[-1, perturbation],
		], threshold )
		assert.equal( breaks.has( 1 ), true )
		assert.deepEqual( runs, [[0], [1, 2]] )
		assert.deepEqual( runs.flat(), [0, 1, 2] )
	}
} )

test( 'perspective can create a mandatory reversal that object-space simplification would remove', () => {
	const source = [
		[0, 0, -0.1],
		[0.1, 0, -0.2],
		[0.2, 0, -0.41],
	]
	const incoming = source[1].map( ( value, axis ) => value - source[0][axis] )
	const outgoing = source[2].map( ( value, axis ) => value - source[1][axis] )
	const objectDot = incoming.reduce( ( sum, value, axis ) => sum + value * outgoing[axis], 0 )
	assert.ok( objectDot > 0, 'the source-space bend is not a reversal' )

	const matrix = new Matrix4().makePerspective(
		-0.01,
		0.01,
		0.01,
		-0.01,
		0.01,
		10,
		WebGPUCoordinateSystem,
		false
	)
	const projected = source.map( point => {
		const clip = transform( matrix, [...point, 1] )
		return [clip[0] / clip[3], clip[1] / clip[3]]
	} )
	closeTo( projected[0][0], 0 )
	closeTo( projected[1][0], 0.5 )
	closeTo( projected[2][0], 20 / 41 )
	assert.equal( isReversal( projected[0], projected[1], projected[2], Math.PI / 180 ), true )

	const chordX = source[2][0] - source[0][0]
	const chordZ = source[2][2] - source[0][2]
	const pointX = source[1][0] - source[0][0]
	const pointZ = source[1][2] - source[0][2]
	const chordDistance = Math.abs( pointX * chordZ - pointZ * chordX ) / Math.hypot( chordX, chordZ )
	assert.ok( chordDistance < 0.03, 'a valid .03 local tolerance can skip the cusp point' )
} )

test( 'the reversal predicate has a deterministic inclusive threshold', () => {
	const threshold = Math.PI / 180
	const height = Math.tan( threshold )
	const onBoundary = isReversal( [0, 0], [1, 0], [0, height], threshold )
	const outside = isReversal( [0, 0], [1, 0], [0, height * 1.01], threshold )

	assert.equal( onBoundary, true )
	assert.equal( outside, false )
} )

test( 'reversing an open path reverses run order without changing ownership', () => {
	const threshold = Math.PI / 180
	const points = [[0, 0], [1, 0], [0, 0], [-1, 1], [-2, 2]]
	const forward = partitionOpenSegmentsAtReversals( points, threshold ).runs
	const backward = partitionOpenSegmentsAtReversals( points.toReversed(), threshold ).runs

	assert.deepEqual( forward.map( run => run.length ), backward.map( run => run.length ).toReversed() )
	assert.deepEqual( forward.flat(), [0, 1, 2, 3] )
	assert.deepEqual( backward.flat(), [0, 1, 2, 3] )
} )

test( 'closed reversal runs use the lowest break as a canonical seam and own every segment once', () => {
	const { breaks, runs, closed } = partitionClosedSegmentsAtReversals( [
		[0, 0],
		[1, 0],
		[0, 0],
		[0, 1],
	], Math.PI / 180 )

	assert.deepEqual( [...breaks], [1, 3] )
	assert.deepEqual( runs, [[1, 2], [3, 0]] )
	assert.deepEqual( runs.flat().toSorted( ( a, b ) => a - b ), [0, 1, 2, 3] )
	assert.equal( closed, false )
} )
