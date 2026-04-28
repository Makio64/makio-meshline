---
description: "Reference MeshLineGeometry for efficient line mesh generation, attribute control, batching, and fast position updates in Makio MeshLine."
---

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
type LinePoint = [x: number, y: number, z?: number] | THREE.Vector2 | THREE.Vector3 | { x: number, y: number, z?: number }
type LinePoints = Float32Array | number[] | THREE.BufferGeometry | LinePoint[]

interface MeshLineGeometryOptions {
  lines?: LinePoints | LinePoints[]          // One line or multiple lines
  closed?: boolean | boolean[]               // Close the loop(s)
  widthCallback?: (t: number) => number      // variable width 
  usage?: THREE.Usage                        // Optional buffer usage hint : StaticDrawUsage / DynamicDrawUsage / StreamDrawUsage
  verbose?: boolean                          // Console logging

  // Optional CPU-side corner smoothing (see "Smooth sharp bends" below)
  smoothSharpBends?: boolean                 // default false; skipped under gpuPositionNode
  smoothSharpBendsAlpha?: number             // default 0.001
  smoothSharpBendsThreshold?: number         // default -0.5 (dot(dir_in, dir_out) cutoff)

  // Flags to include / exclude generated attributes (advanced)
  needsPositions?: boolean
  needsPrevious?: boolean
  needsNext?: boolean
  needsUV?: boolean
  needsSide?: boolean
  needsProgress?: boolean
  needsWidth?: boolean
}
```

`MeshLineGeometry` mirrors most of `MeshLine`'s geometry-related options and can be used directly when you need fine-grained control.

### Smooth sharp bends

Screen-space meshlines fundamentally can't render a ribbon cleanly through a single vertex whose two adjacent segments diverge at a near-hairpin angle — the bisector collapses and the ribbon picks up spikes or bowtie artifacts at oblique camera views. Industrial wide-line libraries (Mapbox GL, Cesium, Spite's original MeshLine) all sidestep this by subdividing sharp corners on the CPU before handing vertices to the shader.

`MeshLineGeometry` can do the same when `smoothSharpBends` is enabled:

<svg viewBox="0 0 820 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sharp-bend smoothing: before and after" style="max-width:100%;height:auto;display:block;margin:1.5em auto;">
  <text x="40" y="30" class="ssb-label">Without smoothing</text>
  <text x="40" y="260" class="ssb-sub">single hairpin vertex → ribbon spike · width collapse</text>
  <polyline points="60,60 300,140 60,220" class="ssb-ribbon-spike ssb-spike-pulse" stroke-miterlimit="99"/>
  <polyline points="60,60 300,140 60,220" class="ssb-centerline"/>
  <circle cx="60" cy="60" r="4" class="ssb-vertex"/>
  <circle cx="300" cy="140" r="4" class="ssb-vertex"/>
  <circle cx="60" cy="220" r="4" class="ssb-vertex"/>
  <path d="M 316 140 L 360 120" class="ssb-annotate"/>
  <text x="362" y="118" class="ssb-warn">spike / bowtie artifact</text>
  <line x1="410" y1="20" x2="410" y2="260" class="ssb-divider"/>
  <text x="440" y="30" class="ssb-label">With smoothSharpBends · α (illustrative)</text>
  <text x="440" y="260" class="ssb-sub">hairpin split into two cutoff vertices → clean bevel</text>
  <polyline points="440,60 656,132 656,148 440,220" class="ssb-ribbon-clean"/>
  <polyline points="440,60 656,132 656,148 440,220" class="ssb-centerline"/>
  <circle cx="680" cy="140" r="4" class="ssb-ghost-dot"/>
  <circle cx="680" cy="140" r="9" class="ssb-ghost-ring"/>
  <text x="694" y="143" class="ssb-sub" style="opacity:0.5">original vertex</text>
  <circle cx="440" cy="60" r="4" class="ssb-vertex"/>
  <circle cx="656" cy="132" r="4" class="ssb-vertex"/>
  <circle cx="656" cy="148" r="4" class="ssb-vertex"/>
  <circle cx="440" cy="220" r="4" class="ssb-vertex"/>
  <line x1="656" y1="132" x2="680" y2="140" class="ssb-annotate"/>
  <line x1="656" y1="148" x2="680" y2="140" class="ssb-annotate"/>
  <text x="560" y="112" class="ssb-alpha">α · segment</text>
</svg>

- **Default off.** GPU buffers match your input points unless you enable `smoothSharpBends`. When enabled, every vertex whose interior bend is sharper than ~60° (i.e. `dot(dir_in, dir_out) < -0.5`) is replaced by two cutoff points sitting `smoothSharpBendsAlpha` of the way back along each adjacent segment.
- **`smoothSharpBendsAlpha`** (default `0.001` once smoothing is enabled) controls how much of the peak you sacrifice. The default is small enough that the cutoff is visually imperceptible while keeping the shader miter math stable; larger values flatten the tip into a bevel-like cap. The bend *angles* at the new vertices are fixed by the original corner angle — `α` only controls how visible the cutoff is.
- **`smoothSharpBendsThreshold`** (default `-0.5`) is the `dot(dir_in, dir_out)` cutoff below which a vertex is considered "too sharp". Lower (more negative) values subdivide only the very sharpest corners.

```js
new MeshLine({
  lines: myZigzag,
  smoothSharpBends: true,          // opt in: changes topology at sharp corners
  smoothSharpBendsAlpha: 0.001,    // default once enabled — near-imperceptible cutoff
})
  .join({ limit: 2 })              // pair with a tighter miter clamp for zigzag-style polylines
