---
description: "Use the experimental native-WebGPU point-centric path renderer with stable indirect emission, true joins and caps, homogeneous clipping, optional local-space simplification, and a complete CPU fallback."
---

# GPU Path (experimental)

`MeshLineGPUPath` is the V2 point-centric renderer for very large, static open paths. It stores each source point once and renders one non-indexed indirect draw. The default miter/butt profile keeps the six-vertices-per-segment zero-dispatch path; advanced profiles use compact segment and triangle records for true joins, caps, reversal splits, homogeneous clipping, and projected finite-leg guarding.

Import it from the optional entry point:

```js
import MeshLineGPUPath from 'makio-meshline/gpu-path'

const path = new MeshLineGPUPath( {
	lines: points,
	lineWidth: 0.35,
	color: 0x22d3ee,
	sizeAttenuation: true,
	join: { type: 'round', limit: 4, segments: 8 },
	cap: { type: 'round', segments: 8 },
}, {
	chunkSegments: 128,
	// Advanced topology stays full detail; see the LOD contract below.
	simplify: false,
} )

scene.add( path )
path.resize( renderer.domElement.clientWidth, renderer.domElement.clientHeight )
await path.prepare( renderer, camera )

renderer.setAnimationLoop( () => {
	path.update( camera )
	renderer.render( scene, camera )
} )
```

This entry point requires Three.js r183 or newer. It is deliberately absent from the regular package entry so WebGL2 applications and projects on the wider core peer range do not load WebGPU indirect APIs.

See [V2 API and Demo Coverage](./v2-api-coverage.md) for the matching live demos, query switches, and WebGL2 fallback check.

Call `update( camera )` before each render. It validates the prepared renderer/device and rejects ArrayCamera/WebXR before scene traversal, allowing the complete CPU child to take over safely for that frame.

## Public API Reference

```ts
new MeshLineGPUPath(
	lineOptions?: MeshLineConfigureOptions,
	gpuOptions?: MeshLineGPUPathOptions,
)
```

