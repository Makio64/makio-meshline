# Changelog

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
- **Automatic corner smoothing for sharp polylines.** New `smoothSharpBends` geometry option (default `true`) splits any polyline vertex whose interior bend is sharper than ~60° into two cutoff points at a configurable distance `smoothSharpBendsAlpha` (default `0.001` — visually imperceptible but enough to stabilise the shader miter) back along each adjacent segment. This fixes the fundamental screen-space-meshline limitation where a single vertex can't cleanly represent two wildly-diverging segments. Tuning: raise `α` toward `0.05`–`0.1` for a visibly flatter bevel cap; pair with a lower `miterLimit` (e.g. `2`) for clean rendering of very sharp zigzag-style polylines. Opt out via `.smoothSharpBends(false)` when exact 1:1 input-to-GPU vertex mapping is needed. Automatically disabled when `gpuPositionNode` is used — the CPU polyline is a progress-grid template under GPU-driven positions, not real geometry.

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
