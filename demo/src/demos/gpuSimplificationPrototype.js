import { MeshLine } from 'makio-meshline'
import {
	abs,
	bool,
	clamp,
	color,
	cross,
	dot,
	float,
	Fn,
	If,
	instanceIndex,
	invocationLocalIndex,
	length,
	max,
	min,
	mix,
	storage,
	uint,
	uniform,
	vec3,
	vec4,
	vertexIndex,
	workgroupArray,
	workgroupBarrier,
	workgroupId,
} from 'three/tsl'
import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	IndirectStorageBufferAttribute,
	Matrix4,
	Mesh,
	MeshBasicNodeMaterial,
	StorageBufferAttribute,
	Vector2,
} from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const POINT_COUNT = 262_144
const WORKGROUP_SIZE = 256
const BLOCK_COUNT = Math.ceil( POINT_COUNT / WORKGROUP_SIZE )
const BLOCKS_PER_PREFIX_LANE = Math.ceil( BLOCK_COUNT / WORKGROUP_SIZE )
const PROCEDURAL_VERTEX_CAPACITY = ( POINT_COUNT - 1 ) * 6
const CANDIDATE_STRIDE = 8
const MAX_POINT_GAP = 256
const ERROR_RADIUS = 512
const HALF_WIDTH = 0.34
const MITER_LIMIT = 4
const EPSILON = 1e-6
const MAX_LOD_REBUILDS_PER_SECOND = 15
const LOD_REBUILD_INTERVAL_MS = 1000 / MAX_LOD_REBUILDS_PER_SECOND

const finiteQueryNumber = ( query, key, fallback, minimum, maximum ) => {
	if ( !query.has( key ) ) return fallback
	const value = Number( query.get( key ) )
	return Number.isFinite( value ) ? Math.min( maximum, Math.max( minimum, value ) ) : fallback
}

const createPathData = () => {
	// Deliberately mixes long calm spans and locally dense curvature. The adaptive
	// pass should spend vertices on the turns while collapsing the quiet regions.
	const points = new Float32Array( POINT_COUNT * 4 )

	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const progress = i / ( POINT_COUNT - 1 )
		const centered = progress * 2 - 1
		const detailEnvelope = Math.exp( -centered * centered * 12 )
		const angle = progress * Math.PI * 28
		const offset = i * 4

		points[offset] = centered * 75
		points[offset + 1] = Math.sin( angle * 0.31 ) * 1.4 + Math.sin( angle * 2.7 ) * detailEnvelope * 0.9
		points[offset + 2] = Math.sin( angle ) * ( 2.2 + detailEnvelope * 5.5 ) + Math.sin( angle * 4.1 ) * detailEnvelope * 0.55
		points[offset + 3] = 1
	}

	return points
}

const toCpuPath = source => {
	const points = new Float32Array( POINT_COUNT * 3 )
	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const sourceOffset = i * 4
		const targetOffset = i * 3
		points[targetOffset] = source[sourceOffset]
		points[targetOffset + 1] = source[sourceOffset + 1]
		points[targetOffset + 2] = source[sourceOffset + 2]
	}
	return points
}

const declaredGpuBytes = () => (
	POINT_COUNT * 4 * Float32Array.BYTES_PER_ELEMENT +
	POINT_COUNT * 2 * Uint32Array.BYTES_PER_ELEMENT +
	BLOCK_COUNT * 2 * Uint32Array.BYTES_PER_ELEMENT +
	( 1 + 4 ) * Uint32Array.BYTES_PER_ELEMENT
)

