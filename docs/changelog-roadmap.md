---
description: "Track Makio MeshLine releases, rendering improvements, roadmap items, and upcoming work across WebGPU, joins, and geometry workflows."
---

# Changelog & Roadmap

A quick look at where Makio MeshLine has been and where it's headed. We're just getting started!

## Roadmap

- **Mid-term**:
  - Make a cool tutorial website
  - Add receiveShadow support
  - Add a static road or track geometry mode with precomputed tangents, normals, arc-length UVs, and explicit join modes (`bevel`, `round`) for cleaner wide lines with much less shader work
- **Long-term**: 
  - Explore more WebGPU performance opportunities
  - Add an optional compute pre-pass for dynamic polylines to resample curves and compute tangents, offsets, join decisions, and arc-length data before rendering
  - Split rendering profiles between a flexible MeshLine material for stylized effects and a lean road material for static extruded paths

## Changelog

- **v1.4.0**: New `MeshLinePickerHelper` (Three.js-style helper that overlays the GPU picker's hit-zones with a distinct hue per instance), new `picker.lines` snapshot getter, aligned point-array input handling, TypeScript declarations, material shadow-node docs, and `smoothSharpBends` now defaults to `false` to preserve stable input topology unless explicitly enabled.
- **v1.3.2**: Normalize `lineWidth` semantics, stabilize GPU-positioned endpoint tangents, fix pre-build `.opacity()`, and expand options-object configuration.
- **v1.3.1**: Corner rendering overhaul — uniform thickness at every bend, stable miter at oblique camera angles, and CPU-side smoothing (`smoothSharpBends`) for very sharp polylines. `useMiterLimit` option removed; miter is always on.
- **v1.3.0**: R3F & Vue StackBlitz examples with declarative `<MeshLine>` wrapper components
- **v1.2.3**: Fixes for `alphaMap()`, `material.copy()`, and `sineWavePositions()`; minor allocation cleanups
- **v1.2.2**: Buffer usage fixes, frustum-culling skip, miter handling for near-180° angles
- **v1.2.0**: Shadow casting (`.shadow()`, `castShadowNode`); Shadow & Bamboo Grove demos
- **v1.1.0**: Three.js r181 support, faster geometry, `ensureBuilt()`
- **v1.0.5**: Fix TSL assign operation error
- **v1.0.4**: Per-vertex RGB colors; Three.js ^0.180.0 peer
- **v1.0.3**: counters→progress rename, alphaTest/transparency fix
- **v1.0.0**: Initial release — TSL, batching, instancing, dashes, gradients, miter, hooks, GPU positions

Full changelog: [CHANGELOG.md](https://github.com/Makio64/makio-meshline/blob/main/CHANGELOG.md)
