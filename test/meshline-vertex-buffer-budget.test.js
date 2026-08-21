import assert from 'node:assert/strict'
import test from 'node:test'

import MeshLine from '../src/MeshLine.js'

const points = new Float32Array( [
	0, 0, 0,
	1, 0, 0,
] )

test( 'reports distinct portable vertex buffers and explicit application reserves', () => {
	const plain = new MeshLine().lines( points ).build()
	const plainUsage = plain.getVertexBufferUsage()

	assert.equal( plainUsage.attributeBuffers, 4 )
	assert.equal( plainUsage.reservedBuffers, 0 )
	assert.equal( plainUsage.usedBuffers, 4 )
	assert.equal( plainUsage.remaining, 4 )
	assert.equal( plainUsage.exceeded, false )

	const instanced = new MeshLine().lines( points ).instances( 2 ).build()
	const instancedUsage = instanced.getVertexBufferUsage( { reservedBuffers: 1 } )
	assert.equal( instancedUsage.attributeBuffers, 4 )
	assert.equal( instancedUsage.reservedBuffers, 1 )
	assert.equal( instancedUsage.usedBuffers, 5 )

	plain.dispose()
	instanced.dispose()
} )

test( 'rejects a separate custom buffer before exceeding the portable limit', () => {
	const line = new MeshLine()
		.lines( points )
		.instances( 4 )
		.gradientColor( 0xff0000 )
		.widthCallback( () => 1 )
		.positionFn( ( position ) => position )
		.build()

	const before = line.getVertexBufferUsage( { reservedBuffers: 1 } )
	assert.equal( before.usedBuffers, 8 )
	line.addInstanceAttribute( 'firstCustom', 1 )
	assert.throws(
		() => line.addInstanceAttribute( 'secondCustom', 4 ),
		/portable vertex-buffer budget exceeded \(9\/8/i,
	)
	assert.equal( line.geometry.getAttribute( 'secondCustom' ), undefined )
	line.dispose()
} )

test( 'packs multiple instance attributes into one buffer and writes by component layout', () => {
	const line = new MeshLine().lines( points ).instances( 2 ).build()
	const attributes = line.addInstanceAttributes( {
		instanceOffset: 3,
		instanceScale: 1,
	} )

	assert.equal( attributes.instanceOffset.data, attributes.instanceScale.data )
	assert.equal( attributes.instanceOffset.offset, 0 )
	assert.equal( attributes.instanceScale.offset, 3 )
	assert.equal( attributes.instanceOffset.data.stride, 4 )

	line.setInstanceValues( 'instanceOffset', new Float32Array( [1, 2, 3, 4, 5, 6] ) )
	line.setInstanceValues( 'instanceScale', new Float32Array( [7, 8] ) )
	assert.deepEqual( Array.from( attributes.instanceOffset.array ), [1, 2, 3, 7, 4, 5, 6, 8] )

	line._onBeforeRender()
	line.setInstanceValue( 'instanceScale', 1, 9 )
	assert.deepEqual( Array.from( attributes.instanceOffset.array ), [1, 2, 3, 7, 4, 5, 6, 9] )
	assert.equal( attributes.instanceOffset.data.version, 1 )
	assert.deepEqual( attributes.instanceOffset.data.updateRanges, [{ start: 7, count: 1 }] )

	const usage = line.getVertexBufferUsage()
	const packed = usage.buffers.find( ( group ) => group.attributes.includes( 'instanceOffset' ) )
	assert.deepEqual( packed.attributes, ['instanceOffset', 'instanceScale'] )
	assert.equal( packed.instanced, true )
	assert.equal( packed.interleaved, true )
	line.dispose()
} )

test( 'packs vertex attributes and preserves packed instance data across topology changes', () => {
	const line = new MeshLine().lines( points ).instances( 2 ).build()
	const vertex = line.addVertexAttributes( { heat: 1, flow: 2 } )
	const instance = line.addInstanceAttributes( { instanceOffset: 3, instanceScale: 1 } )

	line.setVertexValues( 'heat', new Float32Array( [1, 2] ), 1 )
	line.setVertexValues( 'flow', new Float32Array( [3, 4, 5, 6] ), 1 )
	assert.deepEqual( Array.from( vertex.heat.array.slice( 3, 9 ) ), [1, 3, 4, 2, 5, 6] )

	line.setInstanceValues( 'instanceScale', new Float32Array( [0.5, 1] ) )
	line.setPositions( new Float32Array( [
		0, 0, 0,
		1, 0, 0,
		2, 0, 0,
	] ) )

	assert.equal( line.geometry.getAttribute( 'heat' ), undefined )
	assert.equal( line.geometry.getAttribute( 'flow' ), undefined )
	assert.equal( line.geometry.getAttribute( 'instanceOffset' ), instance.instanceOffset )
	assert.equal( line.geometry.getAttribute( 'instanceScale' ), instance.instanceScale )
	assert.deepEqual( Array.from( instance.instanceScale.array ), [0, 0, 0, 0.5, 0, 0, 0, 1] )
	line.dispose()
} )

test( 'validates packed layouts, writes complete elements, and supports explicit adapter reports', () => {
	const line = new MeshLine().lines( points ).build()

	assert.throws( () => line.addVertexAttributes( {} ), /at least one attribute/i )
	assert.throws( () => line.addVertexAttributes( { invalid: 5 } ), /integer from 1 to 4/i )
	assert.throws( () => line.addVertexAttribute( 'invalid', 0 ), /integer from 1 to 4/i )

	line.addVertexAttributes( { flow: 2 } )
	assert.throws(
		() => line.setVertexValues( 'flow', new Float32Array( [1, 2, 3] ) ),
		/complete 2-component elements/i,
	)
	assert.throws(
		() => line.validateVertexBufferBudget( { limit: 4 } ),
		/portable vertex-buffer budget exceeded/i,
	)
	assert.equal( line.getVertexBufferUsage( { limit: 16, reservedBuffers: 2 } ).remaining, 9 )
	line.dispose()
} )
