import assert from 'node:assert/strict'
import test from 'node:test'

import { color, float, fog, Fn, instanceIndex, positionLocal, positionView, positionWorld, positionWorldDirection, rangeFogFactor, uniform, vec3, vec4, velocity } from 'three/tsl'
import { Mesh, NodeMaterial, Vector4 } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import { createRenderer, createShaderBuilder } from './helpers/shaderBuilder.js'

// Three r183+. Older peers have no height fog factor to test.
const { exponentialHeightFogFactor } = await import( 'three/tsl' )

const buildShaders = ( renderer, object, { fogNode = null, clipPlanes = null, hardwareClipping = false } = {} ) => {
	const builder = createShaderBuilder( renderer, object, { fogNode } )
	if ( clipPlanes ) {
		// What a render object's clipping context hands the builder; hardware clip
		// distances are a device feature, so it is stubbed either way.
		builder.clippingContext = { unionPlanes: clipPlanes, intersectionPlanes: [], unionClippingCount: clipPlanes.length }
		const isAvailable = builder.isAvailable.bind( builder )
		builder.isAvailable = name => name === 'clipDistance' ? hardwareClipping : isAvailable( name )
	}
	builder.build()
	return { vertexShader: builder.vertexShader, fragmentShader: builder.fragmentShader }
}

// Lines whose geometry `position` attribute is only a template: instances of
// one template spread in height and depth by `positionFn`, and GPU-computed
// points. Each reads `read( color )` from its fragment stage when given one.
const createPlacedLines = ( read = null ) => {
	const options = read ? { fragmentColorFn: Fn( ( [lineColor] ) => read( lineColor ) ) } : {}
	return [
		new MeshLine( options )
			.lines( new Float32Array( [0, -1, 0, 0, 0, 0, 0, 1, 0] ), false )
			.instances( 4 )
			.positionFn( Fn( ( [position] ) => position.add( vec3( 0, float( instanceIndex ).mul( 3 ), float( instanceIndex ).mul( -10 ) ) ) ) )
			.build(),
		new MeshLine( options )
			.segments( 8 )
			.gpuPositionNode( Fn( ( [progress] ) => vec3( progress, progress.mul( 2 ), progress.mul( -40 ) ) ) )
			.build(),
	]
}

// The last value the vertex stage gives `accessor` must be the placed centerline,
// and everything three derives from it must be computed after that.
const assertPlaced = ( vertexShader, accessor, readerPattern ) => {
	const assignments = [...vertexShader.matchAll( new RegExp( `\\b${ accessor } = ([^;]+);`, 'g' ) )]
	assert.ok( assignments.length > 0, `${ accessor } is never assigned` )
	const last = assignments[assignments.length - 1]
	assert.equal( last[1], 'linePosition' )
	assert.ok( vertexShader.slice( last.index ).search( readerPattern ) > 0, `${ readerPattern } is not derived from the placed ${ accessor }` )
	// The placed centerline is computed once, for the stroke and the accessor.
	assert.equal( ( vertexShader.match( /\blinePosition = /g ) || [] ).length, 1 )
}

test( 'fragment readers of positionWorld and positionLocal see the placed centerline', () => {
	const readers = {
		positionWorld: [lineColor => vec4( lineColor.rgb.mul( positionWorld.y ), lineColor.a ), /\bv_positionWorld = /],
		positionWorldDirection: [lineColor => vec4( positionWorldDirection, lineColor.a ), /\bv_positionWorldDirection = /],
		// A fragment read of positionLocal is the varying itself.
		positionLocal: [lineColor => vec4( lineColor.rgb.mul( positionLocal.z ), lineColor.a ), /\breturn varyings;|gl_Position = /],
	}
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const [name, [read, readerPattern]] of Object.entries( readers ) ) {
			for ( const line of createPlacedLines( read ) ) {
				const { vertexShader, fragmentShader } = buildShaders( renderer, line )
				assertPlaced( vertexShader, 'positionLocal', readerPattern )
				assert.doesNotMatch( vertexShader, /\bpositionPrevious\b/, name )
				assert.doesNotMatch( fragmentShader, /\bdiscard\b/, name )
				line.dispose()
			}
		}
	}
} )

