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
import { MeshLine } from './MeshLine' // wrapper from the example

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

The full wrapper source lives in [`examples/react-three-fiber/src/MeshLine.jsx`](https://github.com/Makio64/makio-meshline/blob/main/examples/react-three-fiber/src/MeshLine.jsx). It renders the MeshLine as an R3F `<primitive>`, forwards the actual `MeshLine` instance as the ref, and exposes the MeshLine configuration surface as props.

The wrapper accepts either `points` or `lines`, uses the R3F Canvas size for MeshLine resolution by default, updates positions in place with `setPositions()`, live-updates uniforms such as `lineWidth`, `color`, `opacity`, `gradientColor`, `dash`, `map`, and `alphaMap`, and rebuilds only when shader/geometry-shaping props change. It also supports `onReady={line => ...}` when you need direct access after creation.

## Next Steps

- [TSL Hooks Guide](./hooks.md) — all 14 hooks with examples
- [Common Patterns](./common-patterns.md) — cursor trails, dynamic positions, reactive updates
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, batching
- [API Reference](./api.md) — full API documentation
