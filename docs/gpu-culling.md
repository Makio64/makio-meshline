---
description: "Use optional native-WebGPU chunk culling and indirect index compaction for very large Makio MeshLine paths and road surfaces."
---

# GPU Culling

`MeshLineCullingSystem` is an optional native-WebGPU accelerator for very large opaque billboard paths and road surfaces. It divides one packed index stream into spatial chunks, tests their AABBs in compute, compacts visible indices, then submits one indexed indirect draw. Normal rendering keeps visibility on the GPU and performs no JavaScript readback.

Import it from the optional entry point so the regular package remains compatible with older Three.js releases:

```js
import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'

const line = new MeshLine( { lines: hugePath } ).build()
scene.add( line )

const culling = MeshLineCullingSystem.attach( renderer, scene, {
	mode: 'auto',
	chunkSize: 128, // triangles
} )

const handle = culling.add( line )
```

This entry point requires Three.js r183 or newer. The normal `makio-meshline` entry point keeps its wider peer range and does not load the WebGPU indirect APIs.

See [V2 API and Demo Coverage](./v2-api-coverage.md) for the matching live demo, baseline switches, and WebGL2 fallback check.

## Public API Reference

### System options

These options are accepted by both `MeshLineCullingSystem.attach( renderer, scene, options )` and the constructor. `attach()` reuses the live system already associated with the same renderer and scene.

| Option | Type | Default | Contract |
| --- | --- | --- | --- |
| `mode` | `'auto' \| 'webgpu'` | `'auto'` | Auto applies the measured size thresholds; WebGPU mode forces an eligible line onto the native path. |
| `autoUpdate` | `boolean` | `true` | Runs culling from the scene pre-render hook. Set `false` when the engine calls `update(camera)` explicitly. |
| `fallback` | `'draw-all' \| 'cpu'` | `'draw-all'` | Draw-all favors no false negatives; CPU restores Three's object-frustum policy when possible. |
| `chunkSize` | `number` | `128` | Positive integer triangles per spatial chunk. A handle can override it. |
| `maxChunks` | `number` | `65,536` | Positive integer allocation guard per handle. |
| `maxIndices` | `number` | `16,777,216` | Positive integer source-index guard per handle. |
| `minChunks` | `number` | `128` | Non-negative auto-mode threshold. Set to zero only after profiling. |
| `minIndices` | `number` | `1,000,000` | Non-negative auto-mode threshold. Set to zero only after profiling. |

### Per-line handle options

| Option | Type | Default | Contract |
| --- | --- | --- | --- |
| `chunkSize` | `number` | Inherits the system | Positive integer triangle count for this line's chunk plan. |
| `bounds` | `Box3[]`, packed six-float records, or callback | Automatic | Conservative local-space AABBs. Required when shader deformation or instancing cannot be bounded from CPU geometry. |
| `boundsPadding` | `number`, `Vector3`, or array-like XYZ | `0` | Extra local-space padding applied to every chunk AABB. |
| `worldPadding` | `number` | `0` | Extra padding after the object transform. |
| `dynamicBounds` | `boolean` | `false` | Re-evaluates explicit bounds on every update instead of only after relevant source changes. |

The bounds callback receives `{ chunkIndex, indexStart, indexCount, geometry, object }` and returns one `Box3` or six-value array-like AABB.

### System properties and methods

| Property | Type | Meaning |
| --- | --- | --- |
| `renderer`, `scene` | `WebGPURenderer`, `Scene` | Objects owned by this integration. |
| `isNativeWebGPU` | `boolean` | Whether the renderer currently exposes the required native-WebGPU compute path. |
| `backendReason` | `string` | Human-readable backend/fallback explanation. |
| `size` | `number` | Number of currently attached handles. |
| `disposed` | `boolean` | Whether the system has restored its integrations and released resources. |
| `lastError` | `unknown` | Last system-level error, or `null` before an error. |

