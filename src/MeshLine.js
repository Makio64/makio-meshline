import { uniform } from "three/tsl"
import { InstancedBufferAttribute, Matrix4, Mesh, Ray, Sphere, StaticDrawUsage, StreamDrawUsage, Vector3 } from "three/webgpu"

import MeshLineGeometry from "./MeshLineGeometry.js"
import MeshLineNodeMaterial from "./MeshLineNodeMaterial.js"
import { straightLine } from "./positions/straightLine.js"

// Pre-allocated temporaries for raycast (avoid GC)
const _inverseMatrix = new Matrix4()
const _ray = new Ray()
const _sphere = new Sphere()
const _vStart = new Vector3()
const _vEnd = new Vector3()
const _interRay = new Vector3()
const _interSegment = new Vector3()

// SSR-safe helpers
const isBrowser = typeof window !== 'undefined'
const getDefaultDPR = () => isBrowser ? ( window.devicePixelRatio || 1 ) : 1
const getDefaultWidth = () => isBrowser ? window.innerWidth : 1024
const getDefaultHeight = () => isBrowser ? window.innerHeight : 768

const defaultPositions = straightLine( 2 )

/**
 * High-level facade for creating GPU-rendered lines in Three.js.
 * Extends `THREE.Mesh` and provides a fluent/chainable API for configuring
 * geometry, material, hooks, and instancing in a single call chain.
 *
 * @example
 * const line = new MeshLine()
 *   .lines( circlePositions( 64 ), true )
 *   .color( 0xff6600 )
 *   .lineWidth( 0.4 )
 *   .build()
 * scene.add( line )
 */
export default class MeshLine extends Mesh {

	constructor( options = {} ) {

		super( new MeshLineGeometry(), new MeshLineNodeMaterial() )

		this._options = {
			segments: 1,
			closed: false,
			
			color: 0xffffff,
			lineWidth: 0.3,
			widthCallback: null,
			sizeAttenuation: true,

			opacity: 1,
			alphaTest: 0,
			transparent: false,
			wireframe: false,
			
			gradientColor: null,
			map: null,
			mapOffset: null,
			alphaMap: null,
			vertexColors: null,
			
			dashCount: null,
			dashRatio: null,
			dashOffset: 0,

			// Legacy/custom-hook DPR uniform. CSS-pixel width uses CSS-sized resolution,
			// so visible size is stable while the canvas still uses more device pixels.
			dpr: getDefaultDPR(),

			frustumCulled: true,

			// Debugging
			verbose: false,

			renderWidth: getDefaultWidth(),
			renderHeight: getDefaultHeight(),

			// GPU procedural positions (TSL node). If provided, positions will be calculated in shader.
			gpuPositionNode: null,
			usage: null,

			// Instancing options
			instanceCount: -1,

			shadow: false,

			// Opt-in CPU subdivision for sharp corners. Disabled by default so dynamic
			// updates and custom per-vertex attributes preserve a stable topology.
			smoothSharpBends: false,
		}
		this._built = false
		this.onBeforeRender = this._onBeforeRender
		this.configure( options ?? {} )
	}

