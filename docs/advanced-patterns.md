# Advanced Patterns

These snippets showcase features that go beyond basic styling.

## 1. GPU-Driven Circle (no vertex upload)

```js
import { MeshLine } from 'makio-meshline'
import { Fn, vec3, cos, sin, time } from 'three/tsl'

const circleNode = Fn(( [counter] ) => {
  const angle = counter.mul( Math.PI * 2 ).add( time.negate() )
  return vec3( cos(angle), sin(angle), 0 )
})

const segments = 256 // only length matters when gpuPositionNode is used

const line = new MeshLine({
  lines: new Float32Array( segments * 3 ), // placeholder
  gpuPositionNode: circleNode,
  lineWidth: 0.3,
  gradientColor: 0xffff00
})
scene.add( line )
```

## 2. Multi-Line Batch

```js
const rings = [ circlePositions(64,1), circlePositions(64,1.5), circlePositions(64,2) ]

const multi = new MeshLine({
  lines: rings,
  isClose: true,
  color: 0xffffff,
  sizeAttenuation: true,
  lineWidth: 2
})
```

One draw-call – three rings.

## 3. Live Trail (fast `setPositions()`)

```js
// allocate once
const pts = new Float32Array( 64 * 3 )
const trail = new MeshLine({ lines: pts, lineWidth: 0.1 })
scene.add( trail )

function update() {
  writeTrail( pts )       // mutate coordinates in place
  trail.geometry.setPositions( pts )
}
```

No buffers recreated, only a sub-data upload.

## 4. Miter Clip for Sharp Corners

```js
const sharp = new MeshLine({
  lines: myPolyline,
  lineWidth: 0.8,
  useMiterLimit: true, // enable clipping
  miterLimit: 5
})
```

## 5. Animated Dashes

```js
const dashed = new MeshLine({
  lines: sineWavePositions(),
  dashCount: 20,
  dashRatio: 0.4,
  lineWidth: 0.4
})

stage.onUpdate.add( dt => {
  dashed.material.dashOffset.value += dt * 0.002
})
``` 