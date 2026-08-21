import {
	BufferAttribute,
	InstancedBufferAttribute,
	InstancedInterleavedBuffer,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	Matrix4,
	Mesh,
	Ray,
	Sphere,
	StaticDrawUsage,
	StreamDrawUsage,
	Vector3,
} from 'three/webgpu'

import MeshLineGeometry from "./MeshLineGeometry.js"
import MeshLineNodeMaterial from "./MeshLineNodeMaterial.js"
import MeshLineSurfaceGeometry from './MeshLineSurfaceGeometry.js'
import MeshLineSurfaceNodeMaterial from './MeshLineSurfaceNodeMaterial.js'
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
const MANAGED_BILLBOARD_ATTRIBUTES = new Set( [
	'position',
	'previous',
	'next',
	'side',
	'joinRole',
	'width',
	'uv',
	'progress',
	'endpoint',
	'vertexColor',
] )
const PORTABLE_VERTEX_BUFFER_LIMIT = 8

function isInstancedAttribute( attribute ) {
	return !!(
		attribute?.isInstancedBufferAttribute ||
		attribute?.data?.isInstancedInterleavedBuffer
	)
}

function getAttributeBuffer( attribute ) {
	return attribute?.isInterleavedBufferAttribute ? attribute.data : attribute
}

function getAttributeStorage( attribute ) {
	if ( attribute.isInterleavedBufferAttribute ) {
		return {
			array: attribute.data.array,
			buffer: attribute.data,
			offset: attribute.offset,
			stride: attribute.data.stride,
		}
	}
	return {
		array: attribute.array,
		buffer: attribute,
		offset: 0,
		stride: attribute.itemSize,
	}
}

function validateCustomAttributeLayout( layout ) {
	if ( !layout || typeof layout !== 'object' || Array.isArray( layout ) ) {
		throw new TypeError( 'MeshLine: packed attribute layout must be an object of name/component pairs' )
	}

	const entries = Object.entries( layout )
	if ( entries.length === 0 ) {
		throw new Error( 'MeshLine: packed attribute layout requires at least one attribute' )
	}

	let stride = 0
	for ( const [name, components] of entries ) {
		if ( !name ) throw new Error( 'MeshLine: custom attribute names cannot be empty' )
		validateAttributeComponents( components )
		stride += components
	}
	return { entries, stride }
}

function validateAttributeComponents( components ) {
	if ( !Number.isInteger( components ) || components < 1 || components > 4 ) {
		throw new RangeError( 'MeshLine: custom attribute components must be an integer from 1 to 4' )
	}
}

