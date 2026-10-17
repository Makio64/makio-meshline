---
description: "Reference helper functions like circlePositions, squarePositions, rectanglePositions, sineWavePositions, and straightLine for building Three.js MeshLine paths."
---

# Helper Functions

Utility functions that generate `Float32Array` point data for common line shapes.

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
squarePositions(width?: number, segments?: number): Float32Array
```

Generates a `Float32Array` of `[x, y, z]` points outlining a square.

#### Parameters

- `width` (number, optional) — side length of the square. Default: `1`.
- `segments` (number, optional) — number of segments per side. Default: `1`.

#### Returns

`Float32Array` containing square vertex positions.

#### Example

```javascript
import { squarePositions, MeshLine } from 'makio-meshline';

// Create a simple square
const square = new MeshLine({ lines: squarePositions(), closed: true });

// Create a unit square with four segments per side
const line = new MeshLine({ lines: squarePositions(1, 4), closed: true });
```

## rectanglePositions()

```ts
rectanglePositions(width?: number, height?: number, segments?: number): Float32Array
```

Generates a `Float32Array` of `[x, y, z]` points outlining a rectangle in the XY plane. Use `closed: true` to connect the final side.

#### Parameters

- `width` (number, optional) — width of the rectangle. Default: `1`.
- `height` (number, optional) — height of the rectangle. Default: `1`.
- `segments` (number, optional) — number of segments per side. Default: `1`.

#### Returns

`Float32Array` containing rectangle vertex positions.

#### Example

```javascript
import { rectanglePositions, MeshLine } from 'makio-meshline';

const rectangle = new MeshLine({
  lines: rectanglePositions(3, 2, 4),
  closed: true
});
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

## storagePositions()

```ts
storagePositions(
	buffer: StorageBufferAttribute,
	options: {
		pointsPerLine: number
		head?: Node<'uint'> | null
		toBuffer?: StorageBufferAttribute | null
		morph?: Node<'float'> | number | null
		closed?: Node<'float'> | boolean | null
	}
): TSL function
```

Builds a `gpuPositionNode` that reads line points directly from a WebGPU storage buffer, so a compute pass or state transition can move every point without per-frame CPU uploads. The buffer holds one run of `pointsPerLine` points per instance (`vec3` or `vec4` items; `w` is ignored).

Pass a `uint` uniform as `head` to treat each run as a **ring buffer**. Progress `0` then samples the newest slot and progress `1` the oldest, so a trail simulation writes only its new samples each frame instead of shifting the whole trail down one slot.

Pass `toBuffer` and `morph` to interpolate on the GPU between two `StorageBufferAttribute` snapshots (such as morphing contour or isobar states), and pass `closed: true` (or a per-instance `0` / `1` attribute node) to wrap the loop seam from `pointsPerLine - 1` back to `0`.

#### Parameters

- `buffer` (`StorageBufferAttribute`) — `vec3` or `vec4` point storage, `lineCount × pointsPerLine` items.
- `options.pointsPerLine` (number) — points stored per instance; at least `2`.
- `options.head` (uniform, optional) — newest slot for ring-buffer trails.
- `options.toBuffer` (`StorageBufferAttribute`, optional) — target point storage for GPU morph transitions (`vec3` or `vec4`, matching `buffer.count`).
- `options.morph` (float node or number, optional) — `0..1` blend factor between `buffer` and `toBuffer` when `toBuffer` is provided.
- `options.closed` (boolean or float node, optional) — when `true` (or `> 0.5` per instance), wraps progress across `pointsPerLine` segments so `progress = 1` closes back to point `0`.

#### Returns

A TSL function for `.gpuPositionNode()`.

#### Ring-Buffer Trail Example

```javascript
import { MeshLine, storagePositions } from 'makio-meshline'
import { cos, Fn, instanceIndex, sin, storage, uniform, vec3 } from 'three/tsl'
import { StorageBufferAttribute } from 'three/webgpu'

const TRAILS = 64
const LENGTH = 256
const buffer = new StorageBufferAttribute( TRAILS * LENGTH, 3 )
const head = uniform( 0, 'uint' )

// One thread per trail appends its next sample after the current head.
const points = storage( buffer, 'vec3', buffer.count )
const advance = Fn( () => {
	const base = instanceIndex.mul( LENGTH )
	const previous = points.element( base.add( head ) ).toVar()
	const flow = vec3( sin( previous.y ), cos( previous.x ), sin( previous.x.add( previous.z ) ) ).mul( 0.05 )
	points.element( base.add( head.add( 1 ).mod( LENGTH ) ) ).assign( previous.add( flow ) )
} )().compute( TRAILS )

const trails = new MeshLine()
	.instances( TRAILS )
	.segments( LENGTH - 1 )
	.gpuPositionNode( storagePositions( buffer, { pointsPerLine: LENGTH, head } ) )
	.lineWidth( 0.4 )
	.build()

function animate() {
	renderer.compute( advance )
	head.value = ( head.value + 1 ) % LENGTH
	renderer.render( scene, camera )
}
```

#### Contour / Isobar Morphing Example

```javascript
import { MeshLine, storagePositions } from 'makio-meshline'
import { uniform } from 'three/tsl'
import { StorageBufferAttribute } from 'three/webgpu'

const TRACKS = 48
const POINTS = 96
const fromBuffer = new StorageBufferAttribute( new Float32Array( TRACKS * POINTS * 3 ), 3 )
const toBuffer = new StorageBufferAttribute( new Float32Array( TRACKS * POINTS * 3 ), 3 )
const morph = uniform( 0 )

const isobars = new MeshLine()
	.instances( TRACKS )
	.segments( POINTS )
	.closed( true )
	.gpuPositionNode( storagePositions( fromBuffer, {
		pointsPerLine: POINTS,
		toBuffer,
		morph,
		closed: true,
	} ) )
	.lineWidth( 0.045 )
	.build()
```

Storage buffers require the native WebGPU backend. The [Lorenz Trails demo](https://meshline-demo.makio.io/examples/lorenz-trails) uses the ring-buffer pattern, and the [Isobar Transitions demo](https://meshline-demo.makio.io/examples/isobars) uses dual-buffer morphing with closed-loop wrapping.
