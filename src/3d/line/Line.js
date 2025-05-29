import { Fn, step, uniform, uv, abs, sin, time } from "three/tsl"
import { MeshLineGeometry } from "./MeshLineGeometry"
import { MeshLineNodeMaterial } from "./MeshLineNodeMaterial"
import { Mesh, Vector3, Color } from "three"
import stage3d from "@/makio/three/stage3d"
import { animate } from "animejs"

export default class Line extends Mesh {

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
		}

		// Merge options with defaults
		const config = { ...defaultOptions, ...options }

		const geometry = new MeshLineGeometry()
		geometry.setPoints( new Float32Array( positions ), undefined, config.isClose )

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
		this.percent = uniform( 0 )
		this.percent2 = uniform( 1 )
		this.opacity = uniform( 1 )

		// material.opacityNode = Fn( ()=>{
		// 	return abs( sin( uv().x.mul( 20 ).add( time ) ) )
		// } )()

		material.discardConditionNode = Fn( ()=>{
			//
			return step( uv().x, this.percent  ).mul( step( uv().x.oneMinus(), this.percent2  ) ).mul( this.opacity ).lessThan( 0.00001 )
		} )()

		this.frustumCulled = false

		// Bind and add resize listener
		this._handleResize = this._handleResize.bind( this )
		window.addEventListener( 'resize', this._handleResize, false )
		this._handleResize()
	}

	_handleResize() {
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

		window.removeEventListener( 'resize', this._handleResize, false )
		this.parent?.remove( this )
		this.geometry?.dispose()
		this.material?.dispose()
	}
}

