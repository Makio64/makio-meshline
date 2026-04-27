---
description: "Use Makio MeshLine with Vue 3 for wide lines, gradients, dashes, textures, and GPU-driven effects in Three.js WebGPU."
---

# Vue

Integrate Makio MeshLine into your Vue 3 project with Three.js WebGPU.

## Installation

```bash
pnpm add makio-meshline three vue
```

## Basic Usage

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Makio64/makio-meshline/tree/main/examples/vue)

The example ships a `<MeshLine>` wrapper so you can write declarative Vue templates. You pass it a `parent` (a Three.js `Object3D` to attach to) and the usual MeshLine options as props:

```vue
<script setup>
import { ref, shallowRef, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three/webgpu'
import { circlePositions } from 'makio-meshline'
import MeshLine from './MeshLine.vue' // wrapper from the example

const canvasRef = ref()
const group = shallowRef( null )
const points = circlePositions( 64, 3 )
let renderer, scene, camera, rafId

onMounted( async () => {
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera( 55, innerWidth / innerHeight, 0.1, 1000 )
  camera.position.z = 10

  renderer = new THREE.WebGPURenderer( { canvas: canvasRef.value, antialias: true } )
  renderer.setSize( innerWidth, innerHeight )
  renderer.setPixelRatio( devicePixelRatio )
  await renderer.init()

  const g = new THREE.Group()
  scene.add( g )
  group.value = g

  const loop = () => {
    g.rotation.z += 0.005
    renderer.render( scene, camera )
    rafId = requestAnimationFrame( loop )
  }
  loop()
} )

onUnmounted( () => {
  cancelAnimationFrame( rafId )
  renderer?.dispose()
} )
</script>

<template>
  <canvas ref="canvasRef" />
  <MeshLine
    v-if="group"
    :parent="group"
    :points="points"
    closed
    :line-width="0.2"
    :color="0xff8800"
    :gradient-color="0xffffff"
  />
</template>
```

## Wrapper Component

The full wrapper source lives in [`examples/vue/src/MeshLine.vue`](https://github.com/Makio64/makio-meshline/blob/main/examples/vue/src/MeshLine.vue). It is a renderless component that attaches a `MeshLine` to the `parent` Object3D you provide, and it also supports an injected `meshline-parent` for provider-style scene setup.

The wrapper accepts either `points` or `lines`, emits `ready` with the created instance, exposes `{ line }` via `defineExpose()`, updates positions in place with `setPositions()`, and live-updates material props such as `lineWidth`, `color`, `opacity`, `gradientColor`, `dash`, `map`, and `alphaMap`. Shader hooks, instancing, GPU positions, optional attributes, and geometry-shaping options are supported as props and trigger a focused rebuild when they change.

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Common Patterns](./common-patterns.md) — cursor trails, dynamic positions, reactive updates
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [API Reference](./api.md) — full API documentation
