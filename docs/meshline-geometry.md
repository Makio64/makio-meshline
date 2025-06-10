# MeshLineGeometry

The `MeshLineGeometry` class builds the line mesh geometry from raw point data, handling the complex vertex calculations needed for thick, smooth lines.

## Constructor

```ts
new MeshLineGeometry(
  lines: Array<[number, number, number]> | Float32Array | THREE.BufferGeometry,
  widthCallback?: (t: number) => number,
  loop?: boolean | boolean[]
)
```

Creates a new MeshLineGeometry instance.

### Parameters

- `lines` - Line points data. Can be:
  - Array of `[x, y, z]` coordinate points
  - `Float32Array` containing vertex data
  - Three.js `BufferGeometry` object
- `widthCallback` (optional) - Function that returns width multiplier based on position along line (0-1)
- `loop` (optional) - Whether to close the line loop(s)

## Methods

### setLines()

```ts
setLines(
  linesArray: Array<[number, number, number]>[] | Float32Array[] | THREE.BufferGeometry[],
  widthCallback?: (t: number) => number,
  loops?: boolean | boolean[]
): void
```

Replace or initialize the geometry with one or multiple line segments.

#### Parameters

- `linesArray` - Array of line data, where each element represents a separate line
- `widthCallback` (optional) - Function to calculate width at each point along the line
- `loops` (optional) - Boolean or array of booleans indicating which lines should be closed loops

### dispose()

```ts
dispose(): void
```

Releases geometry resources. Call when the geometry is no longer needed.

## Width Callback Function

The `widthCallback` parameter allows you to vary the line width along its length:

```javascript
// Taper from full width to zero
const taperCallback = (t) => 1 - t;

// Bulge in the middle
const bulgeCallback = (t) => 1 + Math.sin(t * Math.PI) * 0.5;

// Constant width
const constantCallback = (t) => 1;
```

The parameter `t` ranges from 0 (start of line) to 1 (end of line).

## Performance Notes

- **Float32Array Input**: For best performance, provide your points as a `Float32Array` to avoid internal conversion
- **Multiple Lines**: Use `setLines()` with an array to create multiple line segments efficiently
- **Memory Management**: Always call `dispose()` when done with the geometry

## Usage Examples

### Basic Line

```javascript
import { MeshLineGeometry } from 'meshline';

const points = [
  [0, 0, 0],
  [1, 1, 0],
  [2, 0, 0]
];

const geometry = new MeshLineGeometry(points);
```

### Tapered Line

```javascript
const geometry = new MeshLineGeometry(
  points,
  (t) => 1 - t * 0.8, // Taper to 20% width
  false // Open line
);
```

### Multiple Line Segments

```javascript
const lines = [
  [[0, 0, 0], [1, 0, 0], [1, 1, 0]], // First line
  [[2, 0, 0], [3, 1, 0], [3, 2, 0]]  // Second line
];

const geometry = new MeshLineGeometry();
geometry.setLines(
  lines,
  (t) => 1, // Constant width
  [true, false] // First line closed, second open
);
```

### From Float32Array (Optimal Performance)

```javascript
// Pre-allocate Float32Array for best performance
const pointCount = 100;
const points = new Float32Array(pointCount * 3);

for (let i = 0; i < pointCount; i++) {
  const angle = (i / pointCount) * Math.PI * 2;
  points[i * 3] = Math.cos(angle);
  points[i * 3 + 1] = Math.sin(angle);
  points[i * 3 + 2] = 0;
}

const geometry = new MeshLineGeometry(points, null, true);
```

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