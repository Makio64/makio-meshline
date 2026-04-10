---
description: "Use Makio MeshLine with React Three Fiber (R3F) for wide lines, gradients, dashes, textures, and GPU-driven effects in React and Three.js WebGPU."
---

# React Three Fiber

Integrate Makio MeshLine into your [React Three Fiber](https://github.com/pmndrs/react-three-fiber) project.

::: warning
R3F WebGPU support is still experimental. Check the [R3F documentation](https://r3f.docs.pmnd.rs/) for the latest status on WebGPU renderer support.
:::

## Installation

```bash
pnpm add makio-meshline @react-three/fiber three
```

## Basic Usage with `<primitive>`

The simplest approach — create a `MeshLine` instance and pass it as a primitive:

```jsx
import { useRef, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { MeshLine, circlePositions } from 'makio-meshline'

function Circle() {
  const ref = useRef()

  useEffect( () => {
    const line = new MeshLine()
      .lines( circlePositions( 64, 2 ) )
      .closed( true )
      .lineWidth( 0.1 )
      .color( 0xff8800 )
      .gradientColor( 0xffffff )
      .build()

    ref.current.add( line )

    return () => {
      line.dispose()
      ref.current?.remove( line )
    }
  }, [] )

  return <group ref={ref} />
}

export default function App() {
  return (
    <Canvas camera={{ position: [0, 0, 10] }}>
      <Circle />
    </Canvas>
  )
}
```

## Reusable Component

Wrap MeshLine in a reusable component with props:

```jsx
import { useRef, useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { MeshLine } from 'makio-meshline'

function MeshLineComponent({
  points,
  closed = false,
  lineWidth = 0.1,
  color = 0xffffff,
  gradientColor = null,
  dash = null,
  opacity = 1,
  transparent = false,
  sizeAttenuation = true,
  children, // for hooks setup
  ...props
}) {
  const groupRef = useRef()
  const lineRef = useRef()

  useEffect( () => {
    const line = new MeshLine()
      .lines( points )
      .closed( closed )
      .lineWidth( lineWidth )
      .color( color )
      .sizeAttenuation( sizeAttenuation )

    if ( gradientColor ) line.gradientColor( gradientColor )
    if ( dash ) line.dash( dash )
    if ( transparent || opacity < 1 ) line.transparent( true ).opacity( opacity )

    line.build()
    lineRef.current = line
    groupRef.current.add( line )

    return () => {
      line.dispose()
      groupRef.current?.remove( line )
      lineRef.current = null
    }
  }, [points, closed, lineWidth, color, gradientColor, dash, opacity, transparent, sizeAttenuation] )

  return <group ref={groupRef} {...props} />
}
```

Usage:

```jsx
<MeshLineComponent
  points={circlePositions( 64, 3 )}
  closed={true}
  lineWidth={0.2}
  color={0xff0000}
  gradientColor={0x0000ff}
/>
```

## Dynamic Positions

Animate positions using `useFrame`:

```jsx
import { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshLine } from 'makio-meshline'

function AnimatedWave() {
  const groupRef = useRef()
  const lineRef = useRef()
  const points = useRef( new Float32Array( 100 * 3 ) )

  useEffect( () => {
    const line = new MeshLine()
      .lines( points.current )
      .lineWidth( 0.1 )
      .color( 0x44aaff )
      .build()

    lineRef.current = line
    groupRef.current.add( line )

    return () => {
      line.dispose()
      groupRef.current?.remove( line )
    }
  }, [] )

  useFrame( ( { clock } ) => {
    const t = clock.elapsedTime
    const pts = points.current
    for ( let i = 0; i < 100; i++ ) {
      const x = ( i / 99 - 0.5 ) * 10
      pts[i * 3] = x
      pts[i * 3 + 1] = Math.sin( x + t * 2 ) * 0.5
      pts[i * 3 + 2] = 0
    }
    lineRef.current?.geometry.setPositions( pts )
  } )

  return <group ref={groupRef} />
}
```

## Cursor Trail

A common pattern — follow the mouse with a smooth trail:

```jsx
import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MeshLine } from 'makio-meshline'
import { Vector3 } from 'three/webgpu'

function CursorTrail({ length = 50 }) {
  const groupRef = useRef()
  const lineRef = useRef()
  const trail = useRef( [] )
  const mouse3D = useRef( new Vector3() )
  const { camera, pointer } = useThree()

  useEffect( () => {
    // Initialize trail
    for ( let i = 0; i < length; i++ ) trail.current.push( 0, 0, 0 )

    const pts = new Float32Array( length * 3 )
    const line = new MeshLine()
      .lines( pts )
      .lineWidth( 0.15 )
      .color( 0xff4400 )
      .transparent( true )
      .build()

    lineRef.current = line
    groupRef.current.add( line )

    return () => {
      line.dispose()
      groupRef.current?.remove( line )
    }
  }, [length] )

  useFrame( () => {
    // Unproject pointer to world
    mouse3D.current.set( pointer.x, pointer.y, 0.5 ).unproject( camera )

    // Shift trail and prepend new position
    trail.current.pop(); trail.current.pop(); trail.current.pop()
    trail.current.unshift( mouse3D.current.x, mouse3D.current.y, mouse3D.current.z )

    const pts = new Float32Array( trail.current )
    lineRef.current?.geometry.setPositions( pts )
  } )

  return <group ref={groupRef} />
}
```

## TSL Hooks

Apply GPU hooks before building:

```jsx
import { Fn, sin, time, vec3, smoothstep } from 'three/tsl'

function HookedLine() {
  const groupRef = useRef()

  useEffect( () => {
    const line = new MeshLine()
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

    groupRef.current.add( line )
    return () => {
      line.dispose()
      groupRef.current?.remove( line )
    }
  }, [] )

  return <group ref={groupRef} />
}
```

## Instancing

Render thousands of lines with a single draw call:

```jsx
import { useEffect, useRef } from 'react'
import { Fn, vec3, cos, sin, time, attribute } from 'three/tsl'
import { MeshLine } from 'makio-meshline'

function InstancedCircles({ count = 100 }) {
  const groupRef = useRef()

  useEffect( () => {
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

    groupRef.current.add( line )
    return () => {
      line.dispose()
      groupRef.current?.remove( line )
    }
  }, [count] )

  return <group ref={groupRef} />
}
```

## Auto-Resize

Handle window resizing to keep line widths correct:

```jsx
useEffect( () => {
  const line = new MeshLine()
    .lines( myPoints )
    .lineWidth( 0.1 )
    .autoResize( window )
    .build()

  // autoResize automatically listens for window resize events
  // and updates the resolution uniform

  return () => line.dispose() // cleanup removes the listener
}, [] )
```

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [Performance](./performance.md) — optimization tips
