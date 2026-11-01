/** Moss and leaf litter under the grove. Not a MeshLine, it only catches the shadows. */
import { color, mix, smoothstep, texture, uv } from 'three/tsl'
import { Mesh, MeshStandardNodeMaterial, PlaneGeometry, RepeatWrapping, TextureLoader } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

export function createGround() {
	const noise = stage3d.own( new TextureLoader().load( '/textures/noises/perlin/rgb-256x256.png' ) )
	noise.wrapS = RepeatWrapping
	noise.wrapT = RepeatWrapping

	// Two octaves of the noise texture.
	const material = new MeshStandardNodeMaterial( { roughness: 0.95 } )
	const coordinate = uv().mul( 7 )
	const litter = texture( noise, coordinate ).r.mul( 0.6 ).add( texture( noise, coordinate.mul( 3.3 ) ).g.mul( 0.4 ) )
	material.colorNode = mix( color( 0x34461F ), color( 0x75653A ), smoothstep( 0.38, 0.72, litter ) )

	const ground = new Mesh( new PlaneGeometry( 80, 80 ), material )
	ground.rotation.x = -Math.PI / 2
	ground.receiveShadow = true
	return ground
}
