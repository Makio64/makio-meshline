# MeshLine Class

The `MeshLine` class is the main interface for creating performant, customizable lines in Three.js.

## Constructor

```ts
new MeshLine(
  positions: Array<[number, number, number]>,
  options?: MeshLineOptions
)
```

Creates a new MeshLine instance with the given positions and options.

### Parameters

- `positions` - Array of `[x, y, z]` coordinate points that define the line path
- `options` - Optional configuration object (see MeshLineOptions below)

## MeshLineOptions

The options object accepts the following properties:

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

## Methods

### show()

```ts
show(): Promise<void>
```

Animates the line to become visible by animating the percent uniforms. Returns a promise that resolves when the animation completes.

### hide()

```ts
hide(): Promise<void>
```

Animates the line to become hidden by animating the percent uniforms. Returns a promise that resolves when the animation completes.

### resize()

```ts
resize(): void
```

Updates the line's resolution uniforms to match the current window size. Called automatically on window resize.

### dispose()

```ts
dispose(): void
```

Cleans up resources and removes event listeners. Call this when the line is no longer needed.

## Usage Example

```javascript
import { MeshLine, circlePositions } from 'meshline';

// Create a circular line
const positions = circlePositions(64);
const line = new MeshLine(positions, {
  color: 0xff0000,
  lineWidth: 0.5,
  isClose: true,
  gradientColor: 0x00ff00
});

// Add to scene
scene.add(line);

// Animate in
await line.show();

// Later, animate out
await line.hide();

// Clean up
line.dispose();
```

## Notes

- The MeshLine extends Three.js `Mesh`, so it can be used like any other Three.js object
- Percent-based visibility allows for sophisticated reveal/hide animations
- The line automatically handles window resizing for proper rendering
- Use `dispose()` to prevent memory leaks when removing lines 