# Makio MeshLine
*A modern, performant TSL-powered meshline solution for Three.js*

The concept was to build a performant but easily customizable MeshLine in TSL. 

Features : gradients, dashes, textures, variable width, percent-based visibility, advanced mitter, nodeHook, etc..
Note: the MeshLine will upload to the gpu only whats needed to keep performance optimal.

<img width="1661" alt="Screenshot 2025-06-26 at 15 58 30" src="https://github.com/user-attachments/assets/deb1ccd7-46a9-4be0-8f07-280c21aafe81" />


Check out the [documentation site](https://meshlines-docs.netlify.app/) for detailed instructions, API reference, and examples.

## Installation

```bash
pnpm add makio-meshline # or npm/yarn
```

MeshLine is published as the **`makio-meshline`** package.  Use your favourite package manager.

---

## Quick Start

```javascript
import * as THREE from 'three'
import { MeshLine, circlePositions } from 'meshline'

// 1. Basic Three.js scaffolding ------------------------------------------------
const renderer = new THREE.WebGLRenderer()
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 0, 4)

// 2. Create a line -------------------------------------------------------------
const line = new MeshLine({
  lines: circlePositions(64), // Float32Array helper – use your own points too
  isClose: true,              // close the loop
  color: 0xff6600,            // hex or THREE.Color
  lineWidth: 0.4              // in pixels (when sizeAttenuation=false)
})
scene.add(line)

// 3. Render loop ---------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate)
  renderer.render(scene, camera)
}
animate()
```

---

## Documentation

The full documentation lives in the [`docs/`](./docs) folder and on the hosted site:

▶ **https://meshlines-docs.netlify.app**

You will find:

* Guides & live examples
* Complete API reference (`MeshLine`, `MeshLineGeometry`, `MeshLineNodeMaterial`)
* Helper functions (`circlePositions`, `squarePositions`, `sineWavePositions`)
* Performance tips

---

## Contributing

Bug reports, feature requests and PRs are welcome. Please open an issue first to discuss major changes.

---

## License

This project is licensed under the [MIT License](./LICENSE) . 
