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
import MeshLine from './MeshLine.vue' // see wrapper below

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

Drop this file into your project — it's a renderless component that adds/removes the MeshLine on a Three.js parent object you provide via the `parent` prop:

```vue
<!-- MeshLine.vue -->
<script setup>
import { onMounted, onUnmounted, watch, shallowRef } from 'vue'
import { MeshLine as MeshLineCore } from 'makio-meshline'

const props = defineProps( {
  parent: { type: Object, default: null },
  points: { type: [Array, Float32Array], required: true },
  closed: { type: Boolean, default: false },
  lineWidth: { type: Number, default: 0.1 },
  color: { type: Number, default: 0xffffff },
  gradientColor: { type: Number, default: null },
  dash: { type: Object, default: null },
  map: { type: Object, default: null },
  opacity: { type: Number, default: 1 },
  transparent: { type: Boolean, default: false },
  sizeAttenuation: { type: Boolean, default: true },
  widthFn: { type: Function, default: null },
  colorFn: { type: Function, default: null },
  opacityFn: { type: Function, default: null },
  gradientFn: { type: Function, default: null },
  uvFn: { type: Function, default: null },
  dashFn: { type: Function, default: null },
  positionFn: { type: Function, default: null },
  fragmentColorFn: { type: Function, default: null },
  fragmentAlphaFn: { type: Function, default: null },
  discardFn: { type: Function, default: null },
  vertexFn: { type: Function, default: null },
} )

const emit = defineEmits( ['ready'] )
const lineRef = shallowRef( null )

function buildAndAdd() {
  disposeLine()
  if ( !props.parent ) return

  const line = new MeshLineCore()
    .lines( props.points ).closed( props.closed ).lineWidth( props.lineWidth )
    .color( props.color ).sizeAttenuation( props.sizeAttenuation )

  if ( props.gradientColor != null ) line.gradientColor( props.gradientColor )
  if ( props.dash ) line.dash( props.dash )
  if ( props.map ) line.map( props.map )
  if ( props.transparent || props.opacity < 1 ) line.transparent( true ).opacity( props.opacity )

  if ( props.widthFn ) line.widthFn( props.widthFn )
  if ( props.colorFn ) line.colorFn( props.colorFn )
  if ( props.opacityFn ) line.opacityFn( props.opacityFn )
  if ( props.gradientFn ) line.gradientFn( props.gradientFn )
  if ( props.uvFn ) line.uvFn( props.uvFn )
  if ( props.dashFn ) line.dashFn( props.dashFn )
  if ( props.positionFn ) line.positionFn( props.positionFn )
  if ( props.fragmentColorFn ) line.fragmentColorFn( props.fragmentColorFn )
  if ( props.fragmentAlphaFn ) line.fragmentAlphaFn( props.fragmentAlphaFn )
  if ( props.discardFn ) line.discardFn( props.discardFn )
  if ( props.vertexFn ) line.vertexFn( props.vertexFn )

  line.build()
  props.parent.add( line )
  lineRef.value = line
  emit( 'ready', line )
}

function disposeLine() {
  if ( !lineRef.value ) return
  lineRef.value.parent?.remove( lineRef.value )
  lineRef.value.dispose()
  lineRef.value = null
}

onMounted( buildAndAdd )
onUnmounted( disposeLine )
watch( () => [props.points, props.closed, props.sizeAttenuation], buildAndAdd, { flush: 'post' } )

defineExpose( { line: lineRef } )
</script>

<template><!-- renderless --></template>
```

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Common Patterns](./common-patterns.md) — cursor trails, dynamic positions, reactive updates
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [API Reference](./api.md) — full API documentation
