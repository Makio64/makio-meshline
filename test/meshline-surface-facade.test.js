import assert from 'node:assert/strict'
import test from 'node:test'

import { Raycaster, Texture, Vector3 } from 'three/webgpu'

import MeshLine, {
	MeshLineSurfaceGeometry,
	MeshLineSurfaceNodeMaterial,
} from '../src/index.js'

const roadPoints = new Float32Array( [
	0, 0, 0,
	0, 0, 2,
	1, 0, 4,
] )

test( 'MeshLine surface profile uses lit world-space geometry through the facade', () => {
	const road = new MeshLine( {
		lines: roadPoints,
		lineWidth: 2,
		needsUV: true,
		surface: {
			frame: 'fixed-up',
			up: [0, 1, 0],
			roughness: 0.8,
		},
	} ).build()

	assert.ok( road.geometry instanceof MeshLineSurfaceGeometry )
	assert.ok( road.material instanceof MeshLineSurfaceNodeMaterial )
	assert.equal( road.material.roughness, 0.8 )
	assert.equal( road.geometry.getAttribute( 'position' ).count, 6 )
	assert.equal( road.geometry.getAttribute( 'normal' ).count, 6 )
	assert.equal( road.geometry.getAttribute( 'uv' ).count, 6 )

	road.dispose()
} )

test( 'surface geometry rebuilds for live width/path updates and can switch profiles', () => {
	const road = new MeshLine()
		.lines( roadPoints )
		.lineWidth( 1 )
		.surface( { frame: 'transport' } )
		.build()

	const firstPosition = road.geometry.getAttribute( 'position' )
	road.lineWidth( 2 )
	assert.equal( road.geometry.getAttribute( 'position' ), firstPosition )

	road.setPositions( new Float32Array( [0, 0, 0, 0, 0, 3, 2, 0, 6] ) )
	assert.equal( road.geometry.getAttribute( 'position' ), firstPosition )

	road.surface( false )
	assert.equal( road.geometry.isMeshLine, true )
	assert.equal( road.material.isMeshLineNodeMaterial, true )
	assert.equal( road.geometry.getAttribute( 'position' ).count, 12 )
	assert.deepEqual( Array.from( road.geometry.getAttribute( 'joinRole' ).array ), [
		-1, -2, 1, 2,
		-1, -2, 1, 2,
		-1, -2, 1, 2,
	] )
	assert.deepEqual( Array.from( road.geometry.getIndex().array ), [
		2, 3, 4, 4, 3, 5,
		6, 7, 8, 8, 7, 9,
	] )

	road.dispose()
} )

test( 'surface facade retains and rebuilds the clipped inner-join policy', () => {
	const line = new MeshLine()
		.lines( new Float32Array( [
			-10, 0, 0,
			0, 0, 0,
			-1, 0, Math.sqrt( 3 ),
			-6, 0, -Math.sqrt( 3 ),
		] ) )
		.lineWidth( 2 )
		.surface( { frame: 'fixed-up', up: [0, 1, 0] } )
		.join( { type: 'round', segments: 8, inner: 'clip' } )
		.build()

	assert.equal( line._options.join.inner, 'clip' )
	assert.equal( line.geometry.options.join.inner, 'clip' )
	line.join( { type: 'round', segments: 12, inner: 'clip' } )
	assert.equal( line.geometry.options.join.inner, 'clip' )
	assert.ok( line.geometry.getAttribute( 'position' ).count > 0 )
	line.dispose()
} )

test( 'surface raycast uses the generated triangles', () => {
	const road = new MeshLine()
		.lines( new Float32Array( [0, 0, 0, 0, 0, 4] ) )
		.lineWidth( 2 )
		.surface( { frame: 'fixed-up' } )
		.build()
	road.updateMatrixWorld( true )

	const raycaster = new Raycaster( new Vector3( 0, 5, 2 ), new Vector3( 0, -1, 0 ) )
	const hits = []
	road.raycast( raycaster, hits )

	assert.ok( hits.length > 0 )
	assert.equal( hits[0].object, road )

	road.dispose()
} )

test( 'surface mode rejects shader-only paths with a clear error', () => {
	const line = new MeshLine()
		.surface()
		.gpuPositionNode( () => null )

	assert.throws( () => line.build(), /surface mode requires CPU centerline points/ )
	line.dispose()
} )

test( 'procedural GPU paths disable template-based culling by default', () => {
	const line = new MeshLine()
		.segments( 8 )
		.gpuPositionNode( () => null )
		.build()

	assert.equal( line.frustumCulled, false )
	assert.equal( line.geometry.boundingSphere, null )
	line.dispose()
} )

test( 'facade omits progress bandwidth until an enabled feature consumes it', () => {
	const plain = new MeshLine().lines( roadPoints ).build()
	assert.equal( plain.geometry.getAttribute( 'progress' ), undefined )
	assert.equal( plain.geometry.getAttribute( 'side' ), undefined )
	assert.equal( plain.geometry.getAttribute( 'endpoint' ), undefined )

	const gradient = new MeshLine().lines( roadPoints ).gradientColor( 0xff0000 ).build()
	assert.ok( gradient.geometry.getAttribute( 'progress' ) )

	plain.dispose()
	gradient.dispose()
} )

