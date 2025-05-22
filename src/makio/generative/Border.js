import { Mesh, MeshBasicMaterial, PlaneGeometry, Texture } from 'three'
export default class Border extends Mesh {
	constructor( width, height, borderWidth, color ) {
		let canvas = document.createElement( 'canvas' )
		let context = canvas.getContext( '2d' )
		canvas.width = 1024
		canvas.height = 1024

		let bw = ( 1024 / width ) * borderWidth
		context.clearRect( 0, 0, canvas.width, canvas.height )
		context.fillStyle = color
		context.fillRect( 0, 0, canvas.width, bw )
		context.fillRect( canvas.width - bw, 0, bw, canvas.height )
		context.fillRect( 0, canvas.height - bw, canvas.width, bw )
		context.fillRect( 0, 0, bw, canvas.height )
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
