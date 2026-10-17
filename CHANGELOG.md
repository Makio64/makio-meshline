# Changelog

## 2.0.0 - 2026-10-17

### Added
- Add the world-space surface profile for lit roads, tracks, and ribbons, including transport and fixed-up frames, banking, distance UVs, PBR maps, true miter/bevel/round joins, butt/square/round caps, and deterministic reversal splits.
- Add optional native-WebGPU chunk culling for large opaque CPU-built lines and surfaces. Unsupported renderers, cameras, materials, and nested render states retain the complete fail-open draw.
- Expose opt-in asynchronous GPU-culling snapshots with exact visible and culled source-index chunk ranges and aggregate counts.
- Add the experimental point-centric `makio-meshline/gpu-path` entry point for large static open paths, with raw and locally simplified indirect rendering, stable segment records, homogeneous clipping, and a complete CPU fallback.
- Add `MeshLineCompute`, an experimental WebGPU-only storage-buffer curve engine that updates autonomous curve fields with TSL compute, maintains cumulative arc length on the GPU, and renders through the existing MeshLine ribbon material.
- Add partial CPU billboard edits with `setPositionRange()` and public bulk custom-attribute uploads with `setVertexValues()`.
- Add complete vanilla Three.js, React Three Fiber, and Vue starters, plus compact Basic, Surface, and Feature Gallery demos.
- Add a Compute Curves demo with autonomous, follow, and field motion modes, distance-spaced pulses, glowing ribbons, mouse interaction, and live simulation controls.
- Add `storagePositions( buffer, { pointsPerLine, head, toBuffer, morph, closed } )`, a `gpuPositionNode` helper that samples line points straight from a WebGPU storage buffer (with optional ring-buffer `head` indexing and two-buffer `toBuffer` / `morph` blending for GPU contour/isobar transitions), plus `lineCoord` for normalized stroke-silhouette coordinates in TSL hooks.
- Billboard lines no longer spike where a smooth 3D curve turns toward the camera. Such projected folds used to take a screen-space miter of up to the limit (4× the half width) or leave a notch past it. Joins are now classified by the path's own 3D turn, which is camera-invariant, so a corner does not pop while orbiting: authored corners keep crisp miters, and folds are resolved by the new `join.fold` policy.
  - `'geometry'` (default) splits the fold in the vertex stage. It adds no discard or varyings and leaves fill cost unchanged. Measured over 24 camera poses, the worst overshoot fell from 31.6/14.4/10.4 px to 4.8/5.7/8.2 px (helix/wave/knot), bounded by the cap's square corners, and the knot's 489 notched core pixels are gone. The split rows overlap near a fold, which a translucent or additive line shows as a slightly denser cap.
  - `'exact'` clips folds to the exact round silhouette through viewport-independent, clip-affine segment-frame varyings: zero spikes (at most 1.6 px on the same poses), no multisample seams, and no overlap. Authored corners past the limit melt continuously into round instead of splitting. The clip runs at the end of the opacity stage, after derivatives and texture samples, and the picker and its helper keep it. `type: 'round'` implies it and rounds every billboard join.
  - `false` keeps the previous miters.
  - Two-point GPU lines, bevel joins, wireframes (checked whenever the shader builds), and `previousFn`/`nextFn` materials keep the plain shader.
  - `join()` on a built line switches the shader path in place through the new `MeshLineNodeMaterial.setJoin()`, keeping resolution, uniforms and depth state; `antialias()` also keeps the live resolution.
- Add a neighbour-spacing constraint to `MeshLineCompute` with a new `stiffness` option (default `1`). It runs inside the existing per-curve arc-length pass (no extra dispatch), restores each curve's home spacing head to tail with a position-based-dynamics velocity correction and light bend smoothing, and replaces the previous tangled free-point motion with coherent streamers. `stiffness( 0 )` restores independent points.
- Rebuild the GPU Culling demo as a 400K-point braided light-tunnel flythrough with a live visible-triangle ratio, a whole-loop visibility strip from throttled `readCullingSnapshot()` reads, and an in-scene culling on/off baseline toggle.
- Make the Surface Road overpass preset actually cross its own approach on a bridge, and generate deck fascia, hammerhead piers, sun shadows, and a concrete soffit from the built road on every edit.

