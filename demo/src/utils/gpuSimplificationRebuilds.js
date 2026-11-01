/**
 * When the simplification lab dispatches: one GPU rebuild at a time, the newest
 * request wins, and the CPU oracle runs once the GPU numbers are up.
 */
import { relaxPositions, simplifyChunkedDouglasPeucker } from '@/utils/gpuSimplification'

export const errorText = error => error instanceof Error ? error.message : String( error )

export class SimplificationRebuilds {
	// Bumped to cancel whatever a measurement in flight was going to report.
	generation = 0
	chain = Promise.resolve()
	measuring = false

	constructor( demo ) {
		this.demo = demo
	}

	/** The first measurement. Unlike a queued one, it leaves its failure to the caller. */
	start() {
		this.chain = this.measure( ++this.generation )
		return this.chain
	}

	queue() {
		this.clearTimers()
		this.demo.ui.busy = true
		this.demo.metrics.busy = true
		this.chain = this.rebuildAfter( this.chain, ++this.generation )
	}

	async rebuildAfter( previous, generation ) {
		// A failed start() was already reported by its caller.
		await previous.catch( () => {} )
		if ( generation !== this.generation ) return
		try {
			this.demo.pipeline.updateCamera( true )
			this.demo.resolveChunkPlan()
			await this.measure( generation )
		} catch ( error ) {
			this.demo.activateCpuFallback( 'GPU simplification update failed; drawing the source lines.', error )
		}
	}

	async measure( generation ) {
		const { metrics, pipeline, ui } = this.demo
		const isStale = () => generation !== this.generation
		this.measuring = true
		metrics.readbackError = null

		try {
			const timing = await pipeline.measure( isStale )
			if ( isStale() ) return
			await this.readRetainedCount( isStale )
			if ( isStale() ) return

			this.scheduleCpuReference()
			ui.busy = false
			ui.gpuComputeMs = timing.gpuComputeMs
			Object.assign( metrics, { busy: false, ...timing } )
		} finally {
			this.measuring = false
		}
	}

	async readRetainedCount( isStale ) {
		const { metrics, pipeline, ui } = this.demo
		try {
			const { emittedSegments, retained } = await pipeline.readRetained()
			if ( isStale() ) return
			ui.retainedPointCount = retained
			Object.assign( metrics, { emittedSegments, retainedPointCount: retained } )
		} catch ( error ) {
			if ( isStale() ) return
			metrics.readbackError = errorText( error )
			console.warn( '[gpuSimplification] retained-count readback failed:', error )
		}
	}

	// The oracle is single-threaded and takes the best part of a second on the
	// larger datasets. That contrast is the point, but it must not be the reason
	// the GPU numbers are slow to appear, so they go first.
	scheduleCpuReference() {
		const { cameraLod, validateAgainstCpu } = this.demo.options
		clearTimeout( this.cpuReferenceTimer )
		if ( !validateAgainstCpu || cameraLod ) return
		this.cpuReferenceTimer = setTimeout( () => this.runCpuReference(), 60 )
	}

	/**
	 * Runs the same relaxation and the textbook Douglas-Peucker on the CPU and
	 * reports the difference. This is the claim "the port is faithful", measured
	 * rather than asserted, and it doubles as the GPU-versus-CPU speed comparison.
	 */
	runCpuReference() {
		const { chunkPlan, dataset, metrics, options, pipeline, settings } = this.demo
		const start = performance.now()
		const relaxed = relaxPositions( dataset.positions, pipeline.buffers.neighbours.array, options.relaxIterations )
		const { count } = simplifyChunkedDouglasPeucker( relaxed, chunkPlan, settings.worldTolerance )
		const { retainedPointCount } = metrics
		Object.assign( metrics, {
			cpuReferenceCount: count,
			cpuReferenceDelta: retainedPointCount === null ? null : retainedPointCount - count,
			cpuReferenceMs: performance.now() - start,
		} )
	}

	scheduleInteractive() {
		if ( this.pendingRebuildTimer ) return
		this.pendingRebuildTimer = setTimeout( () => {
			this.pendingRebuildTimer = null
			if ( !this.measuring ) this.queue()
		}, 45 )
	}

	scheduleSettled() {
		this.demo.ui.busy = true
		clearTimeout( this.settledMeasurementTimer )
		this.settledMeasurementTimer = setTimeout( () => this.queue(), 200 )
	}

	cancel() {
		this.generation++
		this.clearTimers()
	}

	clearTimers() {
		clearTimeout( this.pendingRebuildTimer )
		clearTimeout( this.settledMeasurementTimer )
		clearTimeout( this.cpuReferenceTimer )
		this.pendingRebuildTimer = null
	}
}
