import assert from 'node:assert/strict'
import test from 'node:test'

import { Fn, uint, uniform, vec3 } from 'three/tsl'
import { Box3, Frustum, Matrix4, NodeMaterial, PerspectiveCamera, Ray, Raycaster, Scene, StorageBufferAttribute, Vector3 } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLineCompute from '../src/MeshLineCompute.js'
import MeshLineCullingSystem from '../src/MeshLineCullingSystem.js'
import MeshLineGeometry from '../src/MeshLineGeometry.js'
import MeshLineGPUPath, { _gpuPathInternals } from '../src/MeshLineGPUPath.js'
import MeshLineNodeMaterial, { lineCoord } from '../src/MeshLineNodeMaterial.js'
import MeshLinePicker from '../src/MeshLinePicker.js'
import MeshLinePickerHelper from '../src/MeshLinePickerHelper.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'
import { storagePositions } from '../src/positions/storagePositions.js'
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

// A dynamic geometry keeps its buffers when the point count changes, so a
// fallback rebuild is compared by the vertices it draws, not by its capacity.
const drawnVertexCount = geometry => geometry._lines.reduce( ( count, line ) => count + line.length / 3 * 4, 0 )
const drawnArray = ( geometry, name ) => {
	const attribute = geometry.getAttribute( name )
	return Array.from( attribute.array.subarray( 0, drawnVertexCount( geometry ) * attribute.itemSize ) )
}

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
			// Default geometry fold mode projects the half-width once into NDC (`baseRadiusNdc`)
			// via scalar `cameraProjectionMatrix[1].y` and reuses it for both `innerRetreat`
			// and `foldReach`, without converting to/from `pixelsPerNdc`, projecting with a
			// 4x4 matrix multiply, or branching on `innerRetreat`.
			assert.match( shader, /\bbaseRadiusNdc\b/ )
			assert.doesNotMatch( shader, /\bpixelsPerNdc\b|\bbaseRadiusPx\b|\binnerRetreat\b|\bdirFallback\b/ )
			assert.equal( ( shader.match( /cameraProjectionMatrix \* vec4/g ) || [] ).length, 0 )
			// Encoded side is decoded linearly from `abs(joinRole)` without a `< 1.5` branch.
			assert.doesNotMatch( shader, /1\.5/ )
			// Two raw projected deltas, the miter sum, and the blended perpendicular;
			// the fold's half-turn sine reuses `rawTurnDot = dot(projectedDir1, projectedDir2)`.
			// The 3D turn takes one inverse square root per view-space body, emitted once, and no acos().
			assert.equal( ( shader.match( /\blength\(/g ) || [] ).length, 4 )
			assert.equal( ( shader.match( /\binverse[Ss]qrt\(/g ) || [] ).length, 2 )
			assert.doesNotMatch( shader, /\bacos\(/ )
			for ( const value of exactFoldValues ) assert.doesNotMatch( shader, value )
			// Default folds are resolved in the vertex stage: a discard anywhere in
			// the fragment stage would cost tile-based GPUs their hidden-surface
			// removal on every line. Default opaque lines also avoid allocating a
			// fallback `materialOpacity` uniform.
			assert.doesNotMatch( builder.fragmentShader, /\bdiscard\b|DiffuseColor\.w \* (?:object\.|nodeUniform)|\bmaterialOpacity\b/ )
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
		// Exact mode computes `foldRadiusPx` once via scalar `cameraProjectionMatrix[1].y`
		// and reuses it without a duplicate `baseRadiusPx` or `cameraProjectionMatrix * vec4`.
		assert.match( exact.vertexShader, /\bfoldRadiusPx\b/ )
		assert.doesNotMatch( exact.vertexShader, /\bbaseRadiusPx\b/ )
		assert.equal( ( exact.vertexShader.match( /cameraProjectionMatrix \* vec4/g ) || [] ).length, 0 )
		assert.equal( ( exact.vertexShader.match( /\blength\(/g ) || [] ).length, 4 )
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

test( 'fragment hooks emit only referenced varyings and deduplicate shaders across uniform/topology variants', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] )
		const compile = options => {
			const line = new MeshLine( { lines: points, ...options } ).build()
			const builder = buildShaderGraph( renderer, line )
			line.dispose()
			return builder
		}

		// A fragment hook reading only `lineCoord` should not emit `vProgress` or `uvCoords`,
		// and explicit `needsUV: false` / `needsProgress: false` should omit those geometry buffers.
		const rimOnlyLine = new MeshLine( {
			lines: points,
			needsUV: false,
			needsProgress: false,
			fragmentColorFn: Fn( ( [color] ) => color.mul( lineCoord.y.abs() ) ),
		} ).build()
		assert.equal( rimOnlyLine.geometry.getAttribute( 'uv' ), undefined )
		assert.equal( rimOnlyLine.geometry.getAttribute( 'progress' ), undefined )
		rimOnlyLine.dispose()

		const rimOnly = compile( {
			needsUV: false,
			fragmentColorFn: Fn( ( [color] ) => color.mul( lineCoord.y.abs() ) ),
		} )
		assert.doesNotMatch( rimOnly.vertexShader, /\bvProgress\b|\buvCoords\b/ )
		assert.doesNotMatch( rimOnly.fragmentShader, /\bvProgress\b|\buvCoords\b/ )

		// A `discardFn` reading only `progress` should not emit UV varyings (`uvCoords` / `nodeVarying`),
		// and lines with different uniform values or open/closed topology share identical shaders.
		const makeRevealLine = options => {
			const percent1 = uniform( 0.8 )
			return compile( {
				needsUV: false,
				discardFn: Fn( ( [progress] ) => progress.greaterThan( percent1 ) ),
				...options,
			} )
		}
		const closedBasic = makeRevealLine( { closed: true, color: 0xce4257, lineWidth: 0.2 } )
		const openBasic = makeRevealLine( { closed: false, color: 0xfcd581, lineWidth: 0.3 } )
		assert.doesNotMatch( closedBasic.vertexShader, /\buvCoords\b|\bnodeVarying0\b/ )
		assert.doesNotMatch( closedBasic.fragmentShader, /\buvCoords\b|\bnodeVarying0\b/ )
		assert.equal( closedBasic.vertexShader, openBasic.vertexShader )
		assert.equal( closedBasic.fragmentShader, openBasic.fragmentShader )

		const dashedShort = makeRevealLine( { color: 0xf35b04, lineWidth: 0.3, dashCount: 8, dashRatio: 0.6 } )
		const dashedLong = makeRevealLine( { color: 0x00ff80, lineWidth: 0.5, dashCount: 6, dashRatio: 0.8 } )
		assert.equal( dashedShort.vertexShader, dashedLong.vertexShader )
		assert.equal( dashedShort.fragmentShader, dashedLong.fragmentShader )
	}
} )

test( 'MeshLinePicker strips visual-only fragment options so picking proxies omit unused varyings and share shaders', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		const scene = new Scene()
		const camera = new PerspectiveCamera( 60, 1, 0.1, 100 )
		const picker = new MeshLinePicker( renderer, scene, camera )
		const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] )

		const lineA = new MeshLine( {
			lines: points,
			color: 0xff0000,
			gradientColor: 0x00ff00,
			antialias: true,
			dashCount: 8,
			dashRatio: 0.5,
		} ).build()
		const lineB = new MeshLine( {
			lines: points,
			color: 0x0000ff,
			colorFn: Fn( ( [c, progress] ) => c.mul( progress ) ),
			opacityFn: Fn( ( [a, progress] ) => a.mul( progress ) ),
			discardFn: Fn( ( [progress] ) => progress.greaterThan( 0.9 ) ),
		} ).build()

		picker.add( lineA ).add( lineB )
		const proxies = picker.debugScene.children
		assert.equal( proxies.length, 2 )

		const proxyA = buildShaderGraph( renderer, proxies[0] )
		const proxyB = buildShaderGraph( renderer, proxies[1] )

		assert.doesNotMatch( proxyA.vertexShader, /\bvProgress\b|\bvPixelWidth\b|\buvCoords\b/ )
		assert.doesNotMatch( proxyA.fragmentShader, /\bvProgress\b|\bvPixelWidth\b|\buvCoords\b/ )
		assert.equal( proxyA.vertexShader, proxyB.vertexShader )
		assert.equal( proxyA.fragmentShader, proxyB.fragmentShader )

		picker.dispose()
		lineA.dispose()
		lineB.dispose()
	}
} )

test( 'MeshLineCompute arcLengthNode binds distance storage as read-only and canonical surface updates skip index rewrites', () => {
	const renderer = createRenderer( false )
	const compute = new MeshLineCompute( { curveCount: 4, pointsPerCurve: 8 } )
	compute
		.widthFn( Fn( ( [width, progress] ) => width.mul( compute.arcLengthNode( progress ) ) ) )
		.build()

	const graph = buildShaderGraph( renderer, compute )
	const readBindings = graph.vertexShader.match( /var<storage,\s*read>/g ) ?? []
	assert.equal( readBindings.length, 2 )
	assert.doesNotMatch( graph.vertexShader, /var<storage,\s*read_write>/ )
	assert.match( graph.vertexShader, /instanceIndex\s*\*\s*8u\b/ )

	compute.dispose()

	const waveA = createWave( 16, 1, 0 )
	const waveB = createWave( 16, 2, 1 )
	const surface = new MeshLineSurfaceGeometry( {
		lines: waveA,
		lineWidth: 0.2,
		join: { type: 'miter', limit: 4 },
		cap: 'butt',
	} )
	const indexAttr = surface.getIndex()
	const initialIndexVersion = indexAttr.version

	surface.setPositions( waveB )
	assert.equal( surface.getIndex(), indexAttr )
	assert.equal( indexAttr.version, initialIndexVersion )
	surface.dispose()
} )

