import assert from 'node:assert/strict'
import test from 'node:test'

import { Fn } from 'three/tsl'
import { Raycaster, StorageBufferAttribute, Vector3 } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLinePicker from '../src/MeshLinePicker.js'
import { storagePositions } from '../src/positions/storagePositions.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

// `dynamic( 'storage' )` keeps a line's points in one GPU storage buffer once a
// WebGPU renderer draws it. A renderer is all the line asks about the backend.
const createBackend = isWebGPUBackend => {
	const released = []
	return { released, backend: { isWebGPUBackend }, _attributes: { delete: attribute => released.push( attribute ) } }
}

const createPath = ( pointCount, offset = 0 ) => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		points[i * 3] = i + offset
		points[i * 3 + 1] = Math.sin( i * 0.5 + offset )
		points[i * 3 + 2] = offset
	}
	return points
}

// The xyz of every stored point, without the unused fourth component.
const storedPoints = line => {
	const { array } = line.positionStorage
	const points = []
	for ( let i = 0; i < array.length; i += 4 ) points.push( array[i], array[i + 1], array[i + 2] )
	return points
}

const draw = ( line, renderer ) => line.onBeforeRender( renderer )

test( 'a WebGPU renderer moves a storage line into one storage buffer', () => {
	const renderer = createBackend( true )
	const points = createPath( 50 )
	const line = new MeshLine().lines( points ).dynamic( 'storage' ).build()

	// Until a renderer draws it the line cannot know its backend.
	assert.equal( line.positionStorage, null )
	assert.ok( line.geometry.getAttribute( 'previous' ) )

	draw( line, renderer )
	const storage = line.positionStorage
	assert.ok( storage.isStorageBufferAttribute )
	assert.equal( storage.count, 50 )
	assert.equal( storage.itemSize, 4 )
	assert.deepEqual( storedPoints( line ), Array.from( points ) )
	assert.equal( line.geometry.getAttribute( 'previous' ), undefined )
	assert.equal( line.geometry.getAttribute( 'next' ), undefined )
	assert.equal( line.geometry.getAttribute( 'position' ).count, 50 * 4 )
	assert.equal( line.count, 1 )
	assert.equal( line.frustumCulled, false )
	assert.ok( buildShaderGraph( createRenderer(), line ).vertexShader.includes( 'round' ) )

	// Moving the points touches the storage buffer and nothing else.
	const versions = Object.values( line.geometry.attributes ).map( attribute => attribute.version )
	const storageVersion = storage.version
	const moved = createPath( 50, 3 )
	line.setPositions( moved )
	assert.equal( line.positionStorage, storage )
	assert.deepEqual( storedPoints( line ), Array.from( moved ) )
	assert.ok( storage.version > storageVersion )
	assert.deepEqual( Object.values( line.geometry.attributes ).map( attribute => attribute.version ), versions )

	// lines() with the same shape is the same update.
	const again = createPath( 50, 7 )
	line.lines( again )
	assert.equal( line.positionStorage, storage )
	assert.deepEqual( storedPoints( line ), Array.from( again ) )

	line.dispose()
	assert.ok( renderer.released.includes( storage ) )
	assert.equal( line.positionStorage, null )
} )

test( 'equal-length batches store one instance per line', () => {
	const lines = [createPath( 20 ), createPath( 20, 5 ), createPath( 20, 9 )]
	const line = new MeshLine().lines( lines ).dynamic( 'storage' ).build()
	draw( line, createBackend( true ) )
	assert.equal( line.positionStorage.count, 60 )
	assert.equal( line.count, 3 )
	assert.equal( line.geometry.getAttribute( 'position' ).count, 20 * 4 )
	assert.deepEqual( storedPoints( line ), lines.flatMap( points => Array.from( points ) ) )

	lines[1] = createPath( 20, 2 )
	line.setPositions( lines )
	assert.deepEqual( storedPoints( line ), lines.flatMap( points => Array.from( points ) ) )
	line.dispose()
} )

