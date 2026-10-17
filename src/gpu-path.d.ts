import type { Camera, Group, WebGPURenderer } from 'three/webgpu'

import type {
	LinePoints,
	MeshLineCapOptions,
	MeshLineCapType,
	MeshLineConfigureOptions,
	MeshLineJoinOptions,
} from './index.js'
import type MeshLine from './MeshLine.js'

export interface MeshLineGPUPathSimplifyOptions {
	/** One-sided source-point-to-dyadic-chord tolerance in object-local units. */
	localTolerance?: number
}

export interface MeshLineGPUPathOptions {
	/** Segments owned by each fixed chunk. Power of two in [1, 4096]; defaults to 128. */
	chunkSegments?: number
	/** Opt into experimental local-space dyadic simplification. Defaults to false. */
	simplify?: boolean | MeshLineGPUPathSimplifyOptions
	/** Alias for `simplify.localTolerance`. */
	localTolerance?: number
	/**
	 * Opt the default miter+butt profile into compact triangle records so
	 * over-limit miters become true bevel wedges. Defaults to false, preserving
	 * the zero-dispatch, zero-record-buffer fixed-strip fast path.
	 */
	variableTopology?: boolean
}

export interface MeshLineGPUPathStatus {
	enabled: boolean
	active: boolean
	backend: 'unprepared' | 'webgpu' | 'fallback'
	reason: string
	fallback: 'cpu-full-detail' | null
	pointCount: number
	segmentCapacity: number
	chunkCount: number
	stableOrder: true
	segmentRecords: 'derived' | 'storage'
	primitiveRecords: 'procedural-fixed-stride' | 'compact-storage'
	primitiveCapacity: number
	/** Exactly 2 for the default fast path; compact advanced streams report null. */
	primitivesPerSegment: 2 | null
	prefixScan: 'none' | 'serial' | 'parallel-256'
	/** Stage 1 does not yet perform camera-frustum or occlusion culling. */
	culling: false
	simplification: 'off' | 'experimental-dyadic-local' | 'disabled-for-variable-topology'
	toleranceSpace: 'local' | null
	toleranceGuaranteed: false | string
	join: 'miter' | 'bevel' | 'round'
	cap: MeshLineCapType
	topology: 'fixed-strip' | 'variable-triangles'
	/** Advanced topology preserves full-width bodies while bounding unsupported projected join wedges to a center pivot. */
	topologySafety: 'not-required' | 'projected-join-guarded'
	topologySafetyReason: string | null
	/** Simplified mode can classify only the points retained by its local-space LOD. */
	reversalSplitting: 'source-and-projected' | 'retained-points-only'
	homogeneousClipping: true
	coordinateSystem: 'webgpu-0-to-1'
	reversedDepth: boolean
	lastError: unknown
}

/** Fixed, non-overlapping segment ownership with one shared read seam. */
export interface MeshLineGPUPathChunk {
	pointStart: number
	segmentStart: number
	segmentCount: number
}

/**
 * Experimental native-WebGPU point path for one open, non-instanced screen
 * line. The wrapper always retains `fallback`, a complete CPU `MeshLine`, and
 * selects it for unsupported backends, multi-lines, closed paths, shadows, XR,
 * unsupported features, or failures. `lineOptions.join` selects true bevel or
 * round outer topology and `lineOptions.cap` selects butt, square, or round
 * open-run caps. Advanced topology remains full detail because local-space LOD
 * cannot prove that a removed point will not become a projected cusp. Exact
 * projected inner joins are retained only while both incident legs support
 * them; unsupported joins preserve each incident body's local half-width and
 * use a bounded center pivot only for the join wedge.
 */
export class MeshLineGPUPath extends Group {
	constructor( lineOptions?: MeshLineConfigureOptions, gpuOptions?: MeshLineGPUPathOptions )
	readonly isMeshLineGPUPath: true
	readonly fallback: MeshLine
	readonly status: MeshLineGPUPathStatus
	readonly gpuMesh: import('three/webgpu').Mesh | null
	prepare( renderer: WebGPURenderer, camera?: Camera | null ): Promise<boolean>
	/** Validate that the prepared backend and primary mono camera remain usable. */
	update( camera?: Camera | null ): boolean
	resize( width: number, height: number ): this
	wireframe( enabled?: boolean ): this
	/** Reclassify an active simplification-enabled path; raw mode only stores the value. */
	setSimplificationTolerance( localTolerance: number ): Promise<this>
	setPositions( points: LinePoints ): Promise<this>
	dispose(): void
}