test( 'instance batches avoid redundant pre-upload versions and support one-shot writes', () => {
	const line = new MeshLine().segments( 1 ).instances( 3 ).build()
	const offsets = line.addInstanceAttribute( 'instanceOffset', 2 )

	line.setInstanceValue( 'instanceOffset', 0, [1, 2] )
	line.setInstanceValue( 'instanceOffset', 1, [3, 4] )
	assert.equal( offsets.version, 0 )

	line._onBeforeRender()
	line.setInstanceValues( 'instanceOffset', new Float32Array( [5, 6, 7, 8] ), 1 )
	assert.equal( offsets.version, 1 )
	assert.deepEqual( offsets.updateRanges, [{ start: 2, count: 4 }] )
	assert.deepEqual( Array.from( offsets.array ), [1, 2, 5, 6, 7, 8] )
	assert.throws(
		() => line.setInstanceValues( 'instanceOffset', new Float32Array( 4 ), 2 ),
		/exceed.*capacity/i,
	)

	const late = line.addInstanceAttribute( 'lateScale', 1 )
	line.setInstanceValues( 'lateScale', new Float32Array( [1, 2, 3] ) )
	assert.equal( late.version, 0 )
	line._onBeforeRender()
	line.setInstanceValue( 'lateScale', 1, 4 )
	assert.equal( late.version, 1 )
	assert.deepEqual( late.updateRanges, [{ start: 1, count: 1 }] )

	line.dispose()
} )

test( 'facade uploads custom vertex values with bounds checking', () => {
	const line = new MeshLine().lines( roadPoints ).build()
	const weights = line.addVertexAttribute( 'customWeight', 2 )

	const result = line.setVertexValues( 'customWeight', new Float32Array( [1, 2, 3, 4] ), 1 )
	assert.equal( result, line )
	assert.deepEqual( Array.from( weights.array.slice( 2, 6 ) ), [1, 2, 3, 4] )
	assert.deepEqual( weights.updateRanges, [{ start: 2, count: 4 }] )
	assert.throws(
		() => line.setVertexValues( 'customWeight', new Float32Array( weights.array.length ), 1 ),
		/exceed.*capacity/i,
	)
	assert.throws(
		() => line.setVertexValues( 'missing', new Float32Array( [1] ) ),
		/not found/i,
	)
	for ( const name of ['position', 'previous', 'next', 'side', 'joinRole', 'width', 'uv', 'progress', 'endpoint', 'vertexColor'] ) {
		assert.throws(
			() => line.addVertexAttribute( name, 1 ),
			/reserved billboard vertex attribute/i,
		)
	}

	line.dispose()
} )

test( 'facade reports degenerate custom-attribute geometry clearly', () => {
	const line = new MeshLine().lines( new Float32Array( [0, 0, 0, 0, 0, 0] ) )
	assert.throws(
		() => line.addVertexAttribute( 'customWeight', 1 ),
		/requires at least two distinct points/i,
	)
	line.dispose()
} )

test( 'facade range updates stay billboard-only and chainable', () => {
	const line = new MeshLine().lines( roadPoints ).build()
	const result = line.setPositionRange( new Float32Array( [0.5, 0, 2] ), 1 )
	assert.equal( result, line )
	assert.equal( line.geometry._lines[0][3], 0.5 )

	line.surface().build()
	assert.throws(
		() => line.setPositionRange( new Float32Array( [0.75, 0, 2] ), 1 ),
		/only available for CPU billboard lines/i,
	)
	line.dispose()
} )

test( 'surface texture topology removes and restores optional UV storage', () => {
	const map = new Texture()
	const road = new MeshLine( { lines: roadPoints, map, surface: true } ).build()
	assert.ok( road.geometry.getAttribute( 'uv' ) )

	road.map( null )
	assert.equal( road.geometry.getAttribute( 'uv' ), undefined )

	road.alphaMap( map )
	assert.ok( road.geometry.getAttribute( 'uv' ) )
	road.alphaMap( null )
	assert.equal( road.geometry.getAttribute( 'uv' ), undefined )

	road.dispose()
	map.dispose()
} )

test( 'facade keeps automatic transparency and depth writes aligned during live updates', () => {
	const alphaMap = new Texture()

	for ( const surface of [false, true] ) {
		const line = new MeshLine( { lines: roadPoints, alphaMap, surface } ).build()
		assert.equal( line.material.transparent, true )
		assert.equal( line.material.depthWrite, false )

		line.transparent( false )
		assert.equal( line.material.transparent, true )
		assert.equal( line.material.depthWrite, false )

		line.alphaMap( null )
		assert.equal( line.material.transparent, false )
		assert.equal( line.material.depthWrite, true )

		line.opacity( 0.5 )
		assert.equal( line.material.transparent, true )
		assert.equal( line.material.depthWrite, false )

		line.opacity( 1 )
		assert.equal( line.material.transparent, false )
		assert.equal( line.material.depthWrite, true )

		line.dispose()
	}

	alphaMap.dispose()
} )
