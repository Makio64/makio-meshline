import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { pass } from 'three/tsl'
import { RenderPipeline } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'

/**
 * Soft glow for the line showcases. The scene pass keeps the renderer's MSAA
 * so thin ribbons stay smooth; only the bloom itself runs at a reduced size.
 * Returns the bloom node so a demo can animate its strength/radius uniforms.
 */
export function createBloomPipeline( { strength = 0.7, radius = 0.35, threshold = 0, resolutionScale = isMobile ? 0.3 : 0.5 } = {} ) {
	const renderPipeline = new RenderPipeline( stage3d.renderer )
	const scenePass = pass( stage3d.scene, stage3d.camera )
	const sceneColor = scenePass.getTextureNode( 'output' )
	const bloomPass = bloom( sceneColor, strength, radius, threshold )
	bloomPass.setResolutionScale( resolutionScale )
	renderPipeline.outputNode = sceneColor.add( bloomPass )
	stage3d.renderPipeline = renderPipeline

	return {
		bloomPass,
		dispose() {
			if ( stage3d.renderPipeline === renderPipeline ) stage3d.renderPipeline = null
			renderPipeline.dispose()
			bloomPass.dispose()
			scenePass.dispose()
		},
	}
}
