---
outline: false
pageClass: example-page
---

# Basic Examples

A comprehensive showcase of MeshLine features in a grid layout.

<iframe src="https://meshlines.netlify.app/examples/basic?noMenu" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

## Featured Examples

This demo displays 16 different MeshLine configurations in a 4x4 grid, each demonstrating specific features:

### Line Styles
- **Basic** - Simple colored line with default settings
- **Thick Line** - Demonstrates increased line width
- **Open End** - Shows lines without closure
- **Wireframe** - Renders line in wireframe mode

### Dashing Patterns
- **Dashed 4** - 4 dash segments with 50% ratio
- **Dashed 8** - 8 dash segments with 60% ratio  
- **Dashed 16** - 16 dash segments with 30% ratio
- **Long Dashes** - Fewer segments with 80% dash ratio

### Visual Effects
- **Map Texture** - Applies a stripe texture along the line
- **Gradient Only** - Smooth color transition from start to end
- **Dash + Gradient** - Combines dashing with gradient
- **Gradient** - Another gradient variation

### Advanced Features
- **Opacity** - Semi-transparent line with background
- **Alpha Map** - Uses texture for transparency masking
- **Size Attenuation** - Line width scales with camera distance
- **All Features** - Combines multiple features in one example

## Code Example

Here's how one of these configurations is created:

```javascript
import { MeshLine, circlePositions } from 'meshline'

// Create a dashed line with gradient
const line = new MeshLine()
  .lines( circlePositions(64) )
  .isClose( true )
  .color( 0x00FF00 )
  .gradientColor( 0xFF0000 )
  .lineWidth( 0.4 )
  .dashes( 10, 0.7 )
  .build()

scene.add( line )
```

## Animation

The examples include animated reveal effects where lines draw in and out sequentially, demonstrating dynamic line manipulation capabilities.