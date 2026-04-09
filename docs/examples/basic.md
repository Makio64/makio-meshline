---
description: "Start with one shape and change one option at a time to learn MeshLine width, dashes, gradients, textures, opacity, and size attenuation in Three.js."
outline: false
pageClass: example-page
---

# Basic Examples

Start with one shape and change one option at a time. The live demo repeats this small pattern to show width, dashes, gradients, textures, opacity, and size attenuation side by side.

<iframe title="Makio MeshLine Basic Examples demo" src="https://meshline-demo.makio.io/examples/basic?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Basic Examples demo](https://meshline-demo.makio.io/examples/basic)

## Minimal Pattern

```javascript
import { MeshLine, circlePositions } from 'makio-meshline'

function makeLine( x, options = {} ) {
  const line = new MeshLine()
    .lines( circlePositions( 64 ), true )
    .color( options.color ?? 0xff6633 )
    .lineWidth( options.lineWidth ?? 0.25 )

  if ( options.gradientColor ) line.gradientColor( options.gradientColor )
  if ( options.dash ) line.dash( options.dash )
  if ( options.opacity !== undefined ) {
    line.opacity( options.opacity )
    line.transparent( options.opacity < 1 )
  }

  line.position.x = x
  line.build()
  return line
}

scene.add( makeLine( -4, { color: 0xff6633 } ) )
scene.add( makeLine( 0, { color: 0x00ff88, dash: { count: 8, ratio: 0.5 } } ) )
scene.add( makeLine( 4, { color: 0xffffff, gradientColor: 0x3366ff, opacity: 0.7 } ) )
```

Keep the geometry fixed and change one option at a time. That is the simplest way to see what each MeshLine feature is doing.
