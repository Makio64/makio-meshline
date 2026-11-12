---
title: "Three.js Thick Lines with WebGPU & TSL"
noindex: true
description: "Draw thick lines in Three.js with a complete WebGPU example, CSS-pixel width, gradients, dashes, TSL hooks, and WebGL2 fallback."
---

# Draw Thick Lines in Three.js with WebGPU and TSL

::: warning Unreleased V2 example
This guide targets the V2 source checkout, which is still in development. The snippets are preparation for V2 and are not an installation guide for the currently published npm release.
:::

To draw a thick line in Three.js, use geometry that expands your path into triangles. This guide creates a styled polyline with Makio MeshLine, keeps its width constant on screen, and handles resizing and cleanup. The same setup works with WebGPU and WebGL2 through `WebGPURenderer`.

## Why `THREE.Line` Stays One Pixel Wide

[`LineBasicMaterial.linewidth`](https://threejs.org/docs/pages/LineBasicMaterial.html#linewidth) is ignored by Three.js's WebGL and WebGPU renderers: native line primitives have a width of one pixel. Increasing that property will therefore leave a `THREE.Line` looking unchanged. A mesh-based line gives the renderer actual triangles to fill, so thickness becomes part of the rendered geometry.

## Choose a Line Renderer

- **Three.js `Line2`** is an included addon for polylines with adjustable screen-space or world-space width. With `WebGPURenderer`, import it from `three/addons/lines/webgpu/Line2.js`, which uses `Line2NodeMaterial`. With `WebGLRenderer`, use `three/addons/lines/Line2.js` and `LineMaterial`. See the official [`Line2` reference](https://threejs.org/docs/pages/Line2.html) for the renderer distinction.
- **Makio MeshLine** provides a fluent `MeshLine` API for gradients, dashes, textures, TSL hooks, instancing, and world-space ribbon surfaces. The example below uses the `makio-meshline` package.
- **[spite/THREE.MeshLine](https://github.com/spite/THREE.MeshLine) and [pmndrs/meshline](https://github.com/pmndrs/meshline)** are separate mesh-based line projects; the latter is published as `meshline`. Follow the documentation for the package you install, since their APIs differ.

## A Complete Wide-Line Example

For now, run the V2 source workspace and its vanilla starter:

```bash
git clone https://github.com/Makio64/makio-meshline.git
cd makio-meshline
pnpm install
pnpm --filter makio-meshline-vanilla-example dev
```

This development checkout uses Three.js r186 or later. The following browser entry module shows the V2 API. The five XYZ points form a visible zigzag; no curve helpers or additional assets are needed.

```js
import { MeshLine } from 'makio-meshline'
import { Color, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'

const scene = new Scene()
scene.background = new Color( 0x101216 )

const camera = new PerspectiveCamera( 45, 1, 0.1, 100 )
camera.position.z = 8

const renderer = new WebGPURenderer( { antialias: true } )
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) )
document.body.style.margin = '0'
renderer.domElement.style.display = 'block'
document.body.append( renderer.domElement )
await renderer.init()

const points = new Float32Array( [
	-2, -0.5, 0,
	-1, 0.75, 0,
	0, -0.5, 0,
	1, 0.75, 0,
	2, -0.5, 0,
] )

const line = new MeshLine()
	.lines( points, false )
	.sizeAttenuation( false )
	.lineWidth( 12 )
	.color( 0x56d5ff )
	.needsUV( false )
	.autoResize()

scene.add( line )

function resize() {
	const width = window.innerWidth
	const height = window.innerHeight
	camera.aspect = width / height
	camera.updateProjectionMatrix()
	renderer.setSize( width, height )
}

resize()
window.addEventListener( 'resize', resize )
renderer.setAnimationLoop( () => renderer.render( scene, camera ) )

export async function dispose() {
	renderer.setAnimationLoop( null )
	window.removeEventListener( 'resize', resize )
	scene.remove( line )
	line.dispose()
	await renderer.dispose()
	renderer.domElement.remove()
}
```

Here `lineWidth( 12 )` means **12 CSS pixels** because `sizeAttenuation( false )` keeps thickness constant as the camera moves. For width that shrinks with distance, enable `sizeAttenuation( true )` and choose a scene-space value such as `0.15`. For camera-independent road or ribbon geometry, use the [surface profile](./surface.md).

`scene.add( line )` builds the line automatically. `.autoResize()` updates its resolution; the `resize()` function updates the camera and renderer. For an embedded canvas, use its container dimensions and call `line.resize( width, height )` alongside `renderer.setSize()`. Call `await dispose()` when unmounting this view; `line.dispose()` also removes its automatic resize listener.

## Add Gradients, Dashes, or a Taper

Add this chain before `scene.add( line )` to blend toward pink and draw eight dash cycles along the path:

```js
line
	.gradientColor( 0xff6ab8 )
	.dash( { count: 8, ratio: 0.6 } )
```

For width that grows along the path, import `Fn` and attach a TSL hook before adding the line:

```js
import { Fn } from 'three/tsl'

const taper = Fn( ( [width, progress] ) => {
	return width.mul( progress.mul( 0.75 ).add( 0.25 ) )
} )

line.widthFn( taper )
```

Hook arguments arrive as an array, so destructure `[width, progress]`. `progress` runs from zero to one along the path. This example needs no texture coordinates, so keep `.needsUV( false )`. Explore the [TSL hooks guide](./hooks.md) and [styling sandbox](./examples/sandbox.md) for more controls.

## Update Points and Integrate with Your App

For animation with a fixed point count, add `.dynamic( true )` when constructing the line, reuse your `Float32Array`, then call `line.setPositions( points, true )` after editing it. The second argument refreshes bounds. For changing point count or open/closed topology, use `line.lines( newPoints, closed )`; see [position updates](./meshline.md#position-updates).

Ordinary `MeshLine` rendering supports WebGPU and WebGL2 through `WebGPURenderer`. Optional features have their own backend requirements: [MeshLineCompute](./meshline-compute.md) needs native WebGPU compute support, for example.

Use the [React Three Fiber](./react-three-fiber.md) or [Vue](./vue.md) starter for framework lifecycle handling. Continue with [Getting Started](./guide.md), the [API reference](./api.md), or the [Draw & Trail example](./examples/drawlines.md) for interactive point updates.
