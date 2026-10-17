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
import { MeshLine } from './MeshLine.jsx' // wrapper from the example

const circlePoints = circlePositions( 64, 3 )

async function createRenderer( props ) {
  const renderer = new WebGPURenderer( { ...props, antialias: true } )
  await renderer.init()
  return renderer
}

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
      gl={createRenderer}
    >
      <RotatingCircle />
    </Canvas>
  )
}
```

## Wrapper Component

The full wrapper source lives in [`examples/react-three-fiber/src/MeshLine.jsx`](https://github.com/Makio64/makio-meshline/blob/main/examples/react-three-fiber/src/MeshLine.jsx). It renders the MeshLine as an R3F `<primitive>`, forwards the actual `MeshLine` instance as the ref, and exposes the current non-deprecated `MeshLineConfigureOptions` as props. `points` is a React-friendly alias for `lines`. The wrapper omits `autoResize` because the R3F Canvas size already drives the line resolution.

Point-buffer changes stay on the same instance and use `setPositions()`. Appearance props such as `lineWidth`, `miterLimit`, `color`, `opacity`, `map`, and `alphaMap` also update live. Props that change topology, buffer layout, usage, or shader structure rebuild the existing facade in place; examples include `closed`, `surface`, `join`, `cap`, `antialias`, `gpuPositionNode`, the `needs*` flags, and TSL hooks. Keep object and callback values for those props stable with `useMemo()` or `useCallback()` when they depend on component state.

At the facade level, imperative `setPositions()`, `setPositionRange()`, and `resize()` values remain current through a direct `ref.current.rebuild()`. Wrapper-driven rebuilds reapply the current declarative props, so keep those sources synchronized when mixing the two styles. A point- or line-count change removes custom vertex attributes because their layout is no longer valid; recreate and refill them on the current ref.

Leave `frustumCulled` undefined to use the facade's safe defaults: ordinary CPU world-width lines are culled, while CSS-pixel-width lines, GPU-generated positions, and arbitrary geometry-deforming `positionFn`, `previousFn`, `nextFn`, `widthFn`, `normalFn`, or `vertexFn` hooks are not. Pass an explicit boolean only when you maintain conservative bounds yourself.

The forwarded ref remains the same `MeshLine` facade for the mounted wrapper, including when structural props change. `onReady={line => ...}` runs once for that facade; changing only the callback does not notify it again. Adding `points`/`lines` replaces the generated position data, while removing them restores a unit straight line with `segments + 1` points. Both transitions keep the same ref and scene attachment.

## Road and Ribbon Surfaces

Pass a `surface` options object to switch from a camera-facing screen line to a camera-independent, lit ribbon. Define topology objects outside the component, as below, or memoize state-dependent values with `useMemo()`. This component is ready to place inside the same `<Canvas>` as the basic example; it includes lights because surface materials are lit:

```jsx
import { MeshLine } from './MeshLine.jsx'

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

export function Road() {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 6]} intensity={2} />
      <MeshLine
        points={roadCenterline}
        surface={roadSurface}
        join={roadJoin}
        cap={roadCap}
        lineWidth={0.8}
        color={0x607080}
      />
    </>
  )
}
```

`lineWidth` is the full ribbon width in world units. `frame` can be `transport` for a rotation-minimizing 3D frame or `fixed-up` for flatter terrain workflows. `uvMode: 'distance'` advances U by path distance divided by `uvScale`; `stretch` maps the whole path to 0–1. `bank` accepts radians, an array, or a callback. Lit material options such as `roughness`, `metalness`, `normalMap`, `roughnessMap`, `metalnessMap`, and `side` belong inside `surface`.

The `join` prop accepts `'miter'`, `'bevel'`, `'round'`, or `{ type, limit, segments, inner, fold }`; surface `bevel` and `round` modes emit true wedges/fans, and over-limit miters fall back to a bounded bevel. `join.inner` defaults to `'exact'`; use `'clip'` when an interactively edited road should trim an infeasible inner footprint instead of rejecting it. `join.segments` is a half-turn budget, so shallow arcs use fewer triangles. `cap` accepts `butt`, `square`, `round`, or `{ type, segments }`; round caps use the full semicircle budget. Reversals split into independent capped runs instead of sharing an undefined miter.

The default `surface={false}` path preserves the camera-facing screen-line profile. The surface wrapper intentionally covers the common lit-road options; billboard-only dashes, gradients, `sizeAttenuation`, GPU positions, instancing, and custom line-extrusion TSL hooks are not adapted to a surface material. Screen-line hook props remain available. Use the forwarded ref or `onReady` for a custom surface node graph or other low-level work.

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Common Patterns](./common-patterns.md) — cursor trails, dynamic positions, reactive updates
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [API Reference](./api.md) — full API documentation
