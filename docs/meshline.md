# MeshLine Class

The `MeshLine` class is the main interface for creating performant, customizable lines in Three.js.

## Constructor

```ts
new MeshLine(options?: MeshLineOptions)
```

`MeshLine` now takes a **single** options object.  The line positions are provided via the `lines` field in this object.

### Quick signature

```ts
interface MeshLineOptions {
  // ***Geometry***
  lines?: Float32Array | number[][]          // Line points (required)
  isClose?: boolean | boolean[]              // Close the loop(s)
  widthCb?: (t: number) => number | null     // Width callback (0-1 → multiplier)

  // ***Appearance***
  color?: number | THREE.Color
  lineWidth?: number                         // Screen-space px
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

  // ***Visibility***
  usePercent?: boolean                       // Enable percents
  percent?: number                           // Start percentage (0-1)
  percent2?: number                          // End   percentage (0-1)

  // ***Rendering flags***
  opacity?: number
  alphaTest?: number
  transparent?: boolean
  wireframe?: boolean
  frustumCulled?: boolean

  // ***Advanced / internal***
  needsWidths?: boolean
  needsUVs?: boolean
  needsCounters?: boolean
  needsPrevious?: boolean
  needsNext?: boolean
  needsSide?: boolean
  rendererWidth?: number
  rendererHeight?: number
}
```

## MeshLineOptions

### Geometry

- **`lines`** (`Float32Array | number[][]`) — **Required.** The line points data. Can be an array of `[x, y, z]` coordinate arrays, or a `Float32Array` with XYZ values. Default: `new Float32Array([0,0,0,1,0,0])`.

- **`isClose`** (`boolean | boolean[]`) — Whether to close the line loop(s). If `true`, connects the last point back to the first. For multiple lines, can be an array of booleans. Default: `false`.

- **`widthCb`** (`(t: number) => number | null`) — Width callback function that varies line thickness along its length. Receives parameter `t` from 0 (start) to 1 (end) and should return a width multiplier. Default: `null` (constant width).

### Appearance

- **`color`** (`number | THREE.Color`) — Base color of the line. Can be a hex number (`0xff0000`) or `THREE.Color` instance. Default: `0xffffff` (white).

- **`lineWidth`** (`number`) — Width of the line. When `sizeAttenuation` is `false`, this is in screen pixels. When `true`, it's scaled by distance. Default: `0.3`.

- **`sizeAttenuation`** (`boolean`) — Whether line width should scale with camera distance. When `false`, lines maintain constant pixel width regardless of distance. Default: `false`.

- **`gradientColor`** (`number | null`) — Optional gradient end color. When set, the line will smoothly transition from `color` to `gradientColor` along its length. Default: `null` (no gradient).

### Textures

- **`map`** (`THREE.Texture | null`) — Diffuse texture to apply along the line. The texture is mapped using UV coordinates generated along the line length. Default: `null`.

- **`alphaMap`** (`THREE.Texture | null`) — Alpha mask texture for transparency effects. Uses the blue channel of the texture for alpha values. Default: `null`.

- **`mapOffset`** (`THREE.Vector2 | null`) — UV offset for both `map` and `alphaMap` textures. Allows shifting texture coordinates. Default: `null` (no offset).

### Dashes

- **`dashCount`** (`number | null`) — Number of dash cycles along the entire line length. When set, creates a dashed line pattern. Default: `null` (solid line).

- **`dashRatio`** (`number | null`) — Ratio of dash length to gap length (0 to 1). For example, `0.5` creates equal dash and gap lengths, `0.7` creates longer dashes with shorter gaps. Only works when `dashCount` is set. Default: `null`.

- **`dashOffset`** (`number`) — Offset into the dash cycle pattern. Animate this value to create moving dash effects. Default: `0`.

### Visibility

- **`usePercent`** (`boolean`) — Enables percent-based visibility uniforms. When `true`, creates `percent` and `percent2` uniforms for line reveal animations. Default: `false`.

- **`percent`** (`number`) — Start visibility percentage (0 to 1). Only used when `usePercent` is `true` or when both `percent` and `percent2` are defined. Default: `undefined`.

- **`percent2`** (`number`) — End visibility percentage (0 to 1). Only used when `usePercent` is `true` or when both `percent` and `percent2` are defined. Default: `undefined`.

### Rendering Flags

- **`opacity`** (`number`) — Global opacity multiplier (0 to 1). Default: `1` (fully opaque).

- **`alphaTest`** (`number`) — Alpha threshold for fragment discard. Fragments with alpha below this value are discarded. Default: `0.001`.

- **`transparent`** (`boolean`) — Whether the material should be rendered with transparency. Auto-detected based on other settings if not explicitly set. Default: `false`.

- **`wireframe`** (`boolean`) — Render the line geometry as wireframe. Mainly useful for debugging. Default: `false`.

- **`frustumCulled`** (`boolean`) — Whether the line should be frustum culled by Three.js. Set to `false` for lines that might extend outside the view. Default: `false`.

### Advanced / Internal

- **`needsWidths`** (`boolean`) — Whether to generate per-vertex width attributes. Set to `true` when using `widthCb`. Default: `false`.

- **`needsUVs`** (`boolean`) — Whether to generate UV coordinates for texture mapping. Default: `true`.

- **`needsCounters`** (`boolean`) — Whether to generate counter attributes for gradients and dashes. Default: `true`.

- **`needsPrevious`** (`boolean`) — Whether to generate previous vertex attributes for line direction calculation. Default: `true`.

- **`needsNext`** (`boolean`) — Whether to generate next vertex attributes for line direction calculation. Default: `true`.

- **`needsSide`** (`boolean`) — Whether to generate side attributes for line thickness. Default: `true`.

- **`rendererWidth`** (`number`) — Initial renderer width for resolution uniform. Default: `window.innerWidth`.

- **`rendererHeight`** (`number`) — Initial renderer height for resolution uniform. Default: `window.innerHeight`.

## Methods

### resize()

```ts
resize(width?: number, height?: number): void
```

Updates the internal resolution uniform. Call this in your resize handler if you manage the renderer size manually.

### dispose()

```ts
dispose(): void
```

Disposes the geometry and material and removes the mesh from its parent.

### Percent-based visibility

`MeshLine` exposes two `THREE.Uniform` objects, `percent` and `percent2`, when `usePercent` is true **or** both values were supplied in the options.  Animate these uniforms to reveal or hide the line:

```js
// Reveal from 0 → 100 %
line.percent.value = 0;
line.percent2.value = 1;

gsap.to(line.percent,  { value: 1, duration: 1 });   // Start grows
gsap.to(line.percent2, { value: 0, duration: 1 });   // End shrinks
```

## Usage Example

```javascript
import { MeshLine, circlePositions } from 'meshline';

const line = new MeshLine({
  lines: circlePositions(64),
  isClose: true,
  color: 0xff0000,
  lineWidth: 0.5,
  gradientColor: 0x00ff00
});

scene.add(line);

// Custom reveal
line.percent.value = -0.01;
line.percent2.value = 1.01;
gsap.to(line.percent,  { value: 1.01, duration: 1, ease: 'expo.out' });
gsap.to(line.percent2, { value: -0.01, duration: 1, ease: 'expo.out' });

// Clean up when done
line.dispose();
```

## Notes

• `MeshLine` extends `THREE.Mesh`, so it behaves like any other object in the scene graph.
• All numeric colour fields accept either a hex number (`0xff00ff`) or a `THREE.Color` instance.
• When `sizeAttenuation` is `false` (default), `lineWidth` is in pixels; when `true` it scales with distance.
• Always call `dispose()` to prevent memory leaks. 