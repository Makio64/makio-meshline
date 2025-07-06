# API Reference

This page provides an overview of the **Makio MeshLine** API. For detailed documentation, visit the individual class pages.

## Quick Start

```javascript
import { MeshLine, circlePositions } from 'meshline';
import * as THREE from 'three';

// Create a scene
const scene = new THREE.Scene();

// Create a MeshLine (circle)
const line = new MeshLine({
  lines: circlePositions(64),
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
new MeshLine(options?: MeshLineOptions)
```

**Key Features:**

### [MeshLineGeometry](/meshline-geometry)

Low-level geometry class that builds the line mesh from point data.

```ts
new MeshLineGeometry(lines, widthCallback?, loop?)
```

### [MeshLineNodeMaterial](/meshline-material)

Specialized Three.js NodeMaterial for line rendering.

```ts
new MeshLineNodeMaterial(parameters?)
```

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
const line = new MeshLine({
  lines: [[0, 0, 0], [1, 1, 0], [2, 0, 0]],
  color: 0xff0000,
  lineWidth: 0.3
});
```

### Dashed Line

```javascript
const line = new MeshLine({
  lines: [[0, 0, 0], [1, 1, 0], [2, 0, 0]],
  dashCount: 8,
  dashRatio: 0.5,
  color: 0x00ff00
});
```

### Gradient Line

```javascript
const line = new MeshLine({
  lines: [[0, 0, 0], [1, 1, 0], [2, 0, 0]],
  color: 0xff0000,
  gradientColor: 0x0000ff,
  lineWidth: 0.8
});
```

### Animated Line

```javascript
const line = new MeshLine({
  lines: [[0, 0, 0], [1, 1, 0], [2, 0, 0]],
  usePercent: true,
  percent: 0,
  percent2: 1
});

// Animate line reveal (using gsap or any tween lib)
gsap.to(line.percent,  { value: 1, duration: 1 });
gsap.to(line.percent2, { value: 0, duration: 1 });
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

---

*For detailed documentation of each component, use the navigation menu or the links above.* 