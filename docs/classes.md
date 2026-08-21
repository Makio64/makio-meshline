# Classes

Makio MeshLine provides a high-level façade, a screen-profile geometry/material pair, and a surface-profile geometry/material pair. All live in the `makio-meshline` package and work with both WebGPU and WebGL2 back-ends.

---

## `MeshLine`

High-level façade that bundles geometry + material and exposes fluent setters for geometry, styling, hooks, instancing, and runtime updates.

```ts
import { MeshLine } from 'makio-meshline'

const line = new MeshLine({
  lines: [[0,0,0],[1,1,0],[2,0,0]],
  color: 0xff6600,
  lineWidth: 0.4,
  dash: { count: 8, ratio: 0.5 }
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
  closed: false,
  widthCallback: t => 0.2 + 0.8*Math.sin(t*Math.PI)
})
```

Important API:

* `setLines( lines[] )` – replace poly-lines (rebuilds all buffers).
* `setPositions( lines, updateBounding? )` – super-fast in-place update when point counts stay constant.
* `setPositionRange( patch, startPoint, options? )` – update and upload only a fixed local span plus its neighbor halo.

See the dedicated [geometry page](/meshline-geometry) for all details.

---

## `MeshLineNodeMaterial`

A specialized Three.js `NodeMaterial` that renders the line buffers with:

* Screen-space thickness or size-attenuation
* Optional gradients, textures, dashes
* Always-on bounded miter join, tuned via `miterLimit`, with optional sharp-bend subdivision for static paths

```ts
import { MeshLineNodeMaterial } from 'makio-meshline'

const mat = new MeshLineNodeMaterial({
  color: 0xffffff,
  gradientColor: 0x00ffff,
  lineWidth: 1.2,
  dashCount: 10,
  dashRatio: 0.6,
  miterLimit: 4
})
```

Direct material construction uses the low-level `dashCount`, `dashRatio`, and `dashOffset` uniform fields shown above. For application code, prefer the `MeshLine` facade and its grouped `dash` option.

Tip: uniforms such as `lineWidth`, `dashOffset`, and `opacity` are mutable at runtime for animation.

Read the full parameter list on the [material page](/meshline-material).

---

## `MeshLineSurfaceGeometry`

Camera-independent ribbon geometry for roads and tracks. It builds rotation-minimizing or fixed-up frames and normals from one or more centerline paths, adding arc-length progress, UVs, and tangents only for active consumers.

```ts
import { MeshLineSurfaceGeometry } from 'makio-meshline'

const geometry = new MeshLineSurfaceGeometry( {
  lines: roadPoints,
  lineWidth: 4,
  surface: { frame: 'transport', uvMode: 'distance', uvScale: 5 },
  join: { type: 'round', limit: 3, segments: 8 },
  cap: { type: 'round', segments: 8 }
} )
```

Ordinary miter/butt roads retain the compact two-row strip. Bevels, round joins, non-butt caps, over-limit miters, and reversals emit extra triangles only where needed.

---

## `MeshLineSurfaceNodeMaterial`

Standard PBR node material for surface geometry. It supports base and alpha maps through the normal `MeshLine` methods, plus `normalMap`, `roughnessMap`, `metalnessMap`, `roughness`, `metalness`, and `side` in the surface options.

```ts
import { MeshLineSurfaceNodeMaterial } from 'makio-meshline'

const material = new MeshLineSurfaceNodeMaterial( {
  color: 0xffffff,
  map: roadTexture,
  surface: { roughness: 0.9, metalness: 0 }
} )
```

Read [World-Space Surfaces](/surface) before using the low-level classes directly.

---

## `MeshLineCullingSystem`

Optional native-WebGPU chunk AABB culling and index compaction for a very large opaque `MeshLine`. It lives in a separate Three.js r183+ entry point:

```ts
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'

const culling = MeshLineCullingSystem.attach( renderer, scene, { mode: 'auto' } )
const handle = culling.add( line )
```

See [GPU Culling](/gpu-culling) for automatic thresholds, explicit bounds, lifecycle, and fail-open behavior.

---

## `MeshLineGPUPath`

Experimental native-WebGPU point-centric path renderer from the optional `makio-meshline/gpu-path` entry point. It owns a complete CPU `MeshLine` fallback and one non-indexed indirect draw. Its untouched miter/butt fast path derives topology without compute; advanced mode uses compact segment/triangle records for true bevel/round joins, caps, reversal splits, and homogeneous clipping. See [GPU Path](/gpu-path) for its LOD and fallback contracts.

---

## Screen-Profile Architecture Recap

<svg viewBox="0 0 800 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="MeshLine architecture" style="max-width:100%;height:auto;display:block;margin:1.5em auto;">
  <defs>
    <marker id="arc-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <text x="20" y="155" class="arc-label">points[]</text>
  <line x1="75" y1="160" x2="135" y2="160" class="arc-arrow-line" marker-end="url(#arc-arrow)"/>
  <line x1="665" y1="160" x2="725" y2="160" class="arc-arrow-line" marker-end="url(#arc-arrow)"/>
  <text x="735" y="155" class="arc-label">ribbon</text>
  <rect x="140" y="40" width="520" height="240" rx="14" ry="14" class="arc-facade"/>
  <text x="400" y="68" text-anchor="middle" class="arc-title">MeshLine</text>
  <text x="400" y="88" text-anchor="middle" class="arc-sub">high-level façade · extends THREE.Mesh</text>
  <line x1="280" y1="100" x2="280" y2="128" class="arc-arrow-line" stroke-dasharray="2 3" stroke-opacity="0.4"/>
  <line x1="520" y1="100" x2="520" y2="128" class="arc-arrow-line" stroke-dasharray="2 3" stroke-opacity="0.4"/>
  <rect x="170" y="130" width="220" height="125" rx="10" ry="10" class="arc-class"/>
  <text x="280" y="154" text-anchor="middle" class="arc-role">GEOMETRY</text>
  <text x="280" y="178" text-anchor="middle" class="arc-title" font-size="14">MeshLineGeometry</text>
  <text x="280" y="202" text-anchor="middle" class="arc-sub">vertex buffers</text>
  <text x="280" y="220" text-anchor="middle" class="arc-sub">position · previous · next</text>
  <text x="280" y="238" text-anchor="middle" class="arc-sub">optional progress · uv · width</text>
  <rect x="410" y="130" width="220" height="125" rx="10" ry="10" class="arc-class"/>
  <text x="520" y="154" text-anchor="middle" class="arc-role">MATERIAL</text>
  <text x="520" y="178" text-anchor="middle" class="arc-title" font-size="14">MeshLineNodeMaterial</text>
  <text x="520" y="202" text-anchor="middle" class="arc-sub">TSL NodeMaterial</text>
  <text x="520" y="220" text-anchor="middle" class="arc-sub">gradients · dashes · textures</text>
  <text x="520" y="238" text-anchor="middle" class="arc-sub">14 shader hooks</text>
  <circle class="arc-pulse" r="4" cx="0" cy="0"/>
</svg>

Use the façade for convenience or compose the profile-specific classes yourself for advanced scenarios. The diagram above shows the default screen profile; `.surface()` swaps in the world-space surface pair.
