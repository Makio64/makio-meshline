# MeshLine V2 preview × TypeGPU

Local work in progress. **MeshLine V2 is unreleased.** This example requires this source checkout and uses `makio-meshline: workspace:*`; it cannot be installed as a standalone registry starter yet. Nothing here is submitted to the TypeGPU gallery or published.

Five ribbons share one `MeshLine` batch. TypeGPU GPU functions displace their positions and animate their colors, using the official `@typegpu/three` bridge:

- `fromTSL()` exposes Three.js uniforms and MeshLine hook arguments as typed TypeGPU accessors.
- `toTSL()` returns a TSL node from a TypeGPU `'use gpu'` function.
- MeshLine's `positionFn` applies the deformation to the current, previous, and next positions, preserving the ribbon's joins.
- `colorFn` combines the line's base color, progress, and time into a moving color pulse, returning `vec4f` to preserve the incoming alpha and match MeshLine's RGBA assignment.

Point arrays are uploaded when the line is built. Animation updates a time uniform; the Wave height slider updates an amplitude uniform. Neither interaction rebuilds the line or uploads its points every frame.

## Run locally

From the workspace root, after installing the workspace dependencies:

```sh
pnpm install
pnpm --filter makio-meshline-typegpu-example dev
```

Create and serve the local preview build:

```sh
pnpm --filter makio-meshline-typegpu-example build
pnpm --filter makio-meshline-typegpu-example preview
```

The Vite configuration uses the official TypeGPU plugin to transform `'use gpu'` functions. Relative asset paths allow the build to run from a subdirectory.

## Support and scope

This preview deliberately requires **native WebGPU**, served from localhost or HTTPS. It reports unsupported devices instead of relying on a WebGL fallback. `@typegpu/gl` is installed to satisfy the current bridge's peer dependency; WebGL2 behavior has not been validated for this MeshLine example.

Dependencies are pinned to Three.js `0.187.0`, `typegpu` `0.12.10`, `@typegpu/three` `0.12.2`, `@typegpu/gl` `0.12.9`, and `unplugin-typegpu` `0.12.8`. TypeGPU dependencies belong to this example only; the published MeshLine library still depends only on Three.js.

The scene starts paused when the browser requests reduced motion, offers a keyboard-accessible Play/Pause button, and keeps labels and controls at the screen edges. Permanent navigation disposes line and renderer resources.

Local checks completed: production Vite build, repository JavaScript style rules, and Three.js WGSL graph generation for both TypeGPU hooks. The color bridge's generated function returns `vec4f`, matching its destination. A Chrome native WebGPU smoke test rendered all five ribbons and exercised the Pause and Wave height controls without new GPU errors. Other browsers and GPUs have not been tested; WebGL2 remains outside this preview's supported scope.

The UI reports asynchronous backend failures through the renderer's public `onError` and `onDeviceLost` callbacks and disables the controls after an error. Shader source generation alone does not validate a GPU pipeline; keep an actual browser smoke test when changing a bridged hook.

## Source and official references

- [`src/ribbons.js`](./src/ribbons.js): reusable shader hooks and line construction.
- [`src/main.js`](./src/main.js): renderer, resize, controls, and cleanup.
- [Official `@typegpu/three` integration guide](https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-three/).
- [Official TypeGPU build plugin setup](https://docs.swmansion.com/TypeGPU/tooling/unplugin-typegpu/).
- [Official Three.js + TypeGPU example source](https://github.com/software-mansion/TypeGPU/tree/main/apps/typegpu-docs/src/examples/threejs/simple).

## Future TypeGPU gallery submission

This is supporting integration code, separate from the Wind Tunnel flagship. It uses real TypeGPU shader logic; merely rendering a TSL scene on WebGPU would not demonstrate the bridge.

For a future submission, first discuss the proposal under the [TypeGPU contribution process](https://github.com/software-mansion/TypeGPU/blob/main/CONTRIBUTING.md). Their existing Three.js examples use `apps/typegpu-docs/src/examples/threejs/<example>/` with `index.ts`, `index.html`, `meta.json`, and `thumbnail.png`. The [current minimal example metadata](https://github.com/software-mansion/TypeGPU/blob/main/apps/typegpu-docs/src/examples/threejs/simple/meta.json) includes title, description, category, tags, and a gallery sorting value. Inclusion requires maintainer review; there is no automatic external-link submission flow documented there.

Before submitting, validate actual browser rendering on supported hardware, document tested browser/backend versions, and resolve how the unreleased MeshLine source will be supplied. These are future steps, not publication instructions.
