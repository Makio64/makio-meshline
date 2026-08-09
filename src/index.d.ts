import type {
	Mesh as ThreeMesh,
	Group as ThreeGroup,
	InstancedBufferAttribute,
	Intersection,
	Raycaster,
	Texture,
	Vector2,
	Vector3,
	Color,
	BufferGeometry,
	BufferAttribute,
	Scene,
	Camera,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	Object3D,
	WebGPURenderer
} from 'three/webgpu'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** TSL node value. Kept intentionally broad because Three's TSL type exports vary by release. */
export type MeshLineNodeValue = any

/** Uniform-like node value with a mutable `.value`. */
export interface MeshLineUniform<T> {
	value: T
}

/** Three buffer usage constant, such as `DynamicDrawUsage`. */
export type MeshLineUsage = number

/** Tuple form for one 2D/3D line point. */
export type LinePointTuple = [x: number, y: number, z?: number]

/** Object form for one 2D/3D line point. */
export type LinePointObject = Vector2 | Vector3 | { x: number; y: number; z?: number }

/** Accepted formats for a single polyline's point data. */
export type LinePoints = Float32Array | number[] | BufferGeometry | Array<LinePointTuple | LinePointObject>

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
export type PositionHookFn = ( position: MeshLineNodeValue, progress: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * Hook that receives a neighbour position (vec3) and progress (float) and returns a modified position.
 * Used independently for `previous` or `next` point overrides.
 */
export type NeighbourHookFn = ( position: MeshLineNodeValue, progress: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * Hook that receives width (float), progress (float), and side (float, +1 or -1)
 * and returns a modified width.
 */
export type WidthHookFn = ( width: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * Hook that receives the normal (vec4), direction (vec2), dir1 (vec2), dir2 (vec2),
 * progress (float) and side (float) and returns a modified normal.
 */
export type NormalHookFn = (
	normal: MeshLineNodeValue,
	dir: MeshLineNodeValue,
	dir1: MeshLineNodeValue,
	dir2: MeshLineNodeValue,
	progress: MeshLineNodeValue,
	side: MeshLineNodeValue
) => MeshLineNodeValue

/**
 * Hook that receives a color (vec4), progress (float), and side (float)
 * and returns a modified color.
 */
export type ColorHookFn = ( color: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * Hook that receives the gradient factor (float) and side (float)
 * and returns a modified gradient factor.
 */
export type GradientHookFn = ( factor: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * Hook that receives alpha (float), progress (float), and side (float)
 * and returns a modified alpha value.
 */
export type OpacityHookFn = ( alpha: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * Hook that receives cycle position (float), progress (float), and side (float)
 * and returns a modified cycle position for dash control.
 */
export type DashHookFn = ( cyclePosition: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * Hook that receives UV coordinates (vec2), progress (float), and side (float)
 * and returns modified UV coordinates.
 */
export type UVHookFn = ( uv: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * Hook that receives the final clip-space position (vec4), normal (vec4),
 * progress (float), and side (float) and returns a modified position.
 */
export type VertexHookFn = (
	position: MeshLineNodeValue,
	normal: MeshLineNodeValue,
	progress: MeshLineNodeValue,
	side: MeshLineNodeValue
) => MeshLineNodeValue

/**
 * Hook that receives color (vec4), UV (vec2), progress (float), and side (float)
 * and returns a modified fragment color.
 */
export type FragmentColorHookFn = (
	color: MeshLineNodeValue,
	uv: MeshLineNodeValue,
	progress: MeshLineNodeValue,
	side: MeshLineNodeValue
) => MeshLineNodeValue

/**
 * Hook that receives alpha (float), UV (vec2), progress (float), and side (float)
 * and returns a modified alpha value.
 */
export type FragmentAlphaHookFn = (
	alpha: MeshLineNodeValue,
	uv: MeshLineNodeValue,
	progress: MeshLineNodeValue,
	side: MeshLineNodeValue
) => MeshLineNodeValue

/**
 * Hook that receives progress (float), side (float), and UV (vec2)
 * and returns a boolean node controlling fragment discard.
 */
export type DiscardHookFn = ( progress: MeshLineNodeValue, side: MeshLineNodeValue, uv: MeshLineNodeValue ) => MeshLineNodeValue

/**
 * GPU position node function that receives progress (float) and an extra parameter (float)
 * and returns a vec3 position computed entirely on the GPU.
 */
export type GPUPositionNodeFn = ( progress: MeshLineNodeValue, extra: MeshLineNodeValue ) => MeshLineNodeValue

// ---------------------------------------------------------------------------
// Option interfaces
// ---------------------------------------------------------------------------

export interface MeshLineJoinOptions {
	/**
	 * The regular billboard profile uses bounded miters (`'simple'` remains an
	 * alias). Surface geometry and the optional GPU path emit true bevel and
	 * round topology.
	 */
	type?: 'miter' | 'simple' | 'bevel' | 'round'
	/** Maximum miter expansion factor at sharp bends. Defaults to 4. */
	limit?: number
	/** Maximum round-join subdivisions per 180-degree turn. Defaults to 8. */
	segments?: number
}

export type MeshLineCapType = 'butt' | 'square' | 'round'

export interface MeshLineCapOptions {
	/** Open-path endpoint shape. Defaults to `butt`. */
	type?: MeshLineCapType
	/** Semicircle tessellation count for round caps; round requires at least 2. Defaults to 8. */
	segments?: number
}

export type MeshLineSurfaceBank =
	| number
	| Float32Array
	| number[]
	| Array<Float32Array | number[]>
	| ( ( progress: number, pointIndex: number, lineIndex: number ) => number )

/** World-space ribbon/road profile. Angles are in radians. */
export interface MeshLineSurfaceOptions {
	/** Rotation-minimizing frames by default; fixed-up is useful for terrain roads. */
	frame?: 'transport' | 'fixed-up'
	/** Preferred surface normal/up direction. Defaults to `[0, 1, 0]`. */
	up?: Vector3 | [number, number, number] | { x: number; y: number; z: number }
	/** Constant, per-point, per-line, or callback banking angle in radians. */
	bank?: MeshLineSurfaceBank
	/** Distance repeats physical UVs; stretch maps each path to U=0..1. */
	uvMode?: 'distance' | 'stretch'
	/** World units represented by one U repeat in distance mode. Defaults to 1. */
	uvScale?: number
	normalMap?: Texture | null
	roughnessMap?: Texture | null
	metalnessMap?: Texture | null
	roughness?: number
	metalness?: number
	/** Three.js material side constant. Defaults to FrontSide. */
	side?: number
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
	/** Enable camera-independent world-space road/ribbon geometry. */
	surface?: boolean | MeshLineSurfaceOptions

	// appearance
	color?: number | string | Color
	/**
	 * Full line width. With `sizeAttenuation: false`, this is CSS pixels.
	 * With `sizeAttenuation: true`, this is projected as a view/world-space width.
	 * Use CSS-sized `resolution`/`resize()` values so visible pixel width stays
	 * stable across DPR while the renderer uses more physical pixels.
	 */
	lineWidth?: number
	widthCallback?: ( t: number, pointIndex?: number, lineIndex?: number ) => number
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
	cap?: MeshLineCapType | MeshLineCapOptions
	/**
	 * CPU-subdivide polyline corners that are too sharp for the screen-space
	 * miter to render cleanly. Defaults to `false` so GPU buffers stay aligned
	 * exactly with your input points. Enable for static sharp polylines when you
	 * prefer cleaner corner rendering over exact input topology.
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
	usage?: MeshLineUsage
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

export interface MeshLineGeometryOptions extends Partial<MeshLineConfigureOptions> {
	needsPositions?: boolean
}

export interface MeshLineMaterialOptions extends Partial<MeshLineConfigureOptions> {
	depthWrite?: boolean
	depthTest?: boolean
	resolution?: Vector2
	repeat?: Vector2 | null
	dashLength?: number | null
	miterLimit?: number
}

export interface MeshLineSurfaceGeometryOptions extends Partial<MeshLineConfigureOptions> {
	surface?: MeshLineSurfaceOptions
	/** Emit tangents even when no normal map currently needs them. */
	needsTangents?: boolean
}

export interface MeshLineSurfaceMaterialOptions extends Partial<MeshLineConfigureOptions> {
	surface?: MeshLineSurfaceOptions
	depthWrite?: boolean
	depthTest?: boolean
}

export interface MeshLinePositionRangeOptions {
	/** Zero-based source line within a batched geometry. Defaults to 0. */
	lineIndex?: number
	/** Recompute aggregate bounds after the edit. Defaults to false. */
	updateBounding?: boolean
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
	surface( options?: boolean | MeshLineSurfaceOptions ): this

	color( color: number | string | Color ): this
	lineWidth( width: number ): this
	widthCallback( fn: ( ( progress: number, pointIndex?: number, lineIndex?: number ) => number ) | null ): this
	sizeAttenuation( enabled: boolean ): this
	shadow( enabled: boolean ): this

	opacity( opacity: number ): this
	alphaTest( value: number ): this
	transparent( enabled: boolean ): this
	wireframe( enabled: boolean ): this

	join( options?: MeshLineJoinOptions ): this
	cap( options?: MeshLineCapType | MeshLineCapOptions ): this
	smoothSharpBends( enabled: boolean ): this
	smoothSharpBendsAlpha( alpha: number ): this
	smoothSharpBendsThreshold( threshold: number ): this
	gradientColor( color: number | string | Color | null ): this
	map( tex: Texture | null ): this
	mapOffset( offset: Vector2 | null ): this
	alphaMap( tex: Texture | null ): this
	dash( options?: MeshLineDashOptions ): this
	dpr( value: number ): this
	dynamic( enable: boolean ): this
	setFrustumCulled( enabled: boolean ): this
	verbose( enabled: boolean ): this
	renderSize( width?: number, height?: number ): this

	gpuPositionNode( node: GPUPositionNodeFn | null ): this
	usage( usage: MeshLineUsage ): this
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
	positionFn( fn: PositionHookFn | null ): this
	previousFn( fn: NeighbourHookFn | null ): this
	nextFn( fn: NeighbourHookFn | null ): this
	widthFn( fn: WidthHookFn | null ): this
	normalFn( fn: NormalHookFn | null ): this
	colorFn( fn: ColorHookFn | null ): this
	gradientFn( fn: GradientHookFn | null ): this
	opacityFn( fn: OpacityHookFn | null ): this
	dashFn( fn: DashHookFn | null ): this
	uvFn( fn: UVHookFn | null ): this
	vertexFn( fn: VertexHookFn | null ): this
	fragmentColorFn( fn: FragmentColorHookFn | null ): this
	fragmentAlphaFn( fn: FragmentAlphaHookFn | null ): this
	discardFn( fn: DiscardHookFn | null ): this

	build(): this
	rebuild(): this
	ensureBuilt(): this
	raycast( raycaster: Raycaster, intersects: Array<Intersection<Object3D> & { lineIndex?: number; instanceId?: number }> ): void
	setPositions( points: MultiLinePoints, updateBounding?: boolean ): void
	setPositionRange( points: ArrayLike<number> | Array<LinePointTuple | LinePointObject>, startPoint: number, options?: MeshLinePositionRangeOptions ): this
	addVertexAttribute( name: string, components?: number ): BufferAttribute

	addInstanceAttribute( name: string, components?: number ): InstancedBufferAttribute
	setInstanceValue( name: string, index: number, value: number | number[] | { x: number; y: number; z?: number; w?: number } ): void
	setInstanceValues( name: string, values: ArrayLike<number>, startInstance?: number ): this
	resize( width?: number, height?: number ): void
	autoResize( target?: MeshLineResizeTarget ): this
	dispose(): void
}

// ---------------------------------------------------------------------------
// MeshLineGeometry
// ---------------------------------------------------------------------------

export class MeshLineGeometry extends BufferGeometry {
	readonly isMeshLine: true
	constructor( options?: MeshLineGeometryOptions )
	buildLine( options?: MeshLineGeometryOptions ): void
	setLines( points: MultiLinePoints ): void
	setPositions( points: MultiLinePoints, updateBounding?: boolean ): void
	setPositionRange( points: ArrayLike<number> | Array<LinePointTuple | LinePointObject>, startPoint: number, options?: MeshLinePositionRangeOptions ): this
	setUsage( usage: MeshLineUsage, name?: string | null ): void
	dispose(): void
}

// ---------------------------------------------------------------------------
// MeshLineNodeMaterial
// ---------------------------------------------------------------------------

export class MeshLineNodeMaterial extends MeshBasicNodeMaterial {
	readonly isMeshLineNodeMaterial: true
	lineWidth: MeshLineUniform<number>
	resolution: MeshLineUniform<Vector2>
	dpr: MeshLineUniform<number>
	gradient: MeshLineNodeValue | null
	color: MeshLineNodeValue
	opacity: MeshLineNodeValue | null
	map: MeshLineNodeValue | null
	alphaMap: MeshLineNodeValue | null
	mapOffset: MeshLineNodeValue | null
	repeat: MeshLineNodeValue | null
	dashCount: MeshLineUniform<number> | null
	dashRatio: MeshLineUniform<number> | null
	dashOffset: MeshLineUniform<number> | null
	castShadowNode: MeshLineNodeValue | null
	castShadowPositionNode: MeshLineNodeValue | null
	maskShadowNode: MeshLineNodeValue | null
	shadowNode: MeshLineNodeValue | null
	miterLimit: number

	constructor( options?: MeshLineMaterialOptions )
	buildLine( options?: MeshLineMaterialOptions ): void
	setShadow( enabled: boolean ): void
	dispose(): void
}

// ---------------------------------------------------------------------------
// MeshLine world-space surface profile
// ---------------------------------------------------------------------------

export class MeshLineSurfaceGeometry extends BufferGeometry {
	readonly isMeshLineSurfaceGeometry: true
	constructor( options?: MeshLineSurfaceGeometryOptions )
	buildLine( options?: MeshLineSurfaceGeometryOptions ): void
	setLines( points: MultiLinePoints ): void
	setPositions( points: MultiLinePoints ): void
	setUsage( usage: MeshLineUsage, name?: string | null ): void
	dispose(): void
}

export class MeshLineSurfaceNodeMaterial extends MeshStandardNodeMaterial {
	readonly isMeshLineSurfaceNodeMaterial: true
	constructor( options?: MeshLineSurfaceMaterialOptions )
	buildLine( options?: MeshLineSurfaceMaterialOptions ): void
	setShadow( enabled: boolean ): void
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
	readonly debugScene: Scene
	/** Snapshot of currently registered lines, in registration order. */
	readonly lines: MeshLine[]
	/** Hit-zone width multiplier applied to each registered line in the picking pass. */
	readonly hitRadius: number
	add( line: MeshLine ): this
	remove( line: MeshLine ): this
	pick( x: number, y: number ): Promise<MeshLinePickerHit | null>
	updateDebug(): void
	dispose(): void
}

// ---------------------------------------------------------------------------
// MeshLinePickerHelper
// ---------------------------------------------------------------------------

export interface MeshLinePickerHelperOptions {
	/** Overlay alpha (0..1). Default 0.45. */
	opacity?: number
}

/**
 * Three.js-style visual helper for `MeshLinePicker`. Overlays the picker's
 * wide hit-zone proxies on the scene with a distinct hue per instance —
 * lets you see what the GPU picker is actually testing against without
 * losing the rest of the rendered scene.
 *
 * Mirrors `BoxHelper` / `SkeletonHelper` ergonomics: construct from the
 * picker, add to your scene, call `update()` each frame.
 */
export class MeshLinePickerHelper extends ThreeGroup {
	readonly isMeshLinePickerHelper: true
	picker: MeshLinePicker
	constructor( picker: MeshLinePicker, options?: MeshLinePickerHelperOptions )
	/** Sync proxy transforms / instance counts / widths to the registered lines. Call once per frame. */
	update(): void
	/** Set the overlay alpha (0..1). */
	setOpacity( opacity: number ): void
	/** Tear down and rebuild proxies from the picker's current registry — call after `picker.add()` / `remove()`. */
	rebuild(): void
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
