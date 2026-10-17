import assert from 'node:assert/strict'
import test from 'node:test'

import { DynamicDrawUsage, StaticDrawUsage, StreamDrawUsage } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLineGeometry from '../src/MeshLineGeometry.js'
import MeshLineNodeMaterial from '../src/MeshLineNodeMaterial.js'

const pointValues = attribute => {
	const values = []
	for ( let i = 0; i < attribute.count; i += 4 ) values.push( attribute.getX( i ) )
	return values
}

// One RGB triplet per stored point, checking that all four billboard rows agree.
const pointColors = geometry => {
	const color = geometry.getAttribute( 'vertexColor' )
	const colors = []
	for ( let i = 0; i < color.count; i += 4 ) {
		const rgb = [color.getX( i ), color.getY( i ), color.getZ( i )]
		for ( let row = 1; row < 4; row++ ) {
			assert.deepEqual( [color.getX( i + row ), color.getY( i + row ), color.getZ( i + row )], rgb )
		}
		colors.push( rgb )
	}
	return colors
}

const assertFiniteAndIndexValid = geometry => {
	for ( const attribute of Object.values( geometry.attributes ) ) {
		for ( const value of attribute.array ) assert.equal( Number.isFinite( value ), true )
	}

	const index = geometry.getIndex()
	if ( !index ) return
	const vertexCount = geometry.getAttribute( 'position' ).count
	for ( const value of index.array ) {
		assert.equal( Number.isInteger( value ), true )
		assert.ok( value >= 0 && value < vertexCount )
	}
}

test( 'closed CPU paths keep cyclic neighbors without endpoint metadata', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [
			0, 0, 0,
			1, 0, 0,
			1, 1, 0,
			0, 1, 0,
		] ),
		closed: true,
	} )

	assert.equal( geometry._lines[0].length / 3, 5 )
	assert.equal( geometry.getIndex().count, 24 )

	assert.equal( geometry.getAttribute( 'endpoint' ), undefined )

	const previous = geometry.getAttribute( 'previous' )
	assert.deepEqual( [previous.getX( 0 ), previous.getY( 0 ), previous.getZ( 0 )], [0, 1, 0] )
	const next = geometry.getAttribute( 'next' )
	assert.deepEqual( [next.getX( next.count - 1 ), next.getY( next.count - 1 ), next.getZ( next.count - 1 )], [1, 0, 0] )
} )

test( 'open CPU paths encode endpoint direction in their neighbor buffers', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 2, 0, 0] ),
	} )
	assert.equal( geometry.getAttribute( 'endpoint' ), undefined )

	const position = geometry.getAttribute( 'position' )
	const previous = geometry.getAttribute( 'previous' )
	const next = geometry.getAttribute( 'next' )
	assert.deepEqual(
		[previous.getX( 0 ), previous.getY( 0 ), previous.getZ( 0 )],
		[position.getX( 0 ), position.getY( 0 ), position.getZ( 0 )]
	)
	const last = position.count - 1
	assert.deepEqual(
		[next.getX( last ), next.getY( last ), next.getZ( last )],
		[position.getX( last ), position.getY( last ), position.getZ( last )]
	)
} )

test( 'closed procedural templates preserve their exact segment grid', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [
			0, 0, 0,
			0.25, 0, 0,
			0.5, 0, 0,
			0.75, 0, 0,
			1, 0, 0,
		] ),
		closed: true,
		gpuPositionNode: () => null,
	} )

	assert.equal( geometry._lines[0].length / 3, 5 )
	assert.equal( geometry.getIndex().count, 24 )
	assert.deepEqual( pointValues( geometry.getAttribute( 'progress' ) ), [0, 0.25, 0.5, 0.75, 1] )

	const endpoint = geometry.getAttribute( 'endpoint' )
	assert.equal( endpoint.getZ( 0 ), 0.25 )
	assert.equal( endpoint.getW( 0 ), 0.25 )
	assert.equal( endpoint.getZ( endpoint.count - 1 ), 0.25 )
	assert.equal( endpoint.getW( endpoint.count - 1 ), 0.25 )
} )

