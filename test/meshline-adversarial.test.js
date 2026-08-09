import assert from 'node:assert/strict'
import test from 'node:test'

import MeshLineGeometry from '../src/MeshLineGeometry.js'
import MeshLineNodeMaterial from '../src/MeshLineNodeMaterial.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const straightLine = pointCount => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) points[i * 3] = i
	return points
}

const assertFiniteAttributes = geometry => {
	for ( const [name, attribute] of Object.entries( geometry.attributes ) ) {
		for ( let i = 0; i < attribute.array.length; i++ ) {
			assert.ok( Number.isFinite( attribute.array[i] ), `${name}[${i}] must be finite` )
		}
	}
}

test( 'index reuse changes storage type when topology crosses the Uint16 limit', () => {
	const geometry = new MeshLineGeometry( { lines: straightLine( 32_767 ) } )
	const originalIndexCount = geometry.getIndex().count

	assert.ok( geometry.getIndex().array instanceof Uint16Array )

	// Three lines add two points while preserving the same total segment/index
	// count. A count-only reuse check would retain Uint16 storage and wrap the
	// final two vertex indices back to zero and one.
	geometry.setLines( [
		straightLine( 10_923 ),
		straightLine( 10_923 ),
		straightLine( 10_923 ),
	] )

	const index = geometry.getIndex()
	assert.equal( index.count, originalIndexCount )
	assert.ok( index.array instanceof Uint32Array )
	assert.equal( Math.max( ...index.array.slice( -18 ) ), 65_537 )
} )

test( 'surface rejects path segments that collapse during Float32 conversion', () => {
	const origin = 100_000_000

	// The wide cross-section itself is representable at this magnitude, but a
	// one-unit longitudinal step is not. Accepting it creates two coincident rows
	// and a zero-area road even though every source coordinate is finite.
	assert.throws(
		() => new MeshLineSurfaceGeometry( {
			lines: [
				origin, origin, origin,
				origin + 1, origin, origin,
			],
			lineWidth: 64,
		} ),
		/Float32 precision/
	)
} )

test( 'screen-line endpoint neighbor encoding stays finite at Float32 extremes', () => {
	const coordinate = 3.3e38
	let geometry

	try {
		geometry = new MeshLineGeometry( {
			lines: new Float32Array( [
				coordinate, 0, 0,
				-coordinate, 0, 0,
			] ),
		} )
	} catch ( error ) {
		assert.match( error.message, /finite|overflow|range/i )
		return
	}

	assertFiniteAttributes( geometry )
	assert.equal( geometry.getAttribute( 'endpoint' ), undefined )
} )

test( 'screen-line width callbacks cannot inject NaN attributes', () => {
	for ( const value of [Number.NaN, Number.MAX_VALUE] ) {
		let geometry

		try {
			geometry = new MeshLineGeometry( {
				lines: new Float32Array( [0, 0, 0, 1, 0, 0] ),
				needsWidth: true,
				widthCallback: () => value,
			} )
		} catch ( error ) {
			assert.match( error.message, /width|finite|overflow|range/i )
			continue
		}

		assertFiniteAttributes( geometry )
	}
} )

test( 'closed screen lines duplicate first vertex color and width at the seam', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [
			0, 0, 0,
			1, 0, 0,
			1, 1, 0,
			0, 1, 0,
		] ),
		closed: true,
		needsVertexColor: true,
		vertexColors: new Float32Array( [
			1, 0.25, 0.125,
			0, 1, 0,
			0, 0, 1,
			1, 1, 1,
		] ),
		needsWidth: true,
		widthCallback: progress => 1 + progress,
	} )
	const color = geometry.getAttribute( 'vertexColor' )
	const width = geometry.getAttribute( 'width' )
	const seamVertex = color.count - 2

	assert.deepEqual(
		[color.getX( seamVertex ), color.getY( seamVertex ), color.getZ( seamVertex )],
		[color.getX( 0 ), color.getY( 0 ), color.getZ( 0 )]
	)
	assert.equal( width.getX( seamVertex ), width.getX( 0 ) )
} )

test( 'shadow graph refreshes when a rebuild toggles dash support', () => {
	const material = new MeshLineNodeMaterial( {} )
	assert.equal( material._endpointAttribute, null )
	material.setShadow( true )
	assert.equal( material.maskShadowNode, null )

	material.buildLine( { dashCount: 4 } )
	material.setShadow( true )
	assert.ok( material.maskShadowNode )

	material.buildLine( {} )
	material.setShadow( true )
	assert.equal( material.maskShadowNode, null )

	material.buildLine( { positionFn: () => null } )
	assert.equal( material._endpointAttribute.nodeType, 'vec4' )
} )
