# API Reference

This page provides the API reference for **Makio MeshLine**.

## Import

```js
import { MeshLine, circlePositions, squarePositions } from 'meshline';
```

## Classes

### MeshLine

```ts
new MeshLine(
  positions: Array<[number, number, number]>,
  options?: MeshLineOptions
)
```

A high-performance line mesh built on Three.js's NodeMaterial system.

#### MeshLineOptions

- `isClose` (boolean) — whether the line loop should be closed. Default: `false`.
- `color` (number) — hexadecimal line color. Default: `0xffffff`.
- `opacity` (number) — overall opacity of the line (0 to 1). Default: `1`.
- `alphaTest` (number) — alpha threshold for discarding fragments. Default: `1`.
- `lineWidth` (number) — width of the line in world units. Default: `0.3`.
- `sizeAttenuation` (boolean) — whether line width attenuates with perspective. Default: `false`.
- `gradientColor` (number | null) — hexadecimal color for a gradient effect along the line. Default: `null`.
- `map` (`THREE.Texture` | null) — texture to apply along the line. Default: `null`.
- `alphaMap` (`THREE.Texture` | null) — alpha mask texture for the line. Default: `null`.
- `mapOffset` (`THREE.Vector2` | null) — offset for the line texture coordinates. Default: `null`.
- `dashCount` (number | null) — number of dashes in the line. Default: `null`.
- `dashRatio` (number | null) — ratio of dash length to gap length. Default: `null`.
- `dashOffset` (number) — offset for the dash pattern. Default: `0`.
- `transparent` (boolean) — whether the material is transparent. Default: `false`.
- `wireframe` (boolean) — whether to render the line as wireframe. Default: `false`.
- `usePercent` (boolean) — whether to enable percent-based visibility uniforms. Default: `false`.
- `percent` (number) — initial start visibility percentage (0 to 1). Requires `percent2` or `usePercent`. Default: `undefined`.
- `percent2` (number) — initial end visibility percentage (0 to 1). Requires `percent` or `usePercent`. Default: `undefined`.

You can use the `show()` and `hide()` methods on a `MeshLine` instance to animate these percent uniforms for dynamic reveal/hide effects.

### MeshLineGeometry

```ts
new MeshLineGeometry(
  lines: Array<[number, number, number]> | Float32Array | THREE.BufferGeometry,
  widthCallback?: (t: number) => number,
  loop?: boolean | boolean[]
)
```

Builds the line mesh geometry from raw point data. If you provide a regular array of points, the geometry will internally convert it to a `Float32Array`. For best performance (and to avoid this conversion step), pass your points as a `Float32Array`.

#### setLines

```ts
geometry.setLines(
  linesArray: Array<[number, number, number]>[] | Float32Array[] | THREE.BufferGeometry[],
  widthCallback?: (t: number) => number,
  loops?: boolean | boolean[]
): void
```

Replace or initialize the geometry with one or multiple line segments. The `loops` parameter can be a single boolean (applied to all lines) or an array of booleans matching each line.

### MeshLineNodeMaterial

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
    gradient?: THREE.Color | null,
    opacity?: number,
    map?: THREE.Texture | null,
    alphaMap?: THREE.Texture | null,
    mapOffset?: THREE.Vector2,
    repeat?: THREE.Vector2,
    dashCount?: number | null,
    dashRatio?: number | null,
    dashOffset?: number
  }
)
```

Parameters:

- `transparent` (boolean) — whether the material is rendered with transparency. Default: auto-detected (true if `alphaMap` is set, `opacity < 1`, or `transparent` flag is true).
- `depthWrite` (boolean) — whether to write depth. Default: `true`.
- `depthTest` (boolean) — whether to perform depth testing. Default: `true`.
- `wireframe` (boolean) — render line as wireframe. Default: `false`.
- `alphaTest` (number) — alpha threshold for discarding fragments. Default: `1`.
- `sizeAttenuation` (boolean) — whether line width attenuates with perspective. Default: `true`.
- `resolution` (`THREE.Vector2`) — viewport resolution for correct aspect scaling. Default: `new Vector2(1, 1)`.
- `lineWidth` (number) — base width multiplier for the line in screen space. Default: `1`.
- `color` (number | `THREE.Color`) — line color. Default: `0xffffff`.
- `gradient` (`THREE.Color` | null) — optional gradient end color. Default: `null`.
- `opacity` (number) — global opacity. Default: `1`.
- `map` (`THREE.Texture` | null) — diffuse texture. Default: `null`.
- `alphaMap` (`THREE.Texture` | null) — alpha mask texture. Default: `null`.
- `mapOffset` (`THREE.Vector2`) — UV offset for `map` and `alphaMap`. Default: `new Vector2(0, 0)`.
- `repeat` (`THREE.Vector2`) — UV repeat for `map` and `alphaMap`. Default: `new Vector2(1, 1)`.
- `dashCount` (number | null) — number of dash cycles along the line. Default: `null`.
- `dashRatio` (number | null) — ratio of dash length to gap length (0 to 1). Default: `null` (falls back to `dashLength` parameter if provided).
- `dashOffset` (number) — offset into the dash cycle. Default: `0`.

The `MeshLineNodeMaterial` is a subclass of Three.js `NodeMaterial` that implements the vertex and fragment logic for rendering thick, dashed, and textured lines using GPU-friendly techniques.

## Helper Functions

### circlePositions

```ts
circlePositions(segments?: number, radius?: number): Float32Array
```

Generates a `Float32Array` of `[x, y, z]` coordinates evenly spaced around a circle of the given radius (default `1`).

### squarePositions

```ts
squarePositions(segments?: number): Array<[number, number, number]>
```

Generates an array of `[x, y, z]` points outlining a square.


> *You can find more details and full API on the GitHub repository.* 