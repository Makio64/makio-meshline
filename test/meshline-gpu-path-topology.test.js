import assert from 'node:assert/strict'
import test from 'node:test'

import { PerspectiveCamera, Vector4, WebGPUCoordinateSystem } from 'three/webgpu'

import MeshLineGPUPath, { _gpuPathInternals } from '../src/MeshLineGPUPath.js'

const {
	normalizeTopologyOptions,
	getTopologyLayout,
	createGPUResourcePlan,
	assertGPUResourcePlan,
	createChunkPlan,
	findReversalBreaks,
	clipHomogeneousSegment,
	computeInnerJoinOffset,
	resolveProjectedJoin,
	validateInnerJoinSupport,
	createStableSegmentRecords,
	createProceduralPrimitiveRecords,
} = _gpuPathInternals

const SCREEN_PATH = new Float32Array( [
	-8.2, 3.15, 5.8,
	-5.4, 4.35, 5.8,
	-2.7, 2.95, 5.8,
	0, 4.45, 5.8,
	2.7, 2.95, 5.8,
	5.4, 4.35, 5.8,
	8.2, 3.15, 5.8,
] )

const closeTo = ( actual, expected, epsilon = 1e-12 ) => {
	assert.ok(
		Math.abs( actual - expected ) <= epsilon,
		`expected ${actual} to be within ${epsilon} of ${expected}`
	)
}

const projectScreenPathJoin = ( theta, reversed = false, join = 3 ) => {
	const aspect = 1847 / 1304
	const phi = 1.155
	const radius = 24
	const camera = new PerspectiveCamera( 55, aspect, 0.1, 180 )
	camera.coordinateSystem = WebGPUCoordinateSystem
	camera.position.set(
		radius * Math.sin( phi ) * Math.cos( theta ),
		radius * Math.cos( phi ),
		radius * Math.sin( phi ) * Math.sin( theta )
	)
	camera.lookAt( 0, 0.5, -1.3 )
	camera.updateMatrixWorld()
	camera.updateProjectionMatrix()

	const pointCount = SCREEN_PATH.length / 3
	const matrix = camera.projectionMatrix.clone().multiply( camera.matrixWorldInverse )
	const clip = []
	const projected = []
	for ( let point = 0; point < pointCount; point++ ) {
		const sourcePoint = reversed ? pointCount - point - 1 : point
		const offset = sourcePoint * 3
		const position = new Vector4(
			SCREEN_PATH[offset],
			SCREEN_PATH[offset + 1],
			SCREEN_PATH[offset + 2],
			1
		).applyMatrix4( matrix )
		clip.push( position.toArray() )
		projected.push( [position.x / position.w * aspect, position.y / position.w] )
	}

	const incomingDelta = [
		projected[join][0] - projected[join - 1][0],
		projected[join][1] - projected[join - 1][1],
	]
	const outgoingDelta = [
		projected[join + 1][0] - projected[join][0],
		projected[join + 1][1] - projected[join][1],
	]
	const projectedHalfWidth = 0.22 * camera.projectionMatrix.elements[5] / clip[join][3]

	return { clip, join, incomingDelta, outgoingDelta, projectedHalfWidth }
}

const assertFullWidthBodyFallback = ( resolved, fixture ) => {
	closeTo( Math.hypot( ...resolved.incomingBodyInnerOffset ), fixture.projectedHalfWidth )
	closeTo( Math.hypot( ...resolved.outgoingBodyInnerOffset ), fixture.projectedHalfWidth )
	const incomingDirection = fixture.incomingDelta.map( value => value / resolved.incomingLength )
	const outgoingDirection = fixture.outgoingDelta.map( value => value / resolved.outgoingLength )
	closeTo(
		resolved.incomingBodyInnerOffset[0] * -incomingDirection[1] +
		resolved.incomingBodyInnerOffset[1] * incomingDirection[0],
		resolved.side * fixture.projectedHalfWidth
	)
	closeTo(
		resolved.outgoingBodyInnerOffset[0] * -outgoingDirection[1] +
		resolved.outgoingBodyInnerOffset[1] * outgoingDirection[0],
		resolved.side * fixture.projectedHalfWidth
	)
	assert.notDeepEqual( resolved.incomingBodyInnerOffset, resolved.pivotOffset )
	assert.notDeepEqual( resolved.outgoingBodyInnerOffset, resolved.pivotOffset )
}

