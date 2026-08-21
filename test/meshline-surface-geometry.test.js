import assert from 'node:assert/strict'
import test from 'node:test'

import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const EPSILON = 1e-5

test( 'straight surface has exact width, attributes, winding, and expanded bounds', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 0, 0, 10] ),
		lineWidth: 2,
		surface: { up: [0, 1, 0], uvMode: 'distance', uvScale: 1 },
		needsTangents: true,
		needsUV: true,
		needsProgress: true,
		needsSide: true,
	} )

	assert.equal( geometry.getAttribute( 'position' ).count, 4 )
	assert.equal( geometry.getAttribute( 'normal' ).count, 4 )
	assert.equal( geometry.getAttribute( 'tangent' ).itemSize, 4 )
	assert.equal( geometry.getIndex().count, 6 )
	assert.ok( geometry.getIndex().array instanceof Uint16Array )
	assertFiniteGeometry( geometry )
	assertOrthonormalFrames( geometry )
	assertConsistentWinding( geometry )

	const positions = geometry.getAttribute( 'position' )
	assertApprox( distanceBetweenVertices( positions, 0, 1 ), 2 )
	assertApprox( distanceBetweenVertices( positions, 2, 3 ), 2 )
	assertApprox( geometry.boundingBox.min.x, -1 )
	assertApprox( geometry.boundingBox.max.x, 1 )
	assertApprox( geometry.boundingBox.min.z, 0 )
	assertApprox( geometry.boundingBox.max.z, 10 )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'vertical fixed-up path uses a stable fallback frame', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 0, 5, 0, 0, 10, 0] ),
		lineWidth: 1,
		surface: { frame: 'fixed-up', up: [0, 1, 0] },
		needsTangents: true,
	} )

	assertFiniteGeometry( geometry )
	assertOrthonormalFrames( geometry )
	assertConsistentWinding( geometry )
} )

test( 'parallel transport stays continuous along a helix', () => {
	const count = 160
	const points = new Float32Array( count * 3 )
	for ( let i = 0; i < count; i++ ) {
		const t = i / ( count - 1 )
		const angle = t * Math.PI * 4
		points[i * 3] = Math.cos( angle ) * 3
		points[i * 3 + 1] = t * 8
		points[i * 3 + 2] = Math.sin( angle ) * 3
	}

	const geometry = new MeshLineSurfaceGeometry( {
		lines: points,
		lineWidth: 0.4,
		surface: { frame: 'transport', up: [0, 1, 0] },
		join: { type: 'bevel' },
		needsTangents: true,
	} )

	assertFiniteGeometry( geometry )
	assertOrthonormalFrames( geometry )
	assertFrameContinuity( geometry, 0.9 )
} )

test( 'arc-length progress, distance UV, and width callbacks ignore uneven sampling', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 4, 0, 0] ),
		lineWidth: 2,
		widthCallback: progress => 1 + progress,
		surface: { uvMode: 'distance', uvScale: 2 },
		join: { type: 'bevel' },
		needsUV: true,
		needsProgress: true,
	} )

	const progress = geometry.getAttribute( 'progress' )
	const uv = geometry.getAttribute( 'uv' )
	const positions = geometry.getAttribute( 'position' )

	assertApprox( progress.getX( 0 ), 0 )
	assertApprox( progress.getX( 2 ), 0.25 )
	assertApprox( progress.getX( 4 ), 1 )
	assertApprox( uv.getX( 0 ), 0 )
	assertApprox( uv.getX( 2 ), 0.5 )
	assertApprox( uv.getX( 4 ), 2 )
	assertApprox( distanceBetweenVertices( positions, 2, 3 ), 2.5 )
	assertApprox( distanceBetweenVertices( positions, 4, 5 ), 4 )
} )

test( 'consecutive duplicate points are compacted without invalid geometry', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [
			0, 0, 0,
			0, 0, 0,
			1, 0, 0,
			1, 0, 0,
			2, 0, 0,
		] ),
		lineWidth: 1,
		needsTangents: true,
	} )

	assert.equal( geometry._lineRanges[0].pointCount, 3 )
	assert.equal( geometry.getAttribute( 'position' ).count, 6 )
	assertFiniteGeometry( geometry )
	assertOrthonormalFrames( geometry )
} )

test( 'exact cusp uses a finite bounded fallback', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0, 0, 0, 0] ),
		lineWidth: 2,
		join: { type: 'miter', limit: 2 },
	} )

	assertFiniteGeometry( geometry )
	assertIndicesInRange( geometry )
	const positions = geometry.getAttribute( 'position' )
	for ( let row = 0; row < positions.count / 2; row++ ) {
		assert.ok( distanceBetweenVertices( positions, row * 2, row * 2 + 1 ) <= 4 + EPSILON )
	}
} )