class GpuSimplificationPrototypeExample {
	constructor() {
		this.text = 'GPU LOD heuristic · sampled local error + bounded gaps · stable indirect draw'
		this.mesh = null
		this.fallbackLine = null
		this.geometry = null
		this.material = null
		this.control = null
		this.sourceData = null
		this.storageAttributes = []
		this.computeNodes = []
		this.retainedCountAttribute = null
		this.projectionViewNode = null
		this.viewportNode = null
		this.metrics = null
		this.simplify = true
		this.animateCamera = false
		this.readback = false
		this._projectionView = new Matrix4()
		this._lastProjectionView = new Matrix4().set( 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 )
		this._lastProjection = new Matrix4().set( 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 )
		this._viewport = new Vector2()
		this._lastViewport = new Vector2( -1, -1 )
		this._lastLodRebuildTime = -Infinity
		this._updating = false
	}

	async init() {
		const query = new URLSearchParams( window.location.search )
		this.simplify = query.get( 'simplify' ) !== '0'
		this.animateCamera = query.get( 'animate' ) === '1'
		this.readback = query.get( 'readback' ) === '1'
		const pixelError = finiteQueryNumber( query, 'pixelError', 1.35, 0.05, 32 )
		const worldError = finiteQueryNumber( query, 'worldError', 0.075, 0.0001, 10 )
		this.sourceData = createPathData()

		this.metrics = {
			backend: 'initializing',
			animatedCamera: this.animateCamera,
			bufferBytes: 0,
			candidateStride: CANDIDATE_STRIDE,
			cameraCacheHits: 0,
			computeSubmissions: 0,
			dispatchCount: 0,
			dispatchesPerRebuild: 3,
			errorRadius: ERROR_RADIUS,
			error: null,
			fallback: null,
			maxPointGap: MAX_POINT_GAP,
			maxLodRebuildsPerSecond: MAX_LOD_REBUILDS_PER_SECOND,
			pixelError,
			ready: false,
			readbackError: null,
			readbackPerformed: false,
			readbackRequested: this.readback,
			rebuildCount: 0,
			retainedPointCount: this.simplify ? null : POINT_COUNT,
			retainedPointCountSource: this.simplify ? 'GPU-resident indirect state (no CPU readback)' : 'known full-detail baseline',
			simplify: this.simplify,
			sourceBytes: this.sourceData.byteLength,
			sourcePointCount: POINT_COUNT,
			sourceUploads: 0,
			stableOrder: true,
			toleranceGuaranteed: false,
			criterion: 'bounded-gap sampled local deviation heuristic',
			identityTransformOnly: true,
			proceduralVertexCapacity: PROCEDURAL_VERTEX_CAPACITY,
			worldError,
		}
		window.__meshLineGpuSimplificationMetrics = this.metrics

		try {
			await stage3d.initRender( { background: 0x050913 } )
			const nativeWebGPU = stage3d.renderer?.backend?.isWebGPUBackend === true
			this.metrics.backend = nativeWebGPU ? 'webgpu' : 'webgl2'

			this.control = new OrbitControl( stage3d.camera, 31 )
			this.control.minRadius = 8
			this.control.maxRadius = 85
			this.control._phi = 1.01
			this.control._theta = 0.52
			this.control.update()
			this.control.enabled = !this.animateCamera
			stage3d.control = this.control

			stage3d.camera.near = 0.1
			stage3d.camera.far = 220
			stage3d.camera.updateProjectionMatrix()

			if ( !nativeWebGPU ) {
				this._activateCpuFallback( 'Native WebGPU is unavailable; drawing the full-detail CPU MeshLine.' )
				return
			}

			this._createGpuPipeline( pixelError, worldError )
			this._updateCameraUniforms( true )
			await this._dispatchAsync()
			if ( this.readback ) await this._readRetainedCount()
			stage3d.add( this.mesh )
			stage.onUpdate.add( this.update )
			this.metrics.ready = true
		} catch ( error ) {
			this._activateCpuFallback( 'GPU simplification failed; drawing the full-detail CPU MeshLine.', error )
		}
	}

