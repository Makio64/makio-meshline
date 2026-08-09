---
description: "Performance tips for Makio MeshLine covering instancing, batching, dynamic position updates, GPU positioning, and sharp-corner rendering."
---

# Performance Guide

Makio MeshLine uses TSL core for efficient GPU rendering, supporting both WebGPU and WebGL2 backends. 

The core approach minimizes overhead by generating only necessary vertex attributes and uniforms based on active features, like skipping UVs if no textures are used.

It also supports `Instancing` and optimized CPU batching.

<svg viewBox="0 0 820 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Instancing: 12 draw calls versus 1 draw call" style="max-width:100%;height:auto;display:block;margin:1.5em auto;">
  <defs>
    <marker id="inst-arr-thin" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor" fill-opacity="0.5"/>
    </marker>
    <marker id="inst-arr-fat" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor" fill-opacity="0.7"/>
    </marker>
  </defs>
  <text x="40" y="30" class="inst-label">Without instancing</text>
  <rect x="60" y="50" width="300" height="32" rx="8" class="inst-cpu"/>
  <text x="210" y="71" text-anchor="middle" class="inst-sub">CPU · render loop</text>
  <g>
    <line x1="75"  y1="86" x2="75"  y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="100" y1="86" x2="100" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="125" y1="86" x2="125" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="150" y1="86" x2="150" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="175" y1="86" x2="175" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="200" y1="86" x2="200" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="225" y1="86" x2="225" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="250" y1="86" x2="250" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="275" y1="86" x2="275" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="300" y1="86" x2="300" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="325" y1="86" x2="325" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
    <line x1="350" y1="86" x2="350" y2="180" class="inst-arrow-thin" marker-end="url(#inst-arr-thin)"/>
  </g>
  <rect x="50" y="190" width="320" height="90" rx="10" class="inst-gpu-panel"/>
  <text x="60" y="206" class="inst-sub" style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase">GPU</text>
  <g class="inst-line-small">
    <path d="M 75 230 L 115 230"/><path d="M 145 230 L 185 230"/><path d="M 215 230 L 255 230"/><path d="M 285 230 L 325 230"/>
    <path d="M 75 250 L 115 250"/><path d="M 145 250 L 185 250"/><path d="M 215 250 L 255 250"/><path d="M 285 250 L 325 250"/>
    <path d="M 75 270 L 115 270"/><path d="M 145 270 L 185 270"/><path d="M 215 270 L 255 270"/><path d="M 285 270 L 325 270"/>
  </g>
  <text x="210" y="308" text-anchor="middle" class="inst-metric">12 draw calls · 12 state changes</text>
  <line x1="410" y1="20" x2="410" y2="310" class="inst-divider"/>
  <text x="440" y="30" class="inst-label">With instancing</text>
  <rect x="460" y="50" width="300" height="32" rx="8" class="inst-cpu"/>
  <text x="610" y="71" text-anchor="middle" class="inst-sub">CPU · render loop</text>
  <line x1="610" y1="86" x2="610" y2="180" class="inst-arrow-fat inst-pulse-fat" marker-end="url(#inst-arr-fat)"/>
  <rect x="560" y="122" width="100" height="24" rx="6" class="inst-badge-bg"/>
  <text x="610" y="139" text-anchor="middle" class="inst-badge-text">1× draw · ×12</text>
  <rect x="450" y="190" width="320" height="90" rx="10" class="inst-gpu-panel"/>
  <text x="460" y="206" class="inst-sub" style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase">GPU</text>
  <g class="inst-line-small">
    <path d="M 475 230 L 515 230"/><path d="M 545 230 L 585 230"/><path d="M 615 230 L 655 230"/><path d="M 685 230 L 725 230"/>
    <path d="M 475 250 L 515 250"/><path d="M 545 250 L 585 250"/><path d="M 615 250 L 655 250"/><path d="M 685 250 L 725 250"/>
    <path d="M 475 270 L 515 270"/><path d="M 545 270 L 585 270"/><path d="M 615 270 L 655 270"/><path d="M 685 270 L 725 270"/>
  </g>
  <text x="610" y="308" text-anchor="middle" class="inst-metric">1 draw call · 1 state change</text>
</svg>