export interface MeshLineGPUPathInternals {
	normalizeOpenPoints( points: LinePoints ): Float32Array
	normalizeTopologyOptions(
		options?: Pick<MeshLineConfigureOptions, 'join' | 'cap'>,
		fallback?: MeshLine | null
	): {
		join: Required<Omit<MeshLineJoinOptions, 'type'>> & { type: 'miter' | 'bevel' | 'round' }
		cap: Required<MeshLineCapOptions>
	}
	getTopologyLayout( topology: {
		join: Required<Omit<MeshLineJoinOptions, 'type'>> & { type: 'miter' | 'bevel' | 'round' }
		cap: Required<MeshLineCapOptions>
	}, variableTopology?: boolean ): {
		joinPrimitives: number
		joinCapacity: number
		capPrimitives: number
		advanced: boolean
		maximumPrimitivesPerSegment: number
	}
	createGPUResourcePlan( options: {
		pointCount: number
		segmentCount: number
		chunkCount: number
		levelCount: number
		runCount: number
		simplify: boolean
		advancedTopology: boolean
		topologyLayout: ReturnType<MeshLineGPUPathInternals['getTopologyLayout']>
	} ): {
		primitiveCapacity: number
		maximumVertexCount: number
		storageBytes: Record<'points' | 'chunks' | 'errors' | 'states' | 'segments' | 'primitiveStates' | 'primitives', number>
		indirectBytes: number
	}
	assertGPUResourcePlan(
		plan: ReturnType<MeshLineGPUPathInternals['createGPUResourcePlan']>,
		device: { limits?: { maxStorageBufferBindingSize?: number | bigint, maxBufferSize?: number | bigint } } | null
	): ReturnType<MeshLineGPUPathInternals['createGPUResourcePlan']>
	createChunkPlan( pointCount: number, chunkSegments?: number ): MeshLineGPUPathChunk[]
	computeDyadicChunkErrors(
		points: LinePoints,
		chunks: MeshLineGPUPathChunk[]
	): { errors: Float32Array, levelCount: number }
	computeDyadicImportance( points: LinePoints, chunks?: MeshLineGPUPathChunk[] | null ): Float32Array
	findReversalBreaks( points: LinePoints, threshold?: number ): Uint8Array
	clipHomogeneousSegment(
		start: ArrayLike<number>,
		end: ArrayLike<number>,
		options?: {
			padScaleX?: number
			padScaleY?: number
			padAddX?: number
			padAddY?: number
		}
	): {
		visible: boolean
		start: number[] | null
		end: number[] | null
		range: [number, number]
	}
	computeInnerJoinOffset(
		incoming: ArrayLike<number>,
		outgoing: ArrayLike<number>,
		halfWidth: number
	): { offset: [number, number], side: number, fallback: boolean }
	/** Resolve an exact projected inner join or a full-width-body, bounded-pivot fallback against both finite legs. */
	resolveProjectedJoin(
		incomingDelta: ArrayLike<number>,
		outgoingDelta: ArrayLike<number>,
		projectedHalfWidth: number
	): {
		fallback: 'exact' | 'center' | 'reversal' | 'degenerate'
		offset: [number, number]
		pivotOffset: [number, number]
		incomingBodyInnerOffset: [number, number] | null
		outgoingBodyInnerOffset: [number, number] | null
		exactOffset: [number, number]
		side: number
		incomingDemand: number
		outgoingDemand: number
		incomingLength: number
		outgoingLength: number
		turnDot: number
		turnCross: number
		demand: number
		available: number
		reversal: boolean
		defined: boolean
		supported: boolean
	}
	validateInnerJoinSupport(
		lengths: ArrayLike<number>,
		startDemands: ArrayLike<number>,
		endDemands: ArrayLike<number>,
		startSides: ArrayLike<number>,
		endSides: ArrayLike<number>
	): { safe: boolean, segment: number, required: number, available: number, sameSide: boolean }
	createStableSegmentRecords(
		pointCount: number,
		chunks: MeshLineGPUPathChunk[],
		visible?: ArrayLike<boolean | number> | null,
		keep?: ArrayLike<boolean | number> | null,
		breaks?: ArrayLike<boolean | number> | null
	): Uint32Array
	/** Packed `[type | (slot << 4), segmentRecordIndex]` uvec2 records (8 bytes each). */
	createProceduralPrimitiveRecords(
		segmentRecords: Uint32Array,
		topologyOptions?: Pick<MeshLineConfigureOptions, 'join' | 'cap'>
	): Uint32Array
}

export const _gpuPathInternals: Readonly<MeshLineGPUPathInternals>

export default MeshLineGPUPath
