---
description: "Build camera-independent world-space ribbons, roads, and tracks with MeshLine surface frames, banking, distance UVs, and PBR materials."
---

# World-Space Surfaces

Use the surface profile for roads, tracks, trails, and flat ribbons that must live in the scene as real geometry. It expands the path on the CPU, writes positions and normals, adds only the optional attributes used by the active material, and shades the result with a standard PBR material.

```js
import { MeshLine } from 'makio-meshline'

const road = new MeshLine()
	.lines( roadPoints )
	.lineWidth( 4 )
	.color( 0xffffff )
	.map( roadTexture )
	.surface( {
		frame: 'transport',
		up: [0, 1, 0],
		bank: progress => Math.sin( progress * Math.PI * 2 ) * 0.05,
		uvMode: 'distance',
		uvScale: 5,
		roughness: 0.9,
		metalness: 0,
	} )
	.join( { type: 'miter', limit: 3, segments: 8 } )
	.build()

scene.add( road )
```

`lineWidth` is the full width in world units. It does not change with camera distance.

## Surface and Screen Profiles

The two profiles solve different geometry problems and intentionally remain separate.

| | Screen profile (default) | Surface profile |
| --- | --- | --- |
| Best for | Strokes, graphs, trails, outlines | Roads, tracks, flat ribbons |
| Expansion | Camera-facing in the vertex shader | Camera-independent world geometry |
| Width | CSS pixels or projected scene width | World units |
| Shading | Line gradients, dashes, maps, TSL hooks | Lit PBR surface and texture maps |
| Geometry frame | Depends on the active camera | Transported or fixed-up frame |

Calling `.surface( options )` selects the surface profile. Do not use it as a pixel-perfect HUD line: use the default screen profile for that job. Screen-only dash, gradient, and billboard hook options do not define the surface material.

## Surface Options

### `frame`

- **`'transport'`** (default) uses a rotation-minimizing frame. It is the stable general choice for arbitrary 3D paths and applies a distributed seam correction to closed loops.
- **`'fixed-up'`** projects `up` against each path tangent. It is useful for mostly planar roads that should stay aligned to a known world-up direction. When the tangent and `up` become parallel, the geometry falls back to a deterministic valid frame.

### `up`

The initial or fixed reference direction. It accepts a Three.js vector or an array such as `[0, 1, 0]`. It must be finite and non-zero.

### `bank`

Rotation around the path tangent, in radians. Use a single number, one value per point, or a callback:

```js
.surface( {
	bank: ( progress, pointIndex, lineIndex ) => progress * 0.1
} )
```

Banking rotates both the surface normal and its side direction, so lighting and geometry stay aligned.

### `uvMode` and `uvScale`

- **`uvMode: 'distance'`** (default) sets `u = distance / uvScale`. A texture repeats consistently even when points are unevenly spaced. `uvScale` must be greater than zero.
- **`uvMode: 'stretch'`** maps the complete path to `u = 0…1`. `uvScale` does not change stretched UVs.

`v` always runs from the left edge to the right edge.

### PBR options

The surface material accepts:

- `roughness` and `metalness`
- `normalMap`, `roughnessMap`, and `metalnessMap`
- `side`, when the underside must also render

Use the regular fluent methods for base color, diffuse map, alpha map, opacity, alpha test, transparency, and wireframe.

## Width Along the Path

`widthCallback` returns a multiplier for the full `lineWidth`. Its progress argument is based on arc length, not point index:

```js
const ribbon = new MeshLine()
	.lines( points )
	.lineWidth( 2 )
	.widthCallback( progress => 0.35 + Math.sin( progress * Math.PI ) * 0.65 )
	.surface()
	.build()
```

Consecutive duplicate points are compacted before the surface is built. Non-finite coordinates and paths without enough distinct points are rejected instead of producing corrupt GPU buffers.

Keep centerline coordinates near the object's local origin and place the `MeshLine` with its object transform. If Float32 conversion would collapse a segment or materially deform its width, surface construction throws with a rebasing message instead of emitting zero-area road triangles.

## Joins, Caps, and Reversals

The surface builder has a compact fast path and a variable-topology path:

- Ordinary `miter` + `butt` roads stay on the two-vertices-per-row strip whenever every miter fits inside `join.limit`.
- `bevel` emits separate incoming/outgoing outer corners and a real fill wedge.
- `round` emits an outer arc. `join.segments` is the subdivision budget for a 180° turn; shallower corners use proportionally fewer triangles.
- An over-limit `miter` bevels the outer corner instead of producing a spike; the inner edge still uses its exact offset-line intersection, independently of `join.limit`.
- Open paths support `butt`, `square`, and tessellated `round` caps. `cap.segments` is the full semicircle budget.
- A zero-radius reversal has no unique tangent or finite miter. It is split into two independent runs and each half follows the selected cap policy, so no triangle bridges across the cusp.

Square/round cap UVs extend by physical path distance, and closed paths duplicate their texture seam before emitting seam joins. The builder validates the combined exact inner setbacks on every segment and rejects a road whose adjacent joins would cross; lengthen or split the centerline, reduce its width, or model a finite-radius hairpin instead of silently emitting a pinched or self-overlapping surface.

## Low-Level Classes

Most projects should use `MeshLine().surface()`. Advanced integrations can compose the profile directly:

```js
import {
	MeshLineSurfaceGeometry,
	MeshLineSurfaceNodeMaterial,
} from 'makio-meshline'

const geometry = new MeshLineSurfaceGeometry( {
	lines: roadPoints,
	lineWidth: 4,
	surface: { frame: 'fixed-up', up: [0, 1, 0] },
	join: { type: 'round', limit: 3, segments: 8 },
	cap: { type: 'round', segments: 8 },
} )

const material = new MeshLineSurfaceNodeMaterial( {
	color: 0x303030,
	surface: { roughness: 0.9, metalness: 0 },
} )
```

The geometry always exposes standard `position` and `normal` attributes. It adds `uv` for texture maps, `tangent` for normal mapping (or low-level `needsTangents`), and `progress`/`side` only when explicitly requested. This keeps the default road buffer compact while remaining compatible with ordinary mesh raycasting, lighting, and tooling.

See the complete [Road Surface example](./examples/road.md) for a generated texture and standalone Three.js setup.

The interactive [Variable Topology gallery](https://meshline-demo.makio.io/examples/variable-topology) overlays wireframes for every join/cap policy and includes a split reversal case.
