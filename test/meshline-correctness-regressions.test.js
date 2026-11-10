import assert from 'node:assert/strict'
import test from 'node:test'

import { Fn, vec4 } from 'three/tsl'
import { InstancedBufferAttribute, NodeMaterial, PerspectiveCamera, Scene, StreamDrawUsage } from 'three/webgpu'

import MeshLine, {
	MeshLineGeometry,
	MeshLineNodeMaterial,
	MeshLinePicker,
} from '../src/index.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

const twoPointLine = new Float32Array( [
	0, 0, 0,
	1, 0, 0,
] )

const threePointLine = new Float32Array( [
	0, 0, 0,
	1, 1, 0,
	2, 0, 0,
] )

// `count` distinct points along a wave, or around a ring for loops; `seed`
// moves every point so each update differs from the last.
const batchPoints = ( count, seed, closed = false ) => {
	const points = new Float32Array( count * 3 )
	for ( let i = 0; i < count; i++ ) {
		const angle = i / count * Math.PI * 2
		points[i * 3] = closed ? Math.cos( angle ) * ( 2 + seed ) : i
		points[i * 3 + 1] = closed ? Math.sin( angle ) * ( 2 + seed ) : Math.sin( i * 0.5 + seed )
		points[i * 3 + 2] = seed
	}
	return points
}

const assertSameGeometry = ( live, fresh, message ) => {
	assert.deepEqual( Object.keys( live.attributes ).sort(), Object.keys( fresh.attributes ).sort(), message )
	for ( const name of Object.keys( fresh.attributes ) ) {
		assert.deepEqual( Array.from( live.getAttribute( name ).array ), Array.from( fresh.getAttribute( name ).array ), `${message}: ${name}` )
	}
	assert.deepEqual( Array.from( live.getIndex().array ), Array.from( fresh.getIndex().array ), `${message}: index` )
	assert.deepEqual( live._lines.map( line => Array.from( line ) ), fresh._lines.map( line => Array.from( line ) ), `${message}: lines` )
	assert.deepEqual( live._lineLoops, fresh._lineLoops, `${message}: loops` )
}

// Steps one live facade line and two live geometries (one through
// setPositions(), one alternating setPositions() and setLines()) through
// `counts`, comparing each step with fresh builds.
const assertBatchedUpdatesMatchFreshBuilds = ( counts, closed ) => {
	const first = batchPoints( counts[0], 0, closed )
	const line = new MeshLine().lines( [first.slice()], closed ).build()
	const updated = new MeshLineGeometry( { lines: [first.slice()], closed } )
	const rebuilt = new MeshLineGeometry( { lines: [first.slice()], closed } )
	for ( let step = 1; step < counts.length; step++ ) {
		const points = batchPoints( counts[step], step, closed )
		line.lines( [points.slice()], closed )
		updated.setPositions( [points.slice()] )
		if ( step % 2 ) rebuilt.setPositions( [points.slice()] )
		else rebuilt.setLines( [points.slice()] )

		const freshLine = new MeshLine().lines( [points.slice()], closed ).build()
		const fresh = new MeshLineGeometry( { lines: [points.slice()], closed } )
		const message = `${closed ? 'closed' : 'open'} ${counts.join( ',' )} step ${step}`
		assertSameGeometry( line.geometry, freshLine.geometry, `facade ${message}` )
		assertSameGeometry( updated, fresh, `setPositions ${message}` )
		assertSameGeometry( rebuilt, fresh, `setLines ${message}` )
		freshLine.dispose()
		fresh.dispose()
	}
	line.dispose()
	updated.dispose()
	rebuilt.dispose()
}

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

test( 'batched lines() keep each new point count after a same-shape update', () => {
	// setLines() made its scratch containers current while setPositions() still
	// held them as its own scratch. After a same-shape update and a rebuild, the
	// next update refilled the drawn lines in place and passed the shape check
	// against itself: a longer line overflowed the old buffers, a shorter one
	// was ignored.
	for ( const closed of [false, true] ) {
		assertBatchedUpdatesMatchFreshBuilds( [10, 10, 20, 30], closed )
		assertBatchedUpdatesMatchFreshBuilds( [10, 10, 20, 12], closed )
	}
} )