	_createGpuPipeline( pixelError, worldError ) {
		const sourceAttribute = new StorageBufferAttribute( this.sourceData, 4 )
		const rankAttribute = new StorageBufferAttribute( POINT_COUNT, 1, Uint32Array )
		const compactedAttribute = new StorageBufferAttribute( POINT_COUNT, 1, Uint32Array )
		const blockCountAttribute = new StorageBufferAttribute( BLOCK_COUNT, 1, Uint32Array )
		const blockOffsetAttribute = new StorageBufferAttribute( BLOCK_COUNT, 1, Uint32Array )
		const retainedCountAttribute = new StorageBufferAttribute( 1, 1, Uint32Array )
		const drawIndirectAttribute = new IndirectStorageBufferAttribute( new Uint32Array( [0, 1, 0, 0] ), 1 )
		this.retainedCountAttribute = retainedCountAttribute
		this.storageAttributes = [
			sourceAttribute,
			rankAttribute,
			compactedAttribute,
			blockCountAttribute,
			blockOffsetAttribute,
			retainedCountAttribute,
			drawIndirectAttribute,
		]
		this.metrics.sourceUploads = 1
		this.metrics.bufferBytes = declaredGpuBytes()

		const source = storage( sourceAttribute, 'vec4', POINT_COUNT ).toReadOnly()
		const localRanks = storage( rankAttribute, 'uint', POINT_COUNT )
		const compactedIndices = storage( compactedAttribute, 'uint', POINT_COUNT )
		const blockCounts = storage( blockCountAttribute, 'uint', BLOCK_COUNT )
		const blockOffsets = storage( blockOffsetAttribute, 'uint', BLOCK_COUNT )
		const retainedCount = storage( retainedCountAttribute, 'uint', 1 )
		const drawIndirect = storage( drawIndirectAttribute, 'uint', 4 )
		const scanShared = workgroupArray( 'uint', WORKGROUP_SIZE )
		const blockScanShared = workgroupArray( 'uint', WORKGROUP_SIZE )
		this.projectionViewNode = uniform( new Matrix4() )
		this.viewportNode = uniform( new Vector2( 1, 1 ) )
		const pixelErrorNode = uniform( pixelError )
		const worldErrorNode = uniform( worldError )

		const projectToPixel = Fn( ( [point] ) => {
			const clip = this.projectionViewNode.mul( vec4( point, 1 ) ).toVar()
			const safeW = max( abs( clip.w ), EPSILON )
			return vec3( clip.xy.div( safeW ).mul( this.viewportNode.mul( 0.5 ) ), clip.w )
		} )

		const markNode = Fn( () => {
			const pointIndex = instanceIndex.toUint()
			const localIndex = invocationLocalIndex.toUint()
			const valid = pointIndex.lessThan( uint( POINT_COUNT ) )
			const keep = uint( 0 ).toVar()

			If( valid, () => {
				if ( !this.simplify ) {
					keep.assign( uint( 1 ) )
					return
				}

				const isEndpoint = pointIndex.equal( uint( 0 ) ).or( pointIndex.equal( uint( POINT_COUNT - 1 ) ) )
				const isCandidate = pointIndex.mod( uint( CANDIDATE_STRIDE ) ).equal( uint( 0 ) )
				const isAnchor = pointIndex.mod( uint( MAX_POINT_GAP ) ).equal( uint( 0 ) )
				const point = source.element( pointIndex ).xyz
				const pointClip = this.projectionViewNode.mul( vec4( point, 1 ) ).toVar()
				const unsafeProjection = pointClip.w.lessThanEqual( EPSILON )

				If( isEndpoint.or( isAnchor ).or( unsafeProjection ), () => {
					// Behind-camera points are retained at full density. This is intentionally
					// conservative around the near plane, where screen error is undefined.
					keep.assign( uint( 1 ) )
				} ).ElseIf( isCandidate, () => {
					const previousIndex = pointIndex.lessThan( uint( ERROR_RADIUS ) ).select(
						uint( 0 ),
						pointIndex.sub( uint( ERROR_RADIUS ) ),
					)
					const nextIndex = min( pointIndex.add( uint( ERROR_RADIUS ) ), uint( POINT_COUNT - 1 ) )
					const previous = source.element( previousIndex ).xyz
					const next = source.element( nextIndex ).xyz
					const worldChord = next.sub( previous )
					const worldT = clamp(
						dot( point.sub( previous ), worldChord ).div( max( dot( worldChord, worldChord ), EPSILON ) ),
						0,
						1,
					)
					const worldDeviation = length( point.sub( previous.add( worldChord.mul( worldT ) ) ) )
					const projectedPoint = vec3(
						pointClip.xy.div( max( abs( pointClip.w ), EPSILON ) ).mul( this.viewportNode.mul( 0.5 ) ),
						pointClip.w,
					)
					const projectedPrevious = projectToPixel( previous )
					const projectedNext = projectToPixel( next )
					const screenChord = projectedNext.xy.sub( projectedPrevious.xy )
					const screenT = clamp(
						dot( projectedPoint.xy.sub( projectedPrevious.xy ), screenChord )
							.div( max( dot( screenChord, screenChord ), EPSILON ) ),
						0,
						1,
					)
					const screenDeviation = length(
						projectedPoint.xy.sub( projectedPrevious.xy.add( screenChord.mul( screenT ) ) ),
					)
					const screenValid = projectedPrevious.z.greaterThan( EPSILON )
						.and( projectedNext.z.greaterThan( EPSILON ) )
					const exceedsError = screenValid.not()
						.or( worldDeviation.greaterThan( worldErrorNode ) )
						.or( screenDeviation.greaterThan( pixelErrorNode ) )

					keep.assign( bool( exceedsError ).select( uint( 1 ), uint( 0 ) ) )
				} )
			} )

			scanShared.element( localIndex ).assign( keep )
			workgroupBarrier()

			for ( let offset = 1; offset < WORKGROUP_SIZE; offset *= 2 ) {
				const addition = uint( 0 ).toVar()
				If( localIndex.greaterThanEqual( uint( offset ) ), () => {
					addition.assign( scanShared.element( localIndex.sub( uint( offset ) ) ) )
				} )
				workgroupBarrier()
				scanShared.element( localIndex ).addAssign( addition )
				workgroupBarrier()
			}

			If( valid, () => {
				localRanks.element( pointIndex ).assign( scanShared.element( localIndex ) )
			} )
			If( localIndex.equal( uint( WORKGROUP_SIZE - 1 ) ), () => {
				blockCounts.element( workgroupId.x ).assign( scanShared.element( localIndex ) )
			} )
		} )().compute( POINT_COUNT, [WORKGROUP_SIZE] )

		const blockPrefixNode = Fn( () => {
			const localIndex = invocationLocalIndex.toUint()
			const firstBlock = localIndex.mul( uint( BLOCKS_PER_PREFIX_LANE ) )
			const laneTotal = uint( 0 ).toVar()

			for ( let blockOffset = 0; blockOffset < BLOCKS_PER_PREFIX_LANE; blockOffset++ ) {
				const blockIndex = firstBlock.add( uint( blockOffset ) )
				If( blockIndex.lessThan( uint( BLOCK_COUNT ) ), () => {
					laneTotal.addAssign( blockCounts.element( blockIndex ) )
				} )
			}

			blockScanShared.element( localIndex ).assign( laneTotal )
			workgroupBarrier()
			for ( let offset = 1; offset < WORKGROUP_SIZE; offset *= 2 ) {
				const addition = uint( 0 ).toVar()
				If( localIndex.greaterThanEqual( uint( offset ) ), () => {
					addition.assign( blockScanShared.element( localIndex.sub( uint( offset ) ) ) )
				} )
				workgroupBarrier()
				blockScanShared.element( localIndex ).addAssign( addition )
				workgroupBarrier()
			}

			const running = uint( 0 ).toVar()
			If( localIndex.greaterThan( uint( 0 ) ), () => {
				running.assign( blockScanShared.element( localIndex.sub( uint( 1 ) ) ) )
			} )
			for ( let blockOffset = 0; blockOffset < BLOCKS_PER_PREFIX_LANE; blockOffset++ ) {
				const blockIndex = firstBlock.add( uint( blockOffset ) )
				If( blockIndex.lessThan( uint( BLOCK_COUNT ) ), () => {
					blockOffsets.element( blockIndex ).assign( running )
					running.addAssign( blockCounts.element( blockIndex ) )
				} )
			}

			If( localIndex.equal( uint( 0 ) ), () => {
				const total = blockScanShared.element( uint( WORKGROUP_SIZE - 1 ) )
				retainedCount.element( uint( 0 ) ).assign( total )
				const segmentCount = total.greaterThan( uint( 1 ) ).select( total.sub( uint( 1 ) ), uint( 0 ) )
				drawIndirect.element( uint( 0 ) ).assign( segmentCount.mul( uint( 6 ) ) )
				drawIndirect.element( uint( 1 ) ).assign( uint( 1 ) )
				drawIndirect.element( uint( 2 ) ).assign( uint( 0 ) )
				drawIndirect.element( uint( 3 ) ).assign( uint( 0 ) )
			} )
		} )().compute( WORKGROUP_SIZE, [WORKGROUP_SIZE] )

		const scatterNode = Fn( () => {
			const pointIndex = instanceIndex.toUint()
			If( pointIndex.lessThan( uint( POINT_COUNT ) ), () => {
				const localIndex = pointIndex.mod( uint( WORKGROUP_SIZE ) )
				const rank = localRanks.element( pointIndex )
				const previousRank = uint( 0 ).toVar()
				If( localIndex.greaterThan( uint( 0 ) ), () => {
					previousRank.assign( localRanks.element( pointIndex.sub( uint( 1 ) ) ) )
				} )
				If( rank.greaterThan( previousRank ), () => {
					const blockIndex = pointIndex.div( uint( WORKGROUP_SIZE ) )
					const destination = blockOffsets.element( blockIndex ).add( rank ).sub( uint( 1 ) )
					compactedIndices.element( destination ).assign( pointIndex )
				} )
			} )
		} )().compute( POINT_COUNT, [WORKGROUP_SIZE] )

		const proceduralPosition = Fn( () => {
			const count = retainedCount.element( uint( 0 ) )
			const triangleVertex = vertexIndex.toUint().mod( uint( 6 ) )
			const segmentIndex = vertexIndex.toUint().div( uint( 6 ) )
			const usesNextPoint = triangleVertex.equal( uint( 2 ) )
				.or( triangleVertex.equal( uint( 3 ) ) )
				.or( triangleVertex.equal( uint( 5 ) ) )
			const positiveSide = triangleVertex.equal( uint( 1 ) )
				.or( triangleVertex.equal( uint( 4 ) ) )
				.or( triangleVertex.equal( uint( 5 ) ) )
			const pointIndex = segmentIndex.add( usesNextPoint.select( uint( 1 ), uint( 0 ) ) )
			const previousIndex = pointIndex.equal( uint( 0 ) ).select( uint( 0 ), pointIndex.sub( uint( 1 ) ) )
			const nextIndex = pointIndex.add( uint( 1 ) ).lessThan( count ).select( pointIndex.add( uint( 1 ) ), pointIndex )
			const sourceIndex = compactedIndices.element( pointIndex )
			const previousSourceIndex = compactedIndices.element( previousIndex )
			const nextSourceIndex = compactedIndices.element( nextIndex )
			const point = source.element( sourceIndex ).xyz
			const previous = source.element( previousSourceIndex ).xyz
			const next = source.element( nextSourceIndex ).xyz
			const incomingVector = pointIndex.equal( uint( 0 ) ).select( next.sub( point ), point.sub( previous ) )
			const outgoingVector = pointIndex.add( uint( 1 ) ).equal( count ).select( point.sub( previous ), next.sub( point ) )
			const incoming = incomingVector.div( max( length( incomingVector ), EPSILON ) )
			const outgoing = outgoingVector.div( max( length( outgoingVector ), EPSILON ) )
			const fixedUp = vec3( 0, 1, 0 )
			const fallbackUp = vec3( 1, 0, 0 )
			const incomingUp = abs( incoming.y ).greaterThan( 0.999 ).select( fallbackUp, fixedUp )
			const outgoingUp = abs( outgoing.y ).greaterThan( 0.999 ).select( fallbackUp, fixedUp )
			const incomingSide = cross( incomingUp, incoming ).normalize()
			const outgoingSide = cross( outgoingUp, outgoing ).normalize()
			const miterSum = incomingSide.add( outgoingSide )
			const miterLength = length( miterSum )
			const miter = miterLength.greaterThan( EPSILON ).select(
				miterSum.div( max( miterLength, EPSILON ) ),
				outgoingSide,
			)
			const denominator = max( abs( dot( miter, outgoingSide ) ), 1 / MITER_LIMIT )
			const offset = miter.mul( float( HALF_WIDTH ).div( denominator ) )
			return positiveSide.select( point.add( offset ), point.sub( offset ) )
		} )()

		this.computeNodes = [markNode, blockPrefixNode, scatterNode]
		this.geometry = new BufferGeometry()
		// A one-vertex placeholder gives Three a finite non-indexed draw range. The
		// indirect command owns the real count and positionNode is fully procedural,
		// so no capacity-sized vertex/index buffers or INDEX warm-up are required.
		this.geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [0, 0, 0] ), 3 ) )
		this.geometry.setIndirect( drawIndirectAttribute )

		const triangleVertex = vertexIndex.toUint().mod( uint( 6 ) )
		const positiveSide = triangleVertex.equal( uint( 1 ) )
			.or( triangleVertex.equal( uint( 4 ) ) )
			.or( triangleVertex.equal( uint( 5 ) ) )
		this.material = new MeshBasicNodeMaterial( { side: DoubleSide } )
		this.material.positionNode = proceduralPosition
		this.material.colorNode = mix(
			color( 0x2563eb ),
			color( 0x22d3ee ),
			positiveSide.select( float( 1 ), float( 0 ) ),
		)
		this.mesh = new Mesh( this.geometry, this.material )
		this.mesh.frustumCulled = false
		this.mesh.matrixAutoUpdate = false
		this.mesh.matrix.identity()
		this.mesh.matrixWorld.identity()
	}

	_updateCameraUniforms( force = false ) {
		const camera = stage3d.camera
		camera.updateWorldMatrix( true, false )
		camera.matrixWorldInverse.copy( camera.matrixWorld ).invert()
		this._projectionView.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
		stage3d.renderer.getDrawingBufferSize( this._viewport )

		const matrixChanged = !this._projectionView.equals( this._lastProjectionView )
		const projectionChanged = !camera.projectionMatrix.equals( this._lastProjection )
		const viewportChanged = !this._viewport.equals( this._lastViewport )
		const changed = force || matrixChanged || viewportChanged
		if ( !changed ) return false

		const now = performance.now()
		if (
			!force &&
			!projectionChanged &&
			!viewportChanged &&
			now - this._lastLodRebuildTime < LOD_REBUILD_INTERVAL_MS
		) {
			this.metrics.cameraCacheHits++
			return false
		}

		this._lastProjectionView.copy( this._projectionView )
		this._lastProjection.copy( camera.projectionMatrix )
		this._lastViewport.copy( this._viewport )
		this._lastLodRebuildTime = now
		this.projectionViewNode.value.copy( this._projectionView )
		this.viewportNode.value.copy( this._viewport )
		return true
	}

	_dispatch() {
		const [markNode, blockPrefixNode, scatterNode] = this.computeNodes
		stage3d.renderer.compute( [markNode, blockPrefixNode, scatterNode] )
		this.metrics.computeSubmissions++
		this.metrics.dispatchCount += 3
		this.metrics.rebuildCount++
	}

	async _dispatchAsync() {
		const [markNode, blockPrefixNode, scatterNode] = this.computeNodes
		await stage3d.renderer.computeAsync( [markNode, blockPrefixNode, scatterNode] )
		this.metrics.computeSubmissions++
		this.metrics.dispatchCount += 3
		this.metrics.rebuildCount++
	}

	async _readRetainedCount() {
		try {
			const result = await stage3d.renderer.getArrayBufferAsync( this.retainedCountAttribute )
			const retained = new Uint32Array( result )[0]
			if ( !Number.isSafeInteger( retained ) || retained < 2 || retained > POINT_COUNT ) {
				throw new Error( `GPU returned an invalid retained count (${retained}).` )
			}
			this.metrics.retainedPointCount = retained
			this.metrics.retainedFraction = retained / POINT_COUNT
			this.metrics.retainedPointCountSource = 'one-time opt-in GPU readback'
			this.metrics.readbackPerformed = true
			console.info( `[gpuSimplificationPrototype] retained ${retained}/${POINT_COUNT} source points` )
		} catch ( error ) {
			this.metrics.readbackError = error instanceof Error ? error.message : String( error )
			console.warn( '[gpuSimplificationPrototype] Optional retained-count readback failed:', error )
		}
	}

	update = () => {
		if ( this.animateCamera ) {
			const angle = performance.now() * 0.00012
			stage3d.camera.position.set( Math.cos( angle ) * 42, 18, Math.sin( angle ) * 42 )
			stage3d.camera.lookAt( 0, 0, 0 )
		}
		// Full-detail selection is camera-independent. Keep the cached compact list
		// and indirect command instead of paying three no-op dispatches per camera tick.
		if ( this._updating || !this.mesh || !this.metrics?.ready || !this.simplify || !this._updateCameraUniforms() ) return
		this._updating = true
		try {
			this._dispatch()
		} catch ( error ) {
			this._activateCpuFallback( 'GPU simplification update failed; drawing the full-detail CPU MeshLine.', error )
		} finally {
			this._updating = false
		}
	}

	_activateCpuFallback( reason, error = null ) {
		stage.onUpdate.remove( this.update )
		this._disposeGpuResources()
		if ( !this.sourceData ) this.sourceData = createPathData()

		if ( !this.fallbackLine ) {
			this.fallbackLine = new MeshLine()
				.lines( toCpuPath( this.sourceData ) )
				.lineWidth( HALF_WIDTH * 2 )
				.color( 0x22d3ee )
				.join( { type: 'miter', limit: MITER_LIMIT } )
				.build()
			stage3d.add( this.fallbackLine )
		}

		if ( this.metrics ) {
			this.metrics.error = error instanceof Error ? error.message : error ? String( error ) : reason
			this.metrics.fallback = 'cpu-full-detail'
			this.metrics.ready = true
			this.metrics.retainedPointCount = POINT_COUNT
			this.metrics.retainedPointCountSource = 'known fail-open full-detail path'
		}
		this.text = reason
		console.warn( `[gpuSimplificationPrototype] ${reason}`, error ?? '' )
	}

	_disposeGpuResources() {
		if ( this.mesh ) stage3d.remove( this.mesh )
		for ( const node of this.computeNodes ) node?.dispose?.()
		this.geometry?.dispose()
		this.material?.dispose()
		this.mesh = null
		this.geometry = null
		this.material = null
		this.computeNodes = []
		this.storageAttributes = []
		this.retainedCountAttribute = null
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		this._disposeGpuResources()
		if ( this.fallbackLine ) {
			stage3d.remove( this.fallbackLine )
			this.fallbackLine.dispose()
		}
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		if ( window.__meshLineGpuSimplificationMetrics === this.metrics ) window.__meshLineGpuSimplificationMetrics = null
		if ( this.metrics ) this.metrics.ready = false
		this.fallbackLine = null
		this.control = null
		this.sourceData = null
		this.metrics = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new GpuSimplificationPrototypeExample()
