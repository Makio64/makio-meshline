---
outline: false
pageClass: example-page
---

# Basic Examples

This demo displays 16 different MeshLine configurations each demonstrating specific features

<iframe src="https://meshlines.netlify.app/examples/basic?noMenu" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

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

## Animation reveal

The examples include animated reveal effects where lines draw in and out sequentially, demonstrating dynamic line manipulation capabilities.