test( 'MeshLineGPUPath vertex shader uses 2D projection column reads, read-only storage, and reversal break pre-filtering', async () => {
	const renderer = createRenderer( false )
	const stubRenderer = {
		isWebGPURenderer: true,
		backend: { isWebGPUBackend: true, device: {} },
		async init() {},
		async computeAsync() {},
		getSize( target ) {
			return target.set( 800, 600 )
		},
	}
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 2, 1, 0, 3, 1, 0, 4, 0, 0] ),
		lineWidth: 0.5,
		color: 0x22d3ee,
	}, {
		chunkSegments: 2,
		simplify: { localTolerance: 0.1 },
	} )
	assert.equal( await path.prepare( stubRenderer, new PerspectiveCamera() ), true )

	const graph = buildShaderGraph( renderer, path.gpuMesh )
	// Each of the 4 segment points transforms by modelViewMatrix * vec4 and then
	// cameraProjectionMatrix * (...), with zero 4x4 matrix-matrix products and zero
	// cameraProjectionMatrix * vec4 offset projections (2D offsets use projCol0/projCol1).
	assert.doesNotMatch( graph.vertexShader, /cameraProjectionMatrix \* modelViewMatrix/ )
	assert.equal( ( graph.vertexShader.match( /modelViewMatrix \* vec4/g ) || [] ).length, 4 )
	assert.equal( ( graph.vertexShader.match( /cameraProjectionMatrix \* vec4/g ) || [] ).length, 0 )
	assert.equal( ( graph.vertexShader.match( /\blength\s*\(/g ) || [] ).length, 4 )
	assert.match( graph.vertexShader, /cameraProjectionMatrix\[\s*0u?\s*\]\.xy/ )
	assert.match( graph.vertexShader, /cameraProjectionMatrix\[\s*1u?\s*\]\.xy/ )
	assert.doesNotMatch( graph.vertexShader, /var<storage,\s*read_write>/ )

	path.dispose()

	// Smooth polyline with no sharp reversals should never call Math.sqrt inside findReversalBreaks.
	const smoothPoints = createWave( 64, 0.2, 0 )
	const originalSqrt = Math.sqrt
	let sqrtCalls = 0
	Math.sqrt = value => {
		sqrtCalls++
		return originalSqrt( value )
	}
	try {
		const breaks = _gpuPathInternals.findReversalBreaks( smoothPoints )
		assert.equal( breaks.every( v => v === 0 ), true )
		assert.equal( sqrtCalls, 0 )
	} finally {
		Math.sqrt = originalSqrt
	}
} )

test( 'storagePositions uses bitwise masking for power-of-two ring trails and closed setPositions reuses seam buffers in one pass', () => {
	const renderer = createRenderer( false )
	const buffer = new StorageBufferAttribute( 4 * 64, 3 )
	const head = uniform( uint( 0 ) )
	const trail = new MeshLine()
		.instances( 4 )
		.segments( 63 )
		.gpuPositionNode( storagePositions( buffer, { pointsPerLine: 64, head } ) )
		.build()

	const graph = buildShaderGraph( renderer, trail )
	assert.match( graph.vertexShader, /&\s*63u\b/ )
	assert.doesNotMatch( graph.vertexShader, /%\s*64u\b/ )
	trail.dispose()

	// Closed loop setPositions() should compute progress in a single pass (N segments)
	// and reuse its double-buffered seam array after the second update.
	const ptsA = createWave( 32, 1, 0 )
	const ptsB = createWave( 32, 2, 1 )
	const closedGeo = new MeshLineGeometry( { lines: ptsA, closed: true, needsProgress: true, needsUV: true } )
	closedGeo.setPositions( ptsB, false )
	const bufferAfterFirstUpdate = closedGeo._lines[0]
	closedGeo.setPositions( ptsA, false )
	const bufferAfterSecondUpdate = closedGeo._lines[0]

	const originalSqrt = Math.sqrt
	let sqrtCalls = 0
	Math.sqrt = value => {
		sqrtCalls++
		return originalSqrt( value )
	}
	try {
		closedGeo.setPositions( ptsB, false )
		assert.equal( closedGeo._lines[0], bufferAfterFirstUpdate )
		assert.equal( sqrtCalls, 32 )
		closedGeo.setPositions( ptsA, false )
		assert.equal( closedGeo._lines[0], bufferAfterSecondUpdate )
	} finally {
		Math.sqrt = originalSqrt
	}
	closedGeo.dispose()
} )

test( 'range edits between closed setPositions() updates keep reusing seam buffers', () => {
	const pointsA = createWave( 32, 1, 0 )
	const pointsB = createWave( 32, 2, 1 )
	const geometry = new MeshLineGeometry( { lines: [pointsA, pointsB], closed: true } )
	const edit = new Float32Array( [0.5, 0.5, 0.5] )
	const seams = new Set()
	for ( let frame = 0; frame < 8; frame++ ) {
		geometry.setPositionRange( edit, 1 )
		geometry.setPositions( frame % 2 ? [pointsA, pointsB] : [pointsB, pointsA] )
		seams.add( geometry._lines[0] )
	}
	assert.equal( seams.size, 2 )
	geometry.dispose()
} )

