import { Fn, step, uniform, uv } from "three/tsl"
import { MeshLineGeometry } from "./MeshLineGeometry"
import { MeshLineNodeMaterial } from "./MeshLineNodeMaterial"
import { Mesh, Color } from "three/webgpu"

const defaultPositions = new Float32Array( [0, 0, 0, 1, 0, 0] )
export default class MeshLine extends Mesh {

	constructor( options = {} ) {

		// Merge options with defaults
		options = { 
			lines: defaultPositions,
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

			needsWidths: false,
			needsUVs: true,
			needsCounters: true,
			needsPrevious: true,
			needsNext: true,
			needsSide: true,

			frustumCulled: true,

			renderWidth: window.innerWidth,
			renderHeight: window.innerHeight,

			...options
		}

		const geometry = new MeshLineGeometry( options )

		let material = new MeshLineNodeMaterial( {
			...options,
			lineWidth: options.lineWidth * ( options.sizeAttenuation ? 200 : 1 ),
			gradient: options.gradientColor ? new Color( options.gradientColor ) : null,
		} )

		super( geometry, material )

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
	}
}
