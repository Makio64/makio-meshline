import {
	Box3,
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
	StorageBufferAttribute,
	StreamDrawUsage,
	Vector3,
} from 'three/webgpu'

import MeshLineGeometry from "./MeshLineGeometry.js"
import MeshLineNodeMaterial from "./MeshLineNodeMaterial.js"
import { storagePositions } from './positions/storagePositions.js'
import { straightLine } from "./positions/straightLine.js"

// Lazily allocated temporaries for raycast (avoid cold-start allocation on import)
let _inverseMatrix = null
let _ray = null
let _sphere = null
let _box = null
let _vStart = null
let _vEnd = null
let _interRay = null
let _interSegment = null
let _closestPoint = null

function ensureRaycastScratch() {
	if ( _inverseMatrix !== null ) return
	_inverseMatrix = new Matrix4()
	_ray = new Ray()
	_sphere = new Sphere()
	_box = new Box3()
	_vStart = new Vector3()
	_vEnd = new Vector3()
	_interRay = new Vector3()
	_interSegment = new Vector3()
	_closestPoint = new Vector3()
}

// SSR-safe helpers
const isBrowser = typeof window !== 'undefined'
const getDefaultDPR = () => isBrowser ? ( window.devicePixelRatio || 1 ) : 1
const getDefaultWidth = () => isBrowser ? window.innerWidth : 1024
const getDefaultHeight = () => isBrowser ? window.innerHeight : 768

let _defaultPositions = null
const getDefaultPositions = () => ( _defaultPositions ??= straightLine( 2 ) )
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

// Storage-backed positions (`dynamic( 'storage' )`). The points of every line
// live once in a vec4 storage buffer that the vertex shader reads, so moving
// them uploads 16 bytes per point instead of the 144 bytes of the position,
// previous and next attributes. It needs one flat xyz Float32Array per line,
// all of the same length.
function storedShape( lines ) {
	const first = lines instanceof Float32Array ? lines : ( Array.isArray( lines ) ? lines[0] : null )
	if ( !( first instanceof Float32Array ) || first.length < 6 || first.length % 3 !== 0 ) return null
	if ( first === lines ) return { lineCount: 1, pointsPerLine: first.length / 3 }
	for ( const line of lines ) {
		if ( !( line instanceof Float32Array ) || line.length !== first.length ) return null
	}
	return { lineCount: lines.length, pointsPerLine: first.length / 3 }
}

function writeStoredPoints( target, targetPoint, points, pointCount ) {
	for ( let source = 0, offset = targetPoint * 4, end = pointCount * 3; source < end; source += 3, offset += 4 ) {
		target[offset] = points[source]
		target[offset + 1] = points[source + 1]
		target[offset + 2] = points[source + 2]
	}
}

// Flat xyz values of a range edit given as numbers, tuples or vectors.
function flattenPoints( points ) {
	if ( typeof points?.[0] === 'number' ) {
		if ( points.length % 3 !== 0 ) throw new Error( 'MeshLine: setPositionRange() needs complete xyz points' )
		return points
	}
	const flat = new Float32Array( ( points?.length ?? 0 ) * 3 )
	for ( let i = 0; i < flat.length / 3; i++ ) {
		const point = points[i]
		flat[i * 3] = point.x ?? point[0]
		flat[i * 3 + 1] = point.y ?? point[1]
		flat[i * 3 + 2] = point.z ?? point[2] ?? 0
	}
	return flat
}

// Three r186 frees a storage buffer only through the renderer; r187 on dispose().
function releaseStorage( renderer, buffer ) {
	try {
		renderer?._attributes?.delete?.( buffer )
	} catch {
		// Already released, or its device is gone.
	}
	buffer.dispose?.()
}

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

// The surface profile's classes for a facade class, which the billboard-only
// facade does not carry.
function surfaceClasses( facade ) {
	const profile = facade.surfaceProfile
	if ( !profile ) {
		throw new Error( 'MeshLine: MeshLineBillboard has no surface mode; use MeshLine for surface()' )
	}
	return profile
}

/**
 * High-level facade for creating GPU-rendered lines in Three.js.
 * Extends `THREE.Mesh` and provides a fluent/chainable API for configuring
 * geometry, material, hooks, and instancing in a single call chain.
 *
 * This is the screen-space billboard facade on its own. `MeshLine` extends it
 * with the world-space surface profile (`surface()`), whose geometry builders
 * are a large part of the library: an app that only draws billboard lines can
 * import `MeshLineBillboard` instead and leave them out of its bundle.
 *
 * @example
 * const line = new MeshLineBillboard()
 *   .lines( circlePositions( 64 ), true )
 *   .color( 0xff6600 )
 *   .lineWidth( 0.4 )
 *   .build()
 * scene.add( line )
 */
export class MeshLineBillboard extends Mesh {

	/**
	 * Geometry and material classes of the surface profile, set by `MeshLine`.
	 * @type {{ Geometry: Function, Material: Function } | null}
	 */
	static surfaceProfile = null

