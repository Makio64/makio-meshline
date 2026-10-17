import assert from 'node:assert/strict'
import test from 'node:test'

import { color, densityFogFactor, float, fog, Fn, instanceIndex, rangeFogFactor, uniform, vec3, vec4 } from 'three/tsl'
import { Mesh, NodeMaterial } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

// The fog nodes three builds for `scene.fog`: a `Fog` becomes a range factor
// and a `FogExp2` a density factor, both handed to every render object's builder.
const rangeFog = () => fog( uniform( color( 0x808080 ) ), rangeFogFactor( uniform( 1 ), uniform( 10 ) ) )
const densityFog = () => fog( uniform( color( 0x808080 ) ), densityFogFactor( uniform( 0.05 ) ) )

const buildShaders = ( renderer, object, fogNode ) => {
	const { vertexShader, fragmentShader } = buildShaderGraph( renderer, object, { fogNode } )
	return { vertexShader, fragmentShader }
}

// Lines whose geometry `position` attribute is only a template: instances of
// one template spread in depth by `positionFn`, and GPU-computed points.
const createPlacedLines = ( options = {} ) => [
	new MeshLine( options )
		.lines( new Float32Array( [0, -1, 0, 0, 0, 0, 0, 1, 0] ), false )
		.instances( 4 )
		.positionFn( Fn( ( [position] ) => position.add( vec3( 0, 0, float( instanceIndex ).mul( -10 ) ) ) ) )
		.build(),
	new MeshLine( options )
		.segments( 8 )
		.gpuPositionNode( Fn( ( [progress] ) => vec3( progress, 0, progress.mul( -40 ) ) ) )
		.build(),
]

test( 'scene fog fades positionFn and gpuPositionNode lines by their own view depth', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const createFog of [rangeFog, densityFog] ) {
			for ( const line of createPlacedLines() ) {
				const { vertexShader, fragmentShader } = buildShaders( renderer, line, createFog() )

				// The vertex stage hands fog the view depth of the placed point...
				assert.equal( ( vertexShader.match( /\bvViewZ = /g ) || [] ).length, 1 )
				assert.match( vertexShader, /= viewPosition\.z;/ )
				// ...and the fragment stage fades by it: not by the template's
				// `position` attribute (three r180-r182), and without rebuilding the
				// view position per fragment through an inverse projection (r183+).
				assert.match( fragmentShader, /\(\s*-\s*vViewZ\s*\)/ )
				assert.doesNotMatch( fragmentShader, /v_positionView|v_clipSpace|cameraProjectionMatrixInverse/ )
				assert.doesNotMatch( fragmentShader, /\bdiscard\b/ )
				line.dispose()
			}
		}
	}
} )

test( 'fog depth is only declared by builds that apply fog', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const line of createPlacedLines() ) {
			const unfogged = buildShaders( renderer, line, null )
			assert.doesNotMatch( unfogged.vertexShader + unfogged.fragmentShader, /vViewZ/ )

			// A line that opts out of the scene's fog compiles the unfogged shaders.
			line.material.fog = false
			assert.deepEqual( buildShaders( renderer, line, rangeFog() ), unfogged )
			line.dispose()
		}
	}
} )

test( 'shadow passes of fogged lines stay fog-free', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const line of createPlacedLines( { shadow: true } ) ) {
			assert.match( buildShaders( renderer, line, rangeFog() ).vertexShader, /\bvViewZ = / )

			// Casters render with three's ShadowMaterial: fog off, the line's
			// `castShadowPositionNode` as its position.
			const shadowMaterial = new NodeMaterial()
			shadowMaterial.fog = false
			shadowMaterial.colorNode = vec4( 0, 0, 0, 1 )
			shadowMaterial.positionNode = line.material.castShadowPositionNode
			const caster = new Mesh( line.geometry, shadowMaterial )
			const shadow = buildShaders( renderer, caster, rangeFog() )
			assert.doesNotMatch( shadow.vertexShader + shadow.fragmentShader, /vViewZ/ )
			assert.deepEqual( shadow, buildShaders( renderer, caster, null ) )
			shadowMaterial.dispose()
			line.dispose()
		}
	}
} )