test( 'bevel joins emit a true bounded outer wedge', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0, 2, 0, 2] ),
		lineWidth: 2,
		surface: { up: [0, 1, 0] },
		join: { type: 'bevel' },
		needsTangents: true,
		needsUV: true,
		needsProgress: true,
		needsSide: true,
	} )

	const position = geometry.getAttribute( 'position' )
	assert.equal( position.count, 8, 'the two segment rows stay independent at the corner' )
	assert.equal( geometry.getIndex().count, 15, 'four body triangles plus one bevel wedge' )
	assertVectorAttributeEqual( position, 2, 4 )
	assertApprox( distanceBetweenVertices( position, 3, 5 ), Math.SQRT2 )
	assertApprox( distanceFromPoint( position, 3, [2, 0, 0] ), 1 )
	assertApprox( distanceFromPoint( position, 5, [2, 0, 0] ), 1 )
	assertFiniteGeometry( geometry )
	assertOrthonormalFrames( geometry )
	assertConsistentWinding( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'round joins emit an exact-radius configurable outer fan', () => {
	const joinSegments = 6
	const subdivisions = 3
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0, 2, 0, 2] ),
		lineWidth: 2,
		surface: { up: [0, 1, 0] },
		join: { type: 'round', segments: joinSegments },
		needsTangents: true,
		needsUV: true,
		needsProgress: true,
		needsSide: true,
	} )

	const position = geometry.getAttribute( 'position' )
	assert.equal( position.count, 8 + subdivisions - 1 )
	assert.equal( geometry.getIndex().count, 12 + subdivisions * 3 )
	for ( const vertex of [3, 5, ...range( 8, position.count )] ) {
		assertApprox( distanceFromPoint( position, vertex, [2, 0, 0] ), 1, 2e-5 )
	}
	assertFiniteGeometry( geometry )
	assertOrthonormalFrames( geometry )
	assertConsistentWinding( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'round joins spend their half-turn budget in proportion to corner angle', () => {
	const buildTurn = angle => new MeshLineSurfaceGeometry( {
		lines: new Float64Array( [
			0, 0, 0,
			2, 0, 0,
			2 + Math.cos( angle ), 0, Math.sin( angle ),
		] ),
		lineWidth: 1,
		join: { type: 'round', segments: 8 },
	} )

	for ( const [angle, subdivisions] of [
		[Math.PI / 180, 1],
		[Math.PI / 4, 2],
		[Math.PI / 2, 4],
	] ) {
		const geometry = buildTurn( angle )
		assert.equal( geometry.getAttribute( 'position' ).count, 8 + subdivisions - 1 )
		assert.equal( geometry.getIndex().count, 12 + subdivisions * 3 )
		assertFiniteGeometry( geometry )
		assertConsistentWinding( geometry )
	}
} )