function writeAttributeValues( attribute, values, startElement ) {
	const { array, buffer, offset, stride } = getAttributeStorage( attribute )
	const valueCount = values?.length ?? 0
	const elementCount = valueCount === 0 ? 0 : Math.ceil( valueCount / attribute.itemSize )
	if ( valueCount % attribute.itemSize !== 0 ) {
		throw new Error( `MeshLine: ${attribute.name || 'attribute'} values must contain complete ${attribute.itemSize}-component elements` )
	}
	if ( startElement + elementCount > attribute.count ) return null

	if ( attribute.isInterleavedBufferAttribute ) {
		for ( let element = 0; element < elementCount; element++ ) {
			const sourceOffset = element * attribute.itemSize
			const targetOffset = ( startElement + element ) * stride + offset
			for ( let component = 0; component < attribute.itemSize; component++ ) {
				array[targetOffset + component] = values[sourceOffset + component]
			}
		}
	} else if ( valueCount > 0 ) {
		array.set( values, startElement * attribute.itemSize )
	}

	const updateStart = startElement * stride + offset
	const updateCount = elementCount === 0
		? 0
		: ( elementCount - 1 ) * stride + attribute.itemSize
	return { buffer, updateCount, updateStart }
}

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
			surface: false,
			join: { type: 'miter', limit: 4, segments: 8, inner: 'exact' },
			cap: { type: 'butt', segments: 8 },
			
			color: 0xffffff,
			lineWidth: 0.3,
			widthCallback: null,
			sizeAttenuation: true,
			antialias: false,

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
		this._frustumCulledExplicit = false
		this._renderedInstanceAttributes = new WeakSet()
		this._pendingInstanceAttributes = new Set()
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
		if ( options.surface !== undefined ) this.surface( options.surface )
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
		if ( options.antialias !== undefined ) this.antialias( options.antialias )
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
		if ( options.cap !== undefined ) this.cap( options.cap )
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
	 * Select the camera-independent world-space surface profile used for roads,
	 * tracks, and ribbons. Pass `false` to return to the billboard profile.
	 * @param {boolean | import('./index.d.ts').MeshLineSurfaceOptions} [options]
	 * @returns {this}
	 */
	surface( options = {} ) {
		this._options.surface = options === false || options == null
			? false
			: { ...( options === true ? {} : options ) }
		if ( this._built ) this.rebuild()
		return this
	}

	/**
	 * Set the number of segments for GPU-generated positions.
	 * @param {number} segments
	 * @returns {this}
	 */
	segments( segments ) {
		if ( !Number.isInteger( segments ) || segments < 1 ) {
			throw new Error( 'MeshLine: segments must be a positive integer' )
		}
		this._options.segments = segments
		return this
	}

	/**
	 * Set whether the polyline(s) should form a closed loop.
	 * @param {boolean | boolean[]} closed
	 * @returns {this}
	 */
	closed( closed ) {
		if ( this._built && this._options.lines ) return this.lines( this._options.lines, closed )
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
		if ( this.material.isMeshLineSurfaceNodeMaterial ) {
			this.material.color.set( color )
		} else if ( this.material.color?.value?.set ) {
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
		if ( !Number.isFinite( lineWidth ) || !Number.isFinite( Math.fround( lineWidth ) ) || lineWidth < 0 ) {
			throw new Error( 'MeshLine: lineWidth must be a finite, non-negative number' )
		}
		this._options.lineWidth = lineWidth
		if ( this._built && this.geometry.isMeshLineSurfaceGeometry ) {
			this.geometry.buildLine( this._getBuildOptions() )
		} else if ( this.material.lineWidth ) {
			this.material.lineWidth.value = lineWidth
			if ( this.geometry.options ) {
				this.geometry.options.lineWidth = lineWidth
				this.geometry.computeBoundingBoxes()
				this.geometry.computeBoundingSphere()
			}
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
		if ( widthCallback != null && typeof widthCallback !== 'function' ) {
			throw new Error( 'MeshLine: widthCallback must be a function or null' )
		}
		const hadWidthCallback = !!this._options.widthCallback
		this._options.widthCallback = widthCallback
		if ( this._built && this.geometry.isMeshLineSurfaceGeometry ) {
			this.geometry.buildLine( this._getBuildOptions() )
		} else if ( this._built && hadWidthCallback !== !!widthCallback ) {
			this.rebuild()
		} else if ( this._built ) {
			this.geometry.buildLine( { widthCallback } )
		}
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
		this._syncAutomaticFrustumCulling()
		if ( this._built && this.material.isMeshLineNodeMaterial ) {
			this.material.sizeAttenuation = sizeAttenuation
			this.material.needsUpdate = true
			this.geometry.options.sizeAttenuation = sizeAttenuation
			this.geometry.computeBoundingBoxes()
			this.geometry.computeBoundingSphere()
		}
		return this
	}

	/**
	 * Toggle analytic edge antialiasing. Off by default: MSAA already smooths the
	 * billboard silhouette, because the silhouette *is* the emitted geometry.
	 *
	 * Turning it on pads the stroke outward by half a device pixel and fades that
	 * padding by real edge coverage, which also keeps sub-pixel lines from
	 * dropping out. Coverage is written into alpha, so this forces
	 * `transparent = true` — expect the usual transparent-draw sort order.
	 * @param {boolean} [antialias=true]
	 * @returns {this}
	 */
	antialias( antialias = true ) {
		this._options.antialias = !!antialias
		if ( this._built && this.material.isMeshLineNodeMaterial ) {
			this.material.buildLine( this._getBuildOptions() )
		}
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
		if ( !Number.isFinite( opacity ) || !Number.isFinite( Math.fround( opacity ) ) || opacity < 0 || opacity > 1 ) {
			throw new Error( 'MeshLine: opacity must be a Float32-representable number within [0, 1]' )
		}
		this._options.opacity = opacity
		if ( this.material.isMeshLineSurfaceNodeMaterial ) {
			const previousTransparent = this.material.transparent
			const previousDepthWrite = this.material.depthWrite
			this.material.opacity = opacity
			this.material.transparent = this._options.transparent || opacity < 1 || this.material.alphaMap != null
			this.material.depthWrite = this._options.depthWrite ?? !this.material.transparent
			if ( previousTransparent !== this.material.transparent || previousDepthWrite !== this.material.depthWrite ) {
				this.material.needsUpdate = true
			}
			return this
		}
		const opacityUniform = this.material.opacity
		if ( opacityUniform && typeof opacityUniform === 'object' && 'value' in opacityUniform ) {
			this.material.opacity.value = opacity
		} else if ( this._built && opacity < 1 ) {
			return this.rebuild()
		}

		const previousTransparent = this.material.transparent
		const previousDepthWrite = this.material.depthWrite
		this.material.transparent = this._resolvesToTransparent( { opacity } )
		this.material.depthWrite = this._options.depthWrite ?? !this.material.transparent
		if ( previousTransparent !== this.material.transparent || previousDepthWrite !== this.material.depthWrite ) {
			this.material.needsUpdate = true
		}
		return this
	}

	/**
	 * Set the alpha test threshold. Fragments with alpha below this value are discarded.
	 * @param {number} alphaTest
	 * @returns {this}
	 */
	alphaTest( alphaTest ) {
		if ( !Number.isFinite( alphaTest ) || alphaTest < 0 || alphaTest > 1 ) {
			throw new Error( 'MeshLine: alphaTest must be within [0, 1]' )
		}
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
		const resolvedTransparent = this._resolvesToTransparent( { transparent } )
		const previousTransparent = this.material.transparent
		const previousDepthWrite = this.material.depthWrite
		this.material.transparent = resolvedTransparent
		this.material.depthWrite = this._options.depthWrite ?? !resolvedTransparent
		if ( previousTransparent !== resolvedTransparent || previousDepthWrite !== this.material.depthWrite ) {
			this.material.needsUpdate = true
		}
		return this
	}

	/**
	 * Enable or disable wireframe rendering.
	 * @param {boolean} wireframe
	 * @returns {this}
	 */
	wireframe( wireframe ) {
		this._options.wireframe = wireframe
		const changed = this.material.wireframe !== wireframe
		this.material.wireframe = wireframe
		if ( changed ) this.material.needsUpdate = true
		return this
	}

	/**
	 * Configure the join policy at sharp corners. The regular billboard profile
	 * keeps its bounded fixed-strip miter; world surfaces and the optional GPU
	 * path emit true bevel/round topology. `simple` aliases `miter`.
	 * @param {import('./index.d.ts').MeshLineJoinOptions} [options]
	 * @returns {this}
	 */
	join( { type = 'miter', limit = 4, segments = 8, inner = 'exact' } = {} ) {
		const normalizedType = type === 'simple' ? 'miter' : type
		if ( !['miter', 'bevel', 'round'].includes( normalizedType ) ) {
			throw new Error( `MeshLine: unsupported join type: ${type}` )
		}
		if ( !Number.isFinite( limit ) || limit < 1 ) {
			throw new Error( 'MeshLine: join.limit must be finite and at least 1' )
		}
		if ( !Number.isInteger( segments ) || segments < 1 ) {
			throw new Error( 'MeshLine: join.segments must be a positive integer' )
		}
		if ( inner !== 'exact' && inner !== 'clip' ) {
			throw new Error( `MeshLine: unsupported inner join policy: ${inner}` )
		}
		const joinTypeChanged = this._options.join?.type !== normalizedType
		this._options.join = { type: normalizedType, limit, segments, inner }
		this._options.miterLimit = limit
		if ( this._built && this.geometry.isMeshLineSurfaceGeometry ) {
			this.geometry.buildLine( this._getBuildOptions() )
		} else if ( this._built && joinTypeChanged && this.geometry.isMeshLine ) {
			// Billboard bevel fill is index topology, so the type has to reach the
			// geometry builder rather than only the material's miter limit.
			this.geometry.buildLine( this._getBuildOptions() )
			if ( this.material ) this.material.miterLimit = limit
		} else if ( this._built && this.material ) {
			this.material.miterLimit = limit
			this.geometry.options.miterLimit = this.material.miterLimit
			this.geometry.computeBoundingBoxes()
			this.geometry.computeBoundingSphere()
		}
		return this
	}

	/**
	 * Configure open-path end caps. Surface geometry and the optional GPU path
	 * emit true square/round topology; the fixed billboard profile remains butt.
	 * @param {'butt' | 'square' | 'round' | import('./index.d.ts').MeshLineCapOptions} [options]
	 * @returns {this}
	 */
	cap( options = {} ) {
		if ( options == null ) options = {}
		if ( typeof options === 'string' ) options = { type: options }
		const { type = 'butt', segments = 8 } = options
		if ( !['butt', 'square', 'round'].includes( type ) ) {
			throw new Error( `MeshLine: unsupported cap type: ${type}` )
		}
		if ( !Number.isInteger( segments ) || segments < 1 ) {
			throw new Error( 'MeshLine: cap.segments must be a positive integer' )
		}
		if ( type === 'round' && segments < 2 ) {
			throw new Error( 'MeshLine: round caps require cap.segments of at least 2' )
		}
		this._options.cap = { type, segments }
		if ( this._built && this.geometry.isMeshLineSurfaceGeometry ) {
			this.geometry.buildLine( this._getBuildOptions() )
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
		if ( !Number.isFinite( alpha ) || alpha < 0 || alpha > 0.5 ) {
			throw new Error( 'MeshLine: smoothSharpBendsAlpha must be within [0, 0.5]' )
		}
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
		if ( !Number.isFinite( threshold ) || threshold < -1 || threshold > 1 ) {
			throw new Error( 'MeshLine: smoothSharpBendsThreshold must be within [-1, 1]' )
		}
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
		if ( this.material.isMeshLineSurfaceNodeMaterial ) {
			this._options.map = map
			const topologyChanged = !!this.material.map !== !!map
			this.material.map = map
			if ( topologyChanged ) {
				this.geometry.buildLine( this._getBuildOptions() )
				this.material.needsUpdate = true
			}
			return this
		}
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
		if ( this.material.isMeshLineSurfaceNodeMaterial ) {
			this._options.alphaMap = alphaMap
			const previousTransparent = this.material.transparent
			const previousDepthWrite = this.material.depthWrite
			const topologyChanged = !!this.material.alphaMap !== !!alphaMap
			this.material.alphaMap = alphaMap
			this.material.transparent = this._options.transparent || this._options.opacity < 1 || alphaMap != null
			this.material.depthWrite = this._options.depthWrite ?? !this.material.transparent
			if (
				topologyChanged ||
				previousTransparent !== this.material.transparent ||
				previousDepthWrite !== this.material.depthWrite
			) this.material.needsUpdate = true
			if ( topologyChanged ) this.geometry.buildLine( this._getBuildOptions() )
			return this
		}
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
		if ( count != null && ( !Number.isFinite( count ) || !Number.isFinite( Math.fround( count ) ) || count < 0 ) ) {
			throw new Error( 'MeshLine: dash.count must be a Float32-representable non-negative number or null' )
		}
		if ( !Number.isFinite( ratio ) || ratio < 0 || ratio > 1 ) {
			throw new Error( 'MeshLine: dash.ratio must be within [0, 1]' )
		}
		if ( !Number.isFinite( offset ) || !Number.isFinite( Math.fround( offset ) ) ) {
			throw new Error( 'MeshLine: dash.offset must be Float32-representable' )
		}
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
		if ( !Number.isFinite( dpr ) || dpr <= 0 ) throw new Error( 'MeshLine: dpr must be greater than zero' )
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
		if ( this._built && this.geometry.setUsage ) this.geometry.setUsage( this._options.usage )
		return this
	}

	/**
	 * Enable or disable frustum culling.
	 * @param {boolean} frustumCulled
	 * @returns {this}
	 */
	setFrustumCulled( frustumCulled ) {
		this._options.frustumCulled = frustumCulled
		this._frustumCulledExplicit = true
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
		if ( width !== undefined ) {
			if ( !Number.isFinite( width ) || width <= 0 ) throw new Error( 'MeshLine: render width must be greater than zero' )
			this._options.renderWidth = width
		}
		if ( height !== undefined ) {
			if ( !Number.isFinite( height ) || height <= 0 ) throw new Error( 'MeshLine: render height must be greater than zero' )
			this._options.renderHeight = height
		}
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
		this._syncAutomaticFrustumCulling()
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
		this._syncAutomaticFrustumCulling()
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
		this._syncAutomaticFrustumCulling()
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
		this._syncAutomaticFrustumCulling()
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
		this._syncAutomaticFrustumCulling()
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
		this._syncAutomaticFrustumCulling()
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
		this._syncAutomaticFrustumCulling()
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
		const surfaceProfile = options.surface !== false

		if ( surfaceProfile && options.gpuPositionNode ) {
			throw new Error( 'MeshLine: surface mode requires CPU centerline points; gpuPositionNode is only supported by billboard lines' )
		}
		if ( surfaceProfile && options.instanceCount !== -1 ) {
			throw new Error( 'MeshLine: surface mode does not support facade instancing yet' )
		}

		this._ensureGeometryProfile( surfaceProfile )

		let lines = options.lines ?? ( options.segments ? straightLine( 1, options.segments ) : defaultPositions )

		options.lines = lines

		const buildOptions = this._getBuildOptions()

		this.geometry.buildLine( buildOptions )
		this.validateVertexBufferBudget()
		this.material.buildLine( buildOptions )

		// Apply shadow if enabled
		if ( options.shadow ) {
			this.material.setShadow( true )
			this.castShadow = true
		}

		if ( !surfaceProfile && buildOptions.instanceCount != -1 ) {
			this.count = buildOptions.instanceCount
		}

		this.frustumCulled = buildOptions.frustumCulled

		this.resize( buildOptions.renderWidth, buildOptions.renderHeight )

		this._built = true

		return this
	}

	_getBuildOptions() {
		const options = this._options
		const needsProgress = !!(
			options.needsProgress ||
			options.gpuPositionNode ||
			options.widthCallback ||
			options.gradientColor != null ||
			options.dashCount ||
			options.positionFn ||
			options.previousFn ||
			options.nextFn ||
			options.widthFn ||
			options.normalFn ||
			options.colorFn ||
			options.gradientFn ||
			options.opacityFn ||
			options.dashFn ||
			options.uvFn ||
			options.vertexFn ||
			options.fragmentColorFn ||
			options.fragmentAlphaFn ||
			options.discardFn
		)
		return {
			...options,
			needsWidth: !!( options.needsWidth || options.widthCallback ),
			needsProgress,
			needsSide: options.needsSide ?? false,
			needsUV: !!( options.needsUV || options.map || options.alphaMap || options.uvFn || options.fragmentColorFn || options.fragmentAlphaFn || options.discardFn ),
			needsVertexColor: !!( options.needsVertexColor || options.vertexColors ),
			needsPrevious: options.needsPrevious ?? !options.gpuPositionNode,
			needsNext: options.needsNext ?? !options.gpuPositionNode,
			needsEndpointMetadata: !!(
				options.gpuPositionNode ||
				options.positionFn ||
				options.previousFn ||
				options.nextFn
			),
		}
	}

	_ensureGeometryProfile( surfaceProfile ) {
		const geometryMatches = surfaceProfile
			? this.geometry?.isMeshLineSurfaceGeometry
			: this.geometry?.isMeshLine
		const materialMatches = surfaceProfile
			? this.material?.isMeshLineSurfaceNodeMaterial
			: this.material?.isMeshLineNodeMaterial

		if ( !geometryMatches ) {
			const previous = this.geometry
			this.geometry = surfaceProfile ? new MeshLineSurfaceGeometry() : new MeshLineGeometry()
			previous?.dispose()
		}
		if ( !materialMatches ) {
			const previous = this.material
			this.material = surfaceProfile ? new MeshLineSurfaceNodeMaterial() : new MeshLineNodeMaterial()
			previous?.dispose()
		}
	}

	_onBeforeRender() {
		this.ensureBuilt()
		if ( this._pendingInstanceAttributes.size === 0 ) return
		for ( const attribute of this._pendingInstanceAttributes ) this._renderedInstanceAttributes.add( attribute )
		this._pendingInstanceAttributes.clear()
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
		this._options.lines = positions
	}

	/**
	 * Update a fixed-size range of CPU billboard points and upload only the
	 * affected position/neighbor components. Surface transport frames and
	 * smoothed screen topology require a full `setPositions()` update instead.
	 * @param {ArrayLike<number> | Array<import('three').Vector2 | import('three').Vector3 | number[]>} positions
	 * @param {number} startPoint
	 * @param {{lineIndex?: number, updateBounding?: boolean}} [options]
	 * @returns {this}
	 */
	setPositionRange( positions, startPoint, options ) {
		this.ensureBuilt()
		if ( !this.geometry.isMeshLine || typeof this.geometry.setPositionRange !== 'function' ) {
			throw new Error( 'MeshLine: setPositionRange() is only available for CPU billboard lines; use setPositions() for surfaces' )
		}
		this.geometry.setPositionRange( positions, startPoint, options )
		this._syncLineOptionsFromGeometry()
		return this
	}

	/**
	 * Add a custom per-vertex buffer attribute to the geometry.
	 * @param {string} name - Attribute name (used in TSL via `attribute( name, type )`)
	 * @param {number} [components=1] - Number of components per vertex (1–4)
	 * @returns {import('three/webgpu').BufferAttribute}
	 */
	addVertexAttribute( name, components = 1 ) {
		this.ensureBuilt()
		validateAttributeComponents( components )
		if ( this.geometry.isMeshLine && MANAGED_BILLBOARD_ATTRIBUTES.has( name ) ) {
			throw new Error( `MeshLine: ${name} is a reserved billboard vertex attribute` )
		}
		const positionAttribute = this.geometry.getAttribute( 'position' )
		if ( !positionAttribute ) {
			throw new Error( 'MeshLine: addVertexAttribute() requires at least two distinct points' )
		}
		this._validateProjectedVertexBufferBudget( [name], 1 )
		const totalVertices = positionAttribute.count
		const array = new Float32Array( totalVertices * components )
		const attribute = new BufferAttribute( array, components )
		attribute.name = name
		attribute.setUsage( this._options.usage ?? StaticDrawUsage )
		this.geometry.setAttribute( name, attribute )
		if ( this.geometry._attrs?.[name] ) delete this.geometry._attrs[name]
		return attribute
	}

	/**
	 * Add multiple custom per-vertex attributes in one shared GPU buffer.
	 * @param {Record<string, number>} layout - Attribute names mapped to component counts (1–4)
	 * @returns {Record<string, import('three/webgpu').InterleavedBufferAttribute>}
	 */
	addVertexAttributes( layout ) {
		this.ensureBuilt()
		const { entries, stride } = validateCustomAttributeLayout( layout )
		for ( const [name] of entries ) {
			if ( this.geometry.isMeshLine && MANAGED_BILLBOARD_ATTRIBUTES.has( name ) ) {
				throw new Error( `MeshLine: ${name} is a reserved billboard vertex attribute` )
			}
		}
		const positionAttribute = this.geometry.getAttribute( 'position' )
		if ( !positionAttribute ) {
			throw new Error( 'MeshLine: addVertexAttributes() requires at least two distinct points' )
		}
		this._validateProjectedVertexBufferBudget( entries.map( ( [name] ) => name ), 1 )

		const data = new InterleavedBuffer( new Float32Array( positionAttribute.count * stride ), stride )
		data.setUsage( this._options.usage ?? StaticDrawUsage )
		return this._installPackedAttributes( data, entries )
	}

	/**
	 * Upload a flat block of values to a vertex attribute.
	 * @param {string} name
	 * @param {ArrayLike<number>} values
	 * @param {number} [startVertex=0]
	 * @returns {this}
	 */
	setVertexValues( name, values, startVertex = 0 ) {
		this.ensureBuilt()
		const attribute = this.geometry.getAttribute( name )
		if ( !attribute || isInstancedAttribute( attribute ) ) {
			throw new Error( `MeshLine: Vertex attribute ${name} not found` )
		}
		if ( !Number.isInteger( startVertex ) || startVertex < 0 ) {
			throw new Error( 'MeshLine: startVertex must be a non-negative integer' )
		}

		const update = writeAttributeValues( attribute, values, startVertex )
		if ( !update ) {
			throw new Error( `MeshLine: Vertex values exceed ${name} capacity` )
		}

		update.buffer.clearUpdateRanges()
		if ( update.updateCount > 0 ) update.buffer.addUpdateRange( update.updateStart, update.updateCount )
		update.buffer.needsUpdate = true
		return this
	}

	/**
	 * Add a custom per-instance buffer attribute. Requires `instances()` to be set.
	 * @param {string} name - Attribute name (used in TSL via `attribute( name, type )`)
	 * @param {number} [components=1] - Number of components per instance (1–4)
	 * @returns {import('three/webgpu').InstancedBufferAttribute}
	 */
	addInstanceAttribute( name, components = 1 ) {
		this.ensureBuilt()
		validateAttributeComponents( components )
		if ( this.geometry.isMeshLine && MANAGED_BILLBOARD_ATTRIBUTES.has( name ) ) {
			throw new Error( `MeshLine: ${name} is a reserved billboard vertex attribute` )
		}
		this._validateProjectedVertexBufferBudget( [name], 1 )
		const array = new Float32Array( this.count * components )
		const attribute = new InstancedBufferAttribute( array, components )
		attribute.name = name
		attribute.setUsage( this._options.usage ?? StaticDrawUsage )
		this.geometry.setAttribute( name, attribute )
		this._pendingInstanceAttributes.add( attribute )
		return attribute
	}

	/**
	 * Add multiple custom per-instance attributes in one shared GPU buffer.
	 * @param {Record<string, number>} layout - Attribute names mapped to component counts (1–4)
	 * @returns {Record<string, import('three/webgpu').InterleavedBufferAttribute>}
	 */
	addInstanceAttributes( layout ) {
		this.ensureBuilt()
		const { entries, stride } = validateCustomAttributeLayout( layout )
		for ( const [name] of entries ) {
			if ( this.geometry.isMeshLine && MANAGED_BILLBOARD_ATTRIBUTES.has( name ) ) {
				throw new Error( `MeshLine: ${name} is a reserved billboard vertex attribute` )
			}
		}
		this._validateProjectedVertexBufferBudget( entries.map( ( [name] ) => name ), 1 )

		const data = new InstancedInterleavedBuffer( new Float32Array( this.count * stride ), stride )
		data.setUsage( this._options.usage ?? StaticDrawUsage )
		const attributes = this._installPackedAttributes( data, entries )
		for ( const attribute of Object.values( attributes ) ) this._pendingInstanceAttributes.add( attribute )
		return attributes
	}

	_installPackedAttributes( data, entries ) {
		const attributes = {}
		let offset = 0
		for ( const [name, components] of entries ) {
			const attribute = new InterleavedBufferAttribute( data, components, offset )
			attribute.name = name
			this.geometry.setAttribute( name, attribute )
			if ( this.geometry._attrs?.[name] ) delete this.geometry._attrs[name]
			attributes[name] = attribute
			offset += components
		}
		return attributes
	}

	/**
	 * Set the value of a per-instance attribute for a specific instance.
	 * @param {string} name - Attribute name previously created with `addInstanceAttribute()`
	 * @param {number} index - Instance index
	 * @param {number | number[] | {x: number, y: number, z?: number, w?: number}} value
	 */
	setInstanceValue( name, index, value ) {
		const attribute = this.geometry.getAttribute( name )
		if ( !isInstancedAttribute( attribute ) ) {
			console.warn( `MeshLine: Attribute ${name} not found. Make sure to add it first using addInstanceAttribute().` )
			return
		} 

		// Validate index bounds
		if ( index < 0 || index >= this.count ) {
			console.warn( `MeshLine: Instance index ${index} out of bounds [0, ${this.count})` )
			return
		}

		const storage = getAttributeStorage( attribute )
		const offset = index * storage.stride + storage.offset
		const array = storage.array

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
		
		this._markInstanceAttributeUpdate( attribute, offset, attribute.itemSize )
	}

	/**
	 * Upload a flat block of values to an instance attribute with one version
	 * change instead of calling `setInstanceValue()` for every instance.
	 * @param {string} name
	 * @param {ArrayLike<number>} values
	 * @param {number} [startInstance=0]
	 * @returns {this}
	 */
	setInstanceValues( name, values, startInstance = 0 ) {
		const attribute = this.geometry.getAttribute( name )
		if ( !isInstancedAttribute( attribute ) ) {
			throw new Error( `MeshLine: Instance attribute ${name} not found` )
		}
		if ( !Number.isInteger( startInstance ) || startInstance < 0 ) {
			throw new Error( 'MeshLine: startInstance must be a non-negative integer' )
		}
		const update = writeAttributeValues( attribute, values, startInstance )
		if ( !update ) {
			throw new Error( `MeshLine: Instance values exceed ${name} capacity` )
		}

		this._markInstanceAttributeUpdate( attribute, update.updateStart, update.updateCount )
		return this
	}

	_markInstanceAttributeUpdate( attribute, start, count ) {
		// Before the line's first draw, new attributes upload their current CPU
		// arrays directly. Avoid a redundant version change during that setup.
		if ( !this._renderedInstanceAttributes.has( attribute ) || count === 0 ) return

		const buffer = getAttributeBuffer( attribute )
		const ranges = buffer.updateRanges
		const hadPendingRange = ranges.length > 0
		const last = ranges[ranges.length - 1]
		if ( last && start <= last.start + last.count && start + count >= last.start ) {
			const end = Math.max( last.start + last.count, start + count )
			last.start = Math.min( last.start, start )
			last.count = end - last.start
		} else if ( ranges.length < 16 ) {
			buffer.addUpdateRange( start, count )
		} else {
			// Too many small writes cost more queue submissions than one upload.
			buffer.clearUpdateRanges()
			buffer.addUpdateRange( 0, buffer.array.length )
		}
		if ( !hadPendingRange ) buffer.needsUpdate = true
	}

	/**
	 * Inspect the portable vertex-buffer footprint of the current geometry.
	 * Interleaved attributes that share storage count as one GPU buffer.
	 * Use `reservedBuffers` for additional node-backed/application streams.
	 * @param {{limit?: number, reservedBuffers?: number}} [options]
	 * @returns {import('./index.d.ts').MeshLineVertexBufferUsage}
	 */
	getVertexBufferUsage( options = {} ) {
		return this._collectVertexBufferUsage( options )
	}

	/**
	 * Throw an actionable error when the current geometry exceeds the portable
	 * WebGPU minimum of eight vertex buffers. This can count geometry streams
	 * directly; pass `reservedBuffers` for additional node-backed streams.
	 * @param {{limit?: number, reservedBuffers?: number}} [options]
	 * @returns {import('./index.d.ts').MeshLineVertexBufferUsage}
	 */
	validateVertexBufferBudget( options = {} ) {
		const usage = this._collectVertexBufferUsage( options )
		if ( usage.exceeded ) this._throwVertexBufferBudgetError( usage )
		return usage
	}

	_validateProjectedVertexBufferBudget( replacedNames, additionalBuffers ) {
		const usage = this._collectVertexBufferUsage( {
			additionalBuffers,
			excludedNames: new Set( replacedNames ),
		} )
		if ( usage.exceeded ) this._throwVertexBufferBudgetError( usage )
	}

	_collectVertexBufferUsage( options = {} ) {
		const limit = options.limit ?? PORTABLE_VERTEX_BUFFER_LIMIT
		if ( !Number.isInteger( limit ) || limit < 1 ) {
			throw new RangeError( 'MeshLine: vertex-buffer limit must be a positive integer' )
		}
		const reservedBuffers = options.reservedBuffers ?? 0
		if ( !Number.isInteger( reservedBuffers ) || reservedBuffers < 0 ) {
			throw new RangeError( 'MeshLine: reserved vertex-buffer count must be a non-negative integer' )
		}
		const excludedNames = options.excludedNames ?? null
		const groups = new Map()
		for ( const [name, attribute] of Object.entries( this.geometry?.attributes ?? {} ) ) {
			if ( excludedNames?.has( name ) ) continue
			const buffer = getAttributeBuffer( attribute )
			let group = groups.get( buffer )
			if ( !group ) {
				group = {
					attributes: [],
					instanced: isInstancedAttribute( attribute ),
					interleaved: !!attribute.isInterleavedBufferAttribute,
				}
				groups.set( buffer, group )
			}
			group.attributes.push( name )
			group.instanced ||= isInstancedAttribute( attribute )
		}

		const attributeBuffers = groups.size + ( options.additionalBuffers ?? 0 )
		const usedBuffers = attributeBuffers + reservedBuffers
		return {
			attributeBuffers,
			buffers: Array.from( groups.values(), ( group ) => ( {
				...group,
				attributes: group.attributes.sort(),
			} ) ),
			exceeded: usedBuffers > limit,
			limit,
			remaining: limit - usedBuffers,
			reservedBuffers,
			usedBuffers,
		}
	}

	_throwVertexBufferBudgetError( usage ) {
		const reserved = usage.reservedBuffers > 0
			? ` + ${usage.reservedBuffers} renderer-reserved instancing buffer${usage.reservedBuffers === 1 ? '' : 's'}`
			: ''
		throw new Error(
			`MeshLine: portable vertex-buffer budget exceeded (${usage.usedBuffers}/${usage.limit}: ${usage.attributeBuffers} geometry buffers${reserved}). ` +
			'Pack related custom attributes with addVertexAttributes()/addInstanceAttributes(), disable unused optional attributes, or use the low-level geometry API on a known higher-limit adapter.',
		)
	}

	/**
	 * Update the resolution uniform (usually called on window resize).
	 * @param {number} [width]
	 * @param {number} [height]
	 */
	resize( width = getDefaultWidth(), height = getDefaultHeight() ) {
		const safeWidth = Number.isFinite( width ) ? Math.max( 1, width ) : 1
		const safeHeight = Number.isFinite( height ) ? Math.max( 1, height ) : 1
		this._options.renderWidth = safeWidth
		this._options.renderHeight = safeHeight
		if ( this.material && this.material.resolution ) {
			this.material.resolution.value.set( safeWidth, safeHeight )
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
	 * Whether the billboard material must blend. Every alpha-producing feature has
	 * to be listed here: three drops the blend state entirely for an opaque
	 * NormalBlending material, so a feature missing from this predicate is
	 * silently switched off rather than merely mis-sorted.
	 */
	_resolvesToTransparent( { opacity = this._options.opacity, transparent = this._options.transparent } = {} ) {
		return !!(
			transparent ||
			opacity < 1 ||
			this._options.alphaMap != null ||
			this._options.antialias
		)
	}

	_syncAutomaticFrustumCulling() {
		if ( this._frustumCulledExplicit ) return
		const hasUnboundedVertexDeformation = !!(
			this._options.gpuPositionNode ||
			this._options.positionFn ||
			this._options.previousFn ||
			this._options.nextFn ||
			this._options.widthFn ||
			this._options.normalFn ||
			this._options.vertexFn
		)
		const frustumCulled = this._options.sizeAttenuation !== false && !hasUnboundedVertexDeformation
		this._options.frustumCulled = frustumCulled
		this.frustumCulled = frustumCulled
	}

	_syncLineOptionsFromGeometry() {
		const lines = this.geometry?._lines
		if ( !Array.isArray( lines ) || lines.length === 0 ) return
		this._options.lines = lines.length === 1 ? lines[0] : lines.slice()
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
		if ( this.geometry.isMeshLineSurfaceGeometry ) {
			Mesh.prototype.raycast.call( this, raycaster, intersects )
			return
		}

		const geometry = this.geometry
		const matrixWorld = this.matrixWorld
		const lineParams = raycaster.params.Line || {}
		const threshold = lineParams.threshold ?? 1
		const firstHitOnly = lineParams.firstHitOnly === true || raycaster.firstHitOnly === true

		// Detect instancing from attributes rather than Mesh.count
		// (Three.js r183+ manages Mesh.count internally and may override it)
		const startAttr = geometry.getAttribute( 'instanceStart' )
		const endAttr = geometry.getAttribute( 'instanceEnd' )
		const isInstanced = !!( startAttr && endAttr && isInstancedAttribute( startAttr ) )
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
			if ( firstHitOnly && distance >= closestDistance ) return
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