	/**
	 * Apply multiple options at once. Every key in `options` delegates to the
	 * corresponding chainable setter method.
	 * @param {import('./index.d.ts').MeshLineConfigureOptions} options
	 * @returns {this}
	 */
	configure( options = {} ) {
		options = options ?? {}
		if ( options.segments !== undefined ) this.segments( options.segments )
		if ( options.lines !== undefined || options.closed !== undefined ) {
			const lines = options.lines ?? this._options.lines
			const closed = options.closed ?? this._options.closed
			this.lines( lines, closed )
		}
		if ( options.vertexColors !== undefined ) this.vertexColors( options.vertexColors )
		if ( options.color !== undefined ) this.color( options.color )
		if ( options.lineWidth !== undefined ) this.lineWidth( options.lineWidth )
		if ( options.widthCallback !== undefined ) this.widthCallback( options.widthCallback )
		if ( options.sizeAttenuation !== undefined ) this.sizeAttenuation( options.sizeAttenuation )
		if ( options.gradientColor !== undefined ) this.gradientColor( options.gradientColor )
		if ( options.map !== undefined ) this.map( options.map )
		if ( options.mapOffset !== undefined ) this.mapOffset( options.mapOffset )
		if ( options.alphaMap !== undefined ) this.alphaMap( options.alphaMap )
		if ( options.opacity !== undefined ) this.opacity( options.opacity )
		if ( options.alphaTest !== undefined ) this.alphaTest( options.alphaTest )
		if ( options.transparent !== undefined ) this.transparent( options.transparent )
		if ( options.wireframe !== undefined ) this.wireframe( options.wireframe )
		if ( options.shadow !== undefined ) this.shadow( options.shadow )
		if ( options.dpr !== undefined ) this.dpr( options.dpr )
		if ( options.frustumCulled !== undefined ) this.setFrustumCulled( options.frustumCulled )
		if ( options.verbose !== undefined ) this.verbose( options.verbose )
		if ( options.renderWidth !== undefined || options.renderHeight !== undefined ) this.renderSize( options.renderWidth, options.renderHeight )
		if ( options.dash || options.dashCount !== undefined || options.dashRatio !== undefined || options.dashOffset !== undefined ) {
			this.dash( options.dash ?? {
				count: options.dashCount ?? this._options.dashCount,
				ratio: options.dashRatio ?? this._options.dashRatio ?? 0.5,
				offset: options.dashOffset ?? this._options.dashOffset,
			} )
		}
		if ( options.join ) this.join( options.join )
		if ( options.smoothSharpBends !== undefined ) this.smoothSharpBends( options.smoothSharpBends )
		if ( options.smoothSharpBendsAlpha !== undefined ) this.smoothSharpBendsAlpha( options.smoothSharpBendsAlpha )
		if ( options.smoothSharpBendsThreshold !== undefined ) this.smoothSharpBendsThreshold( options.smoothSharpBendsThreshold )
		if ( options.dynamic !== undefined ) this.dynamic( options.dynamic )
		if ( options.autoResize ) this.autoResize( options.autoResize )
		if ( options.gpuPositionNode !== undefined ) this.gpuPositionNode( options.gpuPositionNode )
		if ( options.usage !== undefined ) this.usage( options.usage )
		if ( options.instanceCount !== undefined ) this.instances( options.instanceCount )
		if ( options.needsUV !== undefined ) this.needsUV( options.needsUV )
		if ( options.needsWidth !== undefined ) this.needsWidth( options.needsWidth )
		if ( options.needsProgress !== undefined ) this.needsProgress( options.needsProgress )
		if ( options.needsPrevious !== undefined ) this.needsPrevious( options.needsPrevious )
		if ( options.needsNext !== undefined ) this.needsNext( options.needsNext )
		if ( options.needsSide !== undefined ) this.needsSide( options.needsSide )
		if ( options.needsVertexColor !== undefined ) this.needsVertexColor( options.needsVertexColor )
		if ( options.positionFn !== undefined ) this.positionFn( options.positionFn )
		if ( options.previousFn !== undefined ) this.previousFn( options.previousFn )
		if ( options.nextFn !== undefined ) this.nextFn( options.nextFn )
		if ( options.widthFn !== undefined ) this.widthFn( options.widthFn )
		if ( options.normalFn !== undefined ) this.normalFn( options.normalFn )
		if ( options.colorFn !== undefined ) this.colorFn( options.colorFn )
		if ( options.gradientFn !== undefined ) this.gradientFn( options.gradientFn )
		if ( options.opacityFn !== undefined ) this.opacityFn( options.opacityFn )
		if ( options.dashFn !== undefined ) this.dashFn( options.dashFn )
		if ( options.uvFn !== undefined ) this.uvFn( options.uvFn )
		if ( options.vertexFn !== undefined ) this.vertexFn( options.vertexFn )
		if ( options.fragmentColorFn !== undefined ) this.fragmentColorFn( options.fragmentColorFn )
		if ( options.fragmentAlphaFn !== undefined ) this.fragmentAlphaFn( options.fragmentAlphaFn )
		if ( options.discardFn !== undefined ) this.discardFn( options.discardFn )
		return this
	}
	/**
	 * Set line point data. Accepts a single polyline or an array of polylines.
	 * If the line is already built, positions are updated in-place when possible.
	 * @param {import('./index.d.ts').MultiLinePoints} lines - Point data
	 * @param {boolean | boolean[]} [closed] - Whether to close each polyline loop
	 * @returns {this}
	 */
	lines( lines, closed = this._options.closed ) {
		const closedChanged = closed !== this._options.closed
		this._options.lines = lines
		this._options.closed = closed
		if ( this._built ) {
			this.geometry.options.closed = closed
			if ( closedChanged ) {
				this.geometry.setLines( lines )
			} else {
				this.geometry.setPositions( lines, false )
			}
		}
		return this
	}

	/**
	 * Set the number of segments for GPU-generated positions.
	 * @param {number} segments
	 * @returns {this}
	 */
	segments( segments ) {
		this._options.segments = segments
		return this
	}

