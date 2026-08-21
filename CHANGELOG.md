# Changelog

## 2.0.0 - 2026-08-12

### Added
- Add the world-space surface profile for lit roads, tracks, and ribbons, including transport and fixed-up frames, banking, distance UVs, PBR maps, true miter/bevel/round joins, butt/square/round caps, and deterministic reversal splits.
- Add optional native-WebGPU chunk culling for large opaque CPU-built lines and surfaces. Unsupported renderers, cameras, materials, and nested render states retain the complete fail-open draw.
- Expose opt-in asynchronous GPU-culling snapshots with exact visible and culled source-index chunk ranges and aggregate counts.
- Add the experimental point-centric `makio-meshline/gpu-path` entry point for large static open paths, with raw and locally simplified indirect rendering, stable segment records, homogeneous clipping, and a complete CPU fallback.
- Add `MeshLineCompute`, an experimental WebGPU-only storage-buffer curve engine that updates autonomous curve fields with TSL compute, maintains cumulative arc length on the GPU, and renders through the existing MeshLine ribbon material.
- Add partial CPU billboard edits with `setPositionRange()` and public bulk custom-attribute uploads with `setVertexValues()`.
- Add complete vanilla Three.js, React Three Fiber, and Vue starters, plus compact Basic, Surface, and Feature Gallery demos.
- Add a Compute Curves demo with autonomous, follow, and field motion modes, distance-spaced dashes, glowing textured ribbons, mouse interaction, and live simulation controls.

### Changed
- Derive CPU-path progress and UVs from normalized arc length so gradients, dashes, and hooks remain visually consistent across uneven point sampling. Procedural GPU templates retain parameter-based progress.
- Change `smoothSharpBends` to default to `false`, preserving exact input-to-GPU topology for dynamic updates, custom per-vertex attributes, and framework wrappers. Static sharp polylines can opt back in with `.smoothSharpBends( true )`.
- Keep the regular billboard profile on its compact fixed-strip path while surface and experimental GPU profiles allocate variable topology only for joins, caps, and reversal boundaries that need it.
- Harden finite-input handling, endpoint neighbours, sharp bends, Float32 conversion, buffer reuse, bounds, and 16/32-bit topology promotion across CPU and GPU profiles.
- Make framework wrapper defaults and update semantics match the `MeshLine` facade, including generated positions, safe culling defaults, stable Vue object identity, and explicit rebuild boundaries.

### Stability
- The facade, CPU billboard profile, world-space surface profile, framework wrappers, and optional chunk-culling system are supported in 2.0.0.
- `makio-meshline/gpu-path` and GPU simplification remain explicitly experimental in 2.0.0; unsupported profiles retain the complete CPU fallback.
- `MeshLineCompute` remains explicitly experimental and WebGPU-only. Without `WebGPURenderer.compute()`, `step()` warns once and skips simulation; use the regular `MeshLine` API when a WebGL2-compatible path is required.

## 1.4.0
### Added
- Accept documented convenience point inputs consistently for single and multi-line geometry, including `[x, y, z]` tuples, flat numeric XYZ arrays, `Vector2`/`Vector3` points, plain point objects, and `BufferGeometry` sources. These inputs are normalized internally; use `Float32Array` for hot `setPositions()` updates.
- New `MeshLinePickerHelper` — Three.js-style visual helper for `MeshLinePicker`. Renders the picker's wide hit-zone proxies overlaid on the scene with a distinct hue per instance (golden-ratio cosine palette), so you can see what the GPU picker is actually testing against. `extends Group`; usage matches `BoxHelper` / `SkeletonHelper`: `new MeshLinePickerHelper( picker )`, `scene.add( helper )`, `helper.update()` per frame, `helper.setOpacity( 0..1 )`, `helper.rebuild()` after the picker registry changes, `helper.dispose()`. The Laser Heist demo now uses it for a third "picker debug" P-state (replaces the old `D` ID-debug toggle).
- New `picker.lines` getter on `MeshLinePicker` returning a snapshot of the registered MeshLines in registration order.

### Fixed
- Align TypeScript declarations and docs with the public material shadow-node properties and `MeshLinePicker` debug helpers.
- Avoid generating a redundant per-vertex `width` buffer for lines that only use `widthFn`, keeping instanced WebGPU pipelines under the common eight vertex-buffer limit.

## 1.3.2
### Fixed
- Normalize `lineWidth` semantics: with `sizeAttenuation: false`, width is a stable CSS-pixel value; with `sizeAttenuation: true`, width is projected in scene space and attenuates with depth.
- Stabilize GPU-positioned single-segment lines by reusing real endpoint tangents and guarding near-degenerate projected directions, preventing lasers/straight segments from collapsing to very thin ribbons at oblique angles.
- Fix `.opacity()` before `build()` so fluent usage no longer tries to write `.value` onto Three.js's numeric material opacity.

