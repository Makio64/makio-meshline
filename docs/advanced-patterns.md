# Advanced Patterns

These snippets showcase features that go beyond basic styling.

## 1. GPU-Driven Circle (no vertex upload)

```js
import { MeshLine } from 'makio-meshline'
import { Fn, vec3, cos, sin, time } from 'three/tsl'

const circleNode = Fn(( [counter] ) => {
  const angle = counter.mul( Math.PI * 2 ).add( time.negate() )
  return vec3( cos(angle), sin(angle), 0 )
})

const segments = 256 // only length matters when gpuPositionNode is used

const line = new MeshLine()
  .lines(new Float32Array( segments * 3 )) // placeholder
  .gpuPositionNode(circleNode)
  .lineWidth(0.3)
  .gradientColor(0xffff00)
  .build()
scene.add( line )
```

## 2. Multi-Line Batch

```js
const rings = [ circlePositions(64,1), circlePositions(64,1.5), circlePositions(64,2) ]

const multi = new MeshLine()
  .lines(rings)
  .isClose(true)
  .color(0xffffff)
  .sizeAttenuation(true)
  .lineWidth(2)
  .build()
```

One draw-call – three rings.

## 3. Live Trail (fast `setPositions()`)

```js
// allocate once
const pts = new Float32Array( 64 * 3 )
const trail = new MeshLine()
  .lines(pts)
  .lineWidth(0.1)
  .build()
scene.add( trail )

function update() {
  writeTrail( pts )       // mutate coordinates in place
  trail.geometry.setPositions( pts )
}
```

No buffers recreated, only a sub-data upload.

## 4. Miter Clip for Sharp Corners

```js
const sharp = new MeshLine()
  .lines(myPolyline)
  .lineWidth(0.8)
  .useMiterLimit(true, 5) // enable clipping with limit
  .build()
```

## 5. Animated Dashes

```js
const dashed = new MeshLine()
  .lines(sineWavePositions())
  .dashes(20, 0.4)
  .lineWidth(0.4)
  .build()

stage.onUpdate.add( dt => {
  dashed.material.dashOffset.value += dt * 0.002
})
```

## 6. Instanced Lines

Render thousands of lines efficiently with instancing:

```js
import { MeshLine } from 'makio-meshline'
import { Fn, vec3, cos, sin, attribute, instanceIndex } from 'three/tsl'

const instanceCount = 1000
const segments = 32

// Create instanced line
const instancedLine = new MeshLine()
	.instances(instanceCount) // Enable instancing
	.segments(segments) // Segments per line instance
	.lineWidth(0.1)
	.color(0xffffff)
	.build()

// Add custom instance attributes
instancedLine.addInstanceAttribute( 'instanceOffset', 3 )
instancedLine.addInstanceAttribute( 'instanceScale', 1 )

// Set per-instance data
for ( let i = 0; i < instanceCount; i++ ) {
	const x = ( Math.random() - 0.5 ) * 20
	const y = ( Math.random() - 0.5 ) * 20
	const z = ( Math.random() - 0.5 ) * 20
	instancedLine.setInstanceValue( 'instanceOffset', i, [x, y, z] )
	
	const scale = 0.5 + Math.random() * 1.5
	instancedLine.setInstanceValue( 'instanceScale', i, scale )
}

scene.add( instancedLine )
```

## 7. GPU Instanced Circles

Combine GPU position nodes with instancing for animated effects:

```js
import { Fn, vec3, cos, sin, time, attribute, instanceIndex } from 'three/tsl'

const gpuPositionNode = Fn( ( [counters] ) => {
	const offset = attribute( 'instanceOffset', 'vec3' )
	const radius = attribute( 'instanceRadius', 'float' )
	const angle = counters.mul( Math.PI * 2 ).add( time.negate() )
	return vec3( cos( angle ), sin( angle ), 0 ).mul( radius ).add( offset )
} )

const instancedCircles = new MeshLine()
	.instances(100)
	.segments(64)
	.gpuPositionNode(gpuPositionNode)
	.lineWidth(0.2)
	.colorFn(Fn( ( [color, counters] ) => {
		const col = float( instanceIndex ).mod( 10 )
		const row = float( instanceIndex ).div( 10 )
		return vec3( col.div( 9 ), row.div( 9 ), 0.8 )
	} ))
	.build()

// Setup instance attributes
instancedCircles.addInstanceAttribute( 'instanceOffset', 3 )
instancedCircles.addInstanceAttribute( 'instanceRadius', 1 )

// Position instances in a grid
for ( let i = 0; i < 100; i++ ) {
	const col = i % 10
	const row = Math.floor( i / 10 )
	const x = ( col - 4.5 ) * 3
	const y = ( row - 4.5 ) * 3
	instancedCircles.setInstanceValue( 'instanceOffset', i, [x, y, 0] )
	instancedCircles.setInstanceValue( 'instanceRadius', i, 0.5 + col * 0.1 )
}
```

## 8. Material Hooks for Custom Effects

Use material hooks to create custom shader effects:

### Dynamic Width Variation
```js
import { Fn, sin, time } from 'three/tsl'

const pulsatingLine = new MeshLine()
	.lines(circlePositions( 64 ))
	.lineWidth(0.3)
	.widthFn(Fn( ( [width, counters] ) => {
		return width.mul( sin( time.add( counters.mul( 10 ) ) ).mul( 0.5 ).add( 1 ) )
	} ))
	.build()
```

### Custom Color Gradients
```js
const rainbowLine = new MeshLine()
	.lines(sineWavePositions())
	.colorFn(Fn( ( [color, counters] ) => {
		const hue = counters.mul( 6.28 ).add( time )
		return vec3(
			sin( hue ).mul( 0.5 ).add( 0.5 ),
			sin( hue.add( 2.09 ) ).mul( 0.5 ).add( 0.5 ),
			sin( hue.add( 4.18 ) ).mul( 0.5 ).add( 0.5 )
		)
	} ))
	.build()
```

### Opacity Fading
```js
const fadingLine = new MeshLine()
	.lines(straightLine( 100 ))
	.transparent(true)
	.opacityFn(Fn( ( [alpha, counters] ) => {
		return alpha.mul( smoothstep( 0, 0.1, counters ) ).mul( smoothstep( 1, 0.9, counters ) )
	} ))
	.build()
```

### Custom Dash Patterns
```js
const customDashes = new MeshLine()
	.lines(circlePositions( 128 ))
	.dashes(10, 0.3)
	.dashFn(Fn( ( [cyclePos, counters] ) => {
		// Create variable dash lengths
		const variation = sin( counters.mul( 20 ) ).mul( 0.2 ).add( 1 )
		return mod( cyclePos.mul( variation ), float( 1 ) )
	} ))
	.build()
``` 