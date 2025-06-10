# Helper Functions

Makio MeshLine provides several utility functions to help generate common line shapes and patterns.

## Position Generators

### circlePositions()

```ts
circlePositions(segments?: number, radius?: number): Float32Array
```

Generates a `Float32Array` of `[x, y, z]` coordinates evenly spaced around a circle.

#### Parameters

- `segments` (number, optional) — number of points around the circle. Default: `100`.
- `radius` (number, optional) — radius of the circle. Default: `1`.

#### Returns

`Float32Array` containing vertex positions in XYZ format.

#### Example

```javascript
import { circlePositions, MeshLine } from 'meshline';

// Create a circle with 64 segments and radius 2
const positions = circlePositions(64, 2);
const circle = new MeshLine(positions, { isClose: true });
```

### squarePositions()

```ts
squarePositions(segments?: number): Array<[number, number, number]>
```

Generates an array of `[x, y, z]` points outlining a square.

#### Parameters

- `segments` (number, optional) — number of segments per side. Default: `1`.

#### Returns

`Array<[number, number, number]>` containing square vertex positions.

#### Example

```javascript
import { squarePositions, MeshLine } from 'meshline';

// Create a simple square
const positions = squarePositions();
const square = new MeshLine(positions, { isClose: true });

// Create a square with more segments per side for smoother corners
const smoothSquare = squarePositions(4);
const line = new MeshLine(smoothSquare, { isClose: true });
```

## Usage Patterns

### Creating Custom Shapes

You can combine and modify these helpers to create custom shapes:

```javascript
import { circlePositions, MeshLine } from 'meshline';

// Create an ellipse by scaling circle positions
const circlePos = circlePositions(64, 1);
const ellipsePos = new Float32Array(circlePos.length);

for (let i = 0; i < circlePos.length; i += 3) {
  ellipsePos[i] = circlePos[i] * 2;     // Scale X by 2
  ellipsePos[i + 1] = circlePos[i + 1]; // Keep Y
  ellipsePos[i + 2] = circlePos[i + 2]; // Keep Z
}

const ellipse = new MeshLine(ellipsePos, { isClose: true });
```

### Spirals and Helixes

```javascript
// Create a spiral
function spiralPositions(turns = 3, segments = 100, radius = 1, height = 2) {
  const positions = new Float32Array(segments * 3);
  
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const angle = t * turns * Math.PI * 2;
    const r = radius * (1 - t * 0.5); // Spiral inward
    
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = t * height - height / 2;
    positions[i * 3 + 2] = Math.sin(angle) * r;
  }
  
  return positions;
}

const spiral = new MeshLine(spiralPositions(), { isClose: false });
```

### Sine Waves

```javascript
// Create a sine wave
function sineWavePositions(wavelengths = 2, segments = 100, amplitude = 1, length = 4) {
  const positions = new Float32Array(segments * 3);
  
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const x = (t - 0.5) * length;
    const y = Math.sin(t * wavelengths * Math.PI * 2) * amplitude;
    
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = 0;
  }
  
  return positions;
}

const wave = new MeshLine(sineWavePositions(), { isClose: false });
```

### Star Shapes

```javascript
// Create a star shape
function starPositions(points = 5, outerRadius = 1, innerRadius = 0.4) {
  const positions = [];
  const angleStep = (Math.PI * 2) / (points * 2);
  
  for (let i = 0; i < points * 2; i++) {
    const angle = i * angleStep;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    
    positions.push([
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0
    ]);
  }
  
  return positions;
}

const star = new MeshLine(starPositions(), { isClose: true });
```

## Performance Tips

### Use Float32Array for Large Datasets

For better performance with many points, generate `Float32Array` directly:

```javascript
function optimizedCircle(segments = 100, radius = 1) {
  const positions = new Float32Array(segments * 3);
  const angleStep = (Math.PI * 2) / segments;
  
  for (let i = 0; i < segments; i++) {
    const angle = i * angleStep;
    const offset = i * 3;
    
    positions[offset] = Math.cos(angle) * radius;
    positions[offset + 1] = Math.sin(angle) * radius;
    positions[offset + 2] = 0;
  }
  
  return positions;
}
```

### Pre-compute Complex Shapes

For animations or repeated use, pre-compute position arrays:

```javascript
// Pre-compute different circle sizes
const circleCache = new Map();

function getCachedCircle(segments, radius) {
  const key = `${segments}-${radius}`;
  
  if (!circleCache.has(key)) {
    circleCache.set(key, circlePositions(segments, radius));
  }
  
  return circleCache.get(key);
}
```

## Mathematical Functions

### Parametric Curves

You can create any parametric curve by defining functions for x(t), y(t), z(t):

```javascript
function parametricCurve(xFunc, yFunc, zFunc, segments = 100, tMin = 0, tMax = 1) {
  const positions = new Float32Array(segments * 3);
  
  for (let i = 0; i < segments; i++) {
    const t = tMin + (i / (segments - 1)) * (tMax - tMin);
    
    positions[i * 3] = xFunc(t);
    positions[i * 3 + 1] = yFunc(t);
    positions[i * 3 + 2] = zFunc(t);
  }
  
  return positions;
}

// Lissajous curve
const lissajous = parametricCurve(
  t => Math.sin(3 * t * Math.PI * 2),
  t => Math.sin(2 * t * Math.PI * 2),
  t => 0,
  200
);

const curve = new MeshLine(lissajous, { isClose: true });
```

These helper functions provide a solid foundation for creating various line shapes, and can be easily extended or combined to create more complex geometries. 