import { FrontSide, MeshStandardNodeMaterial } from 'three/webgpu'

/**
 * Lit material profile for camera-independent MeshLine surfaces such as roads,
 * tracks, and ribbons. Surface geometry already contains expanded positions,
 * normals, plus optional tangents and UVs, so this material intentionally
 * performs no billboard extrusion in the vertex stage.
 */
export class MeshLineSurfaceNodeMaterial extends MeshStandardNodeMaterial {

	constructor( options = null ) {
		super()
		this.type = 'MeshLineSurfaceNodeMaterial'
		this.isMeshLineSurfaceNodeMaterial = true
		if ( options ) this.buildLine( options )
	}

	/**
	 * Configure the common road/surface appearance options.
	 * @param {import('./index.d.ts').MeshLineConfigureOptions} options
	 */
	buildLine( options = {} ) {
		const surface = options.surface && typeof options.surface === 'object' ? options.surface : {}
		const opacity = options.opacity ?? 1
		if ( !Number.isFinite( opacity ) || opacity < 0 || opacity > 1 ) {
			throw new Error( '[MeshLineSurfaceNodeMaterial] opacity must be within [0, 1]' )
		}
		if ( options.alphaTest !== undefined && ( !Number.isFinite( options.alphaTest ) || options.alphaTest < 0 || options.alphaTest > 1 ) ) {
			throw new Error( '[MeshLineSurfaceNodeMaterial] alphaTest must be within [0, 1]' )
		}
		for ( const property of ['roughness', 'metalness'] ) {
			if ( surface[property] !== undefined && !Number.isFinite( surface[property] ) ) {
				throw new Error( `[MeshLineSurfaceNodeMaterial] surface.${property} must be finite` )
			}
		}

		this.options = { ...options, surface: { ...surface } }
		this.color.set( options.color ?? 0xffffff )
		this.map = options.map ?? null
		this.alphaMap = options.alphaMap ?? null
		this.normalMap = surface.normalMap ?? null
		this.roughnessMap = surface.roughnessMap ?? null
		this.metalnessMap = surface.metalnessMap ?? null
		this.roughness = surface.roughness ?? 0.9
		this.metalness = surface.metalness ?? 0
		this.opacity = opacity
		this.transparent = this.opacity < 1 || this.alphaMap != null || ( options.transparent ?? false )
		this.alphaTest = options.alphaTest ?? 0
		this.depthWrite = options.depthWrite ?? !this.transparent
		this.depthTest = options.depthTest ?? true
		this.wireframe = options.wireframe ?? false
		this.side = surface.side ?? FrontSide
		this.needsUpdate = true
	}

	/**
	 * Surface shadows use the generated world-space geometry directly.
	 * This method mirrors the billboard material API used by the MeshLine facade.
	 */
	setShadow() {}

	copy( source ) {
		super.copy( source )

		// NodeMaterial.copy() copies every enumerable property as of Three r185,
		// so clone our configuration after the base copy to avoid retaining the
		// source material's options object by reference.
		this.options = source.options ? {
			...source.options,
			surface: source.options.surface ? { ...source.options.surface } : source.options.surface,
		} : undefined

		// MeshStandardNodeMaterial initializes these fields from a standard
		// material, but its copy() only handles node properties. Preserve the live
		// surface state rather than replaying potentially stale build options.
		this.color.copy( source.color )
		this.roughness = source.roughness
		this.metalness = source.metalness
		this.map = source.map
		this.lightMap = source.lightMap
		this.lightMapIntensity = source.lightMapIntensity
		this.aoMap = source.aoMap
		this.aoMapIntensity = source.aoMapIntensity
		this.emissive.copy( source.emissive )
		this.emissiveMap = source.emissiveMap
		this.emissiveIntensity = source.emissiveIntensity
		this.bumpMap = source.bumpMap
		this.bumpScale = source.bumpScale
		this.normalMap = source.normalMap
		this.normalMapType = source.normalMapType
		this.normalScale.copy( source.normalScale )
		this.displacementMap = source.displacementMap
		this.displacementScale = source.displacementScale
		this.displacementBias = source.displacementBias
		this.roughnessMap = source.roughnessMap
		this.metalnessMap = source.metalnessMap
		this.alphaMap = source.alphaMap
		this.envMap = source.envMap
		this.envMapRotation.copy( source.envMapRotation )
		this.envMapIntensity = source.envMapIntensity
		this.wireframe = source.wireframe
		this.wireframeLinewidth = source.wireframeLinewidth
		this.wireframeLinecap = source.wireframeLinecap
		this.wireframeLinejoin = source.wireframeLinejoin
		this.flatShading = source.flatShading
		this.fog = source.fog

		return this
	}

	static get type() {
		return 'MeshLineSurfaceNodeMaterial'
	}

}

export default MeshLineSurfaceNodeMaterial