| Method | Returns | Contract |
| --- | --- | --- |
| `MeshLineCullingSystem.attach(renderer, scene, options?)` | `MeshLineCullingSystem` | Returns the shared live system for a renderer/scene pair. |
| `new MeshLineCullingSystem(renderer, scene, options?)` | `MeshLineCullingSystem` | Creates an independent system. Prefer `attach()` for normal scene integration. |
| `add(line, options?)` | `MeshLineCullingHandle \| null` | Registers one built `MeshLine`; returns `null` after disposal or for an invalid object. |
| `remove(lineOrHandle)` | `void` | Removes either the source line or its handle and restores owned render state. |
| `update(camera)` | `Promise<boolean>` | Prepares the primary mono camera and eligible handles; resolves whether an update ran successfully. |
| `dispose()` | `void` | Removes all handles, restores scene/object callbacks and frustum state, and releases compute resources. |

### Handle properties, methods, and status

| Member | Type / return | Contract |
| --- | --- | --- |
| `line` | `MeshLine` | Registered source object. |
| `enabled`, `active` | `boolean` | Resources are eligible/available; active additionally means warmed and prepared for the latest camera. |
| `chunkCount`, `indexCount` | `number` | Current chunk-plan and source-index totals. |
| `reason`, `lastError` | `string`, `unknown` | Current selection reason and last handle-level error. |
| `status` | `MeshLineCullingStatus` | Snapshot containing `enabled`, `active`, `warmedUp`, `chunkCount`, `indexCount`, `reason`, and `lastError`. |
| `refresh()` | `boolean` | Rebuilds bounds/chunks after topology or index identity changes. Returns whether resources were prepared. |
| `readCullingSnapshot()` | `Promise<MeshLineCullingSnapshot \| null>` | Explicitly reads the exact current GPU result at call time; returns `null` when no native result is active. |
| `remove()` | `void` | Detaches this line and restores its owned state. |

### Snapshot fields

| Field | Meaning |
| --- | --- |
| `camera`, `revision` | Mutable identity of the prepared camera (not a clone) and the call-time result revision. |
| `chunkCount`, `indexCount` | Total source chunk/index counts. |
| `visibleChunkCount`, `culledChunkCount` | Aggregate chunk result. |
| `visibleIndexCount`, `culledIndexCount` | Aggregate source-index result. |
| `visibleChunks`, `culledChunks` | Exact records shaped as `{ chunkIndex, indexStart, indexCount }`. |

## Automatic Policy

`mode: 'auto'` keeps small geometry on Three's CPU object culling. Native WebGPU compaction is selected only when the geometry passes both `minIndices` and `minChunks`; the conservative defaults are 1,000,000 indices and 128 chunks. This avoids paying compute and extra-buffer costs on ordinary lines where profiling showed no reliable win. Override the thresholds only after measuring the actual path, visibility ratio, GPU, and material.

Once a result is prepared, unchanged camera, object, and geometry state reuses the existing indirect buffer. Compute runs again only when an input to visibility changes. Set `mode: 'webgpu'` to force the GPU path during measurement or for a workload whose break-even point is already known.

The first render is intentionally a complete warm-up draw. It makes Three allocate the output buffer with both `INDEX` and `STORAGE` usage before compute writes it. Culling becomes active on a following render.

## Bounds Contract

CPU positions and ordinary world-width lines get automatic chunk bounds. Surface bounds already include the emitted road edges. Bounds are refreshed after same-capacity position updates.

Arbitrary `gpuPositionNode`, position/width/normal/vertex hooks, and facade instancing cannot be bounded exactly from the CPU template. Supply conservative local-space chunk AABBs and any extra displacement:

```js
const handle = culling.add( line, {
	bounds: chunkBoxes,       // Box3[], flat 6-float records, or callback
	boundsPadding: [1, 2, 1],
	worldPadding: 0.5,
	dynamicBounds: true,
} )
```

