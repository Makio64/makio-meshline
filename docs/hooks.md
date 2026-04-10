---
description: "Complete guide to the 14 TSL hooks in Makio MeshLine for customizing vertex positions, line width, colors, opacity, dashes, UVs, and fragment output."
---

# TSL Hooks Guide

Makio MeshLine exposes **14 GPU hooks** that let you inject custom [TSL (Three.js Shading Language)](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) logic at every stage of the rendering pipeline. Hooks run entirely on the GPU for maximum performance.

## Pipeline Overview

```
                         VERTEX SHADER
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Positions ─── positionFn ──┐                       │
│  Previous  ─── previousFn ──┼── direction calc      │
│  Next      ─── nextFn ──────┘        │              │
│                                      ▼              │
│                              widthFn ── normalFn    │
│                                      │              │
│                              colorFn ─┘             │
│                                      │              │
│                                 vertexFn            │
│                                      │              │
└──────────────────────────────────────┼──────────────┘
                                       │
                         FRAGMENT SHADER
┌──────────────────────────────────────┼──────────────┐
│                                      ▼              │
│                      uvFn ── gradientFn             │
│                                      │              │
│                           fragmentColorFn           │
│                                      │              │
│                    opacityFn ── dashFn               │
│                                      │              │
│                  fragmentAlphaFn ── discardFn        │
│                                      │              │
│                                   output            │
└─────────────────────────────────────────────────────┘
```

## Quick Reference

| Hook | Stage | Signature | Purpose |
|------|-------|-----------|---------|
| `positionFn` | Vertex | `(pos: vec3, progress: float) → vec3` | Transform all three positions (current, previous, next) |
| `previousFn` | Vertex | `(pos: vec3, progress: float) → vec3` | Override previous neighbour only |
| `nextFn` | Vertex | `(pos: vec3, progress: float) → vec3` | Override next neighbour only |
| `widthFn` | Vertex | `(width: float, progress: float, side: float) → float` | Per-vertex width variation |
| `normalFn` | Vertex | `(normal: vec4, dir: vec2, dir1: vec2, dir2: vec2, progress: float, side: float) → vec4` | Custom normal/offset |
| `colorFn` | Vertex | `(color: vec4, progress: float, side: float) → vec4` | Per-vertex color |
| `gradientFn` | Fragment | `(factor: float, side: float) → float` | Gradient interpolation |
| `fragmentColorFn` | Fragment | `(color: vec4, uv: vec2, progress: float, side: float) → vec4` | Post-texture color |
| `opacityFn` | Fragment | `(alpha: float, progress: float, side: float) → float` | Per-fragment opacity |
| `dashFn` | Fragment | `(cyclePos: float, progress: float, side: float) → float` | Custom dash patterns |
| `uvFn` | Fragment | `(uv: vec2, progress: float, side: float) → vec2` | UV transformation |
| `vertexFn` | Vertex | `(pos: vec4, normal: vec4, progress: float, side: float) → vec4` | Final clip-space position |
| `fragmentAlphaFn` | Fragment | `(alpha: float, uv: vec2, progress: float, side: float) → float` | Final alpha modification |
| `discardFn` | Fragment | `(progress: float, side: float, uv: vec2) → bool` | Fragment discard control |

### Common Parameters

- **`progress`** — `float` from 0 to 1 along the line length
- **`side`** — `float`, +1 or -1 for each side of the line ribbon

---

## Position Hooks

### positionFn

Transform the geometry positions. Applied to **all three** position vectors (current, previous, next) simultaneously, so the line direction stays consistent.

```js
import { Fn, vec3, sin, cos, time } from 'three/tsl'

// Twist a line around the Y axis over time
const twistFn = Fn( ( [pos, progress] ) => {
  const angle = progress.mul( Math.PI * 4 ).add( time )
  return vec3(
    pos.x.mul( cos( angle ) ).sub( pos.z.mul( sin( angle ) ) ),
    pos.y,
    pos.x.mul( sin( angle ) ).add( pos.z.mul( cos( angle ) ) )
  )
} )

const line = new MeshLine()
  .lines( circlePositions( 128 ) )
  .positionFn( twistFn )
  .build()
```

### previousFn / nextFn

Override the **previous** or **next** neighbour position independently. These are used for line direction calculation only.

Useful when you want asymmetric smoothing or custom direction vectors.

