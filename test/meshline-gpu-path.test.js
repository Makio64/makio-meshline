import assert from 'node:assert/strict'
import test from 'node:test'

import { PerspectiveCamera } from 'three/webgpu'

import MeshLineGPUPath, { _gpuPathInternals } from '../src/MeshLineGPUPath.js'

const {
	normalizeOpenPoints,
	createChunkPlan,
	computeDyadicChunkErrors,
	computeDyadicImportance,
	createStableSegmentRecords,
} = _gpuPathInternals

const createRendererStub = ( nativeWebGPU = true ) => ( {
	isWebGPURenderer: true,
	backend: { isWebGPUBackend: nativeWebGPU, device: {} },
	computeCalls: [],
	async init() {},
	async computeAsync( nodes ) {
		this.computeCalls.push( nodes )
	},
	getSize( target ) {
		return target.set( 800, 600 )
	},
} )

test( 'open point normalization validates Float32 data and compacts consecutive duplicates', () => {
	const points = normalizeOpenPoints( [
		[0, 0, 0],
		[0, 0, 0],
		{x: 1, y: 2, z: 3},
		[2, 4],
	] )
	assert.deepEqual( Array.from( points ), [0, 0, 0, 1, 2, 3, 2, 4, 0] )
	assert.throws( () => normalizeOpenPoints( [0, 0, 0, Infinity, 0, 0] ), /non-finite/ )
	assert.throws( () => normalizeOpenPoints( [0, 0, 0, 1, 0] ), /complete xyz/ )
	assert.throws( () => normalizeOpenPoints( [0, 0, 0, 0, 0, 0] ), /two distinct/ )
} )

test( 'chunk planning owns every segment exactly once and shares only read seams', () => {
	const chunks = createChunkPlan( 11, 4 )
	assert.deepEqual( chunks, [
		{ pointStart: 0, segmentStart: 0, segmentCount: 4 },
		{ pointStart: 4, segmentStart: 4, segmentCount: 4 },
		{ pointStart: 8, segmentStart: 8, segmentCount: 2 },
	] )
	const owned = chunks.flatMap( chunk => Array.from( { length: chunk.segmentCount }, ( _, i ) => chunk.segmentStart + i ) )
	assert.deepEqual( owned, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] )
	assert.equal( chunks[0].pointStart + chunks[0].segmentCount, chunks[1].pointStart )
	assert.throws( () => createChunkPlan( 8, 3 ), /power of two/ )
} )

test( 'dyadic oracle reports a finite local error and protects chunk endpoints', () => {
	const points = new Float32Array( [
		0, 0, 0,
		1, 0, 0,
		2, 5, 0,
		3, 0, 0,
		4, 0, 0,
	] )
	const chunks = createChunkPlan( 5, 4 )
	const { errors, levelCount } = computeDyadicChunkErrors( points, chunks )
	assert.equal( levelCount, 3 )
	assert.equal( errors[0], 0 )
	assert.ok( errors[2] >= 5 )
	assert.ok( errors.every( Number.isFinite ) )

	const importance = computeDyadicImportance( points, chunks )
	assert.ok( Number.isFinite( importance[0] ) )
	assert.ok( Number.isFinite( importance[4] ) )
	assert.ok( importance[0] > 1e30 )
	assert.ok( importance[4] > 1e30 )
	assert.ok( importance[2] >= 5 )
} )

test( 'stable segment records preserve source order and never bridge an invisible chunk', () => {
	const chunks = createChunkPlan( 7, 2 )
	const full = createStableSegmentRecords( 7, chunks )
	assert.deepEqual( Array.from( full ), [
		0, 0, 1, 2,
		0, 1, 2, 3,
		1, 2, 3, 4,
		2, 3, 4, 5,
		3, 4, 5, 6,
		4, 5, 6, 6,
	] )

	const culled = createStableSegmentRecords( 7, chunks, new Uint8Array( [1, 0, 1] ) )
	assert.deepEqual( Array.from( culled ), [
		0, 0, 1, 2,
		0, 1, 2, 2,
		4, 4, 5, 6,
		4, 5, 6, 6,
	] )
	for ( let offset = 0; offset < culled.length; offset += 4 ) {
		assert.notEqual( culled[offset + 1], 2, 'no output segment may start at the left side of the culled gap' )
		assert.notEqual( culled[offset + 2], 4, 'no output segment may end at the right side of the culled gap' )
	}
} )

