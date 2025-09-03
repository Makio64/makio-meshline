---
outline: false
pageClass: example-page
---

# Instancing

Efficiently render thousands of lines with a single draw call using GPU instancing.

<iframe src="https://meshline-demo.makio.io/examples/gpu-instance?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

## Overview

MeshLine's instancing capabilities help to render many lines efficiently.

Instead of creating separate mesh / geometries / material for each line, instancing reuses a single geometry with per-instance attributes so we can customize each lines.

### Performance Benefits

#### Traditional Approach
- 1000 lines = 1000 draw calls
- High CPU overhead
- Poor GPU utilization

#### Instanced Approach  
- 1000 lines = 1 draw call
- Minimal CPU overhead
- Optimal GPU utilization

## Basic Implementation

```javascript
import { MeshLine, circlePositions } from 'makio-meshline'

// Create instanced MeshLine
const instanceCount = 1000
const line = new MeshLine()
  .lines( circlePositions(32) )
  .instanceCount( instanceCount )
  .lineWidth( 0.02 )
  .build()

// Add custom instance attributes
line.addInstanceAttribute( 'instanceOffset', 3 )  // vec3
line.addInstanceAttribute( 'instanceColor', 3 )   // vec3
line.addInstanceAttribute( 'instanceScale', 1 )   // float

// Set instance data
for ( let i = 0; i < instanceCount; i++ ) {
  // Position each instance
  const angle = (i / instanceCount) * Math.PI * 2
  const radius = 5 + Math.random() * 10
  line.setInstanceValue( 'instanceOffset', i, [
    Math.cos(angle) * radius,
    (Math.random() - 0.5) * 10,
    Math.sin(angle) * radius
  ])
  
  // Random color
  line.setInstanceValue( 'instanceColor', i, [
    Math.random(),
    Math.random(), 
    Math.random()
  ])
  
  // Random scale
  line.setInstanceValue( 'instanceScale', i, 0.5 + Math.random() )
}
```

## Advanced Usage with Hooks

```javascript
// Use instance attributes in shader hooks
line.positionFn( Fn( ( [ pos, counter, offset ] ) => {
  // Apply instance offset to vertex positions
  return pos.add( offset )
} ) )

line.colorFn( Fn( ( [ baseColor, counter, instanceColor ] ) => {
  // Use instance color
  return vec4( instanceColor, 1.0 )
} ) )

line.widthFn( Fn( ( [ width, counter, side, scale ] ) => {
  // Apply instance scale to line width
  return width.mul( scale )
} ) )
```

## Use Cases

- **Particle Systems** - Hair, grass, fur rendering
- **Data Visualization** - Large datasets, flow fields
- **Generative Art** - Thousands of animated strokes
- **Scientific Visualization** - Vector fields, streamlines
- **Games** - Trajectory trails, magic effects

## Best Practices

1. **Batch Similar Lines** - Group lines with same material properties
2. **Use Instance Attributes** - Avoid creating unique geometries
3. **Update Efficiently** - Modify only changed instance values

Instancing is essential for applications requiring many lines while maintaining smooth performance.