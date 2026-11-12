# Wind Tunnel in React Three Fiber — local development preview

This private companion example uses the unreleased MeshLine development code in this repository. It is a local WIP, requires the whole source checkout, and is not a standalone registry starter. It does not imply that MeshLine V2 is released or that these files have been published.

From the workspace root, after installing the workspace dependencies:

```sh
pnpm --filter makio-meshline-wind-tunnel-r3f-example dev
pnpm --filter makio-meshline-wind-tunnel-r3f-example build
```

Open the local Vite URL in a browser that provides native WebGPU. WebGPU requires HTTPS or localhost. This particular scene uses compute shaders; it intentionally shows an explanation if the renderer falls back to WebGL2. The regular MeshLine package also supports WebGL2 rendering.

`src/WindTunnel.jsx` is the integration: `useThree()` supplies the host renderer, scene, camera, and viewport. The asynchronous `Canvas` renderer factory initializes `WebGPURenderer`; `useFrame(..., 1)` takes over rendering and calls the shared scene's `update(deltaSeconds)` and `render()` once per frame. The core renders its own bloom pipeline, so the host must not also call `renderer.render(scene, camera)`.

The component releases controls, listeners, and the scene on unmount, including a scene that finishes loading after cancellation. An `AbortSignal` prevents the core from constructing GPU resources after an unmount during model loading. `App` explicitly disposes the host `WebGPURenderer` after that pending cleanup; R3F 9's WebGL unmount path does not call the WebGPU renderer's `dispose()` method. The camera and orbit limits come from the shared `WIND_TUNNEL_CAMERA` export. Pointer coordinates are normalized against the canvas bounds.

Animation pauses when the tab is hidden. Reduced-motion preferences start the scene paused and disable automatic orbit; the Play button can opt into simulation. When paused, R3F uses its demand loop so orbiting, settings, and resizing can still draw a frame.

The `makio-meshline-wind-tunnel-example` dependency is a private workspace package at `../wind-tunnel`. Vite serves `../wind-tunnel/public`, which contains the authored hover-car model and preview image. Keep that sibling folder when copying or running this example; no demo application utilities are required.

Integration APIs were checked against the [R3F Canvas documentation](https://r3f.docs.pmnd.rs/api/canvas) and [useThree/useFrame documentation](https://r3f.docs.pmnd.rs/api/hooks). This host targets the existing R3F 9 renderer-factory API.
