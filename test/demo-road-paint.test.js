import assert from 'node:assert/strict'
import test from 'node:test'

import { createRoadPaintNode, createRoadPaintUniforms, DASH_PERIOD, pinRoadPaintToControls } from '../demo/src/utils/roadPaint.js'
import { planRoadPath } from '../demo/src/utils/roadPath.js'
import MeshLine from '../src/MeshLine.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

const ROAD_WIDTH = 6
const SHOULDER = 0.7
const VERGE = 0.7
const RIBBON_WIDTH = ROAD_WIDTH + VERGE * 2
const SPACING = 0.45
const MAX_BANK_ANGLE = Math.PI / 48

const targets = [
	{ name: 'WebGPU/WGSL', forceWebGL: false, fragmentEntryPoint: '@fragment' },
	{ name: 'WebGL2/GLSL', forceWebGL: true, fragmentEntryPoint: 'void main' },
]

const polylineLength = positions => {
	let length = 0
	for ( let offset = 3; offset < positions.length; offset += 3 ) {
		length += Math.hypot(
			positions[offset] - positions[offset - 3],
			positions[offset + 1] - positions[offset - 2],
			positions[offset + 2] - positions[offset - 1]
		)
	}
	return length
}

const createRoad = () => {
	const controls = Array.from( { length: 6 }, ( _, index ) => {
		const progress = index / 5
		return {
			x: ( progress - 0.5 ) * 60,
			y: Math.sin( progress * Math.PI * 2 ) * 7,
			z: Math.sin( progress * Math.PI * 2 ) * 12,
			bank: Math.sin( progress * Math.PI * 2 ) * 0.55,
		}
	} )
	const plan = planRoadPath( controls, {
		spacing: SPACING,
		maxAngle: Math.PI / 36,
		maxChordError: 0.015,
		maxBankAngle: MAX_BANK_ANGLE,
		dedupeEpsilon: 1e-5,
		minRadius: RIBBON_WIDTH * 0.75,
		foldRadius: RIBBON_WIDTH * 0.575,
		up: [0, 1, 0],
	} )
	const positions = Float32Array.from( plan.points )

	const road = new MeshLine()
		.lines( positions )
		.lineWidth( RIBBON_WIDTH )
		.needsUV( true )
		.surface( {
			frame: 'fixed-up',
			up: [0, 1, 0],
			bank: plan.bank,
			uvMode: 'distance',
			uvScale: 1,
			roughness: 0.86,
			metalness: 0,
		} )
		.join( { type: 'miter', limit: 2, segments: 12, inner: 'clip' } )
		.cap( { type: 'butt' } )
		.dynamic( true )
		.build()

	road.material.colorNode = createRoadPaintNode( createRoadPaintUniforms( RIBBON_WIDTH, SHOULDER, VERGE ) )
	return { plan, positions, road }
}

test( 'the banked 3D road exposes monotonic physical-distance UVs', () => {
	const { plan, positions, road } = createRoad()
	const uv = road.geometry.getAttribute( 'uv' )
	const pointCount = positions.length / 3

	assert.ok( uv, 'surface geometry is missing the uv attribute' )
	assert.equal( uv.count, pointCount * 2, 'smooth miter road should expose one UV pair per centreline sample' )
	assert.equal( plan.bank.length, pointCount, 'bank count does not match the road samples' )
	assert.ok( plan.stats.maxY - plan.stats.minY > 10, 'test road did not preserve its vertical extent' )
	assert.ok( plan.stats.maxBankStep <= MAX_BANK_ANGLE + 1e-6, 'bank refinement exceeded its angular budget' )

	let previousU = -Infinity
	for ( let row = 0; row < pointCount; row++ ) {
		const left = row * 2
		const right = left + 1
		const leftU = uv.getX( left )
		const rightU = uv.getX( right )
		assert.equal( leftU, rightU, `row ${row} gives its two road edges different distances` )
		assert.ok( leftU >= previousU, `distance UV goes backwards at row ${row}` )
		assert.equal( uv.getY( left ), 0, `row ${row} left edge is not v = 0` )
		assert.equal( uv.getY( right ), 1, `row ${row} right edge is not v = 1` )
		previousU = leftU
	}

	const length = polylineLength( positions )
	const finalU = uv.getX( uv.count - 1 )
	assert.ok( finalU > 80, `u should carry 3D metres travelled, saw ${finalU}` )
	assert.ok( Math.abs( finalU - length ) < 1e-4, `final u ${finalU} does not match 3D length ${length}` )
	assert.ok( Math.abs( road.geometry._lineRanges[0].totalLength - length ) < 1e-7, 'geometry length does not match its Float32 path' )
	assert.ok( Math.abs( plan.stats.length - length ) < 1e-4, 'planner length does not match the rendered 3D path' )
	road.dispose()
} )

