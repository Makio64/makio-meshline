import { cos, float, Fn, fract, instanceIndex, uniform, vec3 } from 'three/tsl'
import { Group, Mesh } from 'three/webgpu'

import MeshLineNodeMaterial from './MeshLineNodeMaterial.js'

const TWO_PI = Math.PI * 2
let _uninstancedHelperColorNode = null
let _instancedHelperColorNode = null

const hasVertexProgressHook = options => !!(
	options.gpuPositionNode ||
	options.positionFn ||
	options.previousFn ||
	options.nextFn ||
	options.widthFn ||
	options.normalFn ||
	options.vertexFn
)

const getHelperColorNode = instanced => {
	if ( !instanced ) {
		if ( !_uninstancedHelperColorNode ) {
			_uninstancedHelperColorNode = vec3( 1, 0.25, 0.25 )
		}
		return _uninstancedHelperColorNode
	}
	if ( !_instancedHelperColorNode ) {
		_instancedHelperColorNode = Fn( () => {
			const i = float( instanceIndex )
			// Golden-ratio scrambling spreads adjacent indices across the hue wheel,
			// then a cosine RGB palette gives each instance a distinct readable color.
			const hue = fract( i.mul( 0.61803398875 ) )
			const t = hue.mul( TWO_PI )
			return vec3(
				cos( t ).mul( 0.5 ).add( 0.5 ),
				cos( t.add( float( TWO_PI / 3 ) ) ).mul( 0.5 ).add( 0.5 ),
				cos( t.sub( float( TWO_PI / 3 ) ) ).mul( 0.5 ).add( 0.5 ),
			)
		} )()
	}
	return _instancedHelperColorNode
}

class MeshLineHelperMaterial extends MeshLineNodeMaterial {

	static get type() {
		return 'MeshLineHelperMaterial'
	}

	constructor() {
		super()
		this.type = 'MeshLineHelperMaterial'
		this.isMeshLineHelperMaterial = true
		this._helperOpacity = uniform( 0.45 )
	}

	buildLine( options = {} ) {
		super.buildLine( {
			...options,
			antialias: false,
			transparent: true,
			alphaTest: 0,
			depthWrite: false,
			needsProgress: hasVertexProgressHook( options ),
			needsVertexColor: false,
			needsUV: false,
			gradientColor: null,
			map: null,
			alphaMap: null,
			colorFn: null,
			gradientFn: null,
			opacityFn: null,
			dashCount: null,
			dashRatio: null,
			dashFn: null,
			uvFn: null,
			discardFn: null,
			fragmentColorFn: null,
			fragmentAlphaFn: null,
		} )
		this.transparent = true
		this.depthWrite = false
	}

	setupShaders( builder ) {
		super.setupShaders( builder )
		const instanced = !!( this.options && this.options.instanceCount > 0 )

		this.colorNode = getHelperColorNode( instanced )

		this.opacityNode = this._foldCoverageNode ? Fn( () => this.clipFoldedJoins( this._helperOpacity ) )() : this._helperOpacity
	}

}

/**
 * Visual helper for `MeshLinePicker`. Renders the picker's "thick" hit-zone
 * proxies (the wider lines used internally for GPU pixel picking) with
 * human-readable per-instance hues — so you can see *what the picker is
 * actually testing against* overlaid on your scene.
 *
 * Mirrors the shape of Three.js helpers like `BoxHelper` / `SkeletonHelper`:
 * construct it from a picker, add it to your scene, and call `update()` each
 * frame to keep the proxy transforms in sync with the registered lines.
 *
 * @example
 * const picker = new MeshLinePicker( renderer, scene, camera, { hitRadius: 15 } )
 * picker.add( meshLine )
 *
 * const helper = new MeshLinePickerHelper( picker, { opacity: 0.45 } )
 * scene.add( helper )
 *
 * // each frame:
 * helper.update()
 *
 * // toggle:
 * helper.visible = false
 */
export default class MeshLinePickerHelper extends Group {