const createRendererStub = ( limits = null ) => ( {
	isWebGPURenderer: true,
	backend: { isWebGPUBackend: true, device: limits ? { limits } : {} },
	computeCalls: [],
	async init() {},
	async computeAsync( nodes ) {
		this.computeCalls.push( nodes )
	},
	getSize( target ) {
		return target.set( 800, 600 )
	},
} )

test( 'resource planning budgets packed 8-byte primitives and rejects oversized storage before native allocation', async () => {
	const topology = normalizeTopologyOptions( {
		join: { type: 'miter', segments: 8 },
		cap: { type: 'round', segments: 64 },
	} )
	const topologyLayout = getTopologyLayout( topology )
	const packedPlan = createGPUResourcePlan( {
		pointCount: 200_000,
		segmentCount: 199_999,
		chunkCount: 1_563,
		levelCount: 8,
		runCount: 1,
		simplify: false,
		advancedTopology: true,
		topologyLayout,
	} )
	assert.equal( packedPlan.primitiveCapacity, 13_199_998 )
	assert.equal( packedPlan.storageBytes.primitives, 105_599_984 )
	assert.ok( packedPlan.storageBytes.primitives < 128 * 1024 * 1024 )
	assert.doesNotThrow( () => assertGPUResourcePlan( packedPlan, { limits: {
		maxStorageBufferBindingSize: 128 * 1024 * 1024,
		maxBufferSize: 256 * 1024 * 1024,
	} } ) )

	const oversizedPlan = createGPUResourcePlan( {
		pointCount: 300_000,
		segmentCount: 299_999,
		chunkCount: 2_344,
		levelCount: 8,
		runCount: 1,
		simplify: false,
		advancedTopology: true,
		topologyLayout,
	} )
	assert.equal( oversizedPlan.storageBytes.primitives, 158_399_984 )
	assert.throws(
		() => assertGPUResourcePlan( oversizedPlan, { limits: {
			maxStorageBufferBindingSize: 128 * 1024 * 1024,
			maxBufferSize: 256 * 1024 * 1024,
		} } ),
		/primitive.*exceeding.*134217728/i
	)

	const points = new Float32Array( 100 * 3 )
	for ( let point = 0; point < 100; point++ ) points[point * 3] = point
	const path = new MeshLineGPUPath( {
		lines: points,
		join: { type: 'miter' },
		cap: { type: 'round', segments: 8 },
	} )
	assert.equal( await path.prepare( createRendererStub( {
		maxStorageBufferBindingSize: 2_000,
		maxBufferSize: 4_000,
	} ), new PerspectiveCamera() ), false )
	assert.match( path.status.lastError?.message ?? '', /primitive.*exceeding.*2000/i )
	assert.equal( path.gpuMesh, null )
	assert.equal( path._resources, null )
	path.dispose()
} )

test( 'resource products reject unsafe integer capacities', () => {
	const topologyLayout = getTopologyLayout( normalizeTopologyOptions( {
		join: { type: 'round', segments: 64 },
		cap: { type: 'round', segments: 64 },
	} ) )
	assert.throws( () => createGPUResourcePlan( {
		pointCount: Number.MAX_SAFE_INTEGER,
		segmentCount: Number.MAX_SAFE_INTEGER - 1,
		chunkCount: 1,
		levelCount: 1,
		runCount: 1,
		simplify: false,
		advancedTopology: true,
		topologyLayout,
	} ), /safe integer capacity/ )
} )

test( 'topology options normalize aliases and keep the default fast layout', () => {
	const defaults = normalizeTopologyOptions()
	assert.deepEqual( defaults, {
		join: { type: 'miter', limit: 4, segments: 8 },
		cap: { type: 'butt', segments: 8 },
	} )
	assert.deepEqual( getTopologyLayout( defaults ), {
		joinPrimitives: 1,
		joinCapacity: 1,
		capPrimitives: 0,
		advanced: false,
		maximumPrimitivesPerSegment: 3,
	} )
	const round = normalizeTopologyOptions( {
		join: { type: 'simple', limit: 3, segments: 5 },
		cap: { type: 'round', segments: 7 },
	} )
	assert.equal( round.join.type, 'miter' )
	assert.equal( round.cap.type, 'round' )
	assert.equal( getTopologyLayout( round ).joinCapacity, 7 )
	assert.equal( getTopologyLayout( defaults, true ).advanced, true )
} )

