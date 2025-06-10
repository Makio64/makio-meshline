import stage from '@/makio/core/stage'
import { EffectComposer, KawaseBlurPass, RenderPass, SavePass, TextureEffect, EffectPass, NoiseEffect, BlendFunction, ShaderPass, CopyMaterial, SMAAEffect, SMAAPreset, EdgeDetectionMode, PredicationMode } from 'postprocessing'
import { HalfFloatType } from 'three'
import { isMobile } from '../utils/detect'

class PostProcess {
	constructor( renderer ) {
		// prevent banding on dark scene with low bit depth
		// read more on : https://github.com/pmndrs/postprocessing#output-color-space
		const options = isMobile ? {} : { frameBufferType: HalfFloatType }
		this.composer = new EffectComposer( renderer, options )
	}

	init( scene, camera ) {
		this.scene = scene
		this.camera = camera
		this.params = {
			blur: 0,
		}

		const savePass = new SavePass()
		this.blurPass = new KawaseBlurPass( { height: 480 } )
		this.composer.addPass( this.blurPass )

		const textureEffect = new TextureEffect( {
			texture: savePass.renderTarget.texture,
		} )

		const texturePass = new EffectPass( camera, textureEffect )
		const noiseEffect = new NoiseEffect()

		noiseEffect.blendMode.opacity.value = 0.15
		noiseEffect.blendMode.blendFunction = BlendFunction.REFLECT
		this.noisePass = new EffectPass( camera, noiseEffect )

		textureEffect.blendMode.opacity.value = 0.0

		this.texturePass = texturePass
		this.textureEffect = textureEffect
		this.savePass = savePass

		const smaaEffect = new SMAAEffect( {
			preset: SMAAPreset.MEDIUM,
			edgeDetectionMode: EdgeDetectionMode.COLOR,
			predicationMode: PredicationMode.DEPTH,
		} )
		smaaEffect.edgeDetectionMaterial.edgeDetectionThreshold = 0.02
		smaaEffect.edgeDetectionMaterial.predicationThreshold = 0.002
		smaaEffect.edgeDetectionMaterial.predicationScale = 1

		this.composer.addPass( new RenderPass( scene, camera ) )
		this.composer.addPass( this.savePass )
		this.composer.addPass( this.blurPass )
		this.composer.addPass( this.texturePass )
		// this.composer.addPass(this.noisePass)
		this.composer.addPass( new EffectPass( camera, smaaEffect ) )

		stage.onUpdate.add( this.update )
	}

	update = () => {
		this.textureEffect.blendMode.opacity.value = 1 - this.params.blur
	}

	resize = ( width, height ) => {
		this.composer.setSize( width, height )
	}
}

export default PostProcess