test( 'CPU progress and UVs use normalized arc length and update in place', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 4, 0, 0] ),
		needsUV: true,
	} )

	assert.deepEqual( pointValues( geometry.getAttribute( 'progress' ) ), [0, 0.25, 1] )
	assert.deepEqual( pointValues( geometry.getAttribute( 'uv' ) ), [0, 0.25, 1] )

	geometry.setPositions( new Float32Array( [0, 0, 0, 3, 0, 0, 4, 0, 0] ) )
	assert.deepEqual( pointValues( geometry.getAttribute( 'progress' ) ), [0, 0.75, 1] )
	assert.deepEqual( pointValues( geometry.getAttribute( 'uv' ) ), [0, 0.75, 1] )
} )

test( 'procedural progress remains parameter based rather than arc-length based', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 4, 0, 0] ),
		gpuPositionNode: () => null,
	} )
	assert.deepEqual( pointValues( geometry.getAttribute( 'progress' ) ), [0, 0.5, 1] )
} )

test( 'neighbor-progress metadata is allocated only when a CPU hook needs it', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 4, 0, 0] ),
		positionFn: () => null,
	} )
	const endpoint = geometry.getAttribute( 'endpoint' )
	assert.equal( endpoint.itemSize, 4 )
	assert.deepEqual( [endpoint.getZ( 4 ), endpoint.getW( 4 )], [0.25, 0.75] )

	geometry.buildLine( { positionFn: null } )
	assert.equal( geometry.getAttribute( 'endpoint' ), undefined )
} )

test( 'duplicates, invalid points, and an existing closure are canonicalized', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [
			0, 0, 0,
			0, 0, 0,
			Number.NaN, 1, 0,
			1, 0, 0,
			1, 0, 0,
			1, 1, 0,
			0, 0, 0,
			0, 0, 0,
		] ),
		closed: true,
	} )

	assert.deepEqual( Array.from( geometry._lines[0] ), [
		0, 0, 0,
		1, 0, 0,
		1, 1, 0,
		0, 0, 0,
	] )
	assert.equal( geometry.getIndex().count, 18 )
	assertFiniteAndIndexValid( geometry )
} )

test( 'empty and fully degenerate rebuilds clear stale draw data', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0] ),
	} )
	assert.ok( geometry.getAttribute( 'position' ) )

	geometry.setLines( [] )
	assert.equal( geometry.getAttribute( 'position' ), undefined )
	assert.equal( geometry.getIndex(), null )
	assert.equal( geometry.drawRange.count, 0 )
	assert.equal( geometry.boundingBox.isEmpty(), true )
	assert.equal( geometry.boundingSphere.radius, 0 )

	geometry.setLines( new Float32Array( [2, 2, 2, 2, 2, 2] ) )
	assert.equal( geometry.getAttribute( 'position' ), undefined )
	assert.equal( geometry.getIndex(), null )
} )

test( 'aggregate bounds refresh after a full rebuild', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0] ),
	} )
	assert.equal( geometry.boundingBox.min.x, 0 )
	assert.equal( geometry.boundingBox.max.x, 1 )

	geometry.setLines( new Float32Array( [100, 0, 0, 110, 0, 0] ) )
	assert.equal( geometry.boundingBox.min.x, 100 )
	assert.equal( geometry.boundingBox.max.x, 110 )
	assert.equal( geometry.boundingSphere.center.x, 105 )
	assert.equal( geometry.boundingSphere.radius, 5 )
} )

test( 'partial buildLine updates preserve and rebuild the current source', () => {
	const geometry = new MeshLineGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0] ),
		lineWidth: 1,
	} )
	const position = geometry.getAttribute( 'position' )

	geometry.buildLine( { lineWidth: 3 } )
	assert.equal( geometry.options.lineWidth, 3 )
	assert.equal( geometry.getAttribute( 'position' ), position )
	assert.equal( geometry.getIndex().count, 6 )
	assert.equal( geometry.boundingBox.min.x, -6 )
	assert.equal( geometry.boundingBox.max.x, 8 )
} )