test( 'rejected updates after batched rebuilds leave the previous geometry intact', () => {
	for ( const closed of [false, true] ) {
		let rejectWidth = false
		const options = {
			closed,
			needsWidth: true,
			widthCallback: ( progress, pointIndex ) => rejectWidth && pointIndex === 3 ? Number.NaN : 1 + progress,
		}
		const geometry = new MeshLineGeometry( { ...options, lines: [batchPoints( 10, 0, closed )] } )
		geometry.setPositions( [batchPoints( 10, 1, closed )] )
		geometry.setPositions( [batchPoints( 20, 2, closed )] )
		geometry.setPositions( [batchPoints( 20, 3, closed )] )
		geometry.setPositions( [batchPoints( 12, 4, closed )] )

		// The rejected update must not have refilled the stored lines (or the
		// closing-point copies of loops) that the buffers still draw.
		rejectWidth = true
		assert.throws(
			() => geometry.setPositions( [batchPoints( 12, 5, closed )] ),
			/widthCallback returned a non-finite value/
		)
		rejectWidth = false
		const previous = new MeshLineGeometry( { ...options, lines: [batchPoints( 12, 4, closed )] } )
		assertSameGeometry( geometry, previous, `${closed ? 'closed' : 'open'} after rejection` )

		// Nor may a rebuild whose batch fails to convert part way through.
		assert.throws(
			() => geometry.setLines( [batchPoints( 7, 5, closed ), new MeshLineGeometry()] ),
			/position attribute/
		)
		assertSameGeometry( geometry, previous, `${closed ? 'closed' : 'open'} after invalid input` )

		geometry.setPositions( [batchPoints( 12, 6, closed )] )
		const fresh = new MeshLineGeometry( { ...options, lines: [batchPoints( 12, 6, closed )] } )
		assertSameGeometry( geometry, fresh, `${closed ? 'closed' : 'open'} after recovery` )
		previous.dispose()
		fresh.dispose()
		geometry.dispose()
	}
} )

test( 'range-edited loops keep their source when a later update is rejected', () => {
	// setPositionRange() hands the facade a source that views the stored
	// closing-point copies. Refilling those copies, here in an update that is
	// then rejected, must not rewrite the source of the next rebuild.
	for ( const route of ['direct', 'rebuild', 'closed'] ) {
		let rejectWidth = false
		const widthCallback = progress => rejectWidth ? Number.NaN : 1 + progress
		const edited = [batchPoints( 5, 0, true ), batchPoints( 5, 1, true )]
		const line = new MeshLine( { widthCallback } ).lines( edited.map( points => points.slice() ), true ).build()
		line.setPositionRange( new Float32Array( [0.5, 0.5, 0.5] ), 1, { lineIndex: 0 } )
		edited[0].set( [0.5, 0.5, 0.5], 3 )
		if ( route === 'rebuild' ) line.rebuild()
		if ( route === 'closed' ) line.closed( true )

		rejectWidth = true
		const nextCount = route === 'closed' ? 5 : 6
		assert.throws(
			() => line.setPositions( [batchPoints( 5, 2, true ), batchPoints( nextCount, 3, true )] ),
			/widthCallback returned a non-finite value/
		)
		rejectWidth = false
		line.rebuild()

		const fresh = new MeshLine( { widthCallback } ).lines( edited, true ).build()
		assertSameGeometry( line.geometry, fresh.geometry, `${route} rebuild after rejection` )
		fresh.dispose()
		line.dispose()
	}
} )

