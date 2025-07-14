import { Fn, step, uniform, uv } from "three/tsl"
import { MeshLineGeometry } from "./MeshLineGeometry"
import { MeshLineNodeMaterial } from "./MeshLineNodeMaterial"
import { Mesh, InstancedBufferAttribute } from "three/webgpu"
import { straightLine } from "./positions/straightLine"

const defaultPositions = straightLine( 2 )
export default class MeshLine extends Mesh {

	constructor( options = {} ) {

		let lines = options.lines || options.segments ? straightLine( options.segments ) : defaultPositions
		// Merge options with defaults
		options = { 
			lines: lines,
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
			
			usePercent: false,

			// device pixel ratio scaling for screen-space width
			dpr: ( window.devicePixelRatio || 1 ),

			// What attributes are needed for the shader
			needsWidth: options.widthCallback ? true : false,
			needsUV: options.map || options.alphaMap || options.usePercent || options.percent !== undefined || options.percent2 !== undefined ? true : false,
			needsCounter: true,
			needsPrevious: options.gpuPositionNode ? false : true,
			needsNext: options.gpuPositionNode ? false : true,
			needsSide: true,

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

			...options
		}

		const geometry = new MeshLineGeometry( options )

		let material = new MeshLineNodeMaterial( {
			...options,
		} )

		super( geometry, material )

		if ( options.instanceCount != -1 ) {
			this.count = options.instanceCount
		}

		this.frustumCulled = options.frustumCulled

		if ( ( options.percent !== undefined && options.percent2 !== undefined ) || options.usePercent ) {
			this.percent = uniform( options.percent ?? 1 )
			this.percent2 = uniform( options.percent2 ?? 1 )
		}

		if ( options.opacity ) {
			if ( options.opacity.isNode ) {
				this.opacity = options.opacity
			}
			else if ( typeof options.opacity === 'number' ) {
				this.opacity = uniform( options.opacity )
			}
		} else {
			this.opacity = uniform( 1 )
		}

		if ( this.percent !== undefined && this.percent2 !== undefined ) {
			material.discardConditionNode = Fn( () => {
				return step( uv().x, this.percent ).mul( step( uv().x.oneMinus(), this.percent2 ) ).mul( this.opacity ).lessThan( 0.00001 )
			} )()
		}

		this.resize( options.renderWidth, options.renderHeight )
	}

	addInstanceAttribute( name, components = 1 ) {
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

	setGeometry( geometry, culling = true ) {
		this.geometry = geometry
		this.frustumCulled = culling
		this.geometry.computeBoundingSphere()
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
	}
}
