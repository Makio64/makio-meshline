---
layout: home
title: "Makio MeshLine – Three.js Lines for WebGPU & TSL"
titleTemplate: false
description: "Wide lines, animated trails, and road surfaces for Three.js. Makio MeshLine brings TSL shaders, instancing, and WebGPU with WebGL2 fallback."

hero:
  name: "Makio MeshLine"
  text: "Wide lines for Three.js."
  tagline: "Style and animate lines, trails, and road surfaces with TSL, WebGPU, and WebGL2."
  actions:
    - theme: brand
      text: Why Makio MeshLine?
      link: /why-makio-meshline
    - theme: alt
      text: Examples
      link: /examples/basic
    - theme: alt
      text: Quickstart
      link: /guide
    - theme: alt
      text: View on GitHub
      link: https://github.com/Makio64/makio-meshline

--- 

## A Modern MeshLine for Three.js

Makio MeshLine is an open-source Three.js line library by [Makio64](https://github.com/Makio64). Create wide lines, animated trails, and world-space road surfaces with gradients, dashes, textures, and shadows through the `MeshLine` API.

Built with Three.js Shading Language (TSL), it runs on `WebGPURenderer` with WebGPU and automatic WebGL2 fallback. Use it in vanilla Three.js, [React Three Fiber](./react-three-fiber.md), or [Vue](./vue.md), with instancing and GPU-driven positions available as your scene grows.

## Demo Video

<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; margin-top: 2em; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
  <video 
    controls
    preload="none"
    poster="/og-wind-tunnel.jpg"
    aria-label="Makio MeshLine demo reel"
    muted
    loop
    playsinline
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;"
  >
    <!-- WebM for modern browsers (best compression) -->
    <source media="(max-width: 768px)" src="/meshline-teaser-mobile.webm" type="video/webm">
    <source src="/meshline-teaser.webm" type="video/webm">
    
    <!-- HEVC/H.265 for iOS/Safari (better compression than H.264) -->
    <source media="(max-width: 768px)" src="/meshline-teaser-mobile-hevc.mp4" type="video/mp4; codecs=hevc">
    <source src="/meshline-teaser-hevc.mp4" type="video/mp4; codecs=hevc">
    
    <!-- H.264 fallback for older browsers -->
    <source media="(max-width: 768px)" src="/meshline-teaser-mobile.mp4" type="video/mp4">
    <source src="/meshline-teaser.mp4" type="video/mp4">
    
    Your browser does not support the video tag.
  </video>
</div> 

## What You Can Build

- Cursor trails and draw-on-screen tools
- GPU-driven circles, waves, and parametric curves
- Instanced vegetation, ropes, and wire sculptures
- Gradient, dashed, and textured lines for motion design
- Shadow-casting and shadow-receiving line meshes for stylized environments
- Camera-independent road, track, and ribbon surfaces with true joins and caps

## Why It Stands Out

- TSL-powered hooks let you customize position, width, color, opacity, UVs, dashes, and discard logic directly in the shader.
- Instancing and batched lines keep draw calls low when one line turns into hundreds or thousands.
- GPU position nodes and `storagePositions()` let you animate trails and morphing contours without pushing vertex updates from the CPU every frame.
- The API stays small enough to learn quickly, with helpers like `circlePositions`, `squarePositions`, `rectanglePositions`, `sineWavePositions`, `straightLine`, and `storagePositions`.

## Start Here

- Read [Getting Started](./guide.md) for installation and the first line setup.
- Start with the [React Three Fiber](./react-three-fiber.md) or [Vue](./vue.md) integration for a framework component and runnable starter.
- Upgrading an existing application? Follow [Migrating from v1 to V2](./v2-migration.md).
- Explore [V2 Benchmarks](./benchmarks.md) for interactive `MeshLine`-rendered performance diagrams.
- Open the [Style Gallery (Basic Example)](./examples/basic.md) to compare common options side by side and find the complete vanilla starter.
- Use the [Interactive Sandbox](./examples/sandbox.md) to tune a line visually and export code.
- Browse the [API Reference](./api.md) once you want hooks, joins, helpers, instancing, or GPU positions.

## Feature Snapshot

| Capability | Included |
| --- | --- |
| Wide and thick lines with analytic edge AA | Yes |
| Gradients and dashed lines | Yes |
| Texture and alpha maps | Yes |
| TSL material hooks + `lineCoord` | Yes |
| GPU-driven positions & storage-buffer trails | Yes |
| Instancing | Yes |
| Shadow casting & receiving (3D tube normals) | Yes |
| World-space road surfaces | Yes |
| Billboard & surface bevel/round joins and caps | Yes |
| WebGPU and WebGL2 via `WebGPURenderer` | Yes |
| Native-WebGPU chunk culling | Optional |
| Point-centric indirect GPU path + screen topology | Experimental |
