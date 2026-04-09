---
description: "Build a responsive cursor trail in Three.js with Makio MeshLine by updating a short point array and reusing one dynamic line."
outline: false
pageClass: example-page
---

# Follow

This is a very small pattern: keep one target point, a short trail array, and rewrite the line positions every frame.

<iframe title="Makio MeshLine Follow demo" src="https://meshline-demo.makio.io/examples/follow?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Follow demo](https://meshline-demo.makio.io/examples/follow)

## Minimal Pattern

```javascript
import { MeshLine } from 'makio-meshline'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

const pointCount = 24
const trail = Array.from( { length: pointCount }, () => new Vector3() )
const positions = new Float32Array( pointCount * 3 )
const target = new Vector3()
const pointer = new Vector2()
const plane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const raycaster = new Raycaster()

const line = new MeshLine()
	.lines( positions )
	.color( 0x00ff88 )
	.lineWidth( 0.12 )
	.build()

window.addEventListener( 'pointermove', ( event ) => {
	pointer.x = event.clientX / innerWidth * 2 - 1
	pointer.y = -( event.clientY / innerHeight ) * 2 + 1
	raycaster.setFromCamera( pointer, camera )
	raycaster.ray.intersectPlane( plane, target )
} )

function updateTrail() {
	trail[0].lerp( target, 0.25 )

	for ( let i = 1; i < pointCount; i++ ) {
		trail[i].lerp( trail[i - 1], 0.35 )
	}

	for ( let i = 0; i < pointCount; i++ ) {
		positions[i * 3] = trail[i].x
		positions[i * 3 + 1] = trail[i].y
		positions[i * 3 + 2] = trail[i].z
	}

	line.setPositions( positions )
}
```

The live demo repeats this idea on a few offset lines and adds a width response to mouse speed, but the core effect is just target plus spring plus `setPositions()`.