	/**
	 * Set whether the polyline(s) should form a closed loop.
	 * @param {boolean | boolean[]} closed
	 * @returns {this}
	 */
	closed( closed ) {
		this._options.closed = closed
		return this
	}

	/**
	 * Set the line base color.
	 * @param {number | string | import('three/webgpu').Color} color
	 * @returns {this}
	 */
	color( color ) {
		this._options.color = color
		if ( this.material.color?.value?.set ) {
			this.material.color.value.set( color )
		}
		return this
	}

	/**
	 * Set the line width. Units depend on `sizeAttenuation`:
	 * scene-space projected units when `true`, CSS pixels when `false`.
	 * Can be updated after build.
	 * @param {number} lineWidth
	 * @returns {this}
	 */
	lineWidth( lineWidth ) {
		this._options.lineWidth = lineWidth
		if ( this.material.lineWidth ) {
			this.material.lineWidth.value = lineWidth
		}
		return this
	}

	/**
	 * Set a CPU-side callback that maps progress `t ∈ [0,1]` to a width multiplier.
	 * Baked into the geometry at build time.
	 * @param {(t: number) => number} widthCallback
	 * @returns {this}
	 */
	widthCallback( widthCallback ) {
		this._options.widthCallback = widthCallback
		return this
	}

	/**
	 * Toggle size attenuation. When `true` (default), line width is in world
	 * units and shrinks with distance. When `false`, width is in CSS pixels.
	 * @param {boolean} sizeAttenuation
	 * @returns {this}
	 */
	sizeAttenuation( sizeAttenuation ) {
		this._options.sizeAttenuation = sizeAttenuation
		return this
	}

	/**
	 * Enable or disable shadow casting for this line.
	 * @param {boolean} enabled
	 * @returns {this}
	 */
	shadow( enabled ) {
		this._options.shadow = enabled
		if ( this._built && this.material ) {
			this.material.setShadow( enabled )
		}
		this.castShadow = !!enabled
		return this
	}

	/**
	 * Set the line opacity. Can be updated after build.
	 * @param {number} opacity - Value between 0 (fully transparent) and 1 (fully opaque)
	 * @returns {this}
	 */
	opacity( opacity ) {
		this._options.opacity = opacity
		const opacityUniform = this.material.opacity
		if ( opacityUniform && typeof opacityUniform === 'object' && 'value' in opacityUniform ) {
			this.material.opacity.value = opacity
		} else if ( this._built && opacity < 1 ) {
			this.rebuild()
		}
		return this
	}

	/**
	 * Set the alpha test threshold. Fragments with alpha below this value are discarded.
	 * @param {number} alphaTest
	 * @returns {this}
	 */
	alphaTest( alphaTest ) {
		this._options.alphaTest = alphaTest
		this.material.alphaTest = alphaTest
		return this
	}

	/**
	 * Enable or disable transparency on the material.
	 * @param {boolean} transparent
	 * @returns {this}
	 */
	transparent( transparent ) {
		this._options.transparent = transparent
		this.material.transparent = transparent
		return this
	}

	/**
	 * Enable or disable wireframe rendering.
	 * @param {boolean} wireframe
	 * @returns {this}
	 */
	wireframe( wireframe ) {
		this._options.wireframe = wireframe
		this.material.wireframe = wireframe
		return this
	}

	/**
	 * Configure miter limit at sharp corners. The `type` field is accepted for
	 * back-compat; only miter joins are implemented — every value behaves as
	 * `'miter'`. `limit` caps the miter extension at sharp bends (default 4).
	 * @param {import('./index.d.ts').MeshLineJoinOptions} [options]
	 * @returns {this}
	 */
	join( { type: _type = 'miter', limit = 4 } = {} ) {
		this._options.miterLimit = limit
		if ( this._built && this.material ) {
			this.material.miterLimit = limit
		}
		return this
	}

	/**
	 * Enable or disable CPU subdivision of polyline corners that are too sharp
	 * for the screen-space miter to render cleanly. Off by default so GPU buffers
	 * match your input point list exactly unless explicitly enabled.
	 * @param {boolean} enabled
	 * @returns {this}
	 */
	smoothSharpBends( enabled ) {
		this._options.smoothSharpBends = enabled
		if ( this._built ) {
			this.geometry.options.smoothSharpBends = enabled
			if ( this._options.lines ) this.geometry.setLines( this._options.lines )
		}
		return this
	}

