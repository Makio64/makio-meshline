import { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'

// A renderer that only lends its backend's node builders: it is never initialised.
export const createRenderer = ( forceWebGL = false ) => {
	const renderer = new WebGPURenderer( { canvas: { width: 1, height: 1 }, forceWebGL } )
	// r187+ resolve shared bind groups through the renderer's bindings, which
	// only exist after init(); a missing one falls back to a plain bind group.
	if ( renderer._bindings === null ) renderer._bindings = undefined
	renderer.hasCompatibility = () => true
	renderer.hasFeature = () => false
	return renderer
}

// The node builder a render of `object` would get, not built yet.
export const createShaderBuilder = ( renderer, object, { fogNode = null, lightsNode = null } = {} ) => {
	const builder = renderer.backend.createNodeBuilder( object, renderer )
	builder.scene = new Scene()
	builder.camera = new PerspectiveCamera()
	builder.material = object.material
	builder.context.material = object.material
	builder.fogNode = fogNode
	if ( lightsNode ) builder.lightsNode = lightsNode
	return builder
}

// Returns the built builder: its `vertexShader`, `fragmentShader` and `attributes`.
export const buildShaderGraph = ( renderer, object, options ) => createShaderBuilder( renderer, object, options ).build()
