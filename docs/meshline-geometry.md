# MeshLineGeometry

The `MeshLineGeometry` class builds the line mesh geometry from raw point data, handling the complex vertex calculations needed for thick, smooth lines.

## Constructor

```ts
new MeshLineGeometry(options?: MeshLineGeometryOptions)
```

### MeshLineGeometryOptions (partial)

```ts
interface MeshLineGeometryOptions {
  lines?: Float32Array | number[][]          // Line points (required)
  isClose?: boolean | boolean[]              // Close the loop(s)
   
  // Flags to include / exclude generated attributes (advanced)
  needsPositions?: boolean
  needsPrevious?: boolean
  needsNext?: boolean
  needsUVs?: boolean
  needsSide?: boolean
  needsCounters?: boolean
  needsWidths?: boolean
}
```

`MeshLineGeometry` mirrors most of `MeshLine`'s geometry-related options and can be used directly when you need fine-grained control.

## Methods

### setLines()

```ts
setLines(
  linesArray: Float32Array[] | Array<[number, number, number]>[] | THREE.BufferGeometry[]
): void
```

Replace or initialize the geometry with one or multiple line segments.

#### Parameters

- `linesArray` – Array of line data, where each element represents a separate line. Each element can be a nested number array or a `Float32Array`.

### dispose()

```ts
dispose(): void
```

Releases geometry resources. Call when the geometry is no longer needed.

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

### Multiple Line Segments

```javascript
const lines = [
  [[0, 0, 0], [1, 0, 0], [1, 1, 0]], // First line
  [[2, 0, 0], [3, 1, 0], [3, 2, 0]]  // Second line
];

const geometry = new MeshLineGeometry({lines});
// OR
const geometry = new MeshLineGeometry();
geometry.setLines(lines);
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

const geometry = new MeshLineGeometry({lines:[points]});
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