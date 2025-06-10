# Helper Functions

Makio MeshLine provides utility functions to help generate common line shapes.

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
squarePositions(segments?: number): Float32Array
```

Generates a `Float32Array` of `[x, y, z]` points outlining a square.

#### Parameters

- `segments` (number, optional) — number of segments per side. Default: `1`.

#### Returns

`Float32Array` containing square vertex positions.

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

### sineWavePositions()

```ts
sineWavePositions(wavelengths?: number, segments?: number, amplitude?: number, length?: number): Float32Array
```

Generates a `Float32Array` of `[x, y, z]` points forming a sine wave.

#### Parameters

- `wavelengths` (number, optional) — number of complete wave cycles. Default: `2`.
- `segments` (number, optional) — number of points along the wave. Default: `100`.
- `amplitude` (number, optional) — height of the wave. Default: `1`.
- `length` (number, optional) — total length of the wave. Default: `4`.

#### Returns

`Float32Array` containing sine wave vertex positions.

#### Example

```javascript
import { sineWavePositions, MeshLine } from 'meshline';

// Create a basic sine wave
const positions = sineWavePositions();
const wave = new MeshLine(positions, { isClose: false });

// Create a wave with 3 cycles, higher amplitude
const bigWave = sineWavePositions(3, 100, 2, 6);
const line = new MeshLine(bigWave, { color: 0x00ff00 });
```

## Performance Tips

For better performance with many points, these helpers return `Float32Array` directly, which is optimal for Three.js BufferGeometry. 