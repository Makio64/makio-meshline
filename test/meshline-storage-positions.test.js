import assert from 'node:assert/strict'
import test from 'node:test'

import { uniform } from 'three/tsl'
import { BufferAttribute, StorageBufferAttribute } from 'three/webgpu'

import { MeshLine, storagePositions } from '../src/index.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

test( 'storagePositions rejects buffers it cannot sample as per-instance runs', () => {
	const buffer = new StorageBufferAttribute( 12, 3 )
	assert.throws( () => storagePositions( new BufferAttribute( new Float32Array( 36 ), 3 ), { pointsPerLine: 4 } ), /StorageBufferAttribute/ )
	assert.throws( () => storagePositions( buffer, {} ), /pointsPerLine/ )
	assert.throws( () => storagePositions( buffer, { pointsPerLine: 1 } ), /pointsPerLine/ )
	assert.throws( () => storagePositions( buffer, { pointsPerLine: 2.5 } ), /pointsPerLine/ )
	assert.throws( () => storagePositions( buffer, { pointsPerLine: 5 } ), /multiple of pointsPerLine/ )
	assert.throws( () => storagePositions( new StorageBufferAttribute( 12, 2 ), { pointsPerLine: 4 } ), /vec3 or vec4/ )
	assert.equal( typeof storagePositions( buffer, { pointsPerLine: 4 } ), 'function' )
	assert.equal( typeof storagePositions( new StorageBufferAttribute( 12, 4 ), { pointsPerLine: 6 } ), 'function' )
} )

test( 'storagePositions drives instanced lines in WGSL, with and without a ring-buffer head', () => {
	const renderer = createRenderer()
	for ( const head of [null, uniform( 3, 'uint' )] ) {
		const lines = 4
		const pointsPerLine = 8
		const buffer = new StorageBufferAttribute( lines * pointsPerLine, 3 )
		const line = new MeshLine()
			.instances( lines )
			.segments( pointsPerLine - 1 )
			.gpuPositionNode( storagePositions( buffer, { pointsPerLine, head } ) )
			.build()

		const graph = buildShaderGraph( renderer, line )
		assert.match( graph.vertexShader, /@vertex/ )
		assert.match( graph.vertexShader, /var<storage, read>/, 'the render pass only needs a read-only binding' )
		if ( head ) assert.match( graph.vertexShader, /%/, 'ring-buffer sampling wraps around the run' )
		line.dispose()
	}
} )

test( 'storagePositions supports GPU morphing between from and to storage buffers and closed loop wrapping', () => {
	const renderer = createRenderer()
	const lines = 4
	const pointsPerLine = 9
	const fromBuffer = new StorageBufferAttribute( lines * pointsPerLine, 4 )
	const toBuffer = new StorageBufferAttribute( lines * pointsPerLine, 4 )
	const morph = uniform( 0.5 )
	const closedFlag = uniform( 1 )

	assert.throws(
		() => storagePositions( fromBuffer, { pointsPerLine, toBuffer } ),
		/morph is required/
	)
	assert.throws(
		() => storagePositions( fromBuffer, { pointsPerLine, toBuffer: new StorageBufferAttribute( 18, 4 ), morph } ),
		/must match buffer count and itemSize/
	)

	const line = new MeshLine()
		.instances( lines )
		.segments( pointsPerLine - 1 )
		.gpuPositionNode( storagePositions( fromBuffer, {
			pointsPerLine,
			toBuffer,
			morph,
			closed: closedFlag,
		} ) )
		.build()

	const graph = buildShaderGraph( renderer, line )
	assert.match( graph.vertexShader, /@vertex/ )
	assert.equal( ( graph.vertexShader.match( /var<storage, read>/g ) || [] ).length, 2, 'binds both from and to storage buffers' )
	line.dispose()
} )
