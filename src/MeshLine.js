import { Fn, step, uniform, uv } from "three/tsl"
import { MeshLineGeometry } from "./MeshLineGeometry"
import { MeshLineNodeMaterial } from "./MeshLineNodeMaterial"
import { Mesh, Color } from "three"
import { animate } from "animejs"

export default class MeshLine extends Mesh {

	constructor( positions, options = {} ) {
		// Default options
		const defaultOptions = {
			isClose: false,
			color: 0xffffff,
			lineWidth: 0.3,
			sizeAttenuation: false,
			gradientColor: null,
			map: null,
			alphaMap: null,
			dashCount: null,
			dashRatio: null,
			dashOffset: 0,
			opacity: 1,
			alphaTest: 1,
			transparent: false,
			wireframe: false,
			mapOffset: null,
			usePercent: false,
		}

		// Merge options with defaults
		const config = { ...defaultOptions, ...options }

		const geometry = new MeshLineGeometry()

		if ( Array.isArray( positions ) && positions.length > 0 && Array.isArray( positions[0] ) ) {
			geometry.setLines( positions, undefined, config.isClose )
		} else {
			geometry.setLines( [positions] , undefined, [config.isClose] )
		}

		let material = new MeshLineNodeMaterial( {
			// color
			color: config.color,
			opacity: config.opacity,
			alphaTest: config.alphaTest,

			lineWidth: config.lineWidth * ( config.sizeAttenuation ? 200 : 1 ),
			sizeAttenuation: config.sizeAttenuation,
			gradient: config.gradientColor ? new Color( config.gradientColor ) : null,
			map: config.map,
			alphaMap: config.alphaMap,
			mapOffset: config.mapOffset,

			// dash
			dashCount: config.dashCount,
			dashRatio: config.dashRatio,
			dashOffset: config.dashOffset,

			// classic three.js properties
			wireframe: config.wireframe,
		} )

		super( geometry, material )

		if( (config.percent !== undefined && config.percent2 !== undefined ) || config.usePercent ) {
			this.percent = uniform( config.percent ?? 1 )
			this.percent2 = uniform( config.percent2 ?? 1 )
		}

		this.opacity = uniform( config.opacity ?? 1 )

		material.discardConditionNode = Fn( ()=>{
			return step( uv().x, this.percent  ).mul( step( uv().x.oneMinus(), this.percent2  ) ).mul( this.opacity ).lessThan( 0.00001 )
		} )()

		this.frustumCulled = false

		// Bind and add resize listener
		this.resize = this.resize.bind( this )
		window.addEventListener( 'resize', this.resize, false )
		this.resize()
	}

	resize() {
		if ( this.material && this.material.resolution ) {
			this.material.resolution.value.set( window.innerWidth, window.innerHeight )
		}
	}

	show = ()=>{
		return new Promise( ( resolve )=>{
			animate( this.percent, { duration: 1, value: 0.9, onComplete: resolve, ease: 'easeOut' } )
		} )
	}

	hide = ()=>{
		return new Promise( ( resolve )=>{
			animate( this.percent2, { duration: 1, value: -0.1, onComplete: resolve, ease: 'easeOut' } )
		} )
	}

	dispose = ()=>{

		window.removeEventListener( 'resize', this.resize, false )
		this.parent?.remove( this )
		this.geometry?.dispose()
		this.material?.dispose()
	}
}

