import { Mesh, MeshBasicMaterial, PlaneGeometry, Texture } from 'three'
export default class Circle extends Mesh {
	constructor( width, height, borderWidth, color ) {
		let canvas = document.createElement( 'canvas' )
		let context = canvas.getContext( '2d' )
		canvas.width = 512
		canvas.height = 512

		context.clearRect( 0, 0, canvas.width, canvas.height )
		context.fillStyle = color
		context.beginPath()
		context.arc( 256, 256, 256, 0, 2 * Math.PI )
		context.fill()
		let texture = new Texture( canvas )
		texture.needsUpdate = true

		let geo = new PlaneGeometry( width, height )
		let material = new MeshBasicMaterial( {
			transparent: true,
			map: texture,
			depthWrite: false,
		} )
		super( geo, material )
	}
}
