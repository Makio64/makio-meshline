---
description: "Track Makio MeshLine releases, rendering improvements, roadmap items, and upcoming work across WebGPU, joins, and geometry workflows."
---

# Changelog & Roadmap

A release-oriented summary of Version 2, its stability boundaries, and the remaining public-release verification steps.

## Version 2.0.0

::: tip Current package line
The publishable manifest, standalone starters, changelog, and documentation now target `2.0.0`. The tagged npm publish and public post-release checks remain operator steps in [RELEASING.md](https://github.com/Makio64/makio-meshline/blob/main/RELEASING.md).
:::

### Main API

- Robust finite screen joins, explicit endpoint/closed metadata, near-plane guards, and normalized arc-length progress.
- Camera-independent road/ribbon surfaces with transport or fixed-up frames, banking, distance UVs, PBR maps, true bevel/round joins and caps, and explicit reversal splits.
- Stable-layout update helpers: `setPositionRange()`, `setVertexValues()`, and `setInstanceValues()`.
- Lazy optional attributes and stricter validation for point data, dimensions, widths, opacity, dashes, joins, caps, and surface construction.
- Safer default frustum behavior for CSS-pixel and shader-positioned lines.

### Experimental WebGPU compute

- The root package exports `MeshLineCompute`, an experimental WebGPU-only façade that keeps positions, velocities, base positions, seeds, and cumulative curve distance in storage buffers.
- `step( renderer, delta )` dispatches separate motion and arc-length passes. Material hooks can sample the updated distance with `arcLengthNode( progress )` for distance-stable dashes, bands, and pulses.
- The [Compute Curves demo](./examples/compute-curves.md) exercises autonomous, follow, and field modes with mouse interaction and glowing textured ribbons.

### Optional native-WebGPU entries

- `makio-meshline/gpu-culling` adds conservative chunk AABB compaction for measured, very large opaque lines and surfaces. It requires Three.js r183+ and fails open when bounds or a render pass are ambiguous.
- `makio-meshline/gpu-path` is an experimental point-centric renderer for one very large static open path. It adds indirect drawing, homogeneous clipping, projected finite-leg guards, bounded center-pivot fallbacks, optional local-space simplification, and a complete CPU `MeshLine` fallback.

The regular `MeshLine` export from the main `makio-meshline` entry remains the preferred API and supports Three.js r180+ through `WebGPURenderer` on WebGPU and WebGL2. Read [Migrating from v1 to V2](./v2-migration.md) for behavior changes and application checks, and the [V2 Design Contract](./v2-design.md) for the geometry guarantees.

### Deliberately not promoted

- The GPU path remains experimental and falls back for multi-line/closed paths, surfaces, shadows, XR, picking, instancing, maps, dashes, and shader-hook profiles.
- Local simplification is not a screen-pixel guarantee and is disabled for advanced GPU topology.
- GPU culling remains opt-in/conservative because its measured development-machine frame-time improvement stayed below the project promotion threshold.
- `MeshLineCompute` remains experimental and outside the public cross-backend geometry contract. It warns and skips simulation when `WebGPURenderer.compute()` is unavailable; regular `MeshLine` remains the WebGPU/WebGL2 path.

## Version 2 release verification

Documentation status:

- [x] Publish a V1-to-V2 migration guide with changed behavior, compatibility ranges, and fallback expectations.
- [x] Separate the main cross-backend API from optional r183+ native-WebGPU entry points.
- [x] Record experimental limitations and link migration, design, performance, and release pages from navigation.
- [x] Finalize the repository `CHANGELOG.md` entry for `2.0.0`.
- [x] Remove prerelease status notices and align the public documentation with `2.0.0`.

Package and verification status:

- [x] Set the final `2.0.0` version in the publishable package manifest.
- [x] Target `^2.0.0` from standalone starters while forcing workspace builds to exercise the current source.
- [x] Synchronize the packaged `src/README.md` with the public feature/status wording.
- [ ] Run `pnpm lint`, `pnpm build`, `pnpm docs:build`, and the standalone vanilla, React Three Fiber, and Vue example builds from a clean checkout.
- [x] Install the packed artifact in isolated consumers and run runtime/declaration smoke tests at the r180 core minimum, r183 optional-entry minimum, and pinned current Three.js version.
- [ ] Run browser render coverage on both `WebGPURenderer` backends used by the compatibility claim.
- [x] Inspect the real npm tarball and smoke-test root, `gpu-culling`, and `gpu-path` package imports through the exports map.
- [x] Keep a non-blocking compatibility canary against the moving Three.js `dev` branch.
- [ ] Confirm optional-entry failures remain visible and fail open on unsupported WebGL2, camera, bounds, and feature profiles.
- [ ] Publish with the intended npm tag, create the matching Git tag/GitHub release, then verify a clean registry install and documentation links.

## Release history

- **v2.0.0**: Arc-length progress, exact-by-default billboard topology, world-space road/ribbon surfaces, partial position updates, hardened bounds and validation, complete framework starters, optional native-WebGPU chunk culling, an experimental point-centric GPU path with CPU fallback, and experimental WebGPU compute curves.
- **v1.4.0**: New `MeshLinePickerHelper` (Three.js-style helper that overlays the GPU picker's hit-zones with a distinct hue per instance), new `picker.lines` snapshot getter, aligned point-array input handling, TypeScript declarations, and material shadow-node docs.
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

## Roadmap

- **Mid-term**:
  - Add `receiveShadow` support.
  - Extend `MeshLineCompute` with neighbour constraints, real texture/audio/depth force integrations, and compute-aware segment picking.
  - Promote the optional GPU path's variable topology after multi-line/closed, shadows, XR, and picking gates.
- **Long-term**:
  - Explore optional compute pre-passes for dynamic polylines only where resampling, tangent generation, or arc-length work produces a measured end-to-end win.
  - Extend the experimental point-centric GPU path with integrated segment-run culling, screen-error LOD, closed/multi-line topology, shadows/XR, and transported road frames.
  - Add advanced PBR surface customization and instancing without coupling it to billboard-only TSL hooks.
  - Explore further WebGPU performance opportunities only where matched benchmarks show a material win.