test( 'shared inner intersections stay exact when the independent outer miter bevels', () => {
	const left = computeInnerJoinOffset( [1, 0], [0, 1], 2 )
	assert.equal( left.fallback, false )
	assert.equal( left.side, 1 )
	assert.ok( Math.abs( left.offset[0] + 2 ) < 1e-12 )
	assert.ok( Math.abs( left.offset[1] - 2 ) < 1e-12 )

	const right = computeInnerJoinOffset( [1, 0], [0, -1], 2 )
	assert.equal( right.fallback, false )
	assert.equal( right.side, -1 )
	assert.ok( Math.abs( right.offset[0] + 2 ) < 1e-12 )
	assert.ok( Math.abs( right.offset[1] + 2 ) < 1e-12 )

	const angle = 160 * Math.PI / 180
	const outgoing = [Math.cos( angle ), Math.sin( angle )]
	const sharp = computeInnerJoinOffset( [1, 0], outgoing, 1 )
	const expectedX = -Math.tan( 80 * Math.PI / 180 )
	assert.equal( sharp.fallback, false )
	assert.equal( sharp.side, 1 )
	assert.ok( Math.abs( sharp.offset[0] - expectedX ) < 1e-12 )
	assert.ok( Math.abs( sharp.offset[1] - 1 ) < 1e-12 )
	assert.ok( Math.hypot( ...sharp.offset ) > 4, 'the exact inner intersection exceeds a conventional outer miter limit' )
	const incomingNormal = [0, 1]
	const outgoingNormal = [-outgoing[1], outgoing[0]]
	assert.ok( Math.abs( sharp.offset[0] * incomingNormal[0] + sharp.offset[1] * incomingNormal[1] - 1 ) < 1e-12 )
	assert.ok( Math.abs( sharp.offset[0] * outgoingNormal[0] + sharp.offset[1] * outgoingNormal[1] - 1 ) < 1e-12 )

	const qIncoming = Math.abs( sharp.offset[0] )
	const qOutgoing = Math.abs(
		( sharp.offset[0] - outgoingNormal[0] ) * outgoing[0] +
		( sharp.offset[1] - outgoingNormal[1] ) * outgoing[1]
	)
	assert.ok( validateInnerJoinSupport(
		new Float64Array( [10, 10] ),
		new Float64Array( [0, qOutgoing] ),
		new Float64Array( [qIncoming, 0] ),
		new Int8Array( [0, 1] ),
		new Int8Array( [1, 0] )
	).safe, 'long incident legs contain the exact sharp inner trim without tapering' )

	const hairpin = computeInnerJoinOffset( [1, 0], [-0.999999, 0.001], 2 )
	assert.equal( hairpin.fallback, true )
	assert.deepEqual( hairpin.offset, [0, 0] )
} )

