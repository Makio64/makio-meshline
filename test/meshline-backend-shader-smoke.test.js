import assert from 'node:assert/strict'
import test from 'node:test'

import {
	Mesh,
	MeshBasicNodeMaterial,
	PerspectiveCamera,
	Scene,
	WebGPURenderer,
} from 'three/webgpu'
import { attribute, Fn, vec4 } from 'three/tsl'

import { lineCoord } from '../src/MeshLineNodeMaterial.js'
import MeshLine from '../src/MeshLine.js'
import MeshLineGPUPath from '../src/MeshLineGPUPath.js'

const targets = [
	{
		name: 'WebGPU/WGSL',
		forceWebGL: false,
		vertexEntryPoint: '@vertex',
		fragmentEntryPoint: '@fragment',
	},
	{
		name: 'WebGL2/GLSL',
		forceWebGL: true,
		vertexEntryPoint: 'void main',
		fragmentEntryPoint: 'void main',
	},
]

const buildShaderGraph = ( renderer, object, material = object.material ) => {
	const builder = renderer.backend.createNodeBuilder( object, renderer )
	builder.scene = new Scene()
	builder.camera = new PerspectiveCamera()
	builder.material = material
	builder.context.material = material
	return builder.build()
}

const createShadowPassMesh = line => {
	const material = new MeshBasicNodeMaterial()
	material.positionNode = line.material.castShadowPositionNode
	material.colorNode = Fn( ( [color] ) => {
		line.material.maskShadowNode.not().discard()
		return color
	} )( vec4( 0, 0, 0, 1 ) )
	return new Mesh( line.geometry, material )
}

test( 'MeshLine visible and dashed-shadow graphs build for both renderer backends', async t => {
	for ( const target of targets ) {
		await t.test( target.name, () => {
			const renderer = new WebGPURenderer( {
				canvas: { width: 1, height: 1 },
				forceWebGL: target.forceWebGL,
			} )
			for ( const scenario of [
				{ needsSide: false, nonIndexed: false },
				{ needsSide: false, nonIndexed: true },
				{ needsSide: true, nonIndexed: true },
			] ) {
				const line = new MeshLine( {
					lines: new Float32Array( [
						0, 0, 0,
						1, 0, 0,
					] ),
					needsSide: scenario.needsSide,
					dash: { count: 4, ratio: 0.5 },
					shadow: true,
					dashFn: ( cycle, _progress, side ) => cycle
						.add( side.mul( 0.125 ) )
						.toVar( 'customDashCycle' ),
				} ).build()
				if ( scenario.nonIndexed ) {
					const indexedGeometry = line.geometry
					line.geometry = indexedGeometry.toNonIndexed()
					indexedGeometry.dispose()
					assert.equal( line.geometry.getIndex(), null )
				}

				const visibleBuilder = buildShaderGraph( renderer, line )
				assert.match( visibleBuilder.vertexShader, /\S/ )
				assert.match( visibleBuilder.fragmentShader, /\S/ )
				assert.ok( visibleBuilder.vertexShader.includes( target.vertexEntryPoint ) )
				assert.ok( visibleBuilder.fragmentShader.includes( target.fragmentEntryPoint ) )
				assert.ok( visibleBuilder.vertexShader.includes( 'joinRole' ) )
				assert.ok( visibleBuilder.fragmentShader.includes( 'customDashCycle' ) )

				const shadowMesh = createShadowPassMesh( line )
				const shadowBuilder = buildShaderGraph( renderer, shadowMesh )
				assert.match( shadowBuilder.vertexShader, /\S/ )
				assert.match( shadowBuilder.fragmentShader, /\S/ )
				assert.ok( shadowBuilder.vertexShader.includes( target.vertexEntryPoint ) )
				assert.ok( shadowBuilder.fragmentShader.includes( target.fragmentEntryPoint ) )
				assert.ok( shadowBuilder.vertexShader.includes( 'joinRole' ) )
				assert.ok( shadowBuilder.vertexShader.includes( 'shadowDirection' ) )
				assert.ok( shadowBuilder.fragmentShader.includes( 'customDashCycle' ) )
				assert.ok( shadowBuilder.fragmentShader.includes( 'discard;' ) )

				shadowMesh.material.dispose()
				line.dispose()
			}
		} )
	}
} )

