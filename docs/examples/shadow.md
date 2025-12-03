---
outline: false
pageClass: example-page
---

# Shadow

MeshLine supports shadow casting, allowing lines to participate in Three.js shadow rendering with full support for dashed patterns.

<iframe src="https://meshline-demo.makio.io/examples/shadow?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

## Overview

This demo showcases MeshLine shadow casting with a dynamic multi-light setup featuring three colored spotlights orbiting around dashed circles that cast shadows onto a central sphere.

### Key Features

- **Shadow casting** with `.shadow(true)`
- **Dashed lines** properly cast shadows with gaps
- **Dynamic lighting** with animated spotlights
- **Soft shadows** using PCFSoftShadowMap

## Basic Setup

Enable shadow casting on your MeshLine:

```javascript
import { MeshLine, circlePositions } from 'makio-meshline'
import { PCFSoftShadowMap, SpotLight } from 'three'

// Enable shadows on the renderer
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFSoftShadowMap

// Create a light that casts shadows
const light = new SpotLight(0xffffff, 10)
light.castShadow = true
light.shadow.mapSize.set(1024, 1024)
scene.add(light)

// Create a MeshLine with shadows enabled
const line = new MeshLine()
  .lines(circlePositions(64, 2))
  .lineWidth(0.1)
  .shadow(true)
  .build()

scene.add(line)

// Add a mesh to receive shadows
const floor = new Mesh(planeGeometry, material)
floor.receiveShadow = true
scene.add(floor)
```

## Shadow with Dashes

Shadow casting works seamlessly with dashed lines - gaps in the dash pattern are properly rendered in the shadow:

```javascript
const dashedLine = new MeshLine()
  .lines(circlePositions(64, 3))
  .lineWidth(0.1)
  .dash({ count: 30, ratio: 0.5 })
  .shadow(true)
  .build()
```

## Custom Shadow Appearance

After building the line, you can customize the shadow appearance using `castShadowNode`:

```javascript
import { vec3 } from 'three/tsl'

const line = new MeshLine()
  .lines(positions)
  .shadow(true)
  .build()

// Lighter, softer shadows
line.material.castShadowNode = vec3(0.7)
```

## Best Practices

1. **Shadow Map Size** - Use appropriate shadow map resolution (1024x1024 is a good balance)
2. **Shadow Bias** - Adjust `light.shadow.bias` to prevent shadow acne
3. **Performance** - Shadows add rendering cost; use sparingly for best performance
4. **Soft Shadows** - Use `PCFSoftShadowMap` for smoother shadow edges
