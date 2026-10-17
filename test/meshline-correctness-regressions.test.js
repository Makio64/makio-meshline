import assert from 'node:assert/strict'
import test from 'node:test'

import { getCurrentStack, setCurrentStack, stack } from 'three/tsl'
import { InstancedBufferAttribute, PerspectiveCamera, Scene, StreamDrawUsage } from 'three/webgpu'

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

test( 'widthCallback() swaps on a built line keep moved points and facade state', () => {
	const pointXs = geometry => {
		const position = geometry.getAttribute( 'position' )
		const values = []
		for ( let i = 0; i < position.count; i += 4 ) values.push( position.getX( i ) )
		return values
	}

	// The swap rebuilt from the geometry's build-time source, so points moved
	// in place snapped back, and it dropped the usage dynamic() set after build.
	const line = new MeshLine()
		.lines( new Float32Array( [0, 0, 0, 1, 0, 0] ) )
		.widthCallback( () => 1 )
		.build()
	line.setPositions( new Float32Array( [5, 0, 0, 6, 0, 0] ) )
	line.dynamic( true )
	line.widthCallback( () => 2 )
	assert.deepEqual( pointXs( line.geometry ), [5, 6] )
	assert.equal( line.geometry.getAttribute( 'width' ).getX( 0 ), 2 )
	assert.equal( line.geometry.getAttribute( 'position' ).usage, StreamDrawUsage )
	line.dispose()

	const loop = new MeshLine()
		.lines( new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] ), true )
		.widthCallback( () => 1 )
		.build()
	loop.setPositionRange( new Float32Array( [-1, -1, 0] ), 0 )
	loop.widthCallback( () => 2 )
	assert.deepEqual( pointXs( loop.geometry ), [-1, 1, 1, 0, -1] )
	loop.dispose()

	const surface = new MeshLine()
		.surface()
		.lines( new Float32Array( [0, 0, 0, 1, 0, 0, 2, 0, 0] ) )
		.widthCallback( () => 1 )
		.build()
	surface.setPositions( new Float32Array( [5, 0, 0, 6, 0, 0, 7, 0, 0] ) )
	surface.widthCallback( () => 2 )
	assert.deepEqual( Array.from( surface.geometry._lines[0] ), [5, 0, 0, 6, 0, 0, 7, 0, 0] )
	surface.dispose()
} )

test( 'closed( false ) after a range edit reopens a loop without its seam point', () => {
	const line = new MeshLine()
		.lines( new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] ), true )
		.build()
	line.setPositionRange( new Float32Array( [-1, -1, 0] ), 0 )
	line.closed( false )

	// The facade used to copy the stored loop with its seam, so the reopened
	// line kept a fifth point and still closed.
	assert.deepEqual( Array.from( line.geometry._lines[0] ), [-1, -1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] )
	assert.deepEqual( line.geometry._lineLoops, [false] )
	line.dispose()
} )

test( 'range edits reuse the facade source instead of copying the batch', () => {
	// Open Float32Array lines hold the edit themselves, so the batch stays.
	const open = [
		new Float32Array( [0, 0, 0, 1, 0, 0] ),
		new Float32Array( [3, 0, 0, 4, 0, 0] ),
	]
	const line = new MeshLine().lines( open ).build()
	for ( let i = 0; i < 3; i++ ) line.setPositionRange( new Float32Array( [4, i + 1, 0] ), 1, { lineIndex: 1 } )
	assert.equal( line._options.lines, open )
	line.dispose()

	// Closed loops are stored as copies: the first edit copies the batch once,
	// and later edits on any of its lines reuse that copy.
	const loops = new MeshLine()
		.lines( [
			new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] ),
			new Float32Array( [3, 0, 0, 4, 0, 0, 4, 1, 0, 3, 1, 0] ),
		], true )
		.build()
	loops.setPositionRange( new Float32Array( [0, -1, 0] ), 0, { lineIndex: 0 } )
	const source = loops._options.lines
	loops.setPositionRange( new Float32Array( [3, -1, 0] ), 0, { lineIndex: 1 } )
	loops.setPositionRange( new Float32Array( [0, -2, 0] ), 0, { lineIndex: 0 } )
	assert.equal( loops._options.lines, source )
	loops.rebuild()
	assert.deepEqual( loops.geometry._lineLoops, [true, true] )
	assert.deepEqual( [loops.geometry._lines[0][1], loops.geometry._lines[1][1]], [-2, -1] )
	loops.dispose()
} )

test( 'range edits keep per-line closed flags aligned when a batch dropped a line', () => {
	// The single-point first line is dropped, so the loop is stored line 0. The
	// facade used to copy only the stored lines, which moved the loop onto the
	// first `closed` flag and opened it on the next rebuild.
	const line = new MeshLine()
		.lines( [
			new Float32Array( [9, 9, 9] ),
			new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] ),
		], [false, true] )
		.build()
	line.setPositionRange( new Float32Array( [-1, -1, 0] ), 0 )
	line.rebuild()
	assert.deepEqual( line.geometry._lineLoops, [true] )
	assert.deepEqual( Array.from( line.geometry._lines[0] ), [-1, -1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, -1, -1, 0] )
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

test( 'points alias, join string shorthand, and dash disabling work across configure and fluent methods', () => {
	const line = new MeshLine( {
		points: threePointLine,
		join: 'round',
		dash: { count: 6, ratio: 0.4 },
	} ).build()

	assert.deepEqual( Array.from( line.geometry._lines[0] ), Array.from( threePointLine ) )
	assert.equal( line._options.join.type, 'round' )
	assert.equal( line.material._joinType, 'round' )
	assert.equal( line.material.dashCount.value, 6 )

	line.points( twoPointLine ).join( 'bevel' ).dash( false )
	assert.deepEqual( Array.from( line.geometry._lines[0] ), Array.from( twoPointLine ) )
	assert.equal( line._options.join.type, 'bevel' )
	assert.equal( line.material.dashCount, null )

	line.configure( { points: threePointLine, join: null, dash: { count: 4 }, miterLimit: 2.5 } )
	assert.equal( line._options.join.type, 'miter' )
	assert.equal( line._options.join.limit, 2.5 )
	assert.equal( line.material.miterLimit, 2.5 )
	assert.equal( line.material.dashCount.value, 4 )

	line.configure( { dash: null } )
	assert.equal( line.material.dashCount, null )
	line.dispose()
} )