test( 'legacy indexed geometry without joinRole keeps the vertex-index fallback', () => {
	for ( const target of targets ) {
		const renderer = new WebGPURenderer( {
			canvas: { width: 1, height: 1 },
			forceWebGL: target.forceWebGL,
		} )
		const line = new MeshLine( {
			lines: new Float32Array( [0, 0, 0, 1, 0, 0] ),
			dash: { count: 4, ratio: 0.5 },
			shadow: true,
		} ).build()
		line.geometry.deleteAttribute( 'joinRole' )

		const warnings = []
		const warn = console.warn
		let visibleBuilder
		let shadowBuilder
		const shadowMesh = createShadowPassMesh( line )
		try {
			console.warn = ( ...args ) => warnings.push( args.join( ' ' ) )
			visibleBuilder = buildShaderGraph( renderer, line )
			shadowBuilder = buildShaderGraph( renderer, shadowMesh )
		} finally {
			console.warn = warn
		}

		assert.match( visibleBuilder.vertexShader, /& 2u/ )
		assert.match( shadowBuilder.vertexShader, /& 2u/ )
		assert.ok( warnings.length >= 2 )
		assert.ok( warnings.every( warning => warning.includes( 'joinRole' ) ) )
		shadowMesh.material.dispose()
		line.dispose()
	}
} )

test( 'packed custom attributes share one backend vertex buffer', () => {
	for ( const target of targets ) {
		const renderer = new WebGPURenderer( {
			canvas: { width: 1, height: 1 },
			forceWebGL: target.forceWebGL,
		} )
		const line = new MeshLine( {
			lines: new Float32Array( [0, 0, 0, 1, 0, 0] ),
			instanceCount: 2,
			colorFn: () => attribute( 'instanceColor', 'vec3' ),
			positionFn: position => position.add( attribute( 'instanceOffset', 'vec3' ) ),
		} ).build()
		const packed = line.addInstanceAttributes( {
			instanceOffset: 3,
			instanceColor: 3,
		} )
		const builder = buildShaderGraph( renderer, line )
		const usedAttributes = builder.attributes
			.map( nodeAttribute => line.geometry.getAttribute( nodeAttribute.name ) )
			.filter( Boolean )
		const buffers = new Set( usedAttributes.map( item => item.isInterleavedBufferAttribute ? item.data : item ) )

		assert.ok( builder.vertexShader.includes( 'instanceOffset' ) )
		assert.ok( builder.vertexShader.includes( 'instanceColor' ) )
		assert.equal( packed.instanceOffset.data, packed.instanceColor.data )
		assert.ok( buffers.has( packed.instanceOffset.data ) )
		assert.equal( [...buffers].filter( buffer => buffer === packed.instanceOffset.data ).length, 1 )
		assert.ok( buffers.size <= line.getVertexBufferUsage().usedBuffers )
		line.dispose()
	}
} )

test( 'fixed MeshLineGPUPath vertex graph builds for WebGPU', async () => {
	const prepareRenderer = {
		isWebGPURenderer: true,
		backend: { isWebGPUBackend: true, device: {} },
		async init() {},
		async computeAsync() {},
		getSize: target => target.set( 800, 600 ),
	}
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [
			0, 0, -5,
			1, 0, -5,
			2, 1, -5,
		] ),
	} )
	assert.equal( await path.prepare( prepareRenderer, new PerspectiveCamera() ), true )
	assert.equal( path.status.topology, 'fixed-strip' )

	const renderer = new WebGPURenderer( { canvas: { width: 1, height: 1 } } )
	const builder = buildShaderGraph( renderer, path.gpuMesh )
	assert.match( builder.vertexShader, /\S/ )
	assert.match( builder.fragmentShader, /\S/ )
	assert.ok( builder.vertexShader.includes( '@vertex' ) )
	path.dispose()
} )

test( 'analytic antialiasing and lineCoord build on both renderer backends', async t => {
	for ( const target of targets ) {
		await t.test( target.name, () => {
			const renderer = new WebGPURenderer( {
				canvas: { width: 1, height: 1 },
				forceWebGL: target.forceWebGL,
			} )
			const line = new MeshLine( {
				lines: new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] ),
				join: { type: 'bevel', limit: 4 },
				antialias: true,
				// `lineCoord` has to survive as a hook input, not just internally.
				fragmentColorFn: color => color.mul( lineCoord.y.abs().oneMinus().toVar( 'customLineCoordFade' ) ),
			} ).build()

			assert.equal( line.material.transparent, true, 'coverage in alpha requires blending' )
			assert.equal(
				line.geometry.getIndex().count,
				( 3 - 1 ) * 6 + 1 * 6,
				'the bevel bridge must reach the built geometry',
			)

			const builder = buildShaderGraph( renderer, line )
			assert.ok( builder.vertexShader.includes( target.vertexEntryPoint ) )
			assert.ok( builder.fragmentShader.includes( target.fragmentEntryPoint ) )
			assert.ok( builder.fragmentShader.includes( 'customLineCoordFade' ), 'lineCoord must reach fragment hooks' )
			assert.ok( builder.vertexShader.includes( 'aaScale' ), 'the vertex stage must pad the edge' )
			assert.match(
				builder.fragmentShader,
				/dpdx|dFdx/,
				'coverage must come from a real screen-space derivative',
			)
			assert.ok(
				!/\bfwidth\s*\(/.test( builder.fragmentShader ),
				'fwidth is the Manhattan sum and over-blurs diagonals',
			)

			line.dispose()
		} )
	}
} )