test( 'projected join resolution bounds the join pivot without tapering unsupported bodies', () => {
	const angle = 160 * Math.PI / 180
	const direction = [Math.cos( angle ), Math.sin( angle )]
	const expectedOffset = [-Math.tan( 80 * Math.PI / 180 ), 1]
	const supported = resolveProjectedJoin( [10, 0], [direction[0] * 10, direction[1] * 10], 1 )

	assert.equal( supported.fallback, 'exact' )
	assert.equal( supported.supported, true )
	closeTo( supported.incomingLength, 10 )
	closeTo( supported.outgoingLength, 10 )
	closeTo( supported.offset[0], expectedOffset[0] )
	closeTo( supported.offset[1], expectedOffset[1] )
	assert.deepEqual( supported.pivotOffset, supported.exactOffset )
	assert.deepEqual( supported.incomingBodyInnerOffset, supported.exactOffset )
	assert.deepEqual( supported.outgoingBodyInnerOffset, supported.exactOffset )
	assert.ok( supported.incomingDemand < supported.incomingLength )
	assert.ok( supported.outgoingDemand < supported.outgoingLength )

	const unsupported = resolveProjectedJoin( [1, 0], direction, 1 )
	assert.equal( unsupported.fallback, 'center' )
	assert.equal( unsupported.supported, false )
	assert.deepEqual( Array.from( unsupported.offset ), [0, 0] )
	assert.deepEqual( Array.from( unsupported.pivotOffset ), [0, 0] )
	assertFullWidthBodyFallback( unsupported, {
		incomingDelta: [1, 0],
		outgoingDelta: direction,
		projectedHalfWidth: 1,
	} )
	assert.ok( unsupported.incomingDemand > unsupported.incomingLength )
	assert.ok( unsupported.outgoingDemand > unsupported.outgoingLength )
	closeTo( unsupported.incomingDemand, supported.incomingDemand )
	closeTo( unsupported.outgoingDemand, supported.outgoingDemand )

	const anisotropicProjection = resolveProjectedJoin(
		[10, 0],
		[direction[0] * 10, direction[1] * 10],
		2
	)
	assert.equal( anisotropicProjection.fallback, 'center' )
	assert.ok( anisotropicProjection.demand > anisotropicProjection.available )
	assertFullWidthBodyFallback( anisotropicProjection, {
		incomingDelta: [10, 0],
		outgoingDelta: [direction[0] * 10, direction[1] * 10],
		projectedHalfWidth: 2,
	} )

	const reversal = resolveProjectedJoin( [1, 0], [-1, 0], 1 )
	assert.equal( reversal.fallback, 'reversal' )
	assert.equal( reversal.supported, false )
	assert.deepEqual( Array.from( reversal.offset ), [0, 0] )
	assert.equal( reversal.incomingBodyInnerOffset, null )
	assert.equal( reversal.outgoingBodyInnerOffset, null )

	const degenerate = resolveProjectedJoin( [0, 0], [1, 0], 1 )
	assert.equal( degenerate.fallback, 'degenerate' )
	assert.equal( degenerate.supported, false )
	assert.deepEqual( Array.from( degenerate.offset ), [0, 0] )
} )

test( 'the variable-topology demo cusp keeps every projected join finite and full-width through the reversal transition', () => {
	const cameraCases = [
		{ theta: 0.271 - 2e-6, fallback: 'reversal' },
		{ theta: 0.271, fallback: 'center' },
		{ theta: 0.271 + 2e-6, fallback: 'center' },
	]
	const pointCount = SCREEN_PATH.length / 3

	for ( const reversed of [false, true] ) {
		const observedCentralFallbacks = []
		for ( const cameraCase of cameraCases ) {
			for ( let join = 1; join < pointCount - 1; join++ ) {
				const fixture = projectScreenPathJoin( cameraCase.theta, reversed, join )
				for ( const point of fixture.clip.slice( join - 1, join + 2 ) ) {
					assert.ok( point.every( Number.isFinite ) )
					assert.ok( point[3] > 0 )
				}
				for ( const segment of [[join - 1, join], [join, join + 1]] ) {
					const clipped = clipHomogeneousSegment(
						fixture.clip[segment[0]],
						fixture.clip[segment[1]]
					)
					assert.equal( clipped.visible, true )
					assert.deepEqual( clipped.range, [0, 1] )
				}

				const resolved = resolveProjectedJoin(
					fixture.incomingDelta,
					fixture.outgoingDelta,
					fixture.projectedHalfWidth
				)
				assert.equal( resolved.supported, false )
				assert.deepEqual( Array.from( resolved.pivotOffset ), [0, 0] )
				assert.ok( resolved.incomingLength > 1e-7 )
				assert.ok( resolved.outgoingLength > 1e-7 )

				if ( resolved.fallback === 'center' ) {
					assert.ok(
						resolved.incomingDemand > resolved.incomingLength * ( 1 - 1e-6 ) ||
						resolved.outgoingDemand > resolved.outgoingLength * ( 1 - 1e-6 )
					)
					assertFullWidthBodyFallback( resolved, fixture )
				} else {
					assert.equal( resolved.fallback, 'reversal' )
					assert.equal( resolved.incomingBodyInnerOffset, null )
					assert.equal( resolved.outgoingBodyInnerOffset, null )
				}

				if ( join === 3 ) {
					observedCentralFallbacks.push( resolved.fallback )
					assert.equal( resolved.fallback, cameraCase.fallback )
					if ( cameraCase.theta === 0.271 ) {
						const exact = computeInnerJoinOffset(
							fixture.incomingDelta,
							fixture.outgoingDelta,
							fixture.projectedHalfWidth
						)
						assert.equal( exact.fallback, false )
						assert.ok(
							Math.hypot( ...exact.offset ) > fixture.projectedHalfWidth * 100,
							'the fixture must retain the formerly unbounded inner intersection'
						)
					}
				}
			}
		}
		assert.deepEqual( observedCentralFallbacks, ['reversal', 'center', 'center'] )
	}
} )