	constructor( options = {} ) {

		const surfaceProfile = options != null &&
			options.surface !== undefined &&
			options.surface !== false &&
			options.surface !== null
		const surface = surfaceProfile ? surfaceClasses( new.target ) : null

		super(
			surface ? new surface.Geometry() : new MeshLineGeometry(),
			surface ? new surface.Material() : new MeshLineNodeMaterial()
		)

		this.geometry._ownerLine = this

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
			receiveShadow: false,

			// Opt-in CPU subdivision for sharp corners. Disabled by default so dynamic
			// updates and custom per-vertex attributes preserve a stable topology.
			smoothSharpBends: false,
		}
		this._built = false
		this._building = false
		this._frustumCulledExplicit = false
		this._positionStorage = null
		this._storageSupported = false
		this._customAttributes = false
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
		if ( options.lines !== undefined || options.points !== undefined || options.closed !== undefined ) {
			const lines = options.lines ?? options.points ?? this._options.lines
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
		if ( options.receiveShadow !== undefined ) this.setReceiveShadow( options.receiveShadow )
		if ( options.dpr !== undefined ) this.dpr( options.dpr )
		if ( options.frustumCulled !== undefined ) this.setFrustumCulled( options.frustumCulled )
		if ( options.verbose !== undefined ) this.verbose( options.verbose )
		if ( options.renderWidth !== undefined || options.renderHeight !== undefined ) this.renderSize( options.renderWidth, options.renderHeight )
		if ( options.dash !== undefined || options.dashCount !== undefined || options.dashRatio !== undefined || options.dashOffset !== undefined ) {
			if ( options.dash === null || options.dash === false ) {
				this.dash( null )
			} else {
				this.dash( options.dash ?? {
					count: options.dashCount ?? this._options.dashCount,
					ratio: options.dashRatio ?? this._options.dashRatio ?? 0.5,
					offset: options.dashOffset ?? this._options.dashOffset,
				} )
			}
		}
		if ( options.join !== undefined ) this.join( options.join )
		if ( options.miterLimit !== undefined ) this.miterLimit( options.miterLimit )
		if ( options.cap !== undefined ) this.cap( options.cap )
		if ( options.smoothSharpBends !== undefined ) this.smoothSharpBends( options.smoothSharpBends )
		if ( options.smoothSharpBendsAlpha !== undefined ) this.smoothSharpBendsAlpha( options.smoothSharpBendsAlpha )
		if ( options.smoothSharpBendsThreshold !== undefined ) this.smoothSharpBendsThreshold( options.smoothSharpBendsThreshold )
		if ( options.dynamic !== undefined ) this.dynamic( options.dynamic )
		if ( options.autoResize ) this.autoResize( options.autoResize )
		if ( options.gpuPositionNode !== undefined ) this.gpuPositionNode( options.gpuPositionNode )
		if ( options.usage !== undefined ) this.usage( options.usage )
		if ( options.instanceCount !== undefined ) this.instances( options.instanceCount )
		if ( 'needsUV' in options ) this.needsUV( options.needsUV )
		if ( options.needsWidth !== undefined ) this.needsWidth( options.needsWidth )
		if ( 'needsProgress' in options ) this.needsProgress( options.needsProgress )
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
		const prevClosed = this._options.closed
		const closedChanged = Array.isArray( closed ) || Array.isArray( prevClosed )
			? !Array.isArray( closed ) || !Array.isArray( prevClosed ) ||
				closed.length !== prevClosed.length ||
				closed.some( ( value, index ) => Boolean( value ) !== Boolean( prevClosed[index] ) )
			: Boolean( closed ) !== Boolean( prevClosed )
		const nextClosed = Array.isArray( closed ) ? closed.slice() : closed
		if ( this._built && this._storageSupported ) {
			// A stored line's geometry is only a template: its points go to the
			// storage buffer. A loop flag or another shape can move the line
			// between storage and attributes, which takes a whole build.
			if ( this._positionStorage && !closedChanged ) {
				this.setPositions( lines )
				return this
			}
			const previous = { lines: this._options.lines, closed: prevClosed }
			this._options.lines = lines
			this._options.closed = nextClosed
			if ( this._positionStorage || this._couldStorePositions() ) return this._rebuildOrRestore( previous )
			Object.assign( this._options, previous )
		}
		if ( this._built ) {
			if ( closedChanged ) {
				this.geometry.setLines( lines, nextClosed )
			} else {
				this.geometry.setPositions( lines, false )
			}
		}
		// Commit once the geometry accepted the points, as setPositions() does:
		// later rebuilds replay these options.
		this._options.lines = lines
		this._options.closed = nextClosed
		return this
	}

	/**
	 * Alias for {@link MeshLine#lines}. Sets line point data (single polyline or
	 * array of polylines) and optionally closes each loop.
	 * @param {import('./index.d.ts').MultiLinePoints} points - Point data
	 * @param {boolean | boolean[]} [closed] - Whether to close each polyline loop
	 * @returns {this}
	 */
	points( points, closed = this._options.closed ) {
		return this.lines( points, closed )
	}

