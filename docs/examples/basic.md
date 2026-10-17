---
description: "Explore width, dashes, gradients, textures, opacity, size attenuation, and live TSL hooks in the Makio MeshLine Basic demo."
outline: false
pageClass: example-page
---

# Basic

Compare width, dashes, gradients, textures, opacity, size attenuation, and live TSL hooks side by side. The checked-in [vanilla starter](https://github.com/Makio64/makio-meshline/tree/main/examples/vanilla) remains the smallest conventional Three.js setup.

<iframe title="Makio MeshLine Basic demo" src="https://meshline-demo.makio.io/examples/basic?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the Basic demo](https://meshline-demo.makio.io/examples/basic)

## Core MeshLine Setup

This excerpt is the MeshLine-specific part of the complete vanilla starter:

```javascript
import { MeshLine, circlePositions } from 'makio-meshline'

const line = new MeshLine()
  .lines( circlePositions( 64, 3 ), true )
  .lineWidth( 0.2 )
  .color( 0xff8800 )
  .gradientColor( 0xffffff )

scene.add( line )
```

The full source calls `line.resize()` from `onWindowResize()` so billboard width remains correct after the canvas changes size.

## Explore the options

The Basic demo keeps the common MeshLine options together so their visual differences are easy to compare before copying the starter into a project. Cyan-outlined labels identify GPU hook examples for `widthFn`, `gradientFn`, `opacityFn`, `dashFn`, and `uvFn`; the reveal animation itself uses `discardFn`. The animated hook cells use Three.js TSL's `time` node, so they do not rebuild materials or upload CPU state each frame. See [TSL Hooks](../hooks.md) for copy-ready versions of every hook.

For a lit, world-space ribbon using the same compact structure, open the [Surface demo](https://meshline-demo.makio.io/examples/surface). The larger Surface Road demo remains an advanced, interactive showcase.
