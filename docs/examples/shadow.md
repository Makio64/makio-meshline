---
description: "See how Makio MeshLine lines cast and receive shadows in Three.js, including dashed shadow behavior, 3D tube normal reconstruction, spotlights, and custom shadow appearance."
outline: false
pageClass: example-page
---

# Shadows (Cast & Receive)

MeshLine supports both **shadow casting** and **shadow receiving**, allowing lines to participate in Three.js shadow rendering with full support for dashed patterns and self-shadowing across overlapping rings.

<iframe loading="lazy" title="Makio MeshLine Shadow demo" src="https://meshline-demo.makio.io/examples/shadow?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Shadow demo](https://meshline-demo.makio.io/examples/shadow)

## Overview

This demo showcases MeshLine shadow casting and receiving with a dynamic multi-light setup featuring three colored spotlights orbiting around dashed circles that cast shadows onto a central sphere, the room floor, and one another.

### Key Features

- **Shadow casting & receiving** with `.shadow(true, true)` (or `.setReceiveShadow(true)`)
- **3D cylindrical tube normals** reconstructed on camera-facing billboards so self-shadowing and light falloff avoid flat-ribbon shadow acne
- **Dashed lines** properly cast shadows with gaps
- **Dynamic lighting** with animated RGB spotlights
- **Soft shadows** using `PCFShadowMap`, `light.shadow.radius`, and spotlight `penumbra`

## Basic Setup

Enable shadow casting and receiving on your MeshLine:

```javascript
import { MeshLine, circlePositions } from 'makio-meshline'
import { Mesh, PCFSoftShadowMap, SpotLight } from 'three/webgpu'

// Enable shadows on the renderer
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFSoftShadowMap

// Create a light that casts shadows
const light = new SpotLight( 0xffffff, 10 )
light.castShadow = true
light.shadow.mapSize.set( 1024, 1024 )
scene.add( light )

// Create a MeshLine that both casts and receives shadows
const line = new MeshLine()
	.lines( circlePositions( 64, 2 ), true )
	.lineWidth( 0.1 )
	.shadow( true, true ) // shadow( castShadow = true, receiveShadow = castShadow )
	.build()

scene.add( line )

// Add a mesh to receive shadows
const floor = new Mesh( planeGeometry, material )
floor.receiveShadow = true
scene.add( floor )
```

## Shadow with Dashes

Shadow casting works seamlessly with dashed lines - gaps in the dash pattern are properly rendered in the shadow:

```javascript
const dashedLine = new MeshLine()
	.lines( circlePositions( 64, 3 ), true )
	.lineWidth( 0.1 )
	.dash( { count: 30, ratio: 0.5 } )
	.shadow( true )
	.build()
```

## Custom Shadow Appearance

After building the line, you can customize the shadow appearance using `castShadowNode`:

```javascript
import { vec4 } from 'three/tsl'

const line = new MeshLine()
	.lines( positions )
	.shadow( true )
	.build()

// Lighter, softer shadows
line.material.castShadowNode = vec4( 0.7, 0.7, 0.7, 1 )
```

## Best Practices

1. **Shadow Map Size** - Use appropriate shadow map resolution (1024x1024 is a good balance)
2. **Shadow Bias** - Adjust `light.shadow.bias` to prevent shadow acne
3. **Performance** - Shadows add rendering cost; use sparingly for best performance
4. **Soft Shadows** - Use `PCFSoftShadowMap` for smoother shadow edges
