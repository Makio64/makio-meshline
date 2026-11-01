import assert from 'node:assert/strict'
import test from 'node:test'

import { PerspectiveCamera, Scene } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLineCompute from '../src/MeshLineCompute.js'
import MeshLineCullingSystem from '../src/MeshLineCullingSystem.js'
import MeshLineGPUPath from '../src/MeshLineGPUPath.js'

// Three r186 frees a storage or indirect buffer only through the renderer's
// attribute map; r187+ also listens for attribute.dispose(). These stubs record
// both paths; live GPUBuffer counts need a real WebGPU device.
const trackReleases = renderer => {
	const released = []
	renderer._attributes = {
		delete( attribute ) {
			released.push( attribute )
		},
	}
	return released
}

const storageResources = resources => Object.values( resources ).filter( resource => resource?.isStorageBufferAttribute === true )

const trackDisposeEvents = attributes => {
	const disposed = new Set()
	for ( const attribute of attributes ) {
		attribute.addEventListener?.( 'dispose', () => disposed.add( attribute ) )
	}
	return disposed
}

const trackNodeDisposals = nodes => {
	const disposed = new Set()
	for ( const node of nodes ) node.addEventListener( 'dispose', () => disposed.add( node ) )
	return disposed
}

const openPoints = count => {
	const points = new Float32Array( count * 3 )
	for ( let i = 0; i < count; i++ ) {
		points[i * 3] = i * 0.25
		points[i * 3 + 1] = Math.sin( i * 0.7 )
	}
	return points
}

const createGPUPathRendererStub = () => ( {
	isWebGPURenderer: true,
	backend: { isWebGPUBackend: true, device: {} },
	async init() {},
	async computeAsync() {},
	getSize( target ) {
		return target.set( 800, 600 )
	},
} )

test( 'GPU path rebuilds and dispose release every storage and indirect buffer once', async () => {
	const renderer = createGPUPathRendererStub()
	const released = trackReleases( renderer )
	const path = new MeshLineGPUPath( { lines: openPoints( 40 ) }, {
		chunkSegments: 8,
		simplify: { localTolerance: 0.01 },
	} )

	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), true )
	const first = storageResources( path._resources )
	assert.equal( first.length, 6, 'points, chunks, errors, states, segments and the indirect draw' )
	assert.ok( first.some( attribute => attribute.isIndirectStorageBufferAttribute ) )
	const firstDisposed = trackDisposeEvents( first )
	const firstNodes = trackNodeDisposals( path._computeNodes )
	const nodeCount = path._computeNodes.length

	await path.setPositions( openPoints( 48 ) )
	assert.deepEqual( released, first )
	if ( typeof first[0].dispose === 'function' ) assert.equal( firstDisposed.size, first.length )
	assert.equal( firstNodes.size, nodeCount )

	const second = storageResources( path._resources )
	assert.equal( second.some( attribute => first.includes( attribute ) ), false )
	path.dispose()
	assert.deepEqual( released, [...first, ...second] )
	assert.equal( path._resources, null )
} )

test( 'GPU path variable topology releases its primitive buffers on dispose', async () => {
	const renderer = createGPUPathRendererStub()
	const released = trackReleases( renderer )
	const path = new MeshLineGPUPath( {
		lines: openPoints( 24 ),
		join: { type: 'round', segments: 4 },
		cap: { type: 'round', segments: 4 },
	}, { variableTopology: true } )

	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), true )
	const resources = storageResources( path._resources )
	assert.ok( path._resources.primitiveAttribute )
	path.dispose()
	assert.deepEqual( released, resources )
} )

test( 'MeshLineCompute resize, rebuild and dispose release storage and compute nodes', () => {
	const renderer = { compute() {} }
	const released = trackReleases( renderer )
	const buffers = line => [line.positionBuffer, line.velocityBuffer, line.baseBuffer, line.seedBuffer, line.distanceBuffer]
	const line = new MeshLineCompute( { curveCount: 3, pointsPerCurve: 4 } ).build()
	assert.equal( line.step( renderer ), true )

	const first = buffers( line )
	const firstNodes = trackNodeDisposals( [line._computeNode, line._distanceComputeNode] )
	line.curveLength( 6 ).ensureBuilt()
	assert.equal( released.length, 0, 'same-size rebuilds keep their storage' )
	assert.equal( firstNodes.size, 2, 'rebuilt compute nodes dispose the previous pair' )
	assert.deepEqual( buffers( line ), first )

	const rebuiltNodes = trackNodeDisposals( [line._computeNode, line._distanceComputeNode] )
	line.curveCount( 5 ).ensureBuilt()
	assert.deepEqual( released, first )
	assert.equal( rebuiltNodes.size, 2 )

	const second = buffers( line )
	const secondDisposed = trackDisposeEvents( second )
	const secondNodes = trackNodeDisposals( [line._computeNode, line._distanceComputeNode] )
	line.dispose()
	assert.deepEqual( released, [...first, ...second] )
	if ( typeof second[0].dispose === 'function' ) assert.equal( secondDisposed.size, second.length )
	assert.equal( secondNodes.size, 2 )
	assert.equal( line.positionBuffer, null )
	assert.equal( line._storageRenderer, null )
} )

test( 'MeshLineCompute remembers the renderer that drew it without a compute step', () => {
	const renderer = {}
	const released = trackReleases( renderer )
	const line = new MeshLineCompute( { curveCount: 2, pointsPerCurve: 3 } ).build()
	line.onBeforeRender( renderer, new Scene(), new PerspectiveCamera(), line.geometry, line.material, null )
	const storage = [line.positionBuffer, line.velocityBuffer, line.baseBuffer, line.seedBuffer, line.distanceBuffer]
	line.dispose()
	assert.deepEqual( released, storage )
} )

test( 'culling refresh, remove and system dispose release every storage and indirect buffer', () => {
	const renderer = {
		isWebGPURenderer: true,
		backend: { isWebGPUBackend: true, device: {} },
		compute() {},
	}
	const released = trackReleases( renderer )
	const line = new MeshLine().lines( openPoints( 40 ) ).build()
	const system = MeshLineCullingSystem.attach( renderer, new Scene(), { autoUpdate: false, chunkSize: 2, mode: 'webgpu' } )
	const handle = system.add( line )
	assert.equal( handle.enabled, true )

	const first = storageResources( handle._resources )
	assert.equal( first.length, 7, 'source, output, chunks, bounds, visibility, offsets and the indirect draw' )
	const firstNodes = trackNodeDisposals( [handle._resources.resetNode, handle._resources.cullNode] )
	assert.equal( handle.refresh(), true )
	assert.deepEqual( released, first )
	assert.equal( firstNodes.size, 2 )

	const second = storageResources( handle._resources )
	system.dispose()
	assert.deepEqual( released, [...first, ...second] )
	assert.equal( handle._resources, null )
	assert.equal( line.geometry.getIndex().isStorageBufferAttribute, undefined, 'the source index is restored' )
	line.dispose()
} )
