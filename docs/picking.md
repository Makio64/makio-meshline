# MeshLinePicker — GPU Picking

`MeshLinePicker` answers one question efficiently: **"which line (or instance) is under the cursor right now?"**

It renders your registered MeshLines with unique ID colors to a 1×1 offscreen render target centred on the cursor, then reads back that single pixel and decodes the ID. Because it reads what was actually rendered, it works for cases where `raycast()` cannot:

- Lines with `gpuPositionNode(...)` (positions computed in the shader)
- Lines with `positionFn` hooks that change rendered geometry away from the CPU template
- Thousands of instances animated per-frame on the GPU
- Hook-driven line width, bend, sway — any visual effect is picked correctly

<svg viewBox="0 0 820 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Picker architecture: one camera, two scenes" style="max-width:100%;height:auto;display:block;margin:1.5em auto;">
  <defs>
    <marker id="picker-arch-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="20" y="110" width="140" height="60" rx="10" ry="10" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="90" y="138" text-anchor="middle" font-size="14" fill="currentColor">Camera</text>
  <text x="90" y="156" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">user's camera</text>
  <path d="M 160 140 Q 195 140 195 70 L 210 70" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#picker-arch-arrow)"/>
  <path d="M 160 140 Q 195 140 195 210 L 210 210" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#picker-arch-arrow)"/>
  <rect x="215" y="40" width="180" height="60" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="305" y="68" text-anchor="middle" font-size="14" fill="currentColor">User scene</text>
  <text x="305" y="86" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">normal materials</text>
  <line x1="395" y1="70" x2="430" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#picker-arch-arrow)"/>
  <rect x="435" y="40" width="170" height="60" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="520" y="68" text-anchor="middle" font-size="14" fill="currentColor">Screen canvas</text>
  <text x="520" y="86" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">what the user sees</text>
  <rect x="215" y="180" width="180" height="60" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="305" y="208" text-anchor="middle" font-size="14" fill="currentColor">Picking scene</text>
  <text x="305" y="226" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">proxies · ID material</text>
  <line x1="395" y1="210" x2="430" y2="210" stroke="currentColor" stroke-width="1.5" marker-end="url(#picker-arch-arrow)"/>
  <rect x="435" y="180" width="130" height="60" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="500" y="208" text-anchor="middle" font-size="14" fill="currentColor">N×N RT</text>
  <text x="500" y="226" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">GPU texture</text>
  <line x1="565" y1="210" x2="600" y2="210" stroke="currentColor" stroke-width="1.5" marker-end="url(#picker-arch-arrow)"/>
  <rect x="605" y="180" width="190" height="60" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="700" y="208" text-anchor="middle" font-size="14" fill="currentColor">CPU readback → ID</text>
  <text x="700" y="226" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">async, ~1 frame latency</text>
</svg>

The picker keeps a parallel **picking scene** alongside your regular scene, holding lightweight proxy meshes that share your lines' geometry but render with an ID-encoding material. Both scenes are driven by the same camera — the user's scene draws to the canvas as usual, while the picking scene is rendered on demand into a tiny offscreen target and read back for the hit ID.

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

## How `pick()` works

<svg viewBox="0 0 800 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Picker pipeline" style="max-width:100%;height:auto;display:block;margin:1em auto;">
  <defs>
    <marker id="picker-pipe-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="10" y="40" width="170" height="60" rx="10" ry="10" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="95" y="68" text-anchor="middle" font-size="14" fill="currentColor" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">pick(x, y)</text>
  <text x="95" y="86" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">canvas CSS px</text>
  <line x1="180" y1="70" x2="212" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#picker-pipe-arrow)"/>
  <rect x="215" y="40" width="170" height="60" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="300" y="68" text-anchor="middle" font-size="14" fill="currentColor">Render picking scene</text>
  <text x="300" y="86" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">IDs → tiny RenderTarget</text>
  <line x1="385" y1="70" x2="417" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#picker-pipe-arrow)"/>
  <rect x="420" y="40" width="170" height="60" rx="10" ry="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="505" y="68" text-anchor="middle" font-size="14" fill="currentColor">Async readback</text>
  <text x="505" y="86" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">4 bytes · RGBA</text>
  <line x1="590" y1="70" x2="622" y2="70" stroke="currentColor" stroke-width="1.5" marker-end="url(#picker-pipe-arrow)"/>
  <rect x="625" y="40" width="170" height="60" rx="10" ry="10" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="710" y="68" text-anchor="middle" font-size="14" fill="currentColor">Decode → hit</text>
  <text x="710" y="86" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">{ line, instanceId }</text>
</svg>

Each call to `picker.pick(x, y)`:

1. Re-centres the frustum on the pixel at `(x, y)` with `camera.setViewOffset(...)` — a viewport trick that focuses the full frame into the tiny render target without touching scene state.
2. Renders the internal picking scene into an offscreen render target. Each registered line's proxy uses a picking material that outputs a unique ID color instead of shading.
3. Reads the RT back via `readRenderTargetPixelsAsync(...)` — 4 bytes, no main-loop stall.
4. Decodes the bytes and returns `{ line, instanceId }` or `null`.

### ID encoding

Every fragment rendered in the picking pass writes a 4-byte color whose channels carry the hit identity:

<svg viewBox="0 0 700 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="RGBA ID encoding" style="max-width:100%;height:auto;display:block;margin:1em auto;">
  <rect x="30" y="30" width="150" height="90" rx="10" ry="10" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="105" y="60" text-anchor="middle" font-size="24" font-weight="600" fill="currentColor" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">R</text>
  <text x="105" y="88" text-anchor="middle" font-size="13" fill="currentColor">line slot</text>
  <text x="105" y="106" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">1–255</text>
  <rect x="195" y="30" width="150" height="90" rx="10" ry="10" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="270" y="60" text-anchor="middle" font-size="24" font-weight="600" fill="currentColor" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">G</text>
  <text x="270" y="88" text-anchor="middle" font-size="13" fill="currentColor">instance hi</text>
  <text x="270" y="106" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">(id &gt;&gt; 8) &amp; 0xff</text>
  <rect x="360" y="30" width="150" height="90" rx="10" ry="10" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="435" y="60" text-anchor="middle" font-size="24" font-weight="600" fill="currentColor" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">B</text>
  <text x="435" y="88" text-anchor="middle" font-size="13" fill="currentColor">instance lo</text>
  <text x="435" y="106" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">id &amp; 0xff</text>
  <rect x="525" y="30" width="150" height="90" rx="10" ry="10" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="600" y="60" text-anchor="middle" font-size="24" font-weight="600" fill="currentColor" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">A</text>
  <text x="600" y="88" text-anchor="middle" font-size="13" fill="currentColor">hit mask</text>
  <text x="600" y="106" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">1 = fragment hit</text>
  <path d="M 195 145 L 195 158 L 510 158 L 510 145" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <line x1="352.5" y1="158" x2="352.5" y2="172" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
  <text x="352.5" y="192" text-anchor="middle" font-size="13" fill="currentColor">16-bit instance ID (0 – 65 535)</text>
</svg>

- **R** (1 byte) — slot ID assigned to the line by `picker.add()`. `0` means empty (no hit).
- **G + B** (2 bytes) — 16-bit instance index, decoded as `instanceId = (g << 8) | b`. Returned as `-1` for non-instanced lines.
- **A** — constant `1`; the alpha channel acts purely as a hit mask so the decoder can ignore background pixels.

This fits up to **255 lines × 65 536 instances** per pass.

## API

### `new MeshLinePicker( renderer, scene, camera, options? )`

- `renderer` — your `WebGPURenderer`
- `scene` — the scene the lines live in (same scene used for normal rendering)
- `camera` — the camera used for normal rendering
- `options.targetSize` — offscreen render target size in CSS pixels, default `1`. Larger sizes scan a wider neighborhood around the cursor. DPR scaling is handled internally.
- `options.hitRadius` — multiplier applied to each registered line's width when drawn into the picking pass, default `15`. Lets thin lines be picked reliably without making them visually thicker. Set to `1` to pick against the exact rendered width.

### `picker.add( meshLine )`

Registers a MeshLine. Creates a picking variant of its material (shares vertex pipeline, overrides fragment to output an ID) and attaches it as a hidden sibling on the picking layer. The transform is inherited automatically.

Up to 255 lines can be registered simultaneously.

### `picker.remove( meshLine )`

Unregisters a MeshLine and disposes its picking material.

### `await picker.pick( x, y )`