## Include Optimizations
- **Selective Attributes**: Only creates buffers for what's needed (for example, no `previous`/`next` for GPU-driven positions and no endpoint buffer for ordinary CPU billboard paths). Procedural positions and position hooks retain vec4 endpoint metadata so neighbouring path samples remain exact.
- **Instancing**: Smaller footprint & one drawcall + custom behavior by instance.
- **Batching**: Draw multiple lines in one call by passing an array to `lines`.
- **CPU->GPU Fast Updates**: `setPositions()` modifies existing buffers in-place without recreation. Pass `true` as the second argument when movement changes bounds enough for frustum culling to matter.
- **Range Updates**: `setPositionRange()` edits a fixed span of a CPU billboard line and marks only that span plus its one-point neighbor halo for upload. Use it for brushes, tails, and local path deformation; surfaces and smoothed topology still need `setPositions()`.
- **Bulk Instance Writes**: Fill the attribute returned by `addInstanceAttribute()` directly before its first draw to avoid a staging copy. After upload, `setInstanceValues()` updates a whole attribute (or contiguous subrange) with one version change instead of one change per instance.
- **Lazy progress data**: The `MeshLine` facade omits the progress attribute and its arc-length pass until gradients, dashes, width callbacks, GPU positions, or hooks actually consume progress. Set `needsProgress: true` when a custom low-level consumer reads it directly.
- **Lean Surface Buffers**: Roads always emit positions and normals. UVs, tangents, progress, and side are added only when maps, normal mapping, or an explicit low-level consumer needs them.
- **Surface topology on demand**: Ordinary miter/butt roads keep the compact two-row strip. Bevel wedges, round fans, caps, and reversal splits allocate extra vertices only when requested or mathematically required. `join.segments` is a half-turn budget and shallow corners automatically use fewer triangles; `cap.segments` controls a full semicircle.
- **Miter Clamp + Optional Corner Smoothing**: The shader miter is always on (no branch cost, simpler than the old opt-in path). For static sharp polylines, opt into `smoothSharpBends` to split near-hairpin corners on the CPU before they reach the shader. Leave it off for dynamic lines or custom per-vertex attributes that need stable topology.
- **Hybrid Culling**: The optional [GPU culling system](./gpu-culling.md) keeps small paths on Three's CPU object test and can compact offscreen chunks of a very large opaque path into one native-WebGPU indirect draw.
- **Point-centric GPU path**: The optional experimental [GPU path](./gpu-path.md) stores source points once and renders one non-indexed indirect draw. Raw mode derives neighbours without a segment buffer or compute dispatch; simplification emits stable records with a 256-lane prefix above 256 chunks. The complete CPU line remains its fail-open reference.
- **GPU topology staging**: Advanced GPU-path records are counted first and written directly into final typed arrays. This avoids transient boxed-number arrays; adapter storage limits and integer products are checked before allocation.

## Best Practices
- Use Instancing when all your lines have the same number of segments.
- Use `Float32Array` for initial positions to avoid conversions.
- Reuse arrays in hot loops to reduce GC pressure.
- For a local edit, reuse a small `Float32Array` and call `line.setPositionRange( patch, startPoint )`. If progress, UV, endpoint metadata, or a width callback depends on arc length, those derived values must still refresh for the affected line.
- For initial data, fill `line.addInstanceAttribute( name, size ).array` before adding the line to the scene. For later bulk edits, call `setInstanceValues()` once. Keep `setInstanceValue()` for occasional edits.
- Call `dispose()` on unused lines to free GPU memory.
- For massive repeated lines, combine `gpuPositionNode` with instancing to skip CPU position uploads.
- For picking or hover, set `raycaster.params.Line.firstHitOnly = true` when you only need the nearest hit.
- Test both backends on target devices. Backend wins depend on the scene, driver, and workload.

## Reproducible V2 CPU Benchmark

Run the repository benchmark on the target machine:

```bash
pnpm bench:v2
```

It reports median screen build/update time, update time with bounds, surface build time, and exact generated buffer bytes at several point counts. Screen and surface numbers are separated because a transported road frame is intentionally more expensive than a camera-facing fixed strip. Treat local results as the decision input; do not infer a compute win merely from moving work off the CPU.

For range-update CPU and upload measurements, run:

```bash
pnpm bench:hotpaths
```

To compare compact road geometry with bevel, round-join, and round-cap topology, run:

```bash
pnpm bench:surface-topology -- 50000 7
```

The command reports median build time, expanded vertex/index counts, and buffer bytes for each policy. Round fans scale linearly with their segment budget, so use the lowest subdivision count that is visually smooth at the target road width and camera distance.

In the 50k-point development benchmark, making the round budget angle-adaptive reduced the round-8 case from 549,982 to 199,996 vertices and from 18.31 MiB to 6.29 MiB (about 66% less geometry storage). The compact cap-only path finished with 100,016 vertices—just 16 beyond miter/butt—and avoided the former duplicated Float64 segment staging pass. Counts and bytes are deterministic; timings remain machine- and load-dependent.

On the V2 development machine, a 128-point edit inside a 200k-point default billboard path changed the position/neighbor upload from 14.4 MB to 9.3 KB and the median CPU update from about 2.1 ms to about 0.003 ms. These are workload and machine measurements, not fixed runtime guarantees.

## GPU LOD break-even

Do not rebuild a camera-dependent LOD list every frame by default. In the 262,144-point stress prototype on an Apple M3 Max, a cached static adaptive list retained 64,409 points (24.6%) and reduced unlocked mean frame time from about 0.594 ms to 0.328 ms. Recomputing three passes on every tiny camera change erased most of that gain; capping refinement to 15 rebuilds per second recovered a small steady moving-camera win, but did not meet the production promotion gate.

Start automatic GPU LOD only around 250k source points and a measured or conservatively predicted retained ratio of 25% or lower. Cache unchanged results, add hysteresis, and require repeated target-device measurements. A candidate should improve median mean frame time by at least 10%, improve p95 by at least 5%, leak no resources, preserve stable segment order, and never exceed its full-detail capacity. The stress demo is a sampled heuristic rather than the tolerance-guaranteed production contract; its numbers demonstrate the point-centric dispatch topology, not a universal threshold.

The production `MeshLineGPUPath` demo is a second, narrower measurement. Its guaranteed local dyadic oracle selected 1,646 of 199,999 segments; the native indirect path reduced tracked buffers by 65.9% and mean frame time by about 10% versus its CPU fallback. Its current GPU timestamp sample was higher despite the overall frame improvement, so promote it per workload only after paired target-device runs rather than from retained count alone.