test( 'square caps extend by half-width without stretching source progress', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0] ),
		lineWidth: 2,
		cap: { type: 'square', segments: 3 },
		needsUV: true,
		needsProgress: true,
	} )

	const uv = geometry.getAttribute( 'uv' )
	const progress = geometry.getAttribute( 'progress' )
	assert.equal( geometry.getAttribute( 'position' ).count, 8 )
	assert.equal( geometry.getIndex().count, 18 )
	assertApprox( geometry.boundingBox.min.x, -1 )
	assertApprox( geometry.boundingBox.max.x, 3 )
	assertApprox( uv.getX( 4 ), -1 )
	assertApprox( uv.getX( 6 ), 3 )
	assertApprox( progress.getX( 4 ), 0 )
	assertApprox( progress.getX( 6 ), 1 )
	assertConsistentWinding( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'round caps emit endpoint fans with physical distance UVs', () => {
	const capSegments = 6
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0] ),
		lineWidth: 2,
		cap: { type: 'round', segments: capSegments },
		needsUV: true,
		needsProgress: true,
		needsSide: true,
	} )

	const position = geometry.getAttribute( 'position' )
	assert.equal( position.count, 4 + capSegments * 2 )
	assert.equal( geometry.getIndex().count, 6 + capSegments * 6 )
	assertApprox( geometry.boundingBox.min.x, -1, 2e-5 )
	assertApprox( geometry.boundingBox.max.x, 3, 2e-5 )
	for ( const vertex of range( 5, 4 + capSegments ) ) {
		assertApprox( distanceFromPoint( position, vertex, [0, 0, 0] ), 1, 2e-5 )
	}
	for ( const vertex of range( 5 + capSegments, position.count ) ) {
		assertApprox( distanceFromPoint( position, vertex, [2, 0, 0] ), 1, 2e-5 )
	}
	assertFiniteGeometry( geometry )
	assertConsistentWinding( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'caps reuse the compact miter body instead of duplicating every segment row', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [
			0, 0, 0,
			2, 0, 0,
			3, 0, 1,
			5, 0, 1,
		] ),
		lineWidth: 1,
		join: { type: 'miter', limit: 4, segments: 8 },
		cap: { type: 'round', segments: 8 },
		needsTangents: true,
	} )

	assert.equal( geometry.getAttribute( 'position' ).count, 4 * 2 + 8 * 2 )
	assert.equal( geometry.getIndex().count, 3 * 6 + 8 * 3 * 2 )
	assertFiniteGeometry( geometry )
	assertOrthonormalFrames( geometry )
	assertConsistentWinding( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'exact and near reversals split deterministically without bridging segments', () => {
	for ( const epsilon of [0, 1e-12] ) {
		const geometry = new MeshLineSurfaceGeometry( {
			lines: new Float64Array( [0, 0, 0, 2, 0, 0, 0, 0, epsilon] ),
			lineWidth: 2,
			join: { type: 'round', segments: 8 },
			cap: { type: 'butt', segments: 8 },
			needsTangents: true,
			needsUV: true,
		} )

		assert.equal( geometry.getAttribute( 'position' ).count, 8 )
		assert.equal( geometry.getIndex().count, 12 )
		for ( let offset = 0; offset < geometry.getIndex().count; offset += 3 ) {
			const triangle = geometry.getIndex().array.subarray( offset, offset + 3 )
			assert.ok( triangle.every( index => index < 4 ) || triangle.every( index => index >= 4 ) )
		}
		assertFiniteGeometry( geometry )
		assertOrthonormalFrames( geometry )
		assertBoundsContainEveryVertex( geometry )
	}
} )

test( 'reversal run endpoints retain the full configured cap budget', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0, 0, 0, 0] ),
		lineWidth: 1,
		join: { type: 'round', segments: 1 },
		cap: { type: 'round', segments: 5 },
	} )

	assert.equal( geometry.getAttribute( 'position' ).count, 8 + 4 * 5 )
	assert.equal( geometry.getIndex().count, 12 + 4 * 5 * 3 )
	assertFiniteGeometry( geometry )
	assertConsistentWinding( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'the inclusive one-degree reversal cone is stable on both turn sides', () => {
	const buildTurn = ( deltaDegrees, sideSign ) => {
		const turn = Math.PI - deltaDegrees * Math.PI / 180
		const legLength = 128
		return new MeshLineSurfaceGeometry( {
			lines: new Float64Array( [
				0, 0, 0,
				legLength, 0, 0,
				legLength + Math.cos( turn ) * legLength, 0, Math.sin( turn ) * legLength * sideSign,
			] ),
			lineWidth: 1,
			join: { type: 'round', segments: 4 },
			cap: { type: 'butt', segments: 4 },
		} )
	}

	for ( const sideSign of [-1, 1] ) {
		for ( const deltaDegrees of [0.5, 1] ) {
			const split = buildTurn( deltaDegrees, sideSign )
			assert.equal( split.getAttribute( 'position' ).count, 8 )
			assert.equal( split.getIndex().count, 12 )
			assertFiniteGeometry( split )
		}

		const joined = buildTurn( 1.001, sideSign )
		assert.equal( joined.getAttribute( 'position' ).count, 11 )
		assert.equal( joined.getIndex().count, 24 )
		assertFiniteGeometry( joined )
		assertConsistentWinding( joined )
	}
} )

