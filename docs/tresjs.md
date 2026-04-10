---
description: "Use Makio MeshLine with TresJS for wide lines, gradients, dashes, textures, and GPU-driven effects in Vue 3 and Three.js WebGPU."
---

# TresJS (Vue)

Integrate Makio MeshLine into your [TresJS](https://tresjs.org/) Vue 3 project.

::: warning
TresJS WebGPU support is still experimental. Check the [TresJS documentation](https://docs.tresjs.org/) for the latest status on WebGPU renderer support.
:::

## Installation

```bash
pnpm add makio-meshline @tresjs/core three
```

## Basic Usage with `<primitive>`

The simplest approach — create a `MeshLine` instance in a composable and inject it via `<primitive>`:

```vue
<script setup>
import { onMounted, onUnmounted, shallowRef } from 'vue'
import { MeshLine, circlePositions } from 'makio-meshline'

const lineRef = shallowRef()

onMounted( () => {
  const line = new MeshLine()
    .lines( circlePositions( 64, 2 ) )
    .closed( true )
    .lineWidth( 0.1 )
    .color( 0xff8800 )
    .gradientColor( 0xffffff )
    .build()

  lineRef.value = line
} )

onUnmounted( () => {
  lineRef.value?.dispose()
} )
</script>

<template>
  <TresCanvas>
    <TresPerspectiveCamera :position="[0, 0, 10]" />
    <primitive v-if="lineRef" :object="lineRef" />
  </TresCanvas>
</template>
```

## Composable: `useMeshLine`

Create a reusable composable for common patterns:

```js
// composables/useMeshLine.js
import { shallowRef, onUnmounted, watch } from 'vue'
import { MeshLine } from 'makio-meshline'

export function useMeshLine( options = {} ) {
  const line = shallowRef( null )

  function create( opts ) {
    // Dispose previous
    line.value?.dispose()

    const ml = new MeshLine()

    if ( opts.points ) ml.lines( opts.points )
    if ( opts.closed ) ml.closed( opts.closed )
    if ( opts.lineWidth ) ml.lineWidth( opts.lineWidth )
    if ( opts.color != null ) ml.color( opts.color )
    if ( opts.gradientColor ) ml.gradientColor( opts.gradientColor )
    if ( opts.dash ) ml.dash( opts.dash )
    if ( opts.sizeAttenuation != null ) ml.sizeAttenuation( opts.sizeAttenuation )
    if ( opts.transparent || ( opts.opacity != null && opts.opacity < 1 ) ) {
      ml.transparent( true )
      if ( opts.opacity != null ) ml.opacity( opts.opacity )
    }
    if ( opts.map ) ml.map( opts.map )

    ml.build()
    line.value = ml
    return ml
  }

  onUnmounted( () => {
    line.value?.dispose()
  } )

  // Auto-create if options provided
  if ( options.points ) create( options )

  return { line, create }
}
```

Usage:

```vue
<script setup>
import { useMeshLine } from './composables/useMeshLine'
import { circlePositions } from 'makio-meshline'

const { line } = useMeshLine( {
  points: circlePositions( 64, 3 ),
  closed: true,
  lineWidth: 0.2,
  color: 0xff0000,
  gradientColor: 0x0000ff,
} )
</script>

<template>
  <primitive v-if="line" :object="line" />
</template>
```

## Reactive Props

Use Vue `watch` to react to prop changes:

```vue
<script setup>
import { ref, watch, onMounted, onUnmounted, shallowRef } from 'vue'
import { MeshLine, circlePositions } from 'makio-meshline'

const props = defineProps( {
  radius: { type: Number, default: 2 },
  color: { type: Number, default: 0xffffff },
  width: { type: Number, default: 0.1 },
} )

const lineRef = shallowRef()

onMounted( () => {
  lineRef.value = new MeshLine()
    .lines( circlePositions( 64, props.radius ) )
    .closed( true )
    .lineWidth( props.width )
    .color( props.color )
    .build()
} )

// Update color and width reactively (no rebuild needed)
watch( () => props.color, ( val ) => lineRef.value?.color( val ) )
watch( () => props.width, ( val ) => lineRef.value?.lineWidth( val ) )

// Rebuild on radius change (geometry changes)
watch( () => props.radius, ( val ) => {
  lineRef.value?.lines( circlePositions( 64, val ) ).build()
} )

onUnmounted( () => lineRef.value?.dispose() )
</script>

<template>
  <primitive v-if="lineRef" :object="lineRef" />
</template>
```

## Dynamic Positions

Animate positions using TresJS `useRenderLoop`:

```vue
<script setup>
import { onMounted, onUnmounted, shallowRef } from 'vue'
import { useRenderLoop } from '@tresjs/core'
import { MeshLine } from 'makio-meshline'

const lineRef = shallowRef()
const points = new Float32Array( 100 * 3 )

onMounted( () => {
  lineRef.value = new MeshLine()
    .lines( points )
    .lineWidth( 0.1 )
    .color( 0x44aaff )
    .build()
} )

const { onLoop } = useRenderLoop()

onLoop( ( { elapsed } ) => {
  for ( let i = 0; i < 100; i++ ) {
    const x = ( i / 99 - 0.5 ) * 10
    points[i * 3] = x
    points[i * 3 + 1] = Math.sin( x + elapsed * 2 ) * 0.5
    points[i * 3 + 2] = 0
  }
  lineRef.value?.geometry.setPositions( points )
} )

onUnmounted( () => lineRef.value?.dispose() )
</script>

<template>
  <primitive v-if="lineRef" :object="lineRef" />
</template>
```

## TSL Hooks

Apply GPU hooks for custom shader effects:

```vue
<script setup>
import { onMounted, onUnmounted, shallowRef } from 'vue'
import { MeshLine, circlePositions } from 'makio-meshline'
import { Fn, sin, time, vec3, smoothstep } from 'three/tsl'

const lineRef = shallowRef()

onMounted( () => {
  lineRef.value = new MeshLine()
    .lines( circlePositions( 128, 3 ) )
    .closed( true )
    .lineWidth( 0.3 )
    .transparent( true )
    // Pulsating width
    .widthFn( Fn( ( [w, progress] ) =>
      w.mul( sin( time.add( progress.mul( 10 ) ) ).mul( 0.5 ).add( 1 ) )
    ) )
    // Rainbow color
    .colorFn( Fn( ( [color, progress] ) => {
      const h = progress.mul( 6.28 ).add( time )
      return vec3(
        sin( h ).mul( 0.5 ).add( 0.5 ),
        sin( h.add( 2.09 ) ).mul( 0.5 ).add( 0.5 ),
        sin( h.add( 4.18 ) ).mul( 0.5 ).add( 0.5 )
      )
    } ) )
    // Fade ends
    .opacityFn( Fn( ( [alpha, progress] ) =>
      alpha.mul( smoothstep( 0, 0.05, progress ) ).mul( smoothstep( 1, 0.95, progress ) )
    ) )
    .build()
} )

onUnmounted( () => lineRef.value?.dispose() )
</script>

<template>
  <primitive v-if="lineRef" :object="lineRef" />
</template>
```

## Instancing

Render thousands of lines with a single draw call:

```vue
<script setup>
import { onMounted, onUnmounted, shallowRef } from 'vue'
import { MeshLine } from 'makio-meshline'
import { Fn, vec3, cos, sin, time, attribute } from 'three/tsl'

const lineRef = shallowRef()

onMounted( () => {
  const count = 100

  const gpuNode = Fn( ( [progress] ) => {
    const offset = attribute( 'instanceOffset', 'vec3' )
    const radius = attribute( 'instanceRadius', 'float' )
    const angle = progress.mul( Math.PI * 2 ).add( time.negate() )
    return vec3( cos( angle ), sin( angle ), 0 ).mul( radius ).add( offset )
  } )

  const line = new MeshLine()
    .instances( count )
    .segments( 64 )
    .gpuPositionNode( gpuNode )
    .lineWidth( 0.05 )
    .closed( true )
    .build()

  line.addInstanceAttribute( 'instanceOffset', 3 )
  line.addInstanceAttribute( 'instanceRadius', 1 )

  for ( let i = 0; i < count; i++ ) {
    const col = i % 10
    const row = Math.floor( i / 10 )
    line.setInstanceValue( 'instanceOffset', i, [( col - 4.5 ) * 3, ( row - 4.5 ) * 3, 0] )
    line.setInstanceValue( 'instanceRadius', i, 0.5 + col * 0.1 )
  }

  lineRef.value = line
} )

onUnmounted( () => lineRef.value?.dispose() )
</script>

<template>
  <primitive v-if="lineRef" :object="lineRef" />
</template>
```

## Auto-Resize

Handle window resizing automatically:

```js
const line = new MeshLine()
  .lines( myPoints )
  .lineWidth( 0.1 )
  .autoResize( window )
  .build()

// autoResize listens for window resize events and updates resolution.
// Cleanup is handled automatically by dispose().
```

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [Performance](./performance.md) — optimization tips
