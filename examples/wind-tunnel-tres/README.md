# Wind Tunnel in TresJS — local development preview

This private companion example uses the unreleased MeshLine development code in this repository. It is a local WIP, requires the whole source checkout, and is not a standalone registry starter. It does not imply that MeshLine V2 is released or that these files have been published.

From the workspace root, after installing the workspace dependencies:

```sh
pnpm --filter makio-meshline-wind-tunnel-tres-example dev
pnpm --filter makio-meshline-wind-tunnel-tres-example build
```

Open the local Vite URL in a browser that provides native WebGPU. WebGPU requires HTTPS or localhost. This particular scene uses compute shaders; it intentionally shows an explanation if the renderer falls back to WebGL2. The regular MeshLine package also supports WebGL2 rendering.

`src/WindTunnel.vue` is a real Tres scene component. It obtains the host renderer, scene, camera, and viewport through `useTres()` from `@tresjs/core/webgpu`. `TresCanvas` initializes and owns the renderer returned by the synchronous renderer factory.

`useLoop().onBeforeRender()` updates orbit controls and the simulation. `useLoop().render()` replaces Tres's default draw with the shared scene's bloom pipeline and calls `notifySuccess()` after each attempted frame. Do not also call `renderer.render(scene, camera)`. This example targets Tres 5.10, where `render()` returns `void`; cleanup stops the framework loop and replaces the callback before disposing the scene.

The camera and orbit limits come from `WIND_TUNNEL_CAMERA`. Pointer coordinates are normalized against the canvas bounds. Animation stops while the document is hidden. Reduced-motion preferences start the scene paused and disable automatic orbit; the Play button can opt into simulation. When paused, controls and settings start the Tres loop for one frame, then stop it again.

Unmounting removes controls and listeners, aborts pending initialization before GPU resource construction, disposes the shared scene, and disposes a scene that finishes loading after cancellation. The renderer stays owned by `TresCanvas`.

The `makio-meshline-wind-tunnel-example` dependency is a private workspace package at `../wind-tunnel`. Vite serves `../wind-tunnel/public`, which contains the authored hover-car model and preview image. Keep that sibling folder when copying or running this example; no demo application utilities are required.

Integration APIs were checked against the [Tres WebGPU entry documentation](https://docs.tresjs.org/api/advanced/web-gpu), [useTres](https://docs.tresjs.org/api/composables/use-tres), [useLoop](https://docs.tresjs.org/api/composables/use-loop), and the published `@tresjs/core` 5.10.1 implementation.