```js
import { Fn, mix } from 'three/tsl'

// Smooth the previous position towards current for softer corners
const smoothPrev = Fn( ( [prev, progress] ) => {
  return mix( prev, positionGeometry, 0.3 )
} )

const line = new MeshLine()
  .lines( mySharpPolyline )
  .previousFn( smoothPrev )
  .build()
```

---

## Width & Normal Hooks

### widthFn

Control per-vertex width variation. Receives the base width (after `widthCallback` if any), `progress`, and `side`.

```js
import { Fn, sin, time } from 'three/tsl'

// Pulsating width along the line
const pulseFn = Fn( ( [width, progress] ) => {
  return width.mul( sin( time.add( progress.mul( 10 ) ) ).mul( 0.5 ).add( 1 ) )
} )

const line = new MeshLine()
  .lines( circlePositions( 64 ) )
  .lineWidth( 0.3 )
  .widthFn( pulseFn )
  .build()
```

```js
// Taper from thick to thin
const taperFn = Fn( ( [width, progress] ) => {
  return width.mul( float( 1 ).sub( progress ) )
} )
```

### normalFn

Modify the calculated normal/offset vector. Receives the full direction context for advanced displacement effects.

Parameters: `normal` (vec4), `dir` (vec2 screen direction), `dir1` (vec2), `dir2` (vec2), `progress` (float), `side` (float).

```js
import { Fn, sin, time, vec4 } from 'three/tsl'

// Wavy displacement along the normal
const wavyNormal = Fn( ( [normal, dir, dir1, dir2, progress, side] ) => {
  const wave = sin( progress.mul( 20 ).add( time.mul( 3 ) ) ).mul( 0.5 )
  return vec4( normal.xy.add( dir.mul( wave ) ), normal.zw )
} )
```

---

## Color Hooks

### colorFn

Set per-vertex color in the vertex shader. Overrides the base `color` uniform.

```js
import { Fn, vec3, sin, time } from 'three/tsl'

// Rainbow color based on progress
const rainbowFn = Fn( ( [color, progress] ) => {
  const hue = progress.mul( 6.28 ).add( time )
  return vec3(
    sin( hue ).mul( 0.5 ).add( 0.5 ),
    sin( hue.add( 2.09 ) ).mul( 0.5 ).add( 0.5 ),
    sin( hue.add( 4.18 ) ).mul( 0.5 ).add( 0.5 )
  )
} )

const line = new MeshLine()
  .lines( sineWavePositions() )
  .colorFn( rainbowFn )
  .build()
```

### gradientFn

Control the gradient interpolation factor between `color` and `gradientColor`. Receives `factor` (float, 0→1 along the line) and `side`.

```js
import { Fn, step } from 'three/tsl'

// Hard cut instead of smooth gradient at midpoint
const hardGradient = Fn( ( [factor, side] ) => {
  return step( 0.5, factor )
} )

const line = new MeshLine()
  .lines( straightLine( 100 ) )
  .color( 0xff0000 )
  .gradientColor( 0x0000ff )
  .gradientFn( hardGradient )
  .build()
```

### fragmentColorFn

Modify the final fragment color after texture sampling and gradient application. Useful for post-processing effects.

```js
import { Fn, vec4, pow } from 'three/tsl'

// Desaturate based on progress
const desaturateFn = Fn( ( [color, uv, progress, side] ) => {
  const gray = color.r.mul( 0.299 ).add( color.g.mul( 0.587 ) ).add( color.b.mul( 0.114 ) )
  const desatColor = mix( color.rgb, vec3( gray ), progress )
  return vec4( desatColor, color.a )
} )
```

---

## Opacity & Alpha Hooks

### opacityFn

Control per-fragment opacity. Applied before dashes and discard.

```js
import { Fn, smoothstep } from 'three/tsl'

// Fade in/out at both ends
const fadeEndsFn = Fn( ( [alpha, progress] ) => {
  return alpha
    .mul( smoothstep( 0, 0.1, progress ) )
    .mul( smoothstep( 1, 0.9, progress ) )
} )

const line = new MeshLine()
  .lines( straightLine( 100 ) )
  .transparent( true )
  .opacityFn( fadeEndsFn )
  .build()
```

### fragmentAlphaFn

Final alpha modification after all other alpha processing (opacity, dashes, textures).

```js
import { Fn, sin, time } from 'three/tsl'

// Flickering alpha
const flickerFn = Fn( ( [alpha, uv, progress, side] ) => {
  return alpha.mul( sin( time.mul( 10 ).add( progress.mul( 50 ) ) ).mul( 0.3 ).add( 0.7 ) )
} )
```

