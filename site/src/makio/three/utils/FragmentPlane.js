import { stage3d } from '@/makio'
import { Mesh, PlaneGeometry, RawShaderMaterial } from 'three'

class FragmentPlane extends Mesh {
	constructor( { fs = '', uniforms = {} } = {} ) {
		uniforms.iGlobalTime = { type: 'f', value: 0.0 }
		uniforms.iResolution = { type: 'v2', value: stage3d.resolution }
		uniforms.camera = { type: 'v3', value: stage3d.camera.position }

		let vs = 'precision highp float; attribute vec3 position; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;'
		vs += 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );}'

		let material = new RawShaderMaterial( {
			uniforms: uniforms,
			fragmentShader: fs,
			vertexShader: vs,
			transparent: true,
		} )

		let geometry = new PlaneGeometry( 1, 1, 1, 1 )

		super( geometry, material )

		stage3d.onBeforeRenderer.add( this.onBeforeRenderer )
		this.uniforms = uniforms
	}

	onBeforeRenderer = () => {
		this.lookAt( stage3d.camera.position )
	}

	dispose() {
		this.geometry.dispose()
		this.material.dispose()
	}
}

export default FragmentPlane
export { FragmentPlane }
