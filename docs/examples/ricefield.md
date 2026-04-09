---
description: "Use Makio MeshLine instancing to render thousands of stylized grass or rice blades with small line templates and per-instance transforms."
outline: false
pageClass: example-page
---

# Rice Field

This scene stays manageable by repeating one very small blade template many times with instancing.

<iframe title="Makio MeshLine Rice Field demo" src="https://meshline-demo.makio.io/examples/ricefield?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Rice Field demo](https://meshline-demo.makio.io/examples/ricefield)

## Minimal Pattern

```javascript
import { MeshLine, straightLine } from 'makio-meshline'
import { attribute, Fn, vec3 } from 'three/tsl'

const bladeCount = 2000

const rice = new MeshLine()
	.lines( straightLine( 1, 24 ) )
	.instances( bladeCount )
	.lineWidth( 0.03 )
	.color( 0x6fbf4b )
	.positionFn( Fn( ( [position] ) => {
		const transform = attribute( 'instanceTransform', 'vec4' )
		const x = transform.x
		const z = transform.y
		const height = transform.z
		const bend = transform.w

		return vec3(
			x.add( position.y.mul( bend ) ),
			position.y.mul( height ),
			z
		)
	} ) )

rice.addInstanceAttribute( 'instanceTransform', 4 )

for ( let i = 0; i < bladeCount; i++ ) {
	rice.setInstanceValue( 'instanceTransform', i, [x, z, height, bend] )
}

rice.build()
scene.add( rice )
```

The live demo adds a second MeshLine for the field borders, a quadtree layout, compute-driven motion, a sky gradient, and a reflector. The core idea is still one simple blade shape plus per-instance transforms.