test( 'finite support budgeting is per strip side', () => {
	const lengths = new Float64Array( [1] )
	const demands = new Float64Array( [0.6] )
	assert.equal( validateInnerJoinSupport(
		lengths,
		demands,
		demands,
		new Int8Array( [1] ),
		new Int8Array( [1] )
	).safe, false, 'same-side turns consume the sum of both trims' )
	assert.equal( validateInnerJoinSupport(
		lengths,
		demands,
		demands,
		new Int8Array( [-1] ),
		new Int8Array( [1] )
	).safe, true, 'opposite-side S turns consume only the larger trim on either side' )
} )

test( 'source reversals become mandatory independent run boundaries', () => {
	const points = new Float32Array( [
		0, 0, 0,
		1, 0, 0,
		0, 0, 0,
		0, 1, 0,
	] )
	const breaks = findReversalBreaks( points )
	assert.deepEqual( Array.from( breaks ), [0, 1, 0, 0] )
	const records = createStableSegmentRecords( 4, createChunkPlan( 4, 2 ), null, null, breaks )
	assert.deepEqual( Array.from( records ), [
		0, 0, 1, 1,
		1, 1, 2, 3,
		1, 2, 3, 3,
	] )
	assert.equal( records[3], records[2], 'incoming run ends at the reversal' )
	assert.equal( records[4], records[5], 'outgoing run starts at the reversal' )
} )

test( 'compact primitive records contain bodies, actual joins, and only run-end caps', () => {
	const records = new Uint32Array( [
		0, 0, 1, 1,
		1, 1, 2, 3,
		1, 2, 3, 3,
	] )
	const primitives = createProceduralPrimitiveRecords( records, {
		join: { type: 'round', segments: 3 },
		cap: { type: 'round', segments: 2 },
	} )
	assert.equal( primitives.length / 2, 17 )
	assert.equal( primitives.byteLength, 17 * 8 )
	const decoded = []
	for ( let offset = 0; offset < primitives.length; offset += 2 ) {
		decoded.push( {
			type: primitives[offset] & 15,
			slot: primitives[offset] >>> 4,
			segment: primitives[offset + 1],
		} )
	}
	assert.equal( decoded.filter( record => record.type === 0 || record.type === 1 ).length, 6 )
	assert.equal( decoded.filter( record => record.type === 2 ).length, 3 )
	assert.equal( decoded.filter( record => record.type === 3 ).length, 4 )
	assert.equal( decoded.filter( record => record.type === 4 ).length, 4 )
	assert.deepEqual( decoded.filter( record => record.type === 2 ).map( record => record.slot ), [0, 1, 2] )
} )

test( 'round-cap fallback capacity is attached to joins without cap records at ordinary points', () => {
	const records = new Uint32Array( [
		0, 0, 1, 2,
		0, 1, 2, 3,
		1, 2, 3, 3,
	] )
	const primitives = createProceduralPrimitiveRecords( records, {
		join: { type: 'bevel', segments: 1 },
		cap: { type: 'round', segments: 3 },
	} )
	const types = []
	for ( let offset = 0; offset < primitives.length; offset += 2 ) types.push( primitives[offset] & 15 )
	assert.equal( types.filter( type => type === 2 ).length, 6, 'three projected-reversal fallback slots per ordinary join' )
	assert.equal( types.filter( type => type === 3 ).length, 3, 'only the first run endpoint has start caps' )
	assert.equal( types.filter( type => type === 4 ).length, 3, 'only the last run endpoint has end caps' )
} )

test( 'homogeneous clipping is scale invariant, padded in XY, and rejects point contact', () => {
	const start = [-2, 0, 0.5, 1]
	const end = [0, 0, 0.5, 1]
	const exact = clipHomogeneousSegment( start, end )
	const padded = clipHomogeneousSegment( start, end, { padScaleX: 0.1 } )
	assert.equal( exact.visible, true )
	assert.ok( Math.abs( exact.range[0] - 0.5 ) < 1e-12 )
	assert.ok( Math.abs( padded.range[0] - 0.45 ) < 1e-12 )

	const scale = 1e-9
	const scaled = clipHomogeneousSegment( start.map( value => value * scale ), end.map( value => value * scale ) )
	assert.ok( Math.abs( scaled.range[0] - exact.range[0] ) < 1e-12 )
	assert.equal( clipHomogeneousSegment( [-2, 0, 0.5, 1], [-1, 0, 0.5, 1] ).visible, false )
	assert.equal( clipHomogeneousSegment( [0, 0, -2, 1], [0, 0, -1, 1] ).visible, false )
} )

