# Makio MeshLine

A modern MeshLine library for Three.js wide screen strokes and world-space road/ribbon surfaces, with gradients, dashes, textures, shadows, GPU positions, and instancing.

- Supports: Three.js r180+, `WebGPURenderer` (WebGPU and WebGL2 backends)
- Features: gradients, dashes, textures, vertex colors, shadows, GPU positions, storage-buffer trails, instancing, TSL hooks, lit road/ribbon surfaces, optional native-WebGPU chunk culling, and an experimental point-centric GPU path

Release compatibility is checked from the packed artifact at the core minimum (r180), optional-entry minimum (r183), and pinned workspace Three.js version. The moving Three.js `dev` branch runs as an advisory canary.

## Install

```bash
pnpm add makio-meshline
```

## Quick Start

```js
import * as THREE from 'three/webgpu'
import { MeshLine, circlePositions } from 'makio-meshline'

const renderer = new THREE.WebGPURenderer( { antialias: true } )
renderer.setPixelRatio( window.devicePixelRatio )
renderer.setSize( window.innerWidth, window.innerHeight )
document.body.appendChild( renderer.domElement )
await renderer.init()

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 0.1, 100 )
camera.position.z = 10

const line = new MeshLine()
  .lines( circlePositions( 64, 3 ), true )
  .lineWidth( 0.2 )
  .color( 0xff8800 )
  .gradientColor( 0xffffff )
scene.add( line )

window.addEventListener( 'resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize( window.innerWidth, window.innerHeight )
  line.resize( window.innerWidth, window.innerHeight )
} )

renderer.setAnimationLoop( () => renderer.render( scene, camera ) )
```

The complete Three.js-style starter, including OrbitControls and cleanup structure, is in [`examples/vanilla`](https://github.com/Makio64/makio-meshline/tree/main/examples/vanilla).

For a camera-independent road or ribbon, select the surface profile:

```js
const road = new MeshLine()
  .lines(roadPoints)
  .lineWidth(4)
  .surface({ frame: 'transport', uvMode: 'distance', uvScale: 5 })
  .join({ type: 'round', limit: 3, segments: 8 })
  .cap({ type: 'round', segments: 8 })
  .build()
```

For a very large opaque path on Three.js r183+, the optional entry point can compact visible chunks into one indirect draw:

```js
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'

const culling = MeshLineCullingSystem.attach(renderer, scene, { mode: 'auto' })
const handle = culling.add(line)

// Warm the compact index buffer, then prepare and inspect a culling result.
renderer.render(scene, camera)
await culling.update(camera)

// Reports source index ranges, not point IDs.
const snapshot = await handle.readCullingSnapshot()
console.log(snapshot?.culledChunks)
```

For one very large static open path, the experimental r183+ point-centric entry point emits stable segment records and an indirect draw while retaining a full CPU fallback:

```js
import MeshLineGPUPath from 'makio-meshline/gpu-path'

const path = new MeshLineGPUPath(
  {
    lines: points,
    lineWidth: 0.35,
    join: { type: 'round', segments: 8 },
    cap: { type: 'round', segments: 8 }
  },
  { simplify: false }
)
scene.add(path)
await path.prepare(renderer, camera)
```

## Version 2

Version 2 keeps `MeshLine` as the preferred API and adds the supported world-space surface profile, hardened CPU billboard geometry, partial position updates, and optional native-WebGPU chunk culling. CPU point paths now derive progress and UVs from arc length, so uneven sampling no longer distorts gradients and dashes.

The point-centric GPU path and compute/simplification labs remain experimental. See the [V2 migration guide](https://meshline.makio.io/v2-migration.html) and [V2 design contract](https://meshline.makio.io/v2-design.html) before upgrading advanced or low-level integrations.

### Portable custom attributes

WebGPU guarantees eight vertex-buffer slots. Feature-heavy instanced lines should pack related custom values so they consume one slot:

```js
line.addInstanceAttributes( {
  instanceOffset: 3,
  instanceScale: 1
} )

line.setInstanceValues( 'instanceOffset', offsets )
line.setInstanceValues( 'instanceScale', scales )
console.log( line.getVertexBufferUsage() )
```

The facade validates the portable budget before pipeline creation. `addVertexAttributes()` provides the equivalent packed API for per-vertex data.

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
- Roads, tracks, and textured world-space ribbons

## License

MIT © David Ronai (Makio64)
