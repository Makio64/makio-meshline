---
description: "Get started with Makio MeshLine for Three.js, from installation to your first wide, dashed, gradient, or textured line in WebGPU."
---

# Getting Started

This guide will walk you through the basics of installing and using Makio MeshLine in your Three.js project.

<svg viewBox="0 0 820 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="THREE.Line versus makio-meshline" style="max-width:100%;height:auto;display:block;margin:1.5em auto;">
  <text x="40" y="32" class="ml-label">THREE.Line</text>
  <text x="40" y="195" class="ml-sub">1 device pixel · GPU line primitive</text>
  <path d="M 40 130 C 140 70, 280 190, 380 130" class="ml-thin ml-draw"/>
  <line x1="410" y1="25" x2="410" y2="200" class="ml-divider"/>
  <text x="440" y="32" class="ml-label">makio-meshline</text>
  <text x="440" y="195" class="ml-sub">triangle strip · real width in world units · styleable</text>
  <path d="M 440 130 C 540 70, 680 190, 780 130" class="ml-ribbon ml-draw"/>
  <path d="M 440 130 C 540 70, 680 190, 780 130" class="ml-center"/>
</svg>

A **MeshLine** is not a native GPU line — it's a triangle-strip ribbon that mirrors your polyline on both sides, so every line has a real thickness in world units, supports gradients, dashes, textures, and plugs into any TSL shader hook.

## Installation

First, install the package:

```bash
pnpm add makio-meshline #or npm/yarn
```

## Basic Setup

Here's a minimal example of how to create a simple circular `Meshline` and add it to your scene

```javascript
import * as THREE from 'three/webgpu'
import { MeshLine, circlePositions } from 'makio-meshline'

const scene    = new THREE.Scene()
const camera   = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .1, 1000)
camera.position.z = 20

const renderer = new THREE.WebGPURenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)


const line = new MeshLine()
  .lines(circlePositions(64, 10))// 64-segment circle, radius 10
  .closed(true) // we close the loop ( last 2 point are connected )
  .lineWidth(1) // dimension in world units
  .color(0xff8800) // color 
  .gradientColor(0xffffff) // with a gradient to white

scene.add(line)

const loop = () => {
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}
loop()
```

That's it! You should now see a vibrant orange circle in your scene.


## Using a Framework?

If you're building with React or Vue, jump to a ready-to-run example with a declarative `<MeshLine>` wrapper component:

- [React Three Fiber](./react-three-fiber.md) — open the [R3F StackBlitz template](https://stackblitz.com/github/Makio64/makio-meshline/tree/main/examples/react-three-fiber)
- [Vue](./vue.md) — open the [Vue StackBlitz template](https://stackblitz.com/github/Makio64/makio-meshline/tree/main/examples/vue)

## Next Steps

- Start with [Basic Examples](./examples/basic.md) to see one option change at a time
- Check [Follow](./examples/follow.md) and [Draw Lines](./examples/drawlines.md) for dynamic updates
- Use the [Sandbox](./examples/sandbox.md) to tune parameters and copy the generated line
- Move to [Instancing](./examples/instancing.md) and [GPU Circle](./examples/gpucircle.md) once the basics are clear
- Check other examples in the [Live Demos](https://meshline-demo.makio.io) to see the more advanced scenes in action
- Check out the [API Reference](./api.md) to explore all the available customization options.