	/**
	 * @param {import('./MeshLinePicker.js').default} picker
	 * @param {{ opacity?: number }} [options]
	 *   - `opacity`: alpha for the colored hit-zone overlay (0..1, default 0.45)
	 */
	constructor( picker, { opacity = 0.45 } = {} ) {
		super()
		this.type = 'MeshLinePickerHelper'
		this.isMeshLinePickerHelper = true
		this.picker = picker
		this._opacity = opacity
		this._proxies = []
		this.rebuild()
	}

	/**
	 * Rebuild proxies from the picker's current registry. Call this if you've
	 * added or removed lines from the picker after constructing the helper.
	 */
	rebuild() {
		this._disposeProxies()
		for ( const line of this.picker.lines ) {
			line._syncPositionStorage?.( this.picker.renderer )
			if ( typeof line.ensureBuilt === 'function' ) line.ensureBuilt()

			const material = new MeshLineHelperMaterial()
			material._helperOpacity.value = this._opacity
			const options = line._effectiveOptions?.() ?? line._options ?? {}
			material.buildLine( { ...options, needsVertexColor: false } )

			const proxy = new Mesh( line.geometry, material )
			proxy.frustumCulled = false
			proxy.matrixAutoUpdate = false
			proxy.matrixWorldAutoUpdate = false
			if ( line.count > 0 ) proxy.count = line.count
			proxy._sourceLine = line
			proxy._sourceJoin = line.material?.options?.join
			proxy._sourcePositionNode = options.gpuPositionNode ?? null

			this._proxies.push( proxy )
			this.add( proxy )
		}
		this.update()
	}

	/**
	 * Asynchronously warm up the helper proxy pipelines before the first visible render.
	 * @param {import('three/webgpu').WebGPURenderer} [renderer]
	 * @param {import('three').Camera} [camera]
	 * @param {import('three').Object3D | null} [scene]
	 * @returns {Promise<this>}
	 */
	async warmupAsync( renderer = this.picker?.renderer, camera = this.picker?.camera, scene = this.parent ?? this.picker?.scene ?? null ) {
		this.update()
		if ( !renderer ) return this
		if ( renderer._initialized === false && typeof renderer.init === 'function' ) {
			await renderer.init()
		}
		if ( typeof renderer.compileAsync === 'function' && camera ) {
			await renderer.compileAsync( this, camera, scene )
		}
		return this
	}

	/**
	 * Sync each proxy's transform, instance count, and width from its source
	 * line. Call once per frame before rendering.
	 */
	update() {
		const hitRadius = this.picker.hitRadius
		for ( const proxy of this._proxies ) {
			const line = proxy._sourceLine
			// Follow a line that moved to or from a storage buffer.
			const built = line._effectiveOptions?.()
			if ( built && ( built.gpuPositionNode ?? null ) !== proxy._sourcePositionNode ) {
				proxy._sourcePositionNode = built.gpuPositionNode ?? null
				proxy.material.buildLine( { ...built, needsVertexColor: false } )
			}
			const src = line.material
			proxy.material.lineWidth.value = src.lineWidth.value * hitRadius
			proxy.material.dpr.value = src.dpr.value
			proxy.material.resolution.value.copy( src.resolution.value )
			if ( src.miterLimit !== undefined ) proxy.material.miterLimit = src.miterLimit
			const join = src.options?.join
			if ( join && proxy._sourceJoin !== join ) {
				proxy._sourceJoin = join
				proxy.material.setJoin( join )
			}
			if ( line.count > 0 ) proxy.count = line.count
			proxy.matrixWorld.copy( line.matrixWorld )
			proxy.visible = line.visible
			proxy.renderOrder = line.renderOrder
		}
	}

	/**
	 * Set the per-instance hue overlay opacity.
	 * @param {number} opacity 0..1
	 */
	setOpacity( opacity ) {
		this._opacity = opacity
		for ( const proxy of this._proxies ) {
			proxy.material._helperOpacity.value = opacity
		}
	}

	_disposeProxies() {
		for ( const proxy of this._proxies ) {
			this.remove( proxy )
			proxy.material.dispose()
		}
		this._proxies.length = 0
	}

	/**
	 * Dispose all proxy materials and detach them from the helper. Geometries
	 * are owned by the source lines and are NOT disposed.
	 */
	dispose() {
		this._disposeProxies()
	}

}
