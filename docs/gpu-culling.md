---
description: "Use optional native-WebGPU chunk culling and indirect index compaction for very large Makio MeshLine paths and road surfaces."
---

# GPU Culling

`MeshLineCullingSystem` is an optional native-WebGPU accelerator for very large opaque billboard paths and road surfaces. It divides one packed index stream into spatial chunks, tests their AABBs in compute, compacts visible indices, then submits one indexed indirect draw without reading visibility back to JavaScript.

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

GPU culling does not make separate objects free: Three must still traverse and encode each draw. It is designed for a single large batched line/road whose many chunks are outside the active frustum. It also allocates source/output index and chunk-bound storage, so a mostly visible or cheap path can be faster without compaction.

Use the [GPU Culling demo](https://meshline-demo.makio.io/examples/gpu-culling) and compare it with `?culling=0`. Measure steady-state frame time, initialization hitch, and buffer bytes on target hardware. Hi-Z occlusion, transparent depth sorting, and per-instance ID compaction remain separate future stages.

In the final 300,000-point development run, warmed culling lowered the GPU timestamp by about 28% and mean frame time by about 4%, while adding 7.46 MiB of tracked buffers. The GPU-work reduction was real, but the frame-time result stayed below the 5% promotion threshold; this is why `auto` remains conservative and why target-hardware profiling matters.

Call `handle.remove()` for one line or `culling.dispose()` for the complete scene integration. Both restore the original geometry state, render callbacks, and CPU frustum setting.
