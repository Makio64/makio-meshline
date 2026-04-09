---
layout: home
description: "Makio MeshLine is a TSL-powered MeshLine library for Three.js with wide lines, gradients, dashes, textures, shadows, GPU positions, and instancing."

hero:
  name: "Makio MeshLine"
  text: "A performant and customizable line solution for Three.js."
  tagline: "TSL-powered lines with gradients, dashes, textures and more."
  actions:
    - theme: brand
      text: What is Makio-Meshline
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

## Demo Video

<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; margin-top: 2em; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
  <video 
    controls
    autoplay
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

## A Modern MeshLine for Three.js

Makio MeshLine is built for the cases where `THREE.Line` is too limited and older MeshLine approaches feel dated. It gives you wide and thick lines for Three.js with gradients, dashes, textures, shadows, GPU-driven positions, and instancing, all wrapped in a small fluent API.

It is designed around Three.js TSL and `WebGPURenderer`, so the same line system works across WebGPU and WebGL2 backends while staying friendly to creative coding, interactive scenes, data visualization, and stylized rendering.

## What You Can Build

- Cursor trails and draw-on-screen tools
- GPU-driven circles, waves, and parametric curves
- Instanced vegetation, ropes, and wire sculptures
- Gradient, dashed, and textured lines for motion design
- Shadow-casting line meshes for stylized environments

## Why It Stands Out

- TSL-powered hooks let you customize position, width, color, opacity, UVs, dashes, and discard logic directly in the shader.
- Instancing and batched lines keep draw calls low when one line turns into hundreds or thousands.
- GPU position nodes let you animate lines without pushing vertex updates from the CPU every frame.
- The API stays small enough to learn quickly, with helpers like `circlePositions`, `squarePositions`, `sineWavePositions`, and `straightLine`.

## Start Here

- Read [Getting Started](./guide.md) for installation and the first line setup.
- Open [Basic Examples](./examples/basic.md) to compare width, dashes, gradients, textures, opacity, and size attenuation side by side.
- Use the [Interactive Sandbox](./examples/sandbox.md) to tune a line visually and export code.
- Browse the [API Reference](./api.md) once you want hooks, joins, helpers, instancing, or GPU positions.

## Feature Snapshot

| Capability | Included |
| --- | --- |
| Wide and thick lines | Yes |
| Gradients and dashed lines | Yes |
| Texture and alpha maps | Yes |
| TSL material hooks | Yes |
| GPU-driven positions | Yes |
| Instancing | Yes |
| Shadow casting | Yes |
| WebGPU and WebGL2 via `WebGPURenderer` | Yes |