	/**
	 * Cutoff fraction used by `smoothSharpBends`. Each sharp-corner vertex is
	 * replaced by two points sitting `alpha` of the way back along each adjacent
	 * segment. Smaller values preserve the peak visually (closer to pointy);
	 * larger values flatten it more. Default `0.001` — visually imperceptible
	 * but enough to keep the shader miter math stable.
	 * @param {number} alpha
	 * @returns {this}
	 */
	smoothSharpBendsAlpha( alpha ) {
		this._options.smoothSharpBendsAlpha = alpha
		if ( this._built ) {
			this.geometry.options.smoothSharpBendsAlpha = alpha
			if ( this._options.lines ) this.geometry.setLines( this._options.lines )
		}
		return this
	}

	/**
	 * `dot(dir_in, dir_out)` cutoff below which a vertex is considered sharp
	 * enough to be subdivided by `smoothSharpBends`. Default `-0.5` (≈ 60°
	 * interior bend). Lower (more negative) values subdivide only the very
	 * sharpest corners.
	 * @param {number} threshold
	 * @returns {this}
	 */
	smoothSharpBendsThreshold( threshold ) {
		this._options.smoothSharpBendsThreshold = threshold
		if ( this._built ) {
			this.geometry.options.smoothSharpBendsThreshold = threshold
			if ( this._options.lines ) this.geometry.setLines( this._options.lines )
		}
		return this
	}

	/**
	 * Set a gradient end color. The line will interpolate from `color` to
	 * `gradientColor` along its progress. Pass `null` to disable.
	 * @param {number | string | import('three/webgpu').Color | null} gradientColor
	 * @returns {this}
	 */
	gradientColor( gradientColor ) {
		const hadGradient = !!this.material.gradient
		this._options.gradientColor = gradientColor
		if ( this._built && hadGradient !== ( gradientColor != null ) ) {
			return this.rebuild()
		}
		if ( this.material.gradient ) {
			this.material.gradient.value.set( gradientColor )
		}
		return this
	}

	/**
	 * Set a color texture map. Pass `null` to remove.
	 * @param {import('three/webgpu').Texture | null} map
	 * @returns {this}
	 */
	map( map ) {
		const hadMap = !!this.material.map
		this._options.map = map
		if ( this._built && hadMap !== !!map ) {
			return this.rebuild()
		}
		if ( this.material.map ) {
			this.material.map.value = map
		}
		return this
	}

	/**
	 * Set the UV offset for the color/alpha map.
	 * @param {import('three/webgpu').Vector2 | null} mapOffset
	 * @returns {this}
	 */
	mapOffset( mapOffset ) {
		this._options.mapOffset = mapOffset
		if ( this.material.mapOffset ) {
			if ( mapOffset ) this.material.mapOffset.value.copy( mapOffset )
			else this.material.mapOffset.value.set( 0, 0 )
		}
		return this
	}

	/**
	 * Set an alpha (transparency) texture map. Pass `null` to remove.
	 * @param {import('three/webgpu').Texture | null} alphaMap
	 * @returns {this}
	 */
	alphaMap( alphaMap ) {
		const hadAlphaMap = !!this.material.alphaMap
		this._options.alphaMap = alphaMap
		if ( this._built && hadAlphaMap !== !!alphaMap ) {
			return this.rebuild()
		}
		if ( this.material.alphaMap ) {
			this.material.alphaMap.value = alphaMap
		}
		return this
	}

	/**
	 * Configure dashed line rendering. Can be updated after build.
	 * @param {import('./index.d.ts').MeshLineDashOptions} params
	 * @returns {this}
	 */
	dash( params ) {
		const { count, ratio = 0.5, offset = 0 } = params || {}
		const hadDash = !!this.material.dashCount
		this._options.dashCount = count
		this._options.dashRatio = ratio
		this._options.dashOffset = offset
		if ( this._built && hadDash !== !!count ) {
			return this.rebuild()
		}
		if ( this._built && this.material.dashCount ) {
			this.material.dashCount.value = count
			this.material.dashRatio.value = ratio
			this.material.dashOffset.value = offset
		}
		return this
	}

	/**
	 * Set the legacy/custom-hook device pixel ratio uniform.
	 * @param {number} dpr
	 * @returns {this}
	 */
	dpr( dpr ) {
		this._options.dpr = dpr
		if ( this.material.dpr ) {
			this.material.dpr.value = dpr
		}
		return this
	}

