import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
	AdditiveBlending,
	StreamDrawUsage,
} from 'three/webgpu'
import { Fn, attribute, vec4 } from 'three/tsl'

import { MeshLine } from '../src/index.js'
import {
	BILLBOARD_VERTICES_PER_POINT,
	TRAIL_ATTRIBUTE_COMPONENTS,
	createTrailMeshLine,
	createTrailPositions,
	stepTrailLine,
	writeTrailAttributes,
} from '../docs/.vitepress/theme/trailBackgroundData.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

const NUM_LINES = 3
const NUM_POINTS = 30

const createState = () => {
	const lines = []
	const lineArrays = []
	for ( let lineIndex = 0; lineIndex < NUM_LINES; lineIndex++ ) {
		const angle = lineIndex / NUM_LINES * Math.PI * 2
		const offsetX = Math.cos( angle ) * 0.02
		const offsetY = Math.sin( angle ) * 0.02
		const positions = createTrailPositions( NUM_POINTS, offsetX, offsetY )
		lines.push( {
			positions,
			offsetX,
			offsetY,
			velocityX: 0,
			velocityY: 0,
			spring: 0.05,
			friction: 0.92,
			startColor: { r: 0.1 + lineIndex, g: 0.2, b: 0.3 },
			endColor: { r: 0.4, g: 0.5 + lineIndex, b: 0.6 },
		} )
		lineArrays.push( positions )
	}
	return { lines, lineArrays }
}

const buildTrail = lineArrays => createTrailMeshLine( {
	MeshLine,
	lineArrays,
	lerp: ( start, end, t ) => start + ( end - start ) * t,
	Fn,
	attribute,
	vec4,
	blending: AdditiveBlending,
} )

test( 'docs trail starts with stable V2 topology and streaming buffers', () => {
	const { lines, lineArrays } = createState()
	const { meshline, customAttributes } = buildTrail( lineArrays )
	const expectedVertices = NUM_LINES * NUM_POINTS * BILLBOARD_VERTICES_PER_POINT
	const position = meshline.geometry.getAttribute( 'position' )

	assert.equal( position.count, expectedVertices )
	assert.equal( position.usage, StreamDrawUsage )
	assert.equal( meshline.geometry.getAttribute( 'previous' ).usage, StreamDrawUsage )
	assert.equal( meshline.geometry.getAttribute( 'next' ).usage, StreamDrawUsage )
	assert.equal( meshline.geometry.getAttribute( 'progress' ).usage, StreamDrawUsage )
	assert.equal( meshline.geometry.getAttribute( 'width' ).usage, StreamDrawUsage )
	assert.equal( customAttributes.lineColor.count, expectedVertices )
	assert.equal( customAttributes.lineEndColor.count, expectedVertices )
	assert.equal( customAttributes.lineColor.data.usage, StreamDrawUsage )

	const initialAttributes = {
		position,
		lineColor: customAttributes.lineColor,
		lineEndColor: customAttributes.lineEndColor,
	}
	for ( let frame = 0; frame < 120; frame++ ) {
		for ( const line of lines ) {
			stepTrailLine( line, line.offsetX, line.offsetY, NUM_POINTS )
		}
		meshline.setPositions( lineArrays )
	}

	assert.equal( meshline.geometry.getAttribute( 'position' ), initialAttributes.position )
	assert.equal( meshline.geometry.getAttribute( 'lineColor' ), initialAttributes.lineColor )
	assert.equal( meshline.geometry.getAttribute( 'lineEndColor' ), initialAttributes.lineEndColor )
	assert.equal( meshline.geometry.getAttribute( 'position' ).count, expectedVertices )
	meshline.dispose()
} )

test( 'docs trail duplicates packed colors across all four physical point vertices', () => {
	const { lines } = createState()
	const totalVertices = NUM_LINES * NUM_POINTS * BILLBOARD_VERTICES_PER_POINT
	const buffer = new Float32Array( totalVertices * TRAIL_ATTRIBUTE_COMPONENTS )

	assert.equal( writeTrailAttributes( buffer, lines, NUM_POINTS ), totalVertices )
	for ( let lineIndex = 0; lineIndex < NUM_LINES; lineIndex++ ) {
		const line = lines[lineIndex]
		const firstVertex = lineIndex * NUM_POINTS * BILLBOARD_VERTICES_PER_POINT
		const lastVertex = firstVertex + NUM_POINTS * BILLBOARD_VERTICES_PER_POINT - 1
		for ( const vertexIndex of [firstVertex, firstVertex + 1, firstVertex + 3, lastVertex] ) {
			const offset = vertexIndex * TRAIL_ATTRIBUTE_COMPONENTS
			assert.deepEqual( Array.from( buffer.subarray( offset, offset + 6 ) ), [
				Math.fround( line.startColor.r ),
				Math.fround( line.startColor.g ),
				Math.fround( line.startColor.b ),
				Math.fround( line.endColor.r ),
				Math.fround( line.endColor.g ),
				Math.fround( line.endColor.b ),
			] )
		}
	}
} )

test( 'docs trail packed color graph compiles after a live update on both backends', () => {
	for ( const forceWebGL of [false, true] ) {
		const { lines, lineArrays } = createState()
		const { meshline, customAttributeBuffer } = buildTrail( lineArrays )
		writeTrailAttributes( customAttributeBuffer.array, lines, NUM_POINTS )
		customAttributeBuffer.needsUpdate = true
		for ( const line of lines ) stepTrailLine( line, line.offsetX + 0.5, line.offsetY, NUM_POINTS )
		meshline.setPositions( lineArrays )

		const renderer = createRenderer( forceWebGL )
		const builder = buildShaderGraph( renderer, meshline )
		assert.match( builder.vertexShader, /lineColor/ )
		assert.match( builder.vertexShader, /lineEndColor/ )
		assert.match( builder.fragmentShader, /\S/ )
		meshline.dispose()
	}
} )

test( 'docs trail keeps Three lazy and suspends animation for visibility preferences', async () => {
	const source = await readFile(
		new URL( '../docs/.vitepress/theme/TrailBackground.vue', import.meta.url ),
		'utf8',
	)

	assert.doesNotMatch( source, /^import .*['"]three\/(?:webgpu|tsl)['"]/m )
	assert.doesNotMatch( source, /new THREE\.Vector3|\.clone\(\)|\.set\(\s*\[/ )
	assert.match( source, /import\( 'three\/webgpu' \)/ )
	assert.match( source, /import\( 'three\/tsl' \)/ )
	assert.match( source, /prefers-reduced-motion: reduce/ )
	assert.match( source, /visibilitychange/ )
} )
