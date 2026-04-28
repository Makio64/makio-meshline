---
description: "Reference MeshLineCompute, the experimental WebGPU storage-buffer curve engine for autonomous MeshLine ribbons."
---

# MeshLineCompute

`MeshLineCompute` is an experimental WebGPU-only curve engine. It keeps curve point state in storage buffers, updates that state with a TSL compute pass, and renders the result through the same MeshLine ribbon material used by `MeshLine`.

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
| `audioLevel` | `0` | Audio-reactive force slot |
| `depthStrength` | `0` | Future scene-depth/collision force slot |
| `textureStrength` | `0` | Future storage-texture/vector-field force slot |
| `mode` | `'autonomous'` | `'autonomous'`, `'follow'`, `'field'`, or a numeric blend |

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
```

Most simulation setters update uniforms live. Changing `curveCount`, `pointsPerCurve`, `curveLength`, or `bounds` rebuilds and reseeds the storage buffers on the next `build()`.

Use `arcLengthNode( progress )` inside TSL hooks when an effect must stay distance-stable on animated curves:

```js
line.fragmentAlphaFn( Fn( ( [alpha, uvCoords, progress] ) => {
	const cycle = mod( line.arcLengthNode( progress ).div( dashSpacing ), 1 )
	return alpha.mul( smoothstep( 0, 0.08, cycle ) )
} ) )
```

## Current Limits

- It is experimental and WebGPU-only.
- It uses an in-place motion pass plus a cumulative arc-length pass. Neighbour constraints, collision passes, and exact compute picking are planned follow-ups.
- It returns the rendered object like `MeshLine`, but CPU `raycast()` cannot know the GPU-updated curve shape. Use `MeshLinePicker` for rendered ID picking.

See the [Compute Curves example](./examples/compute-curves.md) for a full scene with mouse interaction, dashes, glow, and a generated texture.