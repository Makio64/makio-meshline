---
description: "Use the experimental native-WebGPU point-centric path renderer with stable indirect emission, true joins and caps, homogeneous clipping, optional local-space simplification, and a complete CPU fallback."
---

# GPU Path (experimental)

`MeshLineGPUPath` is the V2 point-centric renderer for very large, static open paths. It stores each source point once and renders one non-indexed indirect draw. The default miter/butt profile keeps the six-vertices-per-segment zero-dispatch path; advanced profiles use compact segment and triangle records for true joins, caps, reversal splits, and homogeneous clipping.

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

Call `update( camera )` before each render. It validates the prepared renderer/device and rejects ArrayCamera/WebXR before scene traversal, allowing the complete CPU child to take over safely for that frame.

## What the compute path changes

The regular billboard geometry duplicates each center point for both strip sides and supplies neighbouring positions as vertex attributes. The GPU path instead keeps:

- one packed `vec4` source record per point;
- one `uvec4(previous, a, b, next)` per advanced or simplified segment; default raw mode derives these indices in the vertex shader and allocates no segment buffer;
- for advanced topology, one packed 8-byte `uvec2(typeAndSlot, segment)` record per body triangle and bounded join/cap candidate; geometrically empty candidates are suppressed in the vertex stage;
- compact per-chunk state and error data;
- one four-word non-indexed indirect draw command.

The vertex shader decodes each body or topology triangle, fetches the four source points, and expands it for the active render camera. There is no generated index buffer, no duplicated current/previous/next position storage, no GPU-to-CPU visibility readback, and no `INDEX | STORAGE` warm-up draw.

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

If a stroke is wider than the projected incident segments can support, neighboring exact inner setbacks can cross. That is a self-overlapping stroke-union problem rather than a miter-limit problem. The experimental GPU profile preserves the exact offsets but does not yet polygon-union or depth-sort those self-crossing regions; use longer centerline segments, a smaller width, or opaque rendering when that case is possible.

This distinction is machine-readable: the fast strip reports `status.topologySafety === 'not-required'`, while advanced topology reports `'finite-legs-unverified'` and provides `status.topologySafetyReason`. The low-level test internals also expose a pure support oracle; it is intentionally not run over every point during camera motion.

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

The [GPU Simplification demo](https://meshline-demo.makio.io/examples/gpu-simplification) is a separate stress prototype with 262,144 source points. Its sampled screen/world criterion is marked `toleranceGuaranteed: false`; use `?simplify=0` for the full-detail GPU baseline and `?readback=1` only for a one-time diagnostic retained-count readback.

The [production GPU Path demo](https://meshline-demo.makio.io/examples/gpu-path) uses this public class with 200,000 points. Add `?simplify=0` for the raw GPU path or `?gpu=0` for its ordinary CPU fallback. For topology profiling, `?topology=variable`, `?topology=bevel`, and `?topology=round` select the full-detail triangle-record path; append `&cap=square` or `&cap=round` to exercise non-butt caps. For the demo path and `localTolerance: 0.012`, the matching CPU oracle selects 1,646 of 199,999 source segments (0.82%). On the V2 development machine, the final matched native-GPU run measured raw full detail at 0.437 ms mean frame time and 3.08 MiB of tracked buffers, versus 0.397 ms and 6.26 MiB with simplification (9.1% lower frame time and about 29% lower GPU timestamp, with the hierarchy-memory tradeoff). A separate matched CPU-fallback run used 18.34 MiB. Heap samples were noisy, so the entry remains experimental despite the repeatable frame and memory wins.

For the 200,000-point full-detail `round8 + butt` stress case, packing primitive records from four words to two reduced all tracked GPU buffers from 36.65 MiB to 21.39 MiB (-41.6%). In matched headless runs, mean frame time moved from 10.93 ms to 10.35 ms (-5.3%) and throughput from 95.9 to 102.5 FPS (+6.8%), with zero tracked leaks. GPU timestamp samples were inconsistent across those runs, so frame time and exact resource accounting—not the timestamp delta—are the useful evidence.

The [Variable Topology gallery](https://meshline-demo.makio.io/examples/variable-topology) adds a native-WebGPU round screen path above the wireframed surface join/cap cases and reports the live topology status through `window.__meshLineVariableTopologyMetrics`.
