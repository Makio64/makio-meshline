import type {
	Mesh as ThreeMesh,
	Group as ThreeGroup,
	InstancedBufferAttribute,
	InterleavedBufferAttribute,
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

/**
 * Accepted formats for a single polyline's point data. A `Float32Array` is used
 * as given. A `Float64Array` is read as is by the surface profile and converted
 * by the billboard and GPU path profiles, like every other format.
 */
export type LinePoints = Float32Array | Float64Array | number[] | BufferGeometry | Array<LinePointTuple | LinePointObject>

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
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [position, progress] ) => ... )`.
 */
export type PositionHookFn =
	| ( ( position: MeshLineNodeValue, progress: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [position: MeshLineNodeValue, progress: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * Hook that receives a neighbour position (vec3) and progress (float) and returns a modified position.
 * Used independently for `previous` or `next` point overrides.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [position, progress] ) => ... )`.
 */
export type NeighbourHookFn =
	| ( ( position: MeshLineNodeValue, progress: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [position: MeshLineNodeValue, progress: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * Hook that receives width (float), progress (float), and side (float, +1 or -1)
 * and returns a modified width.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [width, progress, side] ) => ... )`.
 */
export type WidthHookFn =
	| ( ( width: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [width: MeshLineNodeValue, progress: MeshLineNodeValue, side?: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * Hook that receives the normal (vec4), direction (vec2), dir1 (vec2), dir2 (vec2),
 * progress (float) and side (float) and returns a modified normal.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [normal, dir, dir1, dir2, progress, side] ) => ... )`.
 */
export type NormalHookFn =
	| ( (
		normal: MeshLineNodeValue,
		dir: MeshLineNodeValue,
		dir1: MeshLineNodeValue,
		dir2: MeshLineNodeValue,
		progress: MeshLineNodeValue,
		side: MeshLineNodeValue
	) => MeshLineNodeValue )
	| ( ( params: [
		normal: MeshLineNodeValue,
		dir?: MeshLineNodeValue,
		dir1?: MeshLineNodeValue,
		dir2?: MeshLineNodeValue,
		progress?: MeshLineNodeValue,
		side?: MeshLineNodeValue
	] ) => MeshLineNodeValue )

/**
 * Hook that receives a color (vec4), progress (float), and side (float)
 * and returns a modified color. It runs per vertex and is interpolated: use
 * `fragmentColorFn` for patterns finer than the point spacing.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [color, progress, side] ) => ... )`.
 */
export type ColorHookFn =
	| ( ( color: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [color: MeshLineNodeValue, progress?: MeshLineNodeValue, side?: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * Hook that receives the gradient factor (float) and side (float)
 * and returns a modified gradient factor.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [factor, side] ) => ... )`.
 */
export type GradientHookFn =
	| ( ( factor: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [factor: MeshLineNodeValue, side?: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * Hook that receives alpha (float), progress (float), and side (float)
 * and returns a modified alpha value.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [alpha, progress, side] ) => ... )`.
 */
export type OpacityHookFn =
	| ( ( alpha: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [alpha: MeshLineNodeValue, progress?: MeshLineNodeValue, side?: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * Hook that receives cycle position (float), progress (float), and side (float)
 * and returns a modified cycle position for dash control.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [cyclePosition, progress, side] ) => ... )`.
 */
export type DashHookFn =
	| ( ( cyclePosition: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [cyclePosition: MeshLineNodeValue, progress?: MeshLineNodeValue, side?: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * Hook that receives UV coordinates (vec2), progress (float), and side (float)
 * and returns modified UV coordinates.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [uv, progress, side] ) => ... )`.
 */
export type UVHookFn =
	| ( ( uv: MeshLineNodeValue, progress: MeshLineNodeValue, side: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [uv: MeshLineNodeValue, progress?: MeshLineNodeValue, side?: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * Hook that receives the final clip-space position (vec4), normal (vec4),
 * progress (float), and side (float) and returns a modified position.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [position, normal, progress, side] ) => ... )`.
 */
export type VertexHookFn =
	| ( (
		position: MeshLineNodeValue,
		normal: MeshLineNodeValue,
		progress: MeshLineNodeValue,
		side: MeshLineNodeValue
	) => MeshLineNodeValue )
	| ( ( params: [
		position: MeshLineNodeValue,
		normal?: MeshLineNodeValue,
		progress?: MeshLineNodeValue,
		side?: MeshLineNodeValue
	] ) => MeshLineNodeValue )

/**
 * Hook that receives color (vec4), UV (vec2), progress (float), and side (float)
 * and returns a modified fragment color.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [color, uv, progress, side] ) => ... )`.
 */
export type FragmentColorHookFn =
	| ( (
		color: MeshLineNodeValue,
		uv: MeshLineNodeValue,
		progress: MeshLineNodeValue,
		side: MeshLineNodeValue
	) => MeshLineNodeValue )
	| ( ( params: [
		color: MeshLineNodeValue,
		uv?: MeshLineNodeValue,
		progress?: MeshLineNodeValue,
		side?: MeshLineNodeValue
	] ) => MeshLineNodeValue )

/**
 * Hook that receives alpha (float), UV (vec2), progress (float), and side (float)
 * and returns a modified alpha value.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [alpha, uv, progress, side] ) => ... )`.
 */
export type FragmentAlphaHookFn =
	| ( (
		alpha: MeshLineNodeValue,
		uv: MeshLineNodeValue,
		progress: MeshLineNodeValue,
		side: MeshLineNodeValue
	) => MeshLineNodeValue )
	| ( ( params: [
		alpha: MeshLineNodeValue,
		uv?: MeshLineNodeValue,
		progress?: MeshLineNodeValue,
		side?: MeshLineNodeValue
	] ) => MeshLineNodeValue )

/**
 * Hook that receives progress (float), side (float), and UV (vec2)
 * and returns a boolean node controlling fragment discard.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [progress, side, uv] ) => ... )`.
 */
export type DiscardHookFn =
	| ( ( progress: MeshLineNodeValue, side: MeshLineNodeValue, uv: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [progress: MeshLineNodeValue, side?: MeshLineNodeValue, uv?: MeshLineNodeValue] ) => MeshLineNodeValue )

/**
 * GPU position node function that receives progress (float, 0 to 1 along the
 * line) and returns the vec3 position there, computed entirely on the GPU. It
 * is also sampled at neighbouring progress values for the line direction.
 * `extra` is reserved and currently always 0.
 * Note: When wrapped in Three's `Fn()`, destructure the parameter array: `Fn( ( [progress] ) => ... )`.
 */
export type GPUPositionNodeFn =
	| ( ( progress: MeshLineNodeValue, extra: MeshLineNodeValue ) => MeshLineNodeValue )
	| ( ( params: [progress: MeshLineNodeValue, extra?: MeshLineNodeValue] ) => MeshLineNodeValue )

// ---------------------------------------------------------------------------
// Option interfaces
// ---------------------------------------------------------------------------

export type MeshLineJoinType = 'miter' | 'simple' | 'bevel' | 'round'

export interface MeshLineJoinOptions {
	/**
	 * Corner join style across billboard, surface, and GPU-path profiles:
	 * `'miter'` (`'simple'` alias), `'bevel'`, or `'round'`.
	 */
	type?: MeshLineJoinType
	/** Maximum miter expansion factor at sharp bends. Defaults to 4. */
	limit?: number
	/** Maximum round-join subdivisions per 180-degree turn. Defaults to 8. */
	segments?: number
	/**
	 * Inner-edge policy when a full-width corner footprint cannot fit its legs.
	 * `'exact'` rejects the path; `'clip'` locally pinches the inner edge while
	 * retaining the centerline and outer join. Defaults to `'exact'`.
	 */
	inner?: 'exact' | 'clip'
	/**
	 * Billboard lines only: how a smooth 3D curve is drawn where its tangent
	 * points at the camera and its projection folds into a sharp screen turn.
	 * `'geometry'` (default) splits those joins in the vertex stage, bounding the
	 * deviation from a round tube to about 0.4 of the half width with no
	 * fragment cost; the split rows overlap, which translucent or additive lines
	 * show as a slightly denser cap. `'exact'` clips them to the exact round
	 * silhouette in the fragment stage, and melts corners past `limit` into
	 * round; it adds a discard (costly on tile-based GPUs for thick,
	 * overdraw-heavy lines). `false` keeps plain miters. `type: 'round'` implies
	 * `'exact'` and rounds every join.
	 */
	fold?: 'geometry' | 'exact' | false
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
	count?: number | null
	ratio?: number
	offset?: number
}

export interface MeshLineConfigureOptions {
	// geometry
	lines?: MultiLinePoints
	/** Alias for `lines`. */
	points?: MultiLinePoints
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
	/**
	 * Analytic edge antialiasing. Off by default — MSAA already smooths the
	 * billboard silhouette. Enabling it pads the stroke outward by half a device
	 * pixel, fades that padding by real edge coverage, keeps sub-pixel lines from
	 * dropping out, and forces `transparent` because coverage lands in alpha.
	 */
	antialias?: boolean
	gradientColor?: number | string | Color | null
	/**
	 * One RGB triplet (0–1) per point, multiplied with `color`. For a multi-line
	 * batch, concatenate every line's colors in line order, like their
	 * positions; an array shorter than the whole batch is a shared pattern that
	 * every line reads from its own first point. A closed line takes one color
	 * per unique point and its seam reuses the first. Colors follow the points
	 * the geometry keeps, so dropped duplicate or non-finite points and
	 * `smoothSharpBends` insertions shift the colors that follow them. `null`
	 * means no vertex colors. Surface lines ignore them.
	 */
	vertexColors?: Float32Array | number[] | null
	map?: Texture | null
	mapOffset?: Vector2 | null
	alphaMap?: Texture | null
	opacity?: number
	alphaTest?: number
	transparent?: boolean
	wireframe?: boolean
	shadow?: boolean
	receiveShadow?: boolean

	// advanced
	dash?: MeshLineDashOptions | null | false
	/** @deprecated Prefer `dash: { count }` or `.dash({ count })`. */
	dashCount?: number | null
	/** @deprecated Prefer `dash: { ratio }` or `.dash({ ratio })`. */
	dashRatio?: number | null
	/** @deprecated Prefer `dash: { offset }` or `.dash({ offset })`. */
	dashOffset?: number
	join?: MeshLineJoinType | MeshLineJoinOptions
	/** Maximum miter expansion factor at sharp bends. Convenience alias for `join.limit`. */
	miterLimit?: number
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
	/** `true` for stream-usage buffers; `'storage'` also keeps the points in a GPU storage buffer on WebGPU. */
	dynamic?: boolean | 'storage'
	/** `true` tracks the window size; or pass the object to track. */
	autoResize?: boolean | MeshLineResizeTarget

	// gpu / instancing
	gpuPositionNode?: GPUPositionNodeFn | null
	usage?: MeshLineUsage
	/** Number of instances drawn, like `.instances( count )`. */
	instances?: number
	/** Alias for `instances`. */
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

/** Component counts for attributes packed into one shared GPU vertex buffer. */
export type MeshLinePackedAttributeLayout = Record<string, 1 | 2 | 3 | 4>

export interface MeshLineVertexBufferBudgetOptions {
	/** Portable WebGPU adapters guarantee at least eight vertex buffers. Defaults to 8. */
	limit?: number
	/** Additional renderer-owned or application buffers to reserve. Defaults to 0. */
	reservedBuffers?: number
}

export interface MeshLineVertexBufferGroup {
	attributes: string[]
	instanced: boolean
	interleaved: boolean
}

export interface MeshLineVertexBufferUsage {
	attributeBuffers: number
	buffers: MeshLineVertexBufferGroup[]
	exceeded: boolean
	limit: number
	remaining: number
	reservedBuffers: number
	usedBuffers: number
}

export type MeshLineComputeMode = 'autonomous' | 'follow' | 'field' | number

export interface MeshLineComputeOptions extends Omit<MeshLineConfigureOptions, 'lines' | 'points' | 'segments' | 'closed' | 'surface' | 'gpuPositionNode' | 'instances' | 'instanceCount' | 'needsPrevious' | 'needsNext'> {
	/** Number of autonomous curve instances. Defaults to 128. */
	curveCount?: number
	/** Number of simulated storage-buffer points per curve. Defaults to 32. */
	pointsPerCurve?: number
	/** Initial home-curve length in scene units. Defaults to 4. */
	curveLength?: number
	/** Simulation bounds around the origin. Defaults to 12. */
	bounds?: number
	/** Velocity damping applied each compute step. Defaults to 0.94. */
	damping?: number
	/** Flow/curl force multiplier. Defaults to 4. */
	curlStrength?: number
	/** Field animation speed. Defaults to 1. */
	flowSpeed?: number
	/** Spring force back to the generated home curve. Defaults to 1.4. */
	homeStrength?: number
	/** Mouse attractor force multiplier. Defaults to 8. */
	mouseStrength?: number
	/** Mouse attractor radius in scene units. Defaults to 5. */
	mouseRadius?: number
	/** Audio-reactive force multiplier slot. Defaults to 0. */
	audioLevel?: number
	/** Depth/collision force slot for future scene-depth workflows. Defaults to 0. */
	depthStrength?: number
	/** Texture/field force slot for future storage-texture workflows. Defaults to 0. */
	textureStrength?: number
	/** Simulation blend mode. Defaults to `'autonomous'`. */
	mode?: MeshLineComputeMode
	/** Neighbour-spacing constraint blend in [0, 1]: 1 keeps curves inextensible, 0 lets points drift freely. Defaults to 1. */
	stiffness?: number
	/** Initial mouse/attractor target. */
	mouse?: Vector3 | { x: number; y: number; z?: number } | number[]
	/** Alias for `mouse`. */
	mouseTarget?: Vector3 | { x: number; y: number; z?: number } | number[]
}

// ---------------------------------------------------------------------------
// MeshLine (main facade)
// ---------------------------------------------------------------------------

/**
 * The line facade without the world-space surface profile. `MeshLine` extends
 * it with `surface()`; import this class instead when an app only draws
 * billboard lines, so bundlers leave the surface geometry builders out.
 * Calling `surface()` with anything but `false` throws.
 */
export class MeshLineBillboard extends ThreeMesh {
	constructor( options?: MeshLineConfigureOptions )

	/**
	 * The storage buffer holding the line's points while `dynamic( 'storage' )`
	 * is active (one vec4 per point, line after line), else `null`.
	 */
	readonly positionStorage: BufferAttribute | null

	/**
	 * Apply several options at once. Keys are the method names, except
	 * `receiveShadow` (`setReceiveShadow()`), `frustumCulled` (`setFrustumCulled()`)
	 * and `renderWidth`/`renderHeight` (`renderSize()`). Unknown keys warn.
	 */
	configure( options?: MeshLineConfigureOptions ): this

	/**
	 * Set the points: one polyline (flat xyz `Float32Array`, `number[]`,
	 * `[x, y, z][]` or `Vector3[]`) or an array of polylines drawn as one batch.
	 * A built line updates in place; another point count or loop flag rebuilds,
	 * reusing the buffers when `dynamic( true )` is set.
	 */
	lines( points: MultiLinePoints, closed?: boolean | boolean[] ): this
	/** Alias for `lines()`. */
	points( points: MultiLinePoints, closed?: boolean | boolean[] ): this
	/** Number of segments sampled along a `gpuPositionNode` line (it has no CPU points). Default 1. */
	segments( segments: number ): this
	/** Join the last point back to the first; one flag per line in a batch. */
	closed( closed: boolean | boolean[] ): this
	/**
	 * Use the world-space lit ribbon/road profile (a `MeshStandardNodeMaterial`
	 * surface that keeps its width whatever the camera does). `false` returns to
	 * the screen-space billboard. Surfaces need CPU points: no `gpuPositionNode`
	 * and no `instances()`.
	 */
	surface( options?: boolean | MeshLineSurfaceOptions ): this

	/** Base color: hex number, CSS string or `Color`. Default white; updates live. */
	color( color: number | string | Color ): this
	/**
	 * Full width: world units while `sizeAttenuation` is on (the default), CSS
	 * pixels when it is off. Default 0.3; updates live.
	 */
	lineWidth( width: number ): this
	/** CPU width multiplier per point, baked into the geometry. Animate widths with `widthFn` instead. */
	widthCallback( fn: ( ( progress: number, pointIndex?: number, lineIndex?: number ) => number ) | null ): this
	/** `true` (default): width in world units, thinner with distance. `false`: constant CSS-pixel width. */
	sizeAttenuation( enabled: boolean ): this
	/** Analytic edge antialiasing, for renderers without MSAA or sub-pixel lines. Forces blending. */
	antialias( enabled?: boolean ): this
	/**
	 * Cast shadows; pass `receiveShadow` to receive them too: `.shadow( true, true )`.
	 * The renderer needs `shadowMap.enabled` and a light with `castShadow`.
	 */
	shadow( enabled: boolean, receiveShadow?: boolean ): this
	/** Receive shadows. A method, because `THREE.Mesh` owns the `receiveShadow` field. */
	setReceiveShadow( enabled: boolean ): this

	/** Opacity in [0, 1]; below 1 the line blends. Updates live. */
	opacity( opacity: number ): this
	/** Discard fragments whose alpha is below the threshold. */
	alphaTest( value: number ): this
	/** Force alpha blending (opacity below 1, `alphaMap` and `antialias` already turn it on). */
	transparent( enabled: boolean ): this
	/** Draw the triangles as lines, for debugging. */
	wireframe( enabled: boolean ): this

	/** Corner style: `'miter'` (default, limit 4), `'bevel'` or `'round'`. See `MeshLineJoinOptions`. */
	join( options?: MeshLineJoinType | MeshLineJoinOptions ): this
	/** Change only the miter limit of the current join. */
	miterLimit( limit: number ): this
	/**
	 * End caps of open `surface()` lines and `MeshLineGPUPath`: `'butt'` (default),
	 * `'square'` or `'round'`. Screen-space billboard lines always end butt.
	 */
	cap( options?: MeshLineCapType | MeshLineCapOptions ): this
	/** CPU-subdivide corners too sharp for a clean miter (static lines). See `MeshLineConfigureOptions`. */
	smoothSharpBends( enabled: boolean ): this
	smoothSharpBendsAlpha( alpha: number ): this
	smoothSharpBendsThreshold( threshold: number ): this
	/** End color, blended from `color` along the arc length. `null` removes it. */
	gradientColor( color: number | string | Color | null ): this
	/** Color texture. U runs along the line (0 to 1 over its whole length), V across it (0 to 1). */
	map( tex: Texture | null ): this
	/** UV offset for `map` and `alphaMap`. */
	mapOffset( offset: Vector2 | null ): this
	/** Alpha texture, read from its red channel with the `map` UVs. Turns on blending. */
	alphaMap( tex: Texture | null ): this
	/**
	 * `count` dashes over the line's length, `ratio` the drawn fraction of each
	 * (default 0.5), `offset` shifts them in dash periods (animate it to march).
	 * `null` or `false` removes the dashes.
	 */
	dash( options?: MeshLineDashOptions | null | false ): this
	/** Device-pixel-ratio uniform, read only by custom hooks. */
	dpr( value: number ): this
	/**
	 * `true` marks the buffers for frequent updates, and keeps them when a
	 * later `lines()` call changes the point count. `'storage'` also keeps the
	 * points in one GPU storage buffer on WebGPU, so `setPositions()` uploads 16
	 * bytes per point instead of 144. It applies to open lines given as
	 * `Float32Array`s of equal length that read no progress, UVs, vertex colors
	 * or custom attributes; any other line, and WebGL2, behave as `true`.
	 */
	dynamic( enable: boolean | 'storage' ): this
	/** Override automatic frustum culling (it turns off for lines moved by GPU hooks). */
	setFrustumCulled( enabled: boolean ): this
	/** Log build details. */
	verbose( enabled: boolean ): this
	/** Viewport size used by the next build; `resize()` also updates the live uniform. */
	renderSize( width?: number, height?: number ): this

	/**
	 * Place the points in the vertex shader instead of from CPU points:
	 * `( progress ) => vec3`, with progress 0 to 1 along the line. Pair it with
	 * `segments( n )`, and for many lines with `instances( count )` and TSL
	 * `instanceIndex`. `storagePositions()` builds one from a storage buffer.
	 */
	gpuPositionNode( node: GPUPositionNodeFn | null ): this
	/** Three buffer usage constant; `dynamic()` sets it for you. */
	usage( usage: MeshLineUsage ): this
	/**
	 * Draw the line `count` times in one draw call. Vary the instances in hooks
	 * with TSL `instanceIndex` or with `addInstanceAttributes()`. Set it before
	 * the first build.
	 */
	instances( count: number ): this

	// Optional attributes. Each is inferred from the features in use: force one
	// on for a custom hook that reads it, or off to save a vertex buffer.
	needsUV( enabled: boolean ): this
	needsWidth( enabled: boolean ): this
	needsProgress( enabled: boolean ): this
	needsPrevious( enabled: boolean ): this
	needsNext( enabled: boolean ): this
	needsSide( enabled: boolean ): this
	needsVertexColor( enabled: boolean ): this
	/**
	 * Set one RGB triplet per point. A multi-line batch reads a concatenated
	 * array from each line's global point start; an array shorter than the
	 * batch is a pattern shared by every line. See `MeshLineConfigureOptions.vertexColors`.
	 * On a built line a new array refreshes the colors in place, while turning
	 * colors on or off (`null`) rebuilds the line.
	 */
	vertexColors( colors: Float32Array | number[] | null ): this

	// TSL hooks (billboard profile). Pass a plain function that takes the
	// arguments in order, or a TSL `Fn( ( [ ...arguments ] ) => … )` with them
	// destructured from one array (a Fn is needed for `If`, `Loop` or `toVar`).
	// Each hook type lists its arguments and stage.
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

	/** Build geometry and material now. A line in a scene builds on its first render, so this is optional. */
	build(): this
	/** Build again from the current options. */
	rebuild(): this
	/** Build unless already built. */
	ensureBuilt(): this
	/** Compile the line's pipeline before it is first shown, to avoid a first-frame hitch. */
	warmupAsync( renderer: WebGPURenderer, camera: Camera, scene?: Scene | null ): Promise<this>
	/** Raycast against the stroke width; hits carry `lineIndex` and `instanceId`. */
	raycast( raycaster: Raycaster, intersects: Array<Intersection<Object3D> & { lineIndex?: number; instanceId?: number }> ): void
	/**
	 * Write new points into the existing buffers (another point count rebuilds).
	 * Mark lines updated every frame with `dynamic( true )`.
	 */
	setPositions( points: MultiLinePoints, updateBounding?: boolean ): void
	/**
	 * Overwrite points from `startPoint` on (of line `options.lineIndex` in a
	 * batch), uploading only that range. CPU billboard lines only.
	 */
	setPositionRange( points: ArrayLike<number> | Array<LinePointTuple | LinePointObject>, startPoint: number, options?: MeshLinePositionRangeOptions ): this
	/**
	 * Add a custom per-vertex attribute, read in TSL with `attribute( name )`.
	 * Billboard lines have four vertices per point. Each attribute costs one of
	 * WebGPU's eight vertex buffers: prefer `addVertexAttributes()`.
	 */
	addVertexAttribute( name: string, components?: number ): BufferAttribute
	/** Add several per-vertex attributes sharing one GPU buffer, e.g. `{ heat: 1, tint: 3 }`. */
	addVertexAttributes( layout: MeshLinePackedAttributeLayout ): Record<string, InterleavedBufferAttribute>
	/** Write a block of values into a vertex attribute from `startVertex` on. */
	setVertexValues( name: string, values: ArrayLike<number>, startVertex?: number ): this

	/** Add a custom per-instance attribute, read in TSL with `attribute( name )`. Prefer `addInstanceAttributes()`. */
	addInstanceAttribute( name: string, components?: number ): InstancedBufferAttribute
	/** Add several per-instance attributes sharing one GPU buffer, e.g. `{ offset: 3, phase: 1 }`. */
	addInstanceAttributes( layout: MeshLinePackedAttributeLayout ): Record<string, InterleavedBufferAttribute>
	/** Set one instance's value of a per-instance attribute. */
	setInstanceValue( name: string, index: number, value: number | number[] | { x: number; y: number; z?: number; w?: number } ): void
	/** Write a block of per-instance values from `startInstance` on, in one upload. */
	setInstanceValues( name: string, values: ArrayLike<number>, startInstance?: number ): this
	/** Count the vertex buffers this line uses against WebGPU's portable limit of eight. */
	getVertexBufferUsage( options?: MeshLineVertexBufferBudgetOptions ): MeshLineVertexBufferUsage
	/** Like `getVertexBufferUsage()`, but throws when the limit is exceeded. */
	validateVertexBufferBudget( options?: MeshLineVertexBufferBudgetOptions ): MeshLineVertexBufferUsage
	/**
	 * Viewport size in CSS pixels, which the screen-space width needs. Call it
	 * on resize with the canvas size, or use `autoResize()`.
	 */
	resize( width?: number, height?: number ): void
	/**
	 * Follow window resizes: `true` (default) tracks the window, or pass another
	 * target; `false` stops. A canvas smaller than the window needs `resize()`.
	 */
	autoResize( target?: MeshLineResizeTarget | boolean ): this
	/** Free the GPU buffers and material, stop `autoResize()` and remove the line from its parent. */
	dispose(): void
}

/** The full line facade: `MeshLineBillboard` plus the world-space surface profile. */
export class MeshLine extends MeshLineBillboard {}

// ---------------------------------------------------------------------------
// MeshLineCompute (WebGPU-only compute facade)
// ---------------------------------------------------------------------------

/**
 * WebGPU-only curve engine that keeps point state in storage buffers, updates
 * it with TSL compute nodes, and renders through MeshLine's ribbon material.
 */
export class MeshLineCompute extends MeshLine {
	readonly isMeshLineCompute: true
	readonly positionBuffer: BufferAttribute | null
	readonly velocityBuffer: BufferAttribute | null
	readonly baseBuffer: BufferAttribute | null
	readonly seedBuffer: BufferAttribute | null
	readonly distanceBuffer: BufferAttribute | null

	constructor( options?: MeshLineComputeOptions )

	configure( options?: MeshLineComputeOptions ): this
	curveCount( count: number ): this
	pointsPerCurve( count: number ): this
	curveLength( length: number ): this
	bounds( bounds: number ): this
	damping( damping: number ): this
	curlStrength( strength: number ): this
	flowSpeed( speed: number ): this
	homeStrength( strength: number ): this
	mouseStrength( strength: number ): this
	mouseRadius( radius: number ): this
	audioLevel( level: number ): this
	depthStrength( strength: number ): this
	textureStrength( strength: number ): this
	mode( mode: MeshLineComputeMode ): this
	stiffness( stiffness: number ): this
	mouse( target: Vector3 | { x: number; y: number; z?: number } | number[] ): this
	clearMouse(): this
	arcLengthNode( progress: MeshLineNodeValue ): MeshLineNodeValue
	step( renderer: WebGPURenderer, delta?: number ): boolean
	stepAsync( renderer: WebGPURenderer, delta?: number ): Promise<boolean>
	warmupAsync( renderer: WebGPURenderer, camera: Camera, scene?: Scene | null, options?: { step?: boolean; delta?: number } ): Promise<this>
	reset(): this
}

// ---------------------------------------------------------------------------
// MeshLineGeometry
// ---------------------------------------------------------------------------

export class MeshLineGeometry extends BufferGeometry {
	/** Vertices in use: four per point. `attributes.position.count` can be a larger capacity on a dynamic line. */
	readonly vertexCount: number
	/** Indices in use. Past them, a buffer with spare capacity holds zeros (degenerate triangles). */
	readonly indexCount: number
	readonly isMeshLine: true
	constructor( options?: MeshLineGeometryOptions )
	buildLine( options?: MeshLineGeometryOptions ): void
	setLines( points: MultiLinePoints, closed?: boolean | boolean[] ): void
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
	/**
	 * Change the join policy in place. The limit is a uniform; a new `type` or
	 * `fold` only recompiles the shader, keeping every other uniform and state.
	 */
	setJoin( join: MeshLineJoinOptions ): void
	/**
	 * For subclasses that replace `opacityNode`: apply the exact fold clip to
	 * `alpha` inside a TSL `Fn`, so their joins stay clipped.
	 */
	clipFoldedJoins( alpha: MeshLineNodeValue ): MeshLineNodeValue
	setShadow( enabled: boolean ): void
	dispose(): void
}

// ---------------------------------------------------------------------------
// MeshLine world-space surface profile
// ---------------------------------------------------------------------------

export interface MeshLineExternalGeometryTarget {
	setAttribute( name: string, data: Float32Array | BufferAttribute, itemSize?: number ): unknown
	setIndex?( data: Uint16Array | Uint32Array | BufferAttribute | null ): unknown
}

export class MeshLineSurfaceGeometry extends BufferGeometry {
	/** Vertices in use. `attributes.position.count` can be a larger capacity on a dynamic surface. */
	readonly vertexCount: number
	/** Indices in use. Past them, a buffer with spare capacity holds zeros (degenerate triangles). */
	readonly indexCount: number
	readonly isMeshLineSurfaceGeometry: true
	constructor( options?: MeshLineSurfaceGeometryOptions )
	buildLine( options?: MeshLineSurfaceGeometryOptions ): void
	setLines( points: MultiLinePoints, closed?: boolean | boolean[] ): void
	setPositions( points: MultiLinePoints ): void
	setUsage( usage: MeshLineUsage, name?: string | null ): void
	copyToGeometry<T extends BufferGeometry | MeshLineExternalGeometryTarget>( targetGeometry: T ): T
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
	warmupAsync(): Promise<this>
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
	warmupAsync( renderer?: WebGPURenderer, camera?: Camera, scene?: Scene | Object3D | null ): Promise<this>
	dispose(): void
}

// ---------------------------------------------------------------------------
// Shader accessors
// ---------------------------------------------------------------------------

/**
 * Normalized stroke coordinate for the billboard profile, usable inside any TSL
 * hook. `y` runs from -1 to +1 across the emitted cross-section, landing exactly
 * on the two silhouette edges; `x` is reserved for cap topology and is currently
 * always 0. It is a silhouette coordinate, not a signed distance in half-widths.
 */
export const lineCoord: MeshLineNodeValue

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

export function circlePositions( segments?: number, radius?: number ): Float32Array
export function squarePositions( width?: number, segments?: number ): Float32Array
export function rectanglePositions( width?: number, height?: number, segments?: number ): Float32Array
export function sineWavePositions( wavelengths?: number, segments?: number, amplitude?: number, length?: number ): Float32Array
export function straightLine( width?: number, segments?: number, isVertical?: boolean ): Float32Array
export function straightLineBetween( start: { x?: number; y?: number; z?: number } | number[], end: { x?: number; y?: number; z?: number } | number[], segments?: number ): Float32Array

export interface StoragePositionsOptions {
	/** Points stored per instance run. At least 2. */
	pointsPerLine: number
	/** `uint` uniform holding the newest slot. Turns every run into a ring buffer: progress 0 samples the head, 1 the oldest point. */
	head?: MeshLineNodeValue
	/** Optional target `StorageBufferAttribute` (`vec3` or `vec4`) to morph toward on the GPU. */
	toBuffer?: BufferAttribute | null
	/** Blend factor (`0..1` number, `uniform()`, or TSL node) between `buffer` and `toBuffer`. */
	morph?: MeshLineNodeValue
	/**
	 * When `true` (or a `0..1` TSL node/attribute for mixed open/closed instances),
	 * wraps endpoint neighbor indices across a closed loop whose last sample
	 * duplicates the first (`point[N-1] === point[0]`) for seamless closed joins.
	 */
	closed?: boolean | MeshLineNodeValue
	/**
	 * Read the stored point nearest to each sample instead of interpolating two.
	 * Use it when the line has exactly `pointsPerLine - 1` segments: one storage
	 * read per sample, and exact however long the line is.
	 */
	snap?: boolean
}

/**
 * Build a `gpuPositionNode` that samples line points from a `vec3`/`vec4`
 * storage buffer holding one run of `pointsPerLine` points per instance,
 * with optional ring-buffer head indexing, two-buffer GPU morphing, and
 * closed-loop seam wrapping.
 */
export function storagePositions( buffer: BufferAttribute, options: StoragePositionsOptions ): ( progress: MeshLineNodeValue ) => MeshLineNodeValue

export default MeshLine
