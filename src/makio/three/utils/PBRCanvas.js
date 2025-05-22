import { RepeatWrapping, Texture } from 'three'

export default class PBRCanvas {
	constructor( width = 512, height = 512 ) {
		this.width = width
		this.height = height
		this.canvas = document.createElement( 'canvas' )
		this.canvasPBR = document.createElement( 'canvas' )

		// setup canvas
		this.ctx = this.makeCanvas( this.canvas, 0 )
		this.ctxPBR = this.makeCanvas( this.canvasPBR, width / 2 )

		this.texture = new Texture( this.canvas )
		this.texturePBR = new Texture( this.canvasPBR )
	}

	set needsUpdate( value ) {
		this.texture.needsUpdate = true
		this.texturePBR.needsUpdate = true
	}

	// --------------------------------------------------------------- FAST SHORTCUT

	drawRect( x, y, width, height, color, metalness, roughness ) {
		this.beginPath()
		this.fillStyle( color, metalness, roughness )
		this.rect( x, y, width, height )
		this.fill()
	}

	drawArc( x, y, radius, startAngle, endAngle, color, metalness, roughness ) {
		this.beginPath()
		this.fillStyle( color, metalness, roughness )
		this.arc( x, y, radius, startAngle, endAngle )
		this.fill()
	}

	drawCircle( x, y, radius, color, metalness, roughness ) {
		this.drawArc( x, y, radius, 0, Math.PI * 2, color, metalness, roughness )
	}

	drawEllipse( x, y, radiusX, radiusY, color, metalness, roughness ) {
		this.beginPath()
		this.fillStyle( color, metalness, roughness )
		this.ellipse( x, y, radiusX, radiusY, 0, 0, Math.PI * 2 )
		this.fill()
	}

	drawLine( fromX, fromY, toX, toY, lineWidth, color, metalness, roughness ) {
		this.beginPath()
		this.strokeStyle( color, metalness, roughness, lineWidth )
		this.moveTo( fromX, fromY )
		this.lineTo( toX, toY )
		this.stroke()
	}

	// --------------------------------------------------------------- BASIC OPERATION

	beginPath() {
		this.ctx.beginPath()
		this.ctxPBR.beginPath()
	}

	fill() {
		this.ctx.fill()
		this.ctxPBR.fill()
		this.needsUpdate = true
	}

	stroke() {
		this.ctx.stroke()
		this.ctxPBR.stroke()
		this.needsUpdate = true
	}

	strokeStyle( color, metalness, roughness, lineWidth ) {
		this.ctx.strokeStyle = color
		this.ctxPBR.strokeStyle = `rgb(0,${255 * roughness},${255 * metalness})`
		this.lineWidth( lineWidth )
	}

	fillStyle( color, metalness, roughness ) {
		this.ctx.fillStyle = color
		this.ctxPBR.fillStyle = `rgb(0,${255 * roughness},${255 * metalness})`
	}

	lineWidth( lineWidth ) {
		this.ctx.lineWidth = lineWidth
		this.ctxPBR.lineWidth = lineWidth
	}

	lineTo( toX, toY ) {
		this.ctx.lineTo( toX, toY )
		this.ctxPBR.lineTo( toX, toY )
	}

	moveTo( toX, toY ) {
		this.ctx.moveTo( toX, toY )
		this.ctxPBR.moveTo( toX, toY )
	}

	rect( x, y, width, height ) {
		this.ctx.rect( x, y, width, height )
		this.ctxPBR.rect( x, y, width, height )
	}

	arc( x, y, radius, startAngle, endAngle ) {
		this.ctx.arc( x, y, radius, startAngle, endAngle )
		this.ctxPBR.arc( x, y, radius, startAngle, endAngle )
	}

	ellipse( x, y, radiusX, radiusY, rotation, startAngle, endAngle ) {
		this.ctx.ellipse( x, y, radiusX, radiusY, rotation, startAngle, endAngle )
		this.ctxPBR.ellipse( x, y, radiusX, radiusY, rotation, startAngle, endAngle )
	}

	circle( x, y, radius ) {
		this.arc( x, y, radius, 0, Math.PI * 2 )
	}

	// --------------------------------------------------------------- CANVAS CREATE / RESET

	clear() {
		this.ctx.clearRect( 0, 0, this.width, this.height )
		this.ctxPBR.clearRect( 0, 0, this.width, this.height )
		this.needsUpdate = true
	}

	makeCanvas( canvas, offset ) {
		// setup ctx
		let ctx = canvas.getContext( '2d' )
		canvas.width = this.width
		canvas.height = this.height
		ctx.width = this.width
		ctx.height = this.height
		ctx.clearRect( 0, 0, this.width, this.height )

		// Debug
		canvas.class = 'pbr'
		canvas.style.position = 'absolute'
		canvas.style.bottom = 0
		canvas.style.left = offset + 'px'
		canvas.style.transformOrigin = 'left bottom'
		canvas.style.transform = 'scale(.5,.5)'
		canvas.style.zIndex = 500000
		// document.body.appendChild(canvas)
		return ctx
	}

	debug() {
		document.body.appendChild( this.canvas )
		document.body.appendChild( this.canvasPBR )
	}

	repeat( x = 1, y = 1 ) {
		this.texture.wrapS = RepeatWrapping
		this.texture.wrapT = RepeatWrapping
		this.texture.repeat.set( x, y )

		this.texturePBR.wrapS = RepeatWrapping
		this.texturePBR.wrapT = RepeatWrapping
		this.texturePBR.repeat.set( x, y )
	}
}

export { PBRCanvas }
