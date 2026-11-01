---
description: "Makio MeshLine V2 performance benchmarks and interactive MeshLine-rendered diagram covering partial range uploads, O(lines) bounds refreshes, angle-adaptive surface topology, and 200K-point GPU paths."
---

# V2 Benchmarks

Makio MeshLine 2.0 overhauls the hot paths across screen-space billboards, world-space road/ribbon surfaces, bounding-volume updates, and optional native-WebGPU pipelines.

The interactive diagram below is **rendered live with `MeshLine`** on `WebGPURenderer`—every bar, scaling curve, data-point ring, live brush wave, bounding box, and world-space road ribbon is an actual `MeshLine` mesh. Switch between the four benchmark suites or toggle **Wireframe** (`W`) to inspect the underlying geometry.

<BenchmarkDiagram />

## Headline V2 Speedups

| Optimization Area | V1 / Baseline | V2 Result | Improvement |
|---|---:|---:|---:|
| **Partial 128-pt edit on 200K-pt billboard (`setPositionRange`)** | `1.28 ms` CPU · `28.80 MB` upload | `0.0039 ms` CPU · `18.62 KB` upload | **331× faster CPU · 99.94% less GPU upload** |
| **Padding-only bounds refresh (`lineWidth()` / `miterLimit()`) on 200K×1** | `1.58 ms` ($O(\text{points})$ scan) | `0.00025 ms` ($0.25\ \mu\text{s}$, $O(\text{lines})$) | **6,300× faster** |
| **Padding-only bounds refresh on 200K points across 64 lines** | `1.59 ms` ($O(\text{points})$ scan) | `0.0057 ms` ($5.7\ \mu\text{s}$, $O(\text{lines})$) | **278× faster** |
| **50K-pt surface `round8-butt` geometry memory** | `549,982` verts · `18.31 MiB` | `199,996` verts · `6.29 MiB` | **63.6% fewer vertices · 65.6% less RAM** |
| **50K-pt surface build (`miter-butt` / `bevel` / `round`)** | `10.78–21.84 ms` (per-corner allocs) | **`3.32–3.92 ms`** (bisector frame + orthonormal join basis + flat scratch pool) | **3.3×–5.6× faster** |
| **3D camera-fold miter overshoot (24 camera poses)** | `31.6 px` spike + `489` notched pixels | `4.8 px` (`'geometry'`) / `1.6 px` (`'exact'`) | **Zero spikes & zero notched core pixels** |
| **200K-pt `MeshLineGPUPath` with local dyadic oracle** | `199,999` segments (CPU fallback) | `1,646` retained segments (indirect draw) | **65.9% less GPU buffer memory · ~10% faster frame** |

---

## 1. Partial Range Updates (`pnpm bench:hotpaths`)

When drawing strokes, dragging control segments, or advancing a cursor window inside a large pre-allocated batch, `setPositionRange( points, startPoint, { lineIndex } )` updates only the modified point span and its one-point neighbor halo (`previous` / `next` at the boundaries) using Three.js `BufferAttribute.addUpdateRange()`.

```bash
pnpm bench:hotpaths
```

### 200,000-Point Billboard Hot-Path Comparison (128-Point Edit)

| Profile | Full `setPositions()` | Full + Bounds | Partial `setPositionRange()` | Pending Upload Bytes | Full `position + previous + next` |
|---|---:|---:|---:|---:|---:|
| **Default (`needsProgress: false`)** | `1.28 ms` | `1.54 ms` | **`0.0039 ms`** | **`18.6 KB`** (`18,624` B) | `28.8 MB` (`28,800,000` B) |
| **Progress + UV (`needsProgress` + `needsUV`)** | `2.18 ms` | `2.27 ms` | `0.58 ms` | `9.62 MB` | `28.8 MB` |
| **Endpoint Metadata (`needsEndpointMetadata`)** | `2.45 ms` | `2.55 ms` | `0.91 ms` | `16.02 MB` | `28.8 MB` |
| **Width Callback (`widthCallback`)** | `2.67 ms` | `2.72 ms` | **`0.93 ms`** | `6.42 MB` | `28.8 MB` |

::: tip Why `needsProgress: false` is 331× faster for partial edits
When a line does not depend on cumulative arc-length progress, UVs, or a progress-driven `widthCallback`, a 128-point edit inside a 200,000-point line touches only `130 × 4 = 520` physical vertices across `position`, `previous`, and `next` (`18,624` bytes total). When arc-length progress is active, changing segment lengths shifts downstream normalized progress along that line, and V2 streams the normalized progress (`rawProgress[i] * invTotalLength`) directly into the target attribute buffers without a separate normalization pass.
:::

---

## 2. $O(\text{lines})$ Cached Bounds Refresh (`pnpm bench:bounds`)

