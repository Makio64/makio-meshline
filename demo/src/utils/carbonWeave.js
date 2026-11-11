import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

/** A 2 x 2 twill, one texel per crossing of the tows: white where the warp lies on top. Released with the demo. */
export function createCarbonWeave() {
	const weave = new DataTexture( new Uint8Array( [255, 255, 0, 0, 0, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255] ), 4, 4, RedFormat )
	weave.wrapS = weave.wrapT = RepeatWrapping
	weave.magFilter = LinearFilter
	weave.minFilter = LinearMipmapLinearFilter
	weave.generateMipmaps = true
	weave.needsUpdate = true
	return stage3d.own( weave )
}
