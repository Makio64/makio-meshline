---
description: "Explore advanced Makio MeshLine patterns for GPU positions, instancing, batching, animated dashes, and custom TSL material hooks."
---

# Advanced Patterns

These snippets showcase features that go beyond basic styling.

## 1. GPU-Driven Circle (no vertex upload)

```js
import { MeshLine } from 'makio-meshline'
import { Fn, vec3, cos, sin, time } from 'three/tsl'

const circleNode = Fn(( [progress] ) => {
  const angle = progress.mul( Math.PI * 2 ).add( time.negate() )
  return vec3( cos(angle), sin(angle), 0 )
})

const segments = 256

const line = new MeshLine()
  .segments(segments)
  .gpuPositionNode(circleNode)
  .closed(true)
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
  .closed(true)
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

## 4. Sharp Corners

Two-layer approach: the shader-side miter clamp caps spikes by default, and optional CPU-side geometry smoothing can split any corner sharper than ~60° interior bend into two cutoff points. Enable smoothing when corner quality matters more than exact input-to-GPU vertex mapping.

```js
const sharp = new MeshLine()
  .lines(myPolyline)
  .lineWidth(0.8)
	.smoothSharpBends(true)      // opt in: changes topology at sharp corners
  .join({ limit: 2 })          // tighter cap = bevel-like residual spikes
  .build()
// Default smoothSharpBendsAlpha (0.001) is near-imperceptible once enabled.
// Raise it (e.g. .smoothSharpBendsAlpha(0.05)) if you want a visible bevel cap.
```

See [common-patterns › Sharp Corners](./common-patterns.md#11-sharp-corners-miter-smoothing) for a side-by-side comparison of the knobs.

## 5. Animated Dashes

```js
const dashed = new MeshLine()
  .lines(sineWavePositions())
  .dash({ count: 20, ratio: 0.4 })
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
import { Fn, attribute } from 'three/tsl'

const instanceCount = 1000
const segments = 32

const transformInstance = Fn( ( [position] ) => {
	const offset = attribute( 'instanceOffset', 'vec3' )
	const scale = attribute( 'instanceScale', 'float' )
	return position.mul( scale ).add( offset )
} )

// Create instanced line
const instancedLine = new MeshLine()
	.instances(instanceCount) // Enable instancing
	.segments(segments) // Segments per line instance
	.lineWidth(0.1)
	.color(0xffffff)
	.positionFn(transformInstance)
	.build()

// Add custom instance attributes
instancedLine.addInstanceAttributes( {
	instanceOffset: 3,
	instanceScale: 1,
} )

// Fill packed data, then upload each attribute once
const offsets = new Float32Array( instanceCount * 3 )
const scales = new Float32Array( instanceCount )

for ( let i = 0; i < instanceCount; i++ ) {
	const offset = i * 3
	offsets[offset] = ( Math.random() - 0.5 ) * 20
	offsets[offset + 1] = ( Math.random() - 0.5 ) * 20
	offsets[offset + 2] = ( Math.random() - 0.5 ) * 20
	scales[i] = 0.5 + Math.random() * 1.5
}

instancedLine.setInstanceValues( 'instanceOffset', offsets )
instancedLine.setInstanceValues( 'instanceScale', scales )

scene.add( instancedLine )
```

## 7. GPU Instanced Circles

Combine GPU position nodes with instancing for animated effects:

```js
import { Fn, vec3, cos, sin, time, attribute, instanceIndex } from 'three/tsl'

const gpuPositionNode = Fn( ( [progress] ) => {
	const offset = attribute( 'instanceOffset', 'vec3' )
	const radius = attribute( 'instanceRadius', 'float' )
	const angle = progress.mul( Math.PI * 2 ).add( time.negate() )
	return vec3( cos( angle ), sin( angle ), 0 ).mul( radius ).add( offset )
} )

const instancedCircles = new MeshLine()
	.instances(100)
	.segments(64)
	.gpuPositionNode(gpuPositionNode)
	.lineWidth(0.2)
	.colorFn(Fn( ( [color, progress] ) => {
		const col = float( instanceIndex ).mod( 10 )
		const row = float( instanceIndex ).div( 10 )
		return vec3( col.div( 9 ), row.div( 9 ), 0.8 )
	} ))
	.build()

// Setup instance attributes
instancedCircles.addInstanceAttributes( {
	instanceOffset: 3,
	instanceRadius: 1,
} )

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
	.widthFn(Fn( ( [width, progress] ) => {
		return width.mul( sin( time.add( progress.mul( 10 ) ) ).mul( 0.5 ).add( 1 ) )
	} ))
	.build()
```

### Custom Color Gradients
```js
const rainbowLine = new MeshLine()
	.lines(sineWavePositions())
	.colorFn(Fn( ( [color, progress] ) => {
		const hue = progress.mul( 6.28 ).add( time )
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
	.opacityFn(Fn( ( [alpha, progress] ) => {
		return alpha.mul( smoothstep( 0, 0.1, progress ) ).mul( smoothstep( 1, 0.9, progress ) )
	} ))
	.build()
```

### Custom Dash Patterns
```js
const customDashes = new MeshLine()
	.lines(circlePositions( 128 ))
	.dash({ count: 10, ratio: 0.3 })
	.dashFn(Fn( ( [cyclePos, progress] ) => {
		// Create variable dash lengths
		const variation = sin( progress.mul( 20 ) ).mul( 0.2 ).add( 1 )
		return mod( cyclePos.mul( variation ), float( 1 ) )
	} ))
	.build()
```
