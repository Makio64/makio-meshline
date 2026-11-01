import assert from 'node:assert/strict'
import test from 'node:test'

import { Fn, uint, uniform, vec3 } from 'three/tsl'
import { Box3, NodeMaterial, PerspectiveCamera, Ray, Raycaster, Scene, StorageBufferAttribute, Vector3 } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLineCompute from '../src/MeshLineCompute.js'
import MeshLineGeometry from '../src/MeshLineGeometry.js'
import MeshLineGPUPath, { _gpuPathInternals } from '../src/MeshLineGPUPath.js'
import { lineCoord } from '../src/MeshLineNodeMaterial.js'
import MeshLinePicker from '../src/MeshLinePicker.js'
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
	assert.match( shadowGraph.vertexShader, /\[\s*0u?\s*\]\.xyz \* vec3<f32>\( nodeVar9\.x \)/ )
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
	assert.equal( fastGeo.getAttribute( 'position' ).count, ( count - 1 ) * 4 )
	for ( const attrName of ['position', 'previous', 'next'] ) {
		assert.deepEqual(
			Array.from( fastGeo.getAttribute( attrName ).array ),
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
	assert.equal( fastGeo.getAttribute( 'position' ).count, ( count - 1 ) * 4 )
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
	assert.equal( microGeo.getAttribute( 'position' ).count, 8 )
	microGeo.dispose()
} )




