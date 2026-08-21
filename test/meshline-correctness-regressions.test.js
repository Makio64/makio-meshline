import assert from 'node:assert/strict'
import test from 'node:test'

import { getCurrentStack, setCurrentStack, stack } from 'three/tsl'
import { InstancedBufferAttribute, PerspectiveCamera, Scene } from 'three/webgpu'

import MeshLine, {
	MeshLineGeometry,
	MeshLineNodeMaterial,
	MeshLinePicker,
} from '../src/index.js'

const twoPointLine = new Float32Array( [
	0, 0, 0,
	1, 0, 0,
] )

const threePointLine = new Float32Array( [
	0, 0, 0,
	1, 1, 0,
	2, 0, 0,
] )

test( 'live facade positions and render size survive structural rebuilds', () => {
	const updated = new Float32Array( [
	10, 1, 0,
	11, 2, 0,
	12, 1, 0,
	] )
	const line = new MeshLine( {
		lines: twoPointLine,
		renderWidth: 100,
		renderHeight: 50,
	} ).build()

	line.setPositions( updated, true )
	line.resize( 640, 360 )
	line.gradientColor( 0xff0000 )

	assert.deepEqual( Array.from( line.geometry._lines[0] ), Array.from( updated ) )
	assert.deepEqual( line.material.resolution.value.toArray(), [640, 360] )
	assert.equal( line._options.renderWidth, 640 )
	assert.equal( line._options.renderHeight, 360 )
	line.dispose()
} )

test( 'partial facade position updates become the source for later rebuilds', () => {
	const line = new MeshLine( { lines: threePointLine } ).build()

	line.setPositionRange( new Float32Array( [5, 2, 0] ), 1 )
	line.gradientColor( 0x00ff00 )

	assert.deepEqual( Array.from( line.geometry._lines[0] ), [
		0, 0, 0,
		5, 2, 0,
		2, 0, 0,
	] )
	line.dispose()
} )

test( 'arbitrary vertex deformation hooks disable automatic frustum culling', () => {
	const passthrough = value => value
	const hookNames = [
		'positionFn',
		'previousFn',
		'nextFn',
		'widthFn',
		'normalFn',
		'vertexFn',
	]

	for ( const hookName of hookNames ) {
		const line = new MeshLine()[hookName]( passthrough ).build()
		assert.equal( line.frustumCulled, false, `${hookName} must fail open` )
		assert.equal( line.geometry.boundingSphere, null, `${hookName} must skip CPU bounds` )

		line[hookName]( null ).build()
		assert.equal( line.frustumCulled, true, `${hookName} removal must restore automatic culling` )
		assert.ok( line.geometry.boundingSphere, `${hookName} removal must restore CPU bounds` )
		line.dispose()
	}
} )

test( 'explicit frustum-culling choices override deformation-hook safety defaults', () => {
	const explicitTrue = new MeshLine( {
		positionFn: value => value,
		frustumCulled: true,
	} ).build()
	assert.equal( explicitTrue.frustumCulled, true )
	assert.ok( explicitTrue.geometry.boundingSphere )
	explicitTrue.dispose()

	const explicitFalse = new MeshLine( {
		positionFn: value => value,
		frustumCulled: false,
	} ).build()
	explicitFalse.positionFn( null ).build()
	assert.equal( explicitFalse.frustumCulled, false )
	assert.equal( explicitFalse.geometry.boundingSphere, null )
	explicitFalse.dispose()
} )

