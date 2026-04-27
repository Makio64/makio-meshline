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

## Basic Usage

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Makio64/makio-meshline/tree/main/examples/react-three-fiber)

The example ships a `<MeshLine>` wrapper component so you can stay declarative:

```jsx
import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { WebGPURenderer } from 'three/webgpu'
import { circlePositions } from 'makio-meshline'
import { MeshLine } from './MeshLine' // see wrapper below

function RotatingCircle() {
  const ref = useRef()
  useFrame( ( _, dt ) => { ref.current.rotation.z += dt * 0.3 } )

  return (
    <group ref={ref}>
      <MeshLine
        points={circlePositions( 64, 3 )}
        closed
        lineWidth={0.2}
        color={0xff8800}
        gradientColor={0xffffff}
      />
    </group>
  )
}

export default function App() {
  return (
    <Canvas
      camera={{ position: [0, 0, 10] }}
      gl={async ( props ) => {
        const renderer = new WebGPURenderer( { ...props, antialias: true } )
        await renderer.init()
        return renderer
      }}
    >
      <RotatingCircle />
    </Canvas>
  )
}
```

## Wrapper Component

Drop this file into your project — it exposes the common MeshLine options and TSL hooks as React props:

```jsx
// MeshLine.jsx
import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { MeshLine as MeshLineCore } from 'makio-meshline'

export const MeshLine = forwardRef( function MeshLine( {
  points, closed = false, lineWidth = 0.1, color = 0xffffff,
  gradientColor, dash, map, opacity = 1, transparent = false, sizeAttenuation = true,
  widthFn, colorFn, opacityFn, gradientFn, uvFn, dashFn, positionFn,
  fragmentColorFn, fragmentAlphaFn, discardFn, vertexFn,
  ...props
}, ref ) {
  const groupRef = useRef()
  const lineRef = useRef()

  useEffect( () => {
    const line = new MeshLineCore()
      .lines( points ).closed( closed ).lineWidth( lineWidth )
      .color( color ).sizeAttenuation( sizeAttenuation )

    if ( gradientColor != null ) line.gradientColor( gradientColor )
    if ( dash ) line.dash( dash )
    if ( map ) line.map( map )
    if ( transparent || opacity < 1 ) line.transparent( true ).opacity( opacity )

    if ( widthFn ) line.widthFn( widthFn )
    if ( colorFn ) line.colorFn( colorFn )
    if ( opacityFn ) line.opacityFn( opacityFn )
    if ( gradientFn ) line.gradientFn( gradientFn )
    if ( uvFn ) line.uvFn( uvFn )
    if ( dashFn ) line.dashFn( dashFn )
    if ( positionFn ) line.positionFn( positionFn )
    if ( fragmentColorFn ) line.fragmentColorFn( fragmentColorFn )
    if ( fragmentAlphaFn ) line.fragmentAlphaFn( fragmentAlphaFn )
    if ( discardFn ) line.discardFn( discardFn )
    if ( vertexFn ) line.vertexFn( vertexFn )

    line.build()
    lineRef.current = line
    groupRef.current.add( line )

    return () => {
      line.dispose()
      groupRef.current?.remove( line )
      lineRef.current = null
    }
  }, [points, closed, lineWidth, color, gradientColor, dash, map, opacity, transparent, sizeAttenuation,
    widthFn, colorFn, opacityFn, gradientFn, uvFn, dashFn, positionFn,
    fragmentColorFn, fragmentAlphaFn, discardFn, vertexFn] )

  useImperativeHandle( ref, () => lineRef.current, [] )
  return <group ref={groupRef} {...props} />
} )
```

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Common Patterns](./common-patterns.md) — cursor trails, dynamic positions, reactive updates
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [API Reference](./api.md) — full API documentation
