---
description: "Track Makio MeshLine releases, rendering improvements, roadmap items, and upcoming work across WebGPU, joins, and geometry workflows."
---

# Changelog & Roadmap

A quick look at where Makio MeshLine has been and where it's headed. We're just getting started!

## Roadmap

- **Mid-term**:
  - Make a cool tutorial website
  - Add receiveShadow support
  - Add a static road or track geometry mode with precomputed tangents, normals, arc-length UVs, and explicit join modes (`miter`, `bevel`, `round`) for cleaner wide lines with much less shader work
  - Align the join API and docs with the implementation by either restoring a dedicated high-quality miter path or replacing it with explicit geometry-driven joins
- **Long-term**: 
  - Explore more WebGPU performance opportunities
  - Add an optional compute pre-pass for dynamic polylines to resample curves and compute tangents, offsets, join decisions, and arc-length data before rendering
  - Split rendering profiles between a flexible MeshLine material for stylized effects and a lean road material for static extruded paths

## Changelog

- **v1.2.2**: Fix dynamic buffer usage hints, skip bounding volume work when `frustumCulled` is disabled, align shadow/join typings and docs, and tighten miter handling for near-180° angles
- **v1.2.0**: Shadow casting support (`.shadow()` method, custom `castShadowNode`), internal refactoring for line position and width calculations, new demos (Shadow, Bamboo Grove)
- **v1.1.0**: Three.js r181 compatibility, geometry performance improvements, `ensureBuilt()` method
- **v1.0.5**: Fix TSL assign operation error
- **v1.0.4**: Per-vertex RGB colors, Three.js ^0.180.0 peer dependency
- **v1.0.3**: Rename counters→progress, fix alphaTest/transparency, vSide→aSide optimization
- **v1.0.0** (Initial Release): Core implementation with TSL, multi-line batching, instancing, dashes, gradients, mitter, hooks, and GPU positions. Built for Three.js r178+.
