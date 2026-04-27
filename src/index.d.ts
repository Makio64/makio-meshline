import type {
	Mesh as ThreeMesh,
	Intersection,
	InstancedBufferAttribute,
	Raycaster,
	Texture,
	Vector2,
	Color,
	BufferGeometry,
	BufferAttribute,
	Usage,
	Scene,
	Camera,
	WebGPURenderer
} from 'three/webgpu'

import type { ShaderNodeObject, Node } from 'three/tsl'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Accepted formats for a single polyline's point data. */
export type LinePoints = Float32Array | number[] | { x: number; y: number; z?: number }[]

/** One or more polylines. */
export type MultiLinePoints = Array<LinePoints> | LinePoints

/** Any object that exposes the subset of `Window` needed by `autoResize()`. */
export type MeshLineResizeTarget = Pick<Window, 'addEventListener' | 'removeEventListener' | 'innerWidth' | 'innerHeight'>

// ---------------------------------------------------------------------------
// TSL hook function signatures
// ---------------------------------------------------------------------------

/**
 * Hook that receives a position (vec3) and progress (float) and returns a modified position (vec3).
 * Applied to current, previous, and next positions simultaneously.
 */
export type PositionHookFn = ( position: ShaderNodeObject<Node>, progress: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * Hook that receives a neighbour position (vec3) and progress (float) and returns a modified position.
 * Used independently for `previous` or `next` point overrides.
 */
export type NeighbourHookFn = ( position: ShaderNodeObject<Node>, progress: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * Hook that receives width (float), progress (float), and side (float, +1 or -1)
 * and returns a modified width.
 */
export type WidthHookFn = ( width: ShaderNodeObject<Node>, progress: ShaderNodeObject<Node>, side: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * Hook that receives the normal (vec4), direction (vec2), dir1 (vec2), dir2 (vec2),
 * progress (float) and side (float) and returns a modified normal.
 */
export type NormalHookFn = (
	normal: ShaderNodeObject<Node>,
	dir: ShaderNodeObject<Node>,
	dir1: ShaderNodeObject<Node>,
	dir2: ShaderNodeObject<Node>,
	progress: ShaderNodeObject<Node>,
	side: ShaderNodeObject<Node>
) => ShaderNodeObject<Node>

/**
 * Hook that receives a color (vec4), progress (float), and side (float)
 * and returns a modified color.
 */
export type ColorHookFn = ( color: ShaderNodeObject<Node>, progress: ShaderNodeObject<Node>, side: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * Hook that receives the gradient factor (float) and side (float)
 * and returns a modified gradient factor.
 */
export type GradientHookFn = ( factor: ShaderNodeObject<Node>, side: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * Hook that receives alpha (float), progress (float), and side (float)
 * and returns a modified alpha value.
 */
export type OpacityHookFn = ( alpha: ShaderNodeObject<Node>, progress: ShaderNodeObject<Node>, side: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * Hook that receives cycle position (float), progress (float), and side (float)
 * and returns a modified cycle position for dash control.
 */
export type DashHookFn = ( cyclePosition: ShaderNodeObject<Node>, progress: ShaderNodeObject<Node>, side: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * Hook that receives UV coordinates (vec2), progress (float), and side (float)
 * and returns modified UV coordinates.
 */
export type UVHookFn = ( uv: ShaderNodeObject<Node>, progress: ShaderNodeObject<Node>, side: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * Hook that receives the final clip-space position (vec4), normal (vec4),
 * progress (float), and side (float) and returns a modified position.
 */
export type VertexHookFn = (
	position: ShaderNodeObject<Node>,
	normal: ShaderNodeObject<Node>,
	progress: ShaderNodeObject<Node>,
	side: ShaderNodeObject<Node>
) => ShaderNodeObject<Node>

/**
 * Hook that receives color (vec4), UV (vec2), progress (float), and side (float)
 * and returns a modified fragment color.
 */
export type FragmentColorHookFn = (
	color: ShaderNodeObject<Node>,
	uv: ShaderNodeObject<Node>,
	progress: ShaderNodeObject<Node>,
	side: ShaderNodeObject<Node>
) => ShaderNodeObject<Node>

/**
 * Hook that receives alpha (float), UV (vec2), progress (float), and side (float)
 * and returns a modified alpha value.
 */
export type FragmentAlphaHookFn = (
	alpha: ShaderNodeObject<Node>,
	uv: ShaderNodeObject<Node>,
	progress: ShaderNodeObject<Node>,
	side: ShaderNodeObject<Node>
) => ShaderNodeObject<Node>

/**
 * Hook that receives progress (float), side (float), and UV (vec2)
 * and returns a boolean node controlling fragment discard.
 */
export type DiscardHookFn = ( progress: ShaderNodeObject<Node>, side: ShaderNodeObject<Node>, uv: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

/**
 * GPU position node function that receives progress (float) and an extra parameter (float)
 * and returns a vec3 position computed entirely on the GPU.
 */
export type GPUPositionNodeFn = ( progress: ShaderNodeObject<Node>, extra: ShaderNodeObject<Node> ) => ShaderNodeObject<Node>

// ---------------------------------------------------------------------------
// Option interfaces
// ---------------------------------------------------------------------------

export interface MeshLineJoinOptions {
	/**
	 * Join type. Retained for back-compat; only `'miter'` is implemented —
	 * `'simple'` now renders identically to `'miter'`.
	 * @deprecated The field has no effect; thickness is uniform at all angles.
	 */
	type?: 'miter' | 'simple'
	/** Maximum miter expansion factor at sharp bends. Defaults to 4. */
	limit?: number
}

export interface MeshLineDashOptions {
	count?: number
	ratio?: number
	offset?: number
}

export interface MeshLineConfigureOptions {
	// geometry
	lines?: MultiLinePoints
	segments?: number
	closed?: boolean | boolean[]

	// appearance
	color?: number | string | Color
	/**
	 * Full line width. With `sizeAttenuation: false`, this is CSS pixels.
	 * With `sizeAttenuation: true`, this is projected as a view/world-space width.
	 * Use CSS-sized `resolution`/`resize()` values so visible pixel width stays
	 * stable across DPR while the renderer uses more physical pixels.
	 */
	lineWidth?: number
	widthCallback?: ( t: number ) => number
	/**
	 * When `false`, `lineWidth` is a constant CSS-pixel width. When `true`
	 * (default), `lineWidth` is projected in scene space and attenuates with depth.
	 */
	sizeAttenuation?: boolean
	gradientColor?: number | string | Color | null
	vertexColors?: Float32Array | number[]
	map?: Texture | null
	mapOffset?: Vector2 | null
	alphaMap?: Texture | null
	opacity?: number
	alphaTest?: number
	transparent?: boolean
	wireframe?: boolean
	shadow?: boolean

	// advanced
	dash?: MeshLineDashOptions
	/** @deprecated Prefer `dash: { count }` or `.dash({ count })`. */
	dashCount?: number | null
	/** @deprecated Prefer `dash: { ratio }` or `.dash({ ratio })`. */
	dashRatio?: number | null
	/** @deprecated Prefer `dash: { offset }` or `.dash({ offset })`. */
	dashOffset?: number
	join?: MeshLineJoinOptions
	/**
	 * Auto-subdivide polyline corners that are too sharp for the screen-space
	 * miter to render cleanly. Defaults to `true`. Set to `false` to keep the
	 * GPU buffers aligned exactly with your input points.
	 */
	smoothSharpBends?: boolean
	/**
	 * Cutoff fraction used by `smoothSharpBends`. Each sharp corner is replaced
	 * by two points sitting `alpha` of the way back along each adjacent segment.
	 * Smaller values preserve the peak (closer to the original pointy shape);
	 * larger values flatten it more. Default `0.001` — the cutoff is visually
	 * imperceptible but large enough to keep the shader math well-conditioned.
	 */
	smoothSharpBendsAlpha?: number
	/**
	 * `dot(dir_in, dir_out)` cutoff below which a vertex is considered sharp
	 * enough to be subdivided. Default `-0.5` (≈ 60° interior bend). Lower
	 * (more negative) values subdivide only the very sharpest corners.
	 */
	smoothSharpBendsThreshold?: number
	dpr?: number
	frustumCulled?: boolean
	verbose?: boolean
	renderWidth?: number
	renderHeight?: number
	dynamic?: boolean
	autoResize?: MeshLineResizeTarget

	// gpu / instancing
	gpuPositionNode?: GPUPositionNodeFn | null
	usage?: Usage
	instanceCount?: number

	// optional attributes
	needsUV?: boolean
	needsWidth?: boolean
	needsProgress?: boolean
	needsPrevious?: boolean
	needsNext?: boolean
	needsSide?: boolean
	needsVertexColor?: boolean

	// node hooks (TSL)
	positionFn?: PositionHookFn | null
	previousFn?: NeighbourHookFn | null
	nextFn?: NeighbourHookFn | null
	widthFn?: WidthHookFn | null
	normalFn?: NormalHookFn | null
	colorFn?: ColorHookFn | null
	gradientFn?: GradientHookFn | null
	opacityFn?: OpacityHookFn | null
	dashFn?: DashHookFn | null
	uvFn?: UVHookFn | null
	vertexFn?: VertexHookFn | null
	fragmentColorFn?: FragmentColorHookFn | null
	fragmentAlphaFn?: FragmentAlphaHookFn | null
	discardFn?: DiscardHookFn | null
}

// ---------------------------------------------------------------------------
// MeshLine (main facade)
// ---------------------------------------------------------------------------

export class MeshLine extends ThreeMesh {
	constructor( options?: MeshLineConfigureOptions )

	configure( options?: MeshLineConfigureOptions ): this

	lines( points: MultiLinePoints, closed?: boolean | boolean[] ): this
	segments( segments: number ): this
	closed( closed: boolean | boolean[] ): this

	color( color: number | string | Color ): this
	lineWidth( width: number ): this
	widthCallback( fn: ( t: number ) => number ): this
	sizeAttenuation( enabled: boolean ): this
	shadow( enabled: boolean ): this

	opacity( opacity: number ): this
	alphaTest( value: number ): this
	transparent( enabled: boolean ): this
	wireframe( enabled: boolean ): this

	join( options?: MeshLineJoinOptions ): this
	smoothSharpBends( enabled: boolean ): this
	smoothSharpBendsAlpha( alpha: number ): this
	smoothSharpBendsThreshold( threshold: number ): this
	gradientColor( color: number | string | Color | null ): this
	map( tex: Texture | null ): this
	mapOffset( offset: Vector2 ): this
	alphaMap( tex: Texture | null ): this
	dash( options?: MeshLineDashOptions ): this
	dpr( value: number ): this
	dynamic( enable: boolean ): this
	setFrustumCulled( enabled: boolean ): this
	verbose( enabled: boolean ): this
	renderSize( width?: number, height?: number ): this

	gpuPositionNode( node: GPUPositionNodeFn ): this
	usage( usage: Usage ): this
	instances( count: number ): this

	// optional attributes toggles
	needsUV( enabled: boolean ): this
	needsWidth( enabled: boolean ): this
	needsProgress( enabled: boolean ): this
	needsPrevious( enabled: boolean ): this
	needsNext( enabled: boolean ): this
	needsSide( enabled: boolean ): this
	needsVertexColor( enabled: boolean ): this
	vertexColors( colors: Float32Array | number[] ): this

	// node hooks (TSL)
	positionFn( fn: PositionHookFn ): this
	previousFn( fn: NeighbourHookFn ): this
	nextFn( fn: NeighbourHookFn ): this
	widthFn( fn: WidthHookFn ): this
	normalFn( fn: NormalHookFn ): this
	colorFn( fn: ColorHookFn ): this
	gradientFn( fn: GradientHookFn ): this
	opacityFn( fn: OpacityHookFn ): this
	dashFn( fn: DashHookFn ): this
	uvFn( fn: UVHookFn ): this
	vertexFn( fn: VertexHookFn ): this
	fragmentColorFn( fn: FragmentColorHookFn ): this
	fragmentAlphaFn( fn: FragmentAlphaHookFn ): this
	discardFn( fn: DiscardHookFn ): this

	build(): this
	rebuild(): this
	ensureBuilt(): this
	raycast( raycaster: Raycaster, intersects: Array<Intersection & { lineIndex?: number; instanceId?: number }> ): void
	setPositions( points: MultiLinePoints, updateBounding?: boolean ): void
	addVertexAttribute( name: string, components?: number ): BufferAttribute

	addInstanceAttribute( name: string, components?: number ): InstancedBufferAttribute
	setInstanceValue( name: string, index: number, value: number | number[] | { x: number; y: number; z?: number; w?: number } ): void
	resize( width?: number, height?: number ): void
	autoResize( target?: MeshLineResizeTarget ): this
	dispose(): void
}

// ---------------------------------------------------------------------------
// MeshLineGeometry
// ---------------------------------------------------------------------------

export class MeshLineGeometry extends BufferGeometry {
	constructor( options?: Partial<MeshLineConfigureOptions> )
	buildLine( options?: Partial<MeshLineConfigureOptions> ): void
	setLines( points: MultiLinePoints ): void
	setPositions( points: MultiLinePoints, updateBounding?: boolean ): void
	dispose(): void
}

// ---------------------------------------------------------------------------
// MeshLineNodeMaterial
// ---------------------------------------------------------------------------

export class MeshLineNodeMaterial {
	constructor( options?: Partial<MeshLineConfigureOptions> )
	buildLine( options?: Partial<MeshLineConfigureOptions> ): void
	setShadow( enabled: boolean ): void
	dispose(): void
}

// ---------------------------------------------------------------------------
// MeshLinePicker
// ---------------------------------------------------------------------------

export interface MeshLinePickerOptions {
	/** Size of the offscreen render target in CSS pixels (default 1). Larger = scans more nearby pixels. */
	targetSize?: number
	/**
	 * Multiplier applied to each registered line's width when drawn into the
	 * picking pass — makes thin lines easier to hit without changing the visible
	 * line width. Default 15. Set to 1 for pixel-exact picking.
	 */
	hitRadius?: number
}

export interface MeshLinePickerHit {
	line: MeshLine
	/** Instance index when the line is instanced, otherwise -1. */
	instanceId: number
}

/**
 * GPU pixel-picker for MeshLines. Renders registered lines with unique ID
 * colors to an offscreen target and reads back the pixel under the cursor
 * to identify which line / instance was hit.
 *
 * Works with GPU-positioned, instanced, animated, or hook-driven lines —
 * because it reads what was rendered, not a CPU proxy.
 */
export class MeshLinePicker {
	constructor( renderer: WebGPURenderer, scene: Scene, camera: Camera, options?: MeshLinePickerOptions )
	add( line: MeshLine ): this
	remove( line: MeshLine ): this
	pick( x: number, y: number ): Promise<MeshLinePickerHit | null>
	dispose(): void
}

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

export function circlePositions( segments?: number, radius?: number ): Float32Array
export function squarePositions( width?: number, segments?: number ): Float32Array
export function rectanglePositions( width?: number, height?: number, segments?: number ): Float32Array
export function sineWavePositions( wavelengths?: number, segments?: number, amplitude?: number, length?: number ): Float32Array
export function straightLine( width?: number, segments?: number, isVertical?: boolean ): Float32Array
export function straightLineBetween( start: { x?: number; y?: number; z?: number } | number[], end: { x?: number; y?: number; z?: number } | number[], segments?: number ): Float32Array

export default MeshLine
