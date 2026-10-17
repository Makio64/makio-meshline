import assert from 'node:assert/strict'
import test from 'node:test'

import { Fn, vec3 } from 'three/tsl'
import { Box3 } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLineGeometry from '../src/MeshLineGeometry.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

const createWave = ( pointCount, amplitude = 1, offset = 0 ) => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) {
		const t = i / ( pointCount - 1 )
		points[i * 3] = t * 20 + offset
		points[i * 3 + 1] = Math.sin( t * Math.PI * 4 ) * amplitude
		points[i * 3 + 2] = Math.cos( t * Math.PI * 3 ) * amplitude * 0.5
	}
	return points
}

const boxToArray = box => [...box.min.toArray(), ...box.max.toArray()]

const expectedBoxes = ( lines, options ) => {
	const reference = new MeshLineGeometry( { lines, ...options } )
	const boxes = reference.boundingBoxes.map( boxToArray )
	reference.dispose()
	return boxes
}

const countSetFromArray = callback => {
	const original = Box3.prototype.setFromArray
	let calls = 0
	Box3.prototype.setFromArray = function ( ...args ) {
		calls++
		return original.apply( this, args )
	}
	try {
		callback()
	} finally {
		Box3.prototype.setFromArray = original
	}
	return calls
}

// Only the 'exact' fragment clip reads these. Each is a `toVar()`, which three
// emits whether or not anything reads it.
const exactFoldValues = ['miterFactor', 'clipFactor', 'foldJoint'].map( name => new RegExp( `\\b${name}\\b` ) )

test( 'padding-only bound refreshes reuse cached line extents', () => {
	const lines = [createWave( 64 ), createWave( 32, 2, 30 )]
	const geometry = new MeshLineGeometry( { lines, lineWidth: 0.5 } )

	const calls = countSetFromArray( () => {
		geometry.options.lineWidth = 2
		geometry.computeBoundingBoxes()
		geometry.options.miterLimit = 2
		geometry.computeBoundingBoxes()
		geometry.options.sizeAttenuation = false
		geometry.computeBoundingBoxes()
	} )

	assert.equal( calls, 0 )
	assert.deepEqual(
		geometry.boundingBoxes.map( boxToArray ),
		expectedBoxes( lines, { lineWidth: 2, miterLimit: 2, sizeAttenuation: false } )
	)
} )

test( 'cached line extents refresh after positions change without bounds', () => {
	const geometry = new MeshLineGeometry( { lines: createWave( 48 ), lineWidth: 0.5, needsUV: true } )

	const moved = createWave( 48, 3, 5 )
	geometry.setPositions( moved, false )
	geometry.options.lineWidth = 0.75
	geometry.computeBoundingBoxes()
	assert.deepEqual( geometry.boundingBoxes.map( boxToArray ), expectedBoxes( moved, { lineWidth: 0.75 } ) )

	const patched = moved.slice()
	patched.set( [100, -40, 12], 9 )
	geometry.setPositionRange( new Float32Array( [100, -40, 12] ), 3 )
	geometry.computeBoundingBoxes()
	assert.deepEqual( geometry.boundingBoxes.map( boxToArray ), expectedBoxes( patched, { lineWidth: 0.75 } ) )
} )

test( 'MeshLine.lineWidth() keeps billboard bounds exact without rescanning points', () => {
	const points = createWave( 128 )
	const line = new MeshLine( { lines: points, lineWidth: 0.4 } ).build()

	const calls = countSetFromArray( () => line.lineWidth( 1.6 ) )

	assert.equal( calls, 0 )
	assert.deepEqual( line.geometry.boundingBoxes.map( boxToArray ), expectedBoxes( points, { lineWidth: 1.6 } ) )
	line.dispose()
} )

test( 'billboard vertex graph projects each point once and reuses projected directions', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const options of [{}, { positionFn: position => position }] ) {
			const line = new MeshLine( {
				lines: new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] ),
				...options,
			} ).build()
			const builder = buildShaderGraph( renderer, line )
			const shader = builder.vertexShader

			// No per-vertex projection * modelView matrix product: every centerline
			// sample goes to view space once, and that view position is projected.
			assert.equal( ( shader.match( /modelViewMatrix \* vec4/g ) || [] ).length, 3 )
			assert.equal( ( shader.match( /cameraProjectionMatrix \* view(Position|Previous|Next)\b/g ) || [] ).length, 3 )
			assert.doesNotMatch( shader, /cameraProjectionMatrix \* modelViewMatrix\s*\)/ )
			// Two raw projected deltas, the miter sum and the blended perpendicular,
			// plus the fold's half-turn sine. The 3D turn takes one inverse square
			// root per view-space body, emitted once, and no acos().
			assert.equal( ( shader.match( /\blength\(/g ) || [] ).length, 5 )
			assert.equal( ( shader.match( /\binverse[Ss]qrt\(/g ) || [] ).length, 2 )
			assert.doesNotMatch( shader, /\bacos\(/ )
			for ( const value of exactFoldValues ) assert.doesNotMatch( shader, value )
			// Default folds are resolved in the vertex stage: a discard anywhere in
			// the fragment stage would cost tile-based GPUs their hidden-surface
			// removal on every line.
			assert.doesNotMatch( builder.fragmentShader, /\bdiscard\b/ )
			line.dispose()
		}
	}
} )

test( 'exact folds clip in the fragment stage while two-point GPU lines keep the plain shader', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		const build = options => {
			const line = new MeshLine( options ).build()
			const builder = buildShaderGraph( renderer, line )
			line.dispose()
			return builder
		}
		const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] )

		const exact = build( { lines: points, join: { type: 'miter', fold: 'exact' } } )
		assert.match( exact.fragmentShader, /\bdiscard\b/ )
		assert.match( exact.vertexShader, /vFoldFrame/ )
		// What the default shader leaves out lives here, with the 3D turn still
		// emitted once.
		for ( const value of exactFoldValues ) assert.match( exact.vertexShader, value )
		assert.equal( ( exact.vertexShader.match( /\binverse[Ss]qrt\(/g ) || [] ).length, 2 )

		const round = build( { lines: points, join: { type: 'round' } } )
		assert.match( round.fragmentShader, /\bdiscard\b/ )

		// A one-segment GPU line has no interior joint to fold.
		const laser = build( { segments: 1, gpuPositionNode: Fn( ( [progress] ) => vec3( progress, 0, 0 ) ) } )
		assert.doesNotMatch( laser.vertexShader, /vFoldFrame|foldJointRow|miterFactor/ )
	}
} )
