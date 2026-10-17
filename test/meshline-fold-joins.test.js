import assert from 'node:assert/strict'
import test from 'node:test'

import { Fn, vec3 } from 'three/tsl'
import { PerspectiveCamera, REVISION, Scene } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLinePicker from '../src/MeshLinePicker.js'
import MeshLinePickerHelper from '../src/MeshLinePickerHelper.js'
import { buildShaderGraph as compile, createRenderer } from './helpers/shaderBuilder.js'

const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] )

const backends = [false, true].map( forceWebGL => createRenderer( forceWebGL ) )

test( 'join() on a built line switches the fold path without resetting the material', () => {
	for ( const renderer of backends ) {
		const line = new MeshLine( { lines: points } ).build()
		line.resize( 800, 600 )
		const material = line.material
		const resolution = material.resolution
		material.depthTest = false
		const version = material.version

		line.join( { type: 'round' } )
		assert.equal( line.material, material )
		assert.equal( material.resolution, resolution )
		assert.deepEqual( material.resolution.value.toArray(), [800, 600] )
		assert.equal( material.depthTest, false )
		assert.ok( material.version > version, 'a new join type recompiles the shader' )
		assert.match( compile( renderer, line ).fragmentShader, /\bdiscard\b/ )

		line.join( { type: 'miter', limit: 6 } )
		assert.equal( material.miterLimit, 6 )
		assert.doesNotMatch( compile( renderer, line ).fragmentShader, /\bdiscard\b/ )
		line.dispose()
	}
} )

test( 'antialias() on a built line keeps its resolution', () => {
	const line = new MeshLine( { lines: points } ).build()
	line.resize( 640, 360 )
	line.antialias( true )
	assert.deepEqual( line.material.resolution.value.toArray(), [640, 360] )
	line.dispose()
} )

test( 'exact folds clip in the opacity stage, never through maskNode', () => {
	for ( const renderer of backends ) {
		const line = new MeshLine( { lines: points, join: { fold: 'exact' }, shadow: true } ).build()
		const opaque = compile( renderer, line )
		// The shadow pass falls back to maskNode and has none of the fold varyings.
		assert.equal( line.material.maskNode, null )
		assert.equal( line.material.maskShadowNode, null )
		// Opaque: keep a pixel whose centre is inside the arc.
		assert.match( opaque.fragmentShader, /foldCoverageValue\s*<\s*0\.5/ )
		line.dispose()

		const translucent = new MeshLine( { lines: points, join: { fold: 'exact' }, opacity: 0.5 } ).build()
		// Blended: soften the arc by its coverage and drop only what it misses.
		assert.match( compile( renderer, translucent ).fragmentShader, /foldCoverageValue\s*<=\s*0\.0/ )
		translucent.dispose()
	}
} )

test( 'wireframe is resolved when the shader builds, so toggling it drops and restores the clip', () => {
	for ( const renderer of backends ) {
		const line = new MeshLine( { lines: points, join: { type: 'round' } } ).build()
		line.wireframe( true )
		const wire = compile( renderer, line )
		assert.doesNotMatch( wire.fragmentShader, /\bdiscard\b/ )
		assert.doesNotMatch( wire.vertexShader, /vFoldFrame|foldJointRow/ )
		line.wireframe( false )
		assert.match( compile( renderer, line ).fragmentShader, /\bdiscard\b/ )
		line.dispose()
	}
} )

test( 'picker and helper proxies keep the exact clip and follow join changes', () => {
	for ( const renderer of backends ) {
		const scene = new Scene()
		const line = new MeshLine( { lines: points, join: { type: 'round' } } ).build()
		scene.add( line )
		const picker = new MeshLinePicker( renderer, scene, new PerspectiveCamera() )
		picker.add( line )
		const entry = [...picker._registry.values()][0]
		assert.match( compile( renderer, entry.proxy ).fragmentShader, /foldCoverageValue\s*<\s*0\.5/ )

		const helper = new MeshLinePickerHelper( picker )
		assert.match( compile( renderer, helper.children[0] ).fragmentShader, /foldCoverageValue\s*<=\s*0\.0/ )

		line.join( { type: 'miter' } )
		picker._syncProxies()
		helper.update()
		assert.doesNotMatch( compile( renderer, entry.proxy ).fragmentShader, /\bdiscard\b/ )
		// r180 discards alpha <= 0 in every blended node material without an
		// alphaTest (removed in r181, mrdoob/three.js#31927), so the translucent
		// helper keeps that discard there; the fold clip goes on every release.
		const helperFragment = compile( renderer, helper.children[0] ).fragmentShader
		assert.doesNotMatch( helperFragment, /foldCoverageValue/ )
		if ( Number.parseInt( REVISION ) >= 181 ) assert.doesNotMatch( helperFragment, /\bdiscard\b/ )
		helper.dispose?.()
		picker.dispose()
		line.dispose()
	}
} )

test( 'side-dependent widths classify and clip folds with the wider side', () => {
	const line = new MeshLine( {
		lines: points,
		join: { fold: 'exact' },
		widthFn: ( width, progress, side ) => width.mul( side.mul( 0.25 ).add( 1 ) ),
	} ).build()
	const vertex = compile( backends[0], line ).vertexShader
	const width = vertex.split( '\n' ).find( row => /foldWidth\s*=/.test( row ) )
	assert.ok( width, 'fold width is emitted' )
	// The hook runs once per side; classification and clip take the larger width.
	assert.match( width, /max\(.*\b1\.0 \* 0\.25.*-1\.0 \* 0\.25/ )
	assert.match( vertex, /foldRadiusPx\s*=.*foldWidth/ )
	line.dispose()
} )

test( 'a one-segment GPU line never pays for folds', () => {
	for ( const renderer of backends ) {
		const laser = new MeshLine( { segments: 1, join: { type: 'round' }, gpuPositionNode: Fn( ( [progress] ) => vec3( progress, 0, 0 ) ) } ).build()
		const builder = compile( renderer, laser )
		assert.doesNotMatch( builder.vertexShader, /vFoldFrame|foldJointRow|miterFactor/ )
		assert.doesNotMatch( builder.fragmentShader, /\bdiscard\b/ )
		laser.dispose()
	}
} )

test( 'bounds cover fold overlap corners under a low miter limit', () => {
	const line = new MeshLine( { lines: points, lineWidth: 2, join: { limit: 1 } } ).build()
	assert.ok( Math.abs( line.geometry.getBoundingPadding() - Math.SQRT2 ) < 1e-9 )
	line.join( { limit: 1, fold: false } )
	assert.equal( line.geometry.getBoundingPadding(), 1 )
	line.dispose()
} )
