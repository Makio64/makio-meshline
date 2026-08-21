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
import { circlePositions } from 'makio-meshline'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'
import { onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue'

import MeshLine from './MeshLine.vue' // wrapper from the example

const canvasRef = ref()
const group = shallowRef( null )
const viewport = reactive( { width: 1, height: 1 } )
const points = circlePositions( 64, 3 )
let renderer, scene, camera, controls
let disposed = false

onMounted( init )
onUnmounted( dispose )

async function init() {
  viewport.width = window.innerWidth
  viewport.height = window.innerHeight

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera( 55, viewport.width / viewport.height, 0.1, 100 )
  camera.position.z = 10

  renderer = new THREE.WebGPURenderer( { canvas: canvasRef.value, antialias: true } )
  renderer.setPixelRatio( window.devicePixelRatio )
  renderer.setSize( viewport.width, viewport.height )
  await renderer.init()

  if ( disposed ) return

  controls = new OrbitControls( camera, renderer.domElement )
  controls.enableDamping = true

  group.value = new THREE.Group()
  scene.add( group.value )

  renderer.setAnimationLoop( animate )
  window.addEventListener( 'resize', onWindowResize )
}

function animate( time ) {
  controls.update()
  group.value.rotation.z = time * 0.0003
  renderer.render( scene, camera )
}

function onWindowResize() {
  viewport.width = window.innerWidth
  viewport.height = window.innerHeight

  camera.aspect = viewport.width / viewport.height
  camera.updateProjectionMatrix()
  renderer.setSize( viewport.width, viewport.height )
}

function dispose() {
  disposed = true
  window.removeEventListener( 'resize', onWindowResize )
  renderer?.setAnimationLoop( null )
  controls?.dispose()
  renderer?.dispose()
}
</script>

<template>
  <canvas ref="canvasRef" />
  <MeshLine
    v-if="group"
    :parent="group"
    :points="points"
    :render-width="viewport.width"
    :render-height="viewport.height"
    closed
    :line-width="0.2"
    :color="0xff8800"
    :gradient-color="0xffffff"
  />
</template>
```

## Wrapper Component

The full wrapper source lives in [`examples/vue/src/MeshLine.vue`](https://github.com/Makio64/makio-meshline/blob/main/examples/vue/src/MeshLine.vue). It is a renderless component that attaches a `MeshLine` to the `parent` Object3D you provide, and it also supports an injected `meshline-parent` for provider-style scene setup.

The wrapper accepts either `points` or `lines`, including `BufferGeometry`. It emits `ready` for each instance it creates and exposes `{ line }` via `defineExpose()`. The instance remains stable when ordinary build-time props change: its geometry and material are rebuilt in place instead of replacing the public object. Adding or removing `points`/`lines` creates a fresh instance so the wrapper can switch cleanly between explicit data and `segments`-generated positions. Appearance props such as `lineWidth`, `color`, `opacity`, `map`, and `alphaMap` update live.

Point buffers and option objects are watched by identity. Replace the `points`, `surface`, `join`, `cap`, or `dash` reference to trigger a declarative update. For per-frame edits to the same `Float32Array`, call `setPositions()` on the exposed line instead. This avoids deep reactive traversal of large buffers and Three.js resources such as textures. Pass the renderer's CSS-sized viewport through `renderWidth` and `renderHeight`, as above, so screen-line resolution stays correct after a resize.

At the facade level, imperative `setPositions()`, `setPositionRange()`, and `resize()` values remain current through a direct rebuild of the exposed line. Wrapper-driven rebuilds reapply the current declarative props, so keep those sources synchronized when mixing the two styles. A point- or line-count change removes custom vertex attributes because their layout is no longer valid; recreate and refill them afterward. Adding or removing `points`/`lines` replaces the facade entirely, so reapply imperative-only state from the next `ready` event.

Leave `frustumCulled` undefined to use the facade's safe defaults: ordinary CPU world-width lines are culled, while CSS-pixel-width lines, GPU-generated positions, and arbitrary geometry-deforming `positionFn`, `previousFn`, `nextFn`, `widthFn`, `normalFn`, or `vertexFn` hooks are not. Pass an explicit boolean only when you maintain conservative bounds yourself.

The wrapper covers the current `MeshLineConfigureOptions` surface except `autoResize` and the deprecated `dashCount`, `dashRatio`, and `dashOffset` aliases. Use `renderWidth`/`renderHeight` and the `dash` object instead. Shader hooks, instancing, GPU positions, optional attributes, and geometry-shaping options remain available for screen lines.

## Road and Ribbon Surfaces

Pass a `surface` options object to switch from a camera-facing screen line to a camera-independent, lit ribbon. This addition reuses `THREE`, `scene`, and `group` from the complete starter above:

```vue
<script setup>
const roadCenterline = new Float32Array( [
  -4, 0, -1,
  -2, 0.15, 0.5,
  0, 0, 1,
  2, -0.1, 0.5,
  4, 0, -1,
] )

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

function addRoadLights( scene ) {
  const keyLight = new THREE.DirectionalLight( 0xffffff, 3 )
  keyLight.position.set( 4, 8, 6 )
  scene.add(
    new THREE.HemisphereLight( 0xbfdcff, 0x202028, 2 ),
    keyLight,
  )
}
</script>

<template>
  <MeshLine
    :parent="group"
    :points="roadCenterline"
    :surface="roadSurface"
    :join="roadJoin"
    :cap="roadCap"
    :line-width="0.8"
    :color="0x607080"
  />
</template>
```

Call `addRoadLights( scene )` in `init()` after creating the scene.

`lineWidth` is the full ribbon width in world units. `frame` can be `transport` for a rotation-minimizing 3D frame or `fixed-up` for flatter terrain workflows. `uvMode: 'distance'` advances U by path distance divided by `uvScale`; `stretch` maps the whole path to 0–1. `bank` accepts radians, an array, or a callback. Lit material options such as `roughness`, `metalness`, `normalMap`, `roughnessMap`, `metalnessMap`, and `side` belong inside `surface`.

The `join` object is forwarded as `{ type, limit, segments }`; surface `bevel` and `round` modes emit true wedges/fans, and over-limit miters fall back to a bounded bevel. `join.segments` is a half-turn budget, so shallow arcs use fewer triangles. `cap` accepts `butt`, `square`, `round`, or `{ type, segments }`; round caps use the full semicircle budget. Reversals split into independent capped runs instead of sharing an undefined miter.

The default surface-disabled path (or explicit `:surface="false"`) preserves the existing screen-line behavior. The surface wrapper intentionally covers the common lit-road options; billboard-only dashes, gradients, `sizeAttenuation`, GPU positions, instancing, and custom line-extrusion TSL hooks are not adapted to a surface material. Screen-line hook props remain available. Use the exposed `line` ref or the `ready` event for a custom surface node graph or other low-level work.

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Common Patterns](./common-patterns.md) — cursor trails, dynamic positions, reactive updates
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [API Reference](./api.md) — full API documentation
