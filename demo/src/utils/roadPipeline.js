import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { builtinAOContext, context, mrt, normalView, pass, rtt, screenUV } from 'three/tsl'
import { Lighting, RedFormat, RenderPipeline, UnsignedByteType } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

/** Contact occlusion in the ambient lighting, with the sun and MSAA kept intact. */
export function createRoadPipeline() {
	const { renderer, scene, camera } = stage3d
	const renderPipeline = new RenderPipeline( renderer )

	// GTAO gathers depth samples, which cannot read multisampled depth on WebGPU.
	// A separate prepass leaves the beauty pass free to use the renderer's MSAA.
	const normalPass = pass( scene, camera, { samples: 0 } )
	normalPass.name = 'Road normals and depth'
	normalPass.transparent = false
	normalPass.setMRT( mrt( { output: normalView } ) )
	normalPass.contextNode = context( { getAO: () => null } )
	const normalLighting = new Lighting()
	normalLighting.enabled = false
	normalPass.lighting = normalLighting
	const normals = normalPass.getTextureNode()
	const depth = normalPass.getTextureNode( 'depth' )

	const aoPass = ao( depth, normals, camera )
	aoPass.resolutionScale = 0.5
	aoPass.samples.value = 16
	aoPass.radius.value = 1.2
	aoPass.scale.value = 0.9
	aoPass.thickness.value = 1

	// Spatial denoising avoids trails behind the fast-moving cars. Material UVs
	// never enter the screen-space filter: render it to its own half-size texture.
	const denoisePass = denoise( aoPass.getTextureNode(), depth, normals, camera )
	denoisePass.radius.value = 3
	denoisePass.depthPhi.value = 0.3
	denoisePass.normalPhi.value = 8
	const denoisedAO = rtt( denoisePass, null, null, {
		resolutionScale: 0.5,
		depthBuffer: false,
		format: RedFormat,
		type: UnsignedByteType,
	} )

	const scenePass = pass( scene, camera )
	scenePass.contextNode = builtinAOContext( denoisedAO.sample( screenUV ).r )
	renderPipeline.outputNode = scenePass

	// PassNode, GTAONode and RTTNode follow the renderer's drawing-buffer size.
	const pipeline = stage3d.own( {
		renderPipeline,
		normalPass,
		scenePass,
		aoPass,
		denoisePass,
		denoisedAO,
		dispose() {
			if ( stage3d.renderPipeline === renderPipeline ) stage3d.renderPipeline = null
			renderPipeline.dispose()
			scenePass.dispose()
			denoisedAO.dispose()
			denoisePass.dispose()
			aoPass.dispose()
			normalPass.dispose()
			normalLighting.dispose()
		},
	} )
	stage3d.renderPipeline = renderPipeline
	return pipeline
}
