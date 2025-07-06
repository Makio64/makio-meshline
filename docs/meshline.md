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

  // ***Appearance***
  color?: number | THREE.Color
  lineWidth?: number                         // Screen-space px
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

  // Device pixel ratio
  dpr?: number

  // ***Advanced / internal***
  needsWidth?: boolean
  needsUV?: boolean
  needsCounter?: boolean
  needsPrevious?: boolean
  needsNext?: boolean
  needsSide?: boolean
  renderWidth?: number
  renderHeight?: number
}
```

## MeshLineOptions

### Geometry

- **`lines`** (`Float32Array | number[][]`) — **Required.** The line points data. Can be an array of `[x, y, z]` coordinate arrays, or a `Float32Array` with XYZ values. Default: `new Float32Array([0,0,0,1,0,0])`.

- **`isClose`** (`boolean | boolean[]`) — Whether to close the line loop(s). If `true`, connects the last point back to the first. For multiple lines, can be an array of booleans. Default: `false`.

### Appearance

- **`color`** (`number | THREE.Color`) — Base color of the line. Can be a hex number (`0xff0000`) or `THREE.Color` instance. Default: `0xffffff` (white).

- **`lineWidth`** (`number`) — Width of the line. When `sizeAttenuation` is `false`, this is in screen pixels. When `true`, it's scaled by distance. Default: `0.3`.

- **`widthCallback`** (`(t: number) => number | null`) — A function that receives the line progress (`t`, from 0 to 1) and returns a width multiplier. Allows for variable line width. Default: `null`.

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

- **`usePercent`** (`boolean`) — Enables percent-based visibility uniforms. When `true`, creates `percent` and `percent2` uniforms for line reveal animations. If `percent` or `percent2` are not provided, they default to `1`. Default: `false`.

- **`percent`** (`number`) — Start visibility percentage (0 to 1). The `percent` and `percent2` uniforms are only created if `usePercent` is `true`, or if both `percent` and `percent2` values are provided. If created, the default value for the uniform is `1`.

- **`percent2`** (`number`) — End visibility percentage (0 to 1). The `percent` and `percent2` uniforms are only created if `usePercent` is `true`, or if both `percent` and `percent2` values are provided. If created, the default value for the uniform is `1`.

### Rendering Flags

- **`opacity`** (`number`) — Global opacity multiplier (0 to 1). Default: `1` (fully opaque).

- **`alphaTest`** (`number`) — Alpha threshold for fragment discard. Fragments with alpha below this value are discarded. Default: `0`.

- **`transparent`** (`boolean`) — Whether the material should be rendered with transparency. Auto-detected based on other settings if not explicitly set. Default: `false`.

- **`wireframe`** (`boolean`) — Render the line geometry as wireframe. Mainly useful for debugging. Default: `false`.

- **`frustumCulled`** (`boolean`) — Whether the line should be frustum culled by Three.js. Set to `false` for lines that might extend outside the view. Default: `true`.

### Device Pixel Ratio

- **`dpr`** (`number`) — Device pixel ratio multiplier used for screen-space `lineWidth`. Defaults to `window.devicePixelRatio`.

### Advanced / Internal

- **`needsWidth`