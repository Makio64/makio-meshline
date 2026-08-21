import assert from 'node:assert/strict'
import test from 'node:test'

import { Group } from 'three/webgpu'

import MeshLineComputeDefault, { MeshLineCompute as MeshLineComputeNamed } from '../src/MeshLineCompute.js'
import MeshLineDefault, { MeshLine, MeshLineCompute } from '../src/index.js'

const STORAGE_FIELDS = [
	['positionBuffer', 3],
	['velocityBuffer', 3],
	['baseBuffer', 4],
	['seedBuffer', 4],
	['distanceBuffer', 1],
]

const snapshotStorage = line => Object.fromEntries(
	STORAGE_FIELDS.map( ( [name] ) => [name, Array.from( line[name].array )] )
)

test( 'MeshLineCompute is available through the public and direct module exports', () => {
	assert.equal( MeshLineCompute, MeshLineComputeDefault )
	assert.equal( MeshLineComputeNamed, MeshLineComputeDefault )
	assert.equal( MeshLineDefault, MeshLine )

	const line = new MeshLineCompute()
	assert.ok( line instanceof MeshLine )
	assert.equal( line.type, 'MeshLineCompute' )
	assert.equal( line.isMeshLineCompute, true )
	line.dispose()
} )

test( 'compute options normalize values while reserved topology options stay compute-managed', () => {
	const line = new MeshLineCompute( {
		curveCount: 3.9,
		pointsPerCurve: 5.9,
		segments: 99,
		curveLength: Infinity,
		bounds: 0,
		damping: 2,
		mouseRadius: -4,
		audioLevel: -2,
		mode: 'field',
		mouseTarget: { x: 1, y: 2 },
		lines: new Float32Array( [0, 0, 0, 1, 0, 0] ),
		closed: true,
		surface: true,
		gpuPositionNode: () => null,
		instanceCount: 99,
		needsPrevious: true,
		needsNext: true,
		lineWidth: 0.75,
	} )

	assert.deepEqual( line._computeOptions, {
		curveCount: 3,
		pointsPerCurve: 5,
		curveLength: 4,
		bounds: 0.001,
		damping: 1,
		curlStrength: 4,
		flowSpeed: 1,
		homeStrength: 1.4,
		mouseStrength: 8,
		mouseRadius: 0.001,
		audioLevel: 0,
		depthStrength: 0,
		textureStrength: 0,
		mode: 2,
	} )
	assert.deepEqual( line._uMouse.value.toArray(), [1, 2, 0] )
	assert.equal( line._options.segments, 1 )
	assert.equal( line._options.closed, false )
	assert.equal( line._options.surface, false )
	assert.equal( line._options.gpuPositionNode, null )
	assert.equal( line._options.instanceCount, -1 )
	assert.equal( line._options.needsPrevious, undefined )
	assert.equal( line._options.needsNext, undefined )
	assert.equal( line._options.lineWidth, 0.75 )

	assert.equal( line.configure( {
		curveCount: 0,
		segments: 0,
		mode: 'unknown',
		mouse: [-3, 4, 5],
	} ), line )
	assert.equal( line._computeOptions.curveCount, 1 )
	assert.equal( line._computeOptions.pointsPerCurve, 2 )
	assert.equal( line._computeOptions.mode, 0 )
	assert.deepEqual( line._uMouse.value.toArray(), [-3, 4, 5] )
	assert.equal( line.clearMouse(), line )
	assert.deepEqual( line._uMouse.value.toArray(), [100000, 100000, 100000] )
	line.dispose()
} )

test( 'build and rebuild size storage buffers from curve topology', () => {
	const line = new MeshLineCompute( { curveCount: 2, pointsPerCurve: 4 } )

	for ( const [name] of STORAGE_FIELDS ) assert.equal( line[name], null )
	assert.equal( line.build(), line )
	for ( const [name, itemSize] of STORAGE_FIELDS ) {
		assert.equal( line[name].isStorageBufferAttribute, true )
		assert.equal( line[name].count, 8 )
		assert.equal( line[name].itemSize, itemSize )
		assert.ok( Array.from( line[name].array ).every( Number.isFinite ) )
	}
	assert.equal( line._options.instanceCount, 2 )
	assert.equal( line._options.segments, 3 )
	assert.equal( line._options.closed, false )
	assert.equal( line._options.surface, false )
	assert.equal( line._options.frustumCulled, false )
	assert.equal( line.frustumCulled, false )

	const initialPositionBuffer = line.positionBuffer
	assert.equal( line.configure( { curveCount: 3.8, pointsPerCurve: 6.9 } ).rebuild(), line )
	assert.notEqual( line.positionBuffer, initialPositionBuffer )
	for ( const [name] of STORAGE_FIELDS ) assert.equal( line[name].count, 18 )
	assert.equal( line._options.instanceCount, 3 )
	assert.equal( line._options.segments, 5 )

	const resizedPositionBuffer = line.positionBuffer
	const resizedPositions = Array.from( resizedPositionBuffer.array )
	assert.equal( line.curveLength( 8 ).rebuild(), line )
	assert.equal( line.positionBuffer, resizedPositionBuffer )
	assert.notDeepEqual( Array.from( line.positionBuffer.array ), resizedPositions )
	line.dispose()
} )

test( 'reset restores deterministic seeded storage and dispose releases facade references', () => {
	const line = new MeshLineCompute( { curveCount: 2, pointsPerCurve: 3 } ).build()
	const seeded = snapshotStorage( line )
	const versions = Object.fromEntries( STORAGE_FIELDS.map( ( [name] ) => [name, line[name].version] ) )

	for ( const [name] of STORAGE_FIELDS ) line[name].array.fill( Number.NaN )
	assert.equal( line.reset(), line )
	assert.deepEqual( snapshotStorage( line ), seeded )
	for ( const [name] of STORAGE_FIELDS ) assert.equal( line[name].version, versions[name] + 1 )

	const parent = new Group()
	parent.add( line )
	let geometryDisposals = 0
	let materialDisposals = 0
	line.geometry.addEventListener( 'dispose', () => geometryDisposals++ )
	line.material.addEventListener( 'dispose', () => materialDisposals++ )
	line.dispose()

	assert.equal( line.parent, null )
	for ( const [name] of STORAGE_FIELDS ) assert.equal( line[name], null )
	assert.equal( line._computeNode, null )
	assert.equal( line._distanceComputeNode, null )
	assert.equal( line._distanceSampleNode, null )
	assert.equal( line._computeBuilt, false )
	assert.equal( geometryDisposals, 1 )
	assert.equal( materialDisposals, 1 )
	assert.equal( line.reset(), line )
} )

test( 'step fails open without WebGPU compute and dispatches through a CPU stub', () => {
	const line = new MeshLineCompute( { curveCount: 2, pointsPerCurve: 3 } )
	const warnings = []
	const originalWarn = console.warn
	console.warn = message => warnings.push( message )

	try {
		assert.equal( line.step( null ), false )
		assert.equal( line.step( {} ), false )
	} finally {
		console.warn = originalWarn
	}

	assert.equal( warnings.length, 1 )
	assert.match( warnings[0], /WebGPURenderer\.compute\(\) is required/ )
	assert.equal( line._built, true )
	assert.equal( line._time, 0 )

	const dispatched = []
	const renderer = { compute: node => dispatched.push( node ) }
	assert.equal( line.step( renderer, 10 ), true )
	assert.deepEqual( dispatched, [line._computeNode, line._distanceComputeNode] )
	assert.equal( line._uDelta.value, 1 / 15 )
	assert.equal( line._time, 1 / 15 )
	line.dispose()
} )