	/**
	 * Toggle dynamic usage. When `true`, geometry buffers use `StreamDrawUsage`
	 * for frequently updated lines. When `false`, uses `StaticDrawUsage`.
	 * @param {boolean} enable
	 * @returns {this}
	 */
	dynamic( enable ) {
		this._options.usage = enable ? StreamDrawUsage : StaticDrawUsage
		if ( this._built && this.geometry?.setUsage ) {
			this.geometry.setUsage( this._options.usage )
		}
		return this
	}

	/**
	 * Enable or disable frustum culling.
	 * @param {boolean} frustumCulled
	 * @returns {this}
	 */
	setFrustumCulled( frustumCulled ) {
		this._options.frustumCulled = frustumCulled
		this.frustumCulled = frustumCulled
		return this
	}

	/**
	 * Enable or disable verbose debug logging.
	 * @param {boolean} verbose
	 * @returns {this}
	 */
	verbose( verbose ) {
		this._options.verbose = verbose
		return this
	}

	/**
	 * Set the render target size (used for resolution uniform).
	 * @param {number} [width]
	 * @param {number} [height]
	 * @returns {this}
	 */
	renderSize( width, height ) {
		this._options.renderWidth = width
		this._options.renderHeight = height
		return this
	}

	/**
	 * Set a TSL node function for GPU-computed positions.
	 * When set, positions are calculated entirely in the shader.
	 * @param {(progress: ShaderNodeObject, extra: ShaderNodeObject) => ShaderNodeObject} gpuPositionNode
	 * @returns {this}
	 */
	gpuPositionNode( gpuPositionNode ) {
		this._options.gpuPositionNode = gpuPositionNode
		return this
	}

	/**
	 * Set the buffer usage hint (e.g. `StaticDrawUsage`, `StreamDrawUsage`).
	 * @param {number} usage - A Three.js usage constant
	 * @returns {this}
	 */
	usage( usage ) {
		this._options.usage = usage
		return this
	}

	/**
	 * Enable instanced rendering with the given number of instances.
	 * Must be called before `build()`.
	 * @param {number} instanceCount
	 * @returns {this}
	 */
	instances( instanceCount ) {
		this._options.instanceCount = instanceCount
		this._warnIfBuilt( 'instance count' )
		return this
	}

	// Optional attribute toggles
	needsUV( needsUV ) {
		this._options.needsUV = needsUV
		this._warnIfBuilt( 'UV needs' )
		return this
	}
	needsWidth( needsWidth ) {
		this._options.needsWidth = needsWidth
		this._warnIfBuilt( 'width needs' )
		return this
	}
	needsProgress( needsProgress ) {
		this._options.needsProgress = needsProgress
		this._warnIfBuilt( 'progress needs' )
		return this
	}
	needsPrevious( needsPrevious ) {
		this._options.needsPrevious = needsPrevious
		this._warnIfBuilt( 'previous needs' )
		return this
	}
	needsNext( needsNext ) {
		this._options.needsNext = needsNext
		this._warnIfBuilt( 'next needs' )
		return this
	}
	needsSide( needsSide ) {
		this._options.needsSide = needsSide
		this._warnIfBuilt( 'side needs' )
		return this
	}
	needsVertexColor( needsVertexColor ) {
		this._options.needsVertexColor = needsVertexColor
		this._warnIfBuilt( 'color needs' )
		return this
	}

	/**
	 * Set a TSL hook that modifies the current, previous, and next positions.
	 * @param {(position: ShaderNodeObject, progress: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	positionFn( fn ) {
		this._options.positionFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies only the previous neighbour position.
	 * @param {(position: ShaderNodeObject, progress: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	previousFn( fn ) {
		this._options.previousFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies only the next neighbour position.
	 * @param {(position: ShaderNodeObject, progress: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	nextFn( fn ) {
		this._options.nextFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the line width on the GPU.
	 * @param {(width: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	widthFn( fn ) {
		this._options.widthFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the line normal direction.
	 * @param {(normal: ShaderNodeObject, dir: ShaderNodeObject, dir1: ShaderNodeObject, dir2: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	normalFn( fn ) {
		this._options.normalFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the vertex color (vec4) in the vertex shader.
	 * @param {(color: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	colorFn( fn ) {
		this._options.colorFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the gradient interpolation factor.
	 * @param {(factor: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	gradientFn( fn ) {
		this._options.gradientFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the fragment opacity.
	 * @param {(alpha: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	opacityFn( fn ) {
		this._options.opacityFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the dash cycle position.
	 * @param {(cyclePosition: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	dashFn( fn ) {
		this._options.dashFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the UV coordinates.
	 * @param {(uv: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	uvFn( fn ) {
		this._options.uvFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the final clip-space vertex position.
	 * @param {(position: ShaderNodeObject, normal: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	vertexFn( fn ) {
		this._options.vertexFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the fragment color after gradient and texture sampling.
	 * @param {(color: ShaderNodeObject, uv: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	fragmentColorFn( fn ) {
		this._options.fragmentColorFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that modifies the fragment alpha after opacity and dash processing.
	 * @param {(alpha: ShaderNodeObject, uv: ShaderNodeObject, progress: ShaderNodeObject, side: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	fragmentAlphaFn( fn ) {
		this._options.fragmentAlphaFn = fn
		this._built = false
		return this
	}

	/**
	 * Set a TSL hook that controls fragment discard.
	 * Return a boolean node — `true` discards the fragment.
	 * @param {(progress: ShaderNodeObject, side: ShaderNodeObject, uv: ShaderNodeObject) => ShaderNodeObject} fn
	 * @returns {this}
	 */
	discardFn( fn ) {
		this._options.discardFn = fn
		this._built = false
		return this
	}

