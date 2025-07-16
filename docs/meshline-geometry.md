# MeshLineGeometry

The `MeshLineGeometry` class builds the line mesh geometry from raw point data, handling the complex vertex calculations needed for thick, smooth lines.

**Quick Links:**
- [Common Patterns](./common-patterns.md) - Basic geometry usage examples
- [Advanced Patterns](./advanced-patterns.md) - Dynamic updates and performance tips
- [MeshLine Class](./meshline.md) - Main API reference

## Constructor

```ts
new MeshLineGeometry(options?: MeshLineGeometryOptions)
```

### MeshLineGeometryOptions (partial)

```ts
interface MeshLineGeometryOptions {
  lines?: Float32Array | number[][]          // Line points (required)
  isClose?: boolean | boolean[]              // Close the loop(s)
  widthCallback?: (t: number) => number      // variable width 
  usage?: THREE.Usage                       // Optional buffer usage hint : StaticDrawUsage / DynamicDrawUsage / StreamDrawUsage
  verbose?: boolean                         // Console logging
   
  // Flags to include / exclude generated attributes (advanced)
  needsPositions?: boolean
  needsPrevious?: boolean
  needsNext?: boolean
  needsUV?: boolean
  needsSide?: boolean
  needsCounter?: boolean
  needsWidth?: boolean
}
```

`MeshLineGeometry` mirrors most of `MeshLine`'s geometry-related options and can be used directly when you need fine-grained control.

## Methods

### setLines()

```ts
setLines(
  lines: Array<Float32Array | Array<[number, number, number]> | THREE.BufferGeometry>
): void
```

Replace or initialize the geometry with one or multiple line segments. This method always expects an array of lines, so if you have a single line, wrap it in an array.

When a `THREE.BufferGeometry` is provided, the positions are extracted from its 'position' attribute. This allows direct conversion of existing Three.js geometries into MeshLine format.

#### Parameters

- `lines` – Array of line data, where each element represents a separate line. Each element can be:
  - `Float32Array` of flattened XYZ coordinates
  - Nested number array of `[x,y,z]` coordinates
  - `THREE.BufferGeometry` with a 'position' attribute

### dispose()

```ts
dispose(): void
```

Releases geometry resources. Call when the geometry is no longer needed.

### setPositions()

```ts
setPositions(
  positions: Float32Array | Float32Array[] | Array<Float32Array | number[][]>,
  updateBounding?: boolean
): void
```

Efficiently updates vertex positions **without rebuilding GPU buffers**.  The function supports:

• `Float32Array` – update a single line.  
• `Float32Array[]` – update multiple lines (each array must keep its original length).  
• `number[][][]` – nested arrays are converted under the hood (slower, avoid in hot loops).

If the line count or point count changes, the geometry falls back to a full rebuild automatically using `setLines()`. This ensures proper buffer allocation but is less efficient than in-place updates. For best performance, maintain consistent line counts and point counts when using `setPositions()`.

• `positions` – Must match the original line(s) vertex count exactly.  Re-use the same typed arrays each frame for best performance.  
• `updateBounding` – Recomputes bounding volumes when `true` (default `false`).  Skip when the line stays roughly inside view.

Example with multiple dynamic lines:

```js
const lines = [ new Float32Array( NUM * 3 ), new Float32Array( NUM * 3 ) ]
const geometry = new MeshLineGeometry({ lines });

function animate() {
  updateFirstLine(lines[0])
  updateSecondLine(lines[1])
  geometry.setPositions( lines ); // uploads changes for both lines
  requestAnimationFrame( animate );
}
```

If `verbose` is enabled, a console message `[MeshLine] positions updated via setPositions` confirms the lightweight path was used.

## Usage Examples

For practical examples, see:
- [Basic Line Creation](./common-patterns.md#1-basic-line) in Common Patterns
- [Multi-Line Segments](./common-patterns.md#8-multi-line-segments) for multiple disconnected lines
- [Dynamic Updates](./common-patterns.md#9-dynamic-updates) for efficient position updates
- [From BufferGeometry](./common-patterns.md#12-from-buffergeometry) for converting existing geometries

## Internal Structure

The geometry generates these vertex attributes:

- `position` - Vertex positions
- `previous` - Previous point for direction calculation
- `next` - Next point for direction calculation  
- `side` - Side indicator (-1 or 1) for line thickness
- `width` - Width multiplier per vertex
- `uv` - Texture coordinates
- `counters` - Position along line (0-1) for effects

These attributes work together with the MeshLineNodeMaterial to create smooth, thick lines. 