test( 'pinned paint keeps its dash phase on every span an edit does not reshape', () => {
	const controls = () => Array.from( { length: 7 }, ( _, index ) => ( {
		x: index * 16,
		y: Math.sin( index * 0.8 ) * 2,
		z: Math.sin( index * 1.1 ) * 7,
		bank: 0,
	} ) )
	const options = {
		spacing: SPACING,
		maxAngle: Math.PI / 36,
		maxChordError: 0.015,
		maxBankAngle: MAX_BANK_ANGLE,
		minRadius: RIBBON_WIDTH * 0.75,
		foldRadius: RIBBON_WIDTH * 0.575,
	}
	const road = new MeshLine()
		.lines( new Float32Array( [0, 0, 0, 1, 0, 0] ) )
		.lineWidth( RIBBON_WIDTH )
		.needsUV( true )
		.surface( { frame: 'fixed-up', up: [0, 1, 0], bank: 0, uvMode: 'distance', uvScale: 1 } )
		.join( { type: 'miter', limit: 2, inner: 'clip' } )
		.cap( { type: 'butt' } )
		.dynamic( true )
		.build()
	const paint = authored => {
		const plan = planRoadPath( authored, options )
		road.setPositions( plan.points )
		const uv = road.geometry.getAttribute( 'uv' )
		const raw = Float32Array.from( uv.array )
		assert.ok( pinRoadPaintToControls( road.geometry, plan.points, plan.anchors ) )
		return { plan, raw, pinned: Float32Array.from( uv.array ) }
	}
	const phase = value => {
		const periods = value / DASH_PERIOD
		return Math.abs( periods - Math.round( periods ) ) * DASH_PERIOD
	}

	const before = paint( controls() )
	let previous = -Infinity
	for ( let row = 0; row < before.plan.points.length / 3; row++ ) {
		const u = before.pinned[row * 4]
		assert.ok( u >= previous, `pinned paint runs backwards at row ${row}` )
		assert.equal( before.pinned[row * 4 + 2], u, `row ${row} gives its edges different paint distances` )
		previous = u
	}
	for ( const anchor of before.plan.anchors ) {
		assert.ok( phase( before.pinned[anchor * 4] ) < 1e-3, `control row ${anchor} is off the dash phase` )
	}

	const edited = controls()
	edited[2].y += 5
	const after = paint( edited )
	const lastRow = row => row * 4
	const rawShift = after.raw[lastRow( after.plan.points.length / 3 - 1 )] - before.raw[lastRow( before.plan.points.length / 3 - 1 )]
	assert.ok( phase( rawShift ) > 0.05, 'the edit should shift raw distance UVs by a fraction of a dash' )
	for ( let span = 4; span < before.plan.anchors.length - 1; span++ ) {
		const rows = before.plan.anchors[span + 1] - before.plan.anchors[span]
		assert.equal( after.plan.anchors[span + 1] - after.plan.anchors[span], rows, `span ${span} was retessellated` )
		for ( let row = 0; row <= rows; row++ ) {
			const shift = after.pinned[( after.plan.anchors[span] + row ) * 4] - before.pinned[( before.plan.anchors[span] + row ) * 4]
			assert.ok( phase( shift ) < 1e-3, `raising control 2 slid the paint on span ${span} by ${phase( shift )}m` )
		}
	}
	road.dispose()
} )

test( 'the level banked road paint compiles on both renderer backends', async t => {
	for ( const target of targets ) {
		await t.test( target.name, () => {
			const renderer = createRenderer( target.forceWebGL )
			const { road } = createRoad()
			const graph = buildShaderGraph( renderer, road )

			assert.ok( graph.fragmentShader.includes( target.fragmentEntryPoint ) )
			assert.ok( graph.vertexShader.length > 0 )
			assert.ok( /fwidth|dFdx|dpdx/i.test( graph.fragmentShader ), 'paint antialiasing did not reach the shader' )
			assert.ok( !/undefined|NaN/.test( graph.fragmentShader ), 'generated fragment shader contains undefined values' )

			road.dispose()
		} )
	}
} )
