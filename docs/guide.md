# Getting Started

This guide will walk you through the basics of installing and using Makio MeshLine in your Three.js project.

## Installation

First, install the package:

```bash
pnpm add makio-meshline #or npm/yarn
```

## Basic Setup

Here's a minimal example of how to create a simple circular line and add it to your scene:

```javascript
import * as THREE from 'three/webgpu';
import { MeshLine, circlePositions } from 'makio-meshline';

// Initialize your scene
// Set up a basic Three.js scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGPURenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// circlePositions return a Float32Array with the positions  
const positions = circlePositions( 64, 10 )

// Create the line
const line = new new MeshLine()
	.lines( positions ) // setup the line initial positions
	.isClose( true ) // circle will be close 
	.lineWidth( 1 ) // 1 unit in threejs measurement
	.color( 0xff8800 )
	.gradientColor( 0xffffff )

scene.add(line);

// Render the scene
// Make sure your render loop is running to see the line
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
```

That's it! You should now see a vibrant orange circle in your scene.


## Next Steps

- Use the sandbox to generate code for your line [Sandbox](./examples/sandbox.md) 
- Check out the [Live Demos](https://meshlines.netlify.app) to see various implementations in action
- Check out their source code [`demo/`](https://github.com/Makio64/Meshline/tree/main/demo/src/demos) directory of the repository for more advanced usage. 
- Check out the [API Reference](./api.md) to explore all the available customization options.
