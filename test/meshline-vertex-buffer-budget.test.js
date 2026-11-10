import assert from 'node:assert/strict'
import test from 'node:test'

import { BufferAttribute, Texture } from 'three/webgpu'

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

test( 'a setter whose rebuild exceeds the budget leaves the built line intact', t => {
	// Custom buffers fill the line's budget, so the buffers these setters add
	// exceed it. The rejected rebuild used to keep the extra buffers and the
	// option, and left the line unbuilt. Setters that rebuild only the geometry,
	// which takes a pending needsUV() too, skipped the check.
	t.mock.method( console, 'warn', () => {} )
	const texture = new Texture()
	const needsUV = line => line.needsUV( true )
	for ( const [name, update, pending, lineOptions] of [
		['gradientColor', line => line.gradientColor( 0xff0000 )],
		['map', line => line.map( texture )],
		['alphaMap', line => line.alphaMap( texture )],
		['dash', line => line.dash( { count: 4 } )],
		['widthCallback toggle', line => line.widthCallback( () => 2 )],
		['vertexColors toggle', line => line.vertexColors( [0, 1, 0] )],
		// opacity() adds no buffer, but its rebuild applies a pending needsUV().
		['opacity', line => line.opacity( 0.5 ), needsUV],
		['widthCallback swap', line => line.widthCallback( () => 2 ), needsUV, { widthCallback: () => 1 }],
		['vertexColors swap', line => line.vertexColors( [0, 1, 0] ), needsUV, { vertexColors: [1, 0, 0] }],
		// Bevel joins would drop the custom buffers with the old topology.
		['join', line => line.join( { fold: false } ), needsUV, { join: 'miter' }],
		['surface lineWidth', line => line.lineWidth( 0.5 ), needsUV, { surface: true }],
		['surface join', line => line.join( 'round' ), needsUV, { surface: true, join: 'miter' }],
		['surface cap', line => line.cap( 'round' ), needsUV, { surface: true }],
		['surface map', line => line.map( texture ), null, { surface: true }],
		['surface alphaMap', line => line.alphaMap( texture ), null, { surface: true }],
		['surface normalMap', line => line.surface( { normalMap: texture } ), null, { surface: true }],
	] ) {
		const line = new MeshLine( lineOptions ).lines( points ).build()
		for ( let i = 0; line.getVertexBufferUsage().remaining > 0; i++ ) line.addVertexAttribute( `custom${i}` )
		pending?.( line )
		const names = Object.keys( line.geometry.attributes ).sort()
		const options = { ...line._options }
		const { map, alphaMap } = line.material
		assert.throws( () => update( line ), /portable vertex-buffer budget exceeded/, name )
		assert.deepEqual( Object.keys( line.geometry.attributes ).sort(), names, name )
		assert.deepEqual( line._options, options, name )
		assert.equal( line.material.map, map, name )
		assert.equal( line.material.alphaMap, alphaMap, name )
		assert.equal( line._built, true, name )
		line.dispose()
	}
	texture.dispose()
} )

test( 'a rejection that clears the geometry keeps its custom attributes', () => {
	// A width callback that throws part way clears the geometry, custom
	// attributes included, sized per vertex or not. The restored line used to
	// draw without them.
	const reject = ( progress, pointIndex ) => {
		if ( pointIndex === 1 ) throw new Error( 'rejected' )
		return 1
	}
	for ( const options of [{}, { widthCallback: () => 1 }] ) {
		const line = new MeshLine( options ).lines( points ).instances( 2 ).build()
		const custom = line.addVertexAttribute( 'custom', 2 )
		const packed = line.addInstanceAttributes( { offset: 3, scale: 1 } )
		const perPoint = new BufferAttribute( new Float32Array( points.length / 3 ), 1 )
		line.geometry.setAttribute( 'perPoint', perPoint )
		assert.throws( () => line.widthCallback( reject ), /rejected/ )
		assert.equal( line.geometry.getAttribute( 'custom' ), custom )
		assert.equal( line.geometry.getAttribute( 'perPoint' ), perPoint )
		assert.equal( line.geometry.getAttribute( 'offset' ), packed.offset )
		assert.equal( line.geometry.getAttribute( 'scale' ), packed.scale )
		line.dispose()
	}
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
