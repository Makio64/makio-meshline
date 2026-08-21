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
	.cap( { type: 'round', segments: 8 } )
	.build()

scene.add( road )
```

`lineWidth` is the full width in world units. It does not change with camera distance.

See [V2 API and Demo Coverage](./v2-api-coverage.md) for the complete surface demo set and the shared WebGL2 verification switch.

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

Pass these fields to `.surface( options )` or to the `surface` member of either low-level constructor:

| Option | Type | Default | Contract |
| --- | --- | --- | --- |
| `frame` | `'transport' \| 'fixed-up'` | `'transport'` | Rotation-minimizing transport for arbitrary 3D paths, or projection against a preferred up vector. |
| `up` | `Vector3`, XYZ tuple, or `{ x, y, z }` | `[0, 1, 0]` | Finite, non-zero initial/reference direction. |
| `bank` | `number`, per-point/per-line arrays, or callback | `0` | Rotation around the tangent in radians. The callback receives `(progress, pointIndex, lineIndex)`. |
| `uvMode` | `'distance' \| 'stretch'` | `'distance'` | Physical repeats or one normalized U span per path. |
| `uvScale` | `number` | `1` | Positive world units represented by one U repeat in distance mode. |
| `normalMap` | `Texture \| null` | `null` | Enables tangent generation and UVs. |
| `roughnessMap` | `Texture \| null` | `null` | Standard PBR roughness texture; enables UVs. |
| `metalnessMap` | `Texture \| null` | `null` | Standard PBR metalness texture; enables UVs. |
| `roughness` | `number` | `0.9` | Base PBR roughness. |
| `metalness` | `number` | `0` | Base PBR metalness. |
| `side` | Three.js side constant | `FrontSide` | Use `DoubleSide` when the underside must render. |

Surface construction also uses the facade's normal geometry controls:

| Related option | Default | Surface behavior |
| --- | --- | --- |
| `lineWidth` | `0.3` | Full world-space width. |
| `widthCallback` | `null` | Arc-length progress multiplier for the full width. |
| `closed` | `false` | Accepts one boolean or one value per batched line; transport frames correct a closed-loop seam. |
| `join` | `{ type: 'miter', limit: 4, segments: 8 }` | True miter, bevel, or round surface topology. `'simple'` is accepted as a miter alias. |
| `cap` | `{ type: 'butt', segments: 8 }` | Butt, square, or round open-path endpoint. Ignored for closed paths. |
| `usage` / `dynamic` | `StaticDrawUsage` / `false` | Selects generated attribute usage; `dynamic: true` defaults to stream usage unless `usage` is explicit. |

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
- `join.inner` defaults to `'exact'`, which rejects intersecting inner footprints. Opt into `'clip'` for continuously edited roads that should keep their centerline and trim only the infeasible inner edge.
- Open paths support `butt`, `square`, and tessellated `round` caps. `cap.segments` is the full semicircle budget.
- A zero-radius reversal has no unique tangent or finite miter. It is split into two independent runs and each half follows the selected cap policy, so no triangle bridges across the cusp.

Square/round cap UVs extend by physical path distance, and closed paths duplicate their texture seam before emitting seam joins. With the default `inner: 'exact'`, the builder validates the combined inner setbacks on every segment and rejects a road whose adjacent joins would cross. Use `inner: 'clip'` only when preserving a dynamic centerline is more important than exact offset edges; it proportionally bounds the inner footprint while retaining the configured outer join.

## Low-Level Class API

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
	join: { type: 'round', limit: 3, segments: 8, inner: 'clip' },
	cap: { type: 'round', segments: 8 },
} )

const material = new MeshLineSurfaceNodeMaterial( {
	color: 0x303030,
	surface: { roughness: 0.9, metalness: 0 },
} )
```

`MeshLineSurfaceGeometryOptions` accepts the related geometry fields above plus these buffer controls:

| Option | Default | Effect |
| --- | --- | --- |
| `needsUV` | `false` | Forces `uv`; maps also enable it automatically. |
| `needsTangents` | `false` | Forces four-component tangents; `surface.normalMap` also enables them automatically. |
| `needsProgress` | `false` | Adds one arc-length progress value per emitted vertex. |
| `needsSide` | `false` | Adds the generated left/right side value. |

`MeshLineSurfaceNodeMaterial` consumes `color`, `map`, `alphaMap`, `opacity`, `alphaTest`, `transparent`, `wireframe`, `depthWrite`, and `depthTest` plus the PBR surface options. Color defaults to white, opacity to `1`, alpha test to `0`, depth testing to `true`, and depth writing to `!transparent` when it is not supplied explicitly.

### Class-specific members

The tables list the surface-specific contract. Both classes retain their inherited Three.js `BufferGeometry` or `MeshStandardNodeMaterial` APIs.

| Class member | Returns | Contract |
| --- | --- | --- |
| `new MeshLineSurfaceGeometry(options?)` | `MeshLineSurfaceGeometry` | Optionally builds one or more centerlines immediately. `isMeshLineSurfaceGeometry` is always `true`. |
| `geometry.buildLine(options?)` | `void` | Merges configuration and rebuilds when `lines` are present. |
| `geometry.setLines(points)` | `void` | Replaces centerlines and rebuilds all derived frames, joins, attributes, indices, and bounds. |
| `geometry.setPositions(points)` | `void` | Surface alias for a complete `setLines()` rebuild; range updates are intentionally unavailable. |
| `geometry.setUsage(usage, name?)` | `void` | Replaces all generated attributes, or one named attribute, with the requested usage. |
| `geometry.dispose()` | `void` | Releases geometry buffers. |
| `new MeshLineSurfaceNodeMaterial(options?)` | `MeshLineSurfaceNodeMaterial` | Optionally configures the PBR material immediately. `isMeshLineSurfaceNodeMaterial` is always `true`. |
| `material.buildLine(options?)` | `void` | Reconfigures the supported base, alpha, depth, wireframe, and surface PBR fields. |
| `material.setShadow(enabled)` | `void` | Compatibility method for the facade; surface shadows already use the generated geometry, so it performs no shader rewrite. |
| `material.dispose()` | `void` | Inherited Three.js material cleanup. |

The geometry always exposes standard `position` and `normal` attributes. It adds `uv` for texture maps, `tangent` for normal mapping (or low-level `needsTangents`), and `progress`/`side` only when explicitly requested. This keeps the default road buffer compact while remaining compatible with ordinary mesh raycasting, lighting, and tooling.

See the complete [Road Surface example](./examples/road.md) for a generated texture and standalone Three.js setup.

The interactive [Variable Topology gallery](https://meshline-demo.makio.io/examples/variable-topology) overlays wireframes for every join/cap policy and includes a split reversal case.
