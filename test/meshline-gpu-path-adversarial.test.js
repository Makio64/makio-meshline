import assert from 'node:assert/strict'
import test from 'node:test'

import {
	BufferGeometry,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	PerspectiveCamera,
} from 'three/webgpu'

import MeshLineGPUPath, { _gpuPathInternals } from '../src/MeshLineGPUPath.js'

const createStrictRendererStub = () => ( {
	isWebGPURenderer: true,
	backend: { isWebGPUBackend: true, device: {} },
	computeCalls: [],
	async init() {},
	async computeAsync( nodes ) {
		if ( !nodes?.[0]?.isComputeNode ) throw new Error( 'THREE.Renderer: .compute() expects a ComputeNode.' )
		this.computeCalls.push( nodes )
	},
	getSize( target ) {
		return target.set( 800, 600 )
	},
} )

test( 'raw mode tolerance updates do not submit an empty compute list or disable the active path', async () => {
	const renderer = createStrictRendererStub()
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 2, 1, 0] ),
	} )

	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), true )
	assert.equal( path.status.active, true )
	await path.setSimplificationTolerance( 0.25 )

	assert.equal( renderer.computeCalls.length, 0 )
	assert.equal( path.status.active, true )
	assert.equal( path.status.fallback, null )
	path.dispose()
} )

test( 'chunk sizes cannot overflow uint stride math or create fractional hierarchy levels', () => {
	const points = new Float32Array( [0, 0, 0, 1, 0, 0] )
	for ( const chunkSegments of [2 ** 32, 2 ** 32 + 1, 3 * 2 ** 32, 8192] ) {
		assert.throws(
			() => new MeshLineGPUPath( { lines: points }, { chunkSegments, simplify: true } ),
			/power of two no greater than 4096/
		)
	}
} )

test( 'BufferGeometry normalization reads logical interleaved position records', () => {
	const geometry = new BufferGeometry()
	const interleaved = new InterleavedBuffer( new Float32Array( [
		0, 0, 0, 91,
		1, 2, 3, 92,
		4, 5, 6, 93,
	] ), 4 )
	geometry.setAttribute( 'position', new InterleavedBufferAttribute( interleaved, 3, 0 ) )

	const normalized = _gpuPathInternals.normalizeOpenPoints( geometry )
	assert.deepEqual( Array.from( normalized ), [
		0, 0, 0,
		1, 2, 3,
		4, 5, 6,
	] )
	geometry.dispose()
} )

test( 'preparation does not replace normalized BufferGeometry points with the fallback raw storage', async () => {
	const geometry = new BufferGeometry()
	const interleaved = new InterleavedBuffer( new Float32Array( [
		0, 0, 0, 91,
		1, 2, 3, 92,
		4, 5, 6, 93,
	] ), 4 )
	geometry.setAttribute( 'position', new InterleavedBufferAttribute( interleaved, 3, 0 ) )
	const path = new MeshLineGPUPath( { lines: geometry } )
	assert.deepEqual( Array.from( path.fallback.geometry._lines[0] ), [
		0, 0, 0,
		1, 2, 3,
		4, 5, 6,
	] )

	assert.equal( await path.prepare( createStrictRendererStub(), new PerspectiveCamera() ), true )
	assert.deepEqual( Array.from( path._points ), [
		0, 0, 0,
		1, 2, 3,
		4, 5, 6,
	] )
	path.dispose()
	geometry.dispose()
} )

test( 'GPU geometry keeps source bounds for transparent sorting', async () => {
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [100, 0, 0, 150, 2, 0, 200, 0, 0] ),
		opacity: 0.5,
		transparent: true,
	} )

	assert.equal( await path.prepare( createStrictRendererStub(), new PerspectiveCamera() ), true )
	assert.ok( path.gpuMesh.geometry.boundingSphere.radius > 0 )
	assert.equal( path.gpuMesh.geometry.boundingSphere.center.x, path.fallback.geometry.boundingSphere.center.x )
	assert.equal( path.gpuMesh.geometry.boundingBox.min.x, path.fallback.geometry.boundingBox.min.x )
	path.dispose()
} )

test( 'failed compute preparation releases hidden GPU resources and keeps the CPU path', async () => {
	const renderer = createStrictRendererStub()
	renderer.computeAsync = async () => { throw new Error( 'synthetic compute failure' ) }
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [0, 0, 0, 1, 1, 0, 2, 0, 0] ),
	}, {
		simplify: { localTolerance: 0.1 },
	} )

	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), false )
	assert.equal( path.gpuMesh, null )
	assert.equal( path._resources, null )
	assert.equal( path.fallback.visible, true )
	assert.equal( path.status.fallback, 'cpu-full-detail' )
	path.dispose()
} )

test( 'setPositions can transition an initially unsupported multi-line path to one GPU line', async () => {
	const first = new Float32Array( [0, 0, 0, 1, 0, 0] )
	const second = new Float32Array( [0, 1, 0, 1, 1, 0] )
	const path = new MeshLineGPUPath( { lines: [first, second] } )
	const renderer = createStrictRendererStub()

	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), false )
	await path.setPositions( new Float32Array( [0, 0, 0, 1, 1, 0, 2, 0, 0] ) )
	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), true )
	assert.equal( path.status.active, true )
	path.dispose()
} )
