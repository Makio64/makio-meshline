---
description: "Use the Makio MeshLine interactive sandbox to tune line shapes, joins, dashes, gradients, and exported Three.js code snippets."
outline: false
pageClass: example-page
---

# Interactive Sandbox

Use the sandbox to tune one line until it looks right, then copy the generated snippet into your own scene.

<iframe title="Makio MeshLine Interactive Sandbox demo" src="https://meshline-demo.makio.io/examples/sandbox?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Interactive Sandbox demo](https://meshline-demo.makio.io/examples/sandbox)

## Typical Generated Code

```javascript
import { MeshLine, circlePositions } from 'makio-meshline'

const line = new MeshLine()
	.lines( circlePositions( 64 ), true )
	.color( 0xff3300 )
	.gradientColor( 0x0033ff )
	.lineWidth( 12 )
	.dash( { count: 8, ratio: 0.5 } )
	.join( { type: 'miter', limit: 2 } )
	.build()

scene.add( line )
```

Start from one shape, change one control, and copy the result once the line looks right. The live sandbox adds presets and extra UI, but the exported line code stays small.
