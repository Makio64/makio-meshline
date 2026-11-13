# showcase/shared

Shared scaffold for the three makio-meshline v2 prototypes (A, B, C). Plain JS modules, three **0.186.1** only.

- Dev: `pnpm --dir showcase dev`, which serves http://localhost:3300/. `smoke.html` is the living example.
- Build: `pnpm --dir showcase build` (multi-page: index, a, b, c, smoke).
- Imports: `makio-meshline`, `makio-meshline/gpu-path`, `makio-meshline/gpu-culling` (live `../src`), `ultra-text` (`../../ultra-msdf-threejs/dist`), `@shared/*`, `@demo/*` (read-only `demo/src`, pure modules only). Static files come from `demo/public` (`/models/*.glb`, `/draco/`, `/textures/...`).
- `?webgl` forces WebGL2, `?timing` turns on GPU timestamps, `?nopost` skips the post pipeline.

## stage.js

```js
import { createStage, isMobile, prefersReducedMotion, query } from '@shared/stage.js'
const stage = await createStage( { background: 0x05060a, fog: { near: 10, far: 60 }, bloom: { strength: 0.6, radius: 0.35, threshold: 0 }, post: { grain: 0.025, vignette: 0.45 } } )
stage.scene.add( mesh )
const off = stage.onFrame( ( dt, elapsed ) => {} ) // seconds; returns an unsubscribe function
stage.onResize( ( w, h ) => {} )
stage.setBloom( 0.9 ) // or { strength, radius, threshold }
stage.camera.position.z = stage.fitDistance( 14, 6 ) // fit a 14 x 6 box (portrait framing)
```

- It returns `{ renderer, scene, camera, canvas, isWebGPU, backend, size: { width, height, dpr }, pointer: { x, y (NDC), clientX, clientY }, post: { pipeline, scenePass, bloomPass, grain, vignette }, maxDpr, ownsNodeFrame, setDpr, onFrame, onResize, setBloom, fitDistance, render, resize, pause, resume, dispose }`.
- The renderer is a `WebGPURenderer` with MSAA, NoToneMapping and reverseDepth off. The renderer is initialized before the promise resolves. DPR is capped at 1.5 (1.25 on phones; `maxDpr` overrides). `stage.setDpr( d )` renders at `d` from now on, kept across resizes (`null` returns to the cap): the adaptive-resolution hook perf.js uses.
- Post runs in this order: scene pass, then `+ bloom` (half resolution, 0.3 on phones), then optional `postFn( { color, sceneColor, bloomPass, scenePass } )`, then vignette and grain. `post.grain` and `post.vignette` are uniforms. While the bloom strength is 0 its passes are skipped (one last frame clears it; `bloom: { idle: false }` opts out).
- The stage runs its own rAF loop. A watchdog switches to a 16 ms timer when rAF is starved while the document is visible (hidden preview panes), so no rAF shim is needed, and it then advances the renderer's node frame itself: `time` and the scene pass keep running, once per frame. Real hidden tabs still pause.
- Frame callbacks run in registration order and the loop allocates nothing. Exports: `isMobile`, `isTouchDevice`, `isPhone`, `prefersReducedMotion`, `query`.
- Per-frame draw count: `renderer.info.render.drawCalls`. `calls` is cumulative.

## pager.js

```js
import { createPager } from '@shared/pager.js'
const pager = createPager( { count: 8, stage, labels: ['Enter', ...], hint: 'scroll', onPage: ( i ) => {} } )
stage.onFrame( () => {
	const t = pager.local( 3 )     // -1 arriving .. 0 centred .. +1 leaving (clamped); scrolling back rewinds
	const k = pager.presence( 3 )  // 1 - |local|
} )
pager.goTo( 4 ) // or goTo( 4, { instant: true } ); next(); prev(); hold( ms ) ignores input
```

- `pager.progress` is the smoothed float in 0..count-1, `pager.target` is the raw target, `pager.page` is the rounded progress, and `pager.velocity` is in pages/s.
- Inputs: wheel (normalized, 1 page per viewport-height of delta), touch drag and flick, arrows, PageUp/PageDown, Space and Shift+Space, Home/End, the dots, and the hash `#1..#n` (1-based, kept in sync).
- After 250 ms idle it snaps. A gesture that moved less than 0.1 page snaps back. Otherwise it snaps at least one page in the gesture direction, so one wheel notch turns a page.
- With reduced motion, each gesture moves exactly one page and settles faster.
- It sets the CSS vars `--page` (float) and `--page-i` on `<html>`. The UI is `.pager-dots`, `.pager-count` and `.pager-hint`; pass `ui: false` to hide it.

