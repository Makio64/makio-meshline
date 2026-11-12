/**
 * Resident GPU state of the simplification lab: the buffers, their uploads, the
 * dispatch list with its timing, and the draw objects. Nothing here depends on
 * the dataset, so switching datasets never recompiles a shader.
 */
import { storage, uint, uniform } from 'three/tsl'
import { IndirectStorageBufferAttribute, Matrix4, StorageBufferAttribute, Vector2 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { buildNeighbourPlan, resolveCssPixelViewport, SIMPLIFICATION_REFINE_PASSES } from '@/utils/gpuSimplification'
import {
	CHUNK_CAPACITY,
	createSimplificationPasses,
	DECLARED_GPU_BYTES,
	LINE_CAPACITY,
	OUTPUT_CAPACITY,
	POINT_CAPACITY,
} from '@/utils/gpuSimplificationCompute'
import { createRenderSet } from '@/utils/gpuSimplificationRibbon'
import { times } from '@/utils/points'

const HUGE_TOLERANCE_SCALE = 1e12
const CAMERA_MATRIX_EPSILON = 1e-4

const projectionView = new Matrix4()
const viewport = new Vector2()

const uintBuffer = ( count, itemSize = 1 ) => new StorageBufferAttribute( count, itemSize, Uint32Array )

const write = ( attribute, values ) => {
	attribute.array.set( values )
	attribute.needsUpdate = true
}

const matrixMoved = ( { elements: a }, { elements: b } ) => {
	for ( let index = 0; index < 16; index++ ) {
		if ( Math.abs( a[index] - b[index] ) > CAMERA_MATRIX_EPSILON ) return true
	}
	return false
}

const isMeasured = milliseconds => Number.isFinite( milliseconds ) && milliseconds > 0

/** The object published on `window.__meshLineGpuSimplificationMetrics`. */
export const createSimplificationMetrics = ( options, settings ) => ( {
	algorithm: 'Taubin relaxation, then Douglas-Peucker chunk-parallel refinement, both on the GPU',
	backend: 'initializing',
	bufferBytes: 0,
	busy: true,
	cameraLod: options.cameraLod,
	chunkCount: 0,
	chunkSegments: 0,
	computeSubmissions: 0,
	cpuReferenceCount: null,
	cpuReferenceDelta: null,
	cpuReferenceMs: null,
	cpuSubmitMs: null,
	datasetId: options.datasetId,
	dispatchCount: 0,
	dispatchesPerRebuild: 0,
	emittedSegments: null,
	error: null,
	fallback: null,
	gpuComputeMs: null,
	gpuTimingSource: null,
	lineCount: 0,
	lineWidth: options.lineWidth,
	pixelTolerance: settings.pixelTolerance,
	ready: false,
	readbackError: null,
	rebuildCount: 0,
	refinePasses: SIMPLIFICATION_REFINE_PASSES,
	retainedPointCount: null,
	relaxIterations: options.relaxIterations,
	sourcePointCount: 0,
	sourceUploads: 0,
	simplificationLevel: settings.level,
	worldTolerance: settings.worldTolerance,
} )

export class SimplificationPipeline {
	needsWarmup = true

	constructor( { cameraLod, lineWidth, relaxIterations }, metrics ) {
		this.metrics = metrics
		this.uniforms = {
			chunkCount: uniform( 0, 'uint' ),
			inversePixelTolerance: uniform( 0 ),
			inverseWorldTolerance: uniform( HUGE_TOLERANCE_SCALE ),
			pointCount: uniform( 0, 'uint' ),
			projectionView: uniform( new Matrix4() ),
			screenEnabled: uniform( cameraLod ? 1 : 0 ),
			viewport: uniform( new Vector2( 1, 1 ) ),
		}
		this.buffers = {
			chunks: uintBuffer( CHUNK_CAPACITY, 2 ),
			lineClosed: uintBuffer( LINE_CAPACITY ),
			neighbours: uintBuffer( POINT_CAPACITY, 2 ),
			output: new StorageBufferAttribute( OUTPUT_CAPACITY, 4 ),
			outputGaps: uintBuffer( OUTPUT_CAPACITY ),
			// Two scalar slots per line rather than one uvec2. Writing a single
			// component of a vector in storage compiles to a read-modify-write of the
			// whole vector, so the invocation that owns a line's end would clobber the
			// one that owns its start. Separate slots are independent 4-byte stores.
			outputRuns: uintBuffer( LINE_CAPACITY * 2 ),
			simplifiedDraw: new IndirectStorageBufferAttribute( 12, 1 ),
			source: new StorageBufferAttribute( POINT_CAPACITY, 4 ),
			state: uintBuffer( 4 ),
		}

		// Only the relaxation count varies, and repeating a node costs a dispatch,
		// not a pipeline: the shaders are compiled once and never rebuilt.
		const { passes: pass, scratch } = createSimplificationPasses( this.buffers, this.uniforms )
		this.scratch = scratch
		this.passes = [
			pass.clear,
			...times( relaxIterations, () => [pass.relaxShrink, pass.relaxUnshrink] ).flat(),
			pass.seed,
			...times( SIMPLIFICATION_REFINE_PASSES, () => pass.refine ),
			pass.flush,
			pass.scan,
			pass.blockPrefix,
			pass.scatter,
			pass.resolve,
		]
		metrics.bufferBytes = DECLARED_GPU_BYTES
		metrics.dispatchesPerRebuild = this.passes.length

		// Vertex stages may only bind storage buffers read-only, so the render
		// graph gets its own read-only views of the same GPU buffers.
		const { lineClosed, output, outputGaps, outputRuns, simplifiedDraw, state } = this.buffers
		this.renderSet = createRenderSet( {
			count: storage( state, 'uint', 4 ).toReadOnly().element( uint( 1 ) ),
			gaps: storage( outputGaps, 'uint', OUTPUT_CAPACITY ).toReadOnly(),
			halfWidth: uniform( lineWidth * 0.5 ),
			indirect: simplifiedDraw,
			lineClosed: storage( lineClosed, 'uint', LINE_CAPACITY ).toReadOnly(),
			points: storage( output, 'vec4', OUTPUT_CAPACITY ).toReadOnly(),
			projectionView: this.uniforms.projectionView,
			runs: storage( outputRuns, 'uint', LINE_CAPACITY * 2 ).toReadOnly(),
		} )
		this.renderObjects = Object.values( this.renderSet )
	}

	uploadDataset( { pointCount, positions, ranges }, chunkPlan ) {
		const { lineClosed, neighbours, source } = this.buffers
		this.needsWarmup = true
		write( source, positions )
		write( neighbours, buildNeighbourPlan( ranges, pointCount, positions ) )

		lineClosed.array.fill( 0 )
		for ( const [line, { closed }] of ranges.slice( 0, LINE_CAPACITY ).entries() ) {
			lineClosed.array[line] = closed ? 1 : 0
		}
		lineClosed.needsUpdate = true

		this.uploadChunkPlan( chunkPlan )

		this.uniforms.pointCount.value = pointCount
		this.metrics.sourceUploads++
	}

	/** Uploads the buffers that depend on the chunk lattice. */
	uploadChunkPlan( chunkPlan ) {
		write( this.buffers.chunks, chunkPlan.flat() )
		this.uniforms.chunkCount.value = chunkPlan.length
	}

	setTolerance( { pixelTolerance, worldTolerance } ) {
		this.uniforms.inverseWorldTolerance.value = worldTolerance > 0 ? 1 / worldTolerance : HUGE_TOLERANCE_SCALE
		this.uniforms.inversePixelTolerance.value = pixelTolerance > 0 ? 1 / pixelTolerance : HUGE_TOLERANCE_SCALE
	}

	/** Mirrors the render camera into the uniforms. Returns whether it moved. */
	updateCamera( force = false ) {
		const { camera, renderer } = stage3d
		camera.updateWorldMatrix( true, false )
		camera.matrixWorldInverse.copy( camera.matrixWorld ).invert()
		projectionView.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
		renderer.getDrawingBufferSize( viewport )
		// Screen budgets are quoted in CSS pixels so the same camera framing is
		// equally aggressive on DPR 1, 2 and 3.
		const cssViewport = resolveCssPixelViewport( viewport.x, viewport.y, renderer.getPixelRatio() )
		viewport.set( cssViewport.width, cssViewport.height )

		const { uniforms } = this
		const moved = matrixMoved( projectionView, uniforms.projectionView.value ) || !viewport.equals( uniforms.viewport.value )
		if ( !force && !moved ) return false

		uniforms.projectionView.value.copy( projectionView )
		uniforms.viewport.value.copy( viewport )
		return true
	}

	dispatch() {
		const start = performance.now()
		stage3d.renderer.compute( this.passes )
		const cpuSubmitMs = performance.now() - start
		this.metrics.computeSubmissions++
		this.metrics.dispatchCount += this.passes.length
		this.metrics.rebuildCount++
		this.metrics.cpuSubmitMs = cpuSubmitMs
		return cpuSubmitMs
	}

	/**
	 * Dispatches and resolves with its timing, or with nothing once `isStale()`.
	 * compute() only submits work: timestamp queries give the real GPU duration,
	 * and queue completion is an honest wall-time fallback.
	 */
	async measure( isStale ) {
		const { renderer } = stage3d
		const { backend } = renderer
		const { queue } = backend.device
		const wallStart = performance.now()
		let cpuSubmitMs, gpuComputeMs, gpuTimingSource

		if ( renderer.hasFeature( 'timestamp-query' ) ) {
			const previousTrackTimestamp = backend.trackTimestamp
			let renderDrain
			backend.trackTimestamp = true
			try {
				if ( previousTrackTimestamp ) await renderer.resolveTimestampsAsync( 'compute' )
				if ( isStale() ) return
				// The first dispatch after a pipeline or dataset change carries
				// one-off driver work. Run it, throw the reading away, and report
				// the steady-state pass instead of a cold-start outlier.
				if ( this.needsWarmup ) {
					this.needsWarmup = false
					this.dispatch()
					await renderer.resolveTimestampsAsync( 'compute' )
					if ( isStale() ) return
				}
				cpuSubmitMs = this.dispatch()
				gpuComputeMs = await renderer.resolveTimestampsAsync( 'compute' )
				gpuTimingSource = 'timestamp-query'
				if ( !previousTrackTimestamp ) renderDrain = renderer.resolveTimestampsAsync( 'render' )
			} finally {
				backend.trackTimestamp = previousTrackTimestamp
			}
			await renderDrain
		} else {
			cpuSubmitMs = this.dispatch()
			await queue.onSubmittedWorkDone()
			gpuComputeMs = performance.now() - wallStart
			gpuTimingSource = 'queue-completion-wall-time'
		}

		if ( !isMeasured( gpuComputeMs ) ) {
			const queueStart = performance.now()
			await queue.onSubmittedWorkDone()
			gpuComputeMs = performance.now() - queueStart
			gpuTimingSource = 'queue-completion-wall-time'
		}
		if ( !isMeasured( gpuComputeMs ) ) {
			gpuComputeMs = cpuSubmitMs
			gpuTimingSource = 'cpu-submit-time'
		}

		return { cpuSubmitMs, gpuComputeMs, gpuTimingSource }
	}

	/** What the passes counted: `state` holds retained points, then emitted segments. */
	async readRetained() {
		const buffer = await stage3d.renderer.getArrayBufferAsync( this.buffers.state )
		const [retained, , emittedSegments] = new Uint32Array( buffer )
		if ( !( retained >= 1 && retained <= this.uniforms.pointCount.value ) ) {
			throw new Error( `GPU returned an invalid retained count (${retained}).` )
		}
		return { emittedSegments, retained }
	}

	show( renderMode ) {
		for ( const object of this.renderObjects ) object.visible = false
		this.renderSet[renderMode].visible = true
	}

	/** A readback can still be mapping a GPU buffer: detach now, free once `pending` settles. */
	dispose( pending ) {
		stage3d.remove( ...this.renderObjects )
		pending.catch( () => {} ).finally( () => {
			for ( const pass of new Set( this.passes ) ) pass.dispose()
			for ( const { geometry, material } of this.renderObjects ) {
				geometry.dispose()
				material.dispose()
			}
			// Disposing a pass or a geometry never frees its storage and indirect buffers.
			for ( const buffer of [...Object.values( this.buffers ), ...this.scratch] ) stage3d.release( buffer )
		} )
	}
}
