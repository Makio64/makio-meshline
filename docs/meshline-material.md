# MeshLineNodeMaterial

The `MeshLineNodeMaterial` class is a specialized Three.js NodeMaterial that implements the vertex and fragment shaders for rendering thick, dashed, and textured lines using GPU-friendly techniques.

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

Creates a new MeshLineNodeMaterial with the specified parameters.

## Parameters

### Rendering Properties

- `transparent` (boolean) — whether the material is rendered with transparency. Default: auto-detected (true if `alphaMap` is set, `opacity < 1`, or `transparent` flag is true).
- `depthWrite` (boolean) — whether to write depth. Default: `true`.
- `depthTest` (boolean) — whether to perform depth testing. Default: `true`.
- `wireframe` (boolean) — render line as wireframe. Default: `false`.
- `alphaTest` (number) — alpha threshold for discarding fragments. Default: `0`.

### Line Appearance

- `sizeAttenuation` (boolean) — whether line width attenuates with perspective. Default: `true`.
- `resolution` (`THREE.Vector2`) — viewport resolution for correct aspect scaling. Default: `new Vector2(1, 1)`.
- `lineWidth` (number) — base width multiplier for the line in screen space. Default: `1`.
- `color` (number | `THREE.Color`) — line color. Default: `0xffffff`.
- `gradient` (`THREE.Color` | null) — optional gradient end color. Default: `null`.
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

## Methods

### dispose()

```ts
dispose(): void
```

Cleans up material resources. Call when the material is no longer needed.

### copy()

```ts
copy(source: MeshLineNodeMaterial): this
```

Copies properties from another MeshLineNodeMaterial instance.

## Features

### Size Attenuation

When `sizeAttenuation` is enabled, lines maintain consistent visual thickness regardless of camera distance:

```javascript
const material = new MeshLineNodeMaterial({
  sizeAttenuation: true,
  lineWidth: 2
});
```

### Gradients

Create smooth color transitions along the line:

```javascript
const material = new MeshLineNodeMaterial({
  color: 0xff0000,      // Red start
  gradient: 0x0000ff,   // Blue end
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

## Usage Examples

### Basic Colored Line

```javascript
import { MeshLineNodeMaterial } from 'meshline';
import * as THREE from 'three';

const material = new MeshLineNodeMaterial({
  color: 0xff6600,
  lineWidth: 3,
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
});
```

### Gradient Dashed Line

```javascript
const material = new MeshLineNodeMaterial({
  color: 0xff0000,
  gradient: 0x00ff00,
  dashCount: 12,
  dashRatio: 0.6,
  lineWidth: 2,
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
});
```

### Textured Line with Animation

```javascript
const material = new MeshLineNodeMaterial({
  map: striipeTexture,
  repeat: new THREE.Vector2(8, 1),
  dashCount: 6,
  dashRatio: 0.8,
  dashOffset: 0, // Animate this for moving effect
  lineWidth: 4,
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
});

// Animation loop
function animate() {
  material.dashOffset += 0.01;
  requestAnimationFrame(animate);
}
```

### Tapered Line with Alpha Map

```javascript
const material = new MeshLineNodeMaterial({
  color: 0xffffff,
  alphaMap: gradientTexture, // Fades from opaque to transparent
  transparent: true,
  lineWidth: 5,
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
});
```

## NodeMaterial Integration

This material extends Three.js `NodeMaterial` using `tsl`

Internally it handles all the heavy lifting for:

- Create only uniforms you need
- Screen-space line thickness calculations
- UV generation for textures & dashes
- Dash pattern evaluation