test( 'over-limit bevel fallback keeps the exact signed inner intersection on long legs', () => {
	const turn = 160 * Math.PI / 180
	const legLength = 10
	const halfWidth = 1
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float64Array( [
			-legLength, 0, 0,
			0, 0, 0,
			Math.cos( turn ) * legLength, 0, Math.sin( turn ) * legLength,
		] ),
		lineWidth: halfWidth * 2,
		surface: { up: [0, 1, 0] },
		join: { type: 'miter', limit: 2, segments: 8 },
	} )

	const position = geometry.getAttribute( 'position' )
	const normal = [0, 1, 0]
	const incomingDirection = [1, 0, 0]
	const outgoingDirection = [Math.cos( turn ), 0, Math.sin( turn )]
	const incomingSide = cross( normal, incomingDirection )
	const outgoingSide = cross( normal, outgoingDirection )
	const inner = readAttributeVector( position, 2 )
	const outgoingInner = readAttributeVector( position, 4 )
	const incomingOuter = readAttributeVector( position, 3 )
	const outgoingOuter = readAttributeVector( position, 5 )
	const expectedSetback = Math.tan( turn * 0.5 ) * halfWidth

	assert.equal( position.count, 8 )
	assert.equal( geometry.getIndex().count, 15 )
	assertVectorAttributeEqual( position, 2, 4 )
	assertApprox( dot( inner, incomingSide ), -halfWidth, 2e-5 )
	assertApprox( dot( outgoingInner, outgoingSide ), -halfWidth, 2e-5 )
	assertApprox( dot( incomingOuter, incomingSide ), halfWidth, 2e-5 )
	assertApprox( dot( outgoingOuter, outgoingSide ), halfWidth, 2e-5 )
	assertApprox( -dot( inner, incomingDirection ), expectedSetback, 2e-5 )
	assertApprox( dot( outgoingInner, outgoingDirection ), expectedSetback, 2e-5 )
	assert.ok( vectorLength( inner ) > halfWidth * 5, 'the inner row must not collapse to the center' )
	assertFiniteGeometry( geometry )
	assertConsistentWinding( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'short sharp legs reject an exact inner footprint that cannot fit', () => {
	const turn = 160 * Math.PI / 180
	const legLength = 4
	assert.throws(
		() => new MeshLineSurfaceGeometry( {
			lines: new Float64Array( [
				-legLength, 0, 0,
				0, 0, 0,
				Math.cos( turn ) * legLength, 0, Math.sin( turn ) * legLength,
			] ),
			lineWidth: 2,
			join: { type: 'miter', limit: 2, segments: 8 },
		} ),
		/Exact inner join.*requires.*only.*available/
	)
} )

test( 'opposite-sign S-turn footprints fit independently on opposite body edges', () => {
	const turn = 120 * Math.PI / 180
	const middleLength = 2
	const point2 = [Math.cos( turn ) * middleLength, 0, Math.sin( turn ) * middleLength]
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float64Array( [
			-10, 0, 0,
			0, 0, 0,
			...point2,
			point2[0] + 10, 0, point2[2],
		] ),
		lineWidth: 2,
		join: { type: 'bevel', limit: 4, segments: 8 },
	} )

	assert.equal( geometry.getAttribute( 'position' ).count, 12 )
	assert.equal( geometry.getIndex().count, 24 )
	assertFiniteGeometry( geometry )
	assertConsistentWinding( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'same-sign turns reject overlapping exact footprints on one body edge', () => {
	const turn = 120 * Math.PI / 180
	const middleLength = 2
	const point2 = [Math.cos( turn ) * middleLength, 0, Math.sin( turn ) * middleLength]
	assert.throws(
		() => new MeshLineSurfaceGeometry( {
			lines: new Float64Array( [
				-10, 0, 0,
				0, 0, 0,
				...point2,
				point2[0] + Math.cos( turn * 2 ) * 10, 0, point2[2] + Math.sin( turn * 2 ) * 10,
			] ),
			lineWidth: 2,
			join: { type: 'bevel', limit: 4, segments: 8 },
		} ),
		/Exact inner join.*requires.*only.*available/
	)
} )

test( 'clipped inner joins share short same-sign legs without degenerate topology', () => {
	const turn = 120 * Math.PI / 180
	const middleLength = 2
	const point2 = [Math.cos( turn ) * middleLength, 0, Math.sin( turn ) * middleLength]
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float64Array( [
			-10, 0, 0,
			0, 0, 0,
			...point2,
			point2[0] + Math.cos( turn * 2 ) * 10, 0, point2[2] + Math.sin( turn * 2 ) * 10,
		] ),
		lineWidth: 2,
		join: { type: 'round', limit: 4, segments: 8, inner: 'clip' },
	} )

	assert.equal( geometry.options.join.inner, 'clip' )
	assertFiniteGeometry( geometry )
	assertIndicesInRange( geometry )
	assertConsistentWinding( geometry )
	assertNondegenerateTriangles( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'clipped compact miters degrade safely when a sharp footprint exceeds its leg', () => {
	const turn = 160 * Math.PI / 180
	const legLength = 4
	const lines = new Float64Array( [
		-legLength, 0, 0,
		0, 0, 0,
		Math.cos( turn ) * legLength, 0, Math.sin( turn ) * legLength,
	] )
	assert.throws(
		() => new MeshLineSurfaceGeometry( {
			lines,
			lineWidth: 2,
			join: { type: 'miter', limit: 20 },
		} ),
		/Exact inner join.*requires.*only.*available/
	)
	const geometry = new MeshLineSurfaceGeometry( {
		lines,
		lineWidth: 2,
		join: { type: 'miter', limit: 20, inner: 'clip' },
	} )

	assert.ok( geometry.getAttribute( 'position' ).count > 6, 'unsafe compact miter should use bounded topology' )
	assertFiniteGeometry( geometry )
	assertConsistentWinding( geometry )
	assertNondegenerateTriangles( geometry )
} )

