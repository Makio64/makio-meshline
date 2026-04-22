---
description: "Learn why Makio MeshLine is a modern THREE.MeshLine alternative for Three.js with TSL, WebGPU, instancing, and GPU-driven workflows."
---

# **Makio MeshLine**

Makio MeshLine is a **TSL‑powered line library for Three.js** that delivers fast, easy to customizable thick lines with modern features made by [Makio64](https://x.com/makio64).

It's built for WebGPURenderer and both Backends (WebGPU & WebGL) 

## Why a new MeshLine?

Back in 2015s, TheSpite released [TheSpite's MeshLine](https://github.com/spite/THREE.MeshLine), it opened up new possibilities for thick, styled lines in Three.js, allowing the creation of new effects & explore new horizons.

With Three.js evolving, there was a need for a modern Meshline version that leverages TSL power and improved the core concept.

`Makio MeshLine` is my vision of it : built to be performant, simple but flexible. It allows creators to focus on ideas rather than implementation details.

[Makio64](https://x.com/makio64) 

## Improvements 

- Modernize the stack: first‑class TSL nodes and WebGPU pipeline
- Push performance: minimal uploads, smart attributes, large indices
- Instancing out of the box
- Expand flexibility: rich node hooks (position, width, color, opacity, dash), CPU or GPU positions, miter limit + automatic sharp-bend smoothing, gradients, textures, dashes
- Simplify usage: a chainable, ergonomic Fluent API
- Handy helpers (`circlePositions`, `straightLine`, etc.)
- Sustain long‑term: ESM‑only, typed, tree‑shakeable

## When to Choose Makio MeshLine

Choose Makio MeshLine when you need a modern Three.js line library that goes beyond the limitations of `THREE.Line` and older MeshLine implementations.

- You need wide or thick lines in Three.js without building custom geometry for every effect.
- You want gradients, dashes, textures, opacity fades, or custom shader logic on the same line system.
- You need WebGPU-ready rendering with TSL hooks, while still supporting WebGL2 through `WebGPURenderer`.
- You want to scale from one interactive line to thousands of instanced lines without rewriting the API.

## Compared with Older MeshLine Workflows

Makio MeshLine keeps the original MeshLine spirit, but it targets the current Three.js rendering model. The main shift is that styling and motion are treated as first-class shader problems through TSL, while the geometry and material only allocate what the current line actually needs.

That makes it a strong fit if you are searching for a `THREE.MeshLine` replacement, a Three.js wide-line renderer, or a WebGPU-friendly line library for creative coding and motion design.

## Thanks

A big shout-out to the community, [@Floz](https://x.com/florianzumbrunn) for constant support, [MrDoob](https://x.com/mrdoob) for his feedbacks, [Sunag](https://x.com/sea3dformat) for making & improving TSL everyday,  [Samsyyyy](https://x.com/Samsyyyy) for early feedbacks, to [TheSpite](https://x.com/thespite) for pioneering MeshLine & all my Threejs friends!

## More about Lines

- [Matt DesLauriers](https://github.com/mattdesl)'s [`drawing-lines-is-hard`](https://mattdesl.svbtle.com/drawing-lines-is-hard)
- [Nathan Gordon](https://x.com/gordonnl)'s [`crafting-stylised-mouse-trails-with-ogl`](https://tympanus.net/codrops/2019/09/24/crafting-stylised-mouse-trails-with-ogl/)
