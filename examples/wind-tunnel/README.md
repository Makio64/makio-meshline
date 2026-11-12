# Wind Tunnel — V2 Development Preview

**Unreleased work in progress. Local preview only.** This example uses the current Makio MeshLine V2 workspace source. It is private, excluded from search indexing, and has not been published as a standalone site or submitted to a gallery.

A real WebGPU compute simulation advects smoke filaments around an authored hover car. Each filament is a 128-point GPU ring buffer read directly by instanced `MeshLine` ribbons. A fine wire and a soft halo share the same point buffer. A live cube reflection, wet floor, and bloom make the moving lines visible on the car's paint and glass.

The flow is an artistic velocity field guided by a signed-distance volume. It is not a validated computational fluid dynamics solver, and the displayed wind-speed control is a visual parameter rather than an engineering measurement.

## Run Locally

From the repository root, with Node.js 22.12 or later and pnpm:

```bash
pnpm install
pnpm --filter makio-meshline-wind-tunnel-example dev
```

For a local production preview:

```bash
pnpm --filter makio-meshline-wind-tunnel-example build
pnpm --filter makio-meshline-wind-tunnel-example preview
```

Open the localhost URL printed by Vite in a browser/device with **native WebGPU** enabled. The example has an explicit unsupported-browser screen. Its compute simulation requires native WebGPU; the regular Makio MeshLine library also supports WebGL2 through `WebGPURenderer`.

The package currently uses `makio-meshline: workspace:*`, so run it inside this checkout. The app has its own entry, scene implementation, dependencies, and assets: it imports no demo app utilities, Vue globals, router, sibling repository, or hidden stage helper. A registry-only copy can be prepared when V2 is actually released.

## Controls

- Move the pointer to steer the airflow; drag to orbit; scroll or pinch to zoom.
- Switch between Full Tunnel, Smoke Rake, and Ground Effect.
- Toggle crosswind and adjust wind speed from 80 to 500 km/h.
- Pause stops flow and camera motion; rendering remains available for orbiting.

The host pauses rendering in hidden tabs, clamps returning-frame time, and lowers pixel ratio after sustained slow frames. Small/coarse-pointer screens use fewer filaments and smaller reflection/bloom targets. Reduced-motion preferences slow the flow and disable camera auto-rotation. These are rendering budgets, not performance guarantees.

## Reusable Scene API

`src/scene.js` exports `createWindTunnel` and `WIND_TUNNEL_CAMERA`. React Three Fiber and TresJS companion hosts can import this private workspace package and use their own renderer and lifecycle.

```js
import { createWindTunnel, WIND_TUNNEL_CAMERA } from 'makio-meshline-wind-tunnel-example'

// Supply your initialized native-WebGPU renderer, Scene, and Camera.
const tunnel = await createWindTunnel( {
	renderer,
	scene,
	camera,
	canvas: renderer.domElement,
	reducedMotion: matchMedia( '(prefers-reduced-motion: reduce)' ).matches,
	quality: 'auto',
	onStatus: message => { console.info( message ) },
} )

// In the host's animation loop, after updating its camera controls:
tunnel.update( dtSeconds )
tunnel.render()

// On resize, alongside the host camera and renderer:
tunnel.resize( width, height )

// Before unmounting or disposing the host renderer:
tunnel.dispose()
```

The core adds one owned `Group` to the supplied scene, sets its environment/background, and changes the renderer's tone mapping for the scene. `dispose()` removes that group, frees scene/compute/postprocessing resources, and restores the previous environment, background, and tone mapping. It leaves the host renderer and camera alive. Call the returned `render()` for the bloom pipeline instead of rendering the same scene a second time. `update(dtSeconds)` advances compute and refreshes the live car reflection before that render.

| API | Behavior |
| --- | --- |
| `settings` | Current `{ mode: 'tunnel', wind: 200, crosswind: false }`; change values with the setters below |
| `setMode( mode )` | `'tunnel'`, `'rake'`, or `'ground'` |
| `setWind( kmH )` | Finite number, clamped to `80..500` |
| `setCrosswind( enabled )` | Enable or disable yawed airflow |
| `setPointer( x, y )` | Canvas-normalized coordinates: `-1..1`, positive Y upward |
| `setReducedMotion( enabled )` | Change the flow's reduced-motion behavior |
| `resize( width, height )` | CSS-pixel dimensions of the host canvas; host resizes its own camera and renderer |
| `dispose()` | Idempotent scene cleanup; call once the async factory resolves, including canceled mounts |

Pass `quality: 'low'` for reduced reflection/bloom resolutions. `quality: 'auto'` uses the screen/input budget. Override `modelUrl` if the public model is served elsewhere. The default model URL uses Vite's `BASE_URL`, so a relative-base build also loads from a nested preview directory.

## Source and Assets

- `src/main.js`: plain Three.js host, OrbitControls, edge controls, visibility, resize, and cleanup.
- `src/scene.js`: explicit scene lifecycle and public adapter API.
- `src/flow.js`: TSL SDF sampling, velocity field, RK2 integration, ring-buffer trails, and line shading, extracted from the V2 Wind Tunnel scene.
- `src/car.js`: GLTF finishes and runtime signed-distance-volume baking with `three-mesh-bvh`.
- `src/environment.js`: procedural tunnel, live cube reflections, wet-floor reflector, and bloom.

`public/models/hover-car.glb` is the project's authored hover car, built by [`scripts/hover-car/build_car.py`](../../scripts/hover-car/build_car.py) with its livery from [`scripts/hover-car/livery.py`](../../scripts/hover-car/livery.py). It is copied here so this app's asset path is explicit. The environment and carbon weave are procedural; no external sky or font asset is required. `public/preview.jpg` is an actual capture of the Wind Tunnel scene, provided as a draft submission image.

Project source: [Makio64/makio-meshline](https://github.com/Makio64/makio-meshline). These new example files remain local WIP until the author chooses to publish them. See the repository [MIT license](../../LICENSE).
