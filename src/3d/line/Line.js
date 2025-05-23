import { step, uniform, uv } from "three/tsl"
import { MeshLineGeometry } from "./MeshLineGeometry"
import { MeshLineNodeMaterial } from "./MeshLineNodeMaterial"
import { Mesh, Vector3 } from "three"
import stage3d from "@/makio/three/stage3d"
import { animate } from "animejs"

export default class Line extends Mesh {

	constructor( positions, isLooped = false, color = 0xffffff ) {

		const geometry = new MeshLineGeometry()
		geometry.setPoints( new Float32Array( positions ), undefined, isLooped )

		let sizeAttenuation = false
		let material = new MeshLineNodeMaterial( {

			// line width
			lineWidth: 0.3 * ( sizeAttenuation ? 200 : 1 ),
			sizeAttenuation: sizeAttenuation,

			// color
			color: color,
			useGradient: true,
			useMap: false,
			map: null,

			// alpha
			opacity: 1,
			alphaTest: 1,
			useAlphaMap: false,
			alphaMap: null,

			// dash
			useDash: true,
			dashCount: 16,
			dashRatio: 0.9,
			dashOffset: 0,

			// classic three.js properties
			transparent: true,
			wireframe: false,
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

