import type { Box3, Camera, Scene, Vector3, WebGPURenderer } from 'three/webgpu'

import type { MeshLine } from './index.js'

export type MeshLineCullingBoundsEntry = Box3 | ArrayLike<number>

export interface MeshLineCullingBoundsContext {
	chunkIndex: number
	indexStart: number
	indexCount: number
	geometry: MeshLine['geometry']
	object: MeshLine
}

export type MeshLineCullingBounds =
	| ArrayLike<number>
	| MeshLineCullingBoundsEntry[]
	| ( ( context: MeshLineCullingBoundsContext ) => MeshLineCullingBoundsEntry )

export interface MeshLineCullingSystemOptions {
	/** Choose automatically or force native WebGPU. Defaults to `auto`. */
	mode?: 'auto' | 'webgpu'
	/** Dispatch from the scene's pre-render hook. Defaults to true. */
	autoUpdate?: boolean
	/** Optional detached camera whose frustum is culled against when rendering from an observer camera. */
	cullCamera?: Camera | null
	/** Unsupported/invalid data either draws all or retains Three CPU culling. */
	fallback?: 'draw-all' | 'cpu'
	/** Triangles per spatial chunk. Defaults to 128. */
	chunkSize?: number
	maxChunks?: number
	maxIndices?: number
	/** Auto-mode lower bound. Set to 0 only after profiling the target GPU. */
	minChunks?: number
	/** Auto-mode lower bound. Set to 0 only after profiling the target GPU. */
	minIndices?: number
}

export interface MeshLineCullingHandleOptions {
	chunkSize?: number
	/** Explicit local-space AABBs for shader-deformed or instanced geometry. */
	bounds?: MeshLineCullingBounds
	/** Extra local-space AABB padding. */
	boundsPadding?: number | Vector3 | ArrayLike<number>
	/** Extra world-space padding applied after the object transform. */
	worldPadding?: number
	/** Re-evaluate explicit bounds on every update even when positions are unchanged. */
	dynamicBounds?: boolean
}

export interface MeshLineCullingStatus {
	enabled: boolean
	active: boolean
	warmedUp: boolean
	chunkCount: number
	indexCount: number
	reason: string
	lastError: unknown
}

/** One source-index range, stable until the culling chunk plan is refreshed. */
export interface MeshLineCullingChunk {
	readonly chunkIndex: number
	readonly indexStart: number
	readonly indexCount: number
}

/** On-demand GPU visibility snapshot captured from the prepared primary camera. */
export interface MeshLineCullingSnapshot {
	/** Identity of the prepared camera; the mutable Camera object is not cloned. */
	readonly camera: Camera
	/** Increases whenever this handle dispatches a new GPU culling result. */
	readonly revision: number
	readonly chunkCount: number
	readonly indexCount: number
	readonly visibleChunkCount: number
	readonly culledChunkCount: number
	readonly visibleIndexCount: number
	readonly culledIndexCount: number
	readonly visibleChunks: readonly MeshLineCullingChunk[]
	readonly culledChunks: readonly MeshLineCullingChunk[]
}

export interface MeshLineCullingHandle {
	readonly line: MeshLine
	readonly enabled: boolean
	readonly active: boolean
	readonly status: MeshLineCullingStatus
	readonly chunkCount: number
	readonly indexCount: number
	readonly reason: string
	readonly lastError: unknown
	refresh(): boolean
	/**
	 * Read the exact current chunk visibility from the GPU. This is an explicit
	 * synchronization point; returns null when no GPU result is active at call time.
	 */
	readCullingSnapshot(): Promise<MeshLineCullingSnapshot | null>
	remove(): void
}

/**
 * Optional native-WebGPU chunk culling. Requires Three.js r183 or newer.
 * Unsupported cases fail open and render the complete source geometry.
 */
export class MeshLineCullingSystem {
	static attach( renderer: WebGPURenderer, scene: Scene, options?: MeshLineCullingSystemOptions ): MeshLineCullingSystem
	constructor( renderer: WebGPURenderer, scene: Scene, options?: MeshLineCullingSystemOptions )
	readonly renderer: WebGPURenderer
	readonly scene: Scene
	cullCamera: Camera | null
	readonly isNativeWebGPU: boolean
	readonly backendReason: string
	readonly size: number
	readonly disposed: boolean
	readonly lastError: unknown
	add( line: MeshLine, options?: MeshLineCullingHandleOptions ): MeshLineCullingHandle | null
	remove( lineOrHandle: MeshLine | MeshLineCullingHandle ): void
	update( camera: Camera ): Promise<boolean>
	dispose(): void
}

export default MeshLineCullingSystem
