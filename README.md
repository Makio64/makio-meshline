# Makio MeshLine

A lightweight library for rendering performant, thick customizable lines in Three.js using NodeMaterial (TSL).

Supports gradients, dashes, textures, variable width and percent-based visibility.

<img width="1661" alt="Screenshot 2025-06-26 at 15 58 30" src="https://github.com/user-attachments/assets/deb1ccd7-46a9-4be0-8f07-280c21aafe81" />


## Getting Started

Check out the [documentation site](https://meshlines-docs.netlify.app/) for detailed instructions, API reference, and examples.

## Installation

```bash
pnpm i makio-meshline
```

## Basic Usage

```javascript
import { MeshLine, circlePositions } from 'meshline';
import * as THREE from 'three';

// Create a scene
const scene = new THREE.Scene();

// Define line positions
const positions = circlePositions(64); // Helper for circle points

// Create a MeshLine
const line = new MeshLine(positions, {
  color: 0xff0000,
  lineWidth: 2,
});

scene.add(line);
```

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue.

## License

This project is licensed under the MIT License. 
