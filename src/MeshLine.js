import { Fn, step, uniform, uv } from "three/tsl"
import { MeshLineGeometry } from "./MeshLineGeometry"
import { MeshLineNodeMaterial } from "./MeshLineNodeMaterial"
import { Mesh, InstancedBufferAttribute } from "three/webgpu"
import { straightLine } from "./positions/straightLine"

const defaultPositions = straightLine( 2 )
export default class MeshLine extends Mesh {

	constructor() {
		
		super( new MeshLineGeometry(), new MeshLineNodeMaterial() )

		this._options = {
			segments: 1,
			isClose: false,
			
			color: 0xffffff,
			lineWidth: 0.3,
			widthCallback: null,
			sizeAttenuation: false,

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
	lines( lines, isClose = this._options.isClose ) {
		this._options.lines = lines
		this._options.isClose = isClose
		return this
	}

	segments( segments ) {
		this._options.segments = segments
		return this
	}

	isClose( isClose ) {
		this._options.isClose = isClose
		return this
	}

	color( color ) {
		this._options.color = color
		return this
	}

	lineWidth( lineWidth ) {
		this._options.lineWidth = lineWidth
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
		return this
	}

	alphaTest( alphaTest ) {
		this._options.alphaTest = alphaTest
		return this
	}

	transparent( transparent ) {
		this._options.transparent = transparent
		return this
	}

	wireframe( wireframe ) {
		this._options.wireframe = wireframe
		return this
	}

	useMiterLimit( useMiterLimit, miterLimit = 4 ) {
		this._options.useMiterLimit = useMiterLimit
		this._options.miterLimit = miterLimit
		return this
	}

	miterLimit( miterLimit ) {
		this._options.miterLimit = miterLimit
		return this
	}

	gradientColor( gradientColor ) {
		this._options.gradientColor = gradientColor
		return this
	}

	map( map ) {
		this._options.map = map
		return this
	}

	mapOffset( mapOffset ) {
		this._options.mapOffset = mapOffset
		return this
	}

	alphaMap( alphaMap ) {
		this._options.alphaMap = alphaMap
		return this
	}

	dashes( dashCount, dashRatio = 0.5, dashOffset = 0 ) {
		this._options.dashCount = dashCount
		this._options.dashRatio = dashRatio
		this._options.dashOffset = dashOffset
		return this
	}

	dpr( dpr ) {
		this._options.dpr = dpr
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
		return this
	}

	// Optional attribute toggles
	needsUV( needsUV ) {
		this._options.needsUV = needsUV
		return this
	}
	needsWidth( needsWidth ) {
		this._options.needsWidth = needsWidth
		return this
	}
	needsCounter( needsCounter ) {
		this._options.needsCounter = needsCounter
		return this
	}
	needsPrevious( needsPrevious ) {
		this._options.needsPrevious = needsPrevious
		return this
	}
	needsNext( needsNext ) {
		this._options.needsNext = needsNext
		return this
	}
	needsSide( needsSide ) {
		this._options.needsSide = needsSide
		return this
	}

	// Chainable methods for node hooks
	positionFn( fn ) {
		this._options.positionFn = fn
		return this
	}

	previousFn( fn ) {
		this._options.previousFn = fn
		return this
	}

	nextFn( fn ) {
		this._options.nextFn = fn
		return this
	}

	widthFn( fn ) {
		this._options.widthFn = fn
		return this
	}

	normalFn( fn ) {
		this._options.normalFn = fn
		return this
	}

	colorFn( fn ) {
		this._options.colorFn = fn
		return this
	}

	gradientFn( fn ) {
		this._options.gradientFn = fn
		return this
	}

	opacityFn( fn ) {
		this._options.opacityFn = fn
		return this
	}

	dashFn( fn ) {
		this._options.dashFn = fn
		return this
	}

	uvFn( fn ) {
		this._options.uvFn = fn
		return this
	}

	vertexFn( fn ) {
		this._options.vertexFn = fn
		return this
	}

	fragmentColorFn( fn ) {
		this._options.fragmentColorFn = fn
		return this
	}

	fragmentAlphaFn( fn ) {
		this._options.fragmentAlphaFn = fn
		return this
	}

	discardFn( fn ) {
		this._options.discardFn = fn
		return this
	}

	build() {
		let options = { ...this._options }

		let lines = options.lines ?? ( options.segments ? straightLine( options.segments ) : defaultPositions )

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

	dispose = () => {
		this.parent?.remove( this )
		this.geometry?.dispose()
		this.material?.dispose()
		if ( this.instanceMatrix ) this.instanceMatrix.dispose()
		if ( this.instanceColor ) this.instanceColor.dispose()
		this._built = false
	}
}