test( 'legacy simple join aliases miter in the low-level surface builder', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 1, 0, 1] ),
		join: { type: 'simple', limit: 2 },
	} )

	assert.equal( geometry.options.join.type, 'miter' )
	assertFiniteGeometry( geometry )
} )

test( 'large translated coordinates remain finite and bounds come from expanded vertices', () => {
	const origin = 100_000_000
	const geometry = new MeshLineSurfaceGeometry( {
		lines: [
			origin, origin, origin,
			origin + 1024, origin + 256, origin,
			origin + 2048, origin + 256, origin + 1024,
		],
		lineWidth: 64,
		join: { type: 'miter', limit: 3 },
		needsTangents: true,
	} )

	assertFiniteGeometry( geometry )
	assertOrthonormalFrames( geometry )
	assertBoundsContainEveryVertex( geometry )
	assert.ok( geometry.boundingBox.max.x > geometry.boundingBox.min.x )
	assert.ok( geometry.boundingBox.max.z > geometry.boundingBox.min.z )
} )

test( 'bank rotates the road frame around its tangent', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 0, 0, 4] ),
		lineWidth: 2,
		surface: { up: [0, 1, 0], bank: Math.PI * 0.5 },
		join: { type: 'bevel' },
		needsTangents: true,
	} )

	const normal = geometry.getAttribute( 'normal' )
	const positions = geometry.getAttribute( 'position' )
	assertApprox( normal.getX( 0 ), -1 )
	assertApprox( normal.getY( 0 ), 0 )
	assertApprox( normal.getZ( 0 ), 0 )
	assertApprox( Math.abs( positions.getY( 0 ) ), 1 )
	assertApprox( Math.abs( positions.getY( 1 ) ), 1 )
	assertOrthonormalFrames( geometry )
} )

test( 'closed non-planar path corrects holonomy and duplicates a clean UV seam', () => {
	const count = 96
	const points = new Float32Array( ( count + 1 ) * 3 )
	for ( let i = 0; i <= count; i++ ) {
		const t = i / count
		const angle = t * Math.PI * 2
		points[i * 3] = Math.cos( angle ) * 5
		points[i * 3 + 1] = Math.sin( angle * 2 ) * 0.8
		points[i * 3 + 2] = Math.sin( angle ) * 5
	}

	const geometry = new MeshLineSurfaceGeometry( {
		lines: points,
		closed: true,
		lineWidth: 0.75,
		surface: { frame: 'transport', uvMode: 'distance', uvScale: 2 },
		join: { type: 'bevel' },
		needsTangents: true,
		needsUV: true,
		needsProgress: true,
	} )

	const range = geometry._lineRanges[0]
	const normal = geometry.getAttribute( 'normal' )
	const tangent = geometry.getAttribute( 'tangent' )
	const progress = geometry.getAttribute( 'progress' )
	const uv = geometry.getAttribute( 'uv' )
	const seamVertex = range.seamVertexStart

	assert.equal( range.pointCount, count )
	assertVectorAttributeEqual( normal, 0, seamVertex )
	assertVectorAttributeEqual( tangent, 0, seamVertex )
	assertApprox( progress.getX( seamVertex ), 1 )
	assertApprox( uv.getX( seamVertex ), range.totalLength / 2, 2e-4 )
	assertNoUVTriangleCrossesSeam( geometry, range.totalLength / 2 )
	assertFrameContinuity( geometry, 0.9 )
	assertConsistentWinding( geometry )
} )

test( 'closed round fans keep adaptive tessellation on one side of the UV seam', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [
			0, 0, 0,
			2, 0, 0,
			2, 0, 2,
			0, 0, 2,
		] ),
		closed: true,
		lineWidth: 0.5,
		surface: { uvMode: 'distance', uvScale: 1 },
		join: { type: 'round', segments: 8 },
		needsUV: true,
		needsProgress: true,
	} )

	const range = geometry._lineRanges[0]
	const seamU = range.totalLength
	assert.equal( geometry.getAttribute( 'position' ).count, 31 )
	assert.equal( geometry.getIndex().count, 72 )
	assertApprox( geometry.getAttribute( 'uv' ).getX( range.seamVertexStart ), seamU )
	assertApprox( geometry.getAttribute( 'progress' ).getX( range.seamVertexStart ), 1 )
	assertNoUVTriangleCrossesSeam( geometry, seamU )
	assertFiniteGeometry( geometry )
	assertConsistentWinding( geometry )
} )

