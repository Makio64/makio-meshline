---
description: "Color each point in a Makio MeshLine with per-vertex RGB values for gradients, data-driven color ramps, and stylized trails."
outline: false
pageClass: example-page
---

# Vertex Colors

Color each point of your line individually with per-vertex RGB colors. In the Waves demo below, one RGB per point paints the sea: a warm glint under the sun that cools toward the edges, while the positions animate every frame.

<iframe title="Makio MeshLine Waves demo with vertex colors" src="https://meshline-demo.makio.io/examples/waves?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Waves demo](https://meshline-demo.makio.io/examples/waves)

## Usage

```javascript
import { MeshLine } from 'makio-meshline'

const numPoints = 100
const positions = new Float32Array(numPoints * 3)
const colors = new Float32Array(numPoints * 3)

for (let i = 0; i < numPoints; i++) {
  const t = i / (numPoints - 1)

  // Position
  positions[i * 3] = (t - 0.5) * 10
  positions[i * 3 + 1] = Math.sin(t * Math.PI * 3)
  positions[i * 3 + 2] = 0

  // Color (RGB values 0-1)
  colors[i * 3] = 1 - t      // Red
  colors[i * 3 + 1] = 0       // Green
  colors[i * 3 + 2] = t       // Blue
}

const line = new MeshLine()
  .lines(positions)
  .vertexColors(colors)
  .lineWidth(0.05)
  .build()
```

The `vertexColors` method accepts a flat array of RGB values (0-1 range) with 3 values per vertex. Use `Float32Array` for best performance.