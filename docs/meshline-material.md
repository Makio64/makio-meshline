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
new MeshLineNodeMaterial(options?: MeshLineMaterialOptions)
```

Creates a new MeshLineNodeMaterial with the specified parameters.

## Parameters

### Rendering Properties

- `transparent` (boolean) — whether the material is rendered with transparency. Default: auto-detected (true if `alphaMap` is set, `opacity < 1`, or `transparent` flag is true).
- `depthWrite` (boolean) — whether to write depth. By default it is `false` when the material is transparent and `true` otherwise.
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
- `dashLength` (number | null) — compatibility alias for `dashRatio`. Default: `null`.
- `dashOffset` (number) — offset into the dash cycle. Default: `0`.

These names are the low-level material fields. When using the recommended `MeshLine` facade, configure dashes with `dash: { count, ratio, offset }` or `.dash( options )`; the facade creates these material uniforms for you.

### Miter Limit (advanced)

Thickness is kept consistent at every bend via a miter-extended offset. Very tight bends are clamped so they don't produce oversized spikes:

```js
const material = new MeshLineNodeMaterial({
  miterLimit: 6 // maximum expansion factor at sharp bends
})
```

`miterLimit` defaults to **4.0**, which keeps sharp corners visually clean while leaving gentler bends fully mitered. Lower values clamp earlier (more bevel-like at sharp bends); higher values allow longer spikes.

**Tip for very sharp static polylines (zigzags, angular paths):** pair a lower `miterLimit` (e.g. `2`) with opt-in geometry sharp-bend smoothing (`MeshLine.smoothSharpBends(true)`). The geometry pass subdivides corners whose interior bend drops below ~60°, and the miter clamp catches anything left over. See [MeshLine geometry › Smooth sharp bends](./meshline-geometry.md#smooth-sharp-bends).

### lineCoord

`lineCoord` is a normalized stroke coordinate for the billboard profile, importable from the package root and usable inside any TSL hook:

```js
import { lineCoord } from 'makio-meshline'
import { Fn } from 'three/tsl'

line.fragmentColorFn( Fn( ( [color] ) => color.mul( lineCoord.y.abs().oneMinus() ) ) )
```

| Channel | Meaning |
| --- | --- |
| `lineCoord.y` | Position across the emitted cross-section. `-1` and `+1` sit exactly on the two silhouette edges, `0` on the mid-line between them. |
| `lineCoord.x` | Position inside an end cap. The billboard profile emits no cap topology, so this is currently always `0` and is reserved for future caps. |

It costs nothing extra: `y` is the `side` value the material already interpolates, so reading `lineCoord` does not require `needsUV( true )` the way recovering the same number from `uv().y` does.

**It is a silhouette coordinate, not a distance.** `|lineCoord.y| == 1` means "on the emitted edge". That edge sits at `lineWidth / 2` only on a straight run: at a bend of interior deviation α the miter pushes it out to `lineWidth / ( 2·cos( α / 2 ) )` — 1.41x the half-width at a plain 90° corner — capped at `miterLimit · lineWidth / 2`, so 4x the half-width at the default `miterLimit` of 4. Past the limit the join falls back to a butt cross-section and the edge returns to `lineWidth / 2`. Treat `lineCoord` as a shading parameter, not as a metric offset in pixels. Likewise `y == 0` is the mid-line rather than the centerline whenever a `widthFn` or `normalFn` hook makes the cross-section asymmetric, since both hooks receive `side`.

The idea, and the name, come from [rreusser/webgpu-instanced-lines](https://github.com/rreusser/webgpu-instanced-lines).

#### Building a tube normal from it

The [Metallic Tube demo](https://meshline-demo.makio.io/examples/metallic-tube) treats `lineCoord.y` as the tube's across-axis and reconstructs the bulge analytically:

```js
const across = lineCoord.y
const arch = float( 1 ).sub( across.mul( across ) ).max( 0 ).sqrt()
material.normalNode = vec3( perpendicular.mul( across ), arch ).normalize()
```

`lineCoord` carries no direction, so the screen-space `perpendicular` still has to come across from a `normalFn` hook.

### Antialiasing

`antialias` is off by default. MSAA already antialiases a billboard line, because the silhouette *is* the emitted geometry — so enable this only when you are rendering without multisampling, or when sub-pixel line widths are dropping out.

```js
line.antialias( true )
```

When on, the vertex stage pads the stroke outward by half a device pixel measured perpendicular to the stroke, and the fragment stage fades that padding by real edge coverage, so the edge is smoothed instead of eroded. Strokes thinner than one device pixel are widened to one pixel and dimmed by their true coverage, which keeps them continuous instead of breaking into dashes.

Two consequences worth knowing:

- Coverage is written into alpha, so `antialias` forces `transparent = true`. Expect the usual transparent-draw ordering.
- The emitted geometry grows by half a device pixel on each side. Because the pad is applied along the miter bisector, a sharp corner grows further along that bisector — bounded, like the miter itself, by `join.limit`. That is invisible for ordinary strokes but is a real change if you are matching a line against a pixel grid.

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

### Fog

Lines follow `scene.fog` (`Fog` or `FogExp2`) like any mesh, including lines placed by `positionFn` or `gpuPositionNode`: every instance and every GPU-computed point fades by its own view depth, not by its template's. The vertex stage passes that depth to the fog in a single varying, declared only while the scene has fog and `material.fog` is `true`, so unfogged lines pay nothing. Set `line.material.fog = false` to keep a line out of the fog.

The depth is taken after `positionFn` / `gpuPositionNode` and before `vertexFn`, which works in clip space. A custom `scene.fogNode` that also reads `positionWorld`, such as `exponentialHeightFogFactor`, gets its height from the same placed line (see [Position Accessors](#position-accessors)).

### Position Accessors

Three derives `positionLocal`, `positionWorld` and `positionWorldDirection` from the geometry's `position` attribute, as well as the vertex-stage `positionView` behind hardware clip distances, and before r183 the fragment-stage one. A line placed by `positionFn` or `gpuPositionNode` only uses that attribute as a template, so the material points these accessors, and `positionPrevious` for motion vectors, at the placed line instead. Fragment hooks such as `fragmentColorFn` or `discardFn`, a custom `scene.fogNode`, clipping planes and TRAA or motion blur all see where each instance and GPU-computed point is drawn.

The value is the centerline after `positionFn` / `gpuPositionNode` and before `vertexFn`, so it is constant across the stroke's width. From r183, three rebuilds the fragment-stage `positionView` from the emitted clip position, which also includes the stroke offset. Only builds whose shaders read one of these accessors compute them; other lines pay nothing. `positionGeometry` always returns the raw template.


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

Wrap hooks with `Fn( ( [arg1, arg2, ...] ) => ... )` from `'three/tsl'` (note the array destructuring in the parameter list):

```typescript
// Position hooks
positionFn: Fn( ( [position, progress] ) => Node<vec3> )
previousFn: Fn( ( [position, progress] ) => Node<vec3> )
nextFn: Fn( ( [position, progress] ) => Node<vec3> )

