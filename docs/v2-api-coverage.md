---
description: "Map every Makio MeshLine V2 public entry point and update API to its canonical reference and the demo that exercises it."
---

# V2 API and Demo Coverage

Use this page as the index for the V2 public surface. The reference link is the canonical contract; the demo link shows the closest runnable example. “Facade exercised” means the demo uses `MeshLine`, which creates the low-level class internally. “Reference only” identifies an API that is documented but does not yet have a dedicated live demo.

The regular `MeshLine` façade and surface profile support the WebGPU and WebGL2 renderers. The root `MeshLineCompute` export requires WebGPU compute support and has no WebGL2 simulation fallback. The optional `gpu-culling` and `gpu-path` entries require native WebGPU; their demos report the complete fallback when those features are unavailable. Append `?webgl` to any demo URL to force the WebGL2 backend.

## Root package exports

| Export | Canonical reference | Runnable coverage | Coverage note |
| --- | --- | --- | --- |
| `MeshLine` (named and default) | [MeshLine](./meshline.md) | [Style Gallery](https://meshline-demo.makio.io/examples/basic), [Playground](https://meshline-demo.makio.io/examples/sandbox) | Preferred entry point for screen lines and surfaces. |
| `MeshLineCompute` | [MeshLineCompute](./meshline-compute.md) | [Compute Curves](https://meshline-demo.makio.io/examples/compute-curves) | Experimental WebGPU-only storage-buffer simulation façade; regular `MeshLine` remains the cross-backend path. |
| `MeshLineGeometry` | [MeshLineGeometry](./meshline-geometry.md) | [Waves](https://meshline-demo.makio.io/examples/waves), [Draw & Trail](https://meshline-demo.makio.io/examples/drawlines) | Facade exercised; use the class directly only for low-level composition. |
| `MeshLineNodeMaterial` | [MeshLineNodeMaterial](./meshline-material.md) | [Style Gallery](https://meshline-demo.makio.io/examples/basic), [Metallic Tube](https://meshline-demo.makio.io/examples/metallic-tube), [Shadows](https://meshline-demo.makio.io/examples/shadow) | Facade exercised across color, gradient, dash, maps, opacity, analytic `antialias`, 3D tube shadow receiving, and TSL hooks (`widthFn`, `gradientFn`, `opacityFn`, `dashFn`, `uvFn`, `discardFn`, `normalFn`, `fragmentColorFn`). |
| `MeshLineSurfaceGeometry` | [Surface low-level API](./surface.md#low-level-class-api) | [Surface Studio](https://meshline-demo.makio.io/examples/surface), [Joins & Caps](https://meshline-demo.makio.io/examples/variable-topology) | Facade exercised; the topology gallery covers joins, caps, and reversals. |
| `MeshLineSurfaceNodeMaterial` | [Surface low-level API](./surface.md#low-level-class-api) | [Surface Studio](https://meshline-demo.makio.io/examples/surface), [Road Editor](https://meshline-demo.makio.io/examples/surface-road) | Facade exercised with lighting, PBR maps, roughness, and metalness. |
| `MeshLinePicker` | [GPU Picking](./picking.md) | [Laser Heist](https://meshline-demo.makio.io/examples/laser-heist) | Exercises instanced, GPU-positioned lines that CPU raycasting cannot resolve. |
| `MeshLinePickerHelper` | [Picker debug helper](./picking.md) | [Laser Heist](https://meshline-demo.makio.io/examples/laser-heist) | The `picker-debug` mode visualizes the pick pass. |
| `lineCoord` | [Stroke coordinate](./meshline-material.md#linecoord) | [Metallic Tube](https://meshline-demo.makio.io/examples/metallic-tube), [Style Gallery](https://meshline-demo.makio.io/examples/basic) | Normalized cross-section coordinate for TSL hooks; the tube normal and the gallery's rim glow are built from `lineCoord.y`. |
| `circlePositions` | [Position helpers](./helpers.md) | [Style Gallery](https://meshline-demo.makio.io/examples/basic), [Shadows](https://meshline-demo.makio.io/examples/shadow) | Directly exercised. |
| `squarePositions` | [Position helpers](./helpers.md) | [Playground](https://meshline-demo.makio.io/examples/sandbox) | Select the square shape. |
| `rectanglePositions` | [Position helpers](./helpers.md) | [Rice Field](https://meshline-demo.makio.io/examples/ricefield) | Used for the water-border paths. |
| `sineWavePositions` | [Position helpers](./helpers.md) | [Playground](https://meshline-demo.makio.io/examples/sandbox) | Select the sine-wave shape. |
| `straightLine` | [Position helpers](./helpers.md) | [Playground](https://meshline-demo.makio.io/examples/sandbox) | Select the straight-line shape. |
| `storagePositions` | [Position helpers](./helpers.md) | [Lorenz Attractor](https://meshline-demo.makio.io/examples/lorenz-trails), [Isobars](https://meshline-demo.makio.io/examples/isobars), [Verlet Ropes](https://meshline-demo.makio.io/examples/verlet-ropes) | WebGPU storage-buffer `gpuPositionNode`, with optional ring-buffer trails, closed loops, and dual-buffer morphing. |
| `straightLineBetween` | [Position helpers](./helpers.md) | [V2 Benchmarks](./benchmarks.md) | Used for grid rails and benchmark bars; copy-paste examples cover tuples and Three.js vectors. |

## Stable-layout update & styling APIs

These methods update or configure an existing `MeshLine`.

| Method | Best use | Reference | Runnable coverage |
| --- | --- | --- | --- |
| `setPositions(points, updateBounding?)` | Replace all point data while reusing compatible buffers. | [Updating geometry efficiently](./meshline.md#updating-geometry-efficiently) | [Waves](https://meshline-demo.makio.io/examples/waves), [Road Editor](https://meshline-demo.makio.io/examples/surface-road) |
| `setPositionRange(points, startPoint, options?)` | Patch one stable CPU-billboard span and upload its neighbor halo. | [MeshLineGeometry range updates](./meshline-geometry.md#setpositionrange) | [Draw & Trail](https://meshline-demo.makio.io/examples/drawlines) patches every active stroke follower each frame; surfaces and smoothed topology must use `setPositions()`. |
| `addVertexAttribute(name, components?)` / `addVertexAttributes(layout)` / `setVertexValues(name, values, startVertex?)` | Allocate separate or portable packed custom per-vertex data and bulk-update it. | [Vertex attributes](./meshline.md#vertex-attributes) | [Draw & Trail](https://meshline-demo.makio.io/examples/drawlines), [Flying Baguettes](https://meshline-demo.makio.io/examples/baguettes) |
| `addInstanceAttribute(name, components?)` / `addInstanceAttributes(layout)` / `setInstanceValues(name, values, startInstance?)` | Allocate separate or portable packed custom per-instance data and bulk-update it. | [Instance management](./meshline.md#instance-management) | [Ring Tunnel](https://meshline-demo.makio.io/examples/gpu-instance) rewrites only the rings that wrap each frame with post-upload bulk writes. |
| `getVertexBufferUsage(options?)` / `validateVertexBufferBudget(options?)` | Inspect or enforce the eight-buffer portable WebGPU target before pipeline creation. | [Instance management](./meshline.md#instance-management) | API regression coverage validates separate and interleaved vertex/instance layouts. |
| `setInstanceValue(name, index, value)` | Make an occasional scalar instance edit. | [Instance management](./meshline.md#instance-management) | Reference only; [Ring Tunnel](https://meshline-demo.makio.io/examples/gpu-instance) uses the bulk `setInstanceValues()` form. |
| `join(options)` / `miterLimit(limit)` / `cap(options)` | Configure miter/bevel/round joins, 3D fold protection (`fold: 'geometry' \| 'exact'`), in-place miter limit updates, and surface/GPU caps. | [MeshLine advanced options](./meshline.md) | [Joins & Caps](https://meshline-demo.makio.io/examples/variable-topology), [Metallic Tube](https://meshline-demo.makio.io/examples/metallic-tube) |
| `shadow(enabled, receiveShadow?)` / `setReceiveShadow(enabled)` | Enable shadow casting and 3D cylindrical/surface shadow receiving. | [MeshLine shadow options](./meshline.md#shadow) | [Shadows](https://meshline-demo.makio.io/examples/shadow), [Bamboooo](https://meshline-demo.makio.io/examples/bamboooo), [Road Editor](https://meshline-demo.makio.io/examples/surface-road) |
| `antialias(enabled?)` | Enable analytic 1-device-pixel edge antialiasing for non-MSAA or sub-pixel strokes. | [Antialiasing](./meshline-material.md#antialiasing) | [Playground](https://meshline-demo.makio.io/examples/sandbox) |

[Draw & Trail](https://meshline-demo.makio.io/examples/drawlines) also uploads each new stroke's colors as one contiguous `setVertexValues()` range, so the update APIs are visible in a running scene rather than a diagram.

## V2 profiles and optional entry points

| Capability | Import / entry | Canonical reference | Runnable coverage |
| --- | --- | --- | --- |
| World-space road/ribbon surfaces | `MeshLine` or the two root surface classes | [World-Space Surfaces](./surface.md) | [Surface Studio](https://meshline-demo.makio.io/examples/surface), [Road Editor](https://meshline-demo.makio.io/examples/surface-road), [Joins & Caps](https://meshline-demo.makio.io/examples/variable-topology) |
| Experimental WebGPU compute curves | root `MeshLineCompute` export | [MeshLineCompute](./meshline-compute.md) | [Compute Curves](https://meshline-demo.makio.io/examples/compute-curves) |
| Native-WebGPU chunk culling | `makio-meshline/gpu-culling` | [GPU Culling](./gpu-culling.md) | [Alpine Pass Culling](https://meshline-demo.makio.io/examples/gpu-culling); append `?culling=0` for the unculled baseline. |
| Experimental native-WebGPU point path | `makio-meshline/gpu-path` | [GPU Path](./gpu-path.md) | [200K-Point Line](https://meshline-demo.makio.io/examples/gpu-path), [Joins & Caps](https://meshline-demo.makio.io/examples/variable-topology) |
| GPU picking and debug visualization | root `MeshLinePicker` exports | [GPU Picking](./picking.md) | [Laser Heist](https://meshline-demo.makio.io/examples/laser-heist) |
| React Three Fiber wrapper | root package through a local R3F component | [React Three Fiber](./react-three-fiber.md) | [Standalone R3F example](https://github.com/Makio64/makio-meshline/tree/main/examples/react-three-fiber); the wrapper covers current non-deprecated `MeshLineConfigureOptions` except `autoResize`. |
| Vue 3 & TresJS wrapper | root package through a local Vue component | [Vue](./vue.md) | [Standalone Vue example](https://github.com/Makio64/makio-meshline/tree/main/examples/vue); supports both plain Vue 3 (`:parent`) and TresJS (`<TresCanvas>` `useTres` context & `<TresGroup>` refs). |
| Zero-dependency position helpers & Mini3 geometry bridge | `makio-meshline/positions` and `surfaceGeometry.copyToGeometry()` | [Position helpers](./helpers.md), [World-Space Surfaces](./surface.md#class-specific-members) | Pure `Float32Array` generators work directly with `@makio/mini3/meshline`, and `MeshLineSurfaceGeometry.copyToGeometry()` populates `@makio/mini3` `Geometry` in canonical `position`, `uv`, `normal` order. |

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
