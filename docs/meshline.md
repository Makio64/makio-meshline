---
description: "Reference the MeshLine facade for camera-facing strokes and world-space road surfaces, including styling, hooks, instancing, and GPU positions."
---

# MeshLine Class

The `MeshLine` class is the main interface for creating lines. It extends `Mesh` from `three/webgpu` and provides TSL-powered line rendering capabilities.

**Quick Links:**
- [Common Patterns](./common-patterns.md) - Basic usage examples
- [Advanced Patterns](./advanced-patterns.md) - GPU-driven positions, instancing, custom shaders

## Constructor

```ts
new MeshLine(options?: MeshLineConfigureOptions)
```

`MeshLine` supports both options object configuration and a fluent API with chainable methods for easy configuration.

## Fluent API

The fluent API allow you to chain methods like the example bellow:

```js
const line = new MeshLine()
	.lines(positions)
	.color(0xff0000)
	.gradientColor(0x0000ff)
	.lineWidth(2)
	.opacity(0.8)
```

See [Common Patterns](./common-patterns.md) for more examples.

**Geometry Configuration:**
- `lines(lines: LinePoints | LinePoints[], closed?: boolean | boolean[])` (or alias `points(points, closed?)`) - Set one or more lines and optional close flag
- `segments(segments: number)` - Set number of segments for auto-generated lines
- `closed(closed: boolean | boolean[])` - Set whether to close the line loop
- `surface(options?: MeshLineSurfaceOptions | boolean)` - Select the camera-independent surface profile for roads and ribbons; `true` uses defaults and `false` returns to the screen profile

**Appearance:**
- `color(color: number | THREE.Color)` - Set line color
- `lineWidth(lineWidth: number)` - Set the full line width. With `sizeAttenuation(false)` this is CSS pixels; with the default `sizeAttenuation(true)` it is projected as a scene-space width.
- `widthCallback(callback: (progress: number, pointIndex?: number, lineIndex?: number) => number)` - Set an arc-length-based variable width multiplier
- `sizeAttenuation(enable: boolean)` - Enable scene-space projected width. Disable it for constant CSS-pixel width.
- `gradientColor(color: number | THREE.Color)` - Set gradient end color
- `vertexColors(colors: Float32Array | number[] | null)` - Set one RGB color per logical path point; billboard geometry expands each value across its four physical rows. A multi-line batch takes every line's colors concatenated in line order, or one line's worth shared by every line. On a built line a new array refreshes the colors in place; turning them on or off (`null`) rebuilds
- `opacity(opacity: number)` - Set opacity level

**Material Properties:**
- `alphaTest(threshold: number)` - Set alpha test threshold
- `transparent(enable: boolean)` - Enable/disable transparency, enable by default if opacity != 1 or alphaMap
- `wireframe(enable: boolean)` - Enable/disable wireframe mode

**Textures:**
- `map(texture: THREE.Texture)` - Set diffuse texture
- `alphaMap(texture: THREE.Texture)` - Set alpha mask texture
- `mapOffset(offset: THREE.Vector2 | null)` - Set or reset texture UV offset

**Dashes:**
- `dash({ count: number, ratio?: number, offset?: number } | null | false)` - Configure dash pattern, or pass `null` / `false` to disable dashes

**Shadow:**
- `shadow(enabled: boolean)` - Enable shadow casting

**Advanced:**

