import assert from 'node:assert/strict'
import test from 'node:test'

import MeshLine from '../src/MeshLine.js'
import MeshLineCompute from '../src/MeshLineCompute.js'

// Three r186-r187 keep a replaced vertex or index buffer on the GPU until a JS
// GC collects its attribute. Rebuilds free the buffers they drop through the
// renderer that drew the line; this stub records those calls. Live GPUBuffer
// counts need a real WebGPU device.
const createRendererStub = () => {
	const released = []
	const renderer = {
		_attributes: {
			delete( attribute ) {
				released.push( attribute )
			},
		},
	}
	return { renderer, released }
}

const render = ( line, renderer ) => line.onBeforeRender( renderer, null, null, line.geometry, line.material, null )

const gpuAttributes = geometry => [...Object.values( geometry.attributes ), geometry.index].filter( Boolean )

const dropped = ( before, geometry ) => {
	const current = new Set( gpuAttributes( geometry ) )
	return before.filter( attribute => !current.has( attribute ) )
}

const assertReleasedOnce = ( released, expected, message ) => {
	assert.ok( expected.length > 0, `${message}: nothing was replaced` )
	for ( const attribute of expected ) {
		assert.equal( released.filter( entry => entry === attribute ).length, 1, `${message}: ${attribute.name || 'attribute'} released once` )
	}
}

const assertNoneReleased = ( released, attributes, message ) => {
	for ( const attribute of attributes ) assert.ok( !released.includes( attribute ), message )
}

const openPoints = ( count, phase = 0 ) => {
	const points = new Float32Array( count * 3 )
	for ( let i = 0; i < count; i++ ) {
		points[i * 3] = i * 0.25
		points[i * 3 + 1] = Math.sin( i * 0.7 + phase )
	}
	return points
}

test( 'billboard topology rebuilds release every replaced vertex and index buffer once', () => {
	const { renderer, released } = createRendererStub()
	const line = new MeshLine().lines( openPoints( 40 ) )
	render( line, renderer )

	const first = gpuAttributes( line.geometry )
	const firstIndex = line.geometry.index
	line.lines( openPoints( 64 ) )
	const firstDropped = dropped( first, line.geometry )
	assert.ok( firstDropped.includes( firstIndex ) )
	assertReleasedOnce( released, firstDropped, 'point count change' )
	assert.equal( released.length, firstDropped.length )
	assertNoneReleased( released, gpuAttributes( line.geometry ), 'live buffers stay allocated' )

	// Same topology updates in place and frees nothing.
	released.length = 0
	line.lines( openPoints( 64, 1 ) )
	assert.equal( released.length, 0 )

	// Closing the loop changes connectivity and appends a seam point.
	const open = gpuAttributes( line.geometry )
	line.lines( openPoints( 64 ), true )
	const closedDropped = dropped( open, line.geometry )
	assertReleasedOnce( released, closedDropped, 'closed toggle' )
	assert.equal( released.length, closedDropped.length )
	line.dispose()
} )

test( 'usage changes and dropped optional attributes release the buffers they replace', () => {
	const { renderer, released } = createRendererStub()
	const line = new MeshLine().lines( openPoints( 24 ) )
	render( line, renderer )

	const staticAttributes = Object.values( line.geometry._attrs )
	line.dynamic( true )
	assertReleasedOnce( released, staticAttributes, 'dynamic( true )' )
	assert.equal( released.length, staticAttributes.length )
	assertNoneReleased( released, gpuAttributes( line.geometry ), 'replacements stay allocated' )
	line.dispose()

	const optional = new MeshLine().lines( openPoints( 24 ) )
	const optionalStub = createRendererStub()
	render( optional, optionalStub.renderer )
	optional.geometry.buildLine( { needsUV: true } )
	const uv = optional.geometry.getAttribute( 'uv' )
	assert.ok( uv )
	assert.equal( optionalStub.released.length, 0 )
	optional.geometry.buildLine( { needsUV: false } )
	assert.deepEqual( optionalStub.released, [uv] )
	optional.dispose()
} )

