---
description: "Use Makio MeshLine with Vue 3 for wide screen lines, camera-independent road surfaces, textures, and GPU-driven effects in Three.js WebGPU."
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

The wrapper accepts either `points` or `lines`, emits `ready` with the created instance, exposes `{ line }` via `defineExpose()`, updates positions in place with `setPositions()`, and live-updates appearance props such as `lineWidth`, `color`, `opacity`, `map`, and `alphaMap`. Shader hooks, instancing, GPU positions, optional attributes, and geometry-shaping options remain available for screen lines and trigger a focused rebuild when they change.

## Road and Ribbon Surfaces

Pass a `surface` options object to switch from a camera-facing screen line to a camera-independent, lit ribbon:

```vue
<script setup>
const roadSurface = {
  frame: 'transport',
  up: [0, 1, 0],
  bank: progress => Math.sin( progress * Math.PI ) * 0.08,
  uvMode: 'distance',
  uvScale: 2,
  roughness: 0.95,
  metalness: 0,
}

const roadJoin = {
  type: 'miter',
  limit: 3,
  segments: 8,
}

const roadCap = {
  type: 'round',
  segments: 8,
}
</script>

<template>
  <MeshLine
    :parent="group"
    :points="roadCenterline"
    :surface="roadSurface"
    :join="roadJoin"
    :cap="roadCap"
    :line-width="4"
    :map="roadTexture"
    :color="0xffffff"
  />
</template>
```

`lineWidth` is the full ribbon width in world units. `frame` can be `transport` for a rotation-minimizing 3D frame or `fixed-up` for flatter terrain workflows. `uvMode: 'distance'` advances U by path distance divided by `uvScale`; `stretch` maps the whole path to 0–1. `bank` accepts radians, an array, or a callback. Lit material options such as `roughness`, `metalness`, `normalMap`, `roughnessMap`, `metalnessMap`, and `side` belong inside `surface`.

The `join` object is forwarded as `{ type, limit, segments }`; surface `bevel` and `round` modes emit true wedges/fans, and over-limit miters fall back to a bounded bevel. `join.segments` is a half-turn budget, so shallow arcs use fewer triangles. `cap` accepts `butt`, `square`, `round`, or `{ type, segments }`; round caps use the full semicircle budget. Reversals split into independent capped runs instead of sharing an undefined miter.

The default surface-disabled path (or explicit `:surface="false"`) never calls `.surface()`, preserving the existing screen-line behavior. The surface wrapper intentionally covers the common lit-road options; billboard-only dashes, gradients, `sizeAttenuation`, GPU positions, instancing, and custom line-extrusion TSL hooks are not adapted to a surface material. Screen-line hook props remain available. Use the exposed `line` ref or the `ready` event for a custom surface node graph or other low-level work.

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Common Patterns](./common-patterns.md) — cursor trails, dynamic positions, reactive updates
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [API Reference](./api.md) — full API documentation
