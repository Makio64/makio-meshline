# Makio MeshLine

A modern MeshLine library for Three.js wide lines, gradients, dashes, textures, shadows, GPU positions, and instancing.

- Supports: Three.js r180+, `WebGPURenderer` (WebGPU and WebGL2 backends)
- Features: gradients, dashes, textures, vertex colors, shadows, GPU positions, instancing, TSL hooks

## Install

```bash
pnpm add makio-meshline
```

## Quick Start

```js
import * as THREE from 'three/webgpu'
import { MeshLine, circlePositions } from 'makio-meshline'

const renderer = new THREE.WebGPURenderer()
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)

const line = new MeshLine().configure({
  lines: circlePositions(64),
  closed: true,
  color: 0xff6600,
  lineWidth: 0.4
})
scene.add(line)

renderer.setAnimationLoop(() => renderer.render(scene, camera))
```

## Framework Quickstart

Ready-to-run examples with a declarative `<MeshLine>` wrapper:

- **React Three Fiber** — [docs](https://meshline.makio.io/react-three-fiber.html) · [open in StackBlitz](https://stackblitz.com/github/Makio64/makio-meshline/tree/main/examples/react-three-fiber)
- **Vue** — [docs](https://meshline.makio.io/vue.html) · [open in StackBlitz](https://stackblitz.com/github/Makio64/makio-meshline/tree/main/examples/vue)

## Documentation & Demos

- Docs: https://meshline.makio.io
- Live demos: https://meshline-demo.makio.io

## Use Cases

- Wide and thick lines for creative coding and motion design
- Interactive trails and drawing tools in Three.js
- GPU-driven curves and instanced line scenes

## License

MIT © David Ronai (Makio64)
