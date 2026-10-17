---
description: "Migrate Makio MeshLine v1 applications to V2, including changed defaults, arc-length progress, stricter validation, surface geometry, and optional WebGPU entry points."
---

# Migrating from v1 to V2

::: tip Version 2
The publishable package and these pages describe `2.0.0`. V2-only imports and behavior are not available from a V1 installation.
:::

The preferred entry point is still `MeshLine`, and an ordinary camera-facing line needs no new wrapper or low-level class. V2 adds a separate world-space surface profile, optional native-WebGPU accelerators, stricter input validation, and more precise path metadata.

## Compatibility at a glance

| Profile | Three.js | Renderer/backend | Status |
| --- | --- | --- | --- |
| `makio-meshline` | r180+ | `WebGPURenderer` with WebGPU or WebGL2 | Main cross-backend API |
| `makio-meshline/gpu-culling` | r183+ | Native WebGPU | Optional, conservative accelerator |
| `makio-meshline/gpu-path` | r183+ | Native WebGPU | Experimental, with a CPU `MeshLine` fallback |

Update both packages together and test both renderer backends used by your application:

```bash
pnpm up makio-meshline@^2 three@^0.183
```

Three.js r183 is only required when importing an optional native-WebGPU entry point. The main entry remains compatible with r180+.

## Behavior changes to review

### Sharp-bend smoothing is opt-in

V1 automatically subdivided sufficiently sharp CPU paths. V2 keeps the authored logical-point topology by default:

```js
const line = new MeshLine()
	.lines( points )
	.smoothSharpBends( true ) // preserve V1-style CPU subdivision when wanted
```

Enabling it changes the logical-point count before GPU expansion. Leave it off for dynamic paths, custom per-vertex data, or code that relies on a stable point mapping. Regular billboard geometry does not have a one-physical-vertex-per-point layout; see the next section.

### Billboard custom attributes have four physical rows per point

The regular CPU billboard now stores `[incoming+, incoming-, outgoing+, outgoing-]` for every logical point. Segment indices connect the outgoing pair at one point to the incoming pair at the next. This lets WebGPU and WebGL2 reconstruct the two incident bodies independently when projection makes a join reverse or a segment nearly end-on, avoiding crossed sides and bowtie wedges. A managed `joinRole` attribute packs these rows as `[-1, -2, +1, +2]`: the sign preserves incoming/outgoing ownership and the magnitude preserves the `+/-` side through `BufferGeometry.toNonIndexed()`.

`addVertexAttribute()` therefore allocates `4 * logicalPointCount` rows for a single unsmoothed billboard line. Expand point-scoped values across all four rows, and remember that `setVertexValues()` takes a physical `startVertex`:

```js
const weights = line.addVertexAttribute( 'customWeight', 1 )
const logicalPointCount = weights.count / 4

for ( let pointIndex = 0; pointIndex < logicalPointCount; pointIndex++ ) {
	const value = pointWeights[pointIndex]
	weights.array.fill( value, pointIndex * 4, pointIndex * 4 + 4 )
}
weights.needsUpdate = true
```

Regular billboard geometry can now be converted with `toNonIndexed()` without enabling `needsSide`; the built-in material decodes both properties from the copied `joinRole` values. Enable `needsSide` only when a custom low-level consumer requires a separate literal side attribute. `joinRole` is internal, always generated, and should not be replaced by a custom attribute.

### Progress follows distance

For CPU paths, normalized `progress`, default UVs, dashes, gradients, and `widthCallback` now follow cumulative arc length instead of point index. Unevenly sampled paths therefore render effects at even physical distances. Review effects that deliberately depended on sample density.

```js
const line = new MeshLine()
	.lines( points )
	.widthCallback( ( progress, pointIndex, lineIndex ) => {
		return 0.25 + progress * 0.75
	} )
```

Low-level geometry consumers that read `progress` directly should request it with `needsProgress: true`; the façade creates optional attributes only when an active feature needs them.

### Invalid configuration fails early

V2 throws for non-finite points and out-of-range values instead of allowing invalid data to reach a GPU buffer. In particular, audit `segments`, `lineWidth`, opacity/alpha-test values, dash settings, render dimensions, join limits, and join/cap segment counts. Validate user-controlled values before passing them to `MeshLine`.

