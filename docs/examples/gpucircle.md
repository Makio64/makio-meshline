---
outline: false
pageClass: example-page
---

# GPU Circle Example

Demonstrates GPU-based position calculation using Three.js TSL (Three Shading Language) nodes, enabling complex animations with minimal CPU overhead.

<iframe src="https://meshlines.netlify.app/examples/gpu-circle?noMenu" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

## Code Implementation

```javascript
import { MeshLine } from 'meshline'
import { Fn, vec3, cos, sin, time, mix } from 'three/tsl'

// TSL function for circle positions
const circlePosition = Fn( ( [counter] ) => {
  const angle = counter.add( time.negate() ).mul( Math.PI * 2 )
  return vec3( cos( angle ), sin( angle ), 0 )
} )

// TSL function for wave positions  
const wavePosition = Fn( ( [counter] ) => {
  const y = sin( counter.mul( Math.PI * 4 ).add( time.negate().mul( 4 ) ) )
  return vec3( counter.oneMinus().mul( 2 ).sub( 1 ), y.mul( 0.5 ), 0 )
} )

// Create line with GPU position node
const line = new MeshLine()
  .segments( 128 )
  .isClose( true )
  .gpuPositionNode( circlePosition )
  .lineWidth( 0.1 )
  .gradientColor( 0x0000ff )
  .color( 0xffffff )
  .build()
```

## Key Concepts

### GPU Position Nodes

Instead of providing vertex positions as a buffer, you define a TSL function that computes positions based on:
- `counter` - Normalized position along the line (0 to 1)
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

This approach is particularly powerful when combined with other TSL nodes for creating complex, interactive line effects.