	/**
	 * Set per-vertex RGB colors as a flat array (r, g, b, r, g, b, ...).
	 * @param {Float32Array | number[]} colors
	 * @returns {this}
	 */
	vertexColors( colors ) {
		this._options.vertexColors = colors
		return this
	}

	/**
	 * Build (or rebuild) the geometry and material from the current options.
	 * Automatically called on first render via `ensureBuilt()`.
	 * @returns {this}
	 */
	build() {
		const options = this._options

		let lines = options.lines ?? ( options.segments ? straightLine( 1, options.segments ) : defaultPositions )

		options.lines = lines

		// Computed needs - auto-detect from configuration
		const buildOptions = {
			...options,
			needsWidth: !!( options.needsWidth || options.widthCallback ),
			needsProgress: options.needsProgress ?? true,
			needsSide: options.needsSide ?? true,
			needsUV: !!( options.needsUV || options.map || options.alphaMap || options.uvFn || options.fragmentColorFn || options.fragmentAlphaFn || options.discardFn ),
			needsVertexColor: !!( options.needsVertexColor || options.vertexColors ),
			needsPrevious: options.needsPrevious ?? !options.gpuPositionNode,
			needsNext: options.needsNext ?? !options.gpuPositionNode,
		}

		this.geometry.buildLine( buildOptions )
		this.material.buildLine( buildOptions )

		// Apply shadow if enabled
		if ( options.shadow ) {
			this.material.setShadow( true )
			this.castShadow = true
		}

		if ( buildOptions.instanceCount != -1 ) {
			this.count = buildOptions.instanceCount
		}

		this.frustumCulled = buildOptions.frustumCulled

		if ( options.opacity !== undefined ) {
			if ( options.opacity.isNode ) {
				this.uOpacity = options.opacity
			} else if ( typeof options.opacity === 'number' ) {
				this.uOpacity = uniform( options.opacity )
			}
		} else {
			this.uOpacity = uniform( 1 )
		}

		this.resize( buildOptions.renderWidth, buildOptions.renderHeight )

		this._built = true

		return this
	}

	_onBeforeRender() {
		this.ensureBuilt()
	}

	/**
	 * Fast in-place position update without rebuilding geometry buffers.
	 * Falls back to a full rebuild if the point count changes.
	 * @param {import('./index.d.ts').MultiLinePoints} positions
	 * @param {boolean} [updateBounding=false]
	 */
	setPositions( positions, updateBounding = false ) {
		this.ensureBuilt()
		this.geometry.setPositions( positions, updateBounding )
	}

	/**
	 * Add a custom per-vertex buffer attribute to the geometry.
	 * @param {string} name - Attribute name (used in TSL via `attribute( name, type )`)
	 * @param {number} [components=1] - Number of components per vertex (1–4)
	 * @returns {import('three/webgpu').BufferAttribute}
	 */
	addVertexAttribute( name, components = 1 ) {
		this.ensureBuilt()
		const totalVertices = this.geometry.getAttribute( 'position' ).count
		const array = new Float32Array( totalVertices * components )
		this.geometry.setOrUpdateAttribute( name, array, components )
		return this.geometry.getAttribute( name )
	}

	/**
	 * Add a custom per-instance buffer attribute. Requires `instances()` to be set.
	 * @param {string} name - Attribute name (used in TSL via `attribute( name, type )`)
	 * @param {number} [components=1] - Number of components per instance (1–4)
	 * @returns {import('three/webgpu').InstancedBufferAttribute}
	 */
	addInstanceAttribute( name, components = 1 ) {
		this.ensureBuilt()
		const array = new Float32Array( this.count * components )
		const attribute = new InstancedBufferAttribute( array, components )
		this.geometry.setAttribute( name, attribute )
		return attribute
	}