test( 'multi-line closed flags normalize already-closed inputs independently', () => {
	const square = new Float32Array( [
		0, 0, 0,
		2, 0, 0,
		2, 0, 2,
		0, 0, 2,
		0, 0, 0,
	] )
	const open = new Float32Array( [5, 0, 0, 6, 0, 0, 8, 0, 0] )
	const geometry = new MeshLineSurfaceGeometry( {
		lines: [square, open],
		closed: [true, false],
		lineWidth: 0.5,
		join: { type: 'bevel' },
	} )

	assert.equal( geometry._lineRanges.length, 2 )
	assert.equal( geometry._lineRanges[0].pointCount, 4 )
	assert.equal( geometry._lineRanges[0].rowCount, 5 )
	assert.equal( geometry._lineRanges[1].pointCount, 3 )
	assert.equal( geometry._lineRanges[1].rowCount, 3 )
	assert.equal( geometry.getIndex().count, 4 * 6 + 4 * 3 + 2 * 6 )
	assertFiniteGeometry( geometry )
	assertIndicesInRange( geometry )
} )

test( 'large surfaces select 32-bit indices', () => {
	const pointCount = 33_000
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) points[i * 3] = i * 0.01

	const geometry = new MeshLineSurfaceGeometry( {
		lines: points,
		lineWidth: 0.1,
		join: { type: 'bevel' },
	} )

	assert.equal( geometry.getAttribute( 'position' ).count, pointCount * 2 )
	assert.ok( geometry.getIndex().array instanceof Uint32Array )
	assertIndicesInRange( geometry )
} )

test( 'round-fan topology promotes indices from the expanded vertex count', () => {
	const pointCount = 10_000
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		points[i * 3] = i
		points[i * 3 + 2] = i % 2
	}

	const geometry = new MeshLineSurfaceGeometry( {
		lines: points,
		lineWidth: 0.1,
		join: { type: 'round', segments: 8 },
	} )

	assert.ok( geometry.getAttribute( 'position' ).count > 65535 )
	assert.ok( geometry.getIndex().array instanceof Uint32Array )
	assertFiniteGeometry( geometry )
	assertIndicesInRange( geometry )
} )

test( 'invalid and fully degenerate paths fail clearly', () => {
	assert.throws(
		() => new MeshLineSurfaceGeometry( { lines: [0, 0, 0, Number.NaN, 0, 0] } ),
		/Non-finite coordinate/
	)
	assert.throws(
		() => new MeshLineSurfaceGeometry( { lines: [0, 0, 0, 0, 0, 0] } ),
		/requires at least 2 distinct points/
	)
	assert.throws(
		() => new MeshLineSurfaceGeometry( { lines: [0, 0, 0, 1, 0, 0], cap: { type: 'triangle' } } ),
		/Unsupported cap type/
	)
	assert.throws(
		() => new MeshLineSurfaceGeometry( { lines: [0, 0, 0, 1, 0, 0], cap: { type: 'round', segments: 0 } } ),
		/cap\.segments must be a positive integer/
	)
	assert.throws(
		() => new MeshLineSurfaceGeometry( { lines: [0, 0, 0, 1, 0, 0], cap: { type: 'round', segments: 1 } } ),
		/at least 2/
	)
} )

test( 'low-level cap strings normalize and partial cap updates retain tessellation', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0] ),
		cap: { type: 'round', segments: 6 },
	} )
	assert.deepEqual( geometry.options.cap, { type: 'round', segments: 6 } )

	geometry.buildLine( { cap: { type: 'square' } } )
	assert.deepEqual( geometry.options.cap, { type: 'square', segments: 6 } )
	geometry.buildLine( { cap: 'butt' } )
	assert.deepEqual( geometry.options.cap, { type: 'butt', segments: 8 } )
} )

test( 'partial buildLine updates rebuild the retained surface path', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 0, 0, 2] ),
		lineWidth: 1,
	} )
	const position = geometry.getAttribute( 'position' )
	const beforeWidth = distanceBetweenVertices( position, 0, 1 )

	geometry.buildLine( { lineWidth: 2 } )
	const after = geometry.getAttribute( 'position' )
	assert.equal( after, position )
	assert.ok( Math.abs( beforeWidth - 1 ) <= EPSILON )
	assert.ok( Math.abs( distanceBetweenVertices( after, 0, 1 ) - 2 ) <= EPSILON )
} )