- `join('miter' | 'bevel' | 'round' | { type?: 'miter' | 'simple' | 'bevel' | 'round', limit?: number, segments?: number, inner?: 'exact' | 'clip', fold?: 'geometry' | 'exact' | false })` - Configure joins. `'simple'` is retained as a compatibility alias for `'miter'`. The regular billboard profile keeps crisp miters at corners the path really turns, up to `limit` (or bevel bridges with `'bevel'`). `fold` controls joins that only look sharp because a smooth curve's tangent points at the camera:
  - `'geometry'` (default) splits them in the vertex stage with no fragment cost. Split rows overlap slightly, which shows on translucent or additive lines.
  - `'exact'` clips them to the round tube silhouette in the fragment stage, and also melts over-limit corners into round.
  - `false` keeps plain miters.
 `type: 'round'` rounds every billboard join. World surfaces emit true bevel wedges and round fans; over-limit miters switch to bounded bevel topology. See [Projected folds](./common-patterns.md#12-projected-folds).
- `miterLimit(limit: number)` - Update the miter limit uniform in-place while preserving the current join type and fold policy.
- `cap('butt' | 'square' | 'round')` or `cap({ type, segments })` - Configure open-path endpoints. World surfaces and the optional native-WebGPU path emit true square/round cap topology; the regular billboard profile remains butt-capped.
- `smoothSharpBends(enabled: boolean)` - Toggle CPU-side splitting of polyline corners that are too sharp for the screen-space miter to render cleanly. Defaults to `false` so authored logical points retain their stable four-physical-vertices-per-point mapping. Enable for static sharp polylines when cleaner corners matter more than exact input topology.
- `smoothSharpBendsAlpha(alpha: number)` - Cutoff fraction used when `smoothSharpBends` is on: each sharp corner is replaced by two points sitting `alpha` of the way back along each adjacent segment. Smaller values preserve the pointy look; larger values flatten the tip more. Defaults to `0.001` (visually imperceptible but enough to stabilise the shader miter math).
- `smoothSharpBendsThreshold(threshold: number)` - `dot(dir_in, dir_out)` cutoff below which a vertex is considered sharp enough to subdivide. Defaults to `-0.5` (≈ 60° interior bend). Lower (more negative) values subdivide only the very sharpest corners.
- `dpr(ratio: number)` - Set the legacy/custom-hook DPR uniform
- `setFrustumCulled(enable: boolean)` - Explicitly enable/disable frustum culling; when disabled, build-time bounding volumes are skipped. Explicit overrides remain in force across later hook changes and rebuilds.
- `verbose(enable: boolean)` - Enable/disable verbose logging
- `renderSize(width: number, height: number)` - Set render resolution
- `gpuPositionNode(node: Fn)` - Set GPU position calculation node
- `usage(usage: THREE.Usage)` - Set buffer usage hint for position/next/prev (if they exist)
- `instances(count: number)` - Enable instancing with specified count
- `dynamic(enable: boolean)` - Toggle dynamic geometry updates (usage hints)
- `autoResize(target?: Window)` - Automatically update resolution on resize

**Hook Functions:**

The hook are used in the TSL Nodes in MeshLineNodeMaterial

- `positionFn(fn: Fn)` - Set position modification hook
- `previousFn(fn: Fn)` - Set previous position hook
- `nextFn(fn: Fn)` - Set next position hook
- `widthFn(fn: Fn)` - Set width modification hook
- `normalFn(fn: Fn)` - Set normal modification hook
- `colorFn(fn: Fn)` - Set color modification hook
- `gradientFn(fn: Fn)` - Set gradient modification hook
- `opacityFn(fn: Fn)` - Set opacity modification hook
- `dashFn(fn: Fn)` - Set dash modification hook
- `uvFn(fn: Fn)` - Set UV modification hook
- `vertexFn(fn: Fn)` - Set vertex modification hook
- `fragmentColorFn(fn: Fn)` - Set fragment color modification hook
- `fragmentAlphaFn(fn: Fn)` - Set fragment alpha modification hook
- `discardFn(fn: Fn)` - Set fragment discard condition hook

**Attribute Control (Advanced):**

These controls are auto-detected from your configuration and rarely need manual override:

- `needsUV(enable: boolean)` - Auto-detected from `map`, `alphaMap`, `uvFn`, `fragmentColorFn`, `fragmentAlphaFn`, `discardFn`
- `needsWidth(enable: boolean)` - Auto-detected from `widthCallback`, `widthFn`
- `needsProgress(enable: boolean)` - Force the progress attribute on; the facade otherwise allocates it only when an active feature consumes path progress
- `needsSide(enable: boolean)` - Force a separate physical side attribute for a custom low-level consumer. The built-in material normally decodes both side and incoming/outgoing ownership from the packed `joinRole` attribute, including after `toNonIndexed()`.
- `needsPrevious(enable: boolean)` - Auto-detected (disabled when using `gpuPositionNode`)
- `needsNext(enable: boolean)` - Auto-detected (disabled when using `gpuPositionNode`)
- `needsVertexColor(enable: boolean)` - Auto-detected from `vertexColors`

**Building:**
- `build()` - Finalize configuration and build the line (returns the instance)
- `rebuild()` - Rebuild geometry and material from the current configuration (returns the instance)
- `ensureBuilt()` - Ensures the line is built if not already, useful for accessing geometry before first render (returns the instance)

> **Note:** Call `build()` to finalize the configuration & build the geometry and tsl nodes, or the line will auto-build on first render (during `onBeforeRender`). Use `ensureBuilt()` when you need to access geometry attributes before the first render.

## Raycasting

`MeshLine` works with the standard Three.js `Raycaster` API:

```js
const raycaster = new Raycaster()
raycaster.params.Line.threshold = 0.2

const hits = raycaster.intersectObject( line )
```

When you only need the closest hit, enable `firstHitOnly`:

```js
raycaster.params.Line.firstHitOnly = true

const [hit] = raycaster.intersectObject( line )
```

- Instanced lines expose `hit.instanceId`
- Batched CPU lines expose `hit.lineIndex`
- `hit.point` contains the world-space hit position
- Fully GPU-defined non-instanced positions created only with `gpuPositionNode()` cannot be raycasted on the CPU

## Options Object Configuration

Alternatively, you can use the traditional options object approach:

### Quick signature

```ts
type LinePoint = [x: number, y: number, z?: number] | THREE.Vector2 | THREE.Vector3 | { x: number, y: number, z?: number }
type LinePoints = Float32Array | number[] | THREE.BufferGeometry | LinePoint[]

interface MeshLineConfigureOptions {
  // ***Geometry***
  lines?: LinePoints | LinePoints[]          // One line or multiple lines
  points?: LinePoints | LinePoints[]         // Alias for lines
  segments?: number                          // Template segments for GPU positions
  closed?: boolean | boolean[]               // Close the loop(s)
  surface?: boolean | MeshLineSurfaceOptions // `true` uses the default world-space surface profile

  // ***Appearance***
  color?: number | THREE.Color
  lineWidth?: number                         // Line width (default: 0.3)
  widthCallback?: (progress: number, pointIndex?: number, lineIndex?: number) => number
  sizeAttenuation?: boolean
  gradientColor?: number | null              // End-gradient colour
  vertexColors?: Float32Array | number[]     // Per-point RGB colors

  // ***Textures***
  map?: THREE.Texture | null
  alphaMap?: THREE.Texture | null
  mapOffset?: THREE.Vector2 | null

  // ***Dashes***
  dash?: { count?: number | null, ratio?: number, offset?: number } | null | false
  /** @deprecated Prefer dash.count. */
  dashCount?: number | null
  /** @deprecated Prefer dash.ratio. */
  dashRatio?: number | null
  /** @deprecated Prefer dash.offset. */
  dashOffset?: number

  // ***Joins and corner smoothing***
  join?: 'miter' | 'simple' | 'bevel' | 'round' | {
    type?: 'miter' | 'simple' | 'bevel' | 'round'
    limit?: number
    segments?: number
    inner?: 'exact' | 'clip'
    fold?: 'geometry' | 'exact' | false
  }
  miterLimit?: number                        // Convenience alias for join.limit
  cap?: 'butt' | 'square' | 'round' | {
    type?: 'butt' | 'square' | 'round'
    segments?: number
  }
  smoothSharpBends?: boolean
  smoothSharpBendsAlpha?: number
  smoothSharpBendsThreshold?: number

  // ***Shadow***
  shadow?: boolean

  // ***Rendering flags***
  opacity?: number
  alphaTest?: number
  transparent?: boolean
  wireframe?: boolean
  frustumCulled?: boolean

  // Device pixel ratio
  dpr?: number

  // ***Advanced / internal***
  needsWidth?: boolean                        // generate attributes width
  needsUV?: boolean
  needsProgress?: boolean
  needsPrevious?: boolean
  needsNext?: boolean
  needsSide?: boolean
  needsVertexColor?: boolean                    // generate vertex color attribute
  renderWidth?: number
  renderHeight?: number

  // Procedural GPU positions
  gpuPositionNode?: Fn< number, THREE.Vector3 > | null
  usage?: THREE.Usage

  // Instancing
  instanceCount?: number                          // Enable instancing with count

  // Hook Functions (TSL Fn)
  positionFn?: Fn | null
  previousFn?: Fn | null
  nextFn?: Fn | null
  widthFn?: Fn | null
  normalFn?: Fn | null
  colorFn?: Fn | null
  gradientFn?: Fn | null
  opacityFn?: Fn | null
  dashFn?: Fn | null
  uvFn?: Fn | null
  vertexFn?: Fn | null
  fragmentColorFn?: Fn | null
  fragmentAlphaFn?: Fn | null
  discardFn?: Fn | null

  dynamic?: boolean
  autoResize?: Window

  // Debugging
  verbose?: boolean
}

interface MeshLineSurfaceOptions {
  frame?: 'transport' | 'fixed-up'
  up?: THREE.Vector3 | [number, number, number]
  bank?: number | ArrayLike<number> | ((progress: number, pointIndex: number, lineIndex: number) => number)
  uvMode?: 'distance' | 'stretch'
  uvScale?: number
  roughness?: number
  metalness?: number
  normalMap?: THREE.Texture | null
  roughnessMap?: THREE.Texture | null
  metalnessMap?: THREE.Texture | null
  side?: THREE.Side
}
```

## MeshLineConfigureOptions

### Geometry

- **`lines`** (`LinePoints | LinePoints[]`) — The line point data. A single line can be a flat `Float32Array`, a flat numeric XYZ array, an array of `[x, y, z]` tuples, `Vector2`/`Vector3` points, plain `{ x, y, z? }` points, or a `BufferGeometry` with a `position` attribute. Pass an array of those values for multiple lines. Default: `new Float32Array([0,0,0,1,0,0])`.

> **Procedural alternative:** instead of supplying a `lines` array you can provide a **`gpuPositionNode`** function (TSL `Fn`).  The node receives the per-vertex `progress` (0→1) and must return a `vec3` position.  When set, the geometry sent to the GPU can be minimal – only its length matters so that the `progress` attribute is generated.

- **`closed`** (`boolean | boolean[]`) — Whether to close the line loop(s). If `true`, connects the last point back to the first. For multiple lines, can be an array of booleans. Default: `false`.

- **`surface`** (`MeshLineSurfaceOptions | boolean`) — Selects camera-independent world-space geometry. Pass `true` or call `.surface()` for defaults; pass `false` to restore the camera-facing screen profile. Width is measured in world units and the material uses standard PBR shading. See [World-Space Surfaces](/surface) for frames, banking, UVs, joins, and current topology limits. Default: `false`.

### Appearance

- **`color`** (`number | THREE.Color`) — Base color of the line. Can be a hex number (`0xff0000`) or `THREE.Color` instance. Default: `0xffffff` (white).

- **`lineWidth`** (`number`) — Full width of the line. When `sizeAttenuation` is `false`, this is a constant CSS-pixel width. When `true`, it is projected as a scene-space width and attenuates with distance. Default: `0.3`.

- **`widthCallback`** (`(progress: number, pointIndex?: number, lineIndex?: number) => number`) — Receives normalized arc-length progress plus the optional source point and line indices, and returns a width multiplier. Default: `null`.

- **`sizeAttenuation`** (`boolean`) — Whether `lineWidth` is projected in scene space. When `false`, lines maintain constant CSS-pixel width regardless of distance. Default: `true`.

- **`gradientColor`** (`number | null`) — Optional gradient end color. When set, the line will smoothly transition from `color` to `gradientColor` along its length. Default: `null` (no gradient).

- **`vertexColors`** (`Float32Array | number[] | null`) — Per-logical-point RGB colors. Supply a flat array in the 0–1 range with three values per authored point; the geometry duplicates each color across the point's physical billboard rows. Each point color is multiplied with the base `color`. Best used with `Float32Array` for performance. Default: `null` (no vertex colors).
  - **Multi-line batches:** concatenate every line's colors in line order, the same layout as their positions; each line reads from its own global point start. An array shorter than the whole batch is a shared pattern instead: every line reads it from its own first point, so one line's worth of colors paints every line alike.
  - **Closed lines:** give one color per unique point. The closing seam reuses the line's first color and takes no slot.
  - **Kept points only:** colors follow the points the geometry keeps. Dropped points (consecutive duplicates, non-finite values, a closed line's repeated closing point, lines with fewer than two distinct points) and corners added by `smoothSharpBends` shift the colors that follow them, so pass clean points when colors must line up.
  - **After build:** `vertexColors(newColors)` rewrites the color buffer in place from the line's current points, without recompiling the material. Turning colors on, or off with `null`, rebuilds the line so the material gains or drops its vertex-color path. Surface lines have no vertex colors; they keep the array for when the line returns to the billboard profile.

### Textures

- **`map`** (`THREE.Texture | null`) — Diffuse texture to apply along the line. The texture is mapped using UV coordinates generated along the line length. Default: `null`.

- **`alphaMap`** (`THREE.Texture | null`) — Alpha mask texture for transparency effects. Uses the red channel of the texture for alpha values. Default: `null`.

- **`mapOffset`** (`THREE.Vector2 | null`) — UV offset for both `map` and `alphaMap` textures. Allows shifting texture coordinates. Default: `null` (no offset).

### Dashes

- **`dash`** (`MeshLineDashOptions`) — Configures the complete dash pattern with `{ count, ratio, offset }`. `count` is the number of cycles along the path, `ratio` is the visible fraction of each cycle from `0` to `1`, and `offset` shifts the pattern for animation. Omit `dash` or its `count` to render a solid line.

```js
const line = new MeshLine( {
  lines: points,
  dash: { count: 12, ratio: 0.6, offset: 0 }
} )

// Animate without rebuilding.
line.material.dashOffset.value += 0.01
```

`dashCount`, `dashRatio`, and `dashOffset` remain accepted for v1 compatibility but are deprecated. Prefer the grouped `dash` option or `.dash( options )` in new code.

### Shadow

- **`shadow`** (`boolean`) — Enable shadow casting for the line. When enabled, the line will cast shadows in your scene. Requires proper Three.js shadow setup (renderer shadowMap enabled, lights with castShadow, and receiving meshes with receiveShadow). Default: `false`.

> **Custom Shadow Color:** After building the line, access `material.castShadowNode` to customize shadow appearance. Use a `vec4` so the shadow keeps an explicit alpha channel. For example, `material.castShadowNode = vec4( 0.7, 0.7, 0.7, 1 )` creates lighter, softer shadows.

### Rendering Flags

- **`opacity`** (`number`) — Global opacity multiplier (0 to 1). Default: `1` (fully opaque).

- **`alphaTest`** (`number`) — Alpha threshold for fragment discard. Fragments with alpha below this value are discarded. Default: `0`.

- **`transparent`** (`boolean`) — Whether the material should be rendered with transparency. Auto-detected based on other settings if not explicitly set. Default: `false`.

- **`wireframe`** (`boolean`) — Render the line geometry as wireframe. Mainly useful for debugging. Default: `false`.

- **`frustumCulled`** (`boolean`) — Whether Three.js should frustum-cull the line. The automatic default is `true` only for ordinary scene-width CPU paths. It becomes `false` for CSS-pixel width, `gpuPositionNode`, or any potentially geometry-deforming `positionFn`, `previousFn`, `nextFn`, `widthFn`, `normalFn`, or `vertexFn`, because CPU bounds cannot conservatively predict those GPU changes. Pass `frustumCulled` or call `setFrustumCulled()` only when you provide a conservative bound; that explicit choice remains in force across later hook changes and rebuilds.

### Device Pixel Ratio

- **`dpr`** (`number`) — Device pixel ratio uniform kept for custom hooks and backward compatibility. CSS-pixel `lineWidth` uses CSS-sized `resolution`, so it stays the same visible size across DPR values while the renderer still draws more physical pixels.

### Advanced / Internal

- **`needsWidth`** (`boolean`) — Whether the line needs width information. Auto-enabled by `widthCallback` or `widthFn`. Default: `false`.

- **`needsUV`** (`boolean`) — Whether the line needs UV coordinates. Auto-enabled by textures, `uvFn`, fragment hooks, or `discardFn`. Default: `false`.

- **`needsProgress`** (`boolean`) — Force a progress attribute for a custom low-level consumer. The facade otherwise enables it only for gradients, dashes, width callbacks, GPU positions, or hooks that consume progress.

- **`needsPrevious`** (`boolean`) — Whether the line needs previous point information. Default: `true`.

- **`needsNext`** (`boolean`) — Whether the line needs next point information. Default: `true`.

- **`needsSide`** (`boolean`) — Force a separate physical `+1/-1` side attribute for a custom low-level consumer. The facade default is `false`: its built-in material decodes side and body ownership from the always-generated packed `joinRole` values `[-1, -2, +1, +2]`, corresponding to `[incoming+, incoming-, outgoing+, outgoing-]`. Because that attribute is copied by `toNonIndexed()`, conversion no longer requires `needsSide: true`; `needsSide` does not control `joinRole`.

- **`renderWidth`** (`number`) — CSS-pixel viewport width used by the line material. Defaults to `window.innerWidth` in a browser and `1024` in SSR/Node.

- **`renderHeight`** (`number`) — CSS-pixel viewport height used by the line material. Defaults to `window.innerHeight` in a browser and `768` in SSR/Node.

- **`verbose`** (`boolean`) — When `true` logs to the console which buffer attributes are generated for the geometry. Useful for debugging option combinations. Default: `false`.

### Instancing

- **`instanceCount`** (`number`) — When set to a positive number, enables instanced rendering for the specified number of instances. Each instance renders the same line geometry but can have different transformations, colors, and other per-instance properties via custom attributes. Default: `-1` (instancing disabled).

> **Instance Attributes:** Use `addInstanceAttributes({ name: components, ... })` when a hook consumes several values so they share one portable GPU buffer; `addInstanceAttribute(name, components)` remains convenient for one value. Use `setInstanceValues(name, typedArray)` for initial or bulk data and `setInstanceValue(name, index, value)` for occasional edits. Instance attributes can be accessed in hook functions using `attribute(name, type)`.

### Hook Functions

Hook functions allow custom TSL (Three.js Shading Language) code to modify various aspects of line rendering. All hooks are optional and receive relevant parameters for their processing stage:

- **`positionFn`** (`Fn | null`) — Modify vertex positions. Receives `(position, progress)`.
- **`previousFn`** (`Fn | null`) — Override the previous-neighbour position used to calculate line direction. Receives `(previous, progress)`.
- **`nextFn`** (`Fn | null`) — Override the next-neighbour position used to calculate line direction. Receives `(next, progress)`.
- **`widthFn`** (`Fn | null`) — Modify line width. Receives `(width, progress, side)`.
- **`normalFn`** (`Fn | null`) — Modify the calculated screen-space normal. Receives `(normal, dir, dir1, dir2, progress, side)`.
- **`colorFn`** (`Fn | null`) — Modify vertex colors. Receives `(color, progress, side)`.
- **`gradientFn`** (`Fn | null`) — Modify gradient factor. Receives `(gradientFactor, side)`.
- **`opacityFn`** (`Fn | null`) — Modify opacity in fragment shader. Receives `(alpha, progress, side)`.
- **`dashFn`** (`Fn | null`) — Modify dash pattern. Receives `(cyclePosition, progress, side)`.
- **`uvFn`** (`Fn | null`) — Modify UV coordinates. Receives `(uvCoords, progress, side)`.
- **`vertexFn`** (`Fn | null`) — Final vertex position modification. Receives `(finalPosition, normal, progress, side)`.
- **`fragmentColorFn`** (`Fn | null`) — Final fragment color modification. Receives `(color, uvCoords, progress, side)`.
- **`fragmentAlphaFn`** (`Fn | null`) — Final fragment alpha modification. Receives `(alpha, uvCoords, progress, side)`.
- **`discardFn`** (`Fn | null`) — Custom discard condition. Receives `(progress, side, uvCoords)`. Return truthy to discard fragment.

> **TSL Functions:** Hook functions must be created using `Fn()` from `three/tsl`. They run on the GPU for maximum performance and can access uniform values, attributes, and built-in variables like `time` and `instanceIndex`.

### Updating geometry efficiently

For lines controlled by the CPU whose vertices change every frame (for example interactive trails), avoid rebuilding the full geometry by calling **`line.setPositions( positionsF32 )`**.
`positionsF32` must be the same length as the original `lines` array (and ideally the same Float32Array reused each frame).  Only the `position`, `previous` and `next` buffers are updated in-place, so no new GPU buffers are created.

For efficient position updates, see [Dynamic Updates](./common-patterns.md#9-dynamic-updates) in Common Patterns.

Use `line.setPositions(positions, true)` or `geometry.setPositions(positions, true)` when dynamic motion changes the bounds enough for frustum culling to matter.

When only a fixed span changes, `line.setPositionRange(patch, startPoint, { lineIndex, updateBounding })` avoids rewriting and uploading the whole position/neighbor buffers. The range cannot introduce duplicate points or change topology. Arc-length-dependent progress, UV, endpoint metadata, and callback widths still refresh for the affected line. Surface transport frames and `smoothSharpBends` use `setPositions()` because a local edit can affect derived topology or frames beyond the edited span.

Position and viewport updates are persistent facade state: data written through `setPositions()` or `setPositionRange()`, and CSS viewport dimensions written through `resize()`, remain the source for a later `rebuild()`. A rebuild does not silently restore the constructor's original points or viewport.

## Methods

### Configuration

**`configure(options?: MeshLineConfigureOptions): MeshLine`**

Applies several options at once through the same validated setters used by the fluent API. The constructor calls `configure()` internally, and the method returns the line for chaining. Setter-specific rebuild behavior still applies when configuring an already-built line.

```js
line.configure( {
  color: 0xff6600,
  lineWidth: 0.4,
  dash: { count: 8, ratio: 0.5 }
} )
```

### Building & Lifecycle

**`build(): MeshLine`**

Builds geometry and material from the current configuration. It is optional before rendering because `ensureBuilt()` calls it automatically on the first render.

**`rebuild(): MeshLine`**

Marks the line as unbuilt and immediately rebuilds it from the current configuration. Use it when you deliberately need to refresh both geometry and material after changing build-time state. The latest `setPositions()`/`setPositionRange()` data and `resize()` dimensions remain active.

**`ensureBuilt(): MeshLine`**

Ensures the line is built before accessing geometry-dependent properties. Automatically called by methods that require built geometry. Returns the instance for chaining.

```js
// Ensure geometry is built before accessing attributes
line.ensureBuilt()
const positions = line.geometry.getAttribute('position')
```

### Position Updates

**`setPositions(points: LinePoints | LinePoints[], updateBounding?: boolean): void`**

Updates CPU-controlled line positions in place when topology is unchanged. If line or point counts change, the geometry performs a full rebuild. Pass `true` for `updateBounding` when edited points can leave the previous bounds. The updated positions become the facade's current line data and survive later material or shader rebuilds.

```js
updateTrail( points )
line.setPositions( points, true )
```

**`setPositionRange(points: ArrayLike<number> | LinePoint[], startPoint: number, options?: MeshLinePositionRangeOptions): MeshLine`**

Updates a fixed-size range of a CPU billboard line and returns the line for chaining. `options.lineIndex` selects a line in a batch and `options.updateBounding` controls bounds recomputation. The patched canonical lines become the facade's current data and survive later rebuilds. This method cannot change topology, introduce consecutive duplicate points, run with `smoothSharpBends`, or update surface geometry; use `setPositions()` in those cases.

```js
line.setPositionRange( patch, 2048, {
  lineIndex: 0,
  updateBounding: true
} )
```

### Vertex Attributes

**`addVertexAttribute(name: string, components = 1): BufferAttribute`**

Creates a new per-physical-vertex buffer attribute with the specified name and component count. Returns the created `BufferAttribute`. A regular billboard has four physical vertices for each logical point in `[incoming+, incoming-, outgoing+, outgoing-]` order. Duplicate point-scoped values across all four rows unless the shader intentionally needs different data per incident body or side. Same-topology rebuilds preserve custom attributes, but a point/line-count change removes them because their vertex mapping is no longer valid; recreate and refill them after the topology change. Managed names such as `position`, `side`, and `joinRole` are reserved.

```js
// Create a 3-component attribute for custom vertex colors
const colorAttr = line.addVertexAttribute('lineColor', 3)

// Create a 1-component attribute for vertex IDs
const idAttr = line.addVertexAttribute('vertexId', 1)

// Fill a reusable CPU buffer. Keep all four physical roles at a logical point equal.
const colors = new Float32Array(colorAttr.array.length)
const logicalPointCount = colorAttr.count / 4
for (let pointIndex = 0; pointIndex < logicalPointCount; pointIndex++) {
  const color = [Math.random(), Math.random(), Math.random()]
  for (let role = 0; role < 4; role++) {
    const offset = (pointIndex * 4 + role) * 3
    colors.set(color, offset)
  }
}
line.setVertexValues('lineColor', colors)
```

**`addVertexAttributes(layout: Record<string, 1 | 2 | 3 | 4>): Record<string, InterleavedBufferAttribute>`**

Creates several custom attributes in one interleaved GPU buffer. Prefer this form when a hook needs multiple custom values: portable WebGPU adapters guarantee only eight vertex-buffer slots, while every separate `BufferAttribute` consumes one slot.

```js
const { heat, flow } = line.addVertexAttributes({
  heat: 1,
  flow: 2
})

line.setVertexValues('heat', heatValues)
line.setVertexValues('flow', flowValues)
```

The returned attributes share one backing array. Use `setVertexValues()` for component-aware writes; direct writes must respect the interleaved buffer's `stride` and each attribute's `offset`.

**`setVertexValues(name: string, values: ArrayLike<number>, startVertex = 0): MeshLine`**

Uploads a flat block into an existing vertex attribute. `startVertex` is a physical vertex index and defaults to zero; for regular billboard point `i`, its first row is `i * 4`. The method validates the destination capacity before marking the affected range for upload.

### Instance Management

**`addInstanceAttribute(name: string, components = 1): InstancedBufferAttribute`**

Creates a new instanced buffer attribute with the specified name and component count. Returns the created `InstancedBufferAttribute` for direct manipulation if needed.

```js
// Create a 3-component attribute for instance positions
const offsetAttr = line.addInstanceAttribute('instanceOffset', 3)

// Create a 1-component attribute for instance scale
const scaleAttr = line.addInstanceAttribute('instanceScale', 1)
```

**`addInstanceAttributes(layout: Record<string, 1 | 2 | 3 | 4>): Record<string, InterleavedBufferAttribute>`**

Packs several per-instance values into one instanced buffer. This is the portable default for feature-heavy instanced lines.

```js
line.addInstanceAttributes({
  instanceOffset: 3,
  instanceScale: 1
})

line.setInstanceValues('instanceOffset', offsets)
line.setInstanceValues('instanceScale', scales)
```

**`getVertexBufferUsage(options?): MeshLineVertexBufferUsage`** returns the current distinct-buffer layout, grouping interleaved attributes together. `validateVertexBufferBudget(options?)` returns the same report or throws an actionable error when the portable limit is exceeded. Both accept `{ limit = 8, reservedBuffers = 0 }` for diagnostics against a known adapter or additional application-owned streams.

The facade validates this budget during builds and before adding custom buffers, so unsupported combinations fail before WebGPU pipeline creation. Low-level geometry remains available when an application intentionally targets hardware with a higher verified limit.

**`setInstanceValue(name: string, index: number, value: number | number[] | { x: number; y: number; z?: number; w?: number }): void`**

Sets the value for a specific instance at the given index. The value can be a single number (for 1-component attributes) or an array of numbers (for multi-component attributes).

```js
// Set position for instance 0
line.setInstanceValue('instanceOffset', 0, [1, 2, 3])

// Set scale for instance 0
line.setInstanceValue('instanceScale', 0, 1.5)
```

**`setInstanceValues(name: string, values: ArrayLike<number>, startInstance = 0): MeshLine`**

Writes a contiguous block to an instance attribute. Prefer this for initial data and large updates because the typed array copy and GPU version change happen once.

```js
const offsets = new Float32Array( instanceCount * 3 )
fillOffsets( offsets )
line.setInstanceValues( 'instanceOffset', offsets )
```

For advanced instancing examples, see:
- [Instanced Lines](./advanced-patterns.md#6-instanced-lines) for a complete packed-attribute example
- [GPU Instanced Circles](./advanced-patterns.md#7-gpu-instanced-circles) for complex animated instances

### Other Methods

**`resize(width?: number, height?: number): void`**

Updates the current material resolution and stores the CSS viewport dimensions for later rebuilds. Call this when the canvas size changes to maintain correct line-width scaling; a subsequent shader or material rebuild keeps the most recent size.

**`autoResize(target?: MeshLineResizeTarget): MeshLine`**

Registers a resize listener on a window-like target and returns the line. The listener updates the material resolution from `target.innerWidth` and `target.innerHeight`; `dispose()` removes it.

**`dispose(): void`**

Cleans up GPU resources including geometry, material, and instance attributes. Call this when the line is no longer needed.