Every `lineOptions` value is applied to the complete CPU `fallback`. The native path currently accepts one open, non-instanced screen line with ordinary color, width, opacity, attenuation, join, cap, and render-size options. Unsupported line options select that fallback; see [Full-detail fallback](#full-detail-fallback) for the complete feature groups.

### GPU options

| Option | Type | Default | Contract |
| --- | --- | --- | --- |
| `chunkSegments` | `number` | `128` | Segments owned by one chunk. Must be a power of two from 1 through 4096. |
| `simplify` | `boolean \| { localTolerance?: number }` | `false` | Enables experimental dyadic local-space simplification. Advanced join/cap topology stays full detail. |
| `localTolerance` | `number` | `0` | Non-negative object-local tolerance. Top-level alias for `simplify.localTolerance`; the top-level value wins when both are supplied. |
| `variableTopology` | `boolean` | `false` | Opts the default miter/butt profile into triangle records so over-limit miters emit true bevel wedges. Bevel/round joins or square/round caps enable advanced topology independently. |

### Properties

| Property | Type | Meaning |
| --- | --- | --- |
| `isMeshLineGPUPath` | `true` | Runtime type marker. |
| `fallback` | `MeshLine` | Complete CPU child, always retained and made visible for unsupported input, backends, cameras, or failures. |
| `gpuMesh` | `Mesh \| null` | Native-WebGPU draw object after successful preparation; `null` before GPU resources exist. Treat its buffers and material as implementation details. |
| `status` | `MeshLineGPUPathStatus` | Live backend, topology, allocation, and simplification report described below. |

### Methods

| Method | Returns | Contract |
| --- | --- | --- |
| `prepare(renderer, camera?)` | `Promise<boolean>` | Initializes and selects the native path. Resolves `true` when it is active and `false` when the CPU fallback was selected. Safe to call again after renderer/device or source changes. |
| `update(camera?)` | `boolean` | Validates the prepared backend and primary mono camera before a render. Returns whether the native path remains active. |
| `resize(width, height)` | `this` | Updates CSS-sized render resolution used for screen expansion. |
| `setSimplificationTolerance(localTolerance)` | `Promise<this>` | Reclassifies and re-emits an enabled simplified path. In raw mode it only stores the non-negative value. |
| `setPositions(points)` | `Promise<this>` | Replaces the one open source path, updates the CPU fallback, and recreates prepared GPU resources as needed. |
| `dispose()` | `void` | Releases GPU resources and disposes the retained CPU fallback. |

### Status fields

`status` is updated in place, so inspect its fields after `prepare()` and after any update that can choose a fallback.

| Field | Values / meaning |
| --- | --- |
| `enabled`, `active` | Whether native resources are available, and whether the native child is currently selected. |
| `backend` | `'unprepared'`, `'webgpu'`, or `'fallback'`. |
| `reason`, `fallback`, `lastError` | Human-readable selection reason, `'cpu-full-detail' \| null`, and the last captured error. |
| `pointCount`, `segmentCapacity`, `chunkCount` | Current source and allocation counts. |
| `stableOrder` | Always `true`; emitted segments preserve source order. |
| `segmentRecords` | `'derived'` for the raw fast path or `'storage'` when records are materialized. |
| `primitiveRecords` | `'procedural-fixed-stride'` or `'compact-storage'`. |
| `primitiveCapacity`, `primitivesPerSegment` | Candidate-triangle capacity and the fixed-path value `2`; compact advanced streams report `null` for the latter. |
| `prefixScan` | `'none'`, `'serial'`, or `'parallel-256'`. |
| `culling` | Always `false` in this stage. |
| `simplification`, `toleranceSpace`, `toleranceGuaranteed` | Active LOD mode and its exact guarantee. `toleranceSpace` is `'local'` only when simplification runs. |
| `join`, `cap`, `topology` | Resolved style and `'fixed-strip'` or `'variable-triangles'`. |
| `topologySafety`, `topologySafetyReason` | Whether projected joins use the finite-leg guard and its explanation. |
| `reversalSplitting` | `'source-and-projected'` at full detail or `'retained-points-only'` under local simplification. |
| `homogeneousClipping` | Always `true`. |
| `coordinateSystem`, `reversedDepth` | Native clip-space contract and whether reversed depth is active. |

### Unstable test internals

The subpath also exports `_gpuPathInternals` for the repository's deterministic CPU oracles and topology tests. Despite being a module export, it is **unstable and test-only**: its functions, record layouts, and return shapes may change during V2 experimental development without a compatibility migration. Applications should depend on `MeshLineGPUPath`, its documented properties, methods, and `status` instead.

## What the GPU path changes

The regular billboard geometry duplicates each center point for both strip sides and supplies neighbouring positions as vertex attributes. The GPU path instead keeps:

- one packed `vec4` source record per point;
- one `uvec4(previous, a, b, next)` per advanced or simplified segment; default raw mode derives these indices in the vertex shader and allocates no segment buffer;
- for advanced topology, one packed 8-byte `uvec2(typeAndSlot, segment)` record per body triangle and bounded join/cap candidate; geometrically empty candidates are suppressed in the vertex stage;
- compact per-chunk state and error data;
- one four-word non-indexed indirect draw command.

The vertex shader decodes each body or topology triangle, fetches the four source points, and expands it for the active render camera. There is no generated index buffer, no duplicated current/previous/next position storage, no GPU-to-CPU visibility readback, and no `INDEX | STORAGE` warm-up draw.

The GPU mesh's geometry `position` is therefore a single template point. As for lines placed by `positionFn` or `gpuPositionNode` (see [Position Accessors](./meshline-material.md#position-accessors)), builds that read a position accessor (clipping planes through hardware clip distances, a `scene.fogNode` such as `exponentialHeightFogFactor` that reads `positionWorld`, or motion vectors for TRAA and motion blur) get the centerline point each vertex is stroked from instead. Builds that read none compile unchanged.

## Variable joins, caps, and clipping

Pass the normal `lineOptions.join` and `lineOptions.cap` policies to the constructor:

- in variable mode, `miter` uses the projected offset-line intersection while it fits inside `join.limit`, otherwise it emits a bevel wedge;
- `bevel` emits a real outer-corner triangle;
- `round` emits a bounded outer fan controlled by `join.segments`;
- `square` caps extend an untrimmed run endpoint by half the stroke width;
- `round` caps emit a semicircle controlled by `cap.segments` (minimum 2);
- a source or projected reversal terminates both incident bodies instead of sharing an undefined miter.

Before perspective division, previous/body/next centerline intervals are clipped independently against native-WebGPU `w`, near, far, and width-padded XY planes. A join requires both incident intervals and the logical source corner to survive. A boundary created by clipping is never mistaken for a semantic path endpoint, so it does not acquire a cap while crossing the camera or viewport plane.

Fan budgets are capped at 64; larger requests fail open to the complete CPU line instead of compiling an unbounded shader variant. Advanced topology is opt-in and keeps the default raw miter/butt allocation and dispatch counts unchanged.

`miter + butt` is also the untouched fast-path signature. To request true shared miter vertices and a geometric over-limit bevel while retaining butt caps, opt in explicitly:

```js
const path = new MeshLineGPUPath( lineOptions, {
	variableTopology: true,
} )
```

Connected variable-topology bodies share the exact inner offset-line intersection. That inner point is independent of the public outer `join.limit`: an over-limit `miter` bevels only the outside while preserving full width on the inside. For locally non-self-overlapping turns this partitions the two bodies and bevel/round fan exactly once, avoiding the dark transparent quadrant produced by overlapping butt rectangles.

The exact inner intersection is used only while both clipped incident legs have enough projected length to support its setback. This camera-dependent check runs in the advanced vertex path after homogeneous clipping. If either finite leg is too short, each body keeps its own full local half-width while only the join wedge switches to a bounded center pivot. That prevents both the viewport-sized spike and the half-stroke taper that a shared zero offset would create. This also covers ordinary 3D bends that become near-reversals only after projection.

The guard bounds each unsupported join locally; it is not a complete stroke-union algorithm. Fallback regions from adjacent corners can still overlap on very short zigzags, particularly with wide transparent strokes, and the experimental profile does not polygon-union or depth-sort those overlaps. Use longer centerline segments, a smaller width, or opaque rendering when that case is possible.

This distinction is machine-readable: the fast strip reports `status.topologySafety === 'not-required'`, while advanced topology reports `'projected-join-guarded'` and provides `status.topologySafetyReason`. The low-level test internals expose the same projected-join resolver as a pure oracle.

Before allocating raw records, `prepare()` checks every storage buffer against the adapter's `maxStorageBufferBindingSize` and `maxBufferSize`, plus JavaScript and indirect-draw integer capacity. An excessive path/fan combination fails back before building a giant staging array or reaching WebGPU validation.

## Local-space simplification

Simplification is opt-in for the default miter/butt topology. Each fixed chunk evaluates a dyadic hierarchy on the GPU and selects the largest power-of-two stride whose source samples remain within `localTolerance` of their selected local-space chords. Chunk endpoints are always retained, adjacent chunks share one read seam, output stays in source order, and each source segment has exactly one owner.

The guarantee is intentionally narrow:

- it bounds the discrete source samples against selected chords in object-local units;
- it is not a continuous-curve Hausdorff bound;
- it is not a screen-pixel error bound;
- it does not infer curvature between samples.

Projection can turn an innocuous local-space point into a screen-space cusp. For that reason, requesting bevel/round joins or non-butt caps deliberately disables local simplification and reports `simplification: 'disabled-for-variable-topology'`; the GPU path remains active at full detail. A future camera-dependent mandatory-break pass may safely combine both policies.

When simplification was enabled at construction, use `setSimplificationTolerance()` to reclassify and re-emit the stable segment list without uploading the path again. In raw mode it only stores the value and dispatches no compute work:

```js
await path.setSimplificationTolerance( 0.1 )
```

## Full-detail fallback

Every `MeshLineGPUPath` owns a complete ordinary `MeshLine` child. Unsupported input, WebGL2, device changes, compute failures, and explicitly unsupported cameras keep or restore that CPU reference instead of producing a partial or invisible path. That fallback preserves every source segment, color, width, and opacity, but it uses the regular fixed-strip miter/butt visual policy; native-GPU round fans and non-butt screen caps are not emulated on the CPU fallback.

Stage 1 intentionally falls back for:

- multiple or closed lines;
- road/surface, shadow, instanced, mapped, dashed, or hook-driven profiles;
- CPU topology smoothing and wireframe;
- ArrayCamera/WebXR.

Inspect `path.status` after `prepare()` to see the selected backend, active/fallback reason, point and chunk counts, and the exact simplification contract.
`status.topology` distinguishes the zero-record `fixed-strip` path from `variable-triangles`; `primitiveCapacity` exposes the allocated candidate-triangle budget.

## Culling and future stages

The stage-1 GPU path does not yet compose frustum/occlusion culling with simplification. Removing points from one global chain would incorrectly bridge two visible regions across a culled gap. Integrated culling must emit independent owned segment runs and preserve chunk boundary neighbours.

For production chunk culling today, use the separate [GPU culling system](./gpu-culling.md) with an ordinary opaque `MeshLine` or road surface. The V2 follow-up combines chunk visibility, stable segment offsets, dyadic LOD, and one indirect non-indexed draw; Hi-Z occlusion, closed paths, shadows, XR unions, transport-frame roads, and style discontinuities remain explicit later gates.

The [GPU Simplification demo](https://meshline-demo.makio.io/examples/gpu-simplification) is a separate lab with two GPU stages: relax, then simplify.

Relaxation comes first, and it is a filter rather than a subdivision — the point count never changes. Each pass eases every point toward the midpoint of its two neighbours, which is what takes the steps and jitter out of digitised data. A plain Laplacian would shrink a closed ring a little more every pass, so each iteration is a Taubin λ/μ pair: a positive step followed by a slightly larger negative one, giving a low-pass filter with no net shrinkage. Neighbours come from a precomputed table, so open lines pin their endpoints and closed rings wrap across the seam without the shader knowing anything about polyline layout.

Simplification is then textbook Douglas-Peucker, not a sampled hierarchy. Each polyline is split into chunks and every chunk edge is pinned, which is what lets thousands of independent recursions start at once. The interval between two retained points is owned by its left endpoint, and that invocation is the only one allowed to write inside it, so the refinement passes need no atomics and have no races. Each pass finds the farthest point from each open chord, retains it if it exceeds the tolerance, and descends its own left spine up to eight levels before handing the right half to the point it just created; an interval that passes the tolerance test is marked settled and never rescanned. Forty-eight passes run before an exact flush expands anything still unresolved to full detail, so the tolerance is a guarantee rather than a heuristic. A prefix-sum compaction and a gather then produce the emitted polyline for one indirect draw.

Closed rings wrap across their seam. A ring repeats its first point at the end, so clamping neighbours at the run edges would render it as an open stroke with two butt caps stacked on one position — measured at up to 82% of the stroke width left unpainted at a mitered seam. The resolve pass records where each polyline begins and ends in output space and the ribbon wraps across it, which takes that mismatch to exactly zero. Those bounds are written as two separate scalar slots per line rather than one `uvec2`, because writing a single component of a vector in storage compiles to a read-modify-write of the whole vector, and the invocation that owns a line's end would clobber the one that owns its start.

Chunk length is derived from the tolerance rather than fixed, and that detail matters more than it sounds. A pinned edge can never be removed, so a lattice of N segments puts a hard floor of pointCount/N under the result. At a fixed 128 segments the France border bottomed out at 1,231 vertices and the tolerance slider went completely inert above roughly level 68 — every drawn vertex was a lattice position rather than a feature of the shape, which read on screen as persistent small kinks along runs that should have been straight. Long chunks fix that but are expensive at a tight tolerance, where the recursion is deep and one invocation scans a whole chunk. Those two pressures point opposite ways along the slider, so the lattice follows it: 128 segments at a tight tolerance where the floor is irrelevant, up to 4,096 at a loose one where it would otherwise be the entire output. Measured across all four datasets and the whole slider, the result tracks a fully unchunked Douglas-Peucker to within 1.36x, and GPU time stays between 2.7 ms and 5.8 ms.

Running relaxation first pays for itself twice. It removes the noise excursions that force Douglas-Peucker to keep points the shape does not need — on the France dataset, 4 passes take the survivors from about 10,400 to about 2,700 at the same tolerance — and because the recursion is no longer pathologically deep on a staircase, the pass budget converges and the exact flush stops firing, so the GPU result matches the CPU oracle point for point.

Simplification is world-space and camera independent, so the pipeline dispatches once on load and once per control change — nothing re-runs while you orbit. The optional screen-space LOD toggle adds a CSS-pixel error term measured against the live projection and re-dispatches at a capped rate while the camera moves; camera-plane crossings are hard splits so a chord never skips across mixed projection validity. Four datasets ship with it — a digitised France, marching-squares isolines, auto-traced manga line art and raw GPS tracks — each resampled to a large point budget and then deliberately dirtied with drift, jitter and coordinate quantisation. The HUD reports GPU compute time from a timestamp query beside the same relaxation and Douglas-Peucker run on the CPU, and prints the difference in retained points between the two so the port is verified rather than asserted. Query parameters: `?dataset=france|isolines|anime|gps`, `?level=0…100` (0 is lossless), `?relax=0…24`, `?render=ribbons|lines|wireframe`, `?view=original`, `?cameraLod=1`, `?radius=`, `?validate=0` to skip the CPU cross-check, and `?noUI=1`.

The [GPU Path demo](https://meshline-demo.makio.io/examples/gpu-path) uses this public class with 200,000 points. Its on-screen explainer makes the intentionally subtle result explicit: the cyan curve should look unchanged while the point representation and emitted draw geometry change. Use the visible mode controls to compare GPU simplification, the raw full-detail GPU path, and the ordinary CPU baseline; the equivalent query parameters remain `?simplify=0` and `?gpu=0`. For topology profiling, `?topology=variable`, `?topology=bevel`, and `?topology=round` select the full-detail triangle-record path; append `&cap=square` or `&cap=round` to exercise non-butt caps. For the fixed demo path and `localTolerance: 0.012`, the matching CPU oracle selects 1,646 of 199,999 source segments (0.82%). The UI labels that number as an expected diagnostic because the runtime renderer deliberately performs no GPU-to-CPU count readback. On the V2 development machine, the final matched native-GPU run measured raw full detail at 0.437 ms mean frame time and 3.08 MiB of tracked buffers, versus 0.397 ms and 6.26 MiB with simplification (9.1% lower frame time and about 29% lower GPU timestamp, with the hierarchy-memory tradeoff). A separate matched CPU-fallback run used 18.34 MiB. Heap samples were noisy, so the entry remains experimental despite the repeatable frame and memory wins.

For the 200,000-point full-detail `round8 + butt` stress case, packing primitive records from four words to two reduced all tracked GPU buffers from 36.65 MiB to 21.39 MiB (-41.6%). In matched headless runs, mean frame time moved from 10.93 ms to 10.35 ms (-5.3%) and throughput from 95.9 to 102.5 FPS (+6.8%), with zero tracked leaks. GPU timestamp samples were inconsistent across those runs, so frame time and exact resource accounting—not the timestamp delta—are the useful evidence.

The [Variable Topology gallery](https://meshline-demo.makio.io/examples/variable-topology) adds a native-WebGPU round screen path behind the labelled surface join/cap cases and reports the live topology status through `window.__meshLineVariableTopologyMetrics`. Use `?case=projected-cusp&noUI` for the deterministic edge-on regression pose; an optional finite `theta` query value sweeps either side of its projected-reversal transition.
