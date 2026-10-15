---
description: "Map every Makio MeshLine V2 public entry point and update API to its canonical reference and the demo that exercises it."
---

# V2 API and Demo Coverage

Use this page as the index for the V2 public surface. The reference link is the canonical contract; the demo link shows the closest runnable example. “Facade exercised” means the demo uses `MeshLine`, which creates the low-level class internally. “Reference only” identifies an API that is documented but does not yet have a dedicated live demo.

The regular `MeshLine` façade and surface profile support the WebGPU and WebGL2 renderers. The root `MeshLineCompute` export requires WebGPU compute support and has no WebGL2 simulation fallback. The optional `gpu-culling` and `gpu-path` entries require native WebGPU and Three.js r183 or newer; their demos report the complete fallback when those features are unavailable.

## Root package exports

| Export | Canonical reference | Runnable coverage | Coverage note |
| --- | --- | --- | --- |
| `MeshLine` (named and default) | [MeshLine](./meshline.md) | [Basic](https://meshline-demo.makio.io/examples/basic), [Sandbox](https://meshline-demo.makio.io/examples/sandbox) | Preferred entry point for screen lines and surfaces. |
| `MeshLineCompute` | [MeshLineCompute](./meshline-compute.md) | [Compute Curves](https://meshline-demo.makio.io/examples/compute-curves) | Experimental WebGPU-only storage-buffer simulation façade; regular `MeshLine` remains the cross-backend path. |
| `MeshLineGeometry` | [MeshLineGeometry](./meshline-geometry.md) | [Waves](https://meshline-demo.makio.io/examples/waves), [Follow](https://meshline-demo.makio.io/examples/follow) | Facade exercised; use the class directly only for low-level composition. |
| `MeshLineNodeMaterial` | [MeshLineNodeMaterial](./meshline-material.md) | [Basic](https://meshline-demo.makio.io/examples/basic), [Sandbox](https://meshline-demo.makio.io/examples/sandbox) | Facade exercised across color, gradient, dash, maps, and opacity. |
| `MeshLineSurfaceGeometry` | [Surface low-level API](./surface.md#low-level-class-api) | [Surface](https://meshline-demo.makio.io/examples/surface), [Variable Topology](https://meshline-demo.makio.io/examples/variable-topology) | Facade exercised; the topology gallery covers joins, caps, and reversals. |
| `MeshLineSurfaceNodeMaterial` | [Surface low-level API](./surface.md#low-level-class-api) | [Metallic Tube](https://meshline-demo.makio.io/examples/metallic-tube), [Surface Road](https://meshline-demo.makio.io/examples/surface-road) | Facade exercised with lighting, maps, roughness, and metalness. |
| `MeshLinePicker` | [GPU Picking](./picking.md) | [Laser Heist](https://meshline-demo.makio.io/examples/laser-heist) | Exercises instanced, GPU-positioned lines that CPU raycasting cannot resolve. |
| `MeshLinePickerHelper` | [Picker debug helper](./picking.md) | [Laser Heist](https://meshline-demo.makio.io/examples/laser-heist) | The `picker-debug` mode visualizes the pick pass. |
| `lineCoord` | [Stroke coordinate](./meshline-material.md#linecoord) | [Metallic Tube](https://meshline-demo.makio.io/examples/metallic-tube) | Normalized cross-section coordinate for TSL hooks; the tube normal is built from it. |
| `circlePositions` | [Position helpers](./helpers.md) | [Basic](https://meshline-demo.makio.io/examples/basic) | Directly exercised. |
| `squarePositions` | [Position helpers](./helpers.md) | [Sandbox](https://meshline-demo.makio.io/examples/sandbox) | Select the square shape. |
| `rectanglePositions` | [Position helpers](./helpers.md) | [Rice Field](https://meshline-demo.makio.io/examples/ricefield) | Used for the water-border paths. |
| `sineWavePositions` | [Position helpers](./helpers.md) | [Sandbox](https://meshline-demo.makio.io/examples/sandbox) | Select the sine-wave shape. |
| `straightLine` | [Position helpers](./helpers.md) | [Sandbox](https://meshline-demo.makio.io/examples/sandbox) | Select the straight-line shape. |
| `straightLineBetween` | [Position helpers](./helpers.md) | Reference only | Copy-paste examples cover tuples and Three.js vectors. |

## Stable-layout update APIs

These methods update an existing `MeshLine`; they are not constructor options.

| Method | Best use | Reference | Runnable coverage |
| --- | --- | --- | --- |
| `setPositions(points, updateBounding?)` | Replace all point data while reusing compatible buffers. | [Updating geometry efficiently](./meshline.md#updating-geometry-efficiently) | [Waves](https://meshline-demo.makio.io/examples/waves), [Follow](https://meshline-demo.makio.io/examples/follow), [Draw Lines](https://meshline-demo.makio.io/examples/drawlines) |
| `setPositionRange(points, startPoint, options?)` | Patch one stable CPU-billboard span and upload its neighbor halo. | [MeshLineGeometry range updates](./meshline-geometry.md#setpositionrange) | [Draw Lines](https://meshline-demo.makio.io/examples/drawlines) patches every active stroke follower each frame; surfaces and smoothed topology must use `setPositions()`. |
| `addVertexAttribute(name, components?)` / `addVertexAttributes(layout)` / `setVertexValues(name, values, startVertex?)` | Allocate separate or portable packed custom per-vertex data and bulk-update it. | [Vertex attributes](./meshline.md#vertex-attributes) | [Draw Lines](https://meshline-demo.makio.io/examples/drawlines), [Follow](https://meshline-demo.makio.io/examples/follow), [Flying Baguettes](https://meshline-demo.makio.io/examples/baguettes) |
| `addInstanceAttribute(name, components?)` / `addInstanceAttributes(layout)` / `setInstanceValues(name, values, startInstance?)` | Allocate separate or portable packed custom per-instance data and bulk-update it. | [Instance management](./meshline.md#instance-management) | [GPU Instancing](https://meshline-demo.makio.io/examples/gpu-instance) rewrites only the rings that wrap each frame with post-upload bulk writes. |
| `getVertexBufferUsage(options?)` / `validateVertexBufferBudget(options?)` | Inspect or enforce the eight-buffer portable WebGPU target before pipeline creation. | [Instance management](./meshline.md#instance-management) | API regression coverage validates separate and interleaved vertex/instance layouts. |
| `setInstanceValue(name, index, value)` | Make an occasional scalar instance edit. | [Instance management](./meshline.md#instance-management) | [GPU Instancing](https://meshline-demo.makio.io/examples/gpu-instance) |

[Draw Lines](https://meshline-demo.makio.io/examples/drawlines) also uploads each new stroke's colors as one contiguous `setVertexValues()` range, so the update APIs are visible in a running scene rather than a diagram.

## V2 profiles and optional entry points

| Capability | Import / entry | Canonical reference | Runnable coverage |
| --- | --- | --- | --- |
| World-space road/ribbon surfaces | `MeshLine` or the two root surface classes | [World-Space Surfaces](./surface.md) | [Surface](https://meshline-demo.makio.io/examples/surface), [Surface Road](https://meshline-demo.makio.io/examples/surface-road), [Metallic Tube](https://meshline-demo.makio.io/examples/metallic-tube), [Variable Topology](https://meshline-demo.makio.io/examples/variable-topology) |
| Experimental WebGPU compute curves | root `MeshLineCompute` export | [MeshLineCompute](./meshline-compute.md) | [Compute Curves](https://meshline-demo.makio.io/examples/compute-curves) |
| Native-WebGPU chunk culling | `makio-meshline/gpu-culling` | [GPU Culling](./gpu-culling.md) | [GPU Culling](https://meshline-demo.makio.io/examples/gpu-culling); append `?culling=0` for the unculled baseline. |
| Experimental native-WebGPU point path | `makio-meshline/gpu-path` | [GPU Path](./gpu-path.md) | [GPU Path](https://meshline-demo.makio.io/examples/gpu-path), [Variable Topology](https://meshline-demo.makio.io/examples/variable-topology) |
| GPU picking and debug visualization | root `MeshLinePicker` exports | [GPU Picking](./picking.md) | [Laser Heist](https://meshline-demo.makio.io/examples/laser-heist) |
| React Three Fiber wrapper | root package through a local R3F component | [React Three Fiber](./react-three-fiber.md) | [Standalone R3F example](https://github.com/Makio64/makio-meshline/tree/main/examples/react-three-fiber); the wrapper covers current non-deprecated `MeshLineConfigureOptions` except `autoResize`. |
| Vue wrapper | root package through a local Vue component | [Vue](./vue.md) | [Standalone Vue example](https://github.com/Makio64/makio-meshline/tree/main/examples/vue); the wrapper omits `autoResize` and deprecated scalar dash aliases. |

## GPU Path demo switches

The experimental path demo uses query parameters so the compared workloads remain deterministic:

| Query | Effect |
| --- | --- |
| `?gpu=0` | Force the complete CPU `MeshLine` fallback. |
| `?simplify=0` | Keep the native GPU path but disable local-space simplification. |
| `?topology=variable` | Enable true over-limit miter bevel topology. |
| `?topology=bevel` or `?topology=round` | Select the requested true outer join. |
| `&cap=square` or `&cap=round` | Select a non-butt open-path cap. |

For behavioral changes from V1, start with [Migrate to V2](./v2-migration.md). For the reasoning and compatibility gates behind these profiles, see the [V2 Design Contract](./v2-design.md).
