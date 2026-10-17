---
description: "Copy practical Makio MeshLine recipes for circles, dashed lines, gradients, textures, dynamic updates, and sharp-corner handling in Three.js."
---

# Common Patterns

Quick recipes covering typical simple use-cases. Copy-paste and tweak. 

Start with these self-contained examples if you want the same ideas in full demo form:

- [Basic Example](./examples/basic.md)
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

## 12. Projected Folds

A smooth 3D curve — a knot, a helix, a trail — can point its tangent straight at the camera. Its projection then folds into a sharp screen-space turn even though the curve itself bends gently, and a screen-space miter at that turn would spike far past the stroke. Billboard lines tell the two cases apart from the path's own 3D turn, which does not change while the camera orbits: corners that really turn keep their crisp miter, and folds are rounded.

```js
// Default: folds are split in the vertex stage. No discard and no extra
// varyings, so fill cost is unchanged; a fold reads as a convex, slightly
// faceted cap (at most ~0.4 of the half width off the round silhouette).
const trail = new MeshLine().lines( curvePoints )

// Thick tubes: clip folds to the exact round silhouette in the fragment stage.
// This adds a discard, which costs tile-based GPUs their hidden-surface removal
// on overdraw-heavy, thick lines.
const tube = new MeshLine()
  .lines( knotPoints, true )
  .lineWidth( 0.6 )
  .join( { fold: 'exact' } )

// Round every join, including authored corners (implies exact folds).
const rounded = new MeshLine().lines( squarePositions( 4 ), true ).join( { type: 'round' } )

// Previous behaviour: plain miters everywhere.
const legacy = new MeshLine().lines( points ).join( { fold: false } )
```

The two modes also differ at authored corners sharper than `limit`. In the default mode their rows split into butt ends that overlap past the corner. With `fold: 'exact'` the miter instead melts continuously into a round join, fully round by twice the limit.

The default mode's split rows overlap near a fold. That is invisible on opaque lines, but a translucent or additive line draws the overlap twice and shows a slightly denser cap there. Use `fold: 'exact'` for such lines when the cap matters: its clip gives every pixel to exactly one row.

Two-point GPU lines (for example instanced lasers built from `segments( 1 )`), `bevel` joins, wireframes, and materials with `previousFn`/`nextFn` hooks have no fold to resolve and keep the plain shader. Joints next to the camera's near plane also keep the plain path. Switching `join()` on a live line only recompiles the material; its uniforms and resolution are kept.