### Changed
- Derive CPU-path progress and UVs from normalized arc length so gradients, dashes, and hooks remain visually consistent across uneven point sampling. Procedural GPU templates retain parameter-based progress.
- Change `smoothSharpBends` to default to `false`, preserving exact input-to-GPU topology for dynamic updates, custom per-vertex attributes, and framework wrappers. Static sharp polylines can opt back in with `.smoothSharpBends( true )`.
- Keep the regular billboard profile on its compact fixed-strip path while surface and experimental GPU profiles allocate variable topology only for joins, caps, and reversal boundaries that need it.
- Harden finite-input handling, endpoint neighbours, sharp bends, Float32 conversion, buffer reuse, bounds, and 16/32-bit topology promotion across CPU and GPU profiles.
- Make framework wrapper defaults and update semantics match the `MeshLine` facade, including generated positions, safe culling defaults, stable Vue object identity, and explicit rebuild boundaries.
- Speed up world-space surface builds and updates by roughly 40–55% on compact miter/butt roads and 20–30% on bevel and round topology: join frames are computed once into flat buffers from a bounded shared scratch pool, and a non-allocating `hypot3()` replaces variadic `Math.hypot()` in the hot loops. Output is bit-identical on V8.
- Cache unpadded billboard line bounds, so `lineWidth()`, `join()`, and `sizeAttenuation()` refresh padding without rescanning every point (a 200K-point line drops from milliseconds to microseconds), and stream progress/UV/width writes in their own tight passes during `setPositions()`.
- GPU culling compacts large chunks cooperatively: the cull pass only tests visibility and reserves each visible chunk's output range, and a second pass copies every chunk with one 64-lane workgroup so reads and writes coalesce. Chunks under 256 indices keep the single-pass copy, where launching a workgroup per chunk would cost more than it saves.
- Trim the billboard vertex shader: project through `P · (MV · p)` instead of forming `P · MV` per vertex, and reuse the reversal test's projected lengths and directions instead of recomputing two roots and divisions. Rendered output is pixel-identical on WebGPU and WebGL2.
- Laser Heist: hovering a beam lit it instead of erasing another. The alarm values are packed into an interleaved instance buffer, so they are now written with `setInstanceValues()` instead of indexing the backing array. The floor reflection keeps thin beams continuous with 4× MSAA at half resolution on desktop.
- The Basic gallery orbits again.
- Lorenz Trails now pre-fills complete trails and integrates at a fixed rate through a GPU ring buffer: one small dispatch per frame instead of a serial shift pass over every trail point.
- Surface Road edits stay local. Raising, moving, or banking one control used to roll and lift the whole road after it, because the ribbon used a transported frame and the terrain fit then lifted the far controls. The road now uses level `fixed-up` frames, and its planner gives each smooth knot a plan heading that ignores height plus a monotone grade, so the road beside a raised control no longer dips or swings sideways. Tangent widening and arcs are solved per region of tight knots, and the minimum radius limits sideways turning only, so a crest or a distant tight bend no longer reshapes spans the edit never touched. Centre dashes, asphalt grain, and bridge piers are pinned to the controls, so a longer span no longer slides them along the rest of the road. Pier caps now roll and pitch with a banked or sloping deck; they used to roll the opposite way and cut through the road.
- Surface Road keeps its orbit above the horizon, starts with the construction overlay off and the saves panel collapsed, fits portrait screens, and uses a wider fog-blended terrain.
- Remove the Compute Lab, Curl Streams, and Hair Ball prototypes; their techniques are covered by Compute Curves, Lorenz Trails, and Verlet Ropes.
- Rice Field renders and mows on the WebGL2 fallback: its per-instance storage now uses `StorageInstancedBufferAttribute`, which the WebGL2 backend maps to instanced attributes and transform-feedback compute. WebGPU-only demos (Lorenz Trails, Compute Curves) explain the missing capability instead of rendering fragments, and `?webgl` forces the fallback for testing.
- `setPositionRange()` keeps uploading after an edit made before the line's first draw. Three.js creates a buffer from the whole array without clearing its pending update ranges, and range marking skipped the version bump while a range was pending, so every later partial edit stayed on the CPU. Range edits now always bump the version; three still uploads at most once per frame.
- Rework the weakest demos and fold three learning demos into scenes that use the same APIs. Waves is a synthwave sea whose rows share one RGB per point (absorbing Vertex Colors); GPU Instancing is a 150-ring tunnel positioned entirely by `gpuPositionNode()` that recolors wrapping rings with `setInstanceValues()` (absorbing GPU Circle and the instance half of Live Updates); Draw Lines replays each stroke as a colored brush and uploads its colors as one `setVertexValues()` range. The old `v2-updates`, `vertex-colors` and `gpu-circle` routes now open those demos.
- Draw Lines drew only the first dozen of its active lines (its draw range assumed six indices per segment), and wide brush bristles waited at the end of their stroke forever. Both are fixed, and quick flicks get a usable replay duration.
- Follow braids fourteen tapered, additive trails around the leader; Shadows returns to a white room under red, green and blue spotlights, so the dashed rings print colored shadows; Compute Curves colors its spiral from a warm core to a violet rim; Verlet Ropes hangs a fiber-optic curtain whose strands clear the floor instead of crumpling; GPU Path frames its 200K-point curve as an oscilloscope trace; GPU Simplification opens on contour lines; Variable Topology lays its joins, caps, reversal and screen path out as a labeled table. Showcases share an MSAA-preserving bloom helper.
- Verlet Ropes feels lighter and moves smoothly. A brushed rope used to keep 26% of its swing per period and swing every 3.7 s. Frame-rate-independent air drag and stronger gravity now let it keep 60% and swing every 2.6 s, and full-strength links halve the stretch to about 1%. Each frame now advances by its smoothed duration in equal substeps (time-corrected Verlet) instead of a fixed 120 Hz accumulator, which skipped one frame in six on 144 Hz screens. The pointer sweeps across substeps, so fast flicks push ropes continuously. Holding now pins each nearby rope's closest point under the pointer, gathering the strands into a bunch that never stretches past its reach, instead of pulling toward the pointer with a 0.4 s lag. Releasing throws them with the hand's speed.
- Isobars extracts its contours again (the marching-squares edge test compared raw bit values, so cells with both corners above a level emitted no segment) and no longer calls a nonexistent `depthWrite()` builder.
- Multi-line `vertexColors` color every line. Each line read the array from its own first point, so a batch given one RGB per point of every line painted every line with the first line's colors (the Verlet Ropes WebGL2 fallback drew every rope cyan). An array covering every point of the batch is now read from each line's global point start, counted like `setPositionRange()` so a closed loop's seam takes no slot; a shorter array stays a pattern shared by every line.
- `vertexColors()` takes effect on a built line. It used to only store the array, so a swapped array kept the old colors and a line built without colors never gained them. A new array now refreshes the color buffer in place from the line's current points without recompiling the material, and turning colors on or off (`null`) rebuilds the line, as `gradientColor()` and `map()` do.
- `widthCallback()` on a built line keeps points moved with `setPositions()` or `setPositionRange()`. Swapping one callback for another rebuilt the geometry from its build-time points and dropped a usage set by `dynamic()` after build; it now rebuilds from the line's current options. `MeshLineGeometry` likewise keeps in-place `setPositions()` and `setPositionRange()` points as the source for a later partial `buildLine()`.
- After `setPositionRange()`, the facade rebuilds from the geometry's source instead of a copy of its stored lines. Reopening an edited loop with `closed( false )` no longer keeps the seam as a fifth point, a batch that dropped an empty or single-point line keeps its per-line `closed` flags on the right lines, and range edits no longer copy the whole batch on every call.
- Scene fog fades lines placed by `positionFn` or `gpuPositionNode` by their own depth on every supported Three.js. Three r180–r182 took the fog depth from the geometry's template `position`, so every instance of a template got the same fog; r183+ rebuilt the view position per fragment through an inverse projection. The vertex stage now hands fog the view depth in one varying, declared only while the scene has fog and `material.fog` is on.
- Three's position accessors follow lines placed by `positionFn` or `gpuPositionNode`. `positionLocal`, `positionWorld` and the vertex-stage `positionView` used to come from the geometry's template `position` on every Three.js, so clipping planes (hardware clip distances, which Chrome uses on WebGPU and WebGL2) cut every instance where its template sat, `exponentialHeightFogFactor` and hooks reading `positionWorld` saw the template's height, and r180–r182 also clipped in the fragment stage by the template. The material now points them, and `positionPrevious` for motion vectors, at the placed centerline, only in builds that read one of them.
- `MeshLineGPUPath` points the same accessors at the centerline each vertex is stroked from. Its native-WebGPU mesh draws from the point buffer, and its geometry `position` is a single template point, which clipping planes, `positionWorld` readers such as `exponentialHeightFogFactor`, and motion vectors used to see, fetched past the end of its buffer for every vertex but the first. The template is now one instance-rate element, so builds that read an accessor fetch it in bounds; builds that read none compile unchanged.

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
