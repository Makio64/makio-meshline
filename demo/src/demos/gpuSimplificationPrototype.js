import { MeshLine } from 'makio-meshline'
import {
	abs,
	Break,
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
	log2,
	Loop,
	max,
	min,
	mix,
	smoothstep,
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
	LineBasicNodeMaterial,
	LineSegments,
	Matrix4,
	Mesh,
	MeshBasicNodeMaterial,
	StorageBufferAttribute,
	Vector2,
} from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import GpuSimplificationUI from '@/components/GpuSimplification.vue'
import { buildVectorDataset, VECTOR_DATASETS, WORLD_SIZE } from '@/data/vectorDatasets'
import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import {
	buildChunkPlan,
	buildNeighbourPlan,
	RELAX_LAMBDA,
	RELAX_MAX_ITERATIONS,
	RELAX_MU,
	relaxPositions,
	resolveChunkSegments,
	resolveCssPixelViewport,
	resolveRelaxIterations,
	resolveSimplificationSettings,
	RIBBON_CAMERA_PLANE_OFFSET_FRACTION,
	RIBBON_JOIN_SUPPORT_FRACTION,
	SIMPLIFICATION_CHUNK_MAX,
	SIMPLIFICATION_LEVEL_MAX,
	SIMPLIFICATION_REFINE_PASSES,
	simplifyChunkedDouglasPeucker,
} from '@/utils/gpuSimplification'

const POINT_CAPACITY = 262_144
const OUTPUT_CAPACITY = POINT_CAPACITY
const WORKGROUP_SIZE = 256
const BLOCK_COUNT = Math.ceil( POINT_CAPACITY / WORKGROUP_SIZE )
const BLOCKS_PER_PREFIX_LANE = Math.ceil( BLOCK_COUNT / WORKGROUP_SIZE )
const CHUNK_CAPACITY = 4096
const LINE_CAPACITY = 256
const RIBBON_VERTICES_PER_SEGMENT = 12
const WIREFRAME_VERTICES_PER_SEGMENT = 6
const LINE_VERTICES_PER_SEGMENT = 2
const DRAW_COMMAND_UINTS = 4
const DRAW_COMMAND_BYTES = DRAW_COMMAND_UINTS * Uint32Array.BYTES_PER_ELEMENT
const RIBBON_DRAW_OFFSET = 0
const LINE_DRAW_OFFSET = DRAW_COMMAND_BYTES
const WIREFRAME_DRAW_OFFSET = DRAW_COMMAND_BYTES * 2
const DEFAULT_LINE_WIDTH = 0.44
const MIN_LINE_WIDTH = 0.05
const MAX_LINE_WIDTH = 2
// The reference MeshLine overlay keeps the library (and SVG) default so the
// comparison baseline does not move. The procedural ribbon is tighter: at 4 a
// hairpin grew a miter tip 1.7x the full stroke width past the corner, and the
// support guard never fired to catch it.
const MITER_LIMIT = 4
const RIBBON_MITER_LIMIT = 2
const EPSILON = 1e-6
const HUGE_TOLERANCE_SCALE = 1e12
// Recursion levels a single invocation descends per refinement dispatch.
const REFINE_DESCENT = 8
const DEFAULT_LEVEL = 58
const DEFAULT_RELAX = 4
// Contour lines show off the relax + simplify pass best; France is one click away.
const DEFAULT_DATASET = 'isolines'
const CAMERA_LOD_INTERVAL_MS = 1000 / 15
const SETTLED_MEASUREMENT_DELAY_MS = 200
const CAMERA_MATRIX_EPSILON = 1e-4

const finiteQueryNumber = ( query, key, fallback, minimum, maximum ) => {
	if ( !query.has( key ) ) return fallback
	const value = Number( query.get( key ) )
	return Number.isFinite( value ) ? Math.min( maximum, Math.max( minimum, value ) ) : fallback
}

const declaredGpuBytes = () => (
	POINT_CAPACITY * 4 * Float32Array.BYTES_PER_ELEMENT +
	POINT_CAPACITY * 3 * Uint32Array.BYTES_PER_ELEMENT +
	OUTPUT_CAPACITY * 4 * Float32Array.BYTES_PER_ELEMENT +
	OUTPUT_CAPACITY * Uint32Array.BYTES_PER_ELEMENT +
	BLOCK_COUNT * 2 * Uint32Array.BYTES_PER_ELEMENT +
	CHUNK_CAPACITY * 2 * Uint32Array.BYTES_PER_ELEMENT +
	( 4 + DRAW_COMMAND_UINTS * 6 ) * Uint32Array.BYTES_PER_ELEMENT
)

class GpuSimplificationPrototypeExample {

	constructor() {
		this.text = ''
		this.uiComponent = markRaw( GpuSimplificationUI )
		this.datasets = markRaw( VECTOR_DATASETS.map( ( { id, label, subtitle } ) => ( { id, label, subtitle } ) ) )
		this.ui = reactive( {
			backend: 'initializing',
			busy: true,
			cameraLod: false,
			cpuReferenceCount: null,
			cpuReferenceMs: null,
			cpuReferencePending: false,
			datasetDescription: '',
			datasetId: DEFAULT_DATASET,
			detail: 'after',
			gpuComputeMs: null,
			level: DEFAULT_LEVEL,
			lineCount: 0,
			lineWidth: DEFAULT_LINE_WIDTH,
			pixelTolerance: 0,
			relax: 0,
			renderMode: 'ribbons',
			retainedPointCount: null,
			sourcePointCount: 0,
			status: 'Preparing the GPU pipeline…',
			timingSource: null,
			timingSupported: false,
			visible: true,
			worldTolerance: 0,
		} )
		this.mesh = null
		this.fallbackLines = []
		this.control = null
		this.bloom = null
		this.dataset = null
		this.chunkPlan = []
		this.chunkSegments = 0
		this.storageAttributes = []
		this.simplificationNodes = []
		this.renderObjects = []
		this.geometries = []
		this.materials = []
		this.renderSets = { after: {}, before: {} }
		this.metrics = null
		this.view = { detail: 'after', renderMode: 'ribbons' }
		this.settings = resolveSimplificationSettings( DEFAULT_LEVEL, WORLD_SIZE )
		this.lineWidth = DEFAULT_LINE_WIDTH
		this.halfWidthNode = null
		this.relaxIterations = DEFAULT_RELAX
		this.cameraLod = false
		this._pipelineStages = null
		this.validateAgainstCpu = false
		this._disposed = false
		this._measurementGeneration = 0
		this._measurementChain = Promise.resolve()
		this._measurementActive = false
		this._gpuTimingSupported = false
		this._needsWarmup = true
		this._cameraLodDirty = false
		this._pendingRebuildTimer = null
		this._settledMeasurementTimer = null
		this._cpuReferenceTimer = null
		this._projectionView = new Matrix4()
		this._lastProjectionView = new Matrix4().set( 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 )
		this._viewport = new Vector2()
		this._lastViewport = new Vector2( -1, -1 )
		this._lastCameraLodTime = -Infinity
		this._updating = false
	}