	/**
	 * Select the camera-independent world-space surface profile used for roads,
	 * tracks, and ribbons. Pass `false` to return to the billboard profile.
	 * @param {boolean | import('./index.d.ts').MeshLineSurfaceOptions} [options]
	 * @returns {this}
	 */
	surface( options = {} ) {
		if ( options !== false && options != null ) surfaceClasses( this.constructor )
		const previous = this._options.surface
		this._options.surface = options === false || options == null
			? false
			: { ...( options === true ? {} : options ) }
		const geometryOptions = this.geometry.options
		const sameProfile = !!this.geometry.isMeshLineSurfaceGeometry === ( this._options.surface !== false )
		// The geometry merges a partial surface into its previous one, but this
		// setter replaces it: keys left out return to their defaults. A copy keeps
		// the accepted options for a rejected rebuild to restore, which a new
		// profile cannot: it replaces the geometry.
		if ( this.geometry.isMeshLineSurfaceGeometry && geometryOptions ) this.geometry.options = { ...geometryOptions, surface: undefined }
		if ( this._built ) return sameProfile ? this._buildOrRestore( { surface: previous }, true, null, geometryOptions ) : this.rebuild()
		this._ensureGeometryProfile( this._options.surface !== false )
		this._syncMaterialTransparency()
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
		const previous = this._options.lineWidth
		this._options.lineWidth = lineWidth
		if ( this._built && this.geometry.isMeshLineSurfaceGeometry ) {
			this._buildOrRestore( { lineWidth: previous }, false )
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
		const previous = this._options.widthCallback
		this._options.widthCallback = widthCallback
		if ( this._built && !!previous !== !!widthCallback && !this.geometry.isMeshLineSurfaceGeometry ) {
			// Toggling the callback adds or drops the billboard width attribute and
			// the material's width path.
			this._buildOrRestore( { widthCallback: previous }, true )
		} else if ( this._built ) {
			// Rebuild only the geometry, from the facade's options like vertexColors()
			// and join().
			this._buildOrRestore( { widthCallback: previous }, false )
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
			// Antialiasing changes transparency and varyings, so the material is
			// rebuilt; carry the live resolution over instead of resetting it.
			const resolution = this.material.resolution?.value.clone()
			this.material.buildLine( { ...this._getBuildOptions(), ...( resolution ? { resolution } : {} ) } )
		} else {
			this._syncMaterialTransparency()
		}
		return this
	}

	/**
	 * Enable or disable shadow casting (and optionally shadow receiving) for this line.
	 * @param {boolean} enabled
	 * @param {boolean} [receiveShadow]
	 * @returns {this}
	 */
	shadow( enabled, receiveShadow ) {
		this._options.shadow = enabled
		if ( this._built && this.material ) {
			this.material.setShadow( enabled )
		}
		this.castShadow = !!enabled
		if ( receiveShadow !== undefined ) {
			this.setReceiveShadow( receiveShadow )
		}
		return this
	}

	/**
	 * Enable or disable shadow receiving for this line.
	 * @param {boolean} enabled
	 * @returns {this}
	 */
	setReceiveShadow( enabled ) {
		const next = !!enabled
		const changed = this.receiveShadow !== next
		this._options.receiveShadow = next
		this.receiveShadow = next
		if ( changed && this._built && this.material ) {
			this.material.needsUpdate = true
		}
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
		const previous = this._options.opacity
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
			return this._buildOrRestore( { opacity: previous }, true )
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
	 * keeps a bounded miter at corners the path really turns and resolves
	 * projected folds per `fold`; its `round` rounds every join with the exact
	 * fragment clip. World surfaces and the optional GPU path emit true
	 * bevel/round topology. `simple` aliases `miter`. On a built line this only
	 * recompiles the material, keeping its uniforms and resolution.
	 * @param {import('./index.d.ts').MeshLineJoinType | import('./index.d.ts').MeshLineJoinOptions} [options]
	 * @returns {this}
	 */
	join( options = {} ) {
		if ( options == null ) options = {}
		if ( typeof options === 'string' ) options = { type: options }
		const { type = 'miter', limit = 4, segments = 8, inner = 'exact', fold = 'geometry' } = options
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
		if ( fold !== 'geometry' && fold !== 'exact' && fold !== false ) {
			throw new Error( `MeshLine: unsupported join.fold policy: ${fold}` )
		}
		const joinTypeChanged = this._options.join?.type !== normalizedType
		const foldChanged = ( this._options.join?.fold ?? 'geometry' ) !== fold
		const previous = { join: this._options.join, miterLimit: this._options.miterLimit }
		this._options.join = { type: normalizedType, limit, segments, inner, fold }
		this._options.miterLimit = limit
		if ( this._built && this.geometry.isMeshLineSurfaceGeometry ) {
			this._buildOrRestore( previous, false )
		} else if ( this._built && ( joinTypeChanged || foldChanged ) && this.geometry.isMeshLine ) {
			// Billboard bevel fill is index topology, so the type has to reach the
			// geometry builder. The material only switches its shader path: a full
			// material rebuild would drop resolution, uniforms and depth state.
			this._buildOrRestore( previous, false )
			if ( this.material?.setJoin ) this.material.setJoin( this._options.join )
			else if ( this.material ) this.material.miterLimit = limit
		} else if ( this._built && this.material ) {
			this.material.miterLimit = limit
			this.geometry.options.miterLimit = this.material.miterLimit
			this.geometry.computeBoundingBoxes()
			this.geometry.computeBoundingSphere()
		}
		return this
	}

	/**
	 * Change only the miter limit, keeping the current join type and options.
	 * @param {number} limit - Finite and at least 1
	 * @returns {this}
	 */
	miterLimit( limit ) {
		// An unset join is the default miter; record it so join() sees no type or
		// fold change and keeps the existing topology and shader.
		this._options.join ??= { type: 'miter', limit: this._options.miterLimit ?? 4, segments: 8, inner: 'exact', fold: 'geometry' }
		return this.join( { ...this._options.join, limit } )
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
		const previous = this._options.cap
		this._options.cap = { type, segments }
		if ( this._built && this.geometry.isMeshLineSurfaceGeometry ) {
			this._buildOrRestore( { cap: previous }, false )
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
		return this._setSmoothing( 'smoothSharpBends', enabled )
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
		return this._setSmoothing( 'smoothSharpBendsAlpha', alpha )
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
		return this._setSmoothing( 'smoothSharpBendsThreshold', threshold )
	}

	/**
	 * Set a gradient end color. The line will interpolate from `color` to
	 * `gradientColor` along its progress. Pass `null` to disable.
	 * @param {number | string | import('three/webgpu').Color | null} gradientColor
	 * @returns {this}
	 */
	gradientColor( gradientColor ) {
		const hadGradient = !!this.material.gradient
		const previous = this._options.gradientColor
		this._options.gradientColor = gradientColor
		if ( this._built && hadGradient !== ( gradientColor != null ) ) {
			return this._buildOrRestore( { gradientColor: previous }, true )
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
		const previous = this._options.map
		if ( this.material.isMeshLineSurfaceNodeMaterial ) {
			this._options.map = map
			const topologyChanged = !!this.material.map !== !!map
			// The geometry gains or drops its UVs first: a rejection keeps the material.
			if ( topologyChanged && this._built ) this._buildOrRestore( { map: previous }, false )
			this.material.map = map
			if ( topologyChanged ) this.material.needsUpdate = true
			return this
		}
		const hadMap = !!this.material.map
		this._options.map = map
		if ( this._built && hadMap !== !!map ) {
			return this._buildOrRestore( { map: previous }, true )
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
		const previous = this._options.alphaMap
		if ( this.material.isMeshLineSurfaceNodeMaterial ) {
			this._options.alphaMap = alphaMap
			const previousTransparent = this.material.transparent
			const previousDepthWrite = this.material.depthWrite
			const topologyChanged = !!this.material.alphaMap !== !!alphaMap
			if ( topologyChanged && this._built ) this._buildOrRestore( { alphaMap: previous }, false )
			this.material.alphaMap = alphaMap
			this.material.transparent = this._options.transparent || this._options.opacity < 1 || alphaMap != null
			this.material.depthWrite = this._options.depthWrite ?? !this.material.transparent
			if (
				topologyChanged ||
				previousTransparent !== this.material.transparent ||
				previousDepthWrite !== this.material.depthWrite
			) this.material.needsUpdate = true
			return this
		}
		const hadAlphaMap = !!this.material.alphaMap
		this._options.alphaMap = alphaMap
		if ( this._built && hadAlphaMap !== !!alphaMap ) {
			return this._buildOrRestore( { alphaMap: previous }, true )
		}
		if ( this.material.alphaMap ) {
			this.material.alphaMap.value = alphaMap
		}
		if ( !this._built ) this._syncMaterialTransparency()
		return this
	}

	/**
	 * Configure dashed line rendering, or pass `null` / `false` to disable dashes.
	 * Can be updated after build.
	 * @param {import('./index.d.ts').MeshLineDashOptions | null | false} [params]
	 * @returns {this}
	 */
	dash( params ) {
		const { count = null, ratio = 0.5, offset = 0 } = ( params && typeof params === 'object' ) ? params : {}
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
		const { dashCount, dashRatio, dashOffset } = this._options
		this._options.dashCount = count
		this._options.dashRatio = ratio
		this._options.dashOffset = offset
		if ( this._built && hadDash !== !!count ) {
			return this._buildOrRestore( { dashCount, dashRatio, dashOffset }, true )
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
	 *
	 * `'storage'` also keeps the points in one GPU storage buffer on WebGPU, so
	 * `setPositions()` uploads 16 bytes per point instead of 144. It applies to
	 * open lines given as `Float32Array`s of equal length that read no progress,
	 * UVs, vertex colors or custom attributes; any other line, and the WebGL2
	 * backend, behave as `dynamic( true )`. See {@link MeshLine#positionStorage}.
	 * @param {boolean | 'storage'} enable
	 * @returns {this}
	 */
	dynamic( enable ) {
		this._options.positionStorage = enable === 'storage'
		this._options.usage = enable ? StreamDrawUsage : StaticDrawUsage
		if ( !this._options.positionStorage ) this._storageSupported = false
		if ( this._built ) {
			// Leaving storage rebuilds now; entering it waits for the renderer
			// that draws the line (see _syncPositionStorage()).
			if ( !this._options.positionStorage && this._positionStorage ) return this.rebuild()
			if ( !this._positionStorage ) {
				// Reshaping updates rebuild from the geometry's own options.
				this.geometry.options.usage = this._options.usage
				this.geometry.setUsage( this._options.usage )
			}
		}
		return this
	}

	/**
	 * The storage buffer holding this line's points while `dynamic( 'storage' )`
	 * is active: one vec4 per point, line after line. `null` on the attribute path.
	 * @type {import('three/webgpu').StorageBufferAttribute | null}
	 */
	get positionStorage() {
		return this._positionStorage?.buffer ?? null
	}

	/**
	 * Enable or disable frustum culling.
	 * @param {boolean} frustumCulled
	 * @returns {this}
	 */
	setFrustumCulled( frustumCulled ) {
		this._options.frustumCulled = frustumCulled
		this._frustumCulledExplicit = true
		this.frustumCulled = frustumCulled && !this._positionStorage
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
		if ( !this._built && instanceCount !== -1 ) this.count = instanceCount
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
	 * Set per-point RGB colors as a flat array (r, g, b, r, g, b, ...). A
	 * multi-line batch reads a concatenated array from each line's global point
	 * start; an array shorter than the batch is a pattern shared by every line.
	 * On a built line a new array refreshes the colors in place, while turning
	 * colors on or off (`null`) rebuilds so the material gains or drops its
	 * vertex-color path. Surface lines have no vertex colors; they keep the array
	 * for a later billboard build.
	 * @param {Float32Array | number[] | null} colors
	 * @returns {this}
	 */
	vertexColors( colors ) {
		const previous = this._options.vertexColors
		this._options.vertexColors = colors
		if ( !this._built || !this.geometry.isMeshLine ) return this
		// A toggle rebuilds the material too.
		const toggled = !!this.material.options?.needsVertexColor !== this._getBuildOptions().needsVertexColor
		return this._buildOrRestore( { vertexColors: previous }, toggled )
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

		this._building = true
		try {
			this._ensureGeometryProfile( surfaceProfile )

			const lines = options.lines ?? ( options.segments ? straightLine( 1, options.segments ) : getDefaultPositions() )

			options.lines = lines

			const buildOptions = this._getBuildOptions()
			const stored = surfaceProfile ? this._releasePositionStorage() : this._preparePositionStorage( buildOptions )
			if ( stored ) {
				// The geometry is a template of one line; the shader reads each point
				// of each line from the storage buffer.
				Object.assign( buildOptions, {
					lines: stored.template,
					closed: false,
					segments: stored.pointsPerLine - 1,
					gpuPositionNode: stored.node,
					instanceCount: stored.lineCount,
					needsPrevious: false,
					needsNext: false,
					needsEndpointMetadata: true,
					needsProgress: true,
					usage: StaticDrawUsage,
					frustumCulled: false,
				} )
			}

			this.geometry.buildLine( buildOptions )
			this.validateVertexBufferBudget()
			this.material.buildLine( buildOptions )

			// Apply shadow if enabled
			if ( options.shadow ) {
				this.material.setShadow( true )
				this.castShadow = true
			}
			if ( options.receiveShadow || this.receiveShadow ) {
				this.receiveShadow = true
				this._options.receiveShadow = true
			}

			if ( !surfaceProfile && buildOptions.instanceCount != -1 ) {
				this.count = buildOptions.instanceCount
			} else if ( this._countFromStorage ) {
				this.count = 1
			}
			this._countFromStorage = !!stored

			this.frustumCulled = buildOptions.frustumCulled

			this.resize( buildOptions.renderWidth, buildOptions.renderHeight )

			this._built = true

			return this
		} finally {
			this._building = false
		}
	}

	_getBuildOptions() {
		const options = this._options
		const needsProgress = options.needsProgress !== undefined
			? !!(
				options.needsProgress ||
				options.gpuPositionNode ||
				options.widthCallback ||
				options.gradientColor != null ||
				options.dashCount
			)
			: !!(
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
		const needsUV = options.needsUV !== undefined
			? !!( options.needsUV || options.map || options.alphaMap || options.uvFn )
			: !!( options.map || options.alphaMap || options.uvFn || options.fragmentColorFn || options.fragmentAlphaFn || options.discardFn )
		return {
			...options,
			needsWidth: !!( options.needsWidth || options.widthCallback ),
			needsProgress,
			needsSide: options.needsSide ?? false,
			needsUV,
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
			if ( previous ) previous._ownerLine = null
			this.geometry = surfaceProfile ? new ( surfaceClasses( this.constructor ).Geometry )() : new MeshLineGeometry()
			this.geometry._ownerLine = this
			previous?.dispose()
		}
		if ( !materialMatches ) {
			const previous = this.material
			this.material = surfaceProfile ? new ( surfaceClasses( this.constructor ).Material )() : new MeshLineNodeMaterial()
			if ( !this._built ) {
				this.material.wireframe = this._options.wireframe
				this.material.alphaTest = this._options.alphaTest
				this._syncMaterialTransparency()
			}
			previous?.dispose()
		}
	}

	// Storage buffers need the WebGPU backend, which only a renderer can tell.
	_syncPositionStorage( renderer ) {
		const supported = this._options.positionStorage === true && renderer?.backend?.isWebGPUBackend === true
		if ( supported === this._storageSupported ) return
		this._storageSupported = supported
		if ( this._built ) this.rebuild()
	}

	// Whether these options can draw from a storage buffer (see storedShape()).
	_canStorePositions( buildOptions ) {
		const options = this._options
		const closed = Array.isArray( options.closed ) ? options.closed.some( Boolean ) : !!options.closed
		return !(
			closed ||
			options.gpuPositionNode ||
			options.instanceCount !== -1 ||
			options.smoothSharpBends ||
			this._customAttributes ||
			buildOptions.needsProgress ||
			buildOptions.needsUV ||
			buildOptions.needsWidth ||
			buildOptions.needsVertexColor ||
			buildOptions.needsSide
		)
	}

	// The storage holding the current points, created or refilled, or null when
	// this line draws from attributes.
	_preparePositionStorage( buildOptions ) {
		const wanted = this._options.positionStorage === true && this._storageSupported
		const shape = wanted && this._canStorePositions( buildOptions ) ? storedShape( this._options.lines ) : null
		if ( !shape ) return this._releasePositionStorage()

		let stored = this._positionStorage
		if ( !stored || stored.lineCount !== shape.lineCount || stored.pointsPerLine !== shape.pointsPerLine ) {
			this._releasePositionStorage()
			const buffer = new StorageBufferAttribute( shape.lineCount * shape.pointsPerLine, 4 )
			stored = this._positionStorage = {
				...shape,
				buffer,
				node: storagePositions( buffer, { pointsPerLine: shape.pointsPerLine, snap: true } ),
				template: straightLine( 1, shape.pointsPerLine - 1 ),
			}
		}
		this._writePositionStorage( this._options.lines )
		return stored
	}

	_releasePositionStorage() {
		if ( this._positionStorage ) releaseStorage( this.geometry?._renderer, this._positionStorage.buffer )
		this._positionStorage = null
		return null
	}

	_writePositionStorage( lines ) {
		const { buffer, lineCount, pointsPerLine } = this._positionStorage
		if ( lineCount === 1 && lines instanceof Float32Array ) {
			writeStoredPoints( buffer.array, 0, lines, pointsPerLine )
		} else {
			for ( let i = 0; i < lineCount; i++ ) writeStoredPoints( buffer.array, i * pointsPerLine, lines[i], pointsPerLine )
		}
		buffer.clearUpdateRanges()
		buffer.needsUpdate = true
	}

	// Options as built: a storage-backed line draws through a generated position
	// node and one instance per line, which proxies of this line have to match.
	_effectiveOptions() {
		const stored = this._positionStorage
		if ( !stored ) return this._options
		return {
			...this._options,
			closed: false,
			segments: stored.pointsPerLine - 1,
			gpuPositionNode: stored.node,
			instanceCount: stored.lineCount,
		}
	}

	// Whether the current options and points would draw from a storage buffer.
	_couldStorePositions() {
		return storedShape( this._options.lines ) !== null && this._canStorePositions( this._getBuildOptions() )
	}

	// Rebuild with options that were just changed, or put `previous` back.
	_rebuildOrRestore( previous ) {
		try {
			return this.rebuild()
		} catch ( error ) {
			Object.assign( this._options, previous )
			this.rebuild()
			throw error
		}
	}

	// Custom attributes address the attribute layout, so the line stays on it.
	_keepAttributeLayout() {
		this._customAttributes = true
		if ( this._positionStorage ) this.rebuild()
	}

	_onBeforeRender( renderer ) {
		this._syncPositionStorage( renderer )
		this.ensureBuilt()
		// Later rebuilds free the GPU buffers they replace through this renderer.
		this.geometry._trackRenderer?.( renderer )
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
		const stored = this._positionStorage
		if ( stored ) {
			const shape = storedShape( positions )
			if ( shape?.lineCount === stored.lineCount && shape.pointsPerLine === stored.pointsPerLine ) {
				this._writePositionStorage( positions )
				this._options.lines = positions
				return
			}
			// Another shape: rebuild, into a new storage buffer when it still fits.
			const previous = { lines: this._options.lines }
			this._options.lines = positions
			this._rebuildOrRestore( previous )
			return
		}
		if ( this._storageSupported ) {
			// Points that fit a storage buffer again move the line back into one.
			const previous = { lines: this._options.lines }
			this._options.lines = positions
			if ( this._couldStorePositions() ) {
				this._rebuildOrRestore( previous )
				return
			}
			this._options.lines = previous.lines
		}
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
		if ( this._positionStorage ) return this._setStoredPositionRange( positions, startPoint, options )
		if ( !this.geometry.isMeshLine || typeof this.geometry.setPositionRange !== 'function' ) {
			throw new Error( 'MeshLine: setPositionRange() is only available for CPU billboard lines; use setPositions() for surfaces' )
		}
		this.geometry.setPositionRange( positions, startPoint, options )
		// The geometry keeps its source current: the caller's arrays while they
		// hold the edit, otherwise its own canonical points.
		this._options.lines = this.geometry.options.lines
		return this
	}

	_setStoredPositionRange( positions, startPoint, { lineIndex = 0 } = {} ) {
		const { buffer, lineCount, pointsPerLine } = this._positionStorage
		const points = flattenPoints( positions )
		const pointCount = points.length / 3
		if ( !Number.isInteger( lineIndex ) || lineIndex < 0 || lineIndex >= lineCount ) {
			throw new RangeError( `MeshLine: lineIndex ${lineIndex} is outside the ${lineCount} stored lines` )
		}
		if ( !Number.isInteger( startPoint ) || startPoint < 0 || startPoint + pointCount > pointsPerLine ) {
			throw new RangeError( `MeshLine: points ${startPoint}..${startPoint + pointCount} are outside the ${pointsPerLine} stored points` )
		}
		if ( pointCount === 0 ) return this

		// Later rebuilds replay the source lines, so they have to hold the edit:
		// the caller's arrays while they already do, else a copy this line owns.
		let lines = this._options.lines
		const single = lines instanceof Float32Array
		const source = single ? lines : lines[lineIndex]
		let held = true
		for ( let i = 0; i < points.length && held; i++ ) held = source[startPoint * 3 + i] === points[i]
		if ( !held ) {
			if ( lines !== this._ownedLines ) {
				lines = this._ownedLines = this._options.lines = single ? lines.slice() : lines.map( line => line.slice() )
			}
			( single ? lines : lines[lineIndex] ).set( points, startPoint * 3 )
		}

		const firstPoint = lineIndex * pointsPerLine + startPoint
		writeStoredPoints( buffer.array, firstPoint, points, pointCount )
		buffer.addUpdateRange( firstPoint * 4, pointCount * 4 )
		buffer.needsUpdate = true
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
		this._keepAttributeLayout()
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
		this._keepAttributeLayout()
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
		this._keepAttributeLayout()
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
		this._keepAttributeLayout()
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

	_syncMaterialTransparency() {
		if ( !this.material ) return
		const resolvedTransparent = this.material.isMeshLineSurfaceNodeMaterial
			? !!( this._options.transparent || this._options.opacity < 1 || this._options.alphaMap != null )
			: this._resolvesToTransparent()
		const previousTransparent = this.material.transparent
		const previousDepthWrite = this.material.depthWrite
		this.material.transparent = resolvedTransparent
		this.material.depthWrite = this._options.depthWrite ?? !resolvedTransparent
		if ( previousTransparent !== resolvedTransparent || previousDepthWrite !== this.material.depthWrite ) {
			this.material.needsUpdate = true
		}
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
		// A storage-backed line has no CPU bounds to cull against.
		this.frustumCulled = frustumCulled && !this._positionStorage
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
	 * Build the line if needed, initialize the renderer when required, and
	 * asynchronously precompile its GPU render pipeline via `renderer.compileAsync()`.
	 * @param {import('three/webgpu').WebGPURenderer} renderer
	 * @param {import('three/webgpu').Camera} camera
	 * @param {import('three/webgpu').Scene | null} [scene]
	 * @returns {Promise<this>}
	 */
	async warmupAsync( renderer, camera, scene = this.parent ?? null ) {
		this.ensureBuilt()
		if ( renderer?._initialized === false && typeof renderer.init === 'function' ) {
			await renderer.init()
		}
		this._syncPositionStorage( renderer )
		if ( typeof renderer?.compileAsync === 'function' && camera ) {
			const targetScene = scene?.isScene ? scene : null
			await renderer.compileAsync( this, camera, targetScene )
		}
		return this
	}

	rebuild() {
		this._built = false
		return this.build()
	}

	// Build options a setter just changed: the whole line when `full`, else only
	// the geometry, which takes `buildOptions` or every current option. When the
	// geometry or the vertex-buffer budget rejects them, as for a non-finite
	// width, put `previous` back and rebuild the geometry with the options it
	// last accepted: build() reaches the material only after both checks, and
	// options set since then stay pending for the next build. A rejection inside
	// the geometry cleared it, custom attributes included: every attribute the
	// restore does not recreate comes back, as an accepted rebuild keeps them.
	_buildOrRestore( previous, full, buildOptions = null, geometryOptions = this.geometry.options ) {
		const attributes = { ...this.geometry.attributes }
		// A storage-backed geometry is a template, and the new options may move
		// the line back to attributes: only a whole build can tell.
		if ( this._positionStorage ) full = true
		try {
			if ( full ) {
				this.rebuild()
			} else {
				this.geometry.buildLine( buildOptions ?? this._getBuildOptions() )
				// Only a geometry that gained an attribute can exceed the budget.
				for ( const name in this.geometry.attributes ) {
					if ( attributes[name] ) continue
					this.validateVertexBufferBudget()
					break
				}
			}
		} catch ( error ) {
			Object.assign( this._options, previous )
			// Merge nested options (surface, join, cap) into the accepted ones,
			// not into those the rejected build left.
			this.geometry.options = geometryOptions
			this.geometry.buildLine( geometryOptions )
			for ( const name in attributes ) {
				if ( !this.geometry.attributes[name] ) this.geometry.setAttribute( name, attributes[name] )
			}
			this._built = true
			throw error
		}
		return this
	}

	// The smoothing setters rebuild only the geometry, from the options it last
	// accepted: options set since the build, such as gpuPositionNode() or
	// needsUV(), stay pending for a rebuild that reaches the material too.
	_setSmoothing( key, value ) {
		const previous = this._options[key]
		this._options[key] = value
		if ( this._built ) {
			const buildOptions = { ...this.geometry.options, [key]: value, lines: this._options.lines }
			this._buildOrRestore( { [key]: previous }, false, buildOptions )
		}
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
		if ( this.geometry.isMeshLineSurfaceGeometry ) {
			Mesh.prototype.raycast.call( this, raycaster, intersects )
			return
		}
		ensureRaycastScratch()

		const geometry = this.geometry
		const matrixWorld = this.matrixWorld
		const lineParams = raycaster.params.Line || {}
		const threshold = lineParams.threshold ?? 1
		const firstHitOnly = lineParams.firstHitOnly === true || raycaster.firstHitOnly === true

		// Detect instancing from attributes rather than Mesh.count
		// (Three.js manages Mesh.count internally and may override it)
		const startAttr = geometry.getAttribute( 'instanceStart' )
		const endAttr = geometry.getAttribute( 'instanceEnd' )
		const isInstanced = !!( startAttr && endAttr && isInstancedAttribute( startAttr ) )
		// A storage-backed line keeps its points in the source lines, not in the
		// template geometry, and has no bounds to pre-check.
		const storedLines = this._positionStorage
			? ( this._options.lines instanceof Float32Array ? [this._options.lines] : this._options.lines )
			: null
		const hasLines = !!( storedLines || ( geometry._lines && geometry._lines.length > 0 ) )

		if ( !isInstanced ) {
			if ( !hasLines ) return
			if ( this._options.gpuPositionNode ) {
				if ( !this._warnedGpuRaycast ) {
					console.info( 'MeshLine.raycast: GPU-positioned lines are not raycastable — use MeshLinePicker.' )
					this._warnedGpuRaycast = true
				}
				return
			}

			if ( !storedLines && geometry.boundingSphere === null ) geometry.computeBoundingSphere()
			if ( !storedLines && geometry.boundingSphere !== null && geometry.boundingSphere.radius > 0 ) {
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
		let hasClosestHit = false
		let closestDistanceSq = Infinity
		let closestIndex = 0
		let closestLineIndex = undefined
		let closestInstanceId = undefined

		const commitHit = ( index, lineIndex, instanceId ) => {
			_interRay.applyMatrix4( matrixWorld )
			const distanceSq = rayOrigin.distanceToSquared( _interRay )

			if ( distanceSq < nearSq || distanceSq > farSq ) return

			if ( firstHitOnly ) {
				if ( distanceSq >= closestDistanceSq ) return
				closestDistanceSq = distanceSq
				closestIndex = index
				closestLineIndex = lineIndex
				closestInstanceId = instanceId
				_closestPoint.copy( _interSegment )
				hasClosestHit = true
				return
			}

			const hit = {
				distance: Math.sqrt( distanceSq ),
				point: _interSegment.clone().applyMatrix4( matrixWorld ),
				index,
				face: null,
				faceIndex: null,
				object: this,
			}

			if ( lineIndex !== undefined ) hit.lineIndex = lineIndex
			if ( instanceId !== undefined ) hit.instanceId = instanceId

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
			const lines = storedLines ?? geometry._lines
			const lineBoxes = !storedLines && geometry.boundingBoxes?.length === lines.length ? geometry.boundingBoxes : null
			if ( !storedLines && lines.length > 1 && geometry.boundingBox && !geometry.boundingBox.isEmpty() ) {
				_box.copy( geometry.boundingBox ).expandByScalar( localThreshold )
				if ( _ray.intersectsBox( _box ) === false ) return
			}
			for ( let lineIdx = 0; lineIdx < lines.length; lineIdx++ ) {

				const line = lines[lineIdx]
				const numPoints = line.length / 3
				if ( numPoints < 2 ) continue

				if ( lineBoxes ) {
					_box.copy( lineBoxes[lineIdx] ).expandByScalar( localThreshold )
					if ( _ray.intersectsBox( _box ) === false ) continue
				}

				_vStart.set( line[0], line[1], line[2] )
				for ( let i = 0, o2 = 3; i < numPoints - 1; i++, o2 += 3 ) {

					_vEnd.set( line[o2], line[o2 + 1], line[o2 + 2] )

					const distSq = _ray.distanceSqToSegment( _vStart, _vEnd, _interRay, _interSegment )
					_vStart.copy( _vEnd )

					if ( distSq > localThresholdSq ) continue

					commitHit( i, lineIdx )
				}
			}
		}

		if ( firstHitOnly && hasClosestHit ) {
			const hit = {
				distance: Math.sqrt( closestDistanceSq ),
				point: _closestPoint.clone().applyMatrix4( matrixWorld ),
				index: closestIndex,
				face: null,
				faceIndex: null,
				object: this,
			}
			if ( closestLineIndex !== undefined ) hit.lineIndex = closestLineIndex
			if ( closestInstanceId !== undefined ) hit.instanceId = closestInstanceId
			intersects.push( hit )
		}
	}

	/**
	 * Dispose the geometry, material, and all associated resources.
	 * Also removes the mesh from its parent and cleans up event listeners.
	 */
	dispose = () => {
		this.parent?.remove( this )
		if ( this.geometry ) this.geometry._ownerLine = null
		this._releasePositionStorage()
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

export default MeshLineBillboard
