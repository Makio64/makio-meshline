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
- **Selective Attributes**: Only creates buffers for what's needed (e.g., no 'previous/next' for GPU-driven positions).
- **Instancing**: Smaller footprint & one drawcall + custom behavior by instance.
- **Batching**: Draw multiple lines in one call by passing an array to `lines`.
- **CPU->GPU Fast Updates**: `setPositions()` modifies existing buffers in-place without recreation. Pass `true` as the second argument when movement changes bounds enough for frustum culling to matter.
- **Miter Clamp + Optional Corner Smoothing**: The shader miter is always on (no branch cost, simpler than the old opt-in path). For static sharp polylines, opt into `smoothSharpBends` to split near-hairpin corners on the CPU before they reach the shader. Leave it off for dynamic lines or custom per-vertex attributes that need stable topology.

## Best Practices
- Use Instancing when all your lines have the same number of segments.
- Use `Float32Array` for initial positions to avoid conversions.
- Reuse arrays in hot loops to reduce GC pressure.
- Call `dispose()` on unused lines to free GPU memory.
- For massive repeated lines, combine `gpuPositionNode` with instancing to skip CPU position uploads.
- For picking or hover, set `raycaster.params.Line.firstHitOnly = true` when you only need the nearest hit.
- Test on target devices—WebGPU often yields 2x speedup over WebGL.

Follow these for smooth 120FPS even with thousands of segments! 