Animating `line.lineWidth()`, `line.miterLimit()`, `line.join()`, or `line.sizeAttenuation()` changes the world-space padding around a billboard line's bounding box and bounding sphere, but does **not** move the centerline points.

In V2, `MeshLineGeometry` caches each line's unpadded bounding box and sphere whenever points are built or updated. Padding-only refreshes recompute the expanded bounds in $O(\text{lines})$ instead of rescanning $O(\text{points})$ vertices:

```bash
pnpm bench:bounds
```

| Configuration | `lineWidth()` Refresh | `join({ limit })` Refresh | Full `setPositions(pts, true)` Rescan | Speedup vs Rescan |
|---|---:|---:|---:|---:|
| **10,000 pts (1 line)** | `0.0012 ms` (`1.2 µs`) | `0.0009 ms` (`0.9 µs`) | `0.110 ms` | **~95×–120×** |
| **10,000 pts (64 lines)** | `0.0072 ms` (`7.2 µs`) | `0.0059 ms` (`5.9 µs`) | `0.111 ms` | **~15×–19×** |
| **100,000 pts (1 line)** | `0.00054 ms` (`0.54 µs`) | `0.00062 ms` (`0.62 µs`) | `0.860 ms` | **~1,380×–1,590×** |
| **100,000 pts (64 lines)** | `0.0064 ms` (`6.4 µs`) | `0.0060 ms` (`6.0 µs`) | `0.804 ms` | **~125×–135×** |
| **200,000 pts (1 line)** | **`0.00025 ms` (`0.25 µs`)** | **`0.00042 ms` (`0.42 µs`)** | `1.696 ms` | **~4,040×–6,780×** |
| **200,000 pts (64 lines)** | **`0.0057 ms` (`5.7 µs`)** | **`0.0053 ms` (`5.3 µs`)** | `1.692 ms` | **~298×–317×** |

---

## 3. World-Space Surface Topology & Scratch Pool (`pnpm bench:surface-topology`)

World-space road and ribbon surfaces (`MeshLineSurfaceGeometry`) transport a 3D frame (`transport` or `fixed-up`), evaluate banking, and emit true miter, bevel, or round join/cap geometry. V2 optimizes surface generation in three ways:
1. **Bisector reflection frame transport + orthonormal $\{\vec{t}, \vec{n}, \vec{m} = \vec{n} \times \vec{t}\}$ join basis + flat scratch pool**: Parallel transport uses algebraic bisector reflection with a single Newton-Raphson normalization step, and join/cap solvers derive miter directions, side projections, and cap fans in the local orthonormal basis into reusable flat typed buffers (`JOIN_STRIDE = 6`, zero JS array allocations), cutting `miter-butt`, `miter-round8`, `bevel`, and `round` build times by **3.3×–5.6×**.
2. **Canonical index reuse on `setPositions()`**: When updating a compact surface path (including capped `round` or `square` strips) whose vertex/index topology has not changed, `MeshLineSurfaceGeometry` skips rewriting and re-uploading the index buffer (`indexAttr.version` stays unchanged).
3. **Angle-adaptive round fans**: `join.segments` is treated as a half-turn ($\pi$ rad) budget, so shallow bends allocate proportionally fewer fan triangles instead of unconditionally emitting the maximum fan at every vertex.

```bash
pnpm bench:surface-topology -- 50000 7
```

### 50,000-Point Surface Topology Results (`position` + `normal`)

| Join / Cap Policy | Vertices | Indices | Buffer Size | Median Build Time | Notes |
|---|---:|---:|---:|---:|---|
| **`miter-butt`** | `100,000` | `299,994` | `3.43 MiB` (`3,599,976` B) | **`3.32 ms`** | Compact 2-row strip (`2 × N` vertices, **3.3× faster**) |
| **`miter-round8`** | `100,016` | `300,042` | `3.43 MiB` (`3,600,552` B) | **`3.42 ms`** | Pooled zero-alloc cap buffers; adds only 16 cap vertices (**4.9× faster**) |
| **`bevel-butt`** | `199,996` | `449,988` | `6.29 MiB` (`6,599,856` B) | **`3.58 ms`** | Direct unaliased target-buffer emission + bridge wedge (**4.9× faster**) |
| **`round8-butt` (V2 adaptive)** | `199,996` | `449,988` | **`6.29 MiB` (`6,599,856` B)** | **`3.74 ms`** | **Down from `549,982` verts / `18.31 MiB` (-65.6% RAM · 4.7× faster)** |
| **`sharp160-miter2`** | `199,996` | `449,988` | `6.29 MiB` (`6,599,856` B) | **`3.92 ms`** | Automatic bevel fallback when miter exceeds `limit: 2` (**5.6× faster**) |

---

## 4. Linear Scaling from 1K to 200K Points (`pnpm bench:v2`)