### Culling uses safer defaults

The CPU centerline cannot conservatively bound arbitrary shader-generated positions or CSS-pixel expansion at every camera distance. V2 disables object frustum culling by default for `gpuPositionNode`, `sizeAttenuation: false`, and the geometry-deforming `positionFn`, `previousFn`, `nextFn`, `widthFn`, `normalFn`, and `vertexFn` hooks. Re-enable it only after supplying bounds that include all deformation and projected width:

```js
line.geometry.boundingBox = conservativeBox
line.geometry.boundingSphere = conservativeSphere
line.setFrustumCulled( true )
```

### Join and cap policies depend on the profile

The normal billboard profile supports `join: { type: 'miter' | 'bevel' | 'round', limit, fold: 'geometry' | 'exact' | false }`: `'geometry'` (default) splits projected 3D folds in the vertex stage with no fragment cost, `'exact'` clips folds and `'round'` joins to an exact round silhouette in the fragment stage, and `'bevel'` uses a 4-vertex-per-corner split strip. Geometric arc-fan topology and `cap: { type: 'square' | 'round' }` are features of the world-space surface profile and the experimental native-WebGPU path.

## Choose the rendering profile explicitly

Use the default profile for camera-facing strokes, dashes, gradients, GPU positions, instancing, and the complete TSL hook set:

```js
const stroke = new MeshLine( {
	lines: points,
	lineWidth: 0.35,
	color: 0x22d3ee,
} ).build()
```

Use `.surface()` for a camera-independent, lit road or ribbon:

```js
const road = new MeshLine()
	.lines( points )
	.lineWidth( 4 )
	.surface( { frame: 'transport', uvMode: 'distance', uvScale: 5 } )
	.join( { type: 'round', segments: 8 } )
	.cap( { type: 'round', segments: 8 } )
	.build()
```

Surface mode requires CPU centerline points and does not currently support façade instancing. Billboard-only dashes, gradients, size attenuation, and TSL deformation hooks do not transfer to the lit surface material. See [World-Space Surfaces](./surface.md) for its supported PBR maps and frame policy.

Use [GPU Culling](./gpu-culling.md) only for a measured, very large opaque packed path, and use the [experimental GPU Path](./gpu-path.md) only when its single-open-line profile and fallback visuals are acceptable.

## Prefer the bulk update APIs

V2 keeps `setPositions()` for same-capacity updates and adds narrower uploads for stable layouts:

```js
line.setPositionRange( changedPoints, startPoint, {
	lineIndex: 0,
	updateBounding: true,
} )

line.addVertexAttribute( 'customWeight', 1 )
line.setVertexValues( 'customWeight', packedPhysicalWeights, startPhysicalVertex )

instancedLine.addInstanceAttribute( 'instanceOffset', 3 )
instancedLine.setInstanceValues( 'instanceOffset', packedOffsets, startInstance )
```

`setPositionRange()` is for CPU billboard lines only and cannot change topology. Use `setPositions()` for surfaces or a full rebuild when the point count changes.

## Application migration checklist

- [ ] Upgrade `makio-meshline` and Three.js together; use r183+ if an optional WebGPU entry point is imported.
- [ ] Compare sharp paths with `smoothSharpBends` off and opt in only where subdivision is intended.
- [ ] Check dashes, gradients, width callbacks, UV-dependent effects, and custom hooks on unevenly spaced points.
- [ ] Validate values coming from UI, files, or network data before configuring a line.
- [ ] Test open endpoints, closed seams, duplicate points, reversals, near-plane crossings, and large coordinates used by the application.
- [ ] Choose screen-stroke or surface semantics explicitly; do not expect billboard-only styling to carry into a lit surface.
- [ ] Review bounds and frustum-culling overrides for CSS-width, GPU-positioned, hooked, or instanced lines.
- [ ] Replace repeated scalar attribute writes with the bulk update helpers where the layout is stable.
- [ ] Exercise WebGL2 fallbacks if the application supports WebGL2, and inspect `status` when using an optional native-WebGPU system.
- [ ] Dispose rebuilt lines, textures, culling handles, and framework-owned wrappers during teardown.

For the engineering guarantees behind these changes, read the [V2 Design Contract](./v2-design.md).