test( 'rebuilds do not keep the lines they replaced alive', () => {
	for ( const closed of [false, true] ) {
		for ( const sameShapeFirst of [false, true] ) {
			const geometry = new MeshLineGeometry( { lines: [batchPoints( 1000, 0, closed )], closed } )
			if ( sameShapeFirst ) geometry.setPositions( [batchPoints( 1000, 1, closed )] )
			geometry.setLines( [batchPoints( 10, 2, closed )] )
			if ( !sameShapeFirst ) geometry.setPositions( [batchPoints( 10, 3, closed )] )
			// Spare containers come back empty, and spare closing-point copies are
			// never longer than the line drawn at their index.
			for ( const prepared of [geometry._buildPrepared, geometry._updatePrepared] ) {
				assert.equal( prepared.lines.length, 0 )
				assert.ok( prepared.loopedScratch.every( seam => !seam || seam.length <= geometry._lines[0].length ) )
			}
			geometry.dispose()
		}
	}
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
	const renderer = createRenderer( false )
	for ( const needsSide of [false, true] ) {
		let receivedSide = null
		const line = new MeshLine( {
			lines: threePointLine,
			dashCount: 4,
			dashRatio: 0.5,
			needsSide,
			shadow: true,
			dashFn: ( cycle, _progress, side ) => {
				receivedSide = side
				return cycle
			},
		} ).build()
		const lineMaterial = line.material
		const { castShadowPositionNode, maskShadowNode } = lineMaterial

		// The shadow pass material the renderer derives from these hooks.
		const shadowPassMaterial = new NodeMaterial()
		shadowPassMaterial.positionNode = castShadowPositionNode
		shadowPassMaterial.colorNode = Fn( ( [color] ) => {
			maskShadowNode.not().discard()
			return color
		} )( vec4( 0, 0, 0, 1 ) )
		line.material = shadowPassMaterial

		let shadowGraph = null
		assert.doesNotThrow( () => {
			shadowGraph = buildShaderGraph( renderer, line )
		} )
		assert.equal( receivedSide?.isNode, true )
		assert.match( shadowGraph.fragmentShader, /\bdiscard\b/ )

		line.material = lineMaterial
		shadowPassMaterial.dispose()
		line.dispose()
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

test( 'dynamic() usage survives updates that rebuild the geometry', () => {
	// dynamic() switched the live buffers but not the geometry's usage option,
	// so a new point count or loop flag rebuilt them with the build-time usage.
	for ( const surface of [false, true] ) {
		const line = new MeshLine( { surface } ).lines( threePointLine ).build()
		line.dynamic( true )
		line.lines( batchPoints( 5, 1 ) )
		line.closed( true )
		for ( const [name, attribute] of Object.entries( line.geometry.attributes ) ) {
			assert.equal( attribute.usage, StreamDrawUsage, `${surface ? 'surface' : 'billboard'} ${name}` )
		}
		line.dispose()
	}
} )

test( 'rejected lines() updates leave nothing for later rebuilds to replay', () => {
	// lines() stored the points and loop flags before the geometry accepted them,
	// so closed(), rebuild() and option setters rebuilt the rejected input.
	let rejectWidth = false
	const widthCallback = progress => rejectWidth ? Number.NaN : 1 + progress
	for ( const [route, points, closed] of [
		['same shape', batchPoints( 3, 1 ), false],
		['new shape', batchPoints( 6, 1 ), false],
		['loop', batchPoints( 6, 1, true ), true],
	] ) {
		const line = new MeshLine( { widthCallback } ).lines( threePointLine ).build()
		rejectWidth = true
		assert.throws( () => line.lines( points, closed ), /widthCallback returned a non-finite value/ )
		rejectWidth = false
		line.closed( false )
		const fresh = new MeshLine( { widthCallback } ).lines( threePointLine ).build()
		assertSameGeometry( line.geometry, fresh.geometry, `${route} rejection` )
		fresh.dispose()
		line.dispose()
	}

	// A surface rejects a loop with too few distinct points before it builds.
	const line = new MeshLine( { surface: true } ).lines( threePointLine ).build()
	assert.throws( () => line.lines( twoPointLine, true ), /at least 3 distinct points/ )
	line.lineWidth( 0.5 )
	const fresh = new MeshLine( { surface: true, lineWidth: 0.5 } ).lines( threePointLine ).build()
	assertSameGeometry( line.geometry, fresh.geometry, 'surface rejection' )
	fresh.dispose()
	line.dispose()
} )

test( 'a rejected widthCallback() or vertexColors() swap keeps the previous one', () => {
	// Replacing one callback or color array with another rebuilds only the
	// geometry, which cleared itself on the rejection and kept the new option.
	const widthCallback = progress => 1 + progress
	const vertexColors = [1, 0, 0]
	for ( const [name, options, swap] of [
		['widthCallback', { widthCallback }, line => line.widthCallback( () => Number.NaN )],
		['vertexColors', { vertexColors }, line => line.vertexColors( [Number.NaN, 0, 0] )],
	] ) {
		const line = new MeshLine( options ).lines( threePointLine ).build()
		assert.throws( () => swap( line ), /non-finite/ )
		line.join( 'bevel' )
		const fresh = new MeshLine( { ...options, join: 'bevel' } ).lines( threePointLine ).build()
		assertSameGeometry( line.geometry, fresh.geometry, `rejected ${name}` )
		fresh.dispose()
		line.dispose()
	}
} )

test( 'a rejected rebuild leaves options set after build for the next one', t => {
	// needsPrevious() on a built line waits for a rebuild. One that rejects must
	// not apply it to the geometry alone, while the material still reads it.
	t.mock.method( console, 'warn', () => {} )
	const line = new MeshLine().lines( threePointLine ).build()
	line.needsPrevious( false )
	assert.throws( () => line.widthCallback( () => Number.NaN ), /non-finite/ )
	const fresh = new MeshLine().lines( threePointLine ).build()
	assertSameGeometry( line.geometry, fresh.geometry, 'pending needsPrevious' )
	fresh.dispose()
	line.dispose()
} )

test( 'the smoothing setters leave options set after build for the next rebuild', t => {
	// They rebuild only the geometry, which must not take a needsUV() that the
	// material has not seen yet.
	t.mock.method( console, 'warn', () => {} )
	for ( const update of [
		line => line.smoothSharpBends( true ),
		line => line.smoothSharpBendsAlpha( 0.2 ),
		line => line.smoothSharpBendsThreshold( 0 ),
	] ) {
		const line = new MeshLine().lines( threePointLine ).build()
		line.needsUV( true )
		update( line )
		assert.equal( line.geometry.getAttribute( 'uv' ), undefined )
		line.dispose()
	}
} )

test( 'a rejected smoothSharpBends() setter leaves later rebuilds the accepted options', () => {
	// These setters wrote the geometry's options before it accepted them, so
	// every later rebuild, and the restoring one, replayed the rejected value.
	const zigzag = new Float32Array( 30 ).map( ( _, i ) => i % 3 === 0 ? i / 3 % 2 : i % 3 === 1 ? i / 15 : 0 )
	const widthCallback = ( progress, pointIndex ) => {
		if ( pointIndex >= 10 ) throw new Error( 'at most 10 points' )
		return 1 + progress
	}
	for ( const [name, options, update] of [
		['smoothSharpBends', {}, line => line.smoothSharpBends( true )],
		['smoothSharpBendsThreshold', { smoothSharpBends: true, smoothSharpBendsThreshold: -1 }, line => line.smoothSharpBendsThreshold( -0.5 )],
	] ) {
		// Every corner of the zigzag is sharp enough to split by default.
		const line = new MeshLine( { ...options, widthCallback } ).lines( zigzag ).build()
		const fresh = new MeshLine( { ...options, widthCallback } ).lines( zigzag ).build()
		assert.throws( () => update( line ), /at most 10 points/, name )
		assertSameGeometry( line.geometry, fresh.geometry, `rejected ${name}` )
		line.gradientColor( 0xff0000 )
		fresh.gradientColor( 0xff0000 )
		assertSameGeometry( line.geometry, fresh.geometry, name )
		fresh.dispose()
		line.dispose()
	}
} )