// Width/Normal hooks
widthFn: Fn( ( [width, progress, side] ) => Node<float> )
normalFn: Fn( ( [normal, dir, dir1, dir2, progress, side] ) => Node<vec4> )

// Color hooks
colorFn: Fn( ( [color, progress, side] ) => Node<vec4> )
gradientFn: Fn( ( [gradientFactor, side] ) => Node<float> )
fragmentColorFn: Fn( ( [color, uv, progress, side] ) => Node<vec4> )

// Alpha hooks
opacityFn: Fn( ( [alpha, progress, side] ) => Node<float> )
fragmentAlphaFn: Fn( ( [alpha, uv, progress, side] ) => Node<float> )

// UV/Dash hooks
uvFn: Fn( ( [uv, progress, side] ) => Node<vec2> )
dashFn: Fn( ( [cyclePosition, progress, side] ) => Node<float> )

// Control hooks
vertexFn: Fn( ( [finalPosition, normal, progress, side] ) => Node<vec4> )
discardFn: Fn( ( [progress, side, uv] ) => Node<bool> )
```

### Performance Considerations

- Hook functions run on the GPU for maximum performance
- Keep hook logic simple to avoid shader compilation issues
- Use uniforms for time-based animations to avoid constant recompilation
- Consider the impact on shader complexity when using multiple hooks

## Dynamic GPU-Driven Positions (gpuPositionNode)

When you do not want to upload an explicit polyline, let the shader compute each vertex position. Provide a `gpuPositionNode` function that receives normalized template progress and returns a `vec3` position.

```javascript
import { MeshLine } from 'makio-meshline'
import { Fn, vec3, cos, sin } from 'three/tsl'

// 1. GPU function returning a point on a unit circle
const circlePosition = Fn( ( [progress] ) => {
  const angle = progress.mul( Math.PI * 2 )
  return vec3( cos( angle ), 0, sin( angle ) )
} ).setLayout( {
  name: 'circlePosition',
  type: 'vec3',
  inputs: [ { name: 'progress', type: 'float' } ]
} )

// 2. Create the line. Only the segment count matters here; positions are computed by the node.
const line = new MeshLine()
  .segments( 256 )
  .gpuPositionNode( circlePosition )
  .lineWidth( 4 )
  .build()

scene.add( line )
```

With no CPU centerline to measure, procedural template progress is evenly sampled from `0` to `1` by point index. This differs from explicit CPU paths, whose V2 progress follows cumulative arc length. Combine the node with uniforms such as time or pointer state to animate the line without per-frame position uploads.
