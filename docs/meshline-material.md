---
description: "Reference MeshLineNodeMaterial for Makio MeshLine, including gradients, dashes, textures, opacity, hooks, and miter join settings."
---

# MeshLineNodeMaterial

The `MeshLineNodeMaterial` class is a specialized Three.js NodeMaterial that implements the vertex and fragment shaders for rendering thick, dashed, and textured lines using GPU-friendly techniques.

**Quick Links:**
- [Common Patterns](./common-patterns.md) - Basic usage examples
- [Advanced Patterns](./advanced-patterns.md) - Custom shader effects with hooks
- [MeshLine Class](./meshline.md) - Main API reference

## Constructor

```ts
new MeshLineNodeMaterial(
  parameters?: {
    transparent?: boolean,
    depthWrite?: boolean,
    depthTest?: boolean,
    wireframe?: boolean,
    alphaTest?: number,
    sizeAttenuation?: boolean,
    resolution?: THREE.Vector2,
    lineWidth?: number,
    color?: number | THREE.Color,
    gradientColor?: number | THREE.Color | null,
    opacity?: number,
    map?: THREE.Texture | null,
    alphaMap?: THREE.Texture | null,
    mapOffset?: THREE.Vector2,
    repeat?: THREE.Vector2,
    dashCount?: number | null,
    dashRatio?: number | null,
    dashOffset?: number,
    miterLimit?: number
  }
)
```

Creates a new MeshLineNodeMaterial with the specified parameters.

## Parameters

### Rendering Properties

- `transparent` (boolean) — whether the material is rendered with transparency. Default: auto-detected (true if `alphaMap` is set, `opacity < 1`, or `transparent` flag is true).
- `depthWrite` (boolean) — whether to write depth. Default: `true`.
- `depthTest` (boolean) — whether to perform depth testing. Default: `true`.
- `wireframe` (boolean) — render line as wireframe. Default: `false`.
- `alphaTest` (number) — alpha threshold for discarding fragments. Default: `0`.

### Line Appearance

- `sizeAttenuation` (boolean) — when `true`, `lineWidth` is projected as a scene-space width and attenuates with distance. When `false`, `lineWidth` is a constant CSS-pixel width. Default: `true`.
- `resolution` (`THREE.Vector2`) — viewport resolution for correct aspect scaling. Default: `new Vector2(1, 1)`.
- `lineWidth` (number) — full line width. Units depend on `sizeAttenuation`: scene/view units when `true`, CSS pixels when `false`. Default: `1`.
- `color` (number | `THREE.Color`) — line color. Default: `0xffffff`.
- `gradientColor` (`THREE.Color` | null) — optional gradient end color. Default: `null`.
- `opacity` (number) — global opacity. Default: `1`.

### Textures

- `map` (`THREE.Texture` | null) — diffuse texture. Default: `null`.
- `alphaMap` (`THREE.Texture` | null) — alpha mask texture. Default: `null`.
- `mapOffset` (`THREE.Vector2`) — UV offset for `map` and `alphaMap`. Default: `new Vector2(0, 0)`.
- `repeat` (`THREE.Vector2`) — UV repeat for `map` and `alphaMap`. Default: `new Vector2(1, 1)`.

### Dashing

- `dashCount` (number | null) — number of dash cycles along the line. Default: `null`.
- `dashRatio` (number | null) — ratio of dash length to gap length (0 to 1). `dashLength` can be used as an alias. Default: `null`.
- `dashOffset` (number) — offset into the dash cycle. Default: `0`.

### Miter Limit (advanced)

Thickness is kept consistent at every bend via a miter-extended offset. Very tight bends are clamped so they don't produce oversized spikes:

```js
const material = new MeshLineNodeMaterial({
  miterLimit: 6 // maximum expansion factor at sharp bends
})
```

`miterLimit` defaults to **4.0**, which keeps sharp corners visually clean while leaving gentler bends fully mitered. Lower values clamp earlier (more bevel-like at sharp bends); higher values allow longer spikes.

