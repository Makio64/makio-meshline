import assert from 'node:assert/strict'
import test from 'node:test'

import {
	PerspectiveCamera,
	Vector4,
	WebGLCoordinateSystem,
	WebGPUCoordinateSystem,
} from 'three/webgpu'

import {
	SCREEN_DIRECTION_EPSILON,
	SCREEN_REVERSAL_DOT_THRESHOLD,
} from '../src/MeshLineNodeMaterial.js'
import MeshLineGeometry from '../src/MeshLineGeometry.js'

const COORDINATE_SYSTEMS = [WebGLCoordinateSystem, WebGPUCoordinateSystem]
const ASPECT = 16 / 9
const COPIES_PER_POINT = 4

const closeTo = ( actual, expected, epsilon = 1e-12 ) => {
	assert.ok(
		Math.abs( actual - expected ) <= epsilon,
		`expected ${actual} to be within ${epsilon} of ${expected}`,
	)
}

const createCamera = coordinateSystem => {
	const camera = new PerspectiveCamera( 55, ASPECT, 0.1, 100 )
	camera.coordinateSystem = coordinateSystem
	camera.updateProjectionMatrix()
	return camera
}

const projectPoint = ( camera, point ) => {
	const clip = new Vector4( point[0], point[1], point[2], 1 )
		.applyMatrix4( camera.projectionMatrix )
	return [clip.x / clip.w * camera.aspect, clip.y / clip.w]
}

const getVertex = ( attribute, index ) => {
	const offset = index * attribute.itemSize
	return Array.from( attribute.array.slice( offset, offset + attribute.itemSize ) )
}

const subtract2 = ( a, b ) => [a[0] - b[0], a[1] - b[1]]
const length2 = value => Math.hypot( value[0], value[1] )
const dot2 = ( a, b ) => a[0] * b[0] + a[1] * b[1]
const add2 = ( a, b ) => [a[0] + b[0], a[1] + b[1]]

const normalize2 = value => {
	const length = length2( value )
	assert.ok( length > 0, 'the direction must be defined' )
	return [value[0] / length, value[1] / length]
}

const resolveOffset = ( direction1, direction2, side, width = 1 ) => {
	const sum = add2( direction1, direction2 )
	const sumLength = length2( sum )
	assert.ok( sumLength > 0, 'role-local directions must produce a finite frame' )
	const halfWidth = width / sumLength
	return [-sum[1] / sumLength * halfWidth * side, sum[0] / sumLength * halfWidth * side]
}

const resolveRoleOffsets = ( incoming, outgoing, split ) => {
	const incomingPair = split ? [incoming, incoming] : [incoming, outgoing]
	const outgoingPair = split ? [outgoing, outgoing] : [incoming, outgoing]
	return [
		resolveOffset( ...incomingPair, 1 ),
		resolveOffset( ...incomingPair, -1 ),
		resolveOffset( ...outgoingPair, 1 ),
		resolveOffset( ...outgoingPair, -1 ),
	]
}

const assertVectorClose = ( actual, expected ) => {
	closeTo( actual[0], expected[0] )
	closeTo( actual[1], expected[1] )
}

test( 'an end-on billboard body is classified as a projection collapse', () => {
	// These endpoints lie on the same eye ray, so perspective division collapses
	// the centerline to one point even though the source segment is substantial.
	// Four-copy topology lets the material hide only this body's role copies.
	const start = [0.7, 0.4, -10]
	const end = [1.4, 0.8, -20]
	const sourceLength = Math.hypot(
		end[0] - start[0],
		end[1] - start[1],
		end[2] - start[2],
	)
	const results = []
	assert.ok( sourceLength > 10 )

	for ( const coordinateSystem of COORDINATE_SYSTEMS ) {
		const camera = createCamera( coordinateSystem )
		const chord = subtract2( projectPoint( camera, end ), projectPoint( camera, start ) )
		const reversedChord = subtract2( projectPoint( camera, start ), projectPoint( camera, end ) )
		const bodyVisible = length2( chord ) >= SCREEN_DIRECTION_EPSILON

		assert.ok( length2( chord ) <= SCREEN_DIRECTION_EPSILON )
		assert.ok( length2( reversedChord ) <= SCREEN_DIRECTION_EPSILON )
		assert.equal( bodyVisible, false )
		results.push( chord )
	}

	closeTo( results[0][0], results[1][0] )
	closeTo( results[0][1], results[1][1] )
} )

