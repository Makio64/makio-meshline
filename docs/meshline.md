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
- `lines(lines: Float32Array | number[][], closed?: boolean | boolean[])` - Set line(s) positions and optional close flag
- `segments(segments: number)` - Set number of segments for auto-generated lines
- `closed(closed: boolean | boolean[])` - Set whether to close the line loop

**Appearance:**
- `color(color: number | THREE.Color)` - Set line color
- `lineWidth(lineWidth: number)` - Set line width
- `widthCallback(callback: (t: number) => number)` - Set variable width function
- `sizeAttenuation(enable: boolean)` - Enable/disable size attenuation
- `gradientColor(color: number | THREE.Color)` - Set gradient end color
- `opacity(opacity: number)` - Set opacity level

**Material Properties:**
- `alphaTest(threshold: number)` - Set alpha test threshold
- `transparent(enable: boolean)` - Enable/disable transparency, enable by default if opacity != 1 or alphaMap
- `wireframe(enable: boolean)` - Enable/disable wireframe mode

**Textures:**
- `map(texture: THREE.Texture)` - Set diffuse texture
- `alphaMap(texture: THREE.Texture)` - Set alpha mask texture
- `mapOffset(offset: THREE.Vector2)` - Set texture UV offset

**Dashes:**
- `dash({ count: number, ratio?: number, offset?: number })` - Configure dash pattern

**Advanced:**

- `join({ type: 'miter'|'bevel'|'round', limit?: number, quality?: 'standard'|'high' })` - Control line joins; when `type: 'miter'`, `limit` and `quality` apply
- `dpr(ratio: number)` - Set device pixel ratio
- `frustumCulled(enable: boolean)` - Enable/disable frustum culling & geometry BoundingBox/boundingSphere creation
- `verbose(enable: boolean)` - Enable/disable verbose logging
- `renderSize(width: number, height: number)` - Set render resolution
- `gpuPositionNode(node: Fn)` - Set GPU position calculation node
- `usage(usage: THREE.Usage)` - Set buffer usage hint for position/next/prev (if they exist)
- `instances(count: number)` - Enable instancing with specified count
- `dynamic(enable: boolean)` - Toggle dynamic geometry updates (usage hints)
- `autoResize(target?: Window|HTMLElement)` - Automatically update resolution on resize

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

**Attribute Control:**

These controls give you control on which attributes are added to the geometry.

- `needsUV(enable: boolean)` - Control UV attribute generation
- `needsWidth(enable: boolean)` - Control width attribute generation
- `needsCounter(enable: boolean)` - Control counter attribute generation
- `needsPrevious(enable: boolean)` - Control previous position attribute generation
- `needsNext(enable: boolean)` - Control next position attribute generation
- `needsSide(enable: boolean)` - Control side attribute generation

**Building:**
- `build()` - Finalize configuration and build the line (returns the instance).

> **Note:** Call `build()` to finalize the configuration & build the geometry and tsl nodes, or the line will auto-build on first render ( during `onBeforeRender`).

## Options Object Configuration

Alternatively, you can use the traditional options object approach:

### Quick signature

```ts
interface MeshLineOptions {
  // ***Geometry***
  lines?: Float32Array | number[][]          // Line points (required)
  closed?: boolean | boolean[]               // Close the loop(s)

  // ***Appearance***
  color?: number | THREE.Color
  lineWidth?: number                         // Line width (default: 0.3)
  widthCallback?: (t: number) => number      // variable width modifier
  sizeAttenuation?: boolean
  gradientColor?: number | null              // End-gradient colour

  // ***Textures***
  map?: THREE.Texture | null
  alphaMap?: THREE.Texture | null
  mapOffset?: THREE.Vector2 | null

  // ***Dashes***
  dashCount?: number | null
  dashRatio?: number | null
  dashOffset?: number


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
  needsCounter?: boolean
  needsPrevious?: boolean
  needsNext?: boolean
  needsSide?: boolean
  renderWidth?: number
  renderHeight?: number

  // Procedural GPU positions
  gpuPositionNode?: Fn< number, THREE.Vector3 > | null

  // Instancing
  instanceCount?: number                          // Enable instancing with count

  // Hook Functions (TSL Fn)
  positionFn?: Fn | null
  widthFn?: Fn | null
  colorFn?: Fn | null
  gradientFn?: Fn | null
  opacityFn?: Fn | null
  dashFn?: Fn | null
  uvFn?: Fn | null
  vertexFn?: Fn | null
  fragmentColorFn?: Fn | null
  fragmentAlphaFn?: Fn | null
  discardFn?: Fn | null

  // Debugging
  verbose?: boolean
}
```