test( 'the WebGL2 backend and unsupported lines keep drawing from attributes', () => {
	const fallback = new MeshLine().lines( createPath( 30 ) ).dynamic( 'storage' ).build()
	draw( fallback, createBackend( false ) )
	assert.equal( fallback.positionStorage, null )
	fallback.setPositions( createPath( 30, 2 ) )
	assert.equal( fallback.geometry.getAttribute( 'position' ).array[0], 2 )
	assert.equal( fallback.geometry.getAttribute( 'position' ).usage, 35040 )
	fallback.dispose()

	// A renderer that changes backend moves the line with it.
	const moving = new MeshLine().lines( createPath( 30 ) ).dynamic( 'storage' )
	draw( moving, createBackend( true ) )
	assert.ok( moving.positionStorage )
	draw( moving, createBackend( false ) )
	assert.equal( moving.positionStorage, null )
	assert.ok( moving.geometry.getAttribute( 'previous' ) )
	assert.equal( moving.count, 1 )
	moving.dispose()

	const unsupported = {
		'plain dynamic': line => line.dynamic( true ),
		'closed loop': line => line.closed( true ),
		'gradient': line => line.gradientColor( 0xff0000 ),
		'dashes': line => line.dash( { count: 4 } ),
		'width callback': line => line.widthCallback( progress => 1 + progress ),
		'vertex colors': line => line.vertexColors( new Float32Array( 90 ) ),
		'progress hook': line => line.colorFn( Fn( ( [color] ) => color ) ),
		'own position node': line => line.gpuPositionNode( Fn( ( [progress] ) => progress.mul( 2 ).toVec3() ) ),
		'instances': line => line.instances( 4 ),
		'smoothed bends': line => line.smoothSharpBends( true ),
		'number arrays': line => line.lines( Array.from( createPath( 30 ) ) ),
		'vectors': line => line.lines( [new Vector3(), new Vector3( 1, 0, 0 ), new Vector3( 2, 1, 0 )] ),
		'unequal batch': line => line.lines( [createPath( 30 ), createPath( 31 )] ),
		'surface': line => line.surface( true ),
	}
	for ( const [name, configure] of Object.entries( unsupported ) ) {
		const line = configure( new MeshLine().lines( createPath( 30 ) ).dynamic( 'storage' ) )
		draw( line, createBackend( true ) )
		assert.equal( line.positionStorage, null, name )
		line.dispose()
	}

	// A hook that does not read progress is fine once the line says so.
	const hooked = new MeshLine().lines( createPath( 30 ) ).dynamic( 'storage' ).needsProgress( false ).colorFn( Fn( ( [color] ) => color ) )
	draw( hooked, createBackend( true ) )
	assert.ok( hooked.positionStorage )
	hooked.dispose()
} )

test( 'options and shapes move a built line between storage and attributes', () => {
	const renderer = createBackend( true )
	const line = new MeshLine().lines( createPath( 40 ) ).dynamic( 'storage' )
	draw( line, renderer )
	const first = line.positionStorage
	assert.ok( first )

	// A gradient reads arc-length progress: back to attributes, with the latest points.
	const moved = createPath( 40, 4 )
	line.setPositions( moved )
	line.gradientColor( 0xff0000 )
	assert.equal( line.positionStorage, null )
	assert.ok( renderer.released.includes( first ) )
	assert.ok( line.geometry.getAttribute( 'previous' ) )
	assert.equal( line.geometry.getAttribute( 'position' ).array[0], 4 )
	assert.equal( line.count, 1 )

	line.gradientColor( null )
	assert.ok( line.positionStorage )
	assert.deepEqual( storedPoints( line ), Array.from( moved ) )

	// Geometry-only setters rebuild the whole line while it is stored.
	line.join( 'bevel' )
	assert.ok( line.positionStorage )
	line.miterLimit( 8 )
	line.lineWidth( 2 )
	assert.ok( line.positionStorage )

	// Another point count gets another buffer.
	const before = line.positionStorage
	const longer = createPath( 55, 1 )
	line.setPositions( longer )
	assert.notEqual( line.positionStorage, before )
	assert.equal( line.positionStorage.count, 55 )
	assert.deepEqual( storedPoints( line ), Array.from( longer ) )
	assert.equal( line.geometry.getAttribute( 'position' ).count, 55 * 4 )

	// Closing the loop, or a custom attribute, needs the attribute layout.
	line.lines( longer, true )
	assert.equal( line.positionStorage, null )
	line.lines( longer, false )
	assert.ok( line.positionStorage )
	line.addVertexAttribute( 'weight', 1 )
	assert.equal( line.positionStorage, null )
	assert.equal( line.geometry.getAttribute( 'weight' ).count, 55 * 4 )
	line.lineWidth( 3 )
	assert.equal( line.positionStorage, null )

	// dynamic( true ) and dynamic( false ) leave storage for good.
	const other = new MeshLine().lines( createPath( 40 ) ).dynamic( 'storage' )
	draw( other, renderer )
	assert.ok( other.positionStorage )
	other.dynamic( true )
	assert.equal( other.positionStorage, null )
	draw( other, renderer )
	assert.equal( other.positionStorage, null )
	assert.equal( other.geometry.getAttribute( 'position' ).usage, 35040 )
	other.dynamic( 'storage' )
	draw( other, renderer )
	assert.ok( other.positionStorage )
	other.dispose()
	line.dispose()
} )