test( 'a perspective-induced false reversal resolves to segment-local butt directions', () => {
	// The middle point is only slightly off the shared eye ray. Its two NDC
	// chords point in exactly opposite Y directions even though both source
	// segments continue forward through view space.
	const points = [
		[1, 0, -10],
		[2, 0.000002, -20],
		[3, 0, -30],
	]
	const sourceIncoming = points[1].map( ( value, axis ) => value - points[0][axis] )
	const sourceOutgoing = points[2].map( ( value, axis ) => value - points[1][axis] )
	const sourceDot = sourceIncoming.reduce( ( sum, value, axis ) => (
		sum + value * sourceOutgoing[axis]
	), 0 )
	const results = []
	assert.ok( sourceDot > 0, 'the source path must continue forward' )

	for ( const coordinateSystem of COORDINATE_SYSTEMS ) {
		const camera = createCamera( coordinateSystem )
		const projected = points.map( point => projectPoint( camera, point ) )
		const screenDeltas = [
			subtract2( projected[1], projected[0] ),
			subtract2( projected[2], projected[1] ),
		]
		const screenDirections = screenDeltas.map( normalize2 )
		const screenDot = dot2( screenDirections[0], screenDirections[1] )
		// At a classified reversal, incoming copies reuse the incoming body
		// direction for both sides of their local join calculation; outgoing
		// copies do the same with the outgoing body direction.
		const incomingRoleDirections = [screenDirections[0], screenDirections[0]]
		const outgoingRoleDirections = [screenDirections[1], screenDirections[1]]

		assert.ok( screenDeltas.every( delta => length2( delta ) > SCREEN_DIRECTION_EPSILON ) )
		assert.ok( screenDot <= SCREEN_REVERSAL_DOT_THRESHOLD )
		closeTo( dot2( incomingRoleDirections[0], incomingRoleDirections[1] ), 1 )
		closeTo( dot2( outgoingRoleDirections[0], outgoingRoleDirections[1] ), 1 )
		assert.ok( dot2( incomingRoleDirections[0], outgoingRoleDirections[0] ) <= SCREEN_REVERSAL_DOT_THRESHOLD )
		results.push( screenDot )
	}

	closeTo( results[0], results[1] )
} )

test( 'four role copies weld supported joins and split reversal bodies', () => {
	const incoming = [1, 0]
	const outgoing = normalize2( [1, 1] )
	const supported = resolveRoleOffsets( incoming, outgoing, false )

	assert.ok( dot2( incoming, outgoing ) > SCREEN_REVERSAL_DOT_THRESHOLD )
	assertVectorClose( supported[0], supported[2] )
	assertVectorClose( supported[1], supported[3] )
	assertVectorClose( supported[0], supported[1].map( value => -value ) )

	const reversed = resolveRoleOffsets( incoming, [-1, 0], true )
	assertVectorClose( reversed[0], [0, 0.5] )
	assertVectorClose( reversed[1], [0, -0.5] )
	assertVectorClose( reversed[2], [0, -0.5] )
	assertVectorClose( reversed[3], [0, 0.5] )
	assert.notDeepEqual( reversed[0], reversed[2] )
} )

test( 'four-copy geometry assigns role-local bodies without implicit join triangles', () => {
	const points = new Float32Array( [
		-1, 0, -5,
		0, 1, -6,
		2, 0, -7,
	] )
	const geometry = new MeshLineGeometry( {
		lines: points,
		needsNext: true,
		needsPrevious: true,
		needsProgress: true,
		needsSide: true,
		needsUV: true,
		needsWidth: true,
		widthCallback: ( _progress, point ) => point + 1,
	} )
	const position = geometry.getAttribute( 'position' )
	const previous = geometry.getAttribute( 'previous' )
	const next = geometry.getAttribute( 'next' )
	const progress = geometry.getAttribute( 'progress' )
	const side = geometry.getAttribute( 'side' )
	const joinRole = geometry.getAttribute( 'joinRole' )
	const uv = geometry.getAttribute( 'uv' )
	const width = geometry.getAttribute( 'width' )

	assert.equal( position.count, 3 * COPIES_PER_POINT )
	assert.deepEqual( Array.from( geometry.getIndex().array ), [
		2, 3, 4, 4, 3, 5,
		6, 7, 8, 8, 7, 9,
	] )
	assert.equal( geometry.getIndex().count, ( 3 - 1 ) * 6, 'CPU billboard topology has no join triangles' )

	for ( let point = 0; point < 3; point++ ) {
		const base = point * COPIES_PER_POINT
		const copies = [base, base + 1, base + 2, base + 3]
		const expectedPoint = Array.from( points.slice( point * 3, point * 3 + 3 ) )

		assert.deepEqual(
			copies.map( vertex => getVertex( position, vertex ) ),
			Array.from( { length: COPIES_PER_POINT }, () => expectedPoint ),
		)
		assert.deepEqual( copies.map( vertex => getVertex( side, vertex )[0] ), [1, -1, 1, -1] )
		assert.deepEqual( copies.map( vertex => getVertex( joinRole, vertex )[0] ), [-1, -2, 1, 2] )
		assert.deepEqual( copies.map( vertex => getVertex( uv, vertex )[1] ), [0, 1, 0, 1] )
		assert.deepEqual( copies.map( vertex => getVertex( width, vertex )[0] ), [point + 1, point + 1, point + 1, point + 1] )
		assert.ok( copies.every( vertex => getVertex( progress, vertex )[0] === getVertex( progress, base )[0] ) )
	}

	// At a supported interior join, incoming and outgoing role copies receive
	// identical neighborhood data. The material can therefore weld same-side
	// copies to one shader position without sharing body indices.
	for ( const attribute of [position, previous, next, progress, width] ) {
		assert.deepEqual( getVertex( attribute, 4 ), getVertex( attribute, 6 ) )
		assert.deepEqual( getVertex( attribute, 5 ), getVertex( attribute, 7 ) )
	}
	assert.deepEqual( getVertex( uv, 4 ), getVertex( uv, 6 ) )
	assert.deepEqual( getVertex( uv, 5 ), getVertex( uv, 7 ) )

	geometry.dispose()
} )

