# API Reference

This page provides an overview of the **Makio MeshLine** API. For detailed documentation, visit the individual class pages.

## Installation & Import

```js
import { MeshLine, MeshLineGeometry, MeshLineNodeMaterial, circlePositions, squarePositions, sineWavePositions } from 'meshline';
```

## Quick Start

```javascript
import { MeshLine, circlePositions } from 'meshline';
import * as THREE from 'three';

// Create a scene
const scene = new THREE.Scene();

// Generate circle positions
const positions = circlePositions(64); 

// Create a MeshLine
const line = new MeshLine(positions, {
  color: 0xff0000,
  lineWidth: 0.5,
  isClose: true,
});

scene.add(line);
```

## Classes

### [MeshLine](/meshline)

The main class for creating performant, customizable lines in Three.js.

```ts
new MeshLine(positions: Array<[number, number, number]>, options?: MeshLineOptions)
```

**Key Features:**
- Easy-to-use high-level API
- Built-in animation support (`show()`, `hide()`)
- Automatic resolution handling
- Extensive customization options

[→ View MeshLine Documentation](/meshline)

### [MeshLineGeometry](/meshline-geometry)

Low-level geometry class that builds the line mesh from point data.

```ts
new MeshLineGeometry(lines, widthCallback?, loop?)
```

**Key Features:**
- Handles complex vertex calculations
- Support for multiple line segments
- Variable width along line
- Optimized for performance

[→ View MeshLineGeometry Documentation](/meshline-geometry)

### [MeshLineNodeMaterial](/meshline-material)

Specialized Three.js NodeMaterial for line rendering.

```ts
new MeshLineNodeMaterial(parameters?)
```

**Key Features:**
- WebGPU and WebGL2 compatible
- Advanced shader features (gradients, dashing, textures)
- Screen-space line thickness
- Size attenuation support

[→ View MeshLineNodeMaterial Documentation](/meshline-material)

## Helper Functions

### [Position Generators](/helpers)

Utility functions for generating common line shapes:

- `circlePositions(segments?, radius?)` - Generate circle vertices
- `squarePositions(segments?)` - Generate square vertices
- `sineWavePositions(wavelengths?, segments?, amplitude?, length?)` - Generate sine wave vertices

**Example:**
```javascript
const circle = circlePositions(64, 2); // 64 segments, radius 2
const square = squarePositions(4);     // 4 segments per side
const wave = sineWavePositions(2, 100, 1, 4); // 2 cycles, 100 points, amplitude 1, length 4
```

[→ View Helper Functions Documentation](/helpers)

## Common Patterns

### Basic Line

```javascript
const positions = [[0, 0, 0], [1, 1, 0], [2, 0, 0]];
const line = new MeshLine(positions, {
  color: 0xff0000,
  lineWidth: 0.3
});
```

### Dashed Line

```javascript
const line = new MeshLine(positions, {
  dashCount: 8,
  dashRatio: 0.5,
  color: 0x00ff00
});
```

### Gradient Line

```javascript
const line = new MeshLine(positions, {
  color: 0xff0000,
  gradientColor: 0x0000ff,
  lineWidth: 0.8
});
```

### Animated Line

```javascript
const line = new MeshLine(positions, {
  usePercent: true,
  percent: 0,
  percent2: 1
});

// Animate line reveal
await line.show();
```

## Architecture

The library consists of three main components working together:

```
MeshLine (High-level API)
    ├── MeshLineGeometry (Vertex generation)
    └── MeshLineNodeMaterial (Rendering)
```

- **MeshLine**: User-friendly interface, extends Three.js `Mesh`
- **MeshLineGeometry**: Generates specialized vertex data for thick lines  
- **MeshLineNodeMaterial**: Handles GPU rendering with modern shader techniques

This modular design allows you to use components independently for advanced use cases while providing a simple API for common scenarios.

## Browser Support

- **WebGPU**: Preferred backend for modern browsers
- **WebGL2**: Fallback support for older browsers
- **Three.js**: Compatible with Three.js r177+

## Performance Tips

1. **Use Float32Array** for large datasets
2. **Reuse geometries** when possible
3. **Call dispose()** to prevent memory leaks
4. **Update uniforms** instead of recreating materials
5. **Consider LOD** for very long lines

---

*For detailed documentation of each component, use the navigation menu or the links above.* 