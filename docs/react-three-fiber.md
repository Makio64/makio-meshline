---
description: "Use Makio MeshLine with React Three Fiber (R3F) for wide screen lines, camera-independent road surfaces, textures, and GPU-driven effects."
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
import { MeshLine } from './MeshLine' // wrapper from the example

const circlePoints = circlePositions( 64, 3 )

function RotatingCircle() {
  const ref = useRef()
  useFrame( ( _, dt ) => {
    if ( !ref.current ) return
    ref.current.rotation.z += dt * 0.3
  } )

  return (
    <group ref={ref}>
      <MeshLine
        points={circlePoints}
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

The full wrapper source lives in [`examples/react-three-fiber/src/MeshLine.jsx`](https://github.com/Makio64/makio-meshline/blob/main/examples/react-three-fiber/src/MeshLine.jsx). It renders the MeshLine as an R3F `<primitive>`, forwards the actual `MeshLine` instance as the ref, and exposes the MeshLine configuration surface as props.

The wrapper accepts either `points` or `lines`, uses the R3F Canvas size for screen-line resolution by default, updates positions in place with `setPositions()`, live-updates appearance props such as `lineWidth`, `color`, `opacity`, `map`, and `alphaMap`, and rebuilds only when shader or geometry-shaping props change. It also supports `onReady={line => ...}` when you need direct access after creation.

## Road and Ribbon Surfaces

Pass a `surface` options object to switch from a camera-facing screen line to a camera-independent, lit ribbon. Keep `surface` and `join` objects stable with `useMemo()` so an unrelated React render does not rebuild the geometry:

```jsx
const roadSurface = useMemo( () => ( {
  frame: 'transport',
  up: [0, 1, 0],
  bank: progress => Math.sin( progress * Math.PI ) * 0.08,
  uvMode: 'distance',
  uvScale: 2,
  roughness: 0.95,
  metalness: 0,
} ), [] )

const roadJoin = useMemo( () => ( {
  type: 'miter',
  limit: 3,
  segments: 8,
} ), [] )

const roadCap = useMemo( () => ( {
  type: 'round',
  segments: 8,
} ), [] )

<MeshLine
  points={roadCenterline}
  surface={roadSurface}
  join={roadJoin}
  cap={roadCap}
  lineWidth={4}
  map={roadTexture}
  color={0xffffff}
/>
```

`lineWidth` is the full ribbon width in world units. `frame` can be `transport` for a rotation-minimizing 3D frame or `fixed-up` for flatter terrain workflows. `uvMode: 'distance'` advances U by path distance divided by `uvScale`; `stretch` maps the whole path to 0–1. `bank` accepts radians, an array, or a callback. Lit material options such as `roughness`, `metalness`, `normalMap`, `roughnessMap`, `metalnessMap`, and `side` belong inside `surface`.

The `join` object is forwarded as `{ type, limit, segments }`; surface `bevel` and `round` modes emit true wedges/fans, and over-limit miters fall back to a bounded bevel. `join.segments` is a half-turn budget, so shallow arcs use fewer triangles. `cap` accepts `butt`, `square`, `round`, or `{ type, segments }`; round caps use the full semicircle budget. Reversals split into independent capped runs instead of sharing an undefined miter.

The default `surface={false}` path never calls `.surface()`, preserving the existing screen-line behavior. The surface wrapper intentionally covers the common lit-road options; billboard-only dashes, gradients, `sizeAttenuation`, GPU positions, instancing, and custom line-extrusion TSL hooks are not adapted to a surface material. Screen-line hook props remain available. Use the forwarded ref or `onReady` for a custom surface node graph or other low-level work.

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Common Patterns](./common-patterns.md) — cursor trails, dynamic positions, reactive updates
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [API Reference](./api.md) — full API documentation