## text.js (ultra-text)

```js
import { createCounter, createText, loadFonts, prepareText, textIdle, FONTS, NUMBER_GLYPHS, TEXT_GLYPHS } from '@shared/text.js'
await loadFonts( ['800 1em Inter', '400 1em "JetBrains Mono"'] ) // ALWAYS before any capture
await prepareText( stage.renderer, [{ fontFamily: 'Inter', fontWeight: 800 }, { fontFamily: 'JetBrains Mono' }] ) // optional loader step: bake the shared face atlases
const title = await createText( stage.renderer, 'One Line', { fontFamily: 'Inter', fontWeight: 800, letterSpacing: '-0.04em', color: '#fff' }, { size: 1.2, align: 'center', valign: 'middle', glow: 1.2, backdrop: 0x05060a } )
title.opacity.value = 0.5 // uniforms: opacity, glow (HDR, >1 blooms), reveal (0..1 left→right wipe)
await title.setText( 'Two Lines' ) // re-capture: NOT per frame
const n = await createCounter( stage.renderer, { template: '000,000', css: { fontFamily: 'Inter', fontWeight: 800 }, size: 3 } )
n.setValue( 1646 )                    // per-frame safe: returns at once when unchanged, else rewrites a few instance attributes
n.setValue( 412, { scramble: 0.3 } )  // 30% of visible digits show random digits
await n.tween( { from: 0, to: 773, duration: 1.2 } ) // rAF-based; prefer setValue() from scroll
await textIdle() // every capture / atlas bake started so far has settled
```

- **Shared atlases:** every text and counter of one font face (family, weight, style: what the glyph raster draws) uses one SDF atlas holding `TEXT_GLYPHS` (printable ASCII, dashes, quotes, arrows, math signs, French accents), baked on first use (20–110 ms) or up front with `prepareText()`. A string with another glyph gets a private atlas and a console note; so do texts with `opts.sharedAtlas: false` or atlas-changing `opts.ultra` options (`bakeSize`, `padding`...). `quality: 'high'` texts share a mipmapped atlas per face. `sharedTextAtlas( renderer, css )` returns the atlas; `disposeTextAtlases( renderer )` frees them.

- **World size:** `size` is world units per CSS em (font-size). A single line's box is about `1.2 * size` tall. `group.width` and `group.height` are in world units. Groups are anchored by `align`/`valign`, centred by default.
- Glyphs are flat, unlit, transparent quads with `depthWrite: false` and no tone mapping. Text that is drawn after additive lines needs `renderOrder`. Fog applies.
- `createText` defaults: `observe: false`, static (no motion), `extraGlyphs = NUMBER_GLYPHS` so number edits don't re-bake, bake 160 / padding 24 (sharp giant numerals). Extra ultra options go in `opts.ultra`, for example `{ quality: 'high' }` for text seen at grazing angles.
- **Counter template:** each `'0'` is a digit slot. Other characters stay fixed (`'.'`, `','`, `'×'`, `'%'`, `'−'`, `' px'`). Integer slots and the separators left of the first digit hide while the number is short. The visible glyphs are re-packed from their own advances (no gap where hidden slots were, none between proportional figures) and their layout box is anchored by `align` like `createText` (a counter showing `'−1,111%'` is exactly as wide as that text). Use one counter per number: for `'200,000 → 1,646'`, make two counters plus a text arrow. `setDigits( str )` gives raw slot control, where `' '` hides a slot.
- WebGL2 works through the CPU SDF atlas (slower first build). Both helpers return `Group`s; call `dispose()`.
- Low-level ultra-text is also available: `import { DomText, Text, collectDomSnapshot, rasterizeGlyphAtlas, buildSdfAtlas, createGlyphGeometry, SdfTextMaterial } from 'ultra-text'`. If you call `collectDomSnapshot` yourself, pass the same `bakeSize` as the raster; otherwise glyphs come out about 0.6× too small.

## statues.js

