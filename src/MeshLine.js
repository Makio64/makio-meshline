import { Fn, step, uniform, uv } from "three/tsl"
import { MeshLineGeometry } from "./MeshLineGeometry"
import { MeshLineNodeMaterial } from "./MeshLineNodeMaterial"
import { Mesh, InstancedBufferAttribute, StreamDrawUsage, StaticDrawUsage } from "three/webgpu"
import { straightLine } from "./positions/straightLine"

const defaultPositions = straightLine( 2 )
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
			
			dashCount: null,
			dashRatio: null,
			dashOffset: 0,

			// device pixel ratio scaling for screen-space width
			dpr: ( window.devicePixelRatio || 1 ),

			frustumCulled: true,

			// Debugging
			verbose: false,

			renderWidth: window.innerWidth,
			renderHeight: window.innerHeight,

			// GPU procedural positions (TSL node). If provided, positions will be calculated in shader.
			gpuPositionNode: null,
			usage: null,

			// Instancing options
			instanceCount: -1,
		}
		this._built = false
		this.onBeforeRender = this._onBeforeRender
	}

	// Chainable setters
	configure( options = {} ) {
		if ( options.lines !== undefined || options.closed !== undefined ) {
			const lines = options.lines ?? this._options.lines
			const closed = options.closed ?? this._options.closed
			this.lines( lines, closed )
		}
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
		if ( options.dpr !== undefined ) this.dpr( options.dpr )
		if ( options.frustumCulled !== undefined ) this.frustumCulled( options.frustumCulled )
		if ( options.verbose !== undefined ) this.verbose( options.verbose )
		if ( options.renderWidth !== undefined || options.renderHeight !== undefined ) this.renderSize( options.renderWidth, options.renderHeight )
		if ( options.dash ) this.dash( options.dash )
		if ( options.join ) this.join( options.join )
		if ( options.dynamic !== undefined ) this.dynamic( options.dynamic )
		if ( options.autoResize ) this.autoResize( options.autoResize )
		return this
	}
	lines( lines, closed = this._options.closed ) {
		this._options.lines = lines
		this._options.closed = closed
		if ( this._built ) {
			this.geometry.setPositions( lines, false )
		}
		return this
	}

	segments( segments ) {
		this._options.segments = segments
		return this
	}

	closed( closed ) {
		this._options.closed = closed
		return this
	}

	color( color ) {
		this._options.color = color
		return this
	}

	lineWidth( lineWidth ) {
		this._options.lineWidth = lineWidth
		if ( this.material.lineWidth ) {
			this.material.lineWidth.value = lineWidth
		}
		return this
	}

	widthCallback( widthCallback ) {
		this._options.widthCallback = widthCallback
		return this
	}

	sizeAttenuation( sizeAttenuation ) {
		this._options.sizeAttenuation = sizeAttenuation
		return this
	}

	opacity( opacity ) {
		this._options.opacity = opacity
		if ( this.material.opacity ) {
			if ( this.uOpacity && typeof opacity === 'number' ) {
				this.uOpacity.value = opacity
			}
		}
		return this
	}

	alphaTest( alphaTest ) {
		this._options.alphaTest = alphaTest
		this.material.alphaTest = alphaTest
		return this
	}

	transparent( transparent ) {
		this._options.transparent = transparent
		this.material.transparent = transparent
		return this
	}

	wireframe( wireframe ) {
		this._options.wireframe = wireframe
		this.material.wireframe = wireframe
		return this
	}

	join( { type = 'miter', limit = 4, quality = 'standard' } = {} ) {
		const useMiter = type === 'miter'
		const high = quality === 'high'
		this._options.useMiterLimit = useMiter
		this._options.miterLimit = limit
		this._options.highQualityMiter = high
		if ( this._built && this.material ) {
			this.material.useMiterLimit = useMiter
			if ( this.material.miterLimit ) this.material.miterLimit.value = limit
			this.material.highQualityMiter = high
		}
		return this
	}

	gradientColor( gradientColor ) {
		this._options.gradientColor = gradientColor
		if ( this.material.gradient ) {
			this.material.gradient.value = gradientColor
		}
		return this
	}

	map( map ) {
		this._options.map = map
		if ( this.material.map ) {
			this.material.map.value = map
		}
		return this
	}

	mapOffset( mapOffset ) {
		this._options.mapOffset = mapOffset
		if ( this.material.mapOffset ) {
			this.material.mapOffset.value.copy( mapOffset )
		}
		return this
	}

	alphaMap( alphaMap ) {
		this._options.alphaMap = alphaMap
		if ( this.material.alphaMap ) {
			this.material.alphaMap = alphaMap
		}
		return this
	}

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

	dpr( dpr ) {
		this._options.dpr = dpr
		if ( this.material.dpr ) {
			this.material.dpr.value = dpr
		}
		return this
	}

	// New dynamic usage helper
	dynamic( enable ) {
		this._options.usage = enable ? StreamDrawUsage : StaticDrawUsage
		if ( this._built && this.geometry?.setUsage ) {
			this.geometry.setUsage( this._options.usage )
		}
		return this
	}

	frustumCulled( frustumCulled ) {
		this._options.frustumCulled = frustumCulled
		return this
	}

	verbose( verbose ) {
		this._options.verbose = verbose
		return this
	}

	renderSize( width, height ) {
		this._options.renderWidth = width
		this._options.renderHeight = height
		return this
	}

	gpuPositionNode( gpuPositionNode ) {
		this._options.gpuPositionNode = gpuPositionNode
		return this
	}

	usage( usage ) {
		this._options.usage = usage
		return this
	}

	instances( instanceCount ) {
		this._options.instanceCount = instanceCount
		if ( this._built ) {
			console.warn( "MeshLine: Changing instance count after build is not supported yet." )
		}
		return this
	}

	// Optional attribute toggles
	needsUV( needsUV ) {
		this._options.needsUV = needsUV
		if ( this._built ) {
			console.warn( "MeshLine: Changing UV needs after build is not supported yet." )
		}
		return this
	}
	needsWidth( needsWidth ) {
		this._options.needsWidth = needsWidth
		if ( this._built ) {
			console.warn( "MeshLine: Changing width needs after build is not supported yet." )
		}
		return this
	}
	needsCounter( needsCounter ) {
		this._options.needsCounter = needsCounter
		if ( this._built ) {
			console.warn( "MeshLine: Changing counter needs after build is not supported yet." )
		}
		return this
	}
	needsPrevious( needsPrevious ) {
		this._options.needsPrevious = needsPrevious
		if ( this._built ) {
			console.warn( "MeshLine: Changing previous needs after build is not supported yet." )
		}
		return this
	}
	needsNext( needsNext ) {
		this._options.needsNext = needsNext
		if ( this._built ) {
			console.warn( "MeshLine: Changing previous needs after build is not supported yet." )
		}
		return this
	}
	needsSide( needsSide ) {
		this._options.needsSide = needsSide
		if ( this._built ) {
			console.warn( "MeshLine: Changing previous needs after build is not supported yet." )
		}
		return this
	}

	// Chainable methods for node hooks
	positionFn( fn ) {
		this._options.positionFn = fn
		if ( this._built ) {
			console.warn( "MeshLine: Changing position function after build is not supported yet." )
		}
		return this
	}

	previousFn( fn ) {
		this._options.previousFn = fn
		this._built = false
		return this
	}

	nextFn( fn ) {
		this._options.nextFn = fn
		this._built = false
		return this
	}

	widthFn( fn ) {
		this._options.widthFn = fn
		this._built = false
		return this
	}

	normalFn( fn ) {
		this._options.normalFn = fn
		this._built = false
		return this
	}

	colorFn( fn ) {
		this._options.colorFn = fn
		this._built = false
		return this
	}

	gradientFn( fn ) {
		this._options.gradientFn = fn
		this._built = false
		return this
	}

	opacityFn( fn ) {
		this._options.opacityFn = fn
		this._built = false
		return this
	}

	dashFn( fn ) {
		this._options.dashFn = fn
		this._built = false
		return this
	}

	uvFn( fn ) {
		this._options.uvFn = fn
		this._built = false
		return this
	}

	vertexFn( fn ) {
		this._options.vertexFn = fn
		this._built = false
		return this
	}

	fragmentColorFn( fn ) {
		this._options.fragmentColorFn = fn
		this._built = false
		return this
	}

	fragmentAlphaFn( fn ) {
		this._options.fragmentAlphaFn = fn
		this._built = false
		return this
	}

	discardFn( fn ) {
		this._options.discardFn = fn
		this._built = false
		return this
	}

	build() {
		let options = { ...this._options }

		let lines = options.lines ?? ( options.segments ? straightLine( 1, options.segments ) : defaultPositions )

		options.lines = lines

		// Computed needs
		options.needsWidth = options.widthCallback ?? true
		options.needsCounter = options.needsCounter ?? true
		options.needsSide = options.needsSide ?? true
		options.needsUV = options.needsUV ?? ( options.map || options.alphaMap )

		// If using GPU position node, we don't need previous/next positions
		options.needsPrevious = options.needsPrevious ?? options.gpuPositionNode ? false : true
		options.needsNext = options.needsNext ?? options.gpuPositionNode ? false : true

		this.geometry.buildLine( options )
		this.material.buildLine( options )

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
		if ( !this._built ) this.build()
	}

	setPositions( positions ) {
		if ( !this._built ) this.build()
		this.geometry.setPositions( positions )
	}

	addInstanceAttribute( name, components = 1 ) {
		if ( !this._built ) this.build()
		const array = new Float32Array( this.count * components )
		const attribute = new InstancedBufferAttribute( array, components )
		this.geometry.setAttribute( name, attribute )
		return attribute
	}

	setInstanceValue( name, index, value ) {
		const attribute = this.geometry.getAttribute( name )
		if ( ! attribute ) return

		if ( typeof value === 'number' ) value = [value]

		const offset = index * attribute.itemSize
		for ( let j = 0; j < Math.min( attribute.itemSize, value.length ); j++ ) {
			attribute.array[ offset + j ] = value[ j ]
		}
		attribute.needsUpdate = true
	}

	resize( width = window.innerWidth, height = window.innerHeight ) {
		if ( this.material && this.material.resolution ) {
			this.material.resolution.value.set( width, height )
		}
	}

	// Auto-resize to window (or external handler)
	autoResize( target = window ) {
		if ( this._autoResizeHandler ) {
			window.removeEventListener( 'resize', this._autoResizeHandler )
			this._autoResizeHandler = null
		}
		this._autoResizeHandler = () => {
			this.resize( window.innerWidth, window.innerHeight )
		}
		window.addEventListener( 'resize', this._autoResizeHandler )
		return this
	}

	dispose = () => {
		this.parent?.remove( this )
		this.geometry?.dispose()
		this.material?.dispose()
		if ( this._autoResizeHandler ) {
			window.removeEventListener( 'resize', this._autoResizeHandler )
			this._autoResizeHandler = null
		}
		if ( this.instanceMatrix ) this.instanceMatrix.dispose()
		if ( this.instanceColor ) this.instanceColor.dispose()
		this._built = false
	}
}
