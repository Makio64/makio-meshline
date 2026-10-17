# Project Guidelines

## Architecture

- `src/` is the published `makio-meshline` package. The main public surface is `MeshLine`, with `MeshLineGeometry`, `MeshLineNodeMaterial`, and `MeshLinePicker` available for advanced use.
- Keep `MeshLine` as the preferred entry point in docs and examples unless the task is explicitly about low-level geometry, material, or picking behavior.
- The library is TSL-first and should remain compatible with Three.js WebGPU/WebGL2 backends. Do not add runtime dependencies beyond Three.js.

## Code Style

- Use `pnpm` from the workspace root.
- Match the existing JavaScript style: tabs, no semicolons, and spaced calls such as `fn( value )`.
- Prefer `Float32Array` for point data in performance-sensitive code and reusable examples.
- Keep reusable examples copy-paste friendly: explicit imports, small helper functions, clear prop names, and no hidden demo-only utilities.

## Examples And Docs

- Treat Vue and React Three Fiber support as first-class integration surfaces for the library, not incidental demos.
- Keep the center of demo canvases clear. New demos should omit the generic `this.text` instruction overlay; place essential copy in unobtrusive edge-aligned UI or integrate short labels into the scene composition.
- Framework wrappers in `examples/` should read like starter code users can drop into their own projects.
- Keep framework wrappers aligned with the public `MeshLine` API and `MeshLineConfigureOptions`: if a prop is exposed, wire its build and update behavior; if an API is intentionally omitted, document that the wrapper covers only common options.
- Keep docs pages aligned with the actual files under `examples/react-three-fiber/src/` and `examples/vue/src/`.
- If a wrapper exposes only common options, say so. If it claims broader API coverage, wire the corresponding props and update behavior.

## Verification

- Run `pnpm lint` after source or demo edits.
- Run `pnpm test` and `pnpm test:types` after library or demo changes.
- Run `pnpm build` for demo-facing changes and `pnpm docs:build` for documentation changes.
- Run `pnpm --filter makio-meshline-r3f-example build` and `pnpm --filter makio-meshline-vue-example build` after touching standalone examples.

---

## Quick Reference for AI Agents Using `makio-meshline`

### 1. Package Entry Points
- **`makio-meshline`** (Three.js r180+):
  - `MeshLine` (default & named export) — fluent facade extending `THREE.Mesh`
  - `MeshLineGeometry`, `MeshLineNodeMaterial` — screen-space billboard geometry & TSL material
  - `MeshLineSurfaceGeometry`, `MeshLineSurfaceNodeMaterial` — world-space lit ribbon/road geometry & PBR material
  - `MeshLineCompute` — WebGPU compute-driven autonomous/interactive curves
  - `MeshLinePicker`, `MeshLinePickerHelper` — GPU offscreen pixel picker & debug overlay
  - `lineCoord` — normalized stroke silhouette coordinate (`vec2`, `y` in `[-1, 1]`) for TSL hooks
  - Position helpers: `circlePositions`, `squarePositions`, `rectanglePositions`, `sineWavePositions`, `straightLine`, `straightLineBetween`, `storagePositions`
- **`makio-meshline/gpu-culling`** (Three.js r183+ WebGPU):
  - `MeshLineCullingSystem` — per-chunk frustum culling + indirect draw compaction
- **`makio-meshline/gpu-path`** (Three.js r183+ WebGPU):
  - `MeshLineGPUPath` — point-centric GPU path with optional multi-stride simplification and automatic CPU fallback

### 2. Golden Rules (Avoid Common Mistakes)
1. **Renderer**: Always use `WebGPURenderer` from `'three/webgpu'` and `await renderer.init()` before rendering. It automatically falls back to WebGL2 where WebGPU is unavailable.
2. **TSL `Fn()` Array Destructuring**: When writing TSL hooks with `Fn()`, **always destructure the first array argument**:
   - Correct: `.colorFn( Fn( ( [color, progress, side] ) => ... ) )`
   - Wrong: `.colorFn( Fn( ( color, progress, side ) => ... ) )`
3. **Auto-Build vs Explicit `.build()`**:
   - `scene.add( line )` automatically calls `line.build()`.
   - Call `line.build()` explicitly **before** calling `line.addVertexAttribute()`, `line.addVertexAttributes()`, `line.addInstanceAttribute()`, or `line.addInstanceAttributes()` if the line is not yet in the scene.