test( 'dashed fragment shaders use fract without step, shadow vertex shader avoids 4x4 inverse offset transforms, and instanced picker uses bitwise ID encoding', () => {
	const renderer = createRenderer( false )
	const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] )

	const dashedLine = new MeshLine( {
		lines: points,
		dashCount: 8,
		dashRatio: 0.5,
	} ).build()
	const dashedGraph = buildShaderGraph( renderer, dashedLine )
	assert.match( dashedGraph.fragmentShader, /\bfract\s*\(/ )
	assert.doesNotMatch( dashedGraph.fragmentShader, /\bstep\s*\(/ )

	const shadowLine = new MeshLine( {
		lines: points,
		shadow: true,
	} ).build()
	const shadowPassMaterial = new NodeMaterial()
	shadowPassMaterial.positionNode = shadowLine.material.castShadowPositionNode
	shadowLine.material = shadowPassMaterial
	const shadowGraph = buildShaderGraph( renderer, shadowLine )
	// 3 centerline samples (pos, prev, next) inside castShadowPositionNode + 1 final positionLocal transform = 4
	assert.equal( ( shadowGraph.vertexShader.match( /modelViewMatrix \* vec4/g ) || [] ).length, 4 )
	assert.equal( ( shadowGraph.vertexShader.match( /\blength\s*\(/g ) || [] ).length, 6 )
	assert.doesNotMatch( shadowGraph.vertexShader, /cameraWorldMatrix \* vec4|modelWorldMatrixInverse \* vec4/ )
	assert.match( shadowGraph.vertexShader, /cameraWorldMatrix\[\s*0u?\s*\]\.xyz/ )
	// The world offset is computed once and scales the three columns of the inverse
	// model matrix. Its temp is a `var<private> nodeVarN` before r187, a `let nodeConstN` after.
	assert.match( shadowGraph.vertexShader, /([\w.]+)\[\s*0u?\s*\]\.xyz \* vec3<f32>\( (\w+)\.x \)[\s()+]*\1\[\s*1u?\s*\]\.xyz \* vec3<f32>\( \2\.y \)[\s()+]*\1\[\s*2u?\s*\]\.xyz \* vec3<f32>\( \2\.z \)/ )
	shadowPassMaterial.dispose()

	const scene = new Scene()
	const camera = new PerspectiveCamera( 60, 1, 0.1, 100 )
	const picker = new MeshLinePicker( renderer, scene, camera )
	const instancedLine = new MeshLine( { lines: points } ).instances( 4 ).build()
	picker.add( instancedLine )
	const instancedProxy = picker.debugScene.children[0]
	const pickerGraph = buildShaderGraph( renderer, instancedProxy )
	assert.match( pickerGraph.fragmentShader, />>\s*8u\b/ )
	assert.match( pickerGraph.fragmentShader, /&\s*255u\b/ )

	picker.dispose()
	instancedLine.dispose()
	dashedLine.dispose()
	shadowLine.dispose()
} )

test( 'surface round joins skip atan2 on shallow bends, fused setPositionRange matches full rebuilds, and single-line raycast pre-checks its local AABB', () => {
	// 1. Shallow bends with turn angle <= pi / segments skip Math.atan2 in round join analysis.
	const gentlePoints = createWave( 64, 0.05, 0 )
	const originalAtan2 = Math.atan2
	let atan2Calls = 0
	Math.atan2 = ( y, x ) => {
		atan2Calls++
		return originalAtan2( y, x )
	}
	let roundSurface = null
	try {
		roundSurface = new MeshLineSurfaceGeometry( {
			lines: gentlePoints,
			lineWidth: 0.1,
			join: { type: 'round', segments: 8 },
			cap: 'butt',
		} )
		assert.equal( atan2Calls, 0 )
	} finally {
		Math.atan2 = originalAtan2
		roundSurface?.dispose()
	}

	// 2. Fused setPositionRange paths (progress+uv, progress+endpoint, progress+widthCallback)
	// match full setPositions rebuilds bit-for-bit across open and closed lines.
	for ( const closed of [false, true] ) {
		for ( const extraOptions of [
			{ needsProgress: true, needsUV: true },
			{ needsProgress: true, needsEndpointMetadata: true },
			{ needsProgress: true, needsWidth: true, widthCallback: ( p, i ) => 0.5 + p * 1.25 + ( i & 1 ) * 0.1 },
		] ) {
			const basePts = createWave( 40, 1.5, 0 )
			const patch = new Float32Array( [
				3.2, 0.9, -0.4,
				3.7, -0.6, 0.3,
				4.1, 0.2, 0.8,
			] )
			const patchedPts = basePts.slice()
			patchedPts.set( patch, 10 * 3 )

			const incGeo = new MeshLineGeometry( { lines: basePts.slice(), closed, dynamic: true, ...extraOptions } )
			// First setPositionRange initializes the arc-length cache; second exercises the fused cache-hit path.
			incGeo.setPositionRange( basePts.subarray( 10 * 3, 13 * 3 ), 10 )
			incGeo.setPositionRange( patch, 10 )

			const refGeo = new MeshLineGeometry( { lines: basePts.slice(), closed, dynamic: true, ...extraOptions } )
			refGeo.setPositions( patchedPts, false )

			for ( const attrName of ['position', 'previous', 'next', 'progress', 'uv', 'endpoint', 'width'] ) {
				const incAttr = incGeo.getAttribute( attrName )
				const refAttr = refGeo.getAttribute( attrName )
				assert.equal( Boolean( incAttr ), Boolean( refAttr ), `presence of ${attrName} (closed=${closed})` )
				if ( incAttr ) {
					assert.equal( incAttr.array.length, refAttr.array.length )
					for ( let i = 0; i < incAttr.array.length; i++ ) {
						assert.ok(
							Math.abs( incAttr.array[i] - refAttr.array[i] ) <= 1e-6,
							`${attrName}[${i}] mismatch (closed=${closed}): ${incAttr.array[i]} vs ${refAttr.array[i]}`
						)
					}
				}
			}

			incGeo.dispose()
			refGeo.dispose()
		}
	}

	// 3. Single-line raycast rejects rays that hit the boundingSphere but miss the local AABB in O(1).
	const straight = new Float32Array( 64 * 3 )
	for ( let i = 0; i < 64; i++ ) straight[i * 3] = i
	const line = new MeshLine( { lines: straight, lineWidth: 0.2 } ).build()
	const raycaster = new Raycaster()
	// Line spans X in [0, 63], Y=0, Z=0; boundingSphere center is (31.5, 0, 0) with radius ~31.64.
	// A ray at Y=15 (parallel to Z) intersects the boundingSphere (|15| < 31.64) but misses the local AABB (|Y| <= 0.142).
	raycaster.set( new Vector3( 31.5, 15, 10 ), new Vector3( 0, 0, -1 ) )

	const originalDistSq = Ray.prototype.distanceSqToSegment
	let segmentChecks = 0
	Ray.prototype.distanceSqToSegment = function ( ...args ) {
		segmentChecks++
		return originalDistSq.apply( this, args )
	}
	try {
		const hits = raycaster.intersectObject( line, false )
		assert.equal( hits.length, 0 )
		assert.equal( segmentChecks, 0 )
	} finally {
		Ray.prototype.distanceSqToSegment = originalDistSq
		line.dispose()
	}
} )

test( 'direct unaliased variable surface topology matches batch topology, fused widthCallback rolls back cleanly, and multi-line raycast pre-checks aggregate AABB', () => {
	// 1. Direct unaliased single-line variable surface topology matches multi-line batch emission bit-for-bit.
	const gentle = createWave( 32, 0.08, 0 )
	const sharp = new Float32Array( 16 * 3 )
	const sharpTurn = 160 * Math.PI / 180
	let heading = 0
	for ( let i = 1; i < 16; i++ ) {
		if ( i > 1 ) heading += i % 2 === 0 ? -sharpTurn : sharpTurn
		sharp[i * 3] = sharp[( i - 1 ) * 3] + Math.cos( heading ) * 20
		sharp[i * 3 + 2] = sharp[( i - 1 ) * 3 + 2] + Math.sin( heading ) * 20
	}
	const dummyLine = new Float32Array( [0, 10, 0, 1, 10, 0, 2, 10.5, 0] )

	for ( const cfg of [
		{ lines: gentle, lineWidth: 0.1, join: { type: 'bevel', limit: 4 }, cap: 'butt', closed: false },
		{ lines: gentle, lineWidth: 0.1, join: { type: 'round', segments: 8 }, cap: 'butt', closed: false },
		{ lines: sharp, lineWidth: 2, join: { type: 'miter', limit: 2 }, cap: 'butt', closed: false },
	] ) {
		const single = new MeshLineSurfaceGeometry( cfg )
		assert.equal( single._surfaceLines[0].topology?.directUnaliased, true )
		const batch = new MeshLineSurfaceGeometry( {
			...cfg,
			lines: [cfg.lines, dummyLine],
			closed: [cfg.closed, false],
		} )

		const vCount = single.getAttribute( 'position' ).count
		const iCount = single.getIndex().count
		for ( const attrName of ['position', 'normal'] ) {
			const sAttr = single.getAttribute( attrName )
			const bAttr = batch.getAttribute( attrName )
			assert.deepEqual(
				Array.from( sAttr.array ),
				Array.from( bAttr.array.subarray( 0, vCount * sAttr.itemSize ) ),
				`direct surface attribute ${attrName} mismatch`
			)
		}
		assert.deepEqual(
			Array.from( single.getIndex().array ),
			Array.from( batch.getIndex().array.subarray( 0, iCount ) ),
			'direct surface index mismatch'
		)

		single.dispose()
		batch.dispose()
	}

	// 2. Fused setPositionRange + widthCallback writes directly without _lineWidthScratch and rolls back cleanly on error.
	const pts = createWave( 24, 1.0, 0 )
	let rejectAtPoint = -1
	const geo = new MeshLineGeometry( {
		lines: pts.slice(),
		dynamic: true,
		needsProgress: true,
		needsWidth: true,
		widthCallback: ( p, i ) => {
			if ( i === rejectAtPoint ) return Number.NaN
			return 0.4 + p * 0.8 + ( i & 1 ) * 0.05
		},
	} )
	// Prime the arc-length cache so the next call takes the fused streaming path.
	geo.setPositionRange( pts.subarray( 4 * 3, 7 * 3 ), 4 )
	geo._lineWidthScratch.length = 0

	const validPatch = new Float32Array( [1.1, 0.5, -0.2, 1.5, -0.4, 0.3, 1.9, 0.2, 0.1] )
	geo.setPositionRange( validPatch, 4 )
	assert.equal( geo._lineWidthScratch[0], undefined )

	const savedProgress = geo.getAttribute( 'progress' ).array.slice()
	const savedWidth = geo.getAttribute( 'width' ).array.slice()
	const savedLine = geo._lines[0].slice()

	rejectAtPoint = 12
	assert.throws(
		() => geo.setPositionRange( new Float32Array( [1.2, -0.3, 0.4, 1.6, 0.7, -0.1, 2.0, -0.2, 0.2] ), 4 ),
		/widthCallback returned a non-finite value/
	)
	assert.deepEqual( Array.from( geo._lines[0] ), Array.from( savedLine ) )
	assert.deepEqual( Array.from( geo.getAttribute( 'progress' ).array ), Array.from( savedProgress ) )
	assert.deepEqual( Array.from( geo.getAttribute( 'width' ).array ), Array.from( savedWidth ) )
	geo.dispose()

	// 3. Multi-line raycast rejects rays outside the aggregate local AABB in a single box check.
	const batchLines = Array.from( { length: 16 }, ( _, row ) => {
		const arr = new Float32Array( 16 * 3 )
		for ( let i = 0; i < 16; i++ ) {
			arr[i * 3] = i * 4
			arr[i * 3 + 2] = ( row - 7.5 ) * 2
		}
		return arr
	} )
	const multiLine = new MeshLine( { lines: batchLines, lineWidth: 0.2 } ).build()
	const raycaster = new Raycaster()
	raycaster.set( new Vector3( 30, 15, 0 ), new Vector3( 0, 0, -1 ) )

	const originalIntersectsBox = Ray.prototype.intersectsBox
	let boxChecks = 0
	Ray.prototype.intersectsBox = function ( ...args ) {
		boxChecks++
		return originalIntersectsBox.apply( this, args )
	}
	try {
		const hits = raycaster.intersectObject( multiLine, false )
		assert.equal( hits.length, 0 )
		assert.equal( boxChecks, 1 )
	} finally {
		Ray.prototype.intersectsBox = originalIntersectsBox
		multiLine.dispose()
	}
} )

test( 'fused open setPositions, deferred progress normalization, and zero-copy surface paths preserve exact attributes and rollback safety', () => {
	// 1. Fused open setPositions fast path (crossing 4096-point chunk boundary) matches fresh build
	// and restores live buffers if a late point is non-finite.
	const count = 4200
	const ptsA = createWave( count, 1.0, 0 )
	const ptsB = createWave( count, 1.5, 0.7 )
	const fastGeo = new MeshLineGeometry( { lines: ptsA.slice(), dynamic: true, needsProgress: false } )
	fastGeo.setPositions( ptsB, false )

	const refFastGeo = new MeshLineGeometry( { lines: ptsB.slice(), dynamic: true, needsProgress: false } )
	for ( const attrName of ['position', 'previous', 'next'] ) {
		assert.deepEqual(
			Array.from( fastGeo.getAttribute( attrName ).array ),
			Array.from( refFastGeo.getAttribute( attrName ).array ),
			`chunked fused setPositions ${attrName} mismatch`
		)
	}

	// Late non-finite point (> 4096 chunk boundary) aborts the fused writer, rolls back partial
	// chunk writes, and falls back to setLines() compaction identically to a fresh build.
	const invalidPts = createWave( count, 2.0, 1.2 )
	invalidPts[4150 * 3 + 1] = Number.NaN
	fastGeo.setPositions( invalidPts, false )
	const refInvalidGeo = new MeshLineGeometry( { lines: invalidPts.slice(), dynamic: true, needsProgress: false } )
	assert.equal( drawnVertexCount( fastGeo ), ( count - 1 ) * 4 )
	for ( const attrName of ['position', 'previous', 'next'] ) {
		assert.deepEqual(
			drawnArray( fastGeo, attrName ),
			Array.from( refInvalidGeo.getAttribute( attrName ).array ),
			`fallback after late non-finite point ${attrName} mismatch`
		)
	}
	refInvalidGeo.dispose()

	// Restore count via setLines() and verify consecutive duplicate fallback too.
	fastGeo.setLines( ptsB.slice() )
	const dupPts = ptsB.slice()
	dupPts[10 * 3] = dupPts[9 * 3]
	dupPts[10 * 3 + 1] = dupPts[9 * 3 + 1]
	dupPts[10 * 3 + 2] = dupPts[9 * 3 + 2]
	fastGeo.setPositions( dupPts, false )
	assert.equal( drawnVertexCount( fastGeo ), ( count - 1 ) * 4 )
	fastGeo.dispose()
	refFastGeo.dispose()

	// 2. Deferred progress normalization in setPositions and buildLine matches fresh builds across
	// progress-only, progress+uv, and progress+endpointMetadata (open & closed).
	for ( const closed of [false, true] ) {
		for ( const extra of [
			{ needsProgress: true, needsUV: false, needsEndpointMetadata: false },
			{ needsProgress: true, needsUV: true, needsEndpointMetadata: false },
			{ needsProgress: true, needsUV: false, needsEndpointMetadata: true },
			{ needsProgress: true, needsUV: true, needsEndpointMetadata: true },
		] ) {
			const wave0 = createWave( 64, 1.0, 0 )
			const wave1 = createWave( 64, 1.8, 0.9 )
			const updated = new MeshLineGeometry( { lines: wave0.slice(), closed, dynamic: true, ...extra } )
			updated.setPositions( wave1.slice(), false )

			const rebuilt = new MeshLineGeometry( { lines: wave0.slice(), closed, dynamic: true, ...extra } )
			rebuilt.buildLine( { lines: wave1.slice() } )

			const fresh = new MeshLineGeometry( { lines: wave1.slice(), closed, dynamic: true, ...extra } )
			for ( const attrName of ['position', 'previous', 'next', 'progress', 'uv', 'endpoint'] ) {
				const uAttr = updated.getAttribute( attrName )
				const rAttr = rebuilt.getAttribute( attrName )
				const fAttr = fresh.getAttribute( attrName )
				assert.equal( Boolean( uAttr ), Boolean( fAttr ) )
				assert.equal( Boolean( rAttr ), Boolean( fAttr ) )
				if ( fAttr ) {
					for ( let i = 0; i < fAttr.array.length; i++ ) {
						assert.ok(
							Math.abs( uAttr.array[i] - fAttr.array[i] ) <= 1e-6,
							`setPositions ${attrName}[${i}] mismatch (closed=${closed})`
						)
						assert.ok(
							Math.abs( rAttr.array[i] - fAttr.array[i] ) <= 1e-6,
							`buildLine ${attrName}[${i}] mismatch (closed=${closed})`
						)
					}
				}
			}
			updated.dispose()
			rebuilt.dispose()
			fresh.dispose()
		}
	}

	// 3. Zero-copy Float32Array surface input + bisector transport normals + orthonormal join basis.
	const helix = new Float32Array( 48 * 3 )
	for ( let i = 0; i < 48; i++ ) {
		const t = ( i / 48 ) * Math.PI * 2
		helix[i * 3] = Math.cos( t ) * 4
		helix[i * 3 + 1] = Math.sin( t * 2 ) * 1.2
		helix[i * 3 + 2] = Math.sin( t ) * 4
	}
	const surfOpen = new MeshLineSurfaceGeometry( {
		lines: helix,
		closed: false,
		lineWidth: 0.4,
		surface: { frame: 'transport' },
		join: { type: 'round', segments: 6 },
	} )
	assert.equal( surfOpen._surfaceLines[0].points, helix )
	const normals = surfOpen.getAttribute( 'normal' ).array
	for ( let i = 0; i < normals.length; i += 3 ) {
		const len = Math.hypot( normals[i], normals[i + 1], normals[i + 2] )
		assert.ok( Math.abs( len - 1 ) < 1e-4, `unit surface normal expected, got ${len}` )
	}
	surfOpen.dispose()
} )

test( 'pooled compact caps reuse body quad indices on setPositions and open setPositions fast paths handle bounds, progress, and sub-micron steps', () => {
	const waveA = createWave( 24, 1.0, 0 )
	const waveB = createWave( 24, 1.6, 0.5 )

	// 1. Pooled compact caps (round and square) match batch topology and skip rewriting
	// canonical indices on in-place setPositions updates.
	for ( const cap of [{ type: 'round', segments: 8 }, { type: 'square' }] ) {
		const single = new MeshLineSurfaceGeometry( {
			lines: waveA,
			lineWidth: 0.25,
			join: { type: 'miter', limit: 4 },
			cap,
			needsTangents: true,
			needsUV: true,
			needsProgress: true,
			needsSide: true,
		} )
		const batch = new MeshLineSurfaceGeometry( {
			lines: [waveA, waveB],
			lineWidth: 0.25,
			join: { type: 'miter', limit: 4 },
			cap,
			needsTangents: true,
			needsUV: true,
			needsProgress: true,
			needsSide: true,
		} )
		const vCount = single.getAttribute( 'position' ).count
		for ( const [name, itemSize] of [['position', 3], ['normal', 3], ['tangent', 4], ['uv', 2], ['progress', 1], ['side', 1]] ) {
			assert.deepEqual(
				Array.from( single.getAttribute( name ).array ),
				Array.from( batch.getAttribute( name ).array.subarray( 0, vCount * itemSize ) ),
				`pooled cap ${cap.type} ${name} mismatch`
			)
		}
		const iCount = single.getIndex().count
		assert.deepEqual(
			Array.from( single.getIndex().array ),
			Array.from( batch.getIndex().array.subarray( 0, iCount ) ),
			`pooled cap ${cap.type} index mismatch`
		)

		const indexAttr = single.getIndex()
		const initialVersion = indexAttr.version
		single.setPositions( waveB )
		assert.equal( single.getIndex(), indexAttr )
		assert.equal( indexAttr.version, initialVersion )

		single.dispose()
		batch.dispose()
	}

	// 2. Single-line open Float32Array setPositions fast paths with updateBounding=true and needsProgress=true.
	for ( const updateBounding of [false, true] ) {
		for ( const extra of [
			{ needsProgress: false, needsUV: false, needsEndpointMetadata: false },
			{ needsProgress: true, needsUV: false, needsEndpointMetadata: false },
			{ needsProgress: true, needsUV: true, needsEndpointMetadata: false },
			{ needsProgress: true, needsUV: true, needsEndpointMetadata: true },
		] ) {
			const g = new MeshLineGeometry( { lines: waveA.slice(), dynamic: true, lineWidth: 0.4, ...extra } )
			g.setPositions( waveB.slice(), updateBounding )
			const ref = new MeshLineGeometry( { lines: waveB.slice(), dynamic: true, lineWidth: 0.4, ...extra } )
			for ( const attrName of ['position', 'previous', 'next', 'progress', 'uv', 'endpoint'] ) {
				const a = g.getAttribute( attrName )
				const b = ref.getAttribute( attrName )
				assert.equal( Boolean( a ), Boolean( b ) )
				if ( b ) {
					for ( let i = 0; i < b.array.length; i++ ) {
						assert.ok( Math.abs( a.array[i] - b.array[i] ) <= 1e-6 )
					}
				}
			}
			if ( updateBounding ) {
				assert.deepEqual( g.boundingBoxes.map( boxToArray ), ref.boundingBoxes.map( boxToArray ) )
			}
			g.dispose()
			ref.dispose()
		}
	}

	// 3. writeValidPositionsQuadRange accepts valid sub-micron steps (> 0) and rejects Infinity.
	const microPtsA = new Float32Array( [0, 0, 0, 1e-7, 0, 0, 2e-7, 0, 0] )
	const microPtsB = new Float32Array( [0, 0, 0, 1.5e-7, 0, 0, 3e-7, 0, 0] )
	const microGeo = new MeshLineGeometry( { lines: microPtsA, dynamic: true, needsProgress: false } )
	microGeo.setPositions( microPtsB, false )
	assert.equal( microGeo.getAttribute( 'position' ).count, 12 )
	assert.equal( microGeo._lines[0], microPtsB )

	const infPts = new Float32Array( [0, 0, 0, Infinity, 0, 0, 1, 0, 0] )
	microGeo.setPositions( infPts, false )
	assert.equal( drawnVertexCount( microGeo ), 8 )
	microGeo.dispose()
} )

test( 'direct stream variable surface topology and aliased fallback match batch topology', () => {
	// 1. Open bevel path that starts with a turn at pointIndex=1 (entering emitDirectStreamVariableLine)
	// and then has a collinear interior join at pointIndex=2 (triggering materializeDirectStreamFallback
	// and emitDirectAliasedVariableLine).
	const mixedBevelPts = new Float32Array( [
		0, 0, 0,
		2, 0, 0,
		4, 0, 1,
		6, 0, 2,
		8, 0, 1,
	] )
	const fillerPts = new Float32Array( [0, 0, 0, 1, 0, 0, 2, 0, 0.5] )
	const singleMixedBevel = new MeshLineSurfaceGeometry( {
		lines: mixedBevelPts,
		lineWidth: 0.2,
		join: { type: 'bevel' },
		cap: { type: 'butt' },
	} )
	const batchMixedBevel = new MeshLineSurfaceGeometry( {
		lines: [mixedBevelPts, fillerPts],
		lineWidth: 0.2,
		join: { type: 'bevel' },
		cap: { type: 'butt' },
	} )
	assert.equal( singleMixedBevel._surfaceLines[0].topology.directUnaliased, true )
	assert.equal( singleMixedBevel._surfaceLines[0].topology.hasAliases, true )
	const vCount1 = singleMixedBevel.getAttribute( 'position' ).count
	const iCount1 = singleMixedBevel.getIndex().count
	assert.deepEqual(
		Array.from( singleMixedBevel.getAttribute( 'position' ).array ),
		Array.from( batchMixedBevel.getAttribute( 'position' ).array.subarray( 0, vCount1 * 3 ) )
	)
	assert.deepEqual(
		Array.from( singleMixedBevel.getAttribute( 'normal' ).array ),
		Array.from( batchMixedBevel.getAttribute( 'normal' ).array.subarray( 0, vCount1 * 3 ) )
	)
	assert.deepEqual(
		Array.from( singleMixedBevel.getIndex().array ),
		Array.from( batchMixedBevel.getIndex().array.subarray( 0, iCount1 ) )
	)
	singleMixedBevel.dispose()
	batchMixedBevel.dispose()

	// 2. Open miter path mixing within-limit aliased miters and over-limit bevels.
	const mixedMiterPts = new Float32Array( [
		0, 0, 0,
		4, 0, 0,
		8, 0, 0.5,
		4, 0, 0.8,
		8, 0, 1.5,
	] )
	const singleMixedMiter = new MeshLineSurfaceGeometry( {
		lines: mixedMiterPts,
		lineWidth: 0.2,
		join: { type: 'miter', limit: 2 },
		cap: { type: 'butt' },
	} )
	const batchMixedMiter = new MeshLineSurfaceGeometry( {
		lines: [mixedMiterPts, fillerPts],
		lineWidth: 0.2,
		join: { type: 'miter', limit: 2 },
		cap: { type: 'butt' },
	} )
	assert.equal( singleMixedMiter._surfaceLines[0].topology.directUnaliased, true )
	assert.equal( singleMixedMiter._surfaceLines[0].topology.hasAliases, true )
	const vCount2 = singleMixedMiter.getAttribute( 'position' ).count
	const iCount2 = singleMixedMiter.getIndex().count
	assert.deepEqual(
		Array.from( singleMixedMiter.getAttribute( 'position' ).array ),
		Array.from( batchMixedMiter.getAttribute( 'position' ).array.subarray( 0, vCount2 * 3 ) )
	)
	assert.deepEqual(
		Array.from( singleMixedMiter.getAttribute( 'normal' ).array ),
		Array.from( batchMixedMiter.getAttribute( 'normal' ).array.subarray( 0, vCount2 * 3 ) )
	)
	assert.deepEqual(
		Array.from( singleMixedMiter.getIndex().array ),
		Array.from( batchMixedMiter.getIndex().array.subarray( 0, iCount2 ) )
	)
	singleMixedMiter.dispose()
	batchMixedMiter.dispose()

	// 3. Closed loop with mixed aliased/unaliased joins exercises Uint8Array topoAliases + remapBaseAndExtraIndices.
	const closedMixedPts = new Float32Array( [
		0, 0, 0,
		2, 0, 0,
		4, 0, 0,
		4, 0, 2,
		0, 0, 2,
	] )
	const singleClosed = new MeshLineSurfaceGeometry( {
		lines: closedMixedPts,
		closed: true,
		lineWidth: 0.2,
		join: { type: 'bevel' },
		needsUV: true,
	} )
	const batchClosed = new MeshLineSurfaceGeometry( {
		lines: [closedMixedPts, fillerPts],
		closed: [true, false],
		lineWidth: 0.2,
		join: { type: 'bevel' },
		needsUV: true,
	} )
	const vCount3 = singleClosed.getAttribute( 'position' ).count
	const iCount3 = singleClosed.getIndex().count
	assert.deepEqual(
		Array.from( singleClosed.getAttribute( 'position' ).array ),
		Array.from( batchClosed.getAttribute( 'position' ).array.subarray( 0, vCount3 * 3 ) )
	)
	assert.deepEqual(
		Array.from( singleClosed.getIndex().array ),
		Array.from( batchClosed.getIndex().array.subarray( 0, iCount3 ) )
	)
	singleClosed.dispose()
	batchClosed.dispose()
} )

test( 'cold-start surface construction, unbuilt frustum intersection, and async warmup/stepAsync paths', async () => {
	// 1. Constructing a surface line directly allocates MeshLineSurfaceGeometry + MeshLineSurfaceNodeMaterial
	// and syncs transparency/instances before build().
	const offOriginPoints = new Float32Array( [
		50, 0, -10,
		52, 1, -10,
		54, 0, -10,
	] )
	const unbuiltSurface = new MeshLine( {
		surface: true,
		lines: offOriginPoints,
		opacity: 0.5,
	} )
	assert.equal( unbuiltSurface._built, false )
	assert.equal( unbuiltSurface.geometry.isMeshLineSurfaceGeometry, true )
	assert.equal( unbuiltSurface.material.isMeshLineSurfaceNodeMaterial, true )
	assert.equal( unbuiltSurface.material.transparent, true )
	assert.equal( unbuiltSurface.material.depthWrite, false )

	const unbuiltBillboard = new MeshLine( { lines: offOriginPoints } )
		.antialias( true )
		.instances( 8 )
	assert.equal( unbuiltBillboard._built, false )
	assert.equal( unbuiltBillboard.material.transparent, true )
	assert.equal( unbuiltBillboard.material.depthWrite, false )
	assert.equal( unbuiltBillboard.count, 8 )

	// 2. Three.js Frustum.intersectsObject() queries geometry.computeBoundingSphere() before onBeforeRender;
	// an unbuilt off-origin MeshLine must auto-build so compileAsync() and render() do not falsely cull it.
	const camera = new PerspectiveCamera( 60, 1, 0.1, 200 )
	camera.position.set( 52, 0, 0 )
	camera.lookAt( 52, 0, -10 )
	camera.updateMatrixWorld( true )
	camera.projectionMatrixInverse.copy( camera.projectionMatrix ).invert()
	const projScreenMatrix = new Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
	const frustum = new Frustum().setFromProjectionMatrix( projScreenMatrix )

	assert.equal( frustum.intersectsObject( unbuiltSurface ), true )
	assert.equal( unbuiltSurface._built, true )
	assert.equal( frustum.intersectsObject( unbuiltBillboard ), true )
	assert.equal( unbuiltBillboard._built, true )

	// 3. MeshLine.warmupAsync, MeshLineCompute.stepAsync, MeshLinePicker.warmupAsync, and
	// MeshLineCullingSystem compileAsync/warmupAsync warm up pipelines and INDEX|STORAGE buffers.
	const compiledTargets = []
	const computedBatches = []
	const updatedAttributes = []
	const mockRenderer = {
		isWebGPURenderer: true,
		_initialized: false,
		backend: { isWebGPUBackend: true, device: {} },
		_compilationPromises: null,
		_attributes: {
			update( attr, type ) {
				updatedAttributes.push( { attr, type } )
			},
		},
		async init() {
			this._initialized = true
		},
		async compileAsync( target, cam, targetScene = null ) {
			if ( !this._initialized ) await this.init()
			this._compilationPromises = []
			try {
				target.traverse?.( obj => {
					if ( typeof obj.onBeforeRender === 'function' ) {
						obj.onBeforeRender( this, targetScene ?? target, cam, obj.geometry, obj.material, null )
					}
					if ( typeof obj.onAfterRender === 'function' ) {
						obj.onAfterRender( this, targetScene ?? target, cam, obj.geometry, obj.material, null )
					}
				} )
				compiledTargets.push( { target, cam, targetScene } )
			} finally {
				this._compilationPromises = null
			}
		},
		async computeAsync( nodes ) {
			computedBatches.push( nodes )
		},
		compute( nodes ) {
			computedBatches.push( nodes )
		},
	}

	const scene = new Scene()
	scene.add( unbuiltBillboard )
	await unbuiltBillboard.warmupAsync( mockRenderer, camera )
	assert.equal( mockRenderer._initialized, true )
	assert.equal( compiledTargets.length, 1 )
	assert.equal( compiledTargets[0].target, unbuiltBillboard )
	assert.equal( compiledTargets[0].targetScene, scene )

	const computeLine = new MeshLineCompute( { curveCount: 8, pointsPerCurve: 16 } )
	const stepped = await computeLine.stepAsync( mockRenderer, 1 / 60 )
	assert.equal( stepped, true )
	assert.equal( computedBatches.length, 1 )
	assert.equal( Array.isArray( computedBatches[0] ), true )
	assert.equal( computedBatches[0].length, 2 )

	const picker = new MeshLinePicker( mockRenderer, scene, camera )
	picker.add( unbuiltBillboard )
	await picker.warmupAsync()
	assert.equal( compiledTargets.length, 2 )
	assert.equal( compiledTargets[1].target, picker.debugScene )

	const cullWave = createWave( 300, 1.0, 40 )
	const cullLine = new MeshLine( { lines: cullWave, lineWidth: 0.2 } ).build()
	scene.add( cullLine )
	const culling = new MeshLineCullingSystem( mockRenderer, scene, {
		minIndices: 0,
		minChunks: 0,
		autoUpdate: false,
	} )
	const handle = culling.add( cullLine, { chunkSize: 16 } )
	assert.equal( handle.warmedUp, false )

	// Simulated compileAsync runs _beforeRender and _afterRender while _compilationPromises is active;
	// the handle must warm up outputAttribute (type 2 = INDEX) and indirectAttribute (type 4 = INDIRECT).
	await culling.warmupAsync( camera )
	assert.equal( handle.warmedUp, true )
	assert.equal( updatedAttributes.some( u => u.attr === handle._resources.outputAttribute && u.type === 2 ), true )
	assert.equal( updatedAttributes.some( u => u.attr === handle._resources.indirectAttribute && u.type === 4 ), true )

	// Frame 1 update can now immediately dispatch compute culling without an unculled warm-up draw frame.
	const cullUpdated = await culling.update( camera )
	assert.equal( cullUpdated, true )
	assert.equal( handle.active, true )

	// Async compute update dispatches via renderer.computeAsync when camera changes.
	camera.position.set( 1, 2, 10 )
	camera.updateMatrixWorld()
	const batchesBeforeAsyncUpdate = computedBatches.length
	const asyncCullUpdated = await culling.updateAsync( camera )
	assert.equal( asyncCullUpdated, true )
	assert.equal( computedBatches.length, batchesBeforeAsyncUpdate + 1 )

	// MeshLineCompute.warmupAsync warms up render pipeline and optionally steps compute pipeline.
	const computeWarmTargets = compiledTargets.length
	const computeWarmBatches = computedBatches.length
	await computeLine.warmupAsync( mockRenderer, camera, scene, { step: true } )
	assert.equal( compiledTargets.length, computeWarmTargets + 1 )
	assert.equal( computedBatches.length, computeWarmBatches + 1 )

	// MeshLinePickerHelper strips visual fragment options, avoids redundant setJoin on cold rebuild,
	// shares helper colorNodes, and supports warmupAsync().
	const decoratedLine = new MeshLine( {
		lines: createWave( 16, 1.0, 0 ),
		lineWidth: 0.25,
		gradientColor: 0xff00ff,
		dashCount: 8,
		dashRatio: 0.5,
		antialias: true,
		join: { type: 'round', limit: 3 },
	} ).build()
	picker.add( decoratedLine )

	let setJoinCalls = 0
	const origSetJoin = MeshLineNodeMaterial.prototype.setJoin
	MeshLineNodeMaterial.prototype.setJoin = function ( ...args ) {
		setJoinCalls++
		return origSetJoin.apply( this, args )
	}
	let helper
	try {
		helper = new MeshLinePickerHelper( picker, { opacity: 0.5 } )
	} finally {
		MeshLineNodeMaterial.prototype.setJoin = origSetJoin
	}
	assert.equal( setJoinCalls, 0, 'MeshLinePickerHelper cold-start rebuild must not call setJoin redundantly' )
	assert.equal( helper._proxies.length, 2 )
	const helperMat = helper._proxies[1].material
	assert.equal( helperMat.gradient, null )
	assert.equal( helperMat.dashCount, null )
	assert.equal( helperMat.antialias, false )
	assert.equal( helperMat._needsProgress, false )

	const helperWarmTargets = compiledTargets.length
	await helper.warmupAsync( mockRenderer, camera, scene )
	assert.equal( compiledTargets.length, helperWarmTargets + 1 )
	assert.equal( compiledTargets[compiledTargets.length - 1].target, helper )

	// MeshLineNodeMaterial reuses core uniform nodes across in-place rebuilds.
	const mat = new MeshLineNodeMaterial( { lineWidth: 0.5, color: 0xff0000, renderWidth: 800, renderHeight: 600 } )
	const resUniform = mat.resolution
	const widthUniform = mat.lineWidth
	const colorUniform = mat.color
	const dprUniform = mat.dpr
	const miterUniform = mat._miterThreshold
	assert.equal( resUniform.value.x, 800 )
	assert.equal( resUniform.value.y, 600 )
	mat.buildLine( { lineWidth: 1.25, color: 0x00ff00, renderWidth: 1920, renderHeight: 1080, miterLimit: 6 } )
	assert.equal( mat.resolution, resUniform )
	assert.equal( mat.lineWidth, widthUniform )
	assert.equal( mat.color, colorUniform )
	assert.equal( mat.dpr, dprUniform )
	assert.equal( mat._miterThreshold, miterUniform )
	assert.equal( mat.resolution.value.x, 1920 )
	assert.equal( mat.resolution.value.y, 1080 )
	assert.equal( mat.lineWidth.value, 1.25 )
	mat.dispose()

	helper.dispose()
	decoratedLine.dispose()
	culling.dispose()
	picker.dispose()
	computeLine.dispose()
	cullLine.dispose()
	unbuiltSurface.dispose()
	unbuiltBillboard.dispose()
} )

test( 'single-pass fused setPositions() matches fresh builds across all derived-attribute profiles and rolls back cleanly on mid-line widthCallback or NaN failure', () => {
	const initial = createWave( 5000, 1.0, 1 )
	const updated = createWave( 5000, 1.25, 2 )

	const profiles = [
		{ name: 'default', opts: { needsProgress: false, needsUV: false, needsWidth: false, needsEndPoint: false } },
		{ name: 'progressUv', opts: { needsProgress: true, needsUV: true, needsWidth: false, needsEndPoint: false } },
		{ name: 'endpointMetadata', opts: { needsProgress: true, needsUV: false, needsWidth: false, needsEndPoint: true, endpointMetadata: true } },
		{ name: 'widthCallback', opts: { needsProgress: true, needsUV: false, needsWidth: true, needsEndPoint: false, widthCallback: ( p, i ) => 0.4 + p * 0.9 + ( i & 1 ) * 0.1 } },
	]

	for ( const { name, opts } of profiles ) {
		for ( const updateBounding of [false, true] ) {
			const live = new MeshLineGeometry( { lines: initial.slice(), dynamic: true, ...opts } )
			live.setPositions( updated.slice(), updateBounding )

			const fresh = new MeshLineGeometry( { lines: updated.slice(), dynamic: true, ...opts } )
			if ( updateBounding ) {
				fresh.computeBoundingBoxes()
				fresh.computeBoundingSphere( true )
			}

			for ( const attrName of ['position', 'previous', 'next', 'progress', 'uv', 'width', 'endpoint'] ) {
				const a = live.getAttribute( attrName )
				const b = fresh.getAttribute( attrName )
				assert.equal( Boolean( a ), Boolean( b ), `${name} (${updateBounding}) attribute ${attrName} presence` )
				if ( a && b ) {
					assert.deepEqual( Array.from( a.array ), Array.from( b.array ), `${name} (${updateBounding}) attribute ${attrName} mismatch` )
				}
			}

			if ( updateBounding ) {
				assert.deepEqual( live.boundingBox.min.toArray(), fresh.boundingBox.min.toArray(), `${name} bbox min` )
				assert.deepEqual( live.boundingBox.max.toArray(), fresh.boundingBox.max.toArray(), `${name} bbox max` )
				assert.equal( live.boundingSphere.radius, fresh.boundingSphere.radius, `${name} bsphere radius` )
			}

			live.dispose()
			fresh.dispose()
		}
	}

	// Verify mid-line widthCallback exception rolls back position, previous, next, progress, and width attributes
	let failAt = -1
	const rollbackGeo = new MeshLineGeometry( {
		lines: initial.slice( 0, 96 ),
		dynamic: true,
		needsProgress: true,
		needsWidth: true,
		widthCallback: ( p, i ) => {
			if ( i === failAt ) return Number.NaN
			return 0.5 + p * 1.5 + ( i & 1 ) * 0.2
		},
	} )
	const savedPos = rollbackGeo.getAttribute( 'position' ).array.slice()
	const savedPrev = rollbackGeo.getAttribute( 'previous' ).array.slice()
	const savedNext = rollbackGeo.getAttribute( 'next' ).array.slice()
	const savedProg = rollbackGeo.getAttribute( 'progress' ).array.slice()
	const savedWidth = rollbackGeo.getAttribute( 'width' ).array.slice()

	failAt = 15
	assert.throws(
		() => rollbackGeo.setPositions( updated.slice( 0, 96 ), true ),
		/widthCallback returned a non-finite value/
	)
	assert.deepEqual( Array.from( rollbackGeo.getAttribute( 'position' ).array ), Array.from( savedPos ) )
	assert.deepEqual( Array.from( rollbackGeo.getAttribute( 'previous' ).array ), Array.from( savedPrev ) )
	assert.deepEqual( Array.from( rollbackGeo.getAttribute( 'next' ).array ), Array.from( savedNext ) )
	assert.deepEqual( Array.from( rollbackGeo.getAttribute( 'progress' ).array ), Array.from( savedProg ) )
	assert.deepEqual( Array.from( rollbackGeo.getAttribute( 'width' ).array ), Array.from( savedWidth ) )

	// Verify late NaN point in setPositions() rolls back in-place write and falls back to compacted rebuild
	failAt = -1
	const nanPts = updated.slice( 0, 96 )
	nanPts[20 * 3 + 1] = Number.NaN
	rollbackGeo.setPositions( nanPts, true )
	assert.equal( drawnVertexCount( rollbackGeo ), 31 * 4 )
	rollbackGeo.dispose()
} )

test( 'single-pass register-streaming surface builders and multi-line open Float32Array setPositions fast path match reference builds and fall back cleanly', () => {
	// 1. Single-pass open surface builders (miter-butt, miter-round8, miter-square, bevel-butt, round8-butt, sharp160-miter2)
	// across transport and fixed-up frames and distance UVs match 2-line batch builds on both initial build and setPositions().
	const waveA = createWave( 32, 0.08, 0 )
	const waveB = createWave( 32, 0.11, 0.7 )
	const sharpA = new Float32Array( 16 * 3 )
	const sharpB = new Float32Array( 16 * 3 )
	const sharpTurn = 160 * Math.PI / 180
	let headingA = 0
	let headingB = 0.15
	for ( let i = 1; i < 16; i++ ) {
		if ( i > 1 ) {
			headingA += i % 2 === 0 ? -sharpTurn : sharpTurn
			headingB += i % 2 === 0 ? -sharpTurn : sharpTurn
		}
		sharpA[i * 3] = sharpA[( i - 1 ) * 3] + Math.cos( headingA ) * 20
		sharpA[i * 3 + 2] = sharpA[( i - 1 ) * 3 + 2] + Math.sin( headingA ) * 20
		sharpB[i * 3] = sharpB[( i - 1 ) * 3] + Math.cos( headingB ) * 20
		sharpB[i * 3 + 2] = sharpB[( i - 1 ) * 3 + 2] + Math.sin( headingB ) * 20
	}
	const dummyLine = new Float32Array( [0, 25, 0, 2, 25, 0, 4, 25.5, 0] )

	const surfaceCases = [
		{ name: 'miter-butt-transport', pts0: waveA, pts1: waveB, opts: { lineWidth: 0.1, surface: { frame: 'transport' }, join: { type: 'miter', limit: 4 }, cap: { type: 'butt' } } },
		{ name: 'miter-butt-fixed-up-uv', pts0: waveA, pts1: waveB, opts: { lineWidth: 0.1, needsUV: true, surface: { frame: 'fixed-up', up: [0, 1, 0], uvMode: 'distance', uvScale: 2 }, join: { type: 'miter', limit: 4 }, cap: { type: 'butt' } } },
		{ name: 'miter-round8-uv', pts0: waveA, pts1: waveB, opts: { lineWidth: 0.1, needsUV: true, surface: { frame: 'transport', uvMode: 'distance', uvScale: 1.5 }, join: { type: 'miter', limit: 4 }, cap: { type: 'round', segments: 8 } } },
		{ name: 'miter-square-fixed-up', pts0: waveA, pts1: waveB, opts: { lineWidth: 0.1, surface: { frame: 'fixed-up', up: [0, 1, 0] }, join: { type: 'miter', limit: 4 }, cap: { type: 'square' } } },
		{ name: 'bevel-butt-transport', pts0: waveA, pts1: waveB, opts: { lineWidth: 0.1, surface: { frame: 'transport' }, join: { type: 'bevel', limit: 4 }, cap: { type: 'butt' } } },
		{ name: 'round8-butt-fixed-up', pts0: waveA, pts1: waveB, opts: { lineWidth: 0.1, surface: { frame: 'fixed-up', up: [0, 1, 0] }, join: { type: 'round', limit: 4, segments: 8 }, cap: { type: 'butt' } } },
		{ name: 'sharp160-miter2', pts0: sharpA, pts1: sharpB, opts: { lineWidth: 2, surface: { frame: 'transport' }, join: { type: 'miter', limit: 2 }, cap: { type: 'butt' } } },
	]

	for ( const { name, pts0, pts1, opts } of surfaceCases ) {
		const single = new MeshLineSurfaceGeometry( { lines: pts0.slice(), dynamic: true, ...opts } )
		const batch0 = new MeshLineSurfaceGeometry( { lines: [pts0.slice(), dummyLine], dynamic: true, ...opts } )
		const vCount = single.getAttribute( 'position' ).count
		const iCount = single.getIndex().count

		for ( const attrName of ['position', 'normal', 'uv'] ) {
			const sAttr = single.getAttribute( attrName )
			const bAttr = batch0.getAttribute( attrName )
			assert.equal( Boolean( sAttr ), Boolean( bAttr ), `${name} initial ${attrName} presence` )
			if ( sAttr && bAttr ) {
				assert.deepEqual(
					Array.from( sAttr.array ),
					Array.from( bAttr.array.subarray( 0, vCount * sAttr.itemSize ) ),
					`${name} initial ${attrName} mismatch`
				)
			}
		}
		assert.deepEqual(
			Array.from( single.getIndex().array ),
			Array.from( batch0.getIndex().array.subarray( 0, iCount ) ),
			`${name} initial index mismatch`
		)

		single.setPositions( pts1.slice() )
		const batch1 = new MeshLineSurfaceGeometry( { lines: [pts1.slice(), dummyLine], dynamic: true, ...opts } )
		for ( const attrName of ['position', 'normal', 'uv'] ) {
			const sAttr = single.getAttribute( attrName )
			const bAttr = batch1.getAttribute( attrName )
			if ( sAttr && bAttr ) {
				assert.deepEqual(
					Array.from( sAttr.array ),
					Array.from( bAttr.array.subarray( 0, vCount * sAttr.itemSize ) ),
					`${name} updated ${attrName} mismatch`
				)
			}
		}
		assert.deepEqual(
			Array.from( single.getIndex().array ),
			Array.from( batch1.getIndex().array.subarray( 0, iCount ) ),
			`${name} updated index mismatch`
		)

		single.dispose()
		batch0.dispose()
		batch1.dispose()
	}

	// Verify single-pass builder falls back cleanly on a path with a sharp turn / clipped inner footprint
	const cuspPts = new Float32Array( [0, 0, 0, 2, 0, 0, 4, 0, 0.2, 2, 0, 0.2, 0, 0, 0.2] )
	const singleCusp = new MeshLineSurfaceGeometry( { lines: cuspPts, lineWidth: 0.4, join: { type: 'bevel', inner: 'clip' } } )
	const batchCusp = new MeshLineSurfaceGeometry( { lines: [cuspPts, dummyLine], lineWidth: 0.4, join: { type: 'bevel', inner: 'clip' } } )
	const cuspVCount = singleCusp.getAttribute( 'position' ).count
	assert.deepEqual(
		Array.from( singleCusp.getAttribute( 'position' ).array ),
		Array.from( batchCusp.getAttribute( 'position' ).array.subarray( 0, cuspVCount * 3 ) )
	)
	singleCusp.dispose()
	batchCusp.dispose()

	// 2. Multi-line open Float32Array setPositions( batch, updateBounding ) fast path matches setLines( batch )
	// and rolls back cleanly if a later line has duplicate consecutive points or non-finite values.
	const batchA = Array.from( { length: 8 }, ( _, idx ) => createWave( 24, 1.0, idx * 0.4 ) )
	const batchB = Array.from( { length: 8 }, ( _, idx ) => createWave( 24, 1.35, idx * 0.4 + 0.9 ) )

	for ( const updateBounding of [false, true] ) {
		const multiFast = new MeshLineGeometry( {
			lines: batchA.map( a => a.slice() ),
			dynamic: true,
			needsProgress: false,
			lineWidth: 0.35,
			miterLimit: 3,
		} )
		multiFast.setPositions( batchB.map( a => a.slice() ), updateBounding )

		const multiRef = new MeshLineGeometry( {
			lines: batchB.map( a => a.slice() ),
			dynamic: true,
			needsProgress: false,
			lineWidth: 0.35,
			miterLimit: 3,
		} )
		if ( updateBounding ) {
			multiRef.computeBoundingBoxes()
			multiRef.computeBoundingSphere( true )
		}

		for ( const attrName of ['position', 'previous', 'next'] ) {
			assert.deepEqual(
				Array.from( multiFast.getAttribute( attrName ).array ),
				Array.from( multiRef.getAttribute( attrName ).array ),
				`multi-line setPositions (${updateBounding}) ${attrName} mismatch`
			)
		}
		if ( updateBounding ) {
			assert.deepEqual( multiFast.boundingBoxes.map( boxToArray ), multiRef.boundingBoxes.map( boxToArray ) )
			assert.deepEqual( boxToArray( multiFast.boundingBox ), boxToArray( multiRef.boundingBox ) )
			assert.equal( multiFast.boundingSphere.radius, multiRef.boundingSphere.radius )
		}

		// Verify padding-only refresh after lineWidth / miterLimit changes matches fresh computeBoundingBoxes()
		multiFast.options.lineWidth = 0.8
		multiFast.options.miterLimit = 5
		multiFast.computeBoundingBoxes()
		multiRef.options.lineWidth = 0.8
		multiRef.options.miterLimit = 5
		multiRef._lineBoundsValid = false
		multiRef.computeBoundingBoxes()
		assert.deepEqual( multiFast.boundingBoxes.map( boxToArray ), multiRef.boundingBoxes.map( boxToArray ) )
		assert.deepEqual( boxToArray( multiFast.boundingBox ), boxToArray( multiRef.boundingBox ) )

		multiFast.dispose()
		multiRef.dispose()
	}

	// Verify mid-batch invalid line (duplicate consecutive point in line 5) rolls back lines 0..4 and compacts via setLines()
	const multiRollback = new MeshLineGeometry( {
		lines: batchA.map( a => a.slice() ),
		dynamic: true,
		needsProgress: false,
	} )
	const batchWithDup = batchB.map( a => a.slice() )
	batchWithDup[5][6] = batchWithDup[5][3]
	batchWithDup[5][7] = batchWithDup[5][4]
	batchWithDup[5][8] = batchWithDup[5][5]
	multiRollback.setPositions( batchWithDup, true )

	const multiDupRef = new MeshLineGeometry( {
		lines: batchWithDup.map( a => a.slice() ),
		dynamic: true,
		needsProgress: false,
	} )
	multiDupRef.computeBoundingBoxes()
	for ( const attrName of ['position', 'previous', 'next'] ) {
		assert.deepEqual(
			drawnArray( multiRollback, attrName ),
			Array.from( multiDupRef.getAttribute( attrName ).array ),
			`multi-line fallback ${attrName} mismatch`
		)
	}
	assert.deepEqual( multiRollback.boundingBoxes.map( boxToArray ), multiDupRef.boundingBoxes.map( boxToArray ) )
	multiRollback.dispose()
	multiDupRef.dispose()
} )

test( 'Round 5 shader and math optimizations eliminate redundant sqrts, normalizations, and trig calls', async () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0] )

		// 1. Default geometry fold mode reuses `sinHalfTurn` in `foldBlend` (only 2 explicit `sqrt(` calls:
		// `sinHalfTurn` and `splitWeight.sqrt()`).
		const defaultLine = new MeshLine( { lines: points } ).build()
		const defaultGraph = buildShaderGraph( renderer, defaultLine )
		assert.match( defaultGraph.vertexShader, /\bsinHalfTurn\b/ )
		assert.doesNotMatch( defaultGraph.vertexShader, /\btanHalfTurn\b/ )
		assert.equal( ( defaultGraph.vertexShader.match( /\bsqrt\(/g ) || [] ).length, 2 )
		defaultLine.dispose()

		// 2. Round joins (`authored = 0`) omit the 3D `turnCos3` calculation and its two `inverseSqrt` calls.
		const roundLine = new MeshLine( { lines: points, join: { type: 'round' } } ).build()
		const roundGraph = buildShaderGraph( renderer, roundLine )
		assert.equal( ( roundGraph.vertexShader.match( /\binverse[Ss]qrt\(/g ) || [] ).length, 0 )
		roundLine.dispose()

		// 3. Shadow-receiving lines construct unit tube normals directly without `.normalize()` or `length(`,
		// and `castShadowPositionNode` blends directions in 2D (`vec2`).
		renderer.shadowMap.enabled = true
		const shadowLine = new MeshLine( {
			lines: points,
			fragmentColorFn: Fn( ( [color] ) => shadowLine.material.setupNormal().add( color.xyz ) ),
		} ).shadow( true, true ).build()
		const shadowGraph = buildShaderGraph( renderer, shadowLine )
		assert.match( shadowGraph.fragmentShader, /\binverse[Ss]qrt\(/ )
		assert.doesNotMatch( shadowGraph.fragmentShader, /\bnormalize\s*\(/ )
		assert.doesNotMatch( shadowGraph.fragmentShader, /\blength\s*\(\s*vShadowTube/ )
		assert.match( shadowGraph.vertexShader, /\bvShadowTube\b/ )
		shadowLine.dispose()
	}

	// 4. MeshLineGPUPath round join and round cap branches evaluate `meshLineGPUPathRotate2D` once per branch
	// (1 function definition + 4 call sites: join-reversal round cap, round join, start round cap, end round cap,
	// down from 1 definition + 8 call sites).
	const wgslRenderer = createRenderer( false )
	const stubRenderer = {
		isWebGPURenderer: true,
		backend: { isWebGPUBackend: true, device: {} },
		async init() {},
		async computeAsync() {},
		getSize( target ) {
			return target.set( 800, 600 )
		},
	}
	const gpuRoundPath = new MeshLineGPUPath( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0] ),
		lineWidth: 0.4,
		join: { type: 'round', segments: 6 },
		cap: { type: 'round', segments: 6 },
	} )
	assert.equal( await gpuRoundPath.prepare( stubRenderer, new PerspectiveCamera() ), true )
	const gpuRoundGraph = buildShaderGraph( wgslRenderer, gpuRoundPath.gpuMesh )
	assert.equal( ( gpuRoundGraph.vertexShader.match( /\bmeshLineGPUPathRotate2D\s*\(/g ) || [] ).length, 5 )
	gpuRoundPath.dispose()

	// 5. CPU dyadic chunk error and importance oracles defer `Math.sqrt` out of the inner point loop.
	const wave = createWave( 65, 1.5, 0 )
	const chunks = _gpuPathInternals.createChunkPlan( 65, 32 )
	const originalSqrt = Math.sqrt
	let sqrtCalls = 0
	Math.sqrt = value => {
		sqrtCalls++
		return originalSqrt( value )
	}
	try {
		const { errors, levelCount } = _gpuPathInternals.computeDyadicChunkErrors( wave, chunks )
		assert.equal( levelCount, 6 )
		assert.equal( errors.length, chunks.length * levelCount )
		// Exactly 1 `Math.sqrt` per `(chunk, level > 0)` instead of per `(chunk, level, point)`.
		assert.equal( sqrtCalls, chunks.length * ( levelCount - 1 ) )

		sqrtCalls = 0
		const importance = _gpuPathInternals.computeDyadicImportance( wave, chunks )
		assert.equal( importance.length, 65 )
		// Exactly 1 `Math.sqrt` per interior chunk point (`31 * 2 = 62`).
		assert.equal( sqrtCalls, 62 )
	} finally {
		Math.sqrt = originalSqrt
	}
} )