test( 'CPU geometry defaults static and honors dynamic or explicit usage', () => {
	const points = new Float32Array( [0, 0, 0, 1, 0, 0] )
	const staticGeometry = new MeshLineGeometry( { lines: points } )
	assert.equal( staticGeometry.getAttribute( 'position' ).usage, StaticDrawUsage )

	const streamGeometry = new MeshLineGeometry( { lines: points, dynamic: true } )
	assert.equal( streamGeometry.getAttribute( 'position' ).usage, StreamDrawUsage )

	const explicitGeometry = new MeshLineGeometry( { lines: points, usage: DynamicDrawUsage } )
	assert.equal( explicitGeometry.getAttribute( 'position' ).usage, DynamicDrawUsage )
} )

test( 'multi-line vertex colors read a concatenated array from each line\'s global point start', () => {
	const geometry = new MeshLineGeometry( {
		lines: [
			new Float32Array( [0, 0, 0, 1, 0, 0] ),
			new Float32Array( [0, 1, 0, 1, 1, 0, 2, 1, 0] ),
			new Float32Array( [0, 2, 0, 1, 2, 0] ),
		],
		needsVertexColor: true,
		vertexColors: new Float32Array( [
			1, 0, 0, 0.5, 0, 0,
			0, 1, 0, 0, 0.5, 0, 0, 0.25, 0,
			0, 0, 1, 0, 0, 0.5,
		] ),
	} )
	const expected = [
		[1, 0, 0], [0.5, 0, 0],
		[0, 1, 0], [0, 0.5, 0], [0, 0.25, 0],
		[0, 0, 1], [0, 0, 0.5],
	]
	assert.deepEqual( pointColors( geometry ), expected )

	// Same topology: positions update in place and the colors stay put.
	const vertexColor = geometry.getAttribute( 'vertexColor' )
	geometry.setPositions( [
		new Float32Array( [0, 0, 1, 1, 0, 1] ),
		new Float32Array( [0, 1, 1, 1, 1, 1, 2, 1, 1] ),
		new Float32Array( [0, 2, 1, 1, 2, 1] ),
	] )
	assert.equal( geometry.getAttribute( 'vertexColor' ), vertexColor )
	assert.deepEqual( pointColors( geometry ), expected )

	// A point-count change rebuilds, so every later line starts one slot earlier.
	geometry.setPositions( [
		new Float32Array( [0, 0, 0, 1, 0, 0] ),
		new Float32Array( [0, 1, 0, 2, 1, 0] ),
		new Float32Array( [0, 2, 0, 1, 2, 0] ),
	] )
	assert.deepEqual( pointColors( geometry ), [
		[1, 0, 0], [0.5, 0, 0],
		[0, 1, 0], [0, 0.5, 0],
		[0, 0.25, 0], [0, 0, 1],
	] )

	assert.throws(
		() => new MeshLineGeometry( {
			lines: [new Float32Array( [0, 0, 0, 1, 0, 0] ), new Float32Array( [0, 1, 0, 1, 1, 0] )],
			needsVertexColor: true,
			vertexColors: [1, 0, 0, 1, 0, 0, 0, Number.NaN, 0, 0, 1, 0],
		} ),
		/non-finite value at point 2/
	)
} )

test( 'a single-line vertex color array stays a shared pattern across a multi-line batch', () => {
	const geometry = new MeshLineGeometry( {
		lines: [
			new Float32Array( [0, 0, 0, 1, 0, 0, 2, 0, 0] ),
			new Float32Array( [0, 1, 0, 1, 1, 0, 2, 1, 0] ),
			new Float32Array( [0, 2, 0, 1, 2, 0] ),
		],
		needsVertexColor: true,
		vertexColors: [1, 0, 0, 0, 1, 0, 0, 0, 1],
	} )
	const expected = [
		[1, 0, 0], [0, 1, 0], [0, 0, 1],
		[1, 0, 0], [0, 1, 0], [0, 0, 1],
		[1, 0, 0], [0, 1, 0],
	]
	assert.deepEqual( pointColors( geometry ), expected )

	// Repeating the pattern for every point of the batch reads the same colors.
	geometry.buildLine( {
		vertexColors: new Float32Array( [
			1, 0, 0, 0, 1, 0, 0, 0, 1,
			1, 0, 0, 0, 1, 0, 0, 0, 1,
			1, 0, 0, 0, 1, 0,
		] ),
	} )
	assert.deepEqual( pointColors( geometry ), expected )
} )