test( 'topology rebuilds free plain custom vertex buffers but leave shared and instanced ones', () => {
	const { renderer, released } = createRendererStub()
	const line = new MeshLine().lines( openPoints( 16 ) )
	const plain = line.addVertexAttribute( 'weight', 1 )
	const packed = Object.values( line.addVertexAttributes( { tint: 3, phase: 1 } ) )
	render( line, renderer )

	line.lines( openPoints( 20 ) )
	assert.equal( line.geometry.getAttribute( 'weight' ), undefined )
	assert.equal( released.filter( attribute => attribute === plain ).length, 1 )
	// r186 keys an interleaved GPU buffer per attribute and r187 per buffer,
	// so a shared buffer cannot be freed portably; it waits for GC as before.
	assertNoneReleased( released, packed, 'interleaved buffers are left to three' )
	line.dispose()

	const instanced = new MeshLine().lines( openPoints( 16 ) ).instances( 4 )
	const offset = instanced.addInstanceAttribute( 'offset', 3 )
	const instancedStub = createRendererStub()
	render( instanced, instancedStub.renderer )
	instanced.lines( openPoints( 20 ) )
	assert.equal( instanced.geometry.getAttribute( 'offset' ), offset )
	assertNoneReleased( instancedStub.released, [offset], 'instance buffers survive topology changes' )
	instanced.dispose()
} )

test( 'surface topology rebuilds release every replaced vertex and index buffer once', () => {
	const { renderer, released } = createRendererStub()
	const line = new MeshLine().surface( { width: 0.5 } ).lines( openPoints( 30 ) )
	render( line, renderer )
	assert.equal( line.geometry.isMeshLineSurfaceGeometry, true )

	const first = gpuAttributes( line.geometry )
	const firstIndex = line.geometry.index
	line.lines( openPoints( 45 ) )
	const firstDropped = dropped( first, line.geometry )
	assert.ok( firstDropped.includes( firstIndex ) )
	assertReleasedOnce( released, firstDropped, 'surface point count change' )
	assert.equal( released.length, firstDropped.length )
	assertNoneReleased( released, gpuAttributes( line.geometry ), 'live surface buffers stay allocated' )

	released.length = 0
	line.lines( openPoints( 45, 1 ) )
	assert.equal( released.length, 0 )

	const sized = gpuAttributes( line.geometry )
	line.dynamic( true )
	const usageDropped = dropped( sized, line.geometry )
	assertReleasedOnce( released, usageDropped, 'surface dynamic( true )' )
	assert.equal( released.length, usageDropped.length )
	line.dispose()
} )

test( 'MeshLineCompute resizes release the geometry buffers they replace', () => {
	const { renderer, released } = createRendererStub()
	const line = new MeshLineCompute( { curveCount: 2, pointsPerCurve: 8 } )
	render( line, renderer )

	const first = gpuAttributes( line.geometry )
	line.configure( { curveCount: 3, pointsPerCurve: 12 } ).rebuild()
	const geometryDropped = dropped( first, line.geometry )
	assert.ok( geometryDropped.includes( first.at( -1 ) ), 'the old index is dropped' )
	assertReleasedOnce( released, geometryDropped, 'compute resize' )
	assertNoneReleased( released, gpuAttributes( line.geometry ), 'live compute geometry stays allocated' )

	// A resize without rebuild() builds lazily inside the next draw.
	const resized = gpuAttributes( line.geometry )
	line.curveCount( 5 ).pointsPerCurve( 20 )
	render( line, renderer )
	const lazyDropped = dropped( resized, line.geometry )
	assert.ok( lazyDropped.includes( resized.at( -1 ) ), 'the lazily replaced index is dropped' )
	assertReleasedOnce( released, lazyDropped, 'lazy compute resize' )
	line.dispose()
} )

test( 'rebuilds before the first render have no renderer to release through', () => {
	const line = new MeshLine().lines( openPoints( 12 ) )
	line.ensureBuilt()
	assert.doesNotThrow( () => line.lines( openPoints( 18 ) ) )

	const { renderer, released } = createRendererStub()
	render( line, renderer )
	const geometry = line.geometry
	line.dispose()
	// Three's own geometry dispose listener frees the live buffers; a later
	// rebuild of the disposed geometry must not reach the old renderer.
	geometry.buildLine( { lines: openPoints( 30 ) } )
	assert.equal( released.length, 0 )
} )