test( 'Round 6 shader and math optimizations eliminate redundant fragment divisions and cap/join trig calls', () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0] )

		// 1. `exactFoldCoverageFn` performs zero divisions for `beyondStart`/`beyondEnd` tests and only
		// 2 divisions in the entire fragment shader (`1.0 / vFoldFrame.z` and the single active-end
		// `vFoldEnds / weight` inside `If( beyondStart.or( beyondEnd ) )`, down from 3 divisions).
		const exactLine = new MeshLine( { lines: points, join: { type: 'miter', fold: 'exact' } } ).build()
		const exactGraph = buildShaderGraph( renderer, exactLine )
		assert.equal( ( exactGraph.fragmentShader.match( /\s\/\s/g ) || [] ).length, 2 )
		exactLine.dispose()

		// 2. Default geometry fold mode scales `this._miterThreshold` by `FOLD_SMOOTH_LIMIT * 0.5` (`0.625`)
		// inside the single-division `threshold` formula.
		const geomLine = new MeshLine( { lines: points } ).build()
		const geomGraph = buildShaderGraph( renderer, geomLine )
		assert.match( geomGraph.vertexShader, /0\.625/ )
		geomLine.dispose()
	}

	// 3. `MeshLineSurfaceGeometry` round joins use a 2D rotation recurrence (1 `Math.cos`/`Math.sin` per join
	// instead of per fan segment) and round caps reuse cached half-turn trig tables (0 `Math.cos`/`Math.sin`
	// after table warm-up).
	const capWarmup = new MeshLineSurfaceGeometry( {
		lines: new Float32Array( [0, 0, 0, 2, 0, 0] ),
		lineWidth: 1,
		cap: { type: 'round', segments: 12 },
	} )
	capWarmup.dispose()

	const originalCos = Math.cos
	const originalSin = Math.sin
	let cosCalls = 0
	let sinCalls = 0
	Math.cos = value => {
		cosCalls++
		return originalCos( value )
	}
	Math.sin = value => {
		sinCalls++
		return originalSin( value )
	}
	try {
		const cappedSurface = new MeshLineSurfaceGeometry( {
			lines: new Float32Array( [0, 0, 0, 2, 0, 0, 4, 0, 0] ),
			lineWidth: 1,
			cap: { type: 'round', segments: 12 },
			needsUV: true,
			needsSide: true,
		} )
		// Zero trig calls for cached 12-segment round caps on both ends.
		assert.equal( cosCalls, 0 )
		assert.equal( sinCalls, 0 )
		cappedSurface.dispose()

		const roundSurface = new MeshLineSurfaceGeometry( {
			lines: new Float32Array( [0, 0, 0, 2, 0, 0, 2, 0, 2, 4, 0, 2] ),
			lineWidth: 1,
			join: { type: 'round', segments: 12 },
			cap: { type: 'round', segments: 12 },
		} )
		// 1 `Math.cos(PI / 12)` in `computeJoinInfos` + 1 `(cos, sin)` step pair per round join (2 joins),
		// and 0 trig calls for the two 12-segment round caps.
		assert.equal( cosCalls, 3 )
		assert.equal( sinCalls, 2 )
		roundSurface.dispose()
	} finally {
		Math.cos = originalCos
		Math.sin = originalSin
	}
} )