test( 'closed loops reuse their first color at the seam without taking a color slot', () => {
	const expected = [
		[1, 0, 0], [0.5, 0, 0], [0.25, 0, 0], [0.125, 0, 0], [1, 0, 0],
		[0, 1, 0], [0, 0.5, 0],
	]
	const line = new MeshLine()
		.lines( [
			new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] ),
			new Float32Array( [3, 0, 0, 4, 0, 0] ),
		], [true, false] )
		.vertexColors( new Float32Array( [
			1, 0, 0, 0.5, 0, 0, 0.25, 0, 0, 0.125, 0, 0,
			0, 1, 0, 0, 0.5, 0,
		] ) )
		.build()
	assert.deepEqual( pointColors( line.geometry ), expected )

	// A range update leaves the colors alone. The edited loop's source becomes
	// its stored points without the seam, and a rebuild from that source must
	// still address the same color slots.
	line.setPositionRange( new Float32Array( [0.5, -0.5, 0] ), 0, { lineIndex: 0 } )
	assert.deepEqual( pointColors( line.geometry ), expected )
	line.rebuild()
	assert.deepEqual( pointColors( line.geometry ), expected )
} )

test( 'vertexColors() takes effect on a built line', () => {
	// A line built without colors gains the attribute and the shader path.
	const line = new MeshLine().lines( new Float32Array( [0, 0, 0, 1, 0, 0] ) ).build()
	assert.equal( line.geometry.getAttribute( 'vertexColor' ), undefined )
	line.vertexColors( new Float32Array( [1, 0, 0, 1, 0, 0] ) )
	assert.deepEqual( pointColors( line.geometry ), [[1, 0, 0], [1, 0, 0]] )
	assert.equal( line.material.options.needsVertexColor, true )

	// A new array rewrites the same buffer from the current points without
	// recompiling the material.
	const vertexColor = line.geometry.getAttribute( 'vertexColor' )
	const materialVersion = line.material.version
	line.setPositions( new Float32Array( [5, 0, 0, 6, 0, 0] ) )
	line.vertexColors( new Float32Array( [0, 0, 1, 0, 0, 1] ) )
	line.ensureBuilt()
	assert.equal( line.geometry.getAttribute( 'vertexColor' ), vertexColor )
	assert.deepEqual( pointColors( line.geometry ), [[0, 0, 1], [0, 0, 1]] )
	assert.deepEqual( pointValues( line.geometry.getAttribute( 'position' ) ), [5, 6] )
	assert.equal( line.material.version, materialVersion )

	// null drops both again.
	line.vertexColors( null )
	assert.equal( line.geometry.getAttribute( 'vertexColor' ), undefined )
	assert.equal( line.material.options.needsVertexColor, false )
	assert.deepEqual( pointValues( line.geometry.getAttribute( 'position' ) ), [5, 6] )
} )

test( 'surface lines keep late vertexColors for a later billboard build', () => {
	const line = new MeshLine()
		.lines( new Float32Array( [0, 0, 0, 1, 0, 0] ) )
		.surface( true )
		.build()
	line.vertexColors( new Float32Array( [1, 1, 0, 0, 1, 1] ) )
	assert.equal( line.geometry.isMeshLineSurfaceGeometry, true )
	assert.equal( line.geometry.getAttribute( 'vertexColor' ), undefined )

	line.surface( false )
	assert.deepEqual( pointColors( line.geometry ), [[1, 1, 0], [0, 1, 1]] )
	assert.equal( line.material.options.needsVertexColor, true )
} )

test( 'miter limits are finite and never below one', () => {
	assert.equal( new MeshLineNodeMaterial( { miterLimit: 0 } ).miterLimit, 1 )
	assert.equal( new MeshLineNodeMaterial( { miterLimit: -10 } ).miterLimit, 1 )
	assert.equal( new MeshLineNodeMaterial( { miterLimit: Number.NaN } ).miterLimit, 4 )
	assert.equal( new MeshLineNodeMaterial( { miterLimit: Infinity } ).miterLimit, 4 )

	const material = new MeshLineNodeMaterial( { miterLimit: 2 } )
	material.miterLimit = 1e100
	assert.equal( material.miterLimit, 1e6 )
	assert.equal( Number.isFinite( material._miterThreshold.value ), true )
} )
