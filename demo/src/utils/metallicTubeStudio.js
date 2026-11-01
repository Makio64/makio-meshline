/** Staging of the Metallic Tube demo: the baked reflection studio and the floor. */
import { color, mix, positionLocal, smoothstep, uv, vec3 } from 'three/tsl'
import { AdditiveBlending, BackSide, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, PlaneGeometry, PMREMGenerator, Scene, SphereGeometry } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

// Softboxes for the reflection studio: [x, y, z, width, height, color, intensity].
const STUDIO_SOFTBOXES = [
	[0, 9, 1.5, 14, 7, 0xe8f0ff, 2.4],
	[-9, 1.8, -2.5, 2.4, 10, 0x36d9ff, 1.2],
	[9, 2.2, 2.5, 2.4, 10, 0xff477e, 1.1],
	[1.5, 1.2, -10, 9, 2, 0xffc857, 0.9],
]

// Bake a small studio (dark floor, soft horizon, softboxes tinted like the
// orbiting lights) into a PMREM once. Reflecting it through the standard
// environment pipeline keeps the highlights anchored in the world, blurred by
// roughness and tinted by the metal, so they slide over the chrome as the view
// orbits instead of painting fixed bands onto the screen.
export function createStudioEnvironment() {
	const scene = new Scene()

	const direction = positionLocal.normalize()
	const domeMaterial = new MeshBasicNodeMaterial( { side: BackSide } )
	const below = mix( vec3( 0.03, 0.022, 0.035 ), vec3( 0.012, 0.014, 0.022 ), smoothstep( -0.05, -0.6, direction.y ) )
	const above = mix( vec3( 0.12, 0.15, 0.22 ), vec3( 0.025, 0.035, 0.07 ), smoothstep( 0.02, 0.7, direction.y ) )
	domeMaterial.colorNode = mix( below, above, smoothstep( -0.04, 0.04, direction.y ) )
	scene.add( new Mesh( new SphereGeometry( 20, 48, 24 ), domeMaterial ) )

	// Feathered panels add onto the dome, so their reflections fall off softly
	// instead of reading as hard-edged neon strips on a thin tube.
	const edge = uv().sub( 0.5 ).abs().mul( 2 )
	const feather = smoothstep( 0.35, 1, edge.x ).oneMinus().mul( smoothstep( 0.35, 1, edge.y ).oneMinus() )
	STUDIO_SOFTBOXES.forEach( ( [x, y, z, width, height, hex, intensity] ) => {
		const material = new MeshBasicNodeMaterial( { blending: AdditiveBlending, depthWrite: false } )
		material.colorNode = color( hex ).mul( intensity ).mul( feather )
		const panel = new Mesh( new PlaneGeometry( width, height ), material )
		panel.position.set( x, y, z )
		panel.lookAt( 0, 0, 0 )
		scene.add( panel )
	} )

	const pmrem = new PMREMGenerator( stage3d.renderer )
	const target = stage3d.own( pmrem.fromScene( scene, 0.04 ) )
	pmrem.dispose()
	scene.traverse( object => {
		object.geometry?.dispose()
		object.material?.dispose()
	} )

	return target.texture
}

export function createFloor() {
	const floor = new Mesh(
		new PlaneGeometry( 24, 24 ),
		new MeshStandardNodeMaterial( { color: 0x0e1320, roughness: 0.72, metalness: 0.14 } )
	)
	floor.rotation.x = -Math.PI * 0.5
	floor.position.y = -2.7
	stage3d.add( floor )
}
