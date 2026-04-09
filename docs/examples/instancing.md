---
description: "Render many repeated lines with one draw call using Makio MeshLine instancing, per-instance attributes, and custom TSL hooks."
outline: false
pageClass: example-page
---

# Instancing

Use one MeshLine and per-instance attributes when many lines share the same shape and material.

<iframe title="Makio MeshLine Instancing demo" src="https://meshline-demo.makio.io/examples/gpu-instance?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Instancing demo](https://meshline-demo.makio.io/examples/gpu-instance)

## Minimal Pattern

```javascript
import { MeshLine, circlePositions } from 'makio-meshline'
import { attribute, Fn, vec4 } from 'three/tsl'

const instanceCount = 100

const line = new MeshLine()
  .lines( circlePositions( 32 ), true )
  .instances( instanceCount )
  .lineWidth( 0.05 )
  .color( 0xffffff )
  .positionFn( Fn( ( [position] ) => {
    return position.add( attribute( 'instanceOffset', 'vec3' ) )
  } ) )
  .colorFn( Fn( () => {
    return vec4( attribute( 'instanceColor', 'vec3' ), 1 )
  } ) )

line.addInstanceAttribute( 'instanceOffset', 3 )
line.addInstanceAttribute( 'instanceColor', 3 )

for ( let i = 0; i < instanceCount; i++ ) {
  const angle = i / instanceCount * Math.PI * 2
  const radius = 5 + Math.random() * 10

  line.setInstanceValue( 'instanceOffset', i, [
    Math.cos( angle ) * radius,
    ( Math.random() - 0.5 ) * 10,
    Math.sin( angle ) * radius
  ])

  line.setInstanceValue( 'instanceColor', i, [
    Math.random(),
    Math.random(),
    Math.random()
  ])
}

line.build()
scene.add( line )
```

Use instancing when the line shape repeats many times. If every line needs its own geometry or material, separate MeshLine objects stay simpler.