	async init() {
		const query = new URLSearchParams( window.location.search )
		const datasetId = VECTOR_DATASETS.some( dataset => dataset.id === query.get( 'dataset' ) )
			? query.get( 'dataset' )
			: DEFAULT_DATASET
		const level = Math.round( finiteQueryNumber( query, 'level', DEFAULT_LEVEL, 0, SIMPLIFICATION_LEVEL_MAX ) )
		this.lineWidth = Math.round(
			finiteQueryNumber( query, 'lineWidth', DEFAULT_LINE_WIDTH, MIN_LINE_WIDTH, MAX_LINE_WIDTH ) * 100,
		) / 100
		this.relaxIterations = resolveRelaxIterations(
			finiteQueryNumber( query, 'relax', DEFAULT_RELAX, 0, RELAX_MAX_ITERATIONS ),
		)
		this.cameraLod = query.get( 'cameraLod' ) === '1'
		this.validateAgainstCpu = query.get( 'validate' ) === '1'
		this.view.detail = query.get( 'view' ) === 'original' ? 'before' : 'after'
		this.view.renderMode = ['line', 'lines'].includes( query.get( 'render' ) )
			? 'lines'
			: query.get( 'render' ) === 'wireframe' ? 'wireframe' : 'ribbons'
		this.settings = resolveSimplificationSettings( level, WORLD_SIZE )

		Object.assign( this.ui, {
			cameraLod: this.cameraLod,
			datasetId,
			detail: this.view.detail,
			level: this.settings.level,
			lineWidth: this.lineWidth,
			pixelTolerance: this.settings.pixelTolerance,
			relax: this.relaxIterations,
			renderMode: this.view.renderMode,
			visible: !query.has( 'noUI' ),
			worldTolerance: this.settings.worldTolerance,
		} )

		this.metrics = {
			algorithm: 'Taubin relaxation, then Douglas-Peucker chunk-parallel refinement, both on the GPU',
			backend: 'initializing',
			bufferBytes: 0,
			busy: true,
			cameraLod: this.cameraLod,
			chunkCount: 0,
			chunkSegments: 0,
			computeSubmissions: 0,
			cpuReferenceCount: null,
			cpuReferenceDelta: null,
			cpuReferenceMs: null,
			cpuSubmitMs: null,
			datasetId,
			dispatchCount: 0,
			dispatchesPerRebuild: 0,
			emittedSegments: null,
			error: null,
			fallback: null,
			gpuComputeMs: null,
			gpuTimingSource: null,
			lineCount: 0,
			lineWidth: this.lineWidth,
			pixelTolerance: this.settings.pixelTolerance,
			ready: false,
			readbackError: null,
			rebuildCount: 0,
			refinePasses: SIMPLIFICATION_REFINE_PASSES,
			retainedPointCount: null,
			relaxIterations: this.relaxIterations,
			sourcePointCount: 0,
			sourceUploads: 0,
			simplificationLevel: this.settings.level,
			worldTolerance: this.settings.worldTolerance,
		}
		window.__meshLineGpuSimplificationMetrics = this.metrics

		try {
			await stage3d.initRender( { background: 0x050913 } )
			const nativeWebGPU = stage3d.renderer?.backend?.isWebGPUBackend === true
			this.metrics.backend = nativeWebGPU ? 'webgpu' : 'webgl2'

			this.control = new OrbitControl( stage3d.camera, finiteQueryNumber( query, 'radius', 120, 20, 320 ) )
			this.control.minRadius = 12
			this.control.maxRadius = 320
			this.control._phi = Math.PI * 0.5
			this.control._theta = Math.PI * 0.5
			// These datasets are flat vector art. Allow enough tilt to show what
			// perspective does to a screen-space error budget, but never enough to
			// turn the drawing edge-on.
			this.control.isThetaRestricted = true
			this.control.minTheta = Math.PI * 0.5 - 0.85
			this.control.maxTheta = Math.PI * 0.5 + 0.85
			this.control.minPhi = Math.PI * 0.5 - 0.75
			this.control.maxPhi = Math.PI * 0.5 + 0.75
			this.control.extraPhiMouse = false
			this.control.extraThetaMouse = false
			this.control.update()
			stage3d.control = this.control
			this.bloom = createBloomPipeline( { strength: 0.55, radius: 0.3, threshold: 0.15 } )

			stage3d.camera.near = 1
			stage3d.camera.far = 640
			stage3d.camera.updateProjectionMatrix()

			this._loadDataset( datasetId )

			if ( !nativeWebGPU ) {
				this._activateCpuFallback( 'Native WebGPU is unavailable; drawing the source lines at full detail.' )
				return
			}

			this._gpuTimingSupported = stage3d.renderer.hasFeature( 'timestamp-query' )
			Object.assign( this.ui, { backend: 'webgpu', timingSupported: this._gpuTimingSupported } )

			this._createGpuPipeline()
			this._uploadDataset()
			this._applySettings()
			this._updateCameraUniforms( true )
			const generation = ++this._measurementGeneration
			this._measurementChain = this._performMeasuredRebuild( generation, 'Simplified once, on load' )
			await this._measurementChain
			for ( const object of this.renderObjects ) stage3d.add( object )
			this._syncView()
			stage.onUpdate.add( this.update )
			this.metrics.ready = true
			this.ui.busy = false
		} catch ( error ) {
			this._activateCpuFallback( 'GPU simplification failed; drawing the source lines at full detail.', error )
		}
	}

	/**
	 * clear/copy, two dispatches per relaxation pass, seed, the refinement passes,
	 * the exact flush, then scan, block prefix, scatter and resolve. Only the
	 * relaxation count varies, and repeating a node costs a dispatch, not a
	 * pipeline — the shaders are compiled once and never rebuilt.
	 */
	_rebuildNodeList() {
		const stages = this._pipelineStages
		if ( !stages ) return
		const relax = []
		for ( let pass = 0; pass < this.relaxIterations; pass++ ) {
			relax.push( stages.relaxShrink, stages.relaxUnshrink )
		}
		this.simplificationNodes = [
			...stages.head,
			...relax,
			stages.seed,
			...Array.from( { length: SIMPLIFICATION_REFINE_PASSES }, () => stages.refine ),
			stages.flush,
			...stages.tail,
		]
		if ( this.metrics ) this.metrics.dispatchesPerRebuild = this.simplificationNodes.length
	}

	// -----------------------------------------------------------------------
	// data
	// -----------------------------------------------------------------------

	_loadDataset( datasetId ) {
		this.dataset = buildVectorDataset( datasetId, POINT_CAPACITY )
		this.chunkSegments = 0
		this._resolveChunkPlan()
		Object.assign( this.ui, {
			datasetDescription: this.dataset.description,
			datasetId: this.dataset.id,
			lineCount: this.dataset.lineCount,
			sourcePointCount: this.dataset.pointCount,
		} )
		if ( this.metrics ) {
			Object.assign( this.metrics, {
				chunkCount: this.chunkPlan.length,
				chunkSegments: this.chunkSegments,
				datasetId: this.dataset.id,
				lineCount: this.dataset.lineCount,
				sourcePointCount: this.dataset.pointCount,
			} )
		}
	}

	/**
	 * Recomputes the chunk lattice for the current tolerance. Chunk length is a
	 * power of two, so dragging the slider only rebuilds the plan on a real step
	 * rather than on every input event.
	 *
	 * @returns {boolean} Whether the lattice changed.
	 */
	_resolveChunkPlan() {
		if ( !this.dataset ) return false
		const zoomScale = this.cameraLod && this.control
			? Math.min( 1, Math.max( 0.1, this.control._radius / 120 ) )
			: 1
		const segments = resolveChunkSegments(
			this.settings.relativeTolerance * zoomScale,
			this.dataset.pointCount,
		)
		if ( segments === this.chunkSegments ) return false
		this.chunkSegments = segments
		this.chunkPlan = buildChunkPlan( this.dataset.ranges, segments, CHUNK_CAPACITY )
		if ( this.metrics ) {
			this.metrics.chunkCount = this.chunkPlan.length
			this.metrics.chunkSegments = segments
		}
		return true
	}

	/** Uploads the buffers that depend on the chunk lattice. */
	_uploadChunkPlan() {
		for ( let index = 0; index < this.chunkPlan.length; index++ ) {
			this.chunkArray[index * 2] = this.chunkPlan[index][0]
			this.chunkArray[index * 2 + 1] = this.chunkPlan[index][1]
		}
		this.chunkAttribute.needsUpdate = true
		this.chunkCountNode.value = this.chunkPlan.length
	}

	/**
	 * Refresh the resident GPU buffers in place. Nothing about the node graph
	 * depends on the dataset, so switching datasets never recompiles a shader.
	 */
	_uploadDataset() {
		const { pointCount, positions, ranges } = this.dataset
		this._needsWarmup = true
		this.sourceArray.set( positions.subarray( 0, pointCount * 4 ) )
		this.sourceAttribute.needsUpdate = true

		this.neighbourArray.set( buildNeighbourPlan( ranges, pointCount, positions ) )
		this.neighbourAttribute.needsUpdate = true

		this.lineClosedArray.fill( 0 )
		this.sourceRunArray.fill( 0 )
		for ( let index = 0; index < Math.min( ranges.length, LINE_CAPACITY ); index++ ) {
			this.lineClosedArray[index] = ranges[index].closed ? 1 : 0
			this.sourceRunArray[index * 2] = ranges[index].start
			this.sourceRunArray[index * 2 + 1] = ranges[index].end
		}
		this.lineClosedAttribute.needsUpdate = true
		this.sourceRunAttribute.needsUpdate = true

		this._uploadChunkPlan()

		const sourceSegments = Math.max( 0, pointCount - 1 )
		this.sourceDrawArray.set( [
			sourceSegments * RIBBON_VERTICES_PER_SEGMENT,
			1,
			0,
			0,
			sourceSegments * LINE_VERTICES_PER_SEGMENT,
			1,
			0,
			0,
			sourceSegments * WIREFRAME_VERTICES_PER_SEGMENT,
			1,
			0,
			0,
		] )
		this.sourceDrawAttribute.needsUpdate = true

		this.pointCountNode.value = pointCount
		this.metrics.sourceUploads++
	}

	// -----------------------------------------------------------------------
	// compute pipeline
	// -----------------------------------------------------------------------

