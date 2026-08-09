---
description: "Build a textured world-space road from a Float32Array path with stable surface frames, banking, distance UVs, and bounded joins."
outline: false
pageClass: example-page
---

# Road Surface

This example turns one centerline into a lit, textured road with real world-space width. Orbiting the camera does not change its frame or thickness.

<iframe title="Makio MeshLine Road Surface demo" src="https://meshline-demo.makio.io/examples/surface-road?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Road Surface demo](https://meshline-demo.makio.io/examples/surface-road)

## Copy-Paste Example

```js
import { MeshLine } from 'makio-meshline'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
	CanvasTexture,
	DirectionalLight,
	HemisphereLight,
	PerspectiveCamera,
	RepeatWrapping,
	Scene,
	SRGBColorSpace,
	WebGPURenderer,
} from 'three/webgpu'

const createRoadPath = ( pointCount = 192 ) => {
	const points = new Float32Array( pointCount * 3 )

	for ( let i = 0; i < pointCount; i++ ) {
		const progress = i / ( pointCount - 1 )
		const offset = i * 3

		points[offset] = ( progress - 0.5 ) * 34
		points[offset + 1] = Math.sin( progress * Math.PI ) * 0.15
		points[offset + 2] = Math.sin( progress * Math.PI * 2 ) * 4
			+ Math.sin( progress * Math.PI * 5 ) * 0.75
	}

	return points
}

const createRoadTexture = () => {
	const canvas = document.createElement( 'canvas' )
	canvas.width = 512
	canvas.height = 128
	const context = canvas.getContext( '2d' )

	context.fillStyle = '#252a2f'
	context.fillRect( 0, 0, canvas.width, canvas.height )
	context.fillStyle = '#f4f0dc'
	context.fillRect( 0, 8, canvas.width, 5 )
	context.fillRect( 0, canvas.height - 13, canvas.width, 5 )
	context.fillStyle = '#f3c74f'
	context.fillRect( 48, canvas.height / 2 - 3, 300, 6 )

	const texture = new CanvasTexture( canvas )
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	texture.colorSpace = SRGBColorSpace
	return texture
}

const renderer = new WebGPURenderer( { antialias: true } )
renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) )
renderer.setSize( innerWidth, innerHeight )
document.body.appendChild( renderer.domElement )
await renderer.init()

const scene = new Scene()
const camera = new PerspectiveCamera( 55, innerWidth / innerHeight, 0.1, 100 )
camera.position.set( 13, 12, 18 )

const controls = new OrbitControls( camera, renderer.domElement )
controls.target.set( 0, 0, 0 )
controls.update()

const roadTexture = createRoadTexture()
const road = new MeshLine()
	.lines( createRoadPath() )
	.lineWidth( 3.2 )
	.color( 0xffffff )
	.map( roadTexture )
	.surface( {
		frame: 'transport',
		up: [0, 1, 0],
		bank: progress => Math.sin( progress * Math.PI * 2 ) * 0.045,
		uvMode: 'distance',
		uvScale: 5,
		roughness: 0.88,
		metalness: 0,
	} )
	.join( { type: 'miter', limit: 3, segments: 8 } )
	.build()

scene.add( road )
scene.add( new HemisphereLight( 0xeaf5ff, 0x3d482c, 2.2 ) )

const sun = new DirectionalLight( 0xfff2d2, 3.2 )
sun.position.set( -8, 18, 10 )
scene.add( sun )

renderer.setAnimationLoop( () => renderer.render( scene, camera ) )

addEventListener( 'resize', () => {
	camera.aspect = innerWidth / innerHeight
	camera.updateProjectionMatrix()
	renderer.setSize( innerWidth, innerHeight )
} )
```

`uvMode: 'distance'` makes the lane texture repeat by traveled distance, so adding more centerline samples does not stretch the markings. The small `bank` callback rotates the complete surface frame around the path tangent.

Ordinary miter/butt sections stay on the compact two-row topology. Select `join: { type: 'round', segments: 8 }` for true outer fans and `cap: { type: 'round', segments: 8 }` for round endpoints. A wide road can still overlap itself at a zero-radius hairpin, so model a finite-radius turn when that overlap is not desired. See [World-Space Surfaces](../surface.md) for the exact corner policy and low-level API.