**Tip for very sharp static polylines (zigzags, angular paths):** pair a lower `miterLimit` (e.g. `2`) with opt-in geometry sharp-bend smoothing (`MeshLine.smoothSharpBends(true)`). The geometry pass subdivides corners whose interior bend drops below ~60°, and the miter clamp catches anything left over. See [MeshLine geometry › Smooth sharp bends](./meshline-geometry.md#smooth-sharp-bends).

### Shadow Nodes

When shadow casting is enabled, `setShadow(true)` creates `castShadowPositionNode` and, for dashed lines, `maskShadowNode`. You can also assign `castShadowNode` after build to customize the shadow color. Use a `vec4` so Three's shadow pass receives both RGB and alpha:

```js
line.material.castShadowNode = vec4( 0.7, 0.7, 0.7, 1 )
line.material.needsUpdate = true
```

### Textures

Apply textures to lines with UV mapping control:

```javascript
const material = new MeshLineNodeMaterial({
  map: myTexture,
  repeat: new THREE.Vector2(4, 1),    // Repeat 4 times along line
  mapOffset: new THREE.Vector2(0, 0)  // No offset
});
```

### Alpha Masking

Use alpha maps for complex opacity patterns:

```javascript
const material = new MeshLineNodeMaterial({
  alphaMap: alphaTexture,
  transparent: true
});
```

## Features

### Size Attenuation

When `sizeAttenuation` is disabled, lines maintain a constant CSS-pixel thickness regardless of camera distance:

```javascript
const material = new MeshLineNodeMaterial({
  sizeAttenuation: false,
  lineWidth: 2 // displays as 2 CSS pixels on DPR 1, 2, 3, ...
});
```

Use the canvas CSS size for `resolution`/`resize()` (`renderer.getSize()` or `window.innerWidth/innerHeight`), not the drawing-buffer size. The renderer still allocates more physical pixels on high-DPR screens, so the line remains sharp without changing its visible CSS size.

With the default `sizeAttenuation: true`, `lineWidth` is projected in scene space, so the line gets visually thinner as it moves farther from the camera.

### Gradients

Create smooth color transitions along the line:

```javascript
const material = new MeshLineNodeMaterial({
  color: 0xff0000,      // Red start
  gradientColor: 0x0000ff,   // Blue end
});
```

### Dashed Lines

Create various dash patterns:

```javascript
// Simple dashed line
const material = new MeshLineNodeMaterial({
  dashCount: 8,     // 8 dash cycles
  dashRatio: 0.5,   // 50% dash, 50% gap
});

// Animated dashes
const material = new MeshLineNodeMaterial({
  dashCount: 10,
  dashRatio: 0.7,
  dashOffset: 0     // Animate this value to move dashes
});
```


## Usage Examples

For practical examples, see:
- [Common Patterns](./common-patterns.md) - Basic material usage like gradients, dashes, and textures
- [Advanced Patterns](./advanced-patterns.md#8-material-hooks-for-custom-effects) - Custom shader effects using hooks

## NodeMaterial Integration

This material extends Three.js `NodeMaterial` using `tsl`

Internally it handles all the heavy lifting for:

- Create only uniforms you need
- Screen-space line thickness calculations
- UV generation for textures & dashes
- Dash pattern evaluation

## Hook System

The `MeshLineNodeMaterial` provides an extensive hook system that allows you to inject custom TSL (Three.js Shading Language) functions at various stages of the rendering pipeline. This enables powerful customization without modifying the core material code.

### Available Hooks

#### Position Processing Hooks

- `positionFn` — Modify the final vertex position
- `previousFn` — Modify the previous vertex position (used for line direction calculation)
- `nextFn` — Modify the next vertex position (used for line direction calculation)

#### Width and Normal Hooks

- `widthFn` — Modify line width per vertex
- `normalFn` — Modify vertex normals

#### Color and Shading Hooks

- `colorFn` — Modify base line color
- `gradientFn` — Modify gradient color calculation
- `fragmentColorFn` — Modify final fragment color

#### Opacity and Alpha Hooks

- `opacityFn` — Modify vertex opacity
- `fragmentAlphaFn` — Modify final fragment alpha

#### UV and Effects Hooks

- `uvFn` — Modify UV coordinates
- `dashFn` — Modify dash pattern calculation

#### Vertex and Fragment Control

- `vertexFn` — Custom vertex shader logic
- `discardFn` — Custom fragment discard conditions

### Hook Usage Examples

For detailed hook examples with complete code, see [Material Hooks for Custom Effects](./advanced-patterns.md#8-material-hooks-for-custom-effects) in Advanced Patterns.

### Hook Function Signatures

All hook functions receive relevant parameters and should return appropriate values:

```typescript
// Position hooks
positionFn: (position: Node, progress: Node) => Node<vec3>
previousFn: (position: Node, progress: Node) => Node<vec3>
nextFn: (position: Node, progress: Node) => Node<vec3>

// Width/Normal hooks
widthFn: (width: Node, progress: Node, side: Node) => Node<float>
normalFn: (normal: Node, dir: Node, dir1: Node, dir2: Node, progress: Node, side: Node) => Node<vec4>

// Color hooks
colorFn: (color: Node, progress: Node, side: Node) => Node<vec4>
gradientFn: (gradientFactor: Node, side: Node) => Node<float>
fragmentColorFn: (color: Node, uv: Node, progress: Node, side: Node) => Node<vec4>

// Alpha hooks
opacityFn: (alpha: Node, progress: Node, side: Node) => Node<float>
fragmentAlphaFn: (alpha: Node, uv: Node, progress: Node, side: Node) => Node<float>

// UV/Dash hooks
uvFn: (uv: Node, progress: Node, side: Node) => Node<vec2>
dashFn: (cyclePosition: Node, progress: Node, side: Node) => Node<float>

// Control hooks
vertexFn: (finalPosition: Node, normal: Node, progress: Node, side: Node) => Node<vec4>
discardFn: (progress: Node, side: Node, uv: Node) => Node<bool>
```

### Performance Considerations

- Hook functions run on the GPU for maximum performance
- Keep hook logic simple to avoid shader compilation issues
- Use uniforms for time-based animations to avoid constant recompilation
- Consider the impact on shader complexity when using multiple hooks

## Dynamic GPU-Driven Positions (gpuPositionNode)

When you don't want to upload an explicit polyline to the GPU you can let the shader compute each vertex position.  
Provide a **gpuPositionNode** function that receives the per-vertex progress (ranging from 0→1 along the line) and returns a `vec3` position.

```javascript
import { MeshLine } from 'makio-meshline';
import { Fn, vec3, cos, sin } from 'three/tsl';

// 1. GPU function returning a point on a unit circle
const circlePosition = Fn( ( [index] ) => {
  // index is in [0,1]. Turn it into an angle and build XZ coordinates
  const angle = index.mul( Math.PI * 2.0 );
  return vec3( cos( angle ), 0.0, sin( angle ) );
} ).setLayout( {
  name: 'circlePosition',
  type: 'vec3',
  inputs: [ { name: 'index', type: 'float' } ]
} );

// 2. Create the line. Only the segment count matters here; positions are computed by the node.
const line = new MeshLine()
  .segments( 256 )
  .gpuPositionNode( circlePosition )
  .lineWidth( 4 )
  .build();
scene.add( line );
```

`progress` is automatically incremented for every segment so **index** travels smoothly from 0 to 1.  
Combine this technique with uniforms (time, mouse, etc.) to build fully procedural, animated lines on the GPU.