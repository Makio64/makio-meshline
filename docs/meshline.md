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
new MeshLine(options?: MeshLineOptions)
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
- `lines(lines: LinePoints | LinePoints[], closed?: boolean | boolean[])` - Set one or more lines and optional close flag
- `segments(segments: number)` - Set number of segments for auto-generated lines
- `closed(closed: boolean | boolean[])` - Set whether to close the line loop
- `surface(options?: MeshLineSurfaceOptions | boolean)` - Select the camera-independent surface profile for roads and ribbons; `true` uses defaults and `false` returns to the screen profile

**Appearance:**
- `color(color: number | THREE.Color)` - Set line color
- `lineWidth(lineWidth: number)` - Set the full line width. With `sizeAttenuation(false)` this is CSS pixels; with the default `sizeAttenuation(true)` it is projected as a scene-space width.
- `widthCallback(callback: (progress: number, pointIndex?: number, lineIndex?: number) => number)` - Set an arc-length-based variable width multiplier
- `sizeAttenuation(enable: boolean)` - Enable scene-space projected width. Disable it for constant CSS-pixel width.
- `gradientColor(color: number | THREE.Color)` - Set gradient end color
- `vertexColors(colors: Float32Array | number[])` - Set per-vertex RGB colors
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
- `dash({ count: number, ratio?: number, offset?: number })` - Configure dash pattern

**Shadow:**
- `shadow(enabled: boolean)` - Enable shadow casting

**Advanced:**

- `join({ type?: 'miter' | 'bevel' | 'round', limit?: number, segments?: number })` - Configure joins. The regular billboard profile keeps its bounded fixed-strip miter. World surfaces emit true bevel wedges and round fans; over-limit miters switch to bounded bevel topology.
- `cap('butt' | 'square' | 'round')` or `cap({ type, segments })` - Configure open-path endpoints. World surfaces and the optional native-WebGPU path emit true square/round cap topology; the regular billboard profile remains butt-capped.
- `smoothSharpBends(enabled: boolean)` - Toggle CPU-side splitting of polyline corners that are too sharp for the screen-space miter to render cleanly. Defaults to `false` so GPU buffers stay aligned 1:1 with your input points. Enable for static sharp polylines when cleaner corners matter more than exact input topology.
- `smoothSharpBendsAlpha(alpha: number)` - Cutoff fraction used when `smoothSharpBends` is on: each sharp corner is replaced by two points sitting `alpha` of the way back along each adjacent segment. Smaller values preserve the pointy look; larger values flatten the tip more. Defaults to `0.001` (visually imperceptible but enough to stabilise the shader miter math).
- `smoothSharpBendsThreshold(threshold: number)` - `dot(dir_in, dir_out)` cutoff below which a vertex is considered sharp enough to subdivide. Defaults to `-0.5` (≈ 60° interior bend). Lower (more negative) values subdivide only the very sharpest corners.
- `dpr(ratio: number)` - Set the legacy/custom-hook DPR uniform
- `setFrustumCulled(enable: boolean)` - Enable/disable frustum culling; when disabled, build-time bounding volumes are skipped
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
- `needsSide(enable: boolean)` - Force a physical side attribute (also useful before converting geometry to non-indexed); the default indexed shader derives side from the paired vertex index
- `needsPrevious(enable: boolean)` - Auto-detected (disabled when using `gpuPositionNode`)
- `needsNext(enable: boolean)` - Auto-detected (disabled when using `gpuPositionNode`)
- `needsVertexColor(enable: boolean)` - Auto-detected from `vertexColors`

**Building:**
- `build()` - Finalize configuration and build the line (returns the instance)
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

interface MeshLineOptions {
  // ***Geometry***
  lines?: LinePoints | LinePoints[]          // One line or multiple lines
  segments?: number                          // Template segments for GPU positions
  closed?: boolean | boolean[]               // Close the loop(s)
  surface?: boolean | MeshLineSurfaceOptions // `true` uses the default world-space surface profile

  // ***Appearance***
  color?: number | THREE.Color
  lineWidth?: number                         // Line width (default: 0.3)
  widthCallback?: (progress: number, pointIndex?: number, lineIndex?: number) => number
  sizeAttenuation?: boolean
  gradientColor?: number | null              // End-gradient colour
  vertexColors?: Float32Array | number[]     // Per-vertex RGB colors

  // ***Textures***
  map?: THREE.Texture | null
  alphaMap?: THREE.Texture | null
  mapOffset?: THREE.Vector2 | null

  // ***Dashes***
  dash?: { count?: number, ratio?: number, offset?: number }
  dashCount?: number | null
  dashRatio?: number | null
  dashOffset?: number

