# Makio MeshLine

A lightweight library for creating beautiful, performant, and highly customizable lines in Three.js using the modern Node Material system.

![MeshLine examples](https://i.imgur.com/8f5a1hE.png)

This library allows you to easily create lines with advanced properties like gradients, dashing, texture mapping, and more, with a simple and intuitive API.

## Features

- **Performant:** Built on top of Three.js's modern `NodeMaterial` and `WebGPURenderer` for optimal performance.
- **Highly Customizable:** Control width, color, gradients, dashing, opacity, and more.
- **Texture Mapping:** Apply textures and alpha maps to your lines for unique visual effects.
- **Size Attenuation:** Optionally make lines scale with distance.
- **Simple API:** Create complex lines with just a few lines of code.

## Getting Started

Check out the [documentation site](https://meshlines.netlify.app/) for detailed instructions, API reference, and examples.

## Installation

```bash
npm install makio-meshline
```
or
```bash
pnpm add makio-meshline
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
  lineWidth: 0.5,
});

scene.add(line);
```

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue.

## License

This project is licensed under the MIT License. 