test( 'height fog, hardware clip distances and motion vectors follow the placed centerline', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const line of createPlacedLines() ) {
			if ( exponentialHeightFogFactor ) {
				// The height term reads positionWorld; the depth still comes from the
				// line's own fog varying.
				const fogNode = fog( uniform( color( 0x808080 ) ), exponentialHeightFogFactor( uniform( 0.05 ), uniform( 2 ) ) )
				const { vertexShader, fragmentShader } = buildShaders( renderer, line, { fogNode } )
				assertPlaced( vertexShader, 'positionLocal', /\bv_positionWorld = / )
				assert.match( fragmentShader, /\bvViewZ\b/ )
			}

			// Clip distances are computed per vertex from the vertex-stage positionView.
			const clipped = buildShaders( renderer, line, { clipPlanes: [new Vector4( 0, 1, 0, 0 )], hardwareClipping: true } )
			assertPlaced( clipped.vertexShader, 'positionLocal', /\bv_positionView = / )
			assert.match( clipped.vertexShader, /clip_distances|gl_ClipDistance/ )

			// Motion vectors compare positionLocal with positionPrevious, so both
			// must be the same centerline.
			line.material.fragmentColorFn = Fn( ( [lineColor] ) => vec4( velocity, 0, lineColor.a ) )
			line.material.needsUpdate = true
			const moving = buildShaders( renderer, line )
			assertPlaced( moving.vertexShader, 'positionLocal', /\bpositionPrevious = / )
			assertPlaced( moving.vertexShader, 'positionPrevious', /\breturn varyings;|gl_Position = / )
			line.dispose()
		}
	}
} )

test( 'fragment positionView and clipping planes read the placed line on every three version', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const line of createPlacedLines( lineColor => vec4( lineColor.rgb.mul( positionView.z ), lineColor.a ) ) ) {
			for ( const options of [{}, { clipPlanes: [new Vector4( 0, 1, 0, 0 )] }] ) {
				const { vertexShader, fragmentShader } = buildShaders( renderer, line, options )
				if ( /cameraProjectionMatrixInverse/.test( fragmentShader ) ) {
					// r183+ rebuild it from the emitted clip position: already the
					// placed stroke, so nothing is published for it.
					assert.match( fragmentShader, /\bv_clipSpace\b/ )
					assert.doesNotMatch( vertexShader, /\bpositionLocal\b/ )
				} else {
					// r180-r182 interpolate a vertex-stage value derived from positionLocal.
					assertPlaced( vertexShader, 'positionLocal', /\bv_positionView = / )
				}
			}
			line.dispose()
		}
	}
} )

test( 'builds that read no template position accessor publish nothing', () => {
	const fogNode = () => fog( uniform( color( 0x808080 ) ), rangeFogFactor( uniform( 1 ), uniform( 10 ) ) )
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const line of createPlacedLines() ) {
			// Scene fog reads the line's own depth varying, not positionView.
			for ( const shaders of [buildShaders( renderer, line ), buildShaders( renderer, line, { fogNode: fogNode() } )] ) {
				assert.doesNotMatch( shaders.vertexShader + shaders.fragmentShader, /\bposition(Local|Previous)\b|v_positionWorld/ )
			}
			line.dispose()
		}

		// A GPU line keeps its geometry's template position attribute unfetched.
		const [, gpuLine] = createPlacedLines()
		assert.doesNotMatch( buildShaders( renderer, gpuLine ).vertexShader, /@location\( \d+ \) position\b|\bin vec3 position\b/ )
		gpuLine.dispose()

		// A CPU line's position attribute already is its centerline.
		const line = new MeshLine( { fragmentColorFn: Fn( ( [lineColor] ) => vec4( lineColor.rgb.mul( positionWorld.y ), lineColor.a ) ) } )
			.lines( new Float32Array( [0, -1, 0, 0, 0, 0, 0, 1, 0] ), false )
			.build()
		const { vertexShader } = buildShaders( renderer, line )
		assert.match( vertexShader, /\bpositionLocal = position;/ )
		assert.doesNotMatch( vertexShader, /\blinePosition\b/ )
		line.dispose()
	}
} )

test( 'shadow passes of placed lines keep their own position node', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		const read = lineColor => vec4( lineColor.rgb.mul( positionWorld.y ), lineColor.a )
		for ( const line of createPlacedLines( read ) ) {
			line.material.setShadow( true )
			assertPlaced( buildShaders( renderer, line ).vertexShader, 'positionLocal', /\bv_positionWorld = / )

			// Casters render with three's ShadowMaterial: the line's
			// `castShadowPositionNode` as its position, none of the line's stages.
			const shadowMaterial = new NodeMaterial()
			shadowMaterial.fog = false
			shadowMaterial.colorNode = vec4( 0, 0, 0, 1 )
			shadowMaterial.positionNode = line.material.castShadowPositionNode
			const shadow = buildShaders( renderer, new Mesh( line.geometry, shadowMaterial ) )
			assert.doesNotMatch( shadow.vertexShader, /\blinePosition\b/ )
			shadowMaterial.dispose()
			line.dispose()
		}
	}
} )
