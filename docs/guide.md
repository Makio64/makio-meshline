# Getting Started

This guide will walk you through the basics of installing and using Makio MeshLine in your Three.js project.

## Installation

First, use your favoratie packages manager (`pnpm`, `npm`, `yarn`..) to install `makio-meshline` 

```bash
pnpm i makio-meshline
```

## Basic Setup

Here's a minimal example of how to create a simple circular line and add it to your scene.

1.  **Import necessary modules:**
    You'll need `MeshLine` and a positions helper like `circlePositions`. You'll also need `three`.

    ```javascript
    import { MeshLine, circlePositions } from 'meshline';
    import * as THREE from 'three';
    ```

2.  **Initialize your scene:**
    Make sure you have a basic Three.js scene, camera, and renderer set up.

    ```javascript
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    ```

3.  **Create the line:**
    Generate an array of points for your line's shape. The `circlePositions` helper is great for this. Then, instantiate `MeshLine` with these positions via the `lines` option along with your desired settings.

    ```javascript
    const line = new MeshLine({
      lines: circlePositions(64), // Points array
      isClose: true,              // Close the loop
      color: 0xff8800,            // Orange color
      lineWidth: 0.5,             // In pixels (when sizeAttenuation = false)
    });

    scene.add(line);
    ```

4.  **Render the scene:**
    Finally, make sure your render loop is running to see the line.

    ```javascript
    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();
    ```

That's it! You should now see a vibrant orange circle in your scene.

## Next Steps

-   Check out the [API Reference](./api.md) to explore all the available customization options.
-   Look at the examples in the `site` directory of the repository for more advanced usage. 