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
    useMiterLimit?: boolean,
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

- `sizeAttenuation` (boolean) — whether line width attenuates with perspective (gets smaller with distance). When `false`, maintains constant pixel size. Default: `true`.
- `resolution` (`THREE.Vector2`) — viewport resolution for correct aspect scaling. Default: `new Vector2(1, 1)`.
- `lineWidth` (number) — base width multiplier for the line in screen space. Default: `1`.
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

`MeshLineNodeMaterial` can clamp very sharp joints to avoid oversized spikes by enabling miter clipping:

```js
const material = new MeshLineNodeMaterial({
  useMiterLimit: true, // activate clipping
  miterLimit: 6        // (optional) maximum expansion factor
})
```

If omitted, `miterLimit` defaults to **4.0** which works well for most scenes.

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

When `sizeAttenuation` is enabled, lines maintain consistent visual thickness regardless of camera distance:

```javascript
const material = new MeshLineNodeMaterial({
  sizeAttenuation: true,
  lineWidth: 2 // value in px , the dpr adjustment is automatic 
  dpr: window.devicePixelRatio // optional, window.devicePixelRatio is already the default value
});
```

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
positionFn: (position: Node, counter: Node) => Node<vec3>
previousFn: (position: Node, counter: Node) => Node<vec3>
nextFn: (position: Node, counter: Node) => Node<vec3>

// Width/Normal hooks
widthFn: (width: Node, counter: Node, side: Node) => Node<float>
normalFn: (normal: Node, dir: Node, dir1: Node, dir2: Node, counter: Node, side: Node) => Node<vec3>

// Color hooks
colorFn: (color: Node, counter: Node, side: Node) => Node<vec4>
gradientFn: (gradientFactor: Node, side: Node) => Node<float>
fragmentColorFn: (color: Node, uv: Node, counter: Node, side: Node) => Node<vec4>

// Alpha hooks
opacityFn: (alpha: Node, counter: Node, side: Node) => Node<float>
fragmentAlphaFn: (alpha: Node, uv: Node, counter: Node, side: Node) => Node<float>

// UV/Dash hooks
uvFn: (uv: Node, counter: Node, side: Node) => Node<vec2>
dashFn: (cyclePosition: Node, counter: Node, side: Node) => Node<float>

// Control hooks
vertexFn: (finalPosition: Node, normal: Node, counter: Node, side: Node) => Node<vec3>
discardFn: (counter: Node, side: Node, uv: Node) => Node<bool>
```

### Performance Considerations

- Hook functions run on the GPU for maximum performance
- Keep hook logic simple to avoid shader compilation issues
- Use uniforms for time-based animations to avoid constant recompilation
- Consider the impact on shader complexity when using multiple hooks

## Dynamic GPU-Driven Positions (gpuPositionNode)

When you don't want to upload an explicit polyline to the GPU you can let the shader compute each vertex position.  
Provide a **gpuPositionNode** function that receives the per-vertex counter (ranging from 0→1 along the line) and returns a `vec3` position.

```javascript
import { MeshLine, MeshLineNodeMaterial } from 'makio-meshline';
import { Fn, vec3, cos, sin } from 'three/tsl';
import * as THREE from 'three';

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

// 2. Placeholder geometry (single vertex – content is ignored)
const geom = new THREE.BufferGeometry().setAttribute(
  'position',
  new THREE.Float32BufferAttribute( new Float32Array( [ 0, 0, 0 ] ), 3 )
);

// 3. Material using the gpuPositionNode
const material = new MeshLineNodeMaterial({
  lineWidth: 4,
  resolution: new THREE.Vector2( window.innerWidth, window.innerHeight ),
  gpuPositionNode: circlePosition, // <- inject node here
  needsCounter: true               // ensure the `counter` attribute is generated
});

// 4. Create the line and add to the scene
const line = new MeshLine();
line.setGeometry( geom ); // geometry size does not matter
line.material = material;
scene.add( line );
```

`counter` is automatically incremented for every segment so **index** travels smoothly from 0 to 1.  
Combine this technique with uniforms (time, mouse, etc.) to build fully procedural, animated lines on the GPU.