test( 'unsupported backend, closed path, and XR stay on the complete CPU fallback', async () => {
	const points = new Float32Array( [0, 0, 0, 1, 1, 0, 2, 0, 0] )
	const backendFallback = new MeshLineGPUPath( { lines: points } )
	assert.equal( await backendFallback.prepare( createRendererStub( false ) ), false )
	assert.equal( backendFallback.fallback.visible, true )
	assert.equal( backendFallback.status.fallback, 'cpu-full-detail' )
	backendFallback.dispose()

	const closed = new MeshLineGPUPath( { lines: points, closed: true } )
	assert.equal( await closed.prepare( createRendererStub() ), false )
	assert.match( closed.status.reason, /closed lines/ )
	assert.equal( closed.fallback.visible, true )
	closed.dispose()

	const xr = new MeshLineGPUPath( { lines: points } )
	const arrayCamera = new PerspectiveCamera()
	arrayCamera.isArrayCamera = true
	assert.equal( await xr.prepare( createRendererStub(), arrayCamera ), false )
	assert.match( xr.status.reason, /ArrayCamera\/XR/ )
	xr.dispose()

	const dashed = new MeshLineGPUPath( { lines: points, dash: { count: 4 } } )
	assert.equal( await dashed.prepare( createRendererStub() ), false )
	assert.match( dashed.status.reason, /dash is not supported/ )
	assert.equal( dashed.fallback.visible, true )
	dashed.dispose()
} )

test( 'native preparation creates a stable non-indexed indirect path and retains fallback resources', async () => {
	const renderer = createRendererStub()
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [
			0, 0, 0,
			1, 0, 0,
			2, 1, 0,
			3, 1, 0,
			4, 0, 0,
		] ),
		lineWidth: 0.5,
		color: 0x22d3ee,
	}, {
		chunkSegments: 2,
		simplify: { localTolerance: 0.1 },
	} )

	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), true )
	assert.equal( path.status.active, true )
	assert.equal( path.status.stableOrder, true )
	assert.equal( path.status.segmentRecords, 'storage' )
	assert.equal( path.status.prefixScan, 'serial' )
	assert.equal( path.status.simplification, 'experimental-dyadic-local' )
	assert.equal( path.status.reversalSplitting, 'retained-points-only' )
	assert.equal( path.fallback.visible, false )
	assert.ok( path.fallback.geometry, 'the full CPU fallback remains allocated' )
	assert.ok( path.gpuMesh )
	assert.equal( path.gpuMesh.geometry.getIndex(), null )
	assert.equal( path.gpuMesh.geometry.getIndirect().isIndirectStorageBufferAttribute, true )
	assert.equal( path._resources.segmentAttribute.count, 4 )
	assert.equal( renderer.computeCalls.length, 1 )
	assert.equal( renderer.computeCalls[0].length, 4 )

	await path.setSimplificationTolerance( 0.2 )
	assert.equal( renderer.computeCalls.length, 2 )
	assert.equal( renderer.computeCalls[1].length, 3 )
	const updated = await path.setPositions( new Float32Array( [0, 0, 0, 1, 0, 0, 2, 0, 0] ) )
	assert.equal( updated, path )
	assert.equal( path.status.active, true )
	assert.equal( path._resources.segmentAttribute.count, 2 )
	path.dispose()
} )

test( 'raw native path derives canonical records without a segment buffer or compute dispatch', async () => {
	const renderer = createRendererStub()
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 2, 1, 0] ),
	} )

	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), true )
	assert.equal( renderer.computeCalls.length, 0 )
	assert.equal( path._resources.segmentAttribute, null )
	assert.equal( path.status.segmentRecords, 'derived' )
	assert.equal( path.status.prefixScan, 'none' )
	assert.equal( path.gpuMesh.geometry.getIndirect().array[0], 12 )
	path.dispose()
} )
