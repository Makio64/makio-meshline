---
description: "Use GPU-driven positions with Makio MeshLine and Three.js TSL to animate parametric circles and curves without CPU vertex uploads."
outline: false
pageClass: example-page
---

# GPU Positions

Demonstrates GPU-based position calculation using Three.js TSL (Three Shading Language) nodes, enabling complex animations with minimal CPU overhead. The demo below draws a tunnel of 150 rings in one call: every ring point is computed on the GPU from its progress, its instance index and time.

<iframe title="Makio MeshLine GPU positions demo" src="https://meshline-demo.makio.io/examples/gpu-instance?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full GPU Instancing demo](https://meshline-demo.makio.io/examples/gpu-instance)

## Key Concepts

Instead of providing vertex positions as a buffer, you define a TSL function that computes positions based on:
- `progress` - Normalized position along the line (0 to 1)
- `time` - Global time uniform for animations
- Any custom uniforms you define

### Benefits

1. **Performance** - Calculations happen in parallel on GPU
2. **Memory Efficient** - No need to store position arrays
3. **Dynamic** - Easy to create complex, animated shapes
4. **Parametric** - Change shape by modifying shader parameters

### Use Cases

- Animated visualizations
- Parametric curves and surfaces
- Music visualizers
- Data-driven graphics
- Procedural line generation

## Code Implementation

```javascript
import { MeshLine } from 'makio-meshline'
import { cos, Fn, mix, sin, time, uniform, vec3 } from 'three/tsl'

const SEGMENTS = 128
const TWO_PI = Math.PI * 2

// Generate a circle in the XY plane from normalized per-vertex progress.
const circlePosition = Fn( ( [progress] ) => {
	const angle = progress.add( time.negate() ).mul( TWO_PI )
	return vec3( cos( angle ), sin( angle ), 0 )
} )

// Generate a wave in the XY plane from the same normalized progress.
const wavePosition = Fn( ( [progress] ) => {
	const y = sin( progress.mul( Math.PI * 4 ).add( time.negate().mul( 4 ) ) )
	return vec3( progress.oneMinus().mul( 2 ).sub( 1 ), y.mul( 0.5 ), 0 )
} )

const useWave = uniform( 0 )
const positionNode = Fn( ( [progress] ) => {
	return mix( circlePosition( progress ), wavePosition( progress ), useWave )
} )

// Create line with GPU position node
const line = new MeshLine()
	.segments( SEGMENTS )
	.closed( true )
	.gpuPositionNode( positionNode )
	.lineWidth( 0.1 )
	.gradientColor( 0x0000ff )
	.color( 0xffffff )
	.build()
```

## At Scale: One Node, Many Lines

Combine `gpuPositionNode()` with `instances()` and read `instanceIndex` inside the node to give every instance its own shape. The tunnel demo places each ring at a depth derived from its index, so the CPU never uploads a position:

```javascript
import { MeshLine } from 'makio-meshline'
import { cos, float, Fn, instanceIndex, mod, sin, uniform, vec3 } from 'three/tsl'

const RING_COUNT = 150
const TUNNEL_LENGTH = 90
const travel = uniform( 0 ) // advanced every frame on the CPU

const ringPosition = Fn( ( [progress] ) => {
	const z = mod( float( instanceIndex ).mul( TUNNEL_LENGTH / RING_COUNT ).add( travel ), TUNNEL_LENGTH ).sub( TUNNEL_LENGTH )
	const angle = progress.mul( Math.PI * 2 )
	return vec3( cos( angle ).mul( 2.6 ), sin( angle ).mul( 2.6 ), z )
} )

const tunnel = new MeshLine()
	.instances( RING_COUNT )
	.segments( 192 )
	.closed( true )
	.gpuPositionNode( ringPosition )
	.lineWidth( 0.05 )
	.build()
```

When a ring wraps back to the far end, the demo recolors only that ring with `setInstanceValues()`, uploading a few floats instead of the whole instance buffer.
