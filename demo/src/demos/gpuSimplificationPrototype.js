/**
 * GPU Simplification Prototype — hierarchical Douglas-Peucker polyline simplification in WebGPU compute shaders.
 * Demonstrates: WebGPU compute simplification passes, prefix-sum compaction, indirect draw commands,
 * and a full-detail MeshLine fallback without native WebGPU.
 *
 * The passes live in utils/gpuSimplificationCompute.js, the ribbon in utils/gpuSimplificationRibbon.js,
 * the rebuild scheduling in utils/gpuSimplificationRebuilds.js.
 */
import { MeshLine } from 'makio-meshline'
import { MathUtils } from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import GpuSimplificationUI from '@/components/GpuSimplification.vue'
import { buildVectorDataset, VECTOR_DATASETS, WORLD_SIZE } from '@/data/vectorDatasets'
import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { buildChunkPlan, resolveChunkSegments, resolveSimplificationSettings } from '@/utils/gpuSimplification'
import { CHUNK_CAPACITY, POINT_CAPACITY } from '@/utils/gpuSimplificationCompute'
import { DEFAULT_RADIUS, readOptions } from '@/utils/gpuSimplificationOptions'
import { createSimplificationMetrics, SimplificationPipeline } from '@/utils/gpuSimplificationPipeline'
import { errorText, SimplificationRebuilds } from '@/utils/gpuSimplificationRebuilds'
import { linePoints } from '@/utils/points'

const CAMERA_LOD_INTERVAL_MS = 1000 / 15

// The dataset packs xyz plus a line id per point; MeshLine takes plain xyz.
const rangePoints = ( positions, { start, end } ) => linePoints( end - start + 1, ( t, index ) => {
	const offset = ( start + index ) * 4
	return positions.subarray( offset, offset + 3 )
} )

export default class GpuSimplificationPrototypeExample {
	uiComponent = markRaw( GpuSimplificationUI )
	datasets = VECTOR_DATASETS
	options = readOptions()
	settings = resolveSimplificationSettings( this.options.level, WORLD_SIZE )
	ui = reactive( {
		backend: 'initializing',
		busy: true,
		datasetId: this.options.datasetId,
		gpuComputeMs: null,
		level: this.settings.level,
		renderMode: this.options.renderMode,
		retainedPointCount: null,
		sourcePointCount: 0,
		visible: !noUI,
	} )
	metrics = createSimplificationMetrics( this.options, this.settings )
	rebuilds = new SimplificationRebuilds( this )
	lastCameraLodTime = -Infinity

	async init() {
		window.__meshLineGpuSimplificationMetrics = this.metrics

		try {
			await stage3d.initRender( { background: 0x050913, far: 640 } )
			if ( this.disposed ) return
			this.metrics.backend = stage3d.backend

			// These datasets are flat vector art. Allow enough tilt to show what
			// perspective does to a screen-space error budget, but never enough to
			// turn the drawing edge-on.
			stage3d.orbit( this.options.radius, {
				minRadius: 12,
				maxRadius: 320,
				isThetaRestricted: true,
				minTheta: Math.PI * 0.5 - 0.85,
				maxTheta: Math.PI * 0.5 + 0.85,
				minPhi: Math.PI * 0.5 - 0.75,
				maxPhi: Math.PI * 0.5 + 0.75,
				extraPhiMouse: false,
				extraThetaMouse: false,
			} )
			createBloomPipeline( { strength: 0.55, radius: 0.3, threshold: 0.15 } )

			this.loadDataset( this.options.datasetId )

			if ( !stage3d.isWebGPU ) {
				this.activateCpuFallback( 'Native WebGPU is unavailable; drawing the source lines at full detail.' )
				return
			}

			this.ui.backend = 'webgpu'
			this.pipeline = new SimplificationPipeline( this.options, this.metrics )
			this.pipeline.uploadDataset( this.dataset, this.chunkPlan )
			this.applySettings()
			this.pipeline.updateCamera( true )
			await this.rebuilds.start()
			if ( !this.pipeline ) return

			stage3d.add( ...this.pipeline.renderObjects )
			this.syncView()
			this.metrics.ready = true
			this.ui.busy = false
		} catch ( error ) {
			this.activateCpuFallback( 'GPU simplification failed; drawing the source lines at full detail.', error )
		}
	}

	loadDataset( id ) {
		this.dataset = buildVectorDataset( id, POINT_CAPACITY )
		const { lineCount, pointCount } = this.dataset
		this.chunkSegments = 0
		this.resolveChunkPlan()
		this.ui.datasetId = id
		this.ui.sourcePointCount = pointCount
		Object.assign( this.metrics, { datasetId: id, lineCount, sourcePointCount: pointCount } )
	}

