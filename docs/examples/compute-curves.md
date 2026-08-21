---
description: "Render autonomous WebGPU storage-buffer curves with MeshLineCompute, glowing dashes, textures, and mouse-driven flow forces."
outline: false
pageClass: example-page
---

# Compute Curves

This demo uses `MeshLineCompute` as a WebGPU curve engine: compute shaders update autonomous curve points and arc-length data in storage buffers, then MeshLine renders them as glowing textured ribbons with distance-based dash modulation.

<iframe title="Makio MeshLine Compute Curves demo" src="https://meshline-demo.makio.io/examples/compute-curves?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Compute Curves demo](https://meshline-demo.makio.io/examples/compute-curves)

## Minimal Pattern

```javascript
import { MeshLineCompute } from 'makio-meshline'

const curves = new MeshLineCompute( {
	curveCount: 180,
	pointsPerCurve: 42,
	lineWidth: 0.14,
	color: 0x47f7ff,
	gradientColor: 0xff4bd8,
	transparent: true,
	opacity: 0.82,
} ).build()

scene.add( curves )

function frame( deltaSeconds ) {
	curves.step( renderer, deltaSeconds )
	renderer.render( scene, camera )
}
```

`renderer` must be a `WebGPURenderer` backed by native WebGPU. Without `renderer.compute()`, `step()` warns once, returns `false`, and does not advance the simulation.

The live example adds a generated texture map, additive blending, a color gradient, width and fragment-alpha hooks, a mouse attractor, and live controls for curve count, mouse and curl strengths, dash spacing, and simulation mode. Its dash modulation uses `arcLengthNode( progress )`, so spacing follows the current animated curve distance instead of normalized point progress.

## Why Compute

`setPositions()` is still the best path for small CPU-owned trails. `MeshLineCompute` is for cases where point state can stay on the GPU across frames. JavaScript updates uniforms, while WebGPU updates the whole curve field in parallel.
