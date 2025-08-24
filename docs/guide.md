# Getting Started

This guide will walk you through the basics of installing and using Makio MeshLine in your Three.js project.

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


## Next Steps

- Use the [Sandbox](./examples/sandbox.md) example to test the options and generate the code for your line 
- Check other examples [Live Demos](https://meshlines.netlify.app) to see various implementations in action
- Check out the [API Reference](./api.md) to explore all the available customization options.
