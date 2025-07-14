# Makio MeshLine
*A modern, performant TSL-powered meshline solution for Three.js*

## [Live Demo](https://meshlines.netlify.app)

See it in action with simple examples on [https://meshlines.netlify.app](https://meshlines.netlify.app) and check out the code here : [demo/src/demos](https://github.com/Makio64/Meshline/tree/main/demo/src/demos)

<img width="1661" alt="Screenshot 2025-06-26 at 15 58 30" src="https://github.com/user-attachments/assets/deb1ccd7-46a9-4be0-8f07-280c21aafe81" />

## [Documentation](https://meshlines-docs.netlify.app)
Check out the [documentation site](https://meshlines-docs.netlify.app/) for detailed instructions, API reference, and examples.
- [Why Makio MeshLine](https://meshlines-docs.netlify.app/why-makio-meshline.html)
- [Getting started](https://meshlines-docs.netlify.app/why-makio-meshline.html)
- [API overview](https://meshlines-docs.netlify.app/api.html)
- [Common Patterns](https://meshlines-docs.netlify.app/common-patterns.html)
- [Advanced Patterns](https://meshlines-docs.netlify.app/advanced-patterns.html)
- [Performance tips](https://meshlines-docs.netlify.app/performance.html)
- [Helpers functions](https://meshlines-docs.netlify.app/helpers.html)

## Installation

```bash
pnpm add makio-meshline # or npm/yarn
```

MeshLine is published as the **`makio-meshline`** package.  Use your favourite package manager.

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

## About

The concept was to build a performant but easily customizable MeshLine with TSL for WebGPURenderer, allowing the devs to focus on creativity instead of implementation.  ([read more about it](https://meshlines-docs.netlify.app/why-makio-meshline.html))

Features includes : gradients, dashes, textures, variable width, instancing, gpu control or cpu batching, advanced mitter, tsl Hook, etc..

Performance: the MeshLine will upload to the gpu only whats needed to keep performance optimal, also supporting instancing and gpu movement.

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
