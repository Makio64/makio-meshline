---
outline: false
pageClass: example-page
---

# Vertex Colors

Color each point of your line individually with per-vertex RGB colors.

<iframe src="https://meshline-demo.makio.io/examples/vertex-colors?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

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