```bash
pnpm bench:v2
```

### Screen-Space Billboard (`MeshLineGeometry`, `dynamic: true, needsProgress: false`)

| Point Count | Initial Build | `setPositions(pts, false)` | `setPositions(pts, true)` (+bounds) | Total Buffer Bytes |
|---:|---:|---:|---:|---:|
| **1,000** | `0.053 ms` | `0.009 ms` | `0.010 ms` | `188.0 KB` (`187,988` B) |
| **10,000** | `0.217 ms` | `0.062 ms` | `0.078 ms` | `1.88 MB` (`1,879,988` B) |
| **50,000** | `1.199 ms` | `0.311 ms` | `0.381 ms` | `10.00 MB` (`9,999,976` B) |
| **200,000** | `4.046 ms` | `1.304 ms` | `1.532 ms` | `40.00 MB` (`39,999,976` B) |

### World-Space Surface (`MeshLineSurfaceGeometry`, `frame: 'transport', uvMode: 'distance'`)

| Point Count | Initial Build | `setPositions(pts)` | In-Place Buffer & Index Reuse | Total Buffer Bytes |
|---:|---:|---:|---:|---:|
| **1,000** | `0.273 ms` | `0.173 ms` | `true` | `60.0 KB` (`59,988` B) |
| **10,000** | `0.470 ms` | `0.409 ms` | `true` | `600.0 KB` (`599,988` B) |
| **50,000** | `2.249 ms` | `2.029 ms` | `true` | `3.60 MB` (`3,599,976` B) |

---

## 5. Shader, Picker, Compute, and Native-WebGPU Optimizations

- **Billboard Vertex Shader Projection (`MeshLineNodeMaterial`)**:
  - Projects vertices through `P · (MV · p)` instead of multiplying `P · MV` per vertex, projects the half-width once into NDC (`baseRadiusNdc`) via scalar `cameraProjectionMatrix[1].y`, decodes `joinRole` linearly without branching, and reuses the reversal guard's projected lengths and directions.
- **Lazy Varyings & Shader Deduplication (`MeshLineNodeMaterial` & `MeshLinePicker`)**:
  - Fragment hooks emit only the varyings they actually reference (`lineCoord`-only hooks omit `vProgress` and `uvCoords`; `discardFn( [progress] )` omits `uvCoords`), and lines differing only in uniform values or open/closed topology share compiled `ProgrammableStage` shaders.
  - `MeshLinePicker` strips visual-only fragment options (`gradientColor`, `antialias`, `dashCount`, `colorFn`, `opacityFn`, `discardFn`) so offscreen picking proxies omit unused varyings and share a single compiled shader across pickable lines.
- **Camera-Invariant 3D Fold-Join Policy (`join.fold`)**:
  - Classifies corners by their 3D turn angle so orbiting the camera never causes joins to pop.
  - Across 24 oblique camera poses on helix, wave, and torus-knot test curves, worst-case screen-space miter overshoot dropped from **`31.6 / 14.4 / 10.4 px`** to **`4.8 / 5.7 / 8.2 px`** with `fold: 'geometry'` (default, zero extra varyings or fragment `discard`) and **`≤ 1.6 px`** with `fold: 'exact'` (clip-affine round silhouette), eliminating all `489` notched core pixels on the knot.
- **Read-Only Storage & 2D Projection Column Reads (`MeshLineCompute` & `MeshLineGPUPath`)**:
  - `MeshLineCompute.arcLengthNode()` and `MeshLineGPUPath` bind their vertex-stage storage buffers as `var<storage, read>` instead of `read_write`.
  - `MeshLineGPUPath` projects 2D screen offsets via column reads (`cameraProjectionMatrix[0].xy`, `cameraProjectionMatrix[1].xy`) without 4×4 matrix-vector offset multiplies, and pre-filters smooth segments in `findReversalBreaks` with zero `Math.sqrt` calls.
- **Cooperative Two-Pass GPU Culling (`makio-meshline/gpu-culling`)**:
  - Large chunks (`≥ 256` indices) run a fast visibility + prefix reservation pass followed by a 64-lane workgroup cooperative index copy for coalesced GPU memory reads and writes, while chunks under 256 indices stay on the single-pass path. See the [400K-Point Alpine Pass Culling demo](https://meshline-demo.makio.io/examples/gpu-culling) and [GPU Culling docs](./gpu-culling.md).
- **Point-Centric Indirect GPU Path (`makio-meshline/gpu-path`)**:
  - On the 200,000-point curve in the [200K-Point Line demo](https://meshline-demo.makio.io/examples/gpu-path), the local dyadic simplification oracle selects `1,646` of `199,999` segments, cutting tracked GPU buffers by **65.9%** and mean frame time by **~10%** compared to its full CPU fallback.