	/**
	 * Set the value of a per-instance attribute for a specific instance.
	 * @param {string} name - Attribute name previously created with `addInstanceAttribute()`
	 * @param {number} index - Instance index
	 * @param {number | number[] | {x: number, y: number, z?: number, w?: number}} value
	 */
	setInstanceValue( name, index, value ) {
		const attribute = this.geometry.getAttribute( name )
		if ( ! attribute ) {
			console.warn( `MeshLine: Attribute ${name} not found. Make sure to add it first using addInstanceAttribute().` )
			return
		} 

		// Validate index bounds
		if ( index < 0 || index >= this.count ) {
			console.warn( `MeshLine: Instance index ${index} out of bounds [0, ${this.count})` )
			return
		}

		const offset = index * attribute.itemSize
		const array = attribute.array

		// Handle different value types efficiently without creating arrays
		if ( typeof value === 'number' ) {
			// Single number - set first component only
			array[ offset ] = value
		} else if ( Array.isArray( value ) ) {
			// Array - copy values up to itemSize
			const len = Math.min( attribute.itemSize, value.length )
			for ( let j = 0; j < len; j++ ) {
				array[ offset + j ] = value[ j ]
			}
		} else if ( value && typeof value === 'object' ) {
			// Object with x, y, z properties (Vector3-like)
			if ( 'x' in value ) array[ offset ] = value.x
			if ( 'y' in value && attribute.itemSize > 1 ) array[ offset + 1 ] = value.y
			if ( 'z' in value && attribute.itemSize > 2 ) array[ offset + 2 ] = value.z
			if ( 'w' in value && attribute.itemSize > 3 ) array[ offset + 3 ] = value.w
		}
		
		attribute.needsUpdate = true
	}

	/**
	 * Update the resolution uniform (usually called on window resize).
	 * @param {number} [width]
	 * @param {number} [height]
	 */
	resize( width = getDefaultWidth(), height = getDefaultHeight() ) {
		if ( this.material && this.material.resolution ) {
			this.material.resolution.value.set( width, height )
		}
	}

	/**
	 * Automatically update the resolution uniform on window resize.
	 * @param {import('./index.d.ts').MeshLineResizeTarget} [target=window]
	 * @returns {this}
	 */
	autoResize( target = isBrowser ? window : null ) {
		if ( !target ) {
			console.warn( 'MeshLine: autoResize requires a valid target in SSR/Node environments' )
			return this
		}
		if ( this._autoResizeHandler ) {
			this._autoResizeTarget?.removeEventListener( 'resize', this._autoResizeHandler )
			this._autoResizeHandler = null
		}
		this._autoResizeHandler = () => {
			this.resize( target.innerWidth, target.innerHeight )
		}
		target.addEventListener( 'resize', this._autoResizeHandler )
		this._autoResizeTarget = target
		return this
	}

	_warnIfBuilt = ( feature ) => {
		if ( this._built ) console.warn( `MeshLine: Changing ${feature} after build is not supported yet.` )
	}

	/**
	 * Build the line if it hasn't been built yet.
	 * Called automatically before the first render.
	 * @returns {this}
	 */
	ensureBuilt() {
		if ( !this._built ) this.build()
		return this
	}

	rebuild() {
		this._built = false
		return this.build()
	}