test( 'topology changes invalidate custom vertex attributes but preserve instance attributes', () => {
	const geometry = new MeshLineGeometry( { lines: twoPointLine } )
	const custom = new Float32Array( geometry.getAttribute( 'position' ).count )
	geometry.setOrUpdateAttribute( 'customWeight', custom, 1 )
	const customAttribute = geometry.getAttribute( 'customWeight' )
	const instanceAttribute = new InstancedBufferAttribute( new Float32Array( [1, 2] ), 1 )
	geometry.setAttribute( 'instanceScale', instanceAttribute )

	geometry.setPositions( new Float32Array( [
		3, 0, 0,
		4, 0, 0,
	] ) )
	assert.equal( geometry.getAttribute( 'customWeight' ), customAttribute )

	geometry.setPositions( threePointLine )
	assert.equal( geometry.getAttribute( 'customWeight' ), undefined )
	assert.equal( geometry.getAttribute( 'instanceScale' ), instanceAttribute )
	assert.equal( geometry.getAttribute( 'position' ).count, 12 )
	geometry.dispose()
} )

test( 'line repartitioning invalidates custom vertex attributes even at the same total size', () => {
	const geometry = new MeshLineGeometry( {
		lines: [twoPointLine, threePointLine],
	} )
	geometry.setOrUpdateAttribute(
		'customWeight',
		new Float32Array( geometry.getAttribute( 'position' ).count ),
		1,
	)

	geometry.setLines( [threePointLine, twoPointLine] )
	assert.equal( geometry.getAttribute( 'customWeight' ), undefined )
	assert.equal( geometry.getAttribute( 'position' ).count, 20 )
	geometry.dispose()
} )

test( 'dashed shadow hooks receive a side node when their lazy graph builds', () => {
	for ( const needsSide of [false, true] ) {
		let receivedSide = null
		const material = new MeshLineNodeMaterial( {
			dashCount: 4,
			dashRatio: 0.5,
			needsProgress: true,
			needsSide,
			dashFn: ( cycle, _progress, side ) => {
				receivedSide = side
				return cycle
			},
		} )
		material.setShadow( true )

		const previousStack = getCurrentStack()
		setCurrentStack( stack() )
		try {
			assert.doesNotThrow( () => material.maskShadowNode.node.shaderNode.jsFunc( [] ) )
		} finally {
			setCurrentStack( previousStack )
		}
		assert.ok( receivedSide )
		material.dispose()
	}
} )

test( 'shadow can be enabled before a bare material is configured', () => {
	const material = new MeshLineNodeMaterial()
	assert.doesNotThrow( () => material.setShadow( true ) )
	assert.doesNotThrow( () => material.buildLine( { needsSide: true } ) )
	assert.ok( material.castShadowPositionNode )
	material.dispose()
} )

const createPickerRenderer = pixels => ({
	outputColorSpace: 'saved-output-color-space',
	toneMapping: 123,
	getPixelRatio: () => 1,
	getDrawingBufferSize: target => target.set( 100, 100 ),
	getRenderTarget: () => null,
	getActiveMipmapLevel: () => 0,
	getClearAlpha: () => 1,
	getClearColor: target => target.set( 0x123456 ),
	setRenderTarget: () => {},
	setClearColor: () => {},
	clear: () => {},
	render: () => {},
	readRenderTargetPixelsAsync: async () => pixels,
})

const pickEncodedPixel = async ( line, pixels ) => {
	const scene = new Scene()
	const camera = new PerspectiveCamera( 60, 1, 0.1, 100 )
	const picker = new MeshLinePicker( createPickerRenderer( pixels ), scene, camera )
	scene.add( line )
	picker.add( line )
	const hit = await picker.pick( 50, 50 )
	picker.dispose()
	return hit
}

test( 'picker reserves instanceId -1 for non-instanced lines', async () => {
	const line = new MeshLine().build()
	const hit = await pickEncodedPixel( line, new Uint8Array( [1, 0, 0, 255] ) )

	assert.equal( hit.line, line )
	assert.equal( hit.instanceId, -1 )
	line.dispose()
} )

test( 'picker still decodes instance IDs for explicitly instanced lines', async () => {
	const line = new MeshLine().instances( 2 ).build()
	const hit = await pickEncodedPixel( line, new Uint8Array( [1, 0, 1, 255] ) )

	assert.equal( hit.line, line )
	assert.equal( hit.instanceId, 1 )
	line.dispose()
} )
