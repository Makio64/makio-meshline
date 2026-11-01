/**
 * Shadows (Cast & Receive): three concentric dashed `MeshLine` rings that both
 * cast and receive shadows under orbiting RGB spotlights.
 *
 * Key APIs:
 * - `.shadow( true, true )` for simultaneous shadow casting and receiving
 *   (with 3D cylindrical tube normal reconstruction on billboards)
 * - `.dash( { count, ratio } )` with animated `line.material.dashOffset.value`
 */
import { circlePositions, MeshLine } from 'makio-meshline'
import { AmbientLight, BackSide, MathUtils, Mesh, MeshStandardNodeMaterial, SphereGeometry, SpotLight } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { createDemoHint } from '@/utils/demoHint'

// Pure red, green and blue lights on white surfaces: where one ring blocks a
// light, the other two mix, so every shadow comes out cyan, magenta or yellow.
const LIGHTS = [
	{ color: 0xff3b3b, radius: 10, phiSpeed: 0.2, thetaSpeed: 0.3, phiOffset: 0, thetaOffset: 0, phiAmp: 0.3 },
	{ color: 0x3bff5e, radius: 9, phiSpeed: 0.35, thetaSpeed: 0.5, phiOffset: Math.PI * 0.5, thetaOffset: Math.PI * 2 / 3, phiAmp: 0.4 },
	{ color: 0x3b6bff, radius: 8, phiSpeed: 0.5, thetaSpeed: 0.7, phiOffset: Math.PI, thetaOffset: Math.PI * 4 / 3, phiAmp: 0.5 },
]
const RINGS = [
	{ radius: 2.3, width: 0.14, color: 0x15161C, dash: { count: 24, ratio: 0.55 } },
	{ radius: 3.0, width: 0.11, color: 0x1C1E26, dash: { count: 36, ratio: 0.45 } },
	{ radius: 3.7, width: 0.09, color: 0x23252F, dash: { count: 52, ratio: 0.38 } },
]
const SCULPTURE_RADIUS = 4.1
const CAMERA_RADIUS = 10

const addWhiteSphere = ( radius, options ) => {
	const sphere = new Mesh( new SphereGeometry( radius, 64, 48 ), new MeshStandardNodeMaterial( options ) )
	sphere.receiveShadow = true
	stage3d.add( sphere )
}

export default class ShadowExample {
	time = 0

	async init() {
		await stage3d.initRender( { background: 0xF4F1EA } )
		stage3d.renderer.shadowMap.enabled = true
		stage3d.renderer.shadowMap.transmitted = true
		stage3d.orbit( CAMERA_RADIUS, { phi: 1.12, theta: 0.78, minRadius: 6, maxRadius: 26 } )
		this.onResize()

		// A white room: the colored lights paint it and the rings print on it.
		addWhiteSphere( 8, { roughness: 0.92, side: BackSide } )
		addWhiteSphere( 1.4, { roughness: 0.45 } )
		this.createLights()
		this.createRings()
		createDemoHint( 'Live cast + receive · 3 moving spotlights', { accent: '#7ee7ff', hideAfter: 0 } )
	}

	createLights() {
		this.lights = LIGHTS.map( ( { color } ) => {
			const light = new SpotLight( color, 30 )
			light.angle = Math.PI / 4.5
			light.penumbra = 0.55
			light.decay = 1.4
			light.castShadow = true
			light.shadow.camera.far = 40
			light.shadow.bias = -0.0003
			light.shadow.radius = 4
			return light
		} )

		stage3d.add( new AmbientLight( 0xFFFFFF, 0.18 ), ...this.lights )
	}

	createRings() {
		this.lines = RINGS.map( ring => new MeshLine()
			.lines( circlePositions( 200, ring.radius ), true )
			.color( ring.color )
			.lineWidth( ring.width )
			.dash( ring.dash )
			.shadow( true, true )
			.autoResize()
			// update() writes the dashOffset uniform, which build() creates.
			.build() )

		stage3d.add( ...this.lines )
	}

	update = dt => {
		this.time += dt * 0.001

		for ( let i = 0; i < RINGS.length; i++ ) {
			const line = this.lines[i]
			line.rotation.x = this.time * ( 0.15 + i * 0.1 )
			line.rotation.y = this.time * ( 0.1 + i * 0.05 )
			line.material.dashOffset.value = -this.time * ( 1 + i * 0.5 )
		}

		for ( let i = 0; i < LIGHTS.length; i++ ) {
			const { radius, phiSpeed, thetaSpeed, phiOffset, thetaOffset, phiAmp } = LIGHTS[i]
			const phi = Math.PI * 0.3 + Math.sin( this.time * phiSpeed + phiOffset ) * phiAmp
			const theta = Math.PI / 2 - this.time * thetaSpeed - thetaOffset
			this.lights[i].position.setFromSphericalCoords( radius, phi, theta )
		}
	}

	// Narrow screens back the camera away so the whole sculpture still fits the width.
	onResize = () => {
		const { control } = stage3d
		const halfFov = MathUtils.degToRad( stage3d.camera.fov / 2 )
		const portraitFit = SCULPTURE_RADIUS / ( Math.tan( halfFov ) * stage3d.camera.aspect )
		control.snapRadius( MathUtils.clamp( portraitFit, CAMERA_RADIUS, control.maxRadius ) )
	}
}
