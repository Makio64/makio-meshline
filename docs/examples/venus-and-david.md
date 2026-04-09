---
description: "Morph one instanced MeshLine layout between sampled sculpture positions using TSL attributes and a single interpolation uniform."
outline: false
pageClass: example-page
---

# Venus & David

This example morphs one instanced line layout between two sampled sculptures. The minimal pattern is just two position sets and one uniform.

<iframe title="Makio MeshLine Venus and David demo" src="https://meshline-demo.makio.io/examples/venus-and-david?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Venus and David demo](https://meshline-demo.makio.io/examples/venus-and-david)

## Minimal Pattern

```javascript
import { MeshLine, circlePositions } from 'makio-meshline'
import { attribute, Fn, mix, uniform } from 'three/tsl'

const morph = uniform( 0 )
const ringCount = 800

const line = new MeshLine()
	.lines( circlePositions( 24, 0.03 ), true )
	.instances( ringCount )
	.lineWidth( 0.01 )
	.color( 0xffffff )
	.positionFn( Fn( ( [position] ) => {
		const fromPosition = attribute( 'fromPosition', 'vec3' )
		const toPosition = attribute( 'toPosition', 'vec3' )
		return mix( fromPosition, toPosition, morph ).add( position )
	} ) )

line.addInstanceAttribute( 'fromPosition', 3 )
line.addInstanceAttribute( 'toPosition', 3 )

for ( let i = 0; i < ringCount; i++ ) {
	line.setInstanceValue( 'fromPosition', i, venusSamples[i] )
	line.setInstanceValue( 'toPosition', i, davidSamples[i] )
}

line.build()
scene.add( line )

morph.value = 0.5
```

The live demo adds BVH sampling, interaction, and bloom, but the morph itself is just `mix()` between two instanced position attributes.