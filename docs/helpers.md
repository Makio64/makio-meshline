# Helper Functions

Utilities functions to help generate `Float32Array` for common line shapes.

## circlePositions()

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
import { circlePositions, MeshLine } from 'makio-meshline';

// Create a circle with 64 segments and a radius of 2unit
const circle = new MeshLine({ lines: circlePositions(64, 2), closed: true });
```

## squarePositions()

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
import { squarePositions, MeshLine } from 'makio-meshline';

// Create a simple square
const square = new MeshLine({ lines: squarePositions(), closed: true });

// Create a square with more segments per side for smoother corners
const line = new MeshLine({ lines: squarePositions(4), closed: true });
```

## sineWavePositions()

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
import { sineWavePositions, MeshLine } from 'makio-meshline';

// Create a basic sine wave
const wave = new MeshLine({
  lines: sineWavePositions(),
  closed: false
});

// Create a wave with 3 cycles, higher amplitude
const line = new MeshLine({
  lines: sineWavePositions(3, 100, 2, 6),
  color: 0x00ff00
});
```

## straightLine()

```ts
straightLine(width?: number, segments?: number, isVertical?: boolean): Float32Array
```

Generates a `Float32Array` of `[x, y, z]` points forming a straight line.

#### Parameters

- `width` (number, optional) — length of the line. Default: `1`.
- `segments` (number, optional) — number of segments along the line. Default: `2`.
- `isVertical` (boolean, optional) — whether the line is vertical (Y-axis) or horizontal (X-axis). Default: `false`.

#### Returns

`Float32Array` containing straight line vertex positions.

#### Example

```javascript
import { straightLine, MeshLine } from 'makio-meshline';

// Create a horizontal line 5 units long with 10 segments
const horizontal = new MeshLine({ lines: straightLine(5, 10, false) });

// Create a vertical line 3 units long with 20 segments
const vertical = new MeshLine({ lines: straightLine(3, 20, true) });

// Create a simple horizontal line with default width and segments
const simple = new MeshLine({ lines: straightLine() });
```

## straightLineBetween()

```ts
straightLineBetween(start: Vector3 | [x, y, z], end: Vector3 | [x, y, z], segments?: number): Float32Array
```

Generates a `Float32Array` of `[x, y, z]` points forming a straight line between two points.

#### Parameters

- `start` (`Vector3` | array) — starting point as Vector3 object or `[x, y, z]` array.
- `end` (`Vector3` | array) — ending point as Vector3 object or `[x, y, z]` array.
- `segments` (number, optional) — number of segments along the line. Default: `1`.

#### Returns

`Float32Array` containing straight line vertex positions.

#### Example

```javascript
import { straightLineBetween, MeshLine } from 'makio-meshline';
import * as THREE from 'three/webgpu';

// Line between two Vector3 points
const start = new THREE.Vector3(-2, 1, 0);
const end = new THREE.Vector3(3, -1, 2);
const line = new MeshLine({ lines: straightLineBetween(start, end, 20) });

// Line between array coordinates
const line2 = new MeshLine({ 
  lines: straightLineBetween([0, 0, 0], [5, 5, 5], 15) 
});
```