test( 'optional surface attributes follow feature needs and remove stale buffers', () => {
	const lines = new Float32Array( [0, 0, 0, 0, 0, 2, 1, 0, 4] )
	const geometry = new MeshLineSurfaceGeometry( { lines } )

	assert.deepEqual( Object.keys( geometry.attributes ).sort(), ['normal', 'position'] )

	geometry.buildLine( {
		needsProgress: true,
		needsSide: true,
		surface: { normalMap: {} },
	} )
	assert.ok( geometry.getAttribute( 'tangent' ) )
	assert.ok( geometry.getAttribute( 'uv' ) )
	assert.ok( geometry.getAttribute( 'progress' ) )
	assert.ok( geometry.getAttribute( 'side' ) )

	geometry.buildLine( {
		needsProgress: false,
		needsSide: false,
		needsTangents: false,
		needsUV: false,
		surface: { normalMap: null },
	} )
	assert.deepEqual( Object.keys( geometry.attributes ).sort(), ['normal', 'position'] )
} )

test( 'same-sized surface updates reuse attributes and indices while refreshing ranges and bounds', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 0, 0, 2, 1, 0, 4] ),
		needsTangents: true,
		needsUV: true,
		needsProgress: true,
		needsSide: true,
	} )
	const attributes = Object.fromEntries( Object.entries( geometry.attributes ) )
	const index = geometry.getIndex()

	geometry.setPositions( new Float32Array( [10, 1, 0, 11, 2, 2, 13, 1, 4] ) )

	for ( const [name, attribute] of Object.entries( attributes ) ) {
		assert.equal( geometry.getAttribute( name ), attribute, `${name} attribute should be reused` )
	}
	assert.equal( geometry.getIndex(), index )
	assert.equal( geometry._lineRanges[0].indexStart, 0 )
	assert.equal( geometry._lineRanges[0].indexCount, geometry.getIndex().count )
	assert.ok( geometry.boundingBox.min.x > 9 )
	assertBoundsContainEveryVertex( geometry )
} )

test( 'same-sized round topology reuses every enabled buffer', () => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0, 2, 0, 2] ),
		join: { type: 'round', segments: 5 },
		needsTangents: true,
		needsUV: true,
		needsProgress: true,
		needsSide: true,
	} )
	const attributes = Object.fromEntries( Object.entries( geometry.attributes ) )
	const index = geometry.getIndex()

	geometry.setPositions( new Float32Array( [10, 1, 0, 12, 1, 0, 12, 1, 3] ) )

	for ( const [name, attribute] of Object.entries( attributes ) ) {
		assert.equal( geometry.getAttribute( name ), attribute, `${name} variable-topology attribute should be reused` )
	}
	assert.equal( geometry.getIndex(), index )
	assertFiniteGeometry( geometry )
	assertBoundsContainEveryVertex( geometry )
} )

function assertFiniteGeometry( geometry ) {
	for ( const name of ['position', 'normal', 'tangent', 'uv', 'progress', 'side'] ) {
		const attribute = geometry.getAttribute( name )
		if ( !attribute ) continue
		const array = attribute.array
		for ( let i = 0; i < array.length; i++ ) {
			assert.ok( Number.isFinite( array[i] ), `${name}[${i}] must be finite` )
		}
	}
	assert.ok( Number.isFinite( geometry.boundingSphere.radius ) )
}

function assertOrthonormalFrames( geometry ) {
	const normal = geometry.getAttribute( 'normal' )
	const tangent = geometry.getAttribute( 'tangent' )
	for ( let vertex = 0; vertex < normal.count; vertex += 2 ) {
		const n = readAttributeVector( normal, vertex )
		const t = readAttributeVector( tangent, vertex )
		assertApprox( vectorLength( n ), 1, 2e-5 )
		assertApprox( vectorLength( t ), 1, 2e-5 )
		assertApprox( dot( n, t ), 0, 2e-5 )
		assertApprox( tangent.getW( vertex ), 1 )
	}
}

function assertFrameContinuity( geometry, minimumDot ) {
	const normal = geometry.getAttribute( 'normal' )
	for ( const range of geometry._lineRanges ) {
		for ( let row = 1; row < range.rowCount; row++ ) {
			const previous = readAttributeVector( normal, range.vertexStart + ( row - 1 ) * 2 )
			const current = readAttributeVector( normal, range.vertexStart + row * 2 )
			assert.ok( dot( previous, current ) > minimumDot, `frame flipped at row ${row}` )
		}
	}
}

