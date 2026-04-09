---
description: "Turn pointer input into painted strokes in Three.js with Makio MeshLine, dynamic positions, and replayable follower lines."
outline: false
pageClass: example-page
---

# Draw Lines

This is the same idea as Follow, but instead of keeping a single live trail you keep the points that the user painted.

<iframe title="Makio MeshLine Draw Lines demo" src="https://meshline-demo.makio.io/examples/drawlines?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Draw Lines demo](https://meshline-demo.makio.io/examples/drawlines)

## Minimal Pattern

```javascript
import { MeshLine } from 'makio-meshline'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

const maxPoints = 120
const stroke = []
const positions = new Float32Array( maxPoints * 3 )
const target = new Vector3()
const pointer = new Vector2()
const plane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const raycaster = new Raycaster()

const line = new MeshLine()
	.lines( positions )
	.lineWidth( 0.08 )
	.color( 0x00ff88 )
	.dynamic( true )
	.build()

let isDrawing = false

function projectPointer( event ) {
	pointer.x = event.clientX / innerWidth * 2 - 1
	pointer.y = -( event.clientY / innerHeight ) * 2 + 1
	raycaster.setFromCamera( pointer, camera )
	raycaster.ray.intersectPlane( plane, target )
	return target.clone()
}

function writeStroke() {
	const lastPoint = stroke[stroke.length - 1] ?? new Vector3()

	for ( let i = 0; i < maxPoints; i++ ) {
		const point = stroke[i] ?? lastPoint
		positions[i * 3] = point.x
		positions[i * 3 + 1] = point.y
		positions[i * 3 + 2] = point.z
	}

	line.setPositions( positions )
}

window.addEventListener( 'pointerdown', () => {
	isDrawing = true
	stroke.length = 0
} )

window.addEventListener( 'pointerup', () => {
	isDrawing = false
} )

window.addEventListener( 'pointermove', ( event ) => {
	if ( !isDrawing ) return

	const point = projectPointer( event )
	const lastPoint = stroke[0]

	if ( !lastPoint || lastPoint.distanceToSquared( point ) > 0.0025 ) {
		stroke.unshift( point )
		stroke.length = Math.min( stroke.length, maxPoints )
		writeStroke()
	}
} )
```

The live demo expands this into many follower lines that replay saved strokes, but the paintbrush effect starts with one dynamic line and one growing point array.