test( 'batched join roles stay segment-local and survive non-indexed expansion', () => {
	const first = new Float32Array( [
		-1, 0, -5,
		0, 0, -5,
	] )
	const second = new Float32Array( [
		0, 1, -6,
		1, 2, -6,
		2, 1, -6,
	] )
	const geometry = new MeshLineGeometry( {
		lines: [first, second],
		needsSide: true,
	} )
	const joinRole = geometry.getAttribute( 'joinRole' )
	const side = geometry.getAttribute( 'side' )
	const index = Array.from( geometry.getIndex().array )

	assert.equal( joinRole.count, ( 2 + 3 ) * COPIES_PER_POINT )
	for ( let point = 0; point < 5; point++ ) {
		assert.deepEqual(
			Array.from( joinRole.array.slice( point * COPIES_PER_POINT, ( point + 1 ) * COPIES_PER_POINT ) ),
			[-1, -2, 1, 2],
		)
	}
	assert.deepEqual( index, [
		2, 3, 4, 4, 3, 5,
		10, 11, 12, 12, 11, 13,
		14, 15, 16, 16, 15, 17,
	] )

	// Same-topology rebuilds retain the internal attribute and its stable role map.
	geometry.setLines( [first.slice(), second.slice()] )
	assert.equal( geometry.getAttribute( 'joinRole' ), joinRole )

	const nonIndexed = geometry.toNonIndexed()
	assert.equal( nonIndexed.getIndex(), null )
	assert.deepEqual(
		Array.from( nonIndexed.getAttribute( 'joinRole' ).array ),
		index.map( vertex => joinRole.getX( vertex ) ),
	)
	assert.deepEqual(
		Array.from( nonIndexed.getAttribute( 'side' ).array ),
		index.map( vertex => side.getX( vertex ) ),
	)
	assert.deepEqual(
		Array.from( nonIndexed.getAttribute( 'joinRole' ).array, value => Math.abs( value ) < 1.5 ? 1 : -1 ),
		index.map( vertex => side.getX( vertex ) ),
		'encoded sides must survive non-indexed triangle expansion',
	)
	for ( let segment = 0; segment < 3; segment++ ) {
		assert.deepEqual(
			Array.from( nonIndexed.getAttribute( 'joinRole' ).array.slice( segment * 6, segment * 6 + 6 ) ),
			[1, 2, -1, -1, 2, -2],
		)
	}

	nonIndexed.dispose()
	geometry.dispose()
} )

test( 'collapsed and false-reversal bodies own disjoint endpoint role copies', () => {
	const fixtures = [
		new Float32Array( [
			0.7, 0.4, -10,
			1.4, 0.8, -20,
		] ),
		new Float32Array( [
			1, 0, -10,
			2, 0.000002, -20,
			3, 0, -30,
		] ),
	]

	for ( const points of fixtures ) {
		const geometry = new MeshLineGeometry( { lines: points, needsSide: true } )
		const index = Array.from( geometry.getIndex().array )
		const segmentCount = points.length / 3 - 1

		assert.equal( index.length, segmentCount * 6 )
		for ( let segment = 0; segment < segmentCount; segment++ ) {
			const start = segment * COPIES_PER_POINT + 2
			const end = ( segment + 1 ) * COPIES_PER_POINT
			assert.deepEqual( index.slice( segment * 6, segment * 6 + 6 ), [
				start, start + 1, end,
				end, start + 1, end + 1,
			] )
		}

		if ( segmentCount === 2 ) {
			const firstBody = new Set( index.slice( 0, 6 ) )
			const secondBody = new Set( index.slice( 6, 12 ) )
			assert.ok( [...firstBody].every( vertex => !secondBody.has( vertex ) ) )
		}

		geometry.dispose()
	}
} )
