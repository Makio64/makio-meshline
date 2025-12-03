---
outline: false
pageClass: example-page
---

# Bamboo Grove

A nature simulation showcasing advanced instancing combined with shadow casting to render a procedural bamboo forest.

<iframe src="https://meshline-demo.makio.io/examples/bamboooo?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

## Overview

This demo demonstrates how to combine MeshLine's instancing system with shadow casting to efficiently render complex natural scenes. Each bamboo stalk and node ring is rendered using a single instanced MeshLine, with custom shader hooks transforming a simple template into varied, organic shapes.

### Key Features

- **Instancing** - 20 bamboo stalks rendered with a single draw call
- **Custom shader hooks** - `positionFn`, `widthFn`, `colorFn` for procedural variation
- **Shadow casting** with custom `castShadowNode` for softer shadows
- **Atmospheric fog** for depth and ambiance

## Implementation Pattern

### 1. Template Geometry

Create a simple template that will be transformed per-instance:

```javascript
// Vertical line template from 0 to 1
const segments = 30
const templatePoints = new Float32Array(segments * 3)
for (let i = 0; i < segments; i++) {
  const t = i / (segments - 1)
  templatePoints[i * 3] = 0
  templatePoints[i * 3 + 1] = t  // Y goes from 0 to 1
  templatePoints[i * 3 + 2] = 0
}
```

### 2. Instance Attributes

Define per-instance data for position, scale, and lean:

```javascript
const mesh = new MeshLine()
  .lines(templatePoints)
  .instances(stalkCount)
  .color(0x497849)
  .lineWidth(0.1)
  .shadow(true)

// Add instance attributes
mesh.addInstanceAttribute('instanceTransform', 4) // x, z, height, widthMult
mesh.addInstanceAttribute('instanceLean', 3)      // lean, leanDirX, leanDirZ
```

### 3. Custom Position Hook

Transform the template using instance attributes:

```javascript
import { attribute, Fn, vec3 } from 'three/tsl'

mesh.positionFn(Fn(([position, progress]) => {
  const transform = attribute('instanceTransform', 'vec4')
  const lean = attribute('instanceLean', 'vec3')

  // Scale Y by height
  const y = position.y.mul(transform.z)

  // Apply quadratic lean based on progress (t²)
  const leanAmount = lean.x.mul(progress.mul(progress))
  const px = transform.x.add(lean.y.mul(leanAmount))
  const pz = transform.y.add(lean.z.mul(leanAmount))

  return vec3(px, y, pz)
}))
```

### 4. Custom Width Hook

Apply per-instance width variation:

```javascript
mesh.widthFn(Fn(([width]) => {
  const transform = attribute('instanceTransform', 'vec4')
  return width.mul(transform.w) // w component is width multiplier
}))
```

### 5. Custom Shadow Color

Soften the shadows for a natural look:

```javascript
import { vec3 } from 'three/tsl'

// After building, customize shadow appearance
mesh.material.castShadowNode = vec3(0.7) // Lighter shadows
```

### 6. Populate Instance Data

```javascript
for (let i = 0; i < stalksData.length; i++) {
  const s = stalksData[i]
  mesh.setInstanceValue('instanceTransform', i, [s.x, s.z, s.height, s.widthMult])
  mesh.setInstanceValue('instanceLean', i, [s.lean, s.leanDirX, s.leanDirZ])
}
```

## Best Practices

1. **Pre-calculate data** - Compute all random values before creating instances
2. **Minimize attributes** - Pack related data into vec4 attributes when possible
3. **Use multipliers** - Store width as a multiplier rather than absolute value
4. **Custom shadow nodes** - Lighter `castShadowNode` values create softer, more natural shadows
5. **Template simplicity** - Keep templates simple; let hooks do the transformation work
