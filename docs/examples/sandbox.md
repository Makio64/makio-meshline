---
outline: false
pageClass: example-page
---

# Interactive Sandbox

Experiment with MeshLine configurations in real-time and copy the generated code.

<iframe src="https://meshlines.netlify.app/examples/sandbox?noMenu" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

## How to Use

The sandbox allows you to:

1. **Choose Line Shape** - Select from circle, sine wave, square, or straight line
2. **Adjust Appearance** - Modify line width, opacity, and size attenuation
3. **Configure Colors** - Set base color and optional gradient
4. **Add Dashes** - Create dashed lines with customizable patterns
5. **Advanced Options** - Enable wireframe mode and miter limits

### Key Features

- **Real-time Preview** - See changes instantly as you adjust parameters
- **Code Generation** - Automatically generates clean, copy-paste ready code
- **Syntax Highlighting** - Code is highlighted for better readability
- **One-click Copy** - Copy the generated code with a single click

### Example Output

```javascript
import { MeshLine, circlePositions } from 'meshline'

const positions = circlePositions( 64, 10 )

const line = new MeshLine()
  .lines( positions )
  .isClose( true )
  .color( 0xff3300 )
  .lineWidth( 2 )
  .sizeAttenuation( true )
  .gradientColor( 0x0033ff )
  .build()

scene.add( line )
```

This sandbox is perfect for quickly prototyping different line styles and understanding how various parameters affect the appearance.