test( 'antialias() rebuilds the material of a stored line from its storage options', () => {
	// antialias() rebuilds only the material. Built from the facade's own options
	// it would read `previous` and `next` attributes the template geometry lacks.
	const warnings = []
	const warn = console.warn
	console.warn = ( ...args ) => warnings.push( args.join( ' ' ) )
	try {
		const points = createPath( 30 )
		const line = new MeshLine().lines( points ).dynamic( 'storage' )
		draw( line, createBackend( true ) )
		const storage = line.positionStorage
		const positionNode = line.material.gpuPositionNode
		assert.ok( positionNode )
		line.material.resolution.value.set( 640, 480 )

		for ( const enabled of [true, false, true] ) {
			line.antialias( enabled )
			assert.equal( line.positionStorage, storage )
			assert.equal( line.material.gpuPositionNode, positionNode, `antialias( ${enabled} ) keeps the position node` )
			assert.equal( line.material.antialias, enabled )
			assert.equal( line.material.transparent, enabled )
			assert.deepEqual( line.material.resolution.value.toArray(), [640, 480] )
			const { vertexShader } = buildShaderGraph( createRenderer(), line )
			assert.match( vertexShader, /round/ )
			assert.doesNotMatch( vertexShader, /\bprevious\b/ )
		}
		assert.deepEqual( warnings.filter( warning => /not found on geometry/.test( warning ) ), [] )
		assert.deepEqual( storedPoints( line ), Array.from( points ) )

		// The attribute path is rebuilt from the facade's options, as before.
		const plain = new MeshLine().lines( createPath( 30 ) ).dynamic( true ).build()
		plain.antialias( true )
		assert.equal( plain.material.gpuPositionNode, null )
		assert.match( buildShaderGraph( createRenderer(), plain ).vertexShader, /\bprevious\b/ )
		plain.dispose()
		line.dispose()
	} finally {
		console.warn = warn
	}
} )

test( 'range edits upload only their points and survive a rebuild', () => {
	const source = [createPath( 10 ), createPath( 10, 20 )]
	const untouched = source.map( points => points.slice() )
	const line = new MeshLine().lines( source ).dynamic( 'storage' )
	draw( line, createBackend( true ) )
	const storage = line.positionStorage
	storage.clearUpdateRanges()

	line.setPositionRange( new Float32Array( [100, 101, 102, 200, 201, 202] ), 3, { lineIndex: 1 } )
	assert.deepEqual( storage.updateRanges, [{ start: ( 10 + 3 ) * 4, count: 2 * 4 }] )
	assert.deepEqual( Array.from( storage.array.subarray( 52, 60 ) ), [100, 101, 102, 0, 200, 201, 202, 0] )
	// The caller's arrays are left alone.
	assert.deepEqual( source.map( points => Array.from( points ) ), untouched.map( points => Array.from( points ) ) )

	// Tuples and vectors are accepted like on the attribute path.
	line.setPositionRange( [[7, 8, 9]], 0 )
	line.setPositionRange( [new Vector3( 4, 5, 6 )], 9 )
	assert.deepEqual( Array.from( storage.array.subarray( 0, 3 ) ), [7, 8, 9] )
	assert.deepEqual( Array.from( storage.array.subarray( 36, 39 ) ), [4, 5, 6] )

	assert.throws( () => line.setPositionRange( new Float32Array( 6 ), 9 ), /outside the 10 stored points/ )
	assert.throws( () => line.setPositionRange( new Float32Array( 3 ), 0, { lineIndex: 2 } ), /outside the 2 stored lines/ )
	assert.throws( () => line.setPositionRange( new Float32Array( 4 ), 0 ), /complete xyz points/ )

	// A rebuild, here onto attributes, replays every edit.
	const expected = storedPoints( line )
	line.join( 'round' )
	assert.deepEqual( storedPoints( line ), expected )
	line.dash( { count: 3 } )
	assert.equal( line.positionStorage, null )
	assert.deepEqual( line.geometry._lines.flatMap( points => Array.from( points ) ), expected )

	// An edit the source already holds keeps using the caller's arrays.
	const held = createPath( 6 )
	const heldLine = new MeshLine().lines( held ).dynamic( 'storage' )
	draw( heldLine, createBackend( true ) )
	held[3] = 50
	heldLine.setPositionRange( held.subarray( 3, 6 ), 1 )
	assert.equal( heldLine._options.lines, held )
	assert.equal( heldLine.positionStorage.array[4], 50 )
	heldLine.dispose()
	line.dispose()
} )

test( 'raycasting and picking follow the stored points', () => {
	const line = new MeshLine().lines( new Float32Array( [-5, 0, 0, 0, 0, 0, 5, 0, 0] ) ).dynamic( 'storage' ).lineWidth( 0.2 )
	const picker = new MeshLinePicker()
	picker.add( line )
	const [entry] = [...picker._registry.values()]
	assert.equal( entry.material.gpuPositionNode, null )

	draw( line, createBackend( true ) )
	line.setPositions( new Float32Array( [-5, 3, 0, 0, 3, 0, 5, 3, 0] ) )
	line.updateMatrixWorld()

	const raycaster = new Raycaster()
	raycaster.params.Line = { threshold: 0.1 }
	raycaster.set( new Vector3( 2, 3, 10 ), new Vector3( 0, 0, -1 ) )
	const hits = raycaster.intersectObject( line )
	assert.equal( hits.length, 1 )
	assert.equal( hits[0].index, 1 )
	assert.ok( Math.abs( hits[0].point.y - 3 ) < 1e-6 )
	raycaster.set( new Vector3( 2, 0, 10 ), new Vector3( 0, 0, -1 ) )
	assert.equal( raycaster.intersectObject( line ).length, 0 )

	// The picking proxy shares the template geometry, so it needs the same node.
	picker._syncProxyMaterial( entry )
	assert.equal( entry.material.gpuPositionNode, line.material.gpuPositionNode )
	assert.ok( entry.material.gpuPositionNode )
	line.gradientColor( 0x00ff00 )
	picker._syncProxyMaterial( entry )
	assert.equal( entry.material.gpuPositionNode, null )
	picker.dispose()
	line.dispose()
} )

test( 'snapped storage positions read each stored point once', () => {
	const buffer = new StorageBufferAttribute( 64, 4 )
	const build = snap => {
		const line = new MeshLine().instances( 1 ).segments( 63 ).gpuPositionNode( storagePositions( buffer, { pointsPerLine: 64, snap } ) ).build()
		const { vertexShader } = buildShaderGraph( createRenderer(), line )
		line.dispose()
		return vertexShader
	}
	const reads = shader => shader.match( /\.value\[/g )?.length ?? 0
	const interpolated = build( false )
	const snapped = build( true )
	assert.ok( reads( snapped ) > 0 )
	assert.equal( reads( snapped ) * 2, reads( interpolated ) )
	assert.match( snapped, /round/ )
} )