## MeshLineOptions

### Geometry

- **`lines`** (`Float32Array | number[][]`) — **Required.** The line points data. Can be an array of `[x, y, z]` coordinate arrays, or a `Float32Array` with XYZ values. Default: `new Float32Array([0,0,0,1,0,0])`.

> **Procedural alternative:** instead of supplying a `lines` array you can provide a **`gpuPositionNode`** function (TSL `Fn`).  The node receives the per-vertex `counter` (0→1) and must return a `vec3` position.  When set, the geometry sent to the GPU can be minimal – only its length matters so that the `counter` attribute is generated.

- **`closed`** (`boolean | boolean[]`) — Whether to close the line loop(s). If `true`, connects the last point back to the first. For multiple lines, can be an array of booleans. Default: `false`.

### Appearance

- **`color`** (`number | THREE.Color`) — Base color of the line. Can be a hex number (`0xff0000`) or `THREE.Color` instance. Default: `0xffffff` (white).

- **`lineWidth`** (`number`) — Width of the line. When `sizeAttenuation` is `false`, this value is multiplied by `dpr` for screen-space rendering. When `true`, it's scaled by distance. Default: `0.3`.

- **`widthCallback`** (`(t: number) => number | null`) — A function that receives the line progress (`t`, from 0 to 1) and returns a width multiplier. Allows for variable line width. Default: `null`.

- **`sizeAttenuation`** (`boolean`) — Whether line width should scale with camera distance. When `false`, lines maintain constant pixel width regardless of distance. Default: `true`.

- **`gradientColor`** (`number | null`) — Optional gradient end color. When set, the line will smoothly transition from `color` to `gradientColor` along its length. Default: `null` (no gradient).

### Textures

- **`map`** (`THREE.Texture | null`) — Diffuse texture to apply along the line. The texture is mapped using UV coordinates generated along the line length. Default: `null`.

- **`alphaMap`** (`THREE.Texture | null`) — Alpha mask texture for transparency effects. Uses the blue channel of the texture for alpha values. Default: `null`.

- **`mapOffset`** (`THREE.Vector2 | null`) — UV offset for both `map` and `alphaMap` textures. Allows shifting texture coordinates. Default: `null` (no offset).

### Dashes

- **`dashCount`** (`number | null`) — Number of dash cycles along the entire line length. When set, creates a dashed line pattern. Default: `null` (solid line).

- **`dashRatio`** (`number | null`) — Ratio of dash length to gap length (0 to 1). For example, `0.5` creates equal dash and gap lengths, `0.7` creates longer dashes with shorter gaps. Only works when `dashCount` is set. Default: `null`.

- **`dashOffset`** (`number`) — Offset into the dash cycle pattern. Animate this value to create moving dash effects. Default: `0`.

### Rendering Flags

- **`opacity`** (`number`) — Global opacity multiplier (0 to 1). Default: `1` (fully opaque).

- **`alphaTest`** (`number`) — Alpha threshold for fragment discard. Fragments with alpha below this value are discarded. Default: `0`.

- **`transparent`** (`boolean`) — Whether the material should be rendered with transparency. Auto-detected based on other settings if not explicitly set. Default: `false`.

- **`wireframe`** (`boolean`) — Render the line geometry as wireframe. Mainly useful for debugging. Default: `false`.

- **`frustumCulled`** (`boolean`) — Whether the line should be frustum culled by Three.js. Set to `false` for lines that might extend outside the view. Default: `true`.

### Device Pixel Ratio

- **`dpr`** (`number`) — Device pixel ratio multiplier used for screen-space `lineWidth`. Defaults to `window.devicePixelRatio`.

### Advanced / Internal

- **`needsWidth`** (`boolean`) — Whether the line needs width information. Default: `true`.

