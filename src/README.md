# Makio MeshLine

A modern, performant TSL-powered meshline solution for Three.js.

- Supports: Three.js r178+, WebGPURenderer (WebGPU/WebGL2 backends)
- Features: gradients, dashes, textures, variable width, instancing, TSL hooks

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

## Documentation & Demos

- Docs: https://meshlines-docs.netlify.app
- Live demos: https://meshlines.netlify.app

## License

MIT © David Ronai (Makio64)