function assertConsistentWinding( geometry ) {
	const position = geometry.getAttribute( 'position' )
	const normal = geometry.getAttribute( 'normal' )
	const indices = geometry.getIndex().array
	for ( let i = 0; i < indices.length; i += 3 ) {
		const a = indices[i]
		const b = indices[i + 1]
		const c = indices[i + 2]
		const pa = readAttributeVector( position, a )
		const pb = readAttributeVector( position, b )
		const pc = readAttributeVector( position, c )
		const face = cross( subtract( pb, pa ), subtract( pc, pa ) )
		if ( vectorLength( face ) <= EPSILON ) continue
		const expected = add(
			add( readAttributeVector( normal, a ), readAttributeVector( normal, b ) ),
			readAttributeVector( normal, c )
		)
		assert.ok( dot( face, expected ) > 0, `triangle ${i / 3} has inverted winding` )
	}
}

function assertNondegenerateTriangles( geometry ) {
	const position = geometry.getAttribute( 'position' )
	const indices = geometry.getIndex().array
	for ( let i = 0; i < indices.length; i += 3 ) {
		const a = readAttributeVector( position, indices[i] )
		const b = readAttributeVector( position, indices[i + 1] )
		const c = readAttributeVector( position, indices[i + 2] )
		const areaVector = cross( subtract( b, a ), subtract( c, a ) )
		assert.ok( vectorLength( areaVector ) > EPSILON, `triangle ${i / 3} must have non-zero area` )
	}
}

function assertIndicesInRange( geometry ) {
	const vertexCount = geometry.getAttribute( 'position' ).count
	for ( const index of geometry.getIndex().array ) {
		assert.ok( index >= 0 && index < vertexCount )
	}
}

function assertNoUVTriangleCrossesSeam( geometry, seamU ) {
	const uv = geometry.getAttribute( 'uv' )
	const indices = geometry.getIndex().array
	for ( let offset = 0; offset < indices.length; offset += 3 ) {
		let minimum = Infinity
		let maximum = -Infinity
		for ( let corner = 0; corner < 3; corner++ ) {
			const u = uv.getX( indices[offset + corner] )
			minimum = Math.min( minimum, u )
			maximum = Math.max( maximum, u )
		}
		assert.ok( maximum - minimum < seamU * 0.75, `triangle ${offset / 3} crosses the UV seam` )
	}
}

function assertBoundsContainEveryVertex( geometry ) {
	const position = geometry.getAttribute( 'position' )
	const box = geometry.boundingBox
	let minX = Infinity, minY = Infinity, minZ = Infinity
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
	for ( let i = 0; i < position.count; i++ ) {
		const x = position.getX( i )
		const y = position.getY( i )
		const z = position.getZ( i )
		assert.ok( x >= box.min.x - EPSILON && x <= box.max.x + EPSILON )
		assert.ok( y >= box.min.y - EPSILON && y <= box.max.y + EPSILON )
		assert.ok( z >= box.min.z - EPSILON && z <= box.max.z + EPSILON )
		minX = Math.min( minX, x )
		minY = Math.min( minY, y )
		minZ = Math.min( minZ, z )
		maxX = Math.max( maxX, x )
		maxY = Math.max( maxY, y )
		maxZ = Math.max( maxZ, z )
	}
	assert.equal( box.min.x, minX )
	assert.equal( box.min.y, minY )
	assert.equal( box.min.z, minZ )
	assert.equal( box.max.x, maxX )
	assert.equal( box.max.y, maxY )
	assert.equal( box.max.z, maxZ )
}

function assertVectorAttributeEqual( attribute, a, b, epsilon = EPSILON ) {
	const size = Math.min( attribute.itemSize, 3 )
	for ( let component = 0; component < size; component++ ) {
		assertApprox(
			attribute.array[a * attribute.itemSize + component],
			attribute.array[b * attribute.itemSize + component],
			epsilon
		)
	}
}

function distanceBetweenVertices( attribute, a, b ) {
	return vectorLength( subtract(
		readAttributeVector( attribute, a ),
		readAttributeVector( attribute, b )
	) )
}

function distanceFromPoint( attribute, vertex, point ) {
	return vectorLength( subtract( readAttributeVector( attribute, vertex ), point ) )
}

function range( start, end ) {
	return Array.from( { length: Math.max( 0, end - start ) }, ( _, index ) => start + index )
}

function readAttributeVector( attribute, index ) {
	return [attribute.getX( index ), attribute.getY( index ), attribute.getZ( index )]
}

function assertApprox( actual, expected, epsilon = EPSILON ) {
	assert.ok(
		Math.abs( actual - expected ) <= epsilon,
		`expected ${actual} to be within ${epsilon} of ${expected}`
	)
}

function add( a, b ) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtract( a, b ) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross( a, b ) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	]
}

function dot( a, b ) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function vectorLength( vector ) {
	return Math.hypot( vector[0], vector[1], vector[2] )
}