If topology or buffer capacity changes, culling draws the complete line until the resources are rebuilt:

```js
line.lines( replacementPath )
handle.refresh()
```

## Explicit Updates

The default scene pre-render hook updates the primary camera automatically. An engine with its own render schedule can disable that hook:

```js
const culling = MeshLineCullingSystem.attach( renderer, scene, {
	autoUpdate: false,
} )

await culling.update( camera )
renderer.render( scene, camera )
```

`handle.status` reports whether the path is enabled, warmed, and active, plus the chunk/index counts and any fallback reason.

## Inspecting What Was Culled

The culling handle can explicitly read the latest exact GPU result when you need diagnostics or application-side visibility data:

```js
const snapshot = await handle.readCullingSnapshot()

if ( snapshot ) {
	console.log( `${snapshot.culledChunkCount}/${snapshot.chunkCount} chunks culled` )
	console.table( snapshot.culledChunks )
}
```

Each entry is a source-index-stream range:

```js
{
	chunkIndex: 12,
	indexStart: 4608,
	indexCount: 384,
}
```

`visibleChunks` reports the retained ranges, and the snapshot also includes visible/culled chunk and index counts. These are culling chunks and draw-index offsets, not authored point, segment, object, or instance IDs. A chunk can contain several triangles or segments; its `chunkIndex` remains stable only until `handle.refresh()` rebuilds the chunk plan.

This method is deliberately asynchronous because it copies a storage buffer from the GPU. It returns `null` when no current GPU result is active at call time, including warm-up, fallback, stale-camera, and removed states. Once scheduled, the snapshot keeps the call-time `revision` even if a newer cull runs while the GPU copy is pending. Its `camera` is the mutable camera identity, not a cloned camera state.

The snapshot describes a prepared primary-camera frustum result; a shadow, picker, nested, override-material, or unprepared secondary-camera pass may still draw the complete source geometry. Use readback on demand rather than every frame. Repeated reads of one unchanged revision reuse the completed snapshot. A genuine GPU copy/map failure rejects the promise but does not affect fail-open rendering.

## Correctness and Fallbacks

GPU culling takes ownership of the object's draw gate, so Three's whole-object frustum culling is disabled while it is active. Every unsupported or ambiguous case fails open: the complete source geometry renders instead of disappearing.

Current conservative fallbacks include:

- WebGL2 or unavailable native WebGPU;
- transparent, transmissive, non-depth-writing, grouped, partial-range, or bundled draws;
- ArrayCamera/XR and an unprepared shadow, reflection, picker, or secondary camera;
- non-finite camera, transform, bound, or capacity data;
- shader deformation without explicit conservative bounds;
- topology or index identity changes before `handle.refresh()`.

WebGL2 never waits for a GPU readback. With `fallback: 'cpu'`, small/unsupported objects keep their original Three frustum setting; the default `draw-all` policy favors zero false negatives.

## When It Helps

GPU culling does not make separate objects free: Three must still traverse and encode each draw. It is designed for a single large batched line/road whose many chunks are outside the active frustum. It also allocates source/output index, chunk-bound, and one-flag-per-chunk visibility storage, so a mostly visible or cheap path can be faster without compaction.

Use the [GPU Culling demo](https://meshline-demo.makio.io/examples/gpu-culling) and compare it with `?culling=0`. Measure steady-state frame time, initialization hitch, and buffer bytes on target hardware. Hi-Z occlusion, transparent depth sorting, and per-instance ID compaction remain separate future stages.

In the final 300,000-point development run, warmed culling lowered the GPU timestamp by about 28% and mean frame time by about 4%, while adding 7.46 MiB of tracked buffers. The GPU-work reduction was real, but the frame-time result stayed below the 5% promotion threshold; this is why `auto` remains conservative and why target-hardware profiling matters.

Call `handle.remove()` for one line or `culling.dispose()` for the complete scene integration. Both restore the original geometry state, render callbacks, and CPU frustum setting.
