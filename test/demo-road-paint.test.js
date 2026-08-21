import assert from 'node:assert/strict'
import test from 'node:test'

import { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'

import { createRoadPaintNode, createRoadPaintUniforms } from '../demo/src/utils/roadPaint.js'
import { planRoadPath } from '../demo/src/utils/roadPath.js'
import MeshLine from '../src/MeshLine.js'

const ROAD_WIDTH = 6
const SHOULDER = 0.7
const VERGE = 0.7
const RIBBON_WIDTH = ROAD_WIDTH + VERGE * 2

const targets = [
	{ name: 'WebGPU/WGSL', forceWebGL: false, fragmentEntryPoint: '@fragment' },
	{ name: 'WebGL2/GLSL', forceWebGL: true, fragmentEntryPoint: 'void main' },
]

const buildShaderGraph = ( renderer, object ) => {
	const builder = renderer.backend.createNodeBuilder( object, renderer )
	builder.scene = new Scene()
	builder.camera = new PerspectiveCamera()
	builder.material = object.material
	builder.context.material = object.material
	return builder.build()
}

const createRoad = () => {
	const controls = Array.from( { length: 6 }, ( _, index ) => {
		const progress = index / 5
		return { x: ( progress - 0.5 ) * 60, z: Math.sin( progress * Math.PI * 2 ) * 12 }
	} )
	const plan = planRoadPath( controls, {
		spacing: 0.45,
		minRadius: RIBBON_WIDTH * 0.75,
		foldRadius: RIBBON_WIDTH * 0.575,
		cornerClearance: RIBBON_WIDTH * 0.5,
	} )

	const count = plan.points.length / 2
	const positions = new Float32Array( count * 3 )
	for ( let index = 0; index < count; index++ ) {
		positions[index * 3] = plan.points[index * 2]
		positions[index * 3 + 2] = plan.points[index * 2 + 1]
	}

	const road = new MeshLine()
		.lines( positions )
		.lineWidth( RIBBON_WIDTH )
		.needsUV( true )
		.surface( {
			frame: 'fixed-up',
			up: [0, 1, 0],
			uvMode: 'distance',
			uvScale: 1,
			roughness: 0.86,
			metalness: 0,
		} )
		.join( { type: 'round', limit: 2, segments: 12, inner: 'clip' } )
		.cap( { type: 'butt' } )
		.dynamic( true )
		.build()

	road.material.colorNode = createRoadPaintNode( createRoadPaintUniforms( RIBBON_WIDTH, SHOULDER, VERGE ) )
	return road
}

test( 'the road surface exposes the uv attribute its paint reads', () => {
	const road = createRoad()
	const uv = road.geometry.getAttribute( 'uv' )

	assert.ok( uv, 'surface geometry is missing the uv attribute' )
	let minV = Infinity
	let maxV = -Infinity
	let maxU = 0
	for ( let index = 0; index < uv.count; index++ ) {
		minV = Math.min( minV, uv.getY( index ) )
		maxV = Math.max( maxV, uv.getY( index ) )
		maxU = Math.max( maxU, uv.getX( index ) )
	}

	assert.equal( minV, 0, 'the left road edge should sit at v = 0' )
	assert.equal( maxV, 1, 'the right road edge should sit at v = 1' )
	assert.ok( maxU > 60, `u should carry metres travelled, saw ${maxU}` )
	road.dispose()
} )

test( 'the uv-driven road paint compiles on both renderer backends', async t => {
	for ( const target of targets ) {
		await t.test( target.name, () => {
			const renderer = new WebGPURenderer( {
				canvas: { width: 1, height: 1 },
				forceWebGL: target.forceWebGL,
			} )
			const road = createRoad()
			const graph = buildShaderGraph( renderer, road )

			assert.ok( graph.fragmentShader.includes( target.fragmentEntryPoint ) )
			assert.ok( graph.vertexShader.length > 0 )
			assert.ok( /fwidth|dFdx|dpdx/i.test( graph.fragmentShader ), 'paint antialiasing did not reach the shader' )
			assert.ok( !/undefined|NaN/.test( graph.fragmentShader ), 'generated fragment shader contains undefined values' )

			road.dispose()
		} )
	}
} )
