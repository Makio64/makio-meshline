# Makio MeshLine

[![license](https://img.shields.io/npm/l/makio-meshline)](./LICENSE)
[![three.js](https://img.shields.io/badge/three.js-r180%2B-blue)](https://threejs.org/)

*A modern MeshLine library for Three.js wide lines, gradients, dashes, textures, shadows, GPU positions, and instancing.*

[
![demo](https://github.com/user-attachments/assets/4f1c7cee-0f8f-4c21-a720-531eb26bf485)
](https://meshline-demo.makio.io)

Makio MeshLine is built for creative coding, interactive trails, data visualization, and stylized rendering on top of Three.js `WebGPURenderer`. It gives you a small fluent API for wide and thick lines, while keeping TSL hooks available when you need custom GPU behavior.

## Features

- **TSL-powered** — Built with Three.js Shading Language for maximum GPU performance
- **WebGPU & WebGL2** — Works with both backends via `WebGPURenderer`
- **Instancing** — Render thousands of lines with a single draw call
- **14 GPU hooks** — Customize position, color, width, opacity, dash, UV and more in the shader
- **Gradients, dashes, textures** — Built-in support for common line styles
- **Variable width** — Per-vertex width control via callback or GPU hook
- **Line joins** — Clamped miter and simple joins for sharp corners
- **Shadow support** — Cast shadows from lines
- **GPU positions** — Procedural line generation entirely on the GPU
- **Tree-shakeable** — ESM-only, `sideEffects: false`, import only what you need
- **TypeScript** — Full type definitions included
- **Zero dependencies** — Only Three.js as peer dependency

## Why Use Makio MeshLine?

- Replace older `THREE.MeshLine` style workflows with a WebGPU-ready Three.js line renderer.
- Use the same API for one-off wide lines, repeated batches, or thousands of instanced lines.
- Keep CPU uploads low with `setPositions()`, batching, and GPU position nodes.
- Add styling and motion with gradients, dashes, textures, vertex colors, opacity, and TSL hooks instead of maintaining multiple line systems.

## Use Cases

- Interactive cursor trails, drawing tools, and paint-like strokes
- Motion design, sci-fi wireframes, stylized ropes, and decorative outlines
- Data visualization, flow fields, and parametric curves
- Large repeated scenes such as vegetation, hair-like structures, or wire sculptures

## Support Matrix

| Requirement | Version |
|---|---|
| **Three.js** | r180+ |
| **Renderer** | `WebGPURenderer` only |
| **Backends** | WebGPU & WebGL2 (via `WebGPURenderer`) |

## [Live Demo](https://meshline-demo.makio.io)

See it in action with examples on [https://meshline-demo.makio.io](https://meshline-demo.makio.io) and check out the code here : [demo/src/demos](https://github.com/Makio64/makio-meshline/tree/main/demo/src/demos)

<a href="https://meshline-demo.makio.io">
<img width="1661" alt="Screenshot" src="https://github.com/user-attachments/assets/deb1ccd7-46a9-4be0-8f07-280c21aafe81" />
</a>

## Installation

```bash
pnpm add makio-meshline # or npm/yarn
```

## Quick Start

```javascript
import * as THREE from 'three/webgpu'
import { MeshLine, circlePositions } from 'makio-meshline'

// 1. Basic Three.js scaffolding ------------------------------------------------
const renderer = new THREE.WebGPURenderer()
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100)
camera.position.z = 4

// 2. Create a line (fluent API) ------------------------------------------------
const line = new MeshLine()
  .lines(circlePositions(64), true) // 64-segment circle, closed loop
  .color(0xff6600)                  // hex or THREE.Color
  .lineWidth(0.4)                   // world units (sizeAttenuation on by default)

scene.add(line)

// 3. Render loop ---------------------------------------------------------------
renderer.setAnimationLoop(() => renderer.render(scene, camera))
```

## [Documentation](https://meshline.makio.io)

Check out the [documentation site](https://meshline.makio.io/) for detailed instructions, API reference, and examples.
- [Why Makio MeshLine](https://meshline.makio.io/why-makio-meshline.html)
- [Getting started](https://meshline.makio.io/guide.html)
- [API overview](https://meshline.makio.io/api.html)
- [Common Patterns](https://meshline.makio.io/common-patterns.html)
- [Advanced Patterns](https://meshline.makio.io/advanced-patterns.html)
- [Performance tips](https://meshline.makio.io/performance.html)
- [Helpers functions](https://meshline.makio.io/helpers.html)

<img width="1709" height="970" alt="Screenshot 2025-07-14 at 19 45 01" src="https://github.com/user-attachments/assets/0cbe4a1f-b84e-462a-aeeb-3cb190097bf8" />

## About

The concept was to build a performant but easily customizable MeshLine with TSL for WebGPURenderer, allowing the devs to focus on creativity instead of implementation.  ([read more about it](https://meshline.makio.io/why-makio-meshline.html))

## Coming from THREE.MeshLine?

If you've been using [spite/THREE.MeshLine](https://github.com/spite/THREE.MeshLine), makio-meshline is a modern replacement built for Three.js WebGPU era. The API is different (fluent/chainable), but the concepts are the same. Check the [documentation](https://meshline.makio.io/guide.html) for migration guidance.

## Thanks

A big thanks to the community, especially to my friend [@Floz](https://x.com/florianzumbrunn) for his constant support, [Samsyyyy](https://x.com/Samsyyyy) for the early tests & feedbacks, to [TheSpite](https://x.com/thespite) for making the first version i knew of MeshLine, to [MrDoob](https://x.com/mrdoob) and [Sunag](https://x.com/sea3dformat) for Three.js and TSL!

#### Learn more about meshlines :
- [Matt DesLauriers](https://github.com/mattdesl)'s [`drawing-lines-is-hard`](https://mattdesl.svbtle.com/drawing-lines-is-hard)
- [Nathan Gordon](https://x.com/gordonnl)'s [`crafting-stylised-mouse-trails-with-ogl`](https://tympanus.net/codrops/2019/09/24/crafting-stylised-mouse-trails-with-ogl/)

---

## Contributing

Bug reports, feature requests and PRs are welcome. Please open an issue first to discuss major changes.

## License

This project is licensed under the [MIT License](./LICENSE) .

---

Made with ❤️ by [Makio64](https://x.com/makio64)
