---
title: "Why Makio MeshLine? Three.js MeshLine Alternative"
titleTemplate: false
description: "Explore Makio MeshLine for Three.js: wide lines, animated trails, and road surfaces with TSL hooks, instancing, WebGPU, and WebGL2 support."
---

# Why Makio MeshLine?

Makio MeshLine is an open-source **Three.js line library** by [Makio64](https://github.com/Makio64) for wide lines, animated trails, and road surfaces. It combines a fluent `MeshLine` API with Three.js Shading Language (TSL) hooks for custom styling and animation.

It runs on `WebGPURenderer` with both **WebGPU and WebGL2** backends. Get started in [vanilla Three.js](./guide.md), [React Three Fiber](./react-three-fiber.md), or [Vue](./vue.md).

## Why a new MeshLine?

[TheSpite's THREE.MeshLine](https://github.com/spite/THREE.MeshLine) helped establish mesh-based thick lines in Three.js. Native [`THREE.Line` with `LineBasicMaterial`](https://threejs.org/docs/pages/LineBasicMaterial.html) renders one-pixel-wide line primitives in WebGL and WebGPU. Mesh-based lines use triangles to provide adjustable width and a surface for styling.

Makio MeshLine builds around Three.js TSL and node materials, with instancing, GPU-driven positions, and world-space ribbons available through the same API. You can start with a single styled line and add shader hooks or GPU workflows when your scene needs them.

## What It Includes

- TSL hooks for position, width, color, opacity, dashes, and fragment output
- Gradients, texture maps, shadows, joins, and caps
- Instancing, batched lines, reusable dynamic buffers, and GPU-driven positions
- Camera-independent road and ribbon surfaces with banking and PBR materials
- A chainable `MeshLine` API and helpers such as `circlePositions` and `straightLine`
- TypeScript declarations and ESM exports, with Three.js as the only runtime dependency

## When to Choose Makio MeshLine

Choose Makio MeshLine when you want to style and animate mesh-based lines in a Three.js scene using TSL.

- You need wide or thick lines in Three.js without building custom geometry for every effect.
- You want gradients, dashes, textures, opacity fades, or custom shader logic on the same line system.
- You need WebGPU-ready rendering with TSL hooks, while still supporting WebGL2 through `WebGPURenderer`.
- You want to scale from one interactive line to thousands of instanced lines without rewriting the API.

## Which MeshLine Package?

The name MeshLine appears in several Three.js libraries. [spite/THREE.MeshLine](https://github.com/spite/THREE.MeshLine) is the original project, and [pmndrs/meshline](https://github.com/pmndrs/meshline) is a fork published as `meshline`. This documentation covers **`makio-meshline`**, with its own `MeshLine` API built around TSL and `WebGPURenderer`.

For a WebGPU and TSL MeshLine workflow, begin with the [installation and first line](./guide.md), try the [interactive styling sandbox](./examples/sandbox.md), or browse the [MeshLine API](./meshline.md). The [performance guide](./performance.md) explains the tradeoffs between batching, instancing, and dynamic updates.

## Thanks

A big shout-out to the community, [@Floz](https://x.com/florianzumbrunn) for constant support, [MrDoob](https://x.com/mrdoob) for his feedbacks, [Sunag](https://x.com/sea3dformat) for making & improving TSL everyday,  [Samsyyyy](https://x.com/Samsyyyy) for early feedbacks, to [TheSpite](https://x.com/thespite) for pioneering MeshLine & all my Threejs friends!

## More about Lines

- [Matt DesLauriers](https://github.com/mattdesl)'s [`drawing-lines-is-hard`](https://mattdesl.svbtle.com/drawing-lines-is-hard)
- [Nathan Gordon](https://x.com/gordonnl)'s [`crafting-stylised-mouse-trails-with-ogl`](https://tympanus.net/codrops/2019/09/24/crafting-stylised-mouse-trails-with-ogl/)