	/**
	 * Raycast against the line segments. Integrates with Three.js's standard
	 * `raycaster.intersectObject()` API.
	 *
	 * For standard (non-instanced) lines, iterates through `geometry._lines`.
	 * For instanced lines with `instanceStart`/`instanceEnd` attributes,
	 * tests each instance as a single segment.
	 *
	 * Uses `raycaster.params.Line.threshold` for proximity detection.
	 * Set `raycaster.params.Line.firstHitOnly = true` (or `raycaster.firstHitOnly = true`)
	 * to keep only the nearest hit.
	 *
	 * @param {import('three/webgpu').Raycaster} raycaster
	 * @param {Array} intersects - Array to push intersection results into
	 */
	raycast( raycaster, intersects ) {

		this.ensureBuilt()

		const geometry = this.geometry
		const matrixWorld = this.matrixWorld
		const lineParams = raycaster.params.Line || {}
		const threshold = lineParams.threshold ?? 1
		const firstHitOnly = lineParams.firstHitOnly === true || raycaster.firstHitOnly === true

		// Detect instancing from attributes rather than Mesh.count
		// (Three.js r183+ manages Mesh.count internally and may override it)
		const startAttr = geometry.getAttribute( 'instanceStart' )
		const endAttr = geometry.getAttribute( 'instanceEnd' )
		const isInstanced = !!( startAttr && endAttr && startAttr.isInstancedBufferAttribute )
		const hasLines = !!( geometry._lines && geometry._lines.length > 0 )

		if ( !isInstanced ) {
			if ( !hasLines ) return
			if ( this._options.gpuPositionNode ) {
				if ( !this._warnedGpuRaycast ) {
					console.info( 'MeshLine.raycast: GPU-positioned lines are not raycastable — use MeshLinePicker.' )
					this._warnedGpuRaycast = true
				}
				return
			}

			if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere()
			if ( geometry.boundingSphere !== null && geometry.boundingSphere.radius > 0 ) {
				_sphere.copy( geometry.boundingSphere )
				_sphere.applyMatrix4( matrixWorld )
				_sphere.radius += threshold
				if ( raycaster.ray.intersectsSphere( _sphere ) === false ) return
			}
		}

		// Convert ray to local space
		_inverseMatrix.copy( matrixWorld ).invert()
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix )

		// Scale threshold by object scale
		const averageScale = ( this.scale.x + this.scale.y + this.scale.z ) / 3 || 1
		const localThreshold = threshold / averageScale
		const localThresholdSq = localThreshold * localThreshold
		const near = raycaster.near
		const far = raycaster.far
		const nearSq = near * near
		const farSq = Number.isFinite( far ) ? far * far : Infinity
		const rayOrigin = raycaster.ray.origin
		let closestHit = null
		let closestDistance = Infinity

		const commitHit = ( index, lineIndex, instanceId ) => {
			_interRay.applyMatrix4( matrixWorld )
			const distanceSq = rayOrigin.distanceToSquared( _interRay )

			if ( distanceSq < nearSq || distanceSq > farSq ) return

			const distance = Math.sqrt( distanceSq )
			const hit = {
				distance,
				point: _interSegment.clone().applyMatrix4( matrixWorld ),
				index,
				face: null,
				faceIndex: null,
				object: this,
			}

			if ( lineIndex !== undefined ) hit.lineIndex = lineIndex
			if ( instanceId !== undefined ) hit.instanceId = instanceId

			if ( firstHitOnly ) {
				if ( distance >= closestDistance ) return
				closestDistance = distance
				closestHit = hit
				return
			}

			intersects.push( hit )
		}

		if ( isInstanced ) {

			// Instanced lines with instanceStart/instanceEnd
			const instanceCount = startAttr.count
			for ( let i = 0; i < instanceCount; i++ ) {

				_vStart.fromBufferAttribute( startAttr, i )
				_vEnd.fromBufferAttribute( endAttr, i )

				const distSq = _ray.distanceSqToSegment( _vStart, _vEnd, _interRay, _interSegment )

				if ( distSq > localThresholdSq ) continue

				commitHit( 0, undefined, i )
			}

		} else {

			// Standard lines from geometry._lines
			for ( let lineIdx = 0; lineIdx < geometry._lines.length; lineIdx++ ) {

				const line = geometry._lines[lineIdx]
				const numPoints = line.length / 3

				for ( let i = 0; i < numPoints - 1; i++ ) {

					const o1 = i * 3
					const o2 = ( i + 1 ) * 3

					_vStart.set( line[o1], line[o1 + 1], line[o1 + 2] )
					_vEnd.set( line[o2], line[o2 + 1], line[o2 + 2] )

					const distSq = _ray.distanceSqToSegment( _vStart, _vEnd, _interRay, _interSegment )

					if ( distSq > localThresholdSq ) continue

					commitHit( i, lineIdx )
				}
			}
		}

		if ( firstHitOnly && closestHit ) {
			intersects.push( closestHit )
		}
	}

	/**
	 * Dispose the geometry, material, and all associated resources.
	 * Also removes the mesh from its parent and cleans up event listeners.
	 */
	dispose = () => {
		this.parent?.remove( this )
		this.geometry?.dispose()
		this.material?.dispose()
		if ( this._autoResizeHandler && this._autoResizeTarget ) {
			this._autoResizeTarget.removeEventListener( 'resize', this._autoResizeHandler )
			this._autoResizeHandler = null
			this._autoResizeTarget = null
		}
		if ( this.instanceMatrix ) this.instanceMatrix.dispose()
		if ( this.instanceColor ) this.instanceColor.dispose()
		this._built = false
	}
}
