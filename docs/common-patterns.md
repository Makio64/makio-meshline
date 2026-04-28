---
description: "Copy practical Makio MeshLine recipes for circles, dashed lines, gradients, textures, dynamic updates, and sharp-corner handling in Three.js."
---

# Common Patterns

Quick recipes covering typical simple use-cases. Copy-paste and tweak. 

Start with these self-contained examples if you want the same ideas in full demo form:

- [Basic Examples](./examples/basic.md)
- [Follow](./examples/follow.md)
- [Draw Lines](./examples/drawlines.md)
- [Instancing](./examples/instancing.md)
- [Interactive sandbox](./examples/sandbox.md)

For advanced techniques like GPU-driven positions and custom shaders, see [Advanced Patterns](./advanced-patterns.md).

## 1. Basic White Line

```js
const line = new MeshLine()
  .lines([[0,0,0],[1,1,0],[2,0,0]])
  .color(0xffffff)
  .lineWidth(1) // value in unit of threejs
```

## 2. Closed Circle

```js
const line = new MeshLine()
  .lines(circlePositions(64))
  .closed(true) // close the last 2 points
```

shorter methods : 
```js
const line = new MeshLine()
  .lines(circlePositions(64), true) // lines( lines, closed )
```

## 3. Dashed Line

```js
const line = new MeshLine()
  .lines(circlePositions(64), true)
  .dash({ count: 8, ratio: 0.5 }) // dash({ count, ratio = 0.5, offset = 0 })
```

## 4. Gradient

```js
const line = new MeshLine()
  .lines(squarePositions(4), true)
  .color(0xff0000) // start of the gradient will be Red
  .gradientColor(0x0000ff) // end of the gradient will be Blue
```

## 5. Textured Rope

```js
const line = new MeshLine()
  .lines(myFloat32Array)
  .map(ropeTexture) // add your texture here.
```

## 6. Variable Width

```js
const line = new MeshLine()
  .lines(sineWavePositions(100))
  .widthCallback(t => 0.1 + t * 0.9) // Thin to thick
```

## 7. Animated Dashes

```js
const line = new MeshLine()
  .lines(circlePositions(64), true)
  .dash({ count: 12, ratio: 0.3 })

// In render loop:
line.material.dashOffset.value -= 0.01 // -= for clockwise movement
```

## 8. Multi-Line Segments

```js
const lines = [
  [[0,0,0], [1,0,0], [1,1,0]],  // First segment
  [[2,0,0], [3,1,0], [3,2,0]],  // Second segment
  [[4,0,0], [5,0,1], [4,1,1]]   // Third segment
]

// this will create 3 different lines
const meshLine = new MeshLine()
  .lines(lines)
  .color(0xffffff)
```

## 9. Dynamic Updates

```js
// Pre-allocate for performance
const positions = new Float32Array(NUM_POINTS * 3)
const line = new MeshLine({ lines: positions })

// Update positions efficiently
function animate() {
  updatePositions(positions) // Your update logic
  line.setPositions(positions) // optimized for fast CPU->GPU updates
  requestAnimationFrame(animate)
}
```
**Note:** check advanced examples for more performant full-GPU techniques: instancing and GPU positioning.

## 10. Window Resize Handling

```js
const line = new MeshLine().lines(points)

window.addEventListener('resize', () => {
  // or the size of your threejs canvas.
  line.resize(window.innerWidth, window.innerHeight)
})
```

## 11. Sharp Corners (Miter + Smoothing)

Two knobs work together to keep polylines with sharp corners looking clean at every camera angle:

1. **Optional corner smoothing** (geometry): `smoothSharpBends` (default `false`) subdivides any corner whose interior bend is sharper than ~60°, splitting it into two cutoff points `smoothSharpBendsAlpha` of the way back along each adjacent segment (default `0.001` once enabled — visually imperceptible). Enable it when cleaner static sharp corners matter more than exact input topology.
2. **Miter clamp** (shader): `.join({ limit })` caps how far the miter offset can extend. Lower values flatten spikes earlier, higher values allow long pointy miters.

```js
// Default combo — stable topology, miter clamp only
const line = new MeshLine()
  .lines(squarePositions(16), true)
  .lineWidth(2)
// Implicit: smoothSharpBends=false, miterLimit=4

// Very sharp static polyline (zigzag-style) — opt into smoothing
const zigzag = new MeshLine()
  .lines(myZigzagPoints)
  .lineWidth(2)
  .smoothSharpBends(true)       // subdivides sharp corners
  .join({ limit: 2 })            // bevel residual spikes at very sharp bends

// Exact 1:1 GPU buffer mapping (animation pinned to input indices)
const exact = new MeshLine()
  .lines(myPoints)
  .join({ limit: 4 })
``` 