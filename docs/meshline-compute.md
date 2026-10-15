---
description: "Reference MeshLineCompute, the experimental WebGPU storage-buffer curve engine for autonomous MeshLine ribbons."
---

# MeshLineCompute

`MeshLineCompute` is an experimental WebGPU-only curve engine. It keeps curve point state in storage buffers, updates that state with TSL motion and arc-length compute passes, and renders the result through the same MeshLine ribbon material used by `MeshLine`.

Use it when the curve itself is alive: autonomous trails, flow-field ribbons, mouse-driven energy lines, audio-reactive curves, or other effects where uploading CPU point arrays every frame would become the bottleneck.

```js
import { MeshLineCompute } from 'makio-meshline'

const curves = new MeshLineCompute( {
	curveCount: 180,
	pointsPerCurve: 42,
	lineWidth: 0.14,
	color: 0x47f7ff,
	gradientColor: 0xff4bd8,
	transparent: true,
	opacity: 0.82,
} ).build()

scene.add( curves )

function animate( delta ) {
	curves.step( renderer, delta )
	renderer.render( scene, camera )
}
```

## WebGPU Only

`MeshLineCompute` requires `WebGPURenderer.compute()`. If `step()` receives a renderer without compute support, it emits one warning and skips the dispatch. The standard `MeshLine` class remains the WebGPU/WebGL2-compatible default.

## How It Works

- A compact storage-buffer point field stores every curve point.
- A velocity buffer, base-position buffer, and seed buffer drive the simulation.
- `step( renderer, delta )` dispatches a motion pass and an arc-length pass on the GPU.
- Rendering uses an instanced MeshLine template. Its `gpuPositionNode` samples the storage-buffer point field by `instanceIndex` and `progress`.
- The existing MeshLine material still handles thickness, miter joins, gradients, textures, opacity, shadows, and TSL hooks.
- `arcLengthNode( progress )` samples cumulative distance along the current animated curve, which lets fragment hooks place dashes, bands, or pulses by real curve distance.

This first implementation intentionally avoids a custom material fork. The storage-buffer sampling lives behind `gpuPositionNode`, which keeps the v2 compute path additive.

## Constructor Options

`MeshLineCompute` accepts most visual `MeshLine` options plus compute-specific controls:

| Option | Default | Purpose |
| --- | ---: | --- |
| `curveCount` | `128` | Number of autonomous curve instances |
| `pointsPerCurve` | `32` | Simulated points per curve |
| `curveLength` | `4` | Initial home-curve length |
| `bounds` | `12` | Simulation clamp around the origin |
| `damping` | `0.94` | Velocity damping each compute step |
| `curlStrength` | `4` | Flow-field force amount |
| `flowSpeed` | `1` | Time scale for the field |
| `homeStrength` | `1.4` | Spring force back to the generated home curve |
| `mouseStrength` | `8` | Mouse attractor strength |
| `mouseRadius` | `5` | Mouse attractor radius |
| `audioLevel` | `0` | Scalar flow-force boost intended for audio input |
| `depthStrength` | `0` | Placeholder vertical bias; it does not sample scene depth yet |
| `textureStrength` | `0` | Placeholder seeded force variation; it does not sample a texture yet |
| `mode` | `'autonomous'` | `'autonomous'`, `'follow'`, `'field'`, or a numeric blend from `0` to `2` |

## Runtime API

```js
curves
	.mode( 'follow' )
	.mouseStrength( 14 )
	.mouseRadius( 7 )
	.curlStrength( 5 )
	.damping( 0.95 )

curves.mouse( { x: 0, y: 0, z: 0 } )
curves.step( renderer, deltaSeconds )
curves.clearMouse()
```

Most simulation setters update uniforms live. Changing `curveCount`, `pointsPerCurve`, `curveLength`, or `bounds` marks the object for rebuild and reseeds its storage on the next `build()` or `step()`. Call `reset()` to restore the current generated home curves without changing their dimensions.

After storage has been created, the `positionBuffer`, `velocityBuffer`, `baseBuffer`, `seedBuffer`, and `distanceBuffer` getters expose the owned `StorageBufferAttribute` instances for advanced integrations. `MeshLineCompute` owns their lifecycle; reacquire them after changing the curve or point count.

Use `arcLengthNode( progress )` inside TSL hooks when an effect must stay distance-stable on animated curves:

```js
import { float, Fn, mod, smoothstep, uniform } from 'three/tsl'

const dashSpacing = uniform( 1.5 )

curves
	.fragmentAlphaFn( Fn( ( [alpha, uvCoords, progress] ) => {
		const cycle = mod( curves.arcLengthNode( progress ).div( dashSpacing ), 1 )
		const dashIn = smoothstep( 0, 0.08, cycle )
		const dashOut = float( 1 ).sub( smoothstep( 0.55, 0.63, cycle ) )
		return alpha.mul( dashIn ).mul( dashOut )
	} ) )
	.build()
```

## Current Limits

- It is experimental and WebGPU-only.
- It uses an in-place motion pass plus a cumulative arc-length pass. Neighbour constraints, collision passes, and exact compute picking are planned follow-ups.
- It inherits `MeshLine.raycast()`, but the CPU geometry is only an instanced progress template and cannot represent the GPU-updated curve shape. Use `MeshLinePicker` for rendered ID picking.

See the [Compute Curves example](./examples/compute-curves.md) for a full scene with mouse interaction, arc-length pulses, per-curve colors, and glow.