```

**Tuning for very sharp polylines:** the default `α` is usually fine once smoothing is enabled. If you want a visibly flatter bevel at the tip, raise `α` to `0.05`–`0.1`. Pair a small `α` with a lower `miterLimit` (around `2`): the geometry pass handles sharp corners below the threshold and the tighter miter clamp flattens any residual spikes above it into clean bevels.

Leave `smoothSharpBends` off when you need the GPU vertex count to match your input polyline exactly — e.g. if you're animating per-vertex data, using custom per-vertex attributes, or relying on a stable index mapping.

> ℹ️ **GPU-positioned lines**: when `gpuPositionNode` is set, the CPU polyline is a straight-line template whose point count drives the progress grid the GPU samples against. CPU smoothing is skipped in that case — subdividing the template would shift progress values and break GPU position lookups. If you need corner smoothing for a GPU-positioned line, do it inside your position node.

## Methods

### setLines()

```ts
setLines(
  lines: LinePoints | LinePoints[]
): void
```

Replace or initialize the geometry with one or multiple line segments. A single line can be passed directly; pass an array of line inputs for multiple disconnected lines.

When a `THREE.BufferGeometry` is provided, the positions are extracted from its 'position' attribute. This allows direct conversion of existing Three.js geometries into MeshLine format.

#### Parameters

- `lines` – A line input, or an array of line inputs for multiple disconnected lines. Each line can be:
  - `Float32Array` of flattened XYZ coordinates
  - Flat numeric XYZ array
  - Nested number array of `[x,y,z]` coordinates
  - `Vector2`, `Vector3`, or plain `{ x, y, z? }` point arrays
  - `THREE.BufferGeometry` with a 'position' attribute

### dispose()

```ts
dispose(): void
```

Releases geometry resources. Call when the geometry is no longer needed.

### setPositions()

```ts
setPositions(
  positions: LinePoints | LinePoints[],
  updateBounding?: boolean
): void
```

Efficiently updates vertex positions **without rebuilding GPU buffers**.  The function supports:

• `Float32Array` – update a single line.  
• `Float32Array[]` – update multiple lines (each array must keep its original length).  
• Arrays of tuples, vectors, or point objects are converted under the hood (slower, avoid in hot loops).

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

Pass `updateBounding: true` when dynamic edits can move the line outside its previous bounds and frustum culling should stay exact.

## Usage Examples

For practical examples, see:
- [Basic Line Creation](./common-patterns.md#1-basic-line) in Common Patterns
- [Multi-Line Segments](./common-patterns.md#8-multi-line-segments) for multiple disconnected lines
- [Dynamic Updates](./common-patterns.md#9-dynamic-updates) for efficient position updates
- [From BufferGeometry](./common-patterns.md#12-from-buffergeometry) for converting existing geometries

## Internal Structure

The geometry generates these vertex attributes:

<svg viewBox="0 0 820 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vertex expansion: polyline to triangle strip" style="max-width:100%;height:auto;display:block;margin:1.5em auto;">
  <defs>
    <marker id="vex-arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <text x="40" y="30" class="vex-label">Input polyline · N points</text>
  <polyline points="60,170 140,100 240,200 340,120" class="vex-polyline"/>
  <circle cx="60" cy="170" r="4" class="vex-dot"/>
  <circle cx="140" cy="100" r="4" class="vex-dot"/>
  <circle cx="240" cy="200" r="4" class="vex-dot"/>
  <circle cx="340" cy="120" r="4" class="vex-dot"/>
  <text x="40" y="240" class="vex-sub">CPU points</text>
  <line x1="365" y1="155" x2="415" y2="155" class="vex-arrow" marker-end="url(#vex-arr)"/>
  <text x="380" y="140" class="vex-sub" style="font-size:10px">expand</text>
  <text x="440" y="30" class="vex-label">GPU triangle strip · 2N vertices</text>
  <path d="M 440 140 L 520 70 L 620 170 L 720 90 L 720 150 L 620 230 L 520 130 L 440 200 Z" class="vex-strip-fill"/>
  <g class="vex-strip-diag">
    <line x1="440" y1="200" x2="520" y2="70"/>
    <line x1="520" y1="130" x2="620" y2="170"/>
    <line x1="620" y1="230" x2="720" y2="90"/>
  </g>
  <polyline points="440,140 520,70 620,170 720,90" class="vex-strip-edge"/>
  <polyline points="440,200 520,130 620,230 720,150" class="vex-strip-edge"/>
  <line x1="440" y1="140" x2="440" y2="200" class="vex-strip-edge"/>
  <line x1="520" y1="70"  x2="520" y2="130" class="vex-strip-edge"/>
  <line x1="620" y1="170" x2="620" y2="230" class="vex-strip-edge"/>
  <line x1="720" y1="90"  x2="720" y2="150" class="vex-strip-edge"/>
  <circle cx="440" cy="140" r="3.5" class="vex-dot"/>
  <circle cx="520" cy="70"  r="3.5" class="vex-dot"/>
  <circle cx="620" cy="170" r="3.5" class="vex-dot"/>
  <circle cx="720" cy="90"  r="3.5" class="vex-dot"/>
  <circle cx="440" cy="200" r="3.5" class="vex-dot"/>
  <circle cx="520" cy="130" r="3.5" class="vex-dot"/>
  <circle cx="620" cy="230" r="3.5" class="vex-dot"/>
  <circle cx="720" cy="150" r="3.5" class="vex-dot"/>
  <text x="745" y="94" class="vex-side-label">side = +1</text>
  <text x="745" y="154" class="vex-side-label">side = -1</text>
  <text x="440" y="240" class="vex-sub">each CPU point → pair of GPU vertices, offset perpendicular by `lineWidth`</text>
</svg>

- `position` - Vertex positions
- `previous` - Previous point for direction calculation
- `next` - Next point for direction calculation  
- `side` - Side indicator (-1 or 1) for line thickness
- `width` - Width multiplier per vertex
- `uv` - Texture coordinates
- `progress` - Position along line (0-1) for effects

These attributes work together with the MeshLineNodeMaterial to create smooth, thick lines. 