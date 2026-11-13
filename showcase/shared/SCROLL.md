# Showcase core v2: scroll, camera rig, preload, perf

New shared modules that replace `pager.js` and hand-rolled cameras in the prototypes. `lab.html` (`lab/main.js`) is the living example and the test bench: 5 pages, every pattern below, `window.__lab` + `window.__probe`.

| file | what |
| --- | --- |
| `scroll.js` | `createScroll()`: native document scroll → critically damped progress → dwell plateaus. Dots, hash, keys, settle, visibility bindings. |
| `rig.js` | `createRig()`: one camera rig, keyframes per page (+ waypoints), centripetal Catmull-Rom, arc-length C1 timing, hold drift, pointer parallax. Also `createTrack()` / `createScalarTrack()` for anything else that should glide (lights, objects). |
| `preload.js` | `createPreloader()`: MeshLine progress loader, ordered steps, `warm()` (compileAsync on the real pass target + one hidden render), fade through black. |
| `perf.js` | `createPerf()`: DPR cap + adaptive DPR, phone viewport lock, `?perf` HUD, `window.__probe` (recording, scripted passes, continuity metric, pipeline log). |
| `rings.js` | `loadRings()` = `loadStatueRings()`: pre-baked statue rings (`assets/rings/<name>-64x96.bin` and `-64x64.bin`, float32, written by `node showcase/scripts/bake-rings.mjs`). No GLB, no BVH, no raycasts at runtime. |

## Boot order (copy this)

```js
import '../shared/base.css'
import { createStage } from '@shared/stage.js'
import { createScroll } from '@shared/scroll.js'
import { createPerf } from '@shared/perf.js'
import { createPreloader } from '@shared/preload.js'
import { createRig } from '@shared/rig.js'
import { loadRings } from '@shared/rings.js'

const stage = await createStage( { ... } )
const scroll = createScroll( { count: PAGES.length, stage, labels: PAGES.map( ( p ) => p.title ), slugs: PAGES.map( ( p ) => p.id ) } ) // FIRST onFrame
const perf = createPerf( stage, { scroll } )      // before the preloader: it logs every pipeline
const rig = createRig( stage.camera, { scroll, stage, keys: KEYS } )
const pre = createPreloader( stage, {
	title: 'one line',
	steps: [
		{ label: 'fonts', run: () => loadFonts( [...] ) },
		{ label: 'statues', run: async () => { rings.david = await loadRings( 'david' ) } },
		{ label: 'pages', weight: 4, run: async ( step ) => { for ( let i = 0; i < N; i++ ) { await build( i ); step.progress( ( i + 1 ) / N ) } } },
	],
	warm: () => pages.map( ( p ) => p.group ),   // default: every child of stage.scene
	compute: () => [sim.computeNode],            // optional: GPU sims dispatched once while warming
} )
pages.forEach( ( p, i ) => scroll.bind( i, p.group, { onShow: p.resume, onHide: p.pause } ) )
stage.onFrame( ( dt, t ) => {
	rig.update( scroll.progress, dt, stage.pointer )
	for ( const p of pages ) if ( p.group.visible ) p.update( scroll.local( p.index ), dt, t )
} )
await pre.done // resolves after the fade-in with the timing report
```