	// Recomputes the chunk lattice for the current tolerance. Chunk length is a
	// power of two, so dragging the slider only rebuilds the plan on a real step
	// rather than on every input event.
	resolveChunkPlan() {
		// The camera orbits the origin, so its distance from it is the current, eased radius.
		const zoomScale = this.options.cameraLod
			? MathUtils.clamp( stage3d.camera.position.length() / DEFAULT_RADIUS, 0.1, 1 )
			: 1
		const segments = resolveChunkSegments( this.settings.relativeTolerance * zoomScale, this.dataset.pointCount )
		if ( segments === this.chunkSegments ) return

		this.chunkSegments = segments
		this.chunkPlan = buildChunkPlan( this.dataset.ranges, segments, CHUNK_CAPACITY )
		this.metrics.chunkCount = this.chunkPlan.length
		this.metrics.chunkSegments = segments
		this.pipeline?.uploadChunkPlan( this.chunkPlan )
	}

	applySettings() {
		const { level, pixelTolerance, worldTolerance } = this.settings
		this.pipeline.setTolerance( this.settings )
		this.resolveChunkPlan()
		this.ui.level = level
		Object.assign( this.metrics, { pixelTolerance, simplificationLevel: level, worldTolerance } )
	}

	setDataset( id ) {
		if ( this.dataset?.id === id ) return
		this.loadDataset( id )
		if ( this.metrics.fallback ) {
			this.rebuildFallbackLines()
			return
		}
		this.pipeline.uploadDataset( this.dataset, this.chunkPlan )
		this.rebuilds.queue()
	}

	setSimplificationLevel( level, commit = false ) {
		if ( this.metrics.fallback ) return
		this.settings = resolveSimplificationSettings( level, WORLD_SIZE )
		this.applySettings()
		this.ui.busy = true
		if ( commit ) this.rebuilds.queue()
		else this.rebuilds.scheduleInteractive()
	}

	setRenderMode( mode ) {
		this.ui.renderMode = mode
		this.syncView()
	}

	syncView() {
		const { renderMode } = this.ui
		this.pipeline?.show( renderMode )
		this.metrics.renderMode = renderMode
	}

	update = () => {
		if ( !this.pipeline ) return
		if ( this.pipeline.updateCamera() ) this.cameraLodDirty = true

		// World-space simplification is camera independent, so the default path
		// dispatches exactly once and then never touches the GPU again. Only the
		// opt-in screen-space LOD re-runs, and then at a capped rate.
		if ( !this.options.cameraLod || this.rebuilds.measuring || !this.cameraLodDirty ) return
		const now = performance.now()
		if ( now - this.lastCameraLodTime < CAMERA_LOD_INTERVAL_MS ) return

		this.cameraLodDirty = false
		this.lastCameraLodTime = now
		try {
			this.resolveChunkPlan()
			this.pipeline.dispatch()
			this.rebuilds.scheduleSettled()
		} catch ( error ) {
			this.activateCpuFallback( 'GPU simplification update failed; drawing the source lines.', error )
		}
	}

	activateCpuFallback( reason, error ) {
		if ( this.disposed ) return
		this.stopGpu()
		Object.assign( this.metrics, {
			busy: false,
			error: error ? errorText( error ) : reason,
			fallback: 'cpu-full-detail',
			ready: true,
		} )
		this.rebuildFallbackLines()
		Object.assign( this.ui, {
			backend: 'webgl2',
			busy: false,
			gpuComputeMs: null,
			retainedPointCount: this.dataset?.pointCount ?? null,
		} )
		this.syncView()
		console.warn( `[gpuSimplification] ${reason}`, error ?? '' )
	}

	// Every polyline of the dataset in one batched line: one draw call, and a
	// dynamic line takes the next dataset into the buffers it already has.
	rebuildFallbackLines() {
		if ( !this.dataset ) return

		const lines = this.dataset.ranges.map( range => rangePoints( this.dataset.positions, range ) )
		if ( this.fallbackLine ) {
			this.fallbackLine.lines( lines )
			return
		}
		this.fallbackLine = new MeshLine()
			.lines( lines )
			.dynamic( true )
			.lineWidth( this.options.lineWidth )
			.color( 0x67e8f9 )
			.autoResize()
		stage3d.add( this.fallbackLine )
	}

	stopGpu() {
		this.rebuilds.cancel()
		this.pipeline?.dispose( this.rebuilds.chain )
		this.pipeline = null
	}

	dispose() {
		this.disposed = true
		this.stopGpu()
		if ( window.__meshLineGpuSimplificationMetrics === this.metrics ) {
			window.__meshLineGpuSimplificationMetrics = null
		}
		this.metrics.ready = false
	}
}