- **`needsUV`** (`boolean`) — Whether the line needs UV coordinates. Default: `true`.

- **`needsCounter`** (`boolean`) — Whether the line needs a counter attribute. Default: `true`.

- **`needsPrevious`** (`boolean`) — Whether the line needs previous point information. Default: `true`.

- **`needsNext`** (`boolean`) — Whether the line needs next point information. Default: `true`.

- **`needsSide`** (`boolean`) — Whether the line needs side information. Default: `true`.

- **`renderWidth`** (`number`) — Width of the rendered line. Default: `1024`.

- **`renderHeight`** (`number`) — Height of the rendered line. Default: `1024`.

- **`verbose`** (`boolean`) — When `true` logs to the console which buffer attributes are generated for the geometry. Useful for debugging option combinations. Default: `false`.

### Instancing

- **`instanceCount`** (`number`) — When set to a positive number, enables instanced rendering for the specified number of instances. Each instance renders the same line geometry but can have different transformations, colors, and other per-instance properties via custom attributes. Default: `-1` (instancing disabled).

> **Instance Attributes:** Use `addInstanceAttribute(name, components)` to create per-instance attributes and `setInstanceValue(name, index, value)` to set data for specific instances. Instance attributes can be accessed in hook functions using `attribute(name, type)`.

### Hook Functions

Hook functions allow custom TSL (Three.js Shading Language) code to modify various aspects of line rendering. All hooks are optional and receive relevant parameters for their processing stage:

- **`positionFn`** (`Fn | null`) — Modify vertex positions. Receives `(position, counters)`.
- **`widthFn`** (`Fn | null`) — Modify line width. Receives `(width, counters, side)`.
- **`colorFn`** (`Fn | null`) — Modify vertex colors. Receives `(color, counters, side)`.
- **`gradientFn`** (`Fn | null`) — Modify gradient factor. Receives `(gradientFactor, side)`.
- **`opacityFn`** (`Fn | null`) — Modify opacity in fragment shader. Receives `(alpha, counters, side)`.
- **`dashFn`** (`Fn | null`) — Modify dash pattern. Receives `(cyclePosition, counters, side)`.
- **`uvFn`** (`Fn | null`) — Modify UV coordinates. Receives `(uvCoords, counters, side)`.
- **`vertexFn`** (`Fn | null`) — Final vertex position modification. Receives `(finalPosition, normal, counters, side)`.
- **`fragmentColorFn`** (`Fn | null`) — Final fragment color modification. Receives `(color, uvCoords, counters, side)`.
- **`fragmentAlphaFn`** (`Fn | null`) — Final fragment alpha modification. Receives `(alpha, uvCoords, counters, side)`.
- **`discardFn`** (`Fn | null`) — Custom discard condition. Receives `(counters, side, uvCoords)`. Return truthy to discard fragment.

> **TSL Functions:** Hook functions must be created using `Fn()` from `three/tsl`. They run on the GPU for maximum performance and can access uniform values, attributes, and built-in variables like `time` and `instanceIndex`.

### Updating geometry efficiently

For lines controled by `cpu` and whose vertices change every frame (e.g. interactive trails) you can avoid rebuilding the full geometry by calling **`geometry.setPositions( positionsF32 )`**.  
`positionsF32` must be the same length as the original `lines` array (and ideally the same Float32Array reused each frame).  Only the `position`, `previous` and `next` buffers are updated in-place, so no new GPU buffers are created.

For efficient position updates, see [Dynamic Updates](./common-patterns.md#9-dynamic-updates) in Common Patterns.

When verbose mode is enabled you'll see `[MeshLine] positions updated via setPositions` in the console.

## Methods

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

For advanced instancing examples, see:
- [Basic Instancing](./common-patterns.md#10-basic-instancing) for simple use cases
- [GPU Instanced Circles](./advanced-patterns.md#7-gpu-instanced-circles) for complex animated instances

### Other Methods

**`resize(width?: number, height?: number): void`**

Updates the material's resolution uniform. Call this when the canvas size changes to maintain correct line width scaling.

**`dispose(): void`**

Cleans up GPU resources including geometry, material, and instance attributes. Call this when the line is no longer needed.