Rules:
- `createScroll` must be the first `stage.onFrame` subscriber (the stage runs callbacks in registration order).
- Build everything inside preloader steps. Nothing is created, compiled, decoded or `setText`'d after `pre.done`.
- The stage is paused while the loader runs; do not call `stage.render()` yourself during loading.
- `html, body` scroll natively now: do not add wheel/touch `preventDefault` handlers, `overflow: hidden`, or `touch-action: none` anywhere (base.css's are overridden by `html.ms-scroll`).

## pager.js → scroll.js mapping

| `pager.js` | `scroll.js` | note |
| --- | --- | --- |
| `createPager( { count, stage, labels, hint, onPage, ui, hash } )` | `createScroll( { count, stage, labels, hint, ui, hash, slugs } )` | same UI classes (`.pager-dots`, `.pager-count`, `.pager-hint`) |
| `pager.progress` (smoothed float) | `scroll.progress` | critically damped follow of the real scroll position |
| (none) | `scroll.mapped` | dwell-mapped progress. **Drive visuals with this** (or `local()` / `presence()`) |
| `pager.target` | `scroll.raw` | `scrollY / pageHeight`. Do not write it; call `goTo()` |
| `pager.page` | `scroll.page` | `round( mapped )` |
| `pager.velocity` | `scroll.velocity` | progress / s |
| `pager.local( i )` | `scroll.local( i )` | -1 arriving … **0 held over the whole plateau** … +1 leaving |
| `pager.presence( i )` | `scroll.presence( i )` | 1 while held, 0 one page away |
| `pager.goTo( i, { instant } )` | `scroll.goTo( i, { instant } )` | smooth programmatic scroll, cancelled by any input; pages on the way are flown through |
| `pager.next()` / `prev()` | `scroll.next()` / `prev()` | |
| `onPage: ( i ) => {}` | `scroll.onChange( ( i ) => {} )` | returns an unsubscribe |
| `pager.hold( ms )` | **removed** | no latches: a count lands because its state is a function of `local()` |
| `--page` / `--page-i` | `--page` (mapped float), `--page-i`, `--progress` (0..1) | on `<html>` |
| own wheel / touch / key handlers | native scroll | Space, PageUp/PageDown, Home/End move exactly one page (smooth); arrows, wheel, trackpad, touch momentum, scrollbar, find-in-page are native |
| `#1..#n` | `#1..#n` or `#slug` | written once a page is held (replaceState) |
| (none) | `scroll.bind( i \| [from, to], group, { margin, onShow, onHide } )` | visibility by presence, see below |
| (none) | `scroll.sections[i]` | one real `<section aria-label>` per page in the scroll track: put sr-only text (or real HTML captions) there |
| (none) | `scroll.dwellMap( p )` (static map, all held), `scroll.skip` (per page 0 held .. 1 flown), `scroll.skipSpeeds` (mutable `[from, to]`), `scroll.fixedDt` (probe), `scroll.pageHeight`, `scroll.isVisible( i, margin )`, `scroll.animating`, `scroll.dispose()` | |

Options worth knowing: `dwell` (0.35: plateau fraction of a page), `damping` (12: spring ω, about Lenis `lerp: 0.1` at 60 fps), `skip` ([1.2, 2.4] pages/s: arrival speeds between which a page goes from held to flown through; `false` = always hold), `settle` (true) / `settleDelay` (500 ms), `keys` (true), `pageHeight` (default: `100lvh` measured once; re-measured on width change on touch devices, on any resize on desktop).

Behaviour, in one place:
- **Plateaus**: page k holds over `[k - dwell/2, k + dwell/2]` of scroll and transitions in between (quintic, zero velocity and acceleration at the plateau edges). Content is exactly still while held; scrolling back rewinds exactly.
- **Momentum-aware plateaus**: the moment the scroll leaves a page toward the next one, the next page's plateau is decided for that whole transition from the arrival speed: held below `skip[0]` pages/s, flown straight through above `skip[1]`, a slow zone in between (`scroll.skip[k]` 0..1). It never changes while you are inside the transition, so the map stays a pure C2 function of progress: no lurch, no backward drift. A flown page re-holds once the scroll rests on its centre (settle lands there).
- **Flights** (dots, hash, Space/PageUp/PageDown/Home/End): eased programmatic scroll (0.6–2 s), cancelled by any input; every page on the way is flown through, the destination holds. Big native jumps (scrollbar track click, find-in-page) fly through by speed.
- **Settle**: after `settleDelay` ms with no wheel/touch/key/pointer/scroll input, a scroll resting inside a transition (or inside a flown plateau) eases (0.35–0.8 s) into the nearest held plateau. Any input cancels it instantly. Off under reduced motion.
- **Reduced motion**: progress = raw (no smoothing), instant jumps, no settle, every page held, no parallax.

## Rig keyframe how-to

```js
const C = [80, 0.5, -40] // statue centre
const arc = ( deg, y ) => [C[0] + Math.sin( deg * Math.PI / 180 ) * 20, y, C[2] + Math.cos( deg * Math.PI / 180 ) * 20]
const rig = createRig( stage.camera, {
	scroll, stage,
	parallax: { amount: 0.012, damping: 3.5 }, // fraction of camera-target distance; false to disable
	keys: [
		{ at: 0, pos: [0, 0.6, 17], target: [0, -0.4, 0], hold: [0.8, 0.2, 0], fit: [11, 11] },
		{ at: 1, pos: [27, 4, 15], target: [32, 0, -2], hold: { pos: [0, 0.4, -0.8], target: [0.4, 0, 0] }, fit: [12, 10] },
		{ at: 1.5, pos: [45, 6, 16], target: [47, 0.2, -4] },                       // waypoint (inherits fit)
		{ at: 2, pos: [62, 1.2, 9], target: [62, 0.2, -6], fov: 44, hold: [0.7, 0, 0], fit: [10, 7] },
		{ at: 3, pos: arc( -60, 1.5 ), target: [C[0] - 3, 0.5, C[2] + 2], fit: [10, 12] }, // orbit entered tangentially
		{ at: 3.33, pos: arc( -95, 2.6 ), target: [C[0] - 1.2, 0.8, C[2] + 0.6] },  // arc keys, target still gliding
		{ at: 3.67, pos: arc( -130, 3.6 ), target: [C[0], 1.1, C[2]] },
		{ at: 4, pos: arc( -160, 4.2 ), target: [C[0] + 0.5, 1.5, C[2] - 0.5], hold: { pos: [0, 0.5, 0] }, fit: [16, 16] },
	],
} )
stage.onFrame( ( dt ) => rig.update( scroll.progress, dt, stage.pointer ) )
```

- One key per page at an integer `at`; the camera is at rest there while the page is held. Fractional `at` = waypoint the camera passes through mid-transition (keep them between plateaus: `k + dwell/2 < at < k + 1 - dwell/2`).
- Position and target are one centripetal Catmull-Rom curve in pose space (`timing: 'pose'`, default): no cusps or loops, framing changes evenly, velocity is C1 everywhere, so there are zero lookAt jumps. `timing: 'separate'` gives two independent curves (a target that stops early can whip the view).
- **Orbits** are arc keys (e.g. every 30–40°) with the same target. Never spin the camera with time.
- `fov`: keep the whole range within 4° (warned). Interpolated with PCHIP, so it never overshoots.
- `roll`: radians, clamped to `maxRoll` (0.2). Only if designed.
- `hold`: world-space drift amplitude while the page is held (array = position only, or `{ pos, target }`). The camera drifts from `-hold` to `+hold` across the plateau, driven by scroll (C1 at the plateau edges). Keep it small (0.3–1 units at a distance of 15–20): it moves at plateau speed.
- `fit: [w, h, margin]`: the camera pulls back along its view line so a `w × h` box around the target fits the current aspect (portrait phones). It never moves closer than the authored distance. Put it on the page keys; waypoints and arc keys without `fit` interpolate their neighbours' pull-back ratio, so a whole sequence (an orbit) stays at one consistent distance (`fit: false` opts a key out). Re-fit is automatic on resize when `stage` is passed. Size `fit` boxes to what really must be seen: a phone pull-back of 3× makes every flight 3× longer.
- Path design rules (they are what the continuity metric catches at speed, because a page arrived at fast is flown through, not stopped at):
  - enter an orbit tangentially (the approach heading should match the arc direction at its first key);
  - do not park the target exactly on a pass-through key while the camera keeps moving (the view whips): let it glide (small offsets over the arc keys);
  - keep waypoints near the straight line between their pages; a waypoint far off the line makes a corner;
  - hold amplitudes 0.3–1 units at 15–20 units distance.
- `rig.sample( progress )` is pure (no parallax): use it in tests or to place things relative to the camera path. `rig.setKeys( keys )` rebuilds (cheap, not per frame).
- Never damp the camera on top of the rig (no `lerp( camera.position, ... )`): the progress is already damped once.

## Preload / warm pattern

- `createPreloader` pauses the stage, draws a thin ivory MeshLine progress line (through the post pipeline, so it gets bloom/grain) with a mono label + `000%`, runs `steps` in order and yields a frame after each. Long steps report `step.progress( f )`.
- `warm( groups )` (automatic at the end; also callable later for lazily built content):
  1. every object in `groups` temporarily `visible = true`, `frustumCulled = false`;
  2. `renderer.compileAsync( scene, camera )` against the scene pass render target (MSAA + HDR, so the keys match the real pass), restoring the render target immediately (frames rendered meanwhile go to the canvas);
  3. optional `compute` nodes dispatched once;
  4. one full pipeline render at `warmScale` (0.5) resolution, hidden under the loader (uploads every buffer/texture). WebGL polls shader completion with rAF, so the compile wait is capped (`compileTimeout`, 2500 ms) and this render finishes the rest;
  5. visibility and culling restored.
- Then the canvas fades out (0.35 s), the stage resumes (its first two frames, which re-allocate the full-size targets, render while the canvas is still transparent), the scene fades in (0.9 s). `pre.done` → `{ firstFrameMs, steps: [{ label, ms }], warm: { compileMs, computeMs, renderMs, objects }, loadMs, totalMs, longestStep }`.
- Check with `__probe.pipelineLog`: after `pre.done` no entry may have `sync: true`. Each sync entry = a pipeline compiled inside a frame (a hitch) and names the object.
- Never toggle material flags at runtime (`transparent`, `side`, `depthWrite`, defines, `opacity()` across 1, a new `colorFn`): each is a new pipeline. Fade with uniforms (`opacityFn` + `uniform()`), start transparent when a thing will ever fade.
- Statues: `loadRings( name )` and `loadStatueRings( name )` are the same baked loader now (one ≈ 74 KB fetch, 3–20 ms, instead of 0.1–1 s of main-thread BVH work each). Phones may pass `{ samples: 64 }` (also baked). Other layouts trace at runtime with a warning.
- ultra-text: `createText` / `createCounter` share one atlas per font face automatically (`TEXT_GLYPHS`: ASCII + typographic extras + French accents). Optional loader step: `prepareText( renderer, [css, ...] )` bakes the faces up front; `await textIdle()` waits for every capture in flight. A glyph outside `TEXT_GLYPHS` gets a private atlas (logged). Never `setText` after load; counters call `setValue` freely (it returns at once when nothing changed).

## Visibility by presence

```js
pages.forEach( ( p, i ) => scroll.bind( i, p.group, { onShow: () => p.sim?.resume(), onHide: () => p.sim?.pause() } ) )
scroll.bind( [3, 4], statueGroup )        // one object shared by two pages
scroll.bind( 6, cullingGroup, { margin: 0.5 } ) // seen from far away: show half a page earlier
```

- A bound group is visible while `|mapped - i| < 1 + margin`: only the held page while held, both pages during a transition.
- Never dispose / rebuild on page change. Hide instead (the pipelines stay warm).
- `onHide` must pause every per-frame cost of the page: `MeshLineCompute` steps, `MeshLineCullingSystem` updates, `MeshLineGPUPath` updates, `setPositions`, counters, CPU animation. Guard per-page frame work with `if ( group.visible )`.

## Perf budget

- `createPerf( stage, { scroll } )`: DPR ≤ 1.5 (1.25 on phones), ladder 1.5 → 1.25 → 1.0 → 0.75. Steps down when the median of 60 real rAF frame intervals > 18 ms (at most once per second), probes back up after 3 s of 60 fps (back-off doubles on each failed probe). `?dpr=1` pins it. DPR changes go through `stage.setDpr()` (kept across resizes). Bloom stays at the stage's half (phones 0.3) resolution and its passes are skipped while its strength is 0 (`stage.setBloom( 0 )` saves 12 quad passes a frame), MSAA stays on. The stage itself defaults to the same DPR cap, so pages without perf.js get it too.
- Phones: height-only resizes (URL bar collapse while scrolling) are swallowed: no renderer reallocation mid-scroll.
- Per frame: no allocations (`rig.update` allocates nothing; reuse vectors), no `setText`, no full `setPositions` on big arrays (`setPositionRange` or GPU), no material flag changes, no DOM reads after DOM writes.
- Budget targets on an M-class laptop: CPU ≤ 4 ms per frame median (frame callbacks + render encode), 0 sync pipelines after the loader, 0 stalls > 50 ms after the loader, loader < 4 s.
- `?perf` HUD: fps (median of real rAF frames; `-- fps (timer)` in a hidden pane), CPU ms (median of the last 60 frames, any mode), DPR, draws, triangles.

## Measuring (`window.__probe`)

```js
const r = await __probe.scriptedPass( { pxPerFrame: 16, pages: [0, 4] } ) // drives window.scrollTo per stage frame, fixed 1/60 s spring step
r.summary   // { frames, cpuMs: { median, p95, max }, newPipelines, heavyFrames, stalls, maxStallMs, maxSpeed, maxAngSpeed, maxDegPerProgress, fovRange, spikes, angSpikes, worstRatio, worstAngRatio }
r.continuity.spikes // [{ frame, progress, delta, ratio }]: |Δv| > 3 × rolling median of ±6 frames (and > 5% of the pass max |Δv|); angSpikes: same on the angular velocity vector
__probe.startRecording(); /* ... */ __probe.stopRecording() // { frames: [{ t, dt, cpuMs, renderMs, progress, mapped, raw, pos, dir, fov, draws, tris, pipelines }], longTasks, stalls }
__probe.continuity( frames ) // the shared metric
__probe.pipelineLog // [{ t, sync, object, material, colorSpace, progress }]
__probe.snapshot()  // { dpr, fps, cpuMs, drawCalls, triangles, pipelines, geometries, textures, heapMB, gpuErrors, rafAlive }
```

- Run probe calls without awaiting them in the devtools-protocol script (store the result on `window` and poll): `history.replaceState` for the hash counts as a navigation for some harnesses and cuts long awaits. Every agent edit of a showcase/src module makes Vite full-reload every open page: re-run a pass that a reload interrupted.
- In a hidden pane rAF is starved: the stage falls back to a 16 ms timer and advances the renderer's node frame itself (once per stage frame, so `time` and the scene pass keep running; no page workaround needed). Wall-clock fps there is meaningless; CPU ms, stalls, pipelines and the continuity metric (fixed-dt) are valid. `longtask` entries are not delivered in that pane: `stalls` (a 16 ms heartbeat while recording) replaces them.

## Lab numbers (2026-10-20, M-class Mac, hidden Browser pane, WebGPU unless noted)

Scripted passes (`__probe.scriptedPass`, fixed 1/60 s spring step, page height 800 px, 5 pages, both directions):

| px / frame | pages / s | spikes (lin / ang) | worst ratio (lin / ang) | max speed | max ang. speed | CPU ms median / max | new pipelines | stalls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | 0.45 | 0 / 0 both ways | 1.80 / 2.11 | 53 u/s | 126°/s | 1.0 / 1.5 (warm) | 0 | 0 |
| 16 | 1.2 | 0 / 0 both ways | 1.89 / 2.07 | 142 u/s | 337°/s | 0.9 / 1.6 | 0 | 0 |
| 24 | 1.8 | 0 / 0 both ways | 2.21 / 2.92 | 182 u/s | 475°/s | 0.9 / 1.9 | 0 | 0 |
| 40 (stress) | 3.0 | 1 / 4 and 1 / 2 | 3.55 / 3.51 | 202 u/s | 518°/s | 1.0 / 1.9 | 0 | 0 |

- Dot click 0 → 3: 117 frames (≈ 2 s), pages 1–2 flown, page 3 held, 0 / 0 spikes (worst 1.82 / 2.12). Hash `#2`, PageDown, Space, End, PageUp, Home all land on the right page; settle from the middle of a transition starts ≈ 0.5 s after the last input and lands in the plateau.
- Loader: steps 0.1–0.6 s (baked rings 6–17 ms for two statues, ultra-text 45–80 ms), `compileAsync` 80–170 ms, warm render 14–300 ms, total incl. fades 2.0–2.9 s. 0 pipelines compiled after the loader; first 120 frames after it: 0 new pipelines, CPU max 16 ms (the full-size target re-allocation, hidden under the fade).
- WebGL2 (`?webgl`): 16 px passes 0 / 0 spikes, CPU 0.8–0.9 ms median, 0 new pipelines. In a hidden pane its compile polling is rAF-bound (hence `compileTimeout`).
- Phone 390 × 844 (Android emulation): DPR 1.25 (device 2), touch scroll CSS active, canvas height locked, `fit` pulls page 0 back to z 31.6; 6 / 16 / 24 px passes 0 / 0 spikes both ways (worst 2.99 / 2.75).
- Resize 1280 × 800 → 1100 × 700: page height 800 → 700, scroll position kept on the same page (raw 2 → 2), DPR kept at 1.5, 0 GPU errors.
- The first ~15 s after a load show a few 10–48 ms CPU frames that are not pipelines, not GC (no heap drop) and not repeatable on a second pass: JIT warm-up and other agents' pages sharing the dev browser. Steady state: no frame over 2 ms.
- `lab.html` is dev-only (not in `vite.config.js` build inputs: adding it restarts the shared dev server).

## Gotchas found while building the lab

- three r186 keys `RenderContext`s by attachment state only. The post scene pass target and the renderer's own frame-buffer target (canvas render with sRGB output) share one context, so a direct canvas render during `compileAsync` swaps its textures (colour space `''` ↔ `srgb-linear`) and every pipeline compiles in the wrong variant, then again synchronously on first show. `PassNode.compileAsync` also leaves the pass target bound across its awaits, so any frame rendered meanwhile draws the output quad into the pass texture (WebGPU validation error, dropped frame). `preload.js` handles both: loader drawn through the pipeline, render target restored right after `compileAsync` starts. If you warm anything yourself, use `pre.warm()`.
- `MeshLine.opacity()` crossing 1 toggles `transparent` → recompile. Use `.transparent( true ).opacityFn( ... uniform ... )`.
- MeshLine's automatic frustum culling (`opacityFn` only) culls by the geometry bounds: lines placed far from their page group origin pop in by bounds, which is fine, but `warm()` disables culling so they are compiled anyway.
