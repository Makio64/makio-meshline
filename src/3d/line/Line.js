import { step, uniform, uv } from "three/tsl"
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
			useGradient: false,
			gradientColor: 0xff0000,
			useMap: false,
			map: null,
			useAlphaMap: false,
			alphaMap: null,
			useDash: false,
			dashCount: 4,
			dashRatio: 0.5,
			dashOffset: 0,
			opacity: 1,
			alphaTest: 1,
			transparent: false,
			wireframe: false
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
			useGradient: config.useGradient,
			gradient: new Color( config.gradientColor ),
			useMap: config.useMap,
			map: config.map,
			useAlphaMap: config.useAlphaMap,
			alphaMap: config.alphaMap,

			// dash
			useDash: config.useDash,
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
		material.opacityNode = step( uv().x, this.percent  ).mul( step( uv().x.oneMinus(), this.percent2  ) ).mul( this.opacity )

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
			animate( this.percent, { duration: 1, value: 1, onComplete: resolve, ease: 'easeOut' } )
		} )
	}

	hide = ()=>{
		return new Promise( ( resolve )=>{
			animate( this.percent2, { duration: 1, value: 0, onComplete: resolve, ease: 'easeOut' } )
		} )
	}

	move = ( point, options )=>{
		let topLeft = new Vector3( 0, 0, 0 )
		topLeft.x = ( topLeft.x / window.innerWidth ) * 2 - 1
		topLeft.y = -( topLeft.y / window.innerHeight ) * 2 + 1
		topLeft.unproject( stage3d.camera )

		point.x = ( point.x / window.innerWidth ) * 2 - 1
		point.y = -( point.y / window.innerHeight ) * 2 + 1

		point.unproject( stage3d.camera )

		let x = point.x - topLeft.x
		let y = point.y - topLeft.y

		animate( this.position, { duration: 1, x, y, ...options } )
	}

	fade = ( opacity, options )=>{
		animate( this.opacity, { duration: 1, value: opacity, ...options } )
	}

	dispose = ()=>{

		window.removeEventListener( 'resize', this._handleResize, false )
		this.parent?.remove( this )
		this.geometry?.dispose()
		this.material?.dispose()
	}
}

