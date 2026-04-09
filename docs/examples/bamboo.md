---
description: "Build a procedural bamboo grove with Makio MeshLine instancing, custom TSL transforms, and shadow-casting line templates."
outline: false
pageClass: example-page
---

# Bamboo Grove

A bamboo grove can stay simple if you treat each stalk as one repeated template plus a few per-instance values.

<iframe title="Makio MeshLine Bamboo Grove demo" src="https://meshline-demo.makio.io/examples/bamboooo?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Bamboo Grove demo](https://meshline-demo.makio.io/examples/bamboooo)

## Minimal Pattern

```javascript
import { MeshLine, straightLine } from 'makio-meshline'
import { attribute, Fn, vec3 } from 'three/tsl'

const stalkCount = 20

const stalks = new MeshLine()
  .lines( straightLine( 1, 32 ) )
  .instances( stalkCount )
  .color( 0x497849 )
  .lineWidth( 0.1 )
  .shadow( true )
  .positionFn( Fn( ( [position, progress] ) => {
    const transform = attribute( 'instanceTransform', 'vec4' )
    const lean = attribute( 'instanceLean', 'vec3' )
    const leanAmount = lean.x.mul( progress.mul( progress ) )

    return vec3(
      transform.x.add( lean.y.mul( leanAmount ) ),
      position.y.mul( transform.z ),
      transform.y.add( lean.z.mul( leanAmount ) )
    )
  } ) )

stalks.addInstanceAttribute( 'instanceTransform', 4 )
stalks.addInstanceAttribute( 'instanceLean', 3 )

for ( let i = 0; i < stalkCount; i++ ) {
  stalks.setInstanceValue( 'instanceTransform', i, [x, z, height, width] )
  stalks.setInstanceValue( 'instanceLean', i, [lean, dirX, dirZ] )
}

stalks.build()
scene.add( stalks )
```

The live demo repeats this pattern twice: one straight template for the stalks and one circular template for the node rings. Keep the template simple and push the variation into instance attributes.
