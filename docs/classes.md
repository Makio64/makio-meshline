# Classes

Makio MeshLine provides three core classes. All live in the `makio-meshline` package and work with both WebGPU and WebGL2 back-ends.

---

## `MeshLine`

High-level façade that bundles geometry + material and exposes convenient uniforms (`percent`, `percent2`, `opacity`, …).

```ts
import { MeshLine } from 'makio-meshline'

const line = new MeshLine({
  lines: [[0,0,0],[1,1,0],[2,0,0]],
  color: 0xff6600,
  lineWidth: 0.4,
  dashCount: 8,
  dashRatio: 0.5
})
scene.add( line )
```

Key constructor options are described in the in-code JSDoc but the [MeshLine Options table](/meshline) lists every flag.

---

## `MeshLineGeometry`

Low-level geometry builder – use when you need to mutate vertices or share one geometry across many materials.

```ts
import { MeshLineGeometry } from 'makio-meshline'

const geom = new MeshLineGeometry({
  lines: [ myFloat32Array ],
  isClose: false,
  widthCallback: t => 0.2 + 0.8*Math.sin(t*Math.PI)
})
```

Important API:

* `setLines( lines[] )` – replace poly-lines (rebuilds all buffers).
* `setPositions( lines, updateBounding? )` – super-fast in-place update when point counts stay constant.

See the dedicated [geometry page](/meshline-geometry) for all details.

---

## `MeshLineNodeMaterial`

A specialized Three.js `NodeMaterial` that renders the line buffers with:

* Screen-space thickness or size-attenuation
* Optional gradients, textures, dashes
* Advanced joint handling with optional miter-clipping

```ts
import { MeshLineNodeMaterial } from 'makio-meshline'

const mat = new MeshLineNodeMaterial({
  color: 0xffffff,
  gradientColor: 0x00ffff,
  lineWidth: 1.2,
  dashCount: 10,
  dashRatio: 0.6,
  useMiterLimit: true
})
```

Tip: All uniforms (`lineWidth`, `dashOffset`, `opacity`, …) are mutable at runtime for animation.

Read the full parameter list on the [material page](/meshline-material).

---

## Architecture Recap

```
MeshLine (friendly façade)
    ├── MeshLineGeometry   – builds specialised vertex buffers
    └── MeshLineNodeMaterial – GPU rendering (TSL NodeMaterial)
```

Use the façade for convenience or compose the underlying classes yourself for advanced scenarios. 