```js
import { STATUES, STATUE_PALETTES, RING_LAYOUTS, createRingStack, loadStatueRings, proceduralRings, backInOut } from '@shared/statues.js'
const [david, venus, nefertiti] = await Promise.all( ['david', 'venus', 'nefertiti'].map( ( n ) => loadStatueRings( n ) ) ) // 64 x 96, baked, cached, 3–20 ms each
const helix = proceduralRings( { rings: 64, samples: 96 }, ( t, a, out ) => { out[0] = Math.cos( a ) * 3; out[1] = ( t - 0.5 ) * 12; out[2] = Math.sin( a ) * 3 } )
const stack = createRingStack( [helix, david, venus, nefertiti], { lineWidth: 0.03, intensity: 1.2, palettes: [[0x22d3ee, 0xffffff], null, null, null] } )
stage.scene.add( stack.line )
stack.morph.value = 1.5        // 0 helix .. 1 david .. 2 venus .. 3 nefertiti (fractional = mid-morph, bottom→top front)
stack.reveal.value = 1         // rings appear bottom→top
stack.opacity.value = 1
stack.intensity.value = 1.5    // >1 feeds bloom
stack.frontHeight()            // 0..1 height of the swelling morph front (to attach labels)
```

- Rings are pre-baked to `showcase/assets/rings/<name>-<rings>x<samples>.bin` (64 × 96 and 64 × 64 for phones, all four statues, float32 + a 32-byte header, see `ringData.js`) and fetched as Vite asset URLs: no GLB, Draco, BVH or raycast at runtime, any `size` (the data is scaled). Other layouts fall back to `traceStatueRings()` (the runtime tracer, 0.1–1 s of main-thread work) with a warning. Re-bake after a model change: `node showcase/scripts/bake-rings.mjs` (same tracer, `shared/ringTrace.js`, bit-identical output). `RING_LAYOUTS = { full, phone }`, `hasBakedRings( name, { rings, samples } )`.
- `loadStatueRings( name, { rings = 64, samples = 96, size = 12 } )` resolves to `{ name, positions: Float32Array(rings*samples*3), active: Uint8Array(rings), rings, samples, minY, maxY, radius }`. Rings run bottom→top. Ring `r` point `i` is at `( r * samples + i ) * 3`. The model is normalized like venus.js: max dimension 12, centred, y up, so a statue spans about y −6..6.
- `createRingStack` is one instanced, closed MeshLine (a single draw) with GPU positions from a float DataTexture read with `textureLoad`, so it works on WebGPU and WebGL2. `stack.setShape( i, shape )` swaps a shape in place. `palettes[i] = [base, top]` and defaults to `STATUE_PALETTES[name]`. `dispose()` cleans up.

## numbers.js

```js
import { numbers, num, BASELINE, assertPrintable } from '@shared/numbers.js'
num( 'upload773' ) // { value: '773×', nums: [773], label, comparison, source, confidence, wow, unit, note }
```

- Import every printed number from here. Never type digits for a claim.
- Baseline wording is always `BASELINE` (`'v1.2.3'`), never just "v1".
- `num()` throws on unknown ids, and on live-only ids that have `value: null`.
- Ids: upload773, bytes144, cpu350, gpuPath1646, segmentsCut, segments121, gpuPathMemory, culled400k, cullChunks, oneDraw, drawnLive, fold, notched, width100, joins, caps, roundCap16, roadVerts, discards, fullUpdate25, build20, tests366, demos, classes, typedExports, threeReleases, lorenz16k, computeCurves, statueRings, statuePoints, picker, versions, costMemory, costBundle, liveUploadBytes (null, measure live), gpuMs (null).
- Read each entry's `note`. `gpuPath1646` is a CPU-oracle constant, so never animate it as a live readback. `drawnLive` must be read live from the culling snapshot. `fold` and `notched` are documented only. `gpuPathMemory` is "vs CPU path". The `cost*` entries are footnotes only.
- 267× and 6,780× are banned.

## math.js

`clamp, lerp, invLerp, remap, smoothstep, damp, easeOutCubic, easeInOutCubic, easeOutExpo, easeInOutSine`.

## base.css

The base stylesheet: reset, fullscreen `.stage-canvas`, pager UI, `.ui-corner.tl|tr|bl` small mono labels and `.sr-only`. It also loads Google Fonts: Inter, Inter Tight, JetBrains Mono and Cormorant Garamond. Import it once per page: `import '../shared/base.css'`.
