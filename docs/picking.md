# MeshLinePicker — GPU Picking

`MeshLinePicker` answers one question efficiently: **"which line (or instance) is under the cursor right now?"**

It renders your registered MeshLines with unique ID colors to a 1×1 offscreen render target centred on the cursor, then reads back that single pixel and decodes the ID. Because it reads what was actually rendered, it works for cases where `raycast()` cannot:

- Lines with `gpuPositionNode(...)` (positions computed in the shader)
- Lines with `positionFn` hooks that change rendered geometry away from the CPU template
- Thousands of instances animated per-frame on the GPU
- Hook-driven line width, bend, sway — any visual effect is picked correctly

## When to use what

| Use case | `raycast()` | `MeshLinePicker` |
| --- | :---: | :---: |
| Static CPU-positioned line, small count | ✅ | ✅ |
| GPU-positioned line (`gpuPositionNode`) | ❌ | ✅ |
| Instanced lines, 100s–1000s of instances | slow | ✅ |
| Need exact 3D hit point (xyz) | ✅ | ❌ (returns ID only) |
| Per-frame animated geometry via hooks | unreliable | ✅ |

Rule of thumb: if the final rendered shape differs from what the raycaster would test against (GPU node, `positionFn`, per-instance transform), use the picker.

## Minimal example

```js
import { MeshLine, MeshLinePicker } from 'makio-meshline'

const line = new MeshLine()
  .instances( 1000 )
  .segments( 16 )
  .gpuPositionNode( myGpuNode )
  .color( 0xffaa00 )

scene.add( line )

const picker = new MeshLinePicker( renderer, scene, camera )
picker.add( line )

canvas.addEventListener( 'pointermove', async ( e ) => {
  const rect = canvas.getBoundingClientRect()
  const hit = await picker.pick( e.clientX - rect.left, e.clientY - rect.top )
  if ( hit ) {
    console.log( 'hovering instance', hit.instanceId, 'of', hit.line )
  }
} )
```

The returned hit is `{ line, instanceId }` — `instanceId` is `-1` for non-instanced lines.

## API

### `new MeshLinePicker( renderer, scene, camera, options? )`

- `renderer` — your `WebGPURenderer`
- `scene` — the scene the lines live in (same scene used for normal rendering)
- `camera` — the camera used for normal rendering
- `options.targetSize` — offscreen render target size in CSS pixels, default `1`. Larger sizes scan a wider neighborhood around the cursor. DPR scaling is handled internally.

### `picker.add( meshLine )`

Registers a MeshLine. Creates a picking variant of its material (shares vertex pipeline, overrides fragment to output an ID) and attaches it as a hidden sibling on the picking layer. The transform is inherited automatically.

Up to 255 lines can be registered simultaneously.

### `picker.remove( meshLine )`

Unregisters a MeshLine and disposes its picking material.

### `await picker.pick( x, y )`

- `x`, `y` — canvas-relative CSS pixels (i.e. `event.clientX - canvas.left`). DPR scaling is handled internally.
- Returns `Promise<{ line, instanceId } | null>`. `null` means the cursor is over empty space.

### `picker.dispose()`

Disposes the render target and all picking materials. Call on scene teardown.

## "Laser Heist" — raycast vs picker, side by side

The bundled [Laser Heist demo](https://meshline-demo.makio.io/#/laser-heist) renders 24 instanced GPU-positioned laser beams and lets you toggle at runtime between the two hover-test strategies (click the pill at the top or press **P**):

- **Raycast mode** uses Three.js's `Raycaster` against the instanced `MeshLine` — it relies on the CPU-known `instanceStart` / `instanceEnd` attributes to test each laser as a line segment. Simple and cheap, but only works because each laser is a straight segment whose endpoints live on the CPU.
- **MeshLinePicker mode** registers the same `MeshLine` with the GPU picker and calls `picker.pick(x, y)` on pointer move. The picker reads the rendered pixel under the cursor and decodes the instance ID.

Both strategies feed the same `hoveredLaserId`, which drives the alarm-pulse animation. Switching modes live proves they produce the same hit results.

```js
this.picker = new MeshLinePicker( renderer, scene, camera, { targetSize: 5 } )
this.picker.add( this.line )

runRaycast() {
  this.raycaster.setFromCamera( _mouseNDC, camera )
  const hit = this.raycaster.intersectObject( this.line )[ 0 ]
  this.hoveredLaserId = hit?.instanceId ?? -1
}

async runPicker() {
  const rect = renderer.domElement.getBoundingClientRect()
  const hit = await this.picker.pick( mouse.x - rect.left, mouse.y - rect.top )
  this.hoveredLaserId = hit?.line === this.line ? hit.instanceId : -1
}
```

**When to prefer the picker over raycast:**

- The line is rendered by a `gpuPositionNode` (positions are only known to the GPU) → raycast bails out entirely.
- The line is deformed by a `positionFn` hook that changes its actual visible shape → raycast would test the CPU template, not the rendered curve.
- You have thousands of instances and only need the *top-most* visible hit under the cursor → picker is a single pixel read regardless of count.

**When raycast is still the right tool:**

- Static CPU-positioned lines, small counts, and you need the exact 3D hit point (picker only returns an ID).
- You want synchronous hit detection with zero GPU roundtrip.

See the full source at [demo/src/demos/heist.js](https://github.com/Makio64/makio-meshline/blob/main/demo/src/demos/heist.js).

## Performance notes

- **Cost scales with scene complexity**, not with picker count. Each `pick()` does one render pass of the registered lines to a tiny render target, then reads back 4 bytes.
- **Throttle picks to pointer events** (or better, to `requestAnimationFrame` after a pointer event). Picking every frame for no reason wastes GPU time.
- **`targetSize: 1` is cheapest** but may miss thin lines at the very edge of a pixel. Bump to `3` if you see flaky hits on sub-pixel-wide geometry.
- **Readback is async** — `readRenderTargetPixelsAsync` does not stall the main render loop, but introduces a ~1 frame latency on the hit result. For a hover effect that's fine; for hit-precise clicks, sample on `pointerdown`.
- The picker temporarily switches the camera to a dedicated layer, clears the scene background, and restores both afterwards. Your normal render is unaffected.

## Limitations

- **No xyz hit point.** The picker returns the line/instance ID, not a 3D intersection point. If you need the point, use CPU `.raycast()` (and stick to CPU-positioned lines).
- **255 registered lines max.** The slot is encoded in one byte. Easy to bump by widening the encoding, but not needed for common scenes.
- **65k instances per line max.** Instance ID is encoded in 16 bits. Plenty for practical scenes.
- **Lines must be on screen.** Offscreen geometry won't rasterize into the picking pass and will register as a miss.
- **One pixel of precision by default.** No sub-pixel interpolation; if the line passes between pixels, the sample misses.