- `x`, `y` — canvas-relative CSS pixels (i.e. `event.clientX - canvas.left`). DPR scaling is handled internally.
- Returns `Promise<{ line, instanceId } | null>`. `null` means the cursor is over empty space.

### `picker.lines`

Read-only snapshot of the currently registered MeshLines in registration order. Returns a fresh array each call.

### `picker.debugScene` and `picker.updateDebug()`

For *raw* debugging, render `picker.debugScene` directly to inspect the ID-colored picking proxies. Call `picker.updateDebug()` before rendering that scene so proxy transforms, visibility, render order, instance count, resolution, DPR, and effective hit width match the live lines. Colors here are the encoded slot/instance IDs — useful for verifying the picking pipeline, but not visually meaningful. For a *human-readable* overlay, prefer `MeshLinePickerHelper` below.

### `picker.dispose()`

Disposes the render target and all picking materials. Call on scene teardown.

## `MeshLinePickerHelper` — visualize hit-zones

`MeshLinePickerHelper` is a Three.js-style helper (in the spirit of `BoxHelper` / `SkeletonHelper`) that renders the picker's wide hit-zone proxies *with human-readable colors*, overlaid on your scene. Each registered line / instance gets a distinct hue (golden-ratio cosine palette) so you can see exactly what the GPU picker is testing against without losing the rest of the scene.

It's a `Group` containing one shared-geometry proxy mesh per registered line, sized to `hitRadius × lineWidth` and rendered with a transparent colored material. The helper does **not** participate in picking — it's purely a debug visualization.

```js
import { MeshLinePicker, MeshLinePickerHelper } from 'makio-meshline'

const picker = new MeshLinePicker( renderer, scene, camera, { hitRadius: 15 } )
picker.add( meshLine )

const helper = new MeshLinePickerHelper( picker, { opacity: 0.45 } )
scene.add( helper )

// in your render loop:
helper.update()

// toggle:
helper.visible = false
```

### `new MeshLinePickerHelper( picker, options? )`

- `picker` — an existing `MeshLinePicker` with one or more registered lines.
- `options.opacity` — overlay alpha (0..1). Default `0.45`.

The helper snapshots the picker's registry at construction. If you call `picker.add()` / `picker.remove()` afterwards, call `helper.rebuild()` to re-snapshot.

### `helper.update()`

Sync each proxy's transform, instance count, and width from its source line. Call once per frame before rendering. Cheap (one matrix copy + a few uniform writes per registered line).

### `helper.setOpacity( value )`

Update the overlay alpha at runtime (e.g. for a fade-in/out). Affects all proxies.

### `helper.rebuild()`

Tear down existing proxies and rebuild from the picker's current registry. Use after `picker.add()` / `picker.remove()` to keep the helper in sync.

### `helper.dispose()`

Dispose all proxy materials and detach them from the helper. Geometries are owned by the source lines and are **not** disposed — so disposing the helper is safe even while the lines are still in use.

See it live in the [Laser Heist demo](https://meshline-demo.makio.io/#/laser-heist) — pressing **P** cycles through `raycast` → `picker` → `picker-debug`, where the third state turns the helper on while picking continues to run through the GPU picker.

## "Laser Heist" — raycast vs picker, side by side

The bundled [Laser Heist demo](https://meshline-demo.makio.io/#/laser-heist) renders 24 instanced GPU-positioned laser beams and cycles through three hover-test modes at runtime (click the pill at the top or press **P**):

- **Raycast mode** uses Three.js's `Raycaster` against the instanced `MeshLine` — it relies on the CPU-known `instanceStart` / `instanceEnd` attributes to test each laser as a line segment. Simple and cheap, but only works because each laser is a straight segment whose endpoints live on the CPU.
- **MeshLinePicker mode** registers the same `MeshLine` with the GPU picker and calls `picker.pick(x, y)` on pointer move. The picker reads the rendered pixel under the cursor and decodes the instance ID.
- **Picker debug mode** keeps the GPU picker active and adds a `MeshLinePickerHelper` overlay so you can see each laser's hit-zone (sized to `hitRadius × lineWidth`) painted with a distinct per-instance hue.

All three modes feed the same `hoveredLaserId`, which drives the alarm-pulse animation. Switching modes live proves the CPU and GPU strategies produce the same hit results, and the debug overlay makes the GPU picker's hit zones inspectable.

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