test( 'advanced raw topology is compact and forces full detail when simplification was requested', async () => {
	const renderer = createRendererStub()
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [
			0, 0, 0,
			1, 0, 0,
			1, 1, 0,
			2, 1, 0,
		] ),
		join: { type: 'round', segments: 4 },
		cap: { type: 'round', segments: 3 },
	}, {
		simplify: { localTolerance: 100 },
	} )

	assert.equal( await path.prepare( renderer, new PerspectiveCamera() ), true )
	assert.equal( renderer.computeCalls.length, 0 )
	assert.equal( path.status.segmentRecords, 'storage' )
	assert.equal( path.status.primitiveRecords, 'compact-storage' )
	assert.equal( path.status.simplification, 'disabled-for-variable-topology' )
	assert.equal( path.status.topologySafety, 'projected-join-guarded' )
	assert.match( path.status.topologySafetyReason, /full-width bodies.*bounded center pivot/ )
	assert.equal( path._resources.segmentAttribute.count, 3 )
	assert.equal( path._resources.segmentAttribute.itemSize, 4 )
	assert.equal( path._resources.segmentAttribute.array.byteLength, 3 * 16 )
	assert.equal( path._resources.primitiveAttribute.count, 20 )
	assert.equal( path._resources.primitiveAttribute.itemSize, 2 )
	assert.equal( path._resources.primitiveAttribute.array.byteLength, 20 * 8 )
	assert.equal( path.gpuMesh.geometry.getIndirect().array[0], 60 )
	path.dispose()
} )

test( 'variableTopology opts miter+butt into true compact joins without changing the default fast path', async () => {
	const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] )
	const renderer = createRendererStub()
	const fast = new MeshLineGPUPath( { lines: points } )
	assert.equal( await fast.prepare( renderer, new PerspectiveCamera() ), true )
	assert.equal( fast.status.topology, 'fixed-strip' )
	assert.equal( fast.status.topologySafety, 'not-required' )
	assert.equal( fast._resources.segmentAttribute, null )
	assert.equal( fast._resources.primitiveAttribute, null )
	assert.equal( renderer.computeCalls.length, 0 )
	fast.dispose()

	const variable = new MeshLineGPUPath( { lines: points }, { variableTopology: true } )
	assert.equal( await variable.prepare( renderer, new PerspectiveCamera() ), true )
	assert.equal( variable.status.topology, 'variable-triangles' )
	assert.equal( variable.status.primitiveRecords, 'compact-storage' )
	assert.equal( variable._resources.segmentAttribute.count, 2 )
	assert.equal( variable._resources.primitiveAttribute.count, 5 )
	assert.equal( variable._resources.primitiveAttribute.itemSize, 2 )
	assert.equal( variable._resources.primitiveAttribute.array.byteLength, 5 * 8 )
	assert.equal( renderer.computeCalls.length, 0 )
	variable.dispose()
} )

test( 'excessive fan budgets fail open instead of compiling unbounded shaders', async () => {
	const path = new MeshLineGPUPath( {
		lines: new Float32Array( [0, 0, 0, 1, 0, 0] ),
		join: { type: 'round', segments: 65 },
	} )
	assert.equal( await path.prepare( createRendererStub(), new PerspectiveCamera() ), false )
	assert.match( path.status.reason, /limit of 64/ )
	assert.equal( path.fallback.visible, true )
	path.dispose()
} )

test( 'one-segment round caps are rejected while one-segment round joins remain valid', async () => {
	const points = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] )
	assert.throws(
		() => new MeshLineGPUPath( { lines: points, cap: { type: 'round', segments: 1 } } ),
		/round caps require.*at least 2/i
	)
	const join = new MeshLineGPUPath( {
		lines: points,
		join: { type: 'round', segments: 1 },
	} )
	assert.equal( await join.prepare( createRendererStub(), new PerspectiveCamera() ), true )
	assert.equal( join.status.join, 'round' )
	assert.equal( join._resources.primitiveAttribute.count, 5 )
	join.dispose()
} )