4. **Updating Points Without Rebuilding**:
   - Same point count per frame: set `.dynamic( true )` once, then call `line.setPositions( points )` or `line.setPositionRange( slice, startPoint, { lineIndex } )` each frame.
   - Changing point count or open/closed topology: call `line.lines( newPoints, closed )` or alias `line.points( newPoints, closed )` (and `options.points` or `options.lines` in `new MeshLine( options )`).
5. **WebGPU 8-Vertex-Buffer Limit**:
   - Pack multiple custom instance or vertex attributes into a single interleaved buffer via `line.addInstanceAttributes( { offset: 3, phase: 1 } )` instead of separate `addInstanceAttribute()` calls.
6. **Viewport Resize & Cleanup**:
   - Use `.autoResize()` or call `line.resize( width, height )` on window resize, and always call `line.dispose()` when removing a line permanently.

### 3. TSL Hook Signatures (All Destructure `[...]`)
| Method | Signature inside `Fn( ( [...] ) => ... )` | Returns |
|---|---|---|
| `.gpuPositionNode( fn )` | `( [progress, extra] )` | `vec3` (world/local position) |
| `.positionFn( fn )` | `( [position, progress] )` | `vec3` (applied to current, previous & next) |
| `.previousFn( fn )` / `.nextFn( fn )` | `( [position, progress] )` | `vec3` |
| `.widthFn( fn )` | `( [width, progress, side] )` | `float` |
| `.normalFn( fn )` | `( [normal, dir, dir1, dir2, progress, side] )` | `vec4` |
| `.colorFn( fn )` | `( [color, progress, side] )` | `vec3` or `vec4` |
| `.gradientFn( fn )` | `( [factor, side] )` | `float` |
| `.opacityFn( fn )` | `( [alpha, progress, side] )` | `float` |
| `.dashFn( fn )` | `( [cyclePosition, progress, side] )` | `float` |
| `.uvFn( fn )` | `( [uv, progress, side] )` | `vec2` |
| `.vertexFn( fn )` | `( [clipPosition, normal, progress, side] )` | `vec4` |
| `.fragmentColorFn( fn )` | `( [color, uv, progress, side] )` | `vec3` or `vec4` |
| `.fragmentAlphaFn( fn )` | `( [alpha, uv, progress, side] )` | `float` |
| `.discardFn( fn )` | `( [progress, side, uv] )` | `bool` |

### 4. Minimal Copy-Paste Recipes

#### Screen-Space Line with Gradient & Dashes
```js
import { MeshLine, circlePositions } from 'makio-meshline'

const line = new MeshLine()
	.lines( circlePositions( 64, 3 ), true )
	.lineWidth( 0.2 )
	.color( 0xff6600 )
	.gradientColor( 0xffffff )
	.dash( { count: 12, ratio: 0.5 } )
	.autoResize()
scene.add( line )
```

#### World-Space Lit Surface / Road with Banking & Bevel/Round Joins
```js
const road = new MeshLine()
	.lines( roadPoints, false )
	.lineWidth( 4 )
	.surface( { frame: 'fixed-up', up: [0, 1, 0], bank: bankAngles, uvMode: 'distance', uvScale: 6 } )
	.join( { type: 'round', limit: 3, segments: 8 } )
	.cap( { type: 'round', segments: 8 } )
	.shadow( true )
	.build()
scene.add( road )
```

#### GPU Storage Buffer Trails & Contour/Isobar Morphing
```js
import { MeshLine, storagePositions } from 'makio-meshline'
import { uniform } from 'three/tsl'
import { StorageBufferAttribute } from 'three/webgpu'

const fromBuffer = new StorageBufferAttribute( COUNT * POINTS_PER_LINE, 3 )
const toBuffer = new StorageBufferAttribute( COUNT * POINTS_PER_LINE, 3 )
const uMorph = uniform( 0 )

const line = new MeshLine()
	.instances( COUNT )
	.segments( POINTS_PER_LINE - 1 )
	.gpuPositionNode( storagePositions( fromBuffer, {
		pointsPerLine: POINTS_PER_LINE,
		toBuffer,
		morph: uMorph,
		closed: true,
	} ) )
	.lineWidth( 0.1 )
	.build()
```

