import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { pass } from 'three/tsl'
import { RenderPipeline } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'

/**
 * Soft glow pipeline for Three.js `WebGPURenderer`.
 * The scene pass keeps the renderer's MSAA so thin ribbons stay smooth; only
 * the bloom pass runs at a reduced resolution scale.
 *
 * Accepts explicit `{ renderer, scene, camera }` so it can be reused directly
 * in standalone projects, while defaulting to `stage3d` inside the demo app.
 */
export function createBloomPipeline( {
	renderer = stage3d.renderer,
	scene = stage3d.scene,
	camera = stage3d.camera,
	strength = 0.7,
	radius = 0.35,
	threshold = 0,
	resolutionScale = isMobile ? 0.3 : 0.5,
} = {} ) {
	const renderPipeline = new RenderPipeline( renderer )
	const scenePass = pass( scene, camera )
	const sceneColor = scenePass.getTextureNode( 'output' )
	const bloomPass = bloom( sceneColor, strength, radius, threshold )
	bloomPass.setResolutionScale( resolutionScale )
	renderPipeline.outputNode = sceneColor.add( bloomPass )

	const bloomPipeline = {
		renderPipeline,
		scenePass,
		bloomPass,
		dispose() {
			if ( stage3d.renderPipeline === renderPipeline ) stage3d.renderPipeline = null
			renderPipeline.dispose()
			bloomPass.dispose()
			scenePass.dispose()
		},
	}

	if ( renderer === stage3d.renderer ) {
		stage3d.renderPipeline = renderPipeline
		stage3d.own( bloomPipeline )
	}

	return bloomPipeline
}