	_createGpuPipeline() {
		this.sourceArray = new Float32Array( POINT_CAPACITY * 4 )
		this.neighbourArray = new Uint32Array( POINT_CAPACITY * 2 )
		this.chunkArray = new Uint32Array( CHUNK_CAPACITY * 2 )
		this.lineClosedArray = new Uint32Array( LINE_CAPACITY )
		this.sourceRunArray = new Uint32Array( LINE_CAPACITY * 2 )
		this.sourceDrawArray = new Uint32Array( 12 )

		this.sourceAttribute = new StorageBufferAttribute( this.sourceArray, 4 )
		this.neighbourAttribute = new StorageBufferAttribute( this.neighbourArray, 2 )
		this.chunkAttribute = new StorageBufferAttribute( this.chunkArray, 2 )
		this.lineClosedAttribute = new StorageBufferAttribute( this.lineClosedArray, 1 )
		// Two scalar slots per line rather than one uvec2. Writing a single
		// component of a vector in storage compiles to a read-modify-write of the
		// whole vector, so the invocation that owns a line's end would clobber the
		// one that owns its start. Separate slots are independent 4-byte stores.
		this.sourceRunAttribute = new StorageBufferAttribute( this.sourceRunArray, 1 )
		const outputRunAttribute = new StorageBufferAttribute( LINE_CAPACITY * 2, 1, Uint32Array )
		this.sourceDrawAttribute = new IndirectStorageBufferAttribute( this.sourceDrawArray, 1 )
		const relaxedAttribute = new StorageBufferAttribute( POINT_CAPACITY, 4 )
		const relaxScratchAttribute = new StorageBufferAttribute( POINT_CAPACITY, 4 )
		const keepAttribute = new StorageBufferAttribute( POINT_CAPACITY, 1, Uint32Array )
		const settledAttribute = new StorageBufferAttribute( POINT_CAPACITY, 1, Uint32Array )
		const rankAttribute = new StorageBufferAttribute( POINT_CAPACITY, 1, Uint32Array )
		const compactedAttribute = new StorageBufferAttribute( POINT_CAPACITY, 1, Uint32Array )
		const blockCountAttribute = new StorageBufferAttribute( BLOCK_COUNT, 1, Uint32Array )
		const blockOffsetAttribute = new StorageBufferAttribute( BLOCK_COUNT, 1, Uint32Array )
		const outputAttribute = new StorageBufferAttribute( OUTPUT_CAPACITY, 4 )
		const outputGapAttribute = new StorageBufferAttribute( OUTPUT_CAPACITY, 1, Uint32Array )
		const stateAttribute = new StorageBufferAttribute( 4, 1, Uint32Array )
		const simplifiedDrawAttribute = new IndirectStorageBufferAttribute( new Uint32Array( 12 ), 1 )

		this.stateAttribute = stateAttribute
		this.compactedAttribute = compactedAttribute
		this.storageAttributes = [
			this.sourceAttribute,
			this.neighbourAttribute,
			this.chunkAttribute,
			this.lineClosedAttribute,
			this.sourceRunAttribute,
			outputRunAttribute,
			this.sourceDrawAttribute,
			relaxedAttribute,
			relaxScratchAttribute,
			keepAttribute,
			settledAttribute,
			rankAttribute,
			compactedAttribute,
			blockCountAttribute,
			blockOffsetAttribute,
			outputAttribute,
			outputGapAttribute,
			stateAttribute,
			simplifiedDrawAttribute,
		]
		this.metrics.bufferBytes = declaredGpuBytes()

		const source = storage( this.sourceAttribute, 'vec4', POINT_CAPACITY ).toReadOnly()
		const neighbours = storage( this.neighbourAttribute, 'uvec2', POINT_CAPACITY ).toReadOnly()
		const chunks = storage( this.chunkAttribute, 'uvec2', CHUNK_CAPACITY ).toReadOnly()
		const outputRuns = storage( outputRunAttribute, 'uint', LINE_CAPACITY * 2 )
		// Vertex stages may only bind storage read-only, so the render graph gets
		// its own views of the per-line tables.
		this.lineClosedStorage = storage( this.lineClosedAttribute, 'uint', LINE_CAPACITY ).toReadOnly()
		// Everything downstream of relaxation reads `geometry`, never `source`.
		// With zero relax passes it is a straight copy, so the simplifier does not
		// need to know whether the curve was relaxed first.
		const geometry = storage( relaxedAttribute, 'vec4', POINT_CAPACITY )
		const relaxScratch = storage( relaxScratchAttribute, 'vec4', POINT_CAPACITY )
		const keep = storage( keepAttribute, 'uint', POINT_CAPACITY )
		const settled = storage( settledAttribute, 'uint', POINT_CAPACITY )
		const localRanks = storage( rankAttribute, 'uint', POINT_CAPACITY )
		const compacted = storage( compactedAttribute, 'uint', POINT_CAPACITY )
		const blockCounts = storage( blockCountAttribute, 'uint', BLOCK_COUNT )
		const blockOffsets = storage( blockOffsetAttribute, 'uint', BLOCK_COUNT )
		const output = storage( outputAttribute, 'vec4', OUTPUT_CAPACITY )
		const outputGap = storage( outputGapAttribute, 'uint', OUTPUT_CAPACITY )
		const state = storage( stateAttribute, 'uint', 4 )
		const simplifiedDraw = storage( simplifiedDrawAttribute, 'uint', 12 )
		const scanShared = workgroupArray( 'uint', WORKGROUP_SIZE )
		const blockScanShared = workgroupArray( 'uint', WORKGROUP_SIZE )

		this.pointCountNode = uniform( 0, 'uint' )
		this.chunkCountNode = uniform( 0, 'uint' )
		this.halfWidthNode = uniform( this.lineWidth * 0.5 )
		this.inverseWorldToleranceNode = uniform( HUGE_TOLERANCE_SCALE )
		this.inversePixelToleranceNode = uniform( 0 )
		this.screenEnabledNode = uniform( 0 )
		this.projectionViewNode = uniform( new Matrix4() )
		this.viewportNode = uniform( new Vector2( 1, 1 ) )

		const projectToPixel = Fn( ( [point] ) => {
			const clip = this.projectionViewNode.mul( vec4( point, 1 ) ).toVar()
			const safeW = max( abs( clip.w ), EPSILON )
			return vec3( clip.xy.div( safeW ).mul( this.viewportNode.mul( 0.5 ) ), clip.w )
		} )

		const clearNode = Fn( () => {
			const pointIndex = instanceIndex.toUint()
			If( pointIndex.lessThan( uint( POINT_CAPACITY ) ), () => {
				keep.element( pointIndex ).assign( uint( 0 ) )
				settled.element( pointIndex ).assign( uint( 0 ) )
				geometry.element( pointIndex ).assign( source.element( pointIndex ) )
			} )
		} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

		// One relaxation half-step: pull every point a fraction of the way toward
		// the midpoint of its two neighbours. Run with a positive weight it takes
		// the corners off; run again with a slightly larger negative weight it
		// pushes the low frequencies back out, so the shape relaxes without
		// deflating. Pinned endpoints neighbour themselves and never move.
		const relaxStep = ( read, write, weightNode ) => Fn( () => {
			const pointIndex = instanceIndex.toUint()
			If( pointIndex.lessThan( this.pointCountNode ), () => {
				const point = read.element( pointIndex ).toVar()
				const pair = neighbours.element( pointIndex )
				const average = read.element( pair.x ).xyz.add( read.element( pair.y ).xyz ).mul( 0.5 )
				write.element( pointIndex ).assign(
					vec4( point.xyz.add( average.sub( point.xyz ).mul( weightNode ) ), point.w ),
				)
			} )
		} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

		const relaxShrinkNode = relaxStep( geometry, relaxScratch, float( RELAX_LAMBDA ) )
		const relaxUnshrinkNode = relaxStep( relaxScratch, geometry, float( RELAX_MU ) )

		// A retained point stores `end + 1` in `keep[pointIndex]`, where `end` is
		// the right endpoint of the interval it owns (or `pointIndex` itself at the
		// end of a polyline). `0` means not retained. Encoding both the flag and the
		// right endpoint into a single 32-bit word makes interval lookup O(1) instead
		// of an O(chunk) forward scan on every pass.
		const seedNode = Fn( () => {
			const chunkIndex = instanceIndex.toUint()
			If( chunkIndex.lessThan( this.chunkCountNode ), () => {
				const chunk = chunks.element( chunkIndex )
				keep.element( chunk.x ).assign( chunk.y.add( uint( 1 ) ) )
				const nextIndex = chunkIndex.add( uint( 1 ) )
				const closesRun = nextIndex.greaterThanEqual( this.chunkCountNode )
					.or( chunks.element( nextIndex ).x.equal( chunk.y ).not() )
				If( closesRun, () => {
					keep.element( chunk.y ).assign( chunk.y.add( uint( 1 ) ) )
				} )
			} )
		} )().compute( CHUNK_CAPACITY, [WORKGROUP_SIZE] )

		// One refinement pass drives the Douglas-Peucker recursion forward for every
		// open interval at once. The interval between two retained points is owned
		// by its left endpoint, and that owner is the only invocation that ever
		// writes inside it, so the whole pass is race-free without atomics.
		//
		// A split hands the right half to the newly retained point and keeps the
		// left half, so the owner can descend its own left spine several levels in
		// one dispatch instead of costing one dispatch per level. Wide chunks split
		// once per pass so both halves run in parallel on the next dispatch rather
		// than stalling one invocation across thousands of points.
		const refineNode = Fn( () => {
			const pointIndex = instanceIndex.toUint()
			If( pointIndex.lessThan( this.pointCountNode ), () => {
				const keepValue = keep.element( pointIndex ).toVar()
				const active = keepValue.greaterThan( uint( 0 ) )
					.and( settled.element( pointIndex ).equal( uint( 0 ) ) )
				If( active, () => {
					const end = keepValue.sub( uint( 1 ) ).toVar()
					const invWorldTolSq = min(
						this.inverseWorldToleranceNode.mul( this.inverseWorldToleranceNode ),
						float( 1e30 ),
					).toVar()
					const invPixelTolSq = min(
						this.inversePixelToleranceNode.mul( this.inversePixelToleranceNode ),
						float( 1e30 ),
					).toVar()
					const screenActive = this.screenEnabledNode.greaterThan( 0 ).toVar()

					Loop( { condition: '<', end: uint( REFINE_DESCENT ), start: uint( 0 ), type: 'uint' }, ( { i: step } ) => {
						const span = end.sub( pointIndex )
						If( span.lessThan( uint( 2 ) ), () => {
							settled.element( pointIndex ).assign( uint( 1 ) )
							Break()
						} )
						If( step.greaterThan( uint( 0 ) ).and( span.greaterThan( uint( 256 ) ) ), () => {
							Break()
						} )

						const startPos = geometry.element( pointIndex ).xyz.toVar()
						const endPos = geometry.element( end ).xyz.toVar()
						const chord = endPos.sub( startPos ).toVar()
						const invChordLenSq = float( 1 ).div( max( dot( chord, chord ), EPSILON ) ).toVar()

						const projectedStart = vec3( 0, 0, 0 ).toVar()
						const projectedEnd = vec3( 0, 0, 0 ).toVar()
						const screenChord = vec3( 0, 0, 0 ).xy.toVar()
						const invScreenChordLenSq = float( 0 ).toVar()
						const checkScreen = screenActive.toVar()

						If( checkScreen, () => {
							projectedStart.assign( projectToPixel( startPos ) )
							projectedEnd.assign( projectToPixel( endPos ) )
							If( projectedStart.z.lessThanEqual( EPSILON ).or( projectedEnd.z.lessThanEqual( EPSILON ) ), () => {
								checkScreen.assign( false )
							} ).Else( () => {
								screenChord.assign( projectedEnd.xy.sub( projectedStart.xy ) )
								invScreenChordLenSq.assign( float( 1 ).div( max( dot( screenChord, screenChord ), EPSILON ) ) )
							} )
						} )

						const worstSq = float( -1 ).toVar()
						const split = uint( 0 ).toVar()
						Loop(
							{ condition: '<', end, start: pointIndex.add( uint( 1 ) ), type: 'uint' },
							( { i } ) => {
								const point = geometry.element( i ).xyz
								const rel = point.sub( startPos )
								const t = clamp( dot( rel, chord ).mul( invChordLenSq ), 0, 1 )
								const diff = rel.sub( chord.mul( t ) )
								const errorSq = dot( diff, diff ).mul( invWorldTolSq ).toVar()

								If( checkScreen, () => {
									const projectedPoint = projectToPixel( point )
									If( projectedPoint.z.greaterThan( EPSILON ), () => {
										const screenRel = projectedPoint.xy.sub( projectedStart.xy )
										const screenT = clamp( dot( screenRel, screenChord ).mul( invScreenChordLenSq ), 0, 1 )
										const screenDiff = screenRel.sub( screenChord.mul( screenT ) )
										errorSq.assign( max( errorSq, dot( screenDiff, screenDiff ).mul( invPixelTolSq ) ) )
									} )
								} )

								If( errorSq.greaterThan( worstSq ), () => {
									worstSq.assign( errorSq )
									split.assign( i )
								} )
							},
						)

						If( worstSq.greaterThan( float( 1 ) ), () => {
							keep.element( split ).assign( end.add( uint( 1 ) ) )
							end.assign( split )
							keep.element( pointIndex ).assign( split.add( uint( 1 ) ) )
						} ).Else( () => {
							settled.element( pointIndex ).assign( uint( 1 ) )
							Break()
						} )
					} )
				} )
			} )
		} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

		// Whatever the refinement budget could not resolve is expanded to full
		// detail, so the tolerance is a guarantee rather than a hope.
		const flushNode = Fn( () => {
			const pointIndex = instanceIndex.toUint()
			If( pointIndex.lessThan( this.pointCountNode ), () => {
				const keepValue = keep.element( pointIndex ).toVar()
				const active = keepValue.greaterThan( uint( 0 ) )
					.and( settled.element( pointIndex ).equal( uint( 0 ) ) )
				If( active, () => {
					const end = keepValue.sub( uint( 1 ) ).toVar()
					If( end.sub( pointIndex ).greaterThan( uint( 1 ) ), () => {
						const invWorldTolSq = min(
							this.inverseWorldToleranceNode.mul( this.inverseWorldToleranceNode ),
							float( 1e30 ),
						).toVar()
						const invPixelTolSq = min(
							this.inversePixelToleranceNode.mul( this.inversePixelToleranceNode ),
							float( 1e30 ),
						).toVar()
						const startPos = geometry.element( pointIndex ).xyz.toVar()
						const endPos = geometry.element( end ).xyz.toVar()
						const chord = endPos.sub( startPos ).toVar()
						const invChordLenSq = float( 1 ).div( max( dot( chord, chord ), EPSILON ) ).toVar()

						const projectedStart = vec3( 0, 0, 0 ).toVar()
						const projectedEnd = vec3( 0, 0, 0 ).toVar()
						const screenChord = vec3( 0, 0, 0 ).xy.toVar()
						const invScreenChordLenSq = float( 0 ).toVar()
						const checkScreen = this.screenEnabledNode.greaterThan( 0 ).toVar()

						If( checkScreen, () => {
							projectedStart.assign( projectToPixel( startPos ) )
							projectedEnd.assign( projectToPixel( endPos ) )
							If( projectedStart.z.lessThanEqual( EPSILON ).or( projectedEnd.z.lessThanEqual( EPSILON ) ), () => {
								checkScreen.assign( false )
							} ).Else( () => {
								screenChord.assign( projectedEnd.xy.sub( projectedStart.xy ) )
								invScreenChordLenSq.assign( float( 1 ).div( max( dot( screenChord, screenChord ), EPSILON ) ) )
							} )
						} )

						const exceeded = uint( 0 ).toVar()
						Loop(
							{ condition: '<', end, start: pointIndex.add( uint( 1 ) ), type: 'uint' },
							( { i } ) => {
								const point = geometry.element( i ).xyz
								const rel = point.sub( startPos )
								const t = clamp( dot( rel, chord ).mul( invChordLenSq ), 0, 1 )
								const diff = rel.sub( chord.mul( t ) )
								const errorSq = dot( diff, diff ).mul( invWorldTolSq ).toVar()

								If( checkScreen, () => {
									const projectedPoint = projectToPixel( point )
									If( projectedPoint.z.greaterThan( EPSILON ), () => {
										const screenRel = projectedPoint.xy.sub( projectedStart.xy )
										const screenT = clamp( dot( screenRel, screenChord ).mul( invScreenChordLenSq ), 0, 1 )
										const screenDiff = screenRel.sub( screenChord.mul( screenT ) )
										errorSq.assign( max( errorSq, dot( screenDiff, screenDiff ).mul( invPixelTolSq ) ) )
									} )
								} )

								If( errorSq.greaterThan( float( 1 ) ), () => {
									exceeded.assign( uint( 1 ) )
									Break()
								} )
							},
						)
						If( exceeded.greaterThan( uint( 0 ) ), () => {
							Loop(
								{ condition: '<', end, start: pointIndex.add( uint( 1 ) ), type: 'uint' },
								( { i } ) => {
									keep.element( i ).assign( uint( 1 ) )
								},
							)
						} )
					} )
				} )
			} )
		} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

		const scanNode = Fn( () => {
			const pointIndex = instanceIndex.toUint()
			const localIndex = invocationLocalIndex.toUint()
			const flag = uint( 0 ).toVar()
			If( pointIndex.lessThan( this.pointCountNode ), () => {
				flag.assign( keep.element( pointIndex ).greaterThan( uint( 0 ) ).select( uint( 1 ), uint( 0 ) ) )
			} )

			scanShared.element( localIndex ).assign( flag )
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

			localRanks.element( pointIndex ).assign( scanShared.element( localIndex ) )
			If( localIndex.equal( uint( WORKGROUP_SIZE - 1 ) ), () => {
				blockCounts.element( workgroupId.x ).assign( scanShared.element( localIndex ) )
			} )
		} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

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
				const retained = blockScanShared.element( uint( WORKGROUP_SIZE - 1 ) ).toVar()
				const segments = retained.greaterThan( uint( 1 ) )
					.select( retained.sub( uint( 1 ) ), uint( 0 ) )
					.toVar()

				state.element( uint( 0 ) ).assign( retained )
				state.element( uint( 1 ) ).assign( retained )
				state.element( uint( 2 ) ).assign( segments )
				state.element( uint( 3 ) ).assign( uint( 0 ) )

				simplifiedDraw.element( uint( 0 ) ).assign( segments.mul( uint( RIBBON_VERTICES_PER_SEGMENT ) ) )
				simplifiedDraw.element( uint( 4 ) ).assign( segments.mul( uint( LINE_VERTICES_PER_SEGMENT ) ) )
				simplifiedDraw.element( uint( 8 ) ).assign( segments.mul( uint( WIREFRAME_VERTICES_PER_SEGMENT ) ) )
				for ( const command of [0, 4, 8] ) {
					simplifiedDraw.element( uint( command + 1 ) ).assign( uint( 1 ) )
					simplifiedDraw.element( uint( command + 2 ) ).assign( uint( 0 ) )
					simplifiedDraw.element( uint( command + 3 ) ).assign( uint( 0 ) )
				}
			} )
		} )().compute( WORKGROUP_SIZE, [WORKGROUP_SIZE] )

		const scatterNode = Fn( () => {
			const pointIndex = instanceIndex.toUint()
			If( pointIndex.lessThan( this.pointCountNode ), () => {
				const localIndex = pointIndex.mod( uint( WORKGROUP_SIZE ) )
				const rank = localRanks.element( pointIndex )
				const previousRank = uint( 0 ).toVar()
				If( localIndex.greaterThan( uint( 0 ) ), () => {
					previousRank.assign( localRanks.element( pointIndex.sub( uint( 1 ) ) ) )
				} )
				If( rank.greaterThan( previousRank ), () => {
					const blockIndex = pointIndex.div( uint( WORKGROUP_SIZE ) )
					compacted.element( blockOffsets.element( blockIndex ).add( rank ).sub( uint( 1 ) ) )
						.assign( pointIndex )
				} )
			} )
		} )().compute( POINT_CAPACITY, [WORKGROUP_SIZE] )

		// Gathers the survivors into one contiguous buffer the renderer can walk
		// without an index, and records how many source points each emitted
		// segment stands in for so the heatmap has something true to show.
		//
		// It also records where each polyline begins and ends in output space, so
		// the ribbon can wrap a closed ring across its seam. That write needs its
		// own race argument, and here it is: compaction is stable, so every line id
		// occupies one contiguous span of output indices, and the predicate "the
		// previous survivor belongs to another line" is therefore true for exactly
		// one invocation per line. Each bound is written once, by one invocation,
		// with no read-modify-write — the same footing as the refinement pass. This
		// depends on the scatter staying stable; a non-stable scheme would break it.
		const resolveNode = Fn( () => {
			const outputIndex = instanceIndex.toUint()
			If( outputIndex.lessThan( state.element( uint( 0 ) ) ), () => {
				const lastRetained = max( uint( 1 ), state.element( uint( 0 ) ) ).sub( uint( 1 ) )
				const source1 = compacted.element( outputIndex ).toVar()
				const source2 = compacted.element( min( outputIndex.add( uint( 1 ) ), lastRetained ) ).toVar()
				const point1 = geometry.element( source1 ).toVar()
				const sameLine = point1.w.equal( geometry.element( source2 ).w )

				output.element( outputIndex ).assign( point1 )
				outputGap.element( outputIndex ).assign(
					sameLine.select( source2.sub( source1 ), uint( 1 ) ),
				)

				// Read line ids through `geometry`, never through `output` — this
				// dispatch is writing `output`, so reading a neighbour's entry there
				// would be a genuine race.
				const line = min( point1.w.toUint(), uint( LINE_CAPACITY - 1 ) ).toVar()
				const previousSource = compacted.element( max( uint( 1 ), outputIndex ).sub( uint( 1 ) ) )
				const startsRun = outputIndex.equal( uint( 0 ) )
					.or( geometry.element( previousSource ).w.equal( point1.w ).not() )
				If( startsRun, () => {
					outputRuns.element( line.mul( uint( 2 ) ) ).assign( outputIndex )
				} )
				If( outputIndex.greaterThanEqual( lastRetained ).or( sameLine.not() ), () => {
					outputRuns.element( line.mul( uint( 2 ) ).add( uint( 1 ) ) ).assign( outputIndex )
				} )
			} )
		} )().compute( OUTPUT_CAPACITY, [WORKGROUP_SIZE] )

		this._pipelineStages = {
			flush: flushNode,
			head: [clearNode],
			refine: refineNode,
			relaxShrink: relaxShrinkNode,
			relaxUnshrink: relaxUnshrinkNode,
			seed: seedNode,
			tail: [scanNode, blockPrefixNode, scatterNode, resolveNode],
		}
		this._rebuildNodeList()

		// Vertex stages may only bind storage buffers read-only, so the render
		// graph gets its own read-only views of the same GPU buffers.
		this.renderSets.before = this._createGpuRenderSet( {
			countNode: this.pointCountNode,
			gapStorage: null,
			indirectAttribute: this.sourceDrawAttribute,
			pointStorage: source,
			runStorage: storage( this.sourceRunAttribute, 'uint', LINE_CAPACITY * 2 ).toReadOnly(),
		} )
		this.renderSets.after = this._createGpuRenderSet( {
			countNode: storage( stateAttribute, 'uint', 4 ).toReadOnly().element( uint( 1 ) ),
			gapStorage: storage( outputGapAttribute, 'uint', OUTPUT_CAPACITY ).toReadOnly(),
			indirectAttribute: simplifiedDrawAttribute,
			pointStorage: storage( outputAttribute, 'vec4', OUTPUT_CAPACITY ).toReadOnly(),
			runStorage: storage( outputRunAttribute, 'uint', LINE_CAPACITY * 2 ).toReadOnly(),
		} )
	}

	// -----------------------------------------------------------------------
	// procedural rendering
	// -----------------------------------------------------------------------

	_createGpuRenderSet( { countNode, gapStorage, indirectAttribute, pointStorage, runStorage } ) {
		const count = countNode
		const lastIndex = max( uint( 1 ), count ).sub( uint( 1 ) )
		const positionAt = pointIndex => pointStorage.element( min( pointIndex, lastIndex ) ).xyz
		const lineAt = pointIndex => pointStorage.element( min( pointIndex, lastIndex ) ).w
		const sameLine = ( a, b ) => lineAt( a ).equal( lineAt( b ) )
		const lineOf = pointIndex => min( lineAt( pointIndex ).toUint(), uint( LINE_CAPACITY - 1 ) )
		const runStartOf = pointIndex => runStorage.element( lineOf( pointIndex ).mul( uint( 2 ) ) )
		const runEndOf = pointIndex => runStorage.element( lineOf( pointIndex ).mul( uint( 2 ) ).add( uint( 1 ) ) )
		const isClosed = pointIndex => this.lineClosedStorage.element( lineOf( pointIndex ) ).greaterThan( uint( 0 ) )

		// Neighbours never cross a polyline boundary, so hundreds of independent
		// strokes can live in one buffer and one draw call without the ribbon
		// stitching the end of one stroke to the start of the next.
		//
		// A closed ring repeats its first point at the end, so without wrapping it
		// would render as an open stroke with two independent butt caps stacked on
		// one position — measured at 48% of the stroke width left unpainted at the
		// France mainland seam. Wrapping across the run makes the seam an ordinary
		// join like every other vertex.
		const previousOf = pointIndex => {
			const runStart = runStartOf( pointIndex )
			const runEnd = runEndOf( pointIndex )
			const wrapped = max( runStart.add( uint( 1 ) ), runEnd ).sub( uint( 1 ) )
			return pointIndex.lessThanEqual( runStart ).select(
				isClosed( pointIndex ).select( wrapped, pointIndex ),
				max( uint( 1 ), pointIndex ).sub( uint( 1 ) ),
			)
		}
		const nextOf = pointIndex => {
			const runStart = runStartOf( pointIndex )
			const runEnd = runEndOf( pointIndex )
			const wrapped = min( runStart.add( uint( 1 ) ), runEnd )
			return pointIndex.greaterThanEqual( runEnd ).select(
				isClosed( pointIndex ).select( wrapped, pointIndex ),
				min( pointIndex.add( uint( 1 ) ), lastIndex ),
			)
		}

		const ribbonPoint = Fn( ( [pointIndex, positiveSide, segmentEnd] ) => {
			const point = positionAt( pointIndex )
			const previous = positionAt( previousOf( pointIndex ) )
			const next = positionAt( nextOf( pointIndex ) )
			const incomingVector = point.sub( previous )
			const outgoingVector = next.sub( point )
			const incomingLength = length( incomingVector )
			const outgoingLength = length( outgoingVector )
			// An endpoint borrows its only neighbour's direction for both legs, and
			// a pair of points that quantised onto each other borrows an axis. Every
			// branch divides by a clamped length so no side of a select is ever NaN.
			const safeIncoming = incomingVector.div( max( incomingLength, EPSILON ) )
			const safeOutgoing = outgoingVector.div( max( outgoingLength, EPSILON ) )
			const incoming = incomingLength.greaterThan( EPSILON ).select(
				safeIncoming,
				outgoingLength.greaterThan( EPSILON ).select( safeOutgoing, vec3( 1, 0, 0 ) ),
			)
			const outgoing = outgoingLength.greaterThan( EPSILON ).select( safeOutgoing, incoming )
			const fixedUp = vec3( 0, 0, 1 )
			const fallbackUp = vec3( 0, 1, 0 )
			const incomingUp = abs( incoming.z ).greaterThan( 0.999 ).select( fallbackUp, fixedUp )
			const outgoingUp = abs( outgoing.z ).greaterThan( 0.999 ).select( fallbackUp, fixedUp )
			const incomingSide = cross( incomingUp, incoming ).normalize()
			const outgoingSide = cross( outgoingUp, outgoing ).normalize()
			const miterSum = incomingSide.add( outgoingSide )
			const miterLength = length( miterSum )
			const miter = miterLength.greaterThan( EPSILON ).select(
				miterSum.div( max( miterLength, EPSILON ) ),
				outgoingSide,
			)
			const denominator = max( abs( dot( miter, outgoingSide ) ), EPSILON )
			const miterScale = this.halfWidthNode.div( denominator )
			const miterOffset = miter.mul( miterScale )
			// A valid miter can still be unsupported by very short legs. Bound its
			// longitudinal setback on both; unsupported joins keep the owning
			// segment's full-width side instead of folding.
			const support = max(
				abs( dot( miterOffset, incoming ) ),
				abs( dot( miterOffset, outgoing ) ),
			)
			const available = min(
				max( incomingLength, EPSILON ),
				max( outgoingLength, EPSILON ),
			).mul( float( RIBBON_JOIN_SUPPORT_FRACTION ) )
			const miterSupported = miterLength.greaterThan( EPSILON )
				.and( miterScale.lessThanEqual( this.halfWidthNode.mul( float( RIBBON_MITER_LIMIT ) ) ) )
				.and( support.lessThanEqual( available ) )
			const bodySide = segmentEnd.select( incomingSide, outgoingSide )
			const offset = miterSupported.select( miterOffset, bodySide.mul( this.halfWidthNode ) )
			// Keep the ribbon on the camera's side of the centerline so a hidden
			// interval cannot leak a rail through the projection singularity.
			const clipW = abs( this.projectionViewNode.mul( vec4( point, 1 ) ).w )
			const projectionSafeScale = min(
				float( 1 ),
				clipW.mul( float( RIBBON_CAMERA_PLANE_OFFSET_FRACTION ) )
					.div( max( length( offset ), EPSILON ) ),
			)
			const safeOffset = offset.mul( projectionSafeScale )
			return positiveSide.select( point.add( safeOffset ), point.sub( safeOffset ) )
		} )

		// A segment whose two ends belong to different polylines is collapsed to a
		// point instead of stitching the end of one stroke to the start of the next.
		const breaksAt = segmentIndex =>
			sameLine( segmentIndex, min( segmentIndex.add( uint( 1 ) ), lastIndex ) ).not()

		const triangleVertex = vertexIndex.toUint().mod( uint( RIBBON_VERTICES_PER_SEGMENT ) )
		const triangleSegment = vertexIndex.toUint().div( uint( RIBBON_VERTICES_PER_SEGMENT ) )
		const ribbonBodyVertex = triangleVertex.lessThan( uint( 6 ) )
		const bodyVertex = triangleVertex.mod( uint( 6 ) )
		const bodyUsesNext = bodyVertex.equal( uint( 2 ) )
			.or( bodyVertex.equal( uint( 3 ) ) )
			.or( bodyVertex.equal( uint( 5 ) ) )
		const bodyPositiveSide = bodyVertex.equal( uint( 1 ) )
			.or( bodyVertex.equal( uint( 4 ) ) )
			.or( bodyVertex.equal( uint( 5 ) ) )

		// Each segment reserves two triangles at its far end. They collapse for a
		// supported shared miter; otherwise one outer half-wedge bridges the
		// incoming and outgoing full-width bodies.
		const joinVertex = triangleVertex.sub( uint( 6 ) )
		const joinPointIndex = min( triangleSegment.add( uint( 1 ) ), lastIndex )
		const joinCenter = positionAt( joinPointIndex )
		const joinPrevious = positionAt( previousOf( joinPointIndex ) )
		const joinNext = positionAt( nextOf( joinPointIndex ) )
		const joinCenterVertex = joinVertex.equal( uint( 0 ) ).or( joinVertex.equal( uint( 3 ) ) )
		const joinPositiveSide = joinVertex.lessThan( uint( 3 ) )
		const joinUsesIncoming = joinVertex.equal( uint( 1 ) ).or( joinVertex.equal( uint( 5 ) ) )
		const joinTurn = dot(
			cross( joinCenter.sub( joinPrevious ), joinNext.sub( joinCenter ) ),
			vec3( 0, 0, 1 ),
		)
		const joinIsOuter = joinTurn.lessThan( float( 0 ) )
			.select( joinPositiveSide, joinPositiveSide.not() )
		const ribbonPositiveSide = ribbonBodyVertex.select( bodyPositiveSide, joinPositiveSide )
		const ribbonPointIndex = ribbonBodyVertex.select(
			triangleSegment.add( bodyUsesNext.select( uint( 1 ), uint( 0 ) ) ),
			joinPointIndex,
		)
		const ribbonSegmentEnd = ribbonBodyVertex.select( bodyUsesNext, joinUsesIncoming )
		const evaluatedRibbonPoint = ribbonPoint( ribbonPointIndex, ribbonPositiveSide, ribbonSegmentEnd )
		const joinPosition = joinCenterVertex.or( joinIsOuter.not() ).select( joinCenter, evaluatedRibbonPoint )
		const ribbonPosition = breaksAt( triangleSegment ).select(
			positionAt( triangleSegment ),
			ribbonBodyVertex.select( evaluatedRibbonPoint, joinPosition ),
		)

		const lineVertex = vertexIndex.toUint().mod( uint( LINE_VERTICES_PER_SEGMENT ) )
		const lineSegment = vertexIndex.toUint().div( uint( LINE_VERTICES_PER_SEGMENT ) )
		const linePosition = breaksAt( lineSegment ).select(
			positionAt( lineSegment ),
			positionAt( lineSegment.add( lineVertex ) ),
		)

		// Topology overlay: the two ribbon rails plus one transverse rib per
		// segment. Enough to read the emitted vertex density without turning the
		// dense regions into an unreadable hairball.
		const wireVertex = vertexIndex.toUint().mod( uint( WIREFRAME_VERTICES_PER_SEGMENT ) )
		const wireSegment = vertexIndex.toUint().div( uint( WIREFRAME_VERTICES_PER_SEGMENT ) )
		const wireEndPoint = min( wireSegment.add( uint( 1 ) ), lastIndex )
		const wireEndCenter = positionAt( wireEndPoint )
		const wireChordVisible = length( wireEndCenter.sub( positionAt( wireSegment ) ) )
			.greaterThanEqual( this.halfWidthNode.mul( 2 ) )
		const wireUsesEnd = wireVertex.equal( uint( 0 ) ).or( wireVertex.equal( uint( 2 ) ) ).not()
		const wirePositiveSide = wireVertex.equal( uint( 2 ) )
			.or( wireVertex.equal( uint( 3 ) ) )
			.or( wireVertex.equal( uint( 5 ) ) )
		const wireRibbonPoint = ribbonPoint(
			wireUsesEnd.select( wireEndPoint, wireSegment ),
			wirePositiveSide,
			wireUsesEnd,
		)
		const wireframePosition = wireVertex.greaterThanEqual( uint( 4 ) )
			.and( wireChordVisible.not() )
			.select( wireEndCenter, wireRibbonPoint )
		const wireframeFinal = breaksAt( wireSegment ).select( positionAt( wireSegment ), wireframePosition )

		const segmentHeat = segmentIndex => gapStorage === null
			? float( 0 )
			: log2( max( float( gapStorage.element( min( segmentIndex, lastIndex ) ) ), 1 ) )
				// A fixed reference so the heatmap keeps meaning the same thing while
				// the chunk lattice moves with the tolerance.
				.div( float( Math.log2( SIMPLIFICATION_CHUNK_MAX ) ) )
				.clamp( 0, 1 )
		const heatColor = heat => {
			const coolToMint = mix( color( 0x38bdf8 ), color( 0x5eead4 ), smoothstep( 0.05, 0.42, heat ) )
			const mintToAmber = mix( coolToMint, color( 0xfacc15 ), smoothstep( 0.34, 0.74, heat ) )
			return mix( mintToAmber, color( 0xfb7185 ), smoothstep( 0.7, 1, heat ) )
		}
		const shade = ( segmentIndex, positiveSide ) => gapStorage === null
			? mix( color( 0x0e7490 ), color( 0x67e8f9 ), positiveSide ? float( 0.55 ) : float( 0.25 ) )
			: heatColor( segmentHeat( segmentIndex ) )

		const ribbonMaterial = new MeshBasicNodeMaterial( { side: DoubleSide } )
		ribbonMaterial.positionNode = ribbonPosition
		ribbonMaterial.colorNode = gapStorage === null
			? mix( color( 0x155e75 ), color( 0x7dd3fc ), ribbonPositiveSide.select( float( 1 ), float( 0 ) ) )
			: heatColor( segmentHeat( triangleSegment ) )

		const lineMaterial = new LineBasicNodeMaterial()
		lineMaterial.positionNode = linePosition
		lineMaterial.colorNode = shade( lineSegment, true )

		const wireframeMaterial = new LineBasicNodeMaterial()
		wireframeMaterial.positionNode = wireframeFinal
		wireframeMaterial.colorNode = shade( wireSegment, true )

		return {
			lines: this._createGpuRenderObject( LineSegments, lineMaterial, indirectAttribute, LINE_DRAW_OFFSET ),
			ribbons: this._createGpuRenderObject( Mesh, ribbonMaterial, indirectAttribute, RIBBON_DRAW_OFFSET ),
			wireframe: this._createGpuRenderObject(
				LineSegments,
				wireframeMaterial,
				indirectAttribute,
				WIREFRAME_DRAW_OFFSET,
			),
		}
	}

	_createGpuRenderObject( ObjectType, material, indirectAttribute, indirectOffset ) {
		// A one-vertex placeholder gives Three a finite non-indexed draw range. The
		// indirect command owns the real count and positionNode is fully procedural,
		// so no capacity-sized vertex buffers are ever allocated.
		const placeholder = new BufferGeometry()
		placeholder.setAttribute( 'position', new BufferAttribute( new Float32Array( [0, 0, 0] ), 3 ) )
		placeholder.setIndirect( indirectAttribute, indirectOffset )

		const object = new ObjectType( placeholder, material )
		object.frustumCulled = false
		object.matrixAutoUpdate = false
		object.matrix.identity()
		object.matrixWorld.identity()
		object.visible = false

		this.geometries.push( placeholder )
		this.materials.push( material )
		this.renderObjects.push( object )
		return object
	}

	// -----------------------------------------------------------------------
	// dispatch and measurement
	// -----------------------------------------------------------------------

	_applySettings() {
		const { pixelTolerance, worldTolerance } = this.settings
		this.inverseWorldToleranceNode.value = worldTolerance > 0 ? 1 / worldTolerance : HUGE_TOLERANCE_SCALE
		this.inversePixelToleranceNode.value = pixelTolerance > 0 ? 1 / pixelTolerance : HUGE_TOLERANCE_SCALE
		this.screenEnabledNode.value = this.cameraLod ? 1 : 0
		if ( this._resolveChunkPlan() && this.sourceAttribute ) this._uploadChunkPlan()
		this._rebuildNodeList()

		Object.assign( this.ui, {
			cameraLod: this.cameraLod,
			level: this.settings.level,
			pixelTolerance: this.settings.pixelTolerance,
			relax: this.relaxIterations,
			worldTolerance: this.settings.worldTolerance,
		} )
		Object.assign( this.metrics, {
			cameraLod: this.cameraLod,
			chunkSegments: this.chunkSegments,
			pixelTolerance: this.settings.pixelTolerance,
			relaxIterations: this.relaxIterations,
			simplificationLevel: this.settings.level,
			worldTolerance: this.settings.worldTolerance,
		} )
	}

	_dispatch() {
		const start = performance.now()
		stage3d.renderer.compute( this.simplificationNodes )
		const cpuSubmitMs = performance.now() - start
		this.metrics.computeSubmissions++
		this.metrics.dispatchCount += this.simplificationNodes.length
		this.metrics.rebuildCount++
		this.metrics.cpuSubmitMs = cpuSubmitMs
		return cpuSubmitMs
	}

	_updateCameraUniforms( force = false ) {
		const camera = stage3d.camera
		camera.updateWorldMatrix( true, false )
		camera.matrixWorldInverse.copy( camera.matrixWorld ).invert()
		this._projectionView.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
		stage3d.renderer.getDrawingBufferSize( this._viewport )
		// Screen budgets are quoted in CSS pixels so the same camera framing is
		// equally aggressive on DPR 1, 2 and 3.
		const cssViewport = resolveCssPixelViewport(
			this._viewport.x,
			this._viewport.y,
			stage3d.renderer.getPixelRatio(),
		)
		this._viewport.set( cssViewport.width, cssViewport.height )

		const matrixChanged = this._projectionView.elements.some( ( value, index ) =>
			Math.abs( value - this._lastProjectionView.elements[index] ) > CAMERA_MATRIX_EPSILON
		)
		const viewportChanged = !this._viewport.equals( this._lastViewport )
		if ( !force && !matrixChanged && !viewportChanged ) return false

		this._lastProjectionView.copy( this._projectionView )
		this._lastViewport.copy( this._viewport )
		this.projectionViewNode.value.copy( this._projectionView )
		this.viewportNode.value.copy( this._viewport )
		return true
	}

	_queueRebuild( settledStatus ) {
		if ( this._disposed || this.metrics?.fallback ) return
		if ( this._pendingRebuildTimer !== null ) window.clearTimeout( this._pendingRebuildTimer )
		if ( this._settledMeasurementTimer !== null ) window.clearTimeout( this._settledMeasurementTimer )
		if ( this._cpuReferenceTimer !== null ) window.clearTimeout( this._cpuReferenceTimer )
		this._pendingRebuildTimer = null
		this._settledMeasurementTimer = null

		const generation = ++this._measurementGeneration
		this.ui.busy = true
		if ( this.metrics ) this.metrics.busy = true
		this._measurementChain = this._measurementChain
			.catch( () => {} )
			.then( async() => {
				if ( generation !== this._measurementGeneration || this._disposed ) return
				this._updateCameraUniforms( true )
				if ( this._resolveChunkPlan() && this.sourceAttribute ) this._uploadChunkPlan()
				await this._performMeasuredRebuild( generation, settledStatus )
			} )
			.catch( error => {
				if ( !this._disposed ) {
					this._activateCpuFallback( 'GPU simplification update failed; drawing the source lines.', error )
				}
			} )
	}

	async _performMeasuredRebuild( generation, settledStatus = 'Simplified' ) {
		if ( generation !== this._measurementGeneration || this._disposed ) return
		this._measurementActive = true
		this.metrics.readbackError = null
		const renderer = stage3d.renderer
		let gpuComputeMs = null
		let timingSource = null
		let cpuSubmitMs = null

		try {
			// compute() only submits work. Timestamp queries give the real GPU
			// duration; queue completion is an honest wall-time fallback.
			const wallStart = performance.now()
			if ( this._gpuTimingSupported ) {
				const previousTrackTimestamp = renderer.backend.trackTimestamp
				let renderDrain = null
				renderer.backend.trackTimestamp = true
				try {
					if ( previousTrackTimestamp ) await renderer.resolveTimestampsAsync( 'compute' )
					if ( generation !== this._measurementGeneration || this._disposed ) return
					// The first dispatch after a pipeline or dataset change carries
					// one-off driver work. Run it, throw the reading away, and report
					// the steady-state pass instead of a cold-start outlier.
					if ( this._needsWarmup ) {
						this._needsWarmup = false
						this._dispatch()
						await renderer.resolveTimestampsAsync( 'compute' )
						if ( generation !== this._measurementGeneration || this._disposed ) return
					}
					cpuSubmitMs = this._dispatch()
					gpuComputeMs = await renderer.resolveTimestampsAsync( 'compute' )
					timingSource = 'timestamp-query'
					if ( !previousTrackTimestamp ) renderDrain = renderer.resolveTimestampsAsync( 'render' )
				} finally {
					renderer.backend.trackTimestamp = previousTrackTimestamp
				}
				if ( renderDrain ) await renderDrain
			} else {
				cpuSubmitMs = this._dispatch()
				if ( renderer.backend?.device?.queue?.onSubmittedWorkDone ) {
					await renderer.backend.device.queue.onSubmittedWorkDone()
					gpuComputeMs = performance.now() - wallStart
					timingSource = 'queue-completion-wall-time'
				}
			}

			if (
				!( Number.isFinite( gpuComputeMs ) && gpuComputeMs > 0 ) &&
				renderer.backend?.device?.queue?.onSubmittedWorkDone
			) {
				const queueStart = performance.now()
				if ( cpuSubmitMs === null ) cpuSubmitMs = this._dispatch()
				await renderer.backend.device.queue.onSubmittedWorkDone()
				gpuComputeMs = performance.now() - queueStart
				timingSource = 'queue-completion-wall-time'
			}
			if ( !( Number.isFinite( gpuComputeMs ) && gpuComputeMs > 0 ) && Number.isFinite( cpuSubmitMs ) ) {
				gpuComputeMs = cpuSubmitMs
				timingSource = 'cpu-submit-time'
			}

			if ( generation !== this._measurementGeneration || this._disposed ) return
			await this._readState( generation )
			if ( generation !== this._measurementGeneration || this._disposed ) return
			// The oracle is single-threaded and takes the best part of a second on
			// the larger datasets — that contrast is the point, but it must not be
			// the reason the GPU numbers are slow to appear. Show them first.
			this._scheduleCpuReference( generation )

			const finiteGpuTime = Number.isFinite( gpuComputeMs ) ? gpuComputeMs : null
			Object.assign( this.ui, {
				busy: false,
				gpuComputeMs: finiteGpuTime,
				status: settledStatus,
				timingSource,
				timingSupported: finiteGpuTime !== null,
			} )
			Object.assign( this.metrics, {
				busy: false,
				cpuSubmitMs,
				gpuComputeMs: finiteGpuTime,
				gpuTimingSource: timingSource,
			} )
		} finally {
			this._measurementActive = false
		}
	}

	async _readState( generation ) {
		try {
			const buffer = await stage3d.renderer.getArrayBufferAsync( this.stateAttribute )
			if ( generation !== this._measurementGeneration || this._disposed ) return
			const state = new Uint32Array( buffer )
			const retained = state[0]
			if ( !Number.isSafeInteger( retained ) || retained < 1 || retained > this.dataset.pointCount ) {
				throw new Error( `GPU returned an invalid retained count (${retained}).` )
			}
			this.ui.retainedPointCount = retained
			this.metrics.retainedPointCount = retained
			this.metrics.emittedSegments = state[2]
		} catch ( error ) {
			if ( generation !== this._measurementGeneration || this._disposed ) return
			this.metrics.readbackError = error instanceof Error ? error.message : String( error )
			console.warn( '[gpuSimplification] retained-count readback failed:', error )
		}
	}

	_scheduleCpuReference( generation ) {
		if ( this._cpuReferenceTimer !== null ) window.clearTimeout( this._cpuReferenceTimer )
		this._cpuReferenceTimer = null
		if ( !this.validateAgainstCpu || this.cameraLod || !this.dataset ) {
			this._clearCpuReference()
			return
		}
		this.ui.cpuReferencePending = true
		this._cpuReferenceTimer = window.setTimeout( () => {
			this._cpuReferenceTimer = null
			if ( generation !== this._measurementGeneration || this._disposed ) return
			this._runCpuReference()
		}, 60 )
	}

	_clearCpuReference() {
		this.ui.cpuReferenceCount = null
		this.ui.cpuReferenceMs = null
		this.ui.cpuReferencePending = false
		if ( !this.metrics ) return
		this.metrics.cpuReferenceCount = null
		this.metrics.cpuReferenceDelta = null
		this.metrics.cpuReferenceMs = null
	}

	/**
	 * Runs the same relaxation and the textbook Douglas-Peucker on the CPU and
	 * reports the difference. This is the claim "the port is faithful", measured
	 * rather than asserted — and it doubles as the GPU-versus-CPU speed comparison.
	 */
	_runCpuReference() {
		if ( !this.validateAgainstCpu || this.cameraLod || !this.dataset ) {
			this._clearCpuReference()
			return
		}
		const start = performance.now()
		const relaxed = relaxPositions(
			this.dataset.positions,
			this.neighbourArray,
			this.relaxIterations,
		)
		const { count } = simplifyChunkedDouglasPeucker(
			relaxed,
			this.chunkPlan,
			this.settings.worldTolerance,
		)
		const elapsed = performance.now() - start
		this.ui.cpuReferenceCount = count
		this.ui.cpuReferenceMs = elapsed
		this.ui.cpuReferencePending = false
		this.metrics.cpuReferenceCount = count
		this.metrics.cpuReferenceMs = elapsed
		this.metrics.cpuReferenceDelta = this.ui.retainedPointCount == null
			? null
			: this.ui.retainedPointCount - count
	}

	// -----------------------------------------------------------------------
	// public API used by the HUD
	// -----------------------------------------------------------------------

	setDataset = datasetId => {
		if ( this._disposed || this.dataset?.id === datasetId ) return
		if ( !VECTOR_DATASETS.some( dataset => dataset.id === datasetId ) ) return
		this._loadDataset( datasetId )
		if ( this.metrics?.fallback ) {
			this._rebuildFallbackLines()
			return
		}
		this._uploadDataset()
		this._queueRebuild( `${this.dataset.label} relaxed and simplified` )
	}

	setSimplificationLevel = ( level, commit = false ) => {
		if ( this._disposed || this.metrics?.fallback ) return
		if ( this.view.detail !== 'after' ) {
			this.view.detail = 'after'
			this.ui.detail = 'after'
			this._syncView()
		}
		this.settings = resolveSimplificationSettings( level, WORLD_SIZE )
		this._applySettings()
		this.ui.busy = true
		this.ui.status = commit ? 'Measuring the settled result…' : 'Previewing…'
		if ( commit ) this._queueRebuild( 'Simplified' )
		else this._scheduleInteractiveDispatch()
	}

	setRelax = ( iterations, commit = false ) => {
		if ( this._disposed || this.metrics?.fallback ) return
		this.relaxIterations = resolveRelaxIterations( iterations )
		this._applySettings()
		this.ui.busy = true
		this.ui.status = commit ? 'Measuring the settled result…' : 'Relaxing…'
		if ( commit ) {
			this._queueRebuild( this.relaxIterations > 0
				? 'Relaxed, then simplified'
				: 'Simplified straight from the source' )
		} else {
			this._scheduleInteractiveDispatch()
		}
	}

	setCameraLod = enabled => {
		if ( this._disposed || this.metrics?.fallback ) return
		this.cameraLod = !!enabled
		this._applySettings()
		this._queueRebuild( this.cameraLod ? 'Screen-space LOD active' : 'Simplified once, world-space only' )
	}

	setDetailView = detail => {
		if ( detail !== 'before' && detail !== 'after' ) return
		if ( this.metrics?.fallback && detail === 'after' ) return
		this.view.detail = detail
		this.ui.detail = detail
		this._syncView()
	}

	setRenderMode = mode => {
		if ( !['lines', 'ribbons', 'wireframe'].includes( mode ) ) return
		this.view.renderMode = mode
		this.ui.renderMode = mode
		this._syncView()
	}

	setLineWidth = width => {
		if ( this._disposed ) return
		const clamped = Math.min( MAX_LINE_WIDTH, Math.max( MIN_LINE_WIDTH, Number( width ) || DEFAULT_LINE_WIDTH ) )
		this.lineWidth = Math.round( clamped * 100 ) / 100
		this.ui.lineWidth = this.lineWidth
		if ( this.metrics ) this.metrics.lineWidth = this.lineWidth
		if ( this.halfWidthNode ) this.halfWidthNode.value = this.lineWidth * 0.5
		for ( const line of this.fallbackLines ) line.lineWidth( this.lineWidth )
	}

	_scheduleInteractiveDispatch() {
		if ( this._pendingRebuildTimer !== null ) return
		this._pendingRebuildTimer = window.setTimeout( () => {
			this._pendingRebuildTimer = null
			if ( this._disposed || this.metrics?.fallback || this._measurementActive ) return
			this._queueRebuild( 'Simplified' )
		}, 45 )
	}

	_syncView() {
		if ( this.metrics?.fallback ) {
			this.view.detail = 'before'
			this.ui.detail = 'before'
			for ( const line of this.fallbackLines ) line.visible = true
		} else {
			for ( const detail of Object.values( this.renderSets ) ) {
				for ( const object of Object.values( detail ) ) object.visible = false
			}
			const active = this.renderSets[this.view.detail]?.[this.view.renderMode]
			if ( active ) active.visible = true
			this.mesh = active ?? null
		}
		if ( this.metrics ) {
			this.metrics.renderMode = this.view.renderMode
			this.metrics.view = this.view.detail
		}
	}

	update = () => {
		if ( !this.metrics?.ready ) return
		if ( this._updateCameraUniforms() ) {
			this._cameraLodDirty = true
		}
		// World-space simplification is camera independent, so the default path
		// dispatches exactly once and then never touches the GPU again. Only the
		// opt-in screen-space LOD re-runs, and then at a capped rate.
		if (
			!this.cameraLod ||
			this._updating ||
			this._measurementActive ||
			!this._cameraLodDirty ||
			this.view.detail !== 'after'
		) return
		const now = performance.now()
		if ( now - this._lastCameraLodTime < CAMERA_LOD_INTERVAL_MS ) return
		this._cameraLodDirty = false
		this._lastCameraLodTime = now
		this._updating = true
		try {
			if ( this._resolveChunkPlan() && this.sourceAttribute ) this._uploadChunkPlan()
			this._dispatch()
			this._scheduleSettledMeasurement()
		} catch ( error ) {
			this._activateCpuFallback( 'GPU simplification update failed; drawing the source lines.', error )
		} finally {
			this._updating = false
		}
	}

	_scheduleSettledMeasurement() {
		this.ui.busy = true
		this.ui.status = 'Adapting to the camera…'
		if ( this._settledMeasurementTimer !== null ) window.clearTimeout( this._settledMeasurementTimer )
		this._settledMeasurementTimer = window.setTimeout( () => {
			this._settledMeasurementTimer = null
			this._queueRebuild( 'Screen-space LOD settled' )
		}, SETTLED_MEASUREMENT_DELAY_MS )
	}

	// -----------------------------------------------------------------------
	// fallback and teardown
	// -----------------------------------------------------------------------

	_activateCpuFallback( reason, error = null ) {
		const pendingMeasurement = this._measurementChain
		this._measurementGeneration++
		stage.onUpdate.remove( this.update )
		if ( this._pendingRebuildTimer !== null ) window.clearTimeout( this._pendingRebuildTimer )
		if ( this._settledMeasurementTimer !== null ) window.clearTimeout( this._settledMeasurementTimer )
		if ( this._cpuReferenceTimer !== null ) window.clearTimeout( this._cpuReferenceTimer )
		this._pendingRebuildTimer = null
		this._settledMeasurementTimer = null
		this._cpuReferenceTimer = null
		this._disposeGpuResources( pendingMeasurement )
		this.view.detail = 'before'

		if ( this.metrics ) {
			this.metrics.busy = false
			this.metrics.error = error instanceof Error ? error.message : error ? String( error ) : reason
			this.metrics.fallback = 'cpu-full-detail'
			this.metrics.ready = true
		}
		this._rebuildFallbackLines()
		Object.assign( this.ui, {
			backend: 'webgl2',
			busy: false,
			gpuComputeMs: null,
			retainedPointCount: this.dataset?.pointCount ?? null,
			status: reason,
			timingSupported: false,
		} )
		this._syncView()
		console.warn( `[gpuSimplification] ${reason}`, error ?? '' )
	}

	_rebuildFallbackLines() {
		for ( const line of this.fallbackLines ) {
			stage3d.remove( line )
			line.dispose()
		}
		this.fallbackLines = []
		if ( !this.dataset ) return

		for ( const range of this.dataset.ranges ) {
			const points = new Float32Array( ( range.end - range.start + 1 ) * 3 )
			for ( let index = range.start; index <= range.end; index++ ) {
				const target = ( index - range.start ) * 3
				points[target] = this.dataset.positions[index * 4]
				points[target + 1] = this.dataset.positions[index * 4 + 1]
				points[target + 2] = this.dataset.positions[index * 4 + 2]
			}
			const line = new MeshLine()
				.lines( points )
				.lineWidth( this.lineWidth )
				.color( 0x67e8f9 )
				.join( { limit: MITER_LIMIT, type: 'miter' } )
				.build()
			stage3d.add( line )
			this.fallbackLines.push( line )
		}
	}

	_disposeGpuResources( pendingMeasurement = null ) {
		const computeNodes = [...new Set( this.simplificationNodes )]
		const geometries = this.geometries
		const materials = this.materials
		for ( const object of this.renderObjects ) stage3d.remove( object )
		this.mesh = null
		this.simplificationNodes = []
		this.renderObjects = []
		this.geometries = []
		this.materials = []
		this.renderSets = { after: {}, before: {} }
		this.storageAttributes = []
		this.stateAttribute = null
		this.compactedAttribute = null

		const dispose = () => {
			for ( const node of computeNodes ) node?.dispose?.()
			for ( const geometry of geometries ) geometry.dispose()
			for ( const material of materials ) material.dispose()
		}
		if ( pendingMeasurement ) {
			// A readback can still be mapping a GPU buffer while a route change
			// tears the view down. Detach now, free once it settles.
			Promise.resolve( pendingMeasurement ).catch( () => {} ).finally( dispose )
		} else {
			dispose()
		}
	}

	dispose() {
		const pendingMeasurement = this._measurementChain
		this._disposed = true
		this._measurementGeneration++
		if ( this._pendingRebuildTimer !== null ) window.clearTimeout( this._pendingRebuildTimer )
		if ( this._settledMeasurementTimer !== null ) window.clearTimeout( this._settledMeasurementTimer )
		if ( this._cpuReferenceTimer !== null ) window.clearTimeout( this._cpuReferenceTimer )
		stage.onUpdate.remove( this.update )
		this._disposeGpuResources( pendingMeasurement )
		for ( const line of this.fallbackLines ) {
			stage3d.remove( line )
			line.dispose()
		}
		this.fallbackLines = []
		this.bloom?.dispose()
		this.bloom = null
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		if ( window.__meshLineGpuSimplificationMetrics === this.metrics ) {
			window.__meshLineGpuSimplificationMetrics = null
		}
		if ( this.metrics ) this.metrics.ready = false
		this.control = null
		this.dataset = null
		this.metrics = null
	}

}

export default GpuSimplificationPrototypeExample