  // ***Joins and corner smoothing***
  join?: {
    type?: 'miter' | 'bevel' | 'round'
    limit?: number
    segments?: number
  }
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

## MeshLineOptions

### Geometry

- **`lines`** (`LinePoints | LinePoints[]`) — The line point data. A single line can be a flat `Float32Array`, a flat numeric XYZ array, an array of `[x, y, z]` tuples, `Vector2`/`Vector3` points, plain `{ x, y, z? }` points, or a `BufferGeometry` with a `position` attribute. Pass an array of those values for multiple lines. Default: `new Float32Array([0,0,0,1,0,0])`.

> **Procedural alternative:** instead of supplying a `lines` array you can provide a **`gpuPositionNode`** function (TSL `Fn`).  The node receives the per-vertex `progress` (0→1) and must return a `vec3` position.  When set, the geometry sent to the GPU can be minimal – only its length matters so that the `progress` attribute is generated.

- **`closed`** (`boolean | boolean[]`) — Whether to close the line loop(s). If `true`, connects the last point back to the first. For multiple lines, can be an array of booleans. Default: `false`.

- **`surface`** (`MeshLineSurfaceOptions | boolean`) — Selects camera-independent world-space geometry. Pass `true` or call `.surface()` for defaults; pass `false` to restore the camera-facing screen profile. Width is measured in world units and the material uses standard PBR shading. See [World-Space Surfaces](/surface) for frames, banking, UVs, joins, and current topology limits. Default: `false`.

### Appearance

- **`color`** (`number | THREE.Color`) — Base color of the line. Can be a hex number (`0xff0000`) or `THREE.Color` instance. Default: `0xffffff` (white).

- **`lineWidth`** (`number`) — Full width of the line. When `sizeAttenuation` is `false`, this is a constant CSS-pixel width. When `true`, it is projected as a scene-space width and attenuates with distance. Default: `0.3`.

- **`widthCallback`** (`(progress: number, pointIndex?: number, lineIndex?: number) => number | null`) — Receives normalized arc-length progress plus the optional source point and line indices, and returns a width multiplier. Default: `null`.

- **`sizeAttenuation`** (`boolean`) — Whether `lineWidth` is projected in scene space. When `false`, lines maintain constant CSS-pixel width regardless of distance. Default: `true`.

- **`gradientColor`** (`number | null`) — Optional gradient end color. When set, the line will smoothly transition from `color` to `gradientColor` along its length. Default: `null` (no gradient).

- **`vertexColors`** (`Float32Array | number[]`) — Per-vertex RGB colors for individual point coloring. Should be a flat array of RGB values (0-1 range) with 3 values per vertex. When set, each point along the line can have its own color, multiplied with the base `color`. Best used with `Float32Array` for performance. Default: `null` (no vertex colors).

### Textures

- **`map`** (`THREE.Texture | null`) — Diffuse texture to apply along the line. The texture is mapped using UV coordinates generated along the line length. Default: `null`.

- **`alphaMap`** (`THREE.Texture | null`) — Alpha mask texture for transparency effects. Uses the red channel of the texture for alpha values. Default: `null`.

- **`mapOffset`** (`THREE.Vector2 | null`) — UV offset for both `map` and `alphaMap` textures. Allows shifting texture coordinates. Default: `null` (no offset).

### Dashes

- **`dashCount`** (`number | null`) — Number of dash cycles along the entire line length. When set, creates a dashed line pattern. Default: `null` (solid line).

- **`dashRatio`** (`number | null`) — Ratio of dash length to gap length (0 to 1). For example, `0.5` creates equal dash and gap lengths, `0.7` creates longer dashes with shorter gaps. Only works when `dashCount` is set. Default: `null`.

- **`dashOffset`** (`number`) — Offset into the dash cycle pattern. Animate this value to create moving dash effects. Default: `0`.

### Shadow

- **`shadow`** (`boolean`) — Enable shadow casting for the line. When enabled, the line will cast shadows in your scene. Requires proper Three.js shadow setup (renderer shadowMap enabled, lights with castShadow, and receiving meshes with receiveShadow). Default: `false`.

> **Custom Shadow Color:** After building the line, access `material.castShadowNode` to customize shadow appearance. Use a `vec4` so the shadow keeps an explicit alpha channel. For example, `material.castShadowNode = vec4( 0.7, 0.7, 0.7, 1 )` creates lighter, softer shadows.

### Rendering Flags

- **`opacity`** (`number`) — Global opacity multiplier (0 to 1). Default: `1` (fully opaque).

- **`alphaTest`** (`number`) — Alpha threshold for fragment discard. Fragments with alpha below this value are discarded. Default: `0`.

- **`transparent`** (`boolean`) — Whether the material should be rendered with transparency. Auto-detected based on other settings if not explicitly set. Default: `false`.

- **`wireframe`** (`boolean`) — Render the line geometry as wireframe. Mainly useful for debugging. Default: `false`.

- **`frustumCulled`** (`boolean`) — Whether the line should be frustum culled by Three.js. Default: `true` for CPU paths. It defaults to `false` after `gpuPositionNode()` because the synthetic CPU template cannot bound arbitrary shader-generated positions; call `setFrustumCulled( true )` only when you provide a conservative bound yourself.

### Device Pixel Ratio

- **`dpr`** (`number`) — Device pixel ratio uniform kept for custom hooks and backward compatibility. CSS-pixel `lineWidth` uses CSS-sized `resolution`, so it stays the same visible size across DPR values while the renderer still draws more physical pixels.

### Advanced / Internal

- **`needsWidth`** (`boolean`) — Whether the line needs width information. Auto-enabled by `widthCallback` or `widthFn`. Default: `false`.

- **`needsUV`** (`boolean`) — Whether the line needs UV coordinates. Auto-enabled by textures, `uvFn`, fragment hooks, or `discardFn`. Default: `false`.

- **`needsProgress`** (`boolean`) — Force a progress attribute for a custom low-level consumer. The facade otherwise enables it only for gradients, dashes, width callbacks, GPU positions, or hooks that consume progress.

- **`needsPrevious`** (`boolean`) — Whether the line needs previous point information. Default: `true`.

- **`needsNext`** (`boolean`) — Whether the line needs next point information. Default: `true`.

- **`needsSide`** (`boolean`) — Force a physical side attribute for a custom low-level consumer or before `toNonIndexed()`. The default indexed line shader derives its `+1/-1` side from paired vertex indices, so the facade default is `false`; when enabled, the built-in material reads the attribute.

- **`renderWidth`** (`number`) — Width of the rendered line. Default: `1024`.

- **`renderHeight`** (`number`) — Height of the rendered line. Default: `1024`.

- **`verbose`** (`boolean`) — When `true` logs to the console which buffer attributes are generated for the geometry. Useful for debugging option combinations. Default: `false`.

### Instancing

- **`instanceCount`** (`number`) — When set to a positive number, enables instanced rendering for the specified number of instances. Each instance renders the same line geometry but can have different transformations, colors, and other per-instance properties via custom attributes. Default: `-1` (instancing disabled).

> **Instance Attributes:** Use `addInstanceAttribute(name, components)` to create per-instance attributes. Use `setInstanceValues(name, typedArray)` for initial or bulk data and `setInstanceValue(name, index, value)` for occasional edits. Instance attributes can be accessed in hook functions using `attribute(name, type)`.

### Hook Functions

Hook functions allow custom TSL (Three.js Shading Language) code to modify various aspects of line rendering. All hooks are optional and receive relevant parameters for their processing stage:

- **`positionFn`** (`Fn | null`) — Modify vertex positions. Receives `(position, progress)`.
- **`widthFn`** (`Fn | null`) — Modify line width. Receives `(width, progress, side)`.
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

## Methods

### Building & Lifecycle

**`ensureBuilt(): MeshLine`**

Ensures the line is built before accessing geometry-dependent properties. Automatically called by methods that require built geometry. Returns the instance for chaining.

```js
// Ensure geometry is built before accessing attributes
line.ensureBuilt()
const positions = line.geometry.getAttribute('position')
```

### Vertex Attributes

**`addVertexAttribute(name: string, components: number): BufferAttribute`**

Creates a new per-vertex buffer attribute with the specified name and component count. Returns the created `BufferAttribute` for direct manipulation. Useful for custom per-vertex data like colors, IDs, or other metadata.

```js
// Create a 3-component attribute for custom vertex colors
const colorAttr = line.addVertexAttribute('lineColor', 3)

// Create a 1-component attribute for vertex IDs
const idAttr = line.addVertexAttribute('vertexId', 1)

// Access and modify the attribute data
const colors = colorAttr.array
for (let i = 0; i < colors.length; i += 3) {
  colors[i] = Math.random()     // R
  colors[i + 1] = Math.random() // G
  colors[i + 2] = Math.random() // B
}
colorAttr.needsUpdate = true
```

### Instance Management

**`addInstanceAttribute(name: string, components: number): InstancedBufferAttribute`**

Creates a new instanced buffer attribute with the specified name and component count. Returns the created `InstancedBufferAttribute` for direct manipulation if needed.

```js
// Create a 3-component attribute for instance positions
const offsetAttr = line.addInstanceAttribute('instanceOffset', 3)

// Create a 1-component attribute for instance scale
const scaleAttr = line.addInstanceAttribute('instanceScale', 1)
```

**`setInstanceValue(name: string, index: number, value: number | number[]): void`**

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
- [Basic Instancing](./common-patterns.md#10-basic-instancing) for simple use cases
- [GPU Instanced Circles](./advanced-patterns.md#7-gpu-instanced-circles) for complex animated instances

### Other Methods

**`resize(width?: number, height?: number): void`**

Updates the material's resolution uniform. Call this when the canvas size changes to maintain correct line width scaling.

**`dispose(): void`**

Cleans up GPU resources including geometry, material, and instance attributes. Call this when the line is no longer needed.
