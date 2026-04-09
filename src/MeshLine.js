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

	constructor() {

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

			// device pixel ratio scaling for screen-space width
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
		}
		this._built = false
		this.onBeforeRender = this._onBeforeRender
	}

	/**
	 * Apply multiple options at once. Every key in `options` delegates to the
	 * corresponding chainable setter method.
	 * @param {import('./index.d.ts').MeshLineConfigureOptions} options
	 * @returns {this}
	 */
	configure( options = {} ) {
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
		if ( options.dash ) this.dash( options.dash )
		if ( options.join ) this.join( options.join )
		if ( options.dynamic !== undefined ) this.dynamic( options.dynamic )
		if ( options.autoResize ) this.autoResize( options.autoResize )
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
		this._options.lines = lines
		this._options.closed = closed
		if ( this._built ) {
			this.geometry.setPositions( lines, false )
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
		return this
	}

	/**
	 * Set the line width. Units depend on `sizeAttenuation`:
	 * world units when `true`, screen pixels when `false`.
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
	 * units and shrinks with distance. When `false`, width is in screen pixels.
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
		if ( this.material.opacity ) {
			if ( this.uOpacity && typeof opacity === 'number' ) {
				this.uOpacity.value = opacity
			}
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
	 * Configure miter join behaviour at sharp corners.
	 * @param {import('./index.d.ts').MeshLineJoinOptions} [options]
	 * @returns {this}
	 */
	join( { type = 'miter', limit = 4 } = {} ) {
		const useMiter = type === 'miter'
		this._options.useMiterLimit = useMiter
		this._options.miterLimit = limit
		if ( this._built && this.material ) {
			const needsShaderRebuild = this.material.useMiterLimit !== useMiter || ( useMiter && !this.material.miterLimit )
			this.material.useMiterLimit = useMiter
			if ( useMiter ) {
				if ( this.material.miterLimit ) {
					this.material.miterLimit.value = limit
				} else {
					this.material.miterLimit = uniform( limit )
				}
			}
			if ( needsShaderRebuild ) this.material.needsUpdate = true
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
		this._options.gradientColor = gradientColor
		if ( this.material.gradient ) {
			this.material.gradient.value = gradientColor
		}
		return this
	}

	/**
	 * Set a color texture map. Pass `null` to remove.
	 * @param {import('three/webgpu').Texture | null} map
	 * @returns {this}
	 */
	map( map ) {
		this._options.map = map
		if ( this.material.map ) {
			this.material.map.value = map
		}
		return this
	}

	/**
	 * Set the UV offset for the color/alpha map.
	 * @param {import('three/webgpu').Vector2} mapOffset
	 * @returns {this}
	 */
	mapOffset( mapOffset ) {
		this._options.mapOffset = mapOffset
		if ( this.material.mapOffset ) {
			this.material.mapOffset.value.copy( mapOffset )
		}
		return this
	}

	/**
	 * Set an alpha (transparency) texture map. Pass `null` to remove.
	 * @param {import('three/webgpu').Texture | null} alphaMap
	 * @returns {this}
	 */
	alphaMap( alphaMap ) {
		this._options.alphaMap = alphaMap
		if ( this.material.alphaMap ) {
			this.material.alphaMap = alphaMap
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
		this._options.dashCount = count
		this._options.dashRatio = ratio
		this._options.dashOffset = offset
		if ( this._built && this.material.dashCount ) {
			this.material.dashCount.value = count
			this.material.dashRatio.value = ratio
			this.material.dashOffset.value = offset
		}
		return this
	}

	/**
	 * Set the device pixel ratio used for screen-space width calculation.
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
		options.needsWidth = options.needsWidth ?? !!( options.widthCallback || options.widthFn )
		options.needsProgress = options.needsProgress ?? true
		options.needsSide = options.needsSide ?? true
		options.needsUV = options.needsUV ?? !!( options.map || options.alphaMap || options.uvFn || options.discardFn )
		options.needsVertexColor = options.needsVertexColor ?? !!options.vertexColors

		// If using GPU position node, we don't need previous/next positions
		options.needsPrevious = options.needsPrevious ?? !options.gpuPositionNode
		options.needsNext = options.needsNext ?? !options.gpuPositionNode

		this.geometry.buildLine( options )
		this.material.buildLine( options )

		// Apply shadow if enabled
		if ( options.shadow ) {
			this.material.setShadow( true )
			this.castShadow = true
		}

		if ( options.instanceCount != -1 ) {
			this.count = options.instanceCount
		}

		this.frustumCulled = options.frustumCulled

		if ( options.opacity ) {
			if ( options.opacity.isNode ) {
				this.uOpacity = options.opacity
			} else if ( typeof options.opacity === 'number' ) {
				this.uOpacity = uniform( options.opacity )
			}
		} else {
			this.uOpacity = uniform( 1 )
		}

		this.resize( options.renderWidth, options.renderHeight )

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
	 */
	setPositions( positions ) {
		this.ensureBuilt()
		this.geometry.setPositions( positions )
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
			if ( !hasLines || this._options.gpuPositionNode ) return

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