### API
- Support `new MeshLine(options)` directly.
- Expand `.configure()` coverage to include hooks, GPU positions, instancing, optional attributes, and legacy dash aliases.
- Rebuild material/geometry when post-build feature toggles require new uniforms, attributes, or closed-loop topology.

## 1.3.1
### Corner rendering — fixed end to end
- **Uniform thickness at every bend.** Miter extension is now always applied, so the ribbon keeps the same pixel width at straight segments and at corners (a 90° bend previously rendered at ~71% of `lineWidth`). The new shader path uses a non-normalized bisector — no `sqrt`, no branching, single `max`-clamped divide — so runtime cost is actually lower than the old default path.
- **Stable miter at oblique camera angles.** Direction vectors are built from view-space XY instead of post-perspective screen-space, so adjacent vertex bisectors no longer flip sign when the per-vertex `w` divide warps the projection. Eliminates the bowtie ribbon and thickness collapse at steep pitch.
- **Automatic corner smoothing for sharp polylines.** New `smoothSharpBends` geometry option splits any polyline vertex whose interior bend is sharper than ~60° into two cutoff points at a configurable distance `smoothSharpBendsAlpha` (default `0.001` — visually imperceptible but enough to stabilise the shader miter) back along each adjacent segment. This fixes the fundamental screen-space-meshline limitation where a single vertex can't cleanly represent two wildly-diverging segments. Tuning: raise `α` toward `0.05`–`0.1` for a visibly flatter bevel cap; pair with a lower `miterLimit` (e.g. `2`) for clean rendering of very sharp zigzag-style polylines. It shipped enabled in v1; v2 changes the default to preserve exact 1:1 input-to-GPU vertex mapping unless you opt in. Smoothing is skipped when `gpuPositionNode` is used — the CPU polyline is a progress-grid template under GPU-driven positions, not real geometry.

### Breaking
- `useMiterLimit` option is removed; miter is always on. `.join({ type })` retained for back-compat but `type` has no effect — every value renders as miter.

### Added
- `.smoothSharpBends(enabled)` and `.smoothSharpBendsAlpha(alpha)` chainable setters on `MeshLine`, plus matching `smoothSharpBends` / `smoothSharpBendsAlpha` options on `MeshLineConfigureOptions`.
- Zigzag and Snake presets in the Sandbox demo for visually stress-testing corner thickness across sharp and smooth curves; UI toggle + cutoff slider for the smoothing in the Advanced folder.

## 1.3.0
- Add `MeshLinePicker` — GPU pixel-picker that identifies the line and instance under the cursor; works with GPU-positioned, instanced, animated, and hook-driven lines
- Add `docs/picking.md` documenting the picker alongside Three.js `Raycaster` for line interaction
- Add ready-to-run StackBlitz examples for React Three Fiber and Vue
- Add declarative `<MeshLine>` wrapper components for both R3F and Vue, exposing common MeshLine options and TSL hooks as props
- Simplify framework documentation pages
- Add `examples/*` to the pnpm workspace

## 1.2.3
- Fix `alphaMap()` setter not updating the texture uniform correctly after build
- Fix `material.copy()` checking wrong target for optional uniforms and duplicating dpr assignment
- Fix `sineWavePositions()` division by zero when `segments` is 1
- Remove redundant `computeBoundingBox()` call (already called internally by `computeBoundingSphere()`)
- Use zero-copy `subarray()` instead of `slice()` in `toFloat32` for better memory efficiency
- Avoid temporary array allocation in `computeBoundingBox()` loop

## 1.2.2
- Fix dynamic buffer usage hints so `.dynamic()` and explicit `usage()` settings apply correctly on build
- Skip build-time bounding volume computation when `frustumCulled` is disabled
- Align TypeScript definitions and docs with the implemented shadow and join APIs
- Update examples with latest threejs/meshBVH api
- Fix on positionFn not triggering built
- Fix typo in documentation
- Fix safe bisector for near-180° angles preventing NaN in miter direction
- Simplify miter normal calculation by removing highQualityMiter branch

## 1.1.0
- Three.js r181 compatibility
- Improved geometry performance and simplified closed loops handling
- Enhanced attribute auto-detection and `ensureBuilt()` method

## 1.0.5
- Fix TSL "No stack defined for assign operation" error

## 1.0.4
- Add per-vertex RGB colors support
- Update peer dependency to Three.js ^0.180.0

## 1.0.3
- Rename `counters` → `progress` for clearer API
- Fix alphaTest and transparency handling
- Optimize direct attribute access (vSide → aSide)

## 1.0.0
- Initial stable release
- ESM-only package with exports map and TypeScript types
- WebGPU-first MeshLine with TSL hooks, instancing, dashes, gradients, textures
- Helpers: circlePositions, squarePositions, rectanglePositions, sineWavePositions, straightLine, straightLineBetween
- Docs: meshline.makio.io
- Demo: meshline-demo.makio.io
