import { step, uniform, uv } from "three/tsl"
import { MeshLineGeometry } from "./MeshLineGeometry"
import { MeshLineNodeMaterial } from "./MeshLineNodeMaterial"
import { Mesh, Vector3 } from "three"
import stage3d from "@/makio/three/stage3d"
import { animate } from "animejs"

export default class Line extends Mesh {

	constructor( shape = 'square', segments = 16, isLooped = false, zPosition = 0, color = 0xffffff ) {

		const geometry = new MeshLineGeometry()
		let positions
		if ( shape === 'circle' ) {
			positions = circlePositions( segments, zPosition )
		} else { // default to square
			positions = squarePositions( segments, zPosition )
		}
		geometry.setPoints( new Float32Array( positions ), undefined, isLooped )

		let sizeAttenuation = false
		let material = new MeshLineNodeMaterial( {
			color: color,
			lineWidth: 0.3 * ( sizeAttenuation ? 200 : 1 ),
			sizeAttenuation: sizeAttenuation,
			useGradient: true,
			useMap: false,
			useAlphaMap: false,
			wireframe: false,
			// map,
			// alphaMap: map,

			useDash: false,
			dashOffset: 0.1,
			dashArray: 0.1,
			dashRatio: 0.1,

			opacity: 1,
			alphaTest: 0.1,
			transparent: true,
			depthWrite: true,
			depthTest: true,
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

export const circlePositions = ( segments = 100, zPosition = 0 )=>{
	const positions = []
	// const segments = 100 // segments is now a parameter

	for ( let i = 0; i < segments; i++ ) {
		const angle = ( i / segments ) * Math.PI * 2
		positions.push( Math.sin( angle ), Math.cos( angle ), zPosition )
	}

	return positions
}

export const squarePositions = ( segments = 1, zPosition = 0 ) => {
	const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
	const positions = []
	for ( let i = 0; i < 4; i++ ) {
		const [x0, y0] = corners[ i ]
		const [x1, y1] = corners[ ( i + 1 ) % 4 ]
		for ( let j = 0; j < segments; j++ ) { // segments per side
			const t = j / segments
			const x = x0 + ( x1 - x0 ) * t
			const y = y0 + ( y1 - y0 ) * t
			positions.push( x, y, zPosition )
		}
	}
	return positions
}