---

## UV & Dash Hooks

### uvFn

Transform UV coordinates before texture sampling. `uv.x` runs along the line (0→1), `uv.y` runs across (-1→1).

```js
import { Fn, vec2, sin, time } from 'three/tsl'

// Scroll texture along the line
const scrollUV = Fn( ( [uv, progress, side] ) => {
  return vec2( uv.x.add( time.mul( 0.5 ) ), uv.y )
} )

const line = new MeshLine()
  .lines( circlePositions( 64 ) )
  .map( myTexture )
  .uvFn( scrollUV )
  .build()
```

### dashFn

Modify the dash cycle position for custom dash patterns. Receives the current `cyclePosition` (0→1 within a dash cycle).

```js
import { Fn, sin, float, mod } from 'three/tsl'

// Variable-length dashes
const variableDash = Fn( ( [cyclePos, progress] ) => {
  const variation = sin( progress.mul( 20 ) ).mul( 0.2 ).add( 1 )
  return mod( cyclePos.mul( variation ), float( 1 ) )
} )

const line = new MeshLine()
  .lines( circlePositions( 128 ) )
  .dash( { count: 10, ratio: 0.3 } )
  .dashFn( variableDash )
  .build()
```

---

## Control Hooks

### vertexFn

Modify the final **clip-space** position after all other vertex processing. Receives the projected position (vec4), normal (vec4), progress, and side.

```js
import { Fn, vec4, sin, time } from 'three/tsl'

// Screen-space jitter effect
const jitterFn = Fn( ( [pos, normal, progress, side] ) => {
  const jx = sin( time.mul( 100 ).add( progress.mul( 50 ) ) ).mul( 0.002 )
  const jy = sin( time.mul( 73 ).add( progress.mul( 37 ) ) ).mul( 0.002 )
  return vec4( pos.x.add( jx ), pos.y.add( jy ), pos.z, pos.w )
} )
```

### discardFn

Control per-fragment discard. Return a boolean node — fragments where this evaluates to `true` are discarded.

```js
import { Fn, fract, step } from 'three/tsl'

// Discard every other segment
const stripeFn = Fn( ( [progress, side, uv] ) => {
  return step( 0.5, fract( progress.mul( 20 ) ) )
} )

const line = new MeshLine()
  .lines( circlePositions( 128 ) )
  .discardFn( stripeFn )
  .build()
```

---

## Combining Multiple Hooks

Hooks compose naturally. Use several at once to build complex effects:

```js
import { Fn, vec3, sin, cos, time, smoothstep, float } from 'three/tsl'

const line = new MeshLine()
  .lines( circlePositions( 128 ) )
  .lineWidth( 0.4 )
  .transparent( true )

  // Pulsating width
  .widthFn( Fn( ( [w, progress] ) => {
    return w.mul( sin( progress.mul( 8 ).add( time ) ).mul( 0.4 ).add( 0.8 ) )
  } ) )

  // Rainbow color
  .colorFn( Fn( ( [color, progress] ) => {
    const h = progress.mul( 6.28 ).add( time )
    return vec3(
      sin( h ).mul( 0.5 ).add( 0.5 ),
      sin( h.add( 2.09 ) ).mul( 0.5 ).add( 0.5 ),
      sin( h.add( 4.18 ) ).mul( 0.5 ).add( 0.5 )
    )
  } ) )

  // Fade ends
  .opacityFn( Fn( ( [alpha, progress] ) => {
    return alpha
      .mul( smoothstep( 0, 0.05, progress ) )
      .mul( smoothstep( 1, 0.95, progress ) )
  } ) )

  .build()
```

## Performance Tips

- **Hooks run on the GPU** — they add shader instructions, not CPU overhead.
- **Keep it simple** — complex branching or deep function chains increase shader compilation time.
- **Use uniforms for animation** — pass `time`, `uniform()` values, or `attribute()` data rather than recompiling the shader each frame.
- **Avoid setting hooks after `build()`** — changing a hook forces a full shader recompilation. Set all hooks before calling `.build()`.
- **Combine wisely** — each active hook adds instructions to the shader. For simple cases, one hook may be enough.

## Next Steps

- [Common Patterns](./common-patterns.md) — basic line recipes
- [Advanced Patterns](./advanced-patterns.md) — GPU positions, instancing, and hook examples
- [MeshLineNodeMaterial](./meshline-material.md) — material API reference
