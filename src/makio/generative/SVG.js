// SVG Helper by @makio64 | david.ronai
// Helper to draw SVG with JS

import { string2dom } from '../utils/string2dom'
import { distance, mix } from '../utils/math'

export default class SVG {
	constructor( width = 100, height = 100 ) {
		this.width = width
		this.height = height
		this.instructions = []
		this.length = 0
		this.lengthNeedsUpdate = false
		this.color = 'black'
		this.fillColor = 'none'
		this.strokeWidth = 3
	}

	clear() {
		this.instructions = []
	}

	//---------------------------------------------------------------- Instructions

	open() {
		this.instructions.push( { type: 'open', color: this.color } )
	}

	close() {
		this.instructions.push( { type: 'close', color: this.color } )
	}

	moveTo( x, y ) {
		this.instructions.push( { type: 'moveTo', x: x, y: y, color: this.color } )
	}

	lineTo( x, y ) {
		this.lengthNeedsUpdate = true
		this.instructions.push( { type: 'lineTo', x: x, y: y, color: this.color } )
	}

	circle( radius, x = null, y = null ) {
		this.lengthNeedsUpdate = true
		this.instructions.push( { type: 'circle', x: x, y: y, radius: radius, color: this.color } )
	}

	rect( x, y, width, height ) {
		this.lengthNeedsUpdate = true
		this.instructions.push( { type: 'rect', x: x, y: y, width: width, height: height, color: this.color } )
	}

	catmull( curve, points, closed, xOffset = 0, yOffset = 0, scale = 1 ) {
		this.lengthNeedsUpdate = true
		let p0 = curve.getPoint( 0 )
		this.moveTo( xOffset + p0.x * scale, yOffset + p0.y * scale )
		for ( let i = 0; i < points; i++ ) {
			let p = curve.getPoint( i / ( points - 1 ) )
			this.lineTo( xOffset + p.x * scale, yOffset + p.y * scale )
		}
		// if(closed){
		// 	this.lineTo(xOffset+p0.x,yOffset+p0.y)
		// }
	}

	//---------------------------------------------------------------- Convert

	setLineColor( color ) {
		this.color = color
	}

	drawOnCanvas( ctx ) {}

	// TODO complete it
	// only read moveTo/lineTo for the moment
	getLength() {
		if ( this.lengthNeedsUpdate ) {
			this.lengthNeedsUpdate = false
			let length = 0
			let x = 0
			let y = 0
			for ( let i = 0; i < this.instructions.length; i++ ) {
				let int = this.instructions[i]
				switch ( int.type ) {
					case 'lineTo': {
						length += distance( x, y, int.x, int.y )
						x = int.x
						y = int.y
						break
					}
					case 'moveTo': {
						x = int.x
						y = int.y
						break
					}
				}
			}
			this.length = length
		}
		return this.length
	}

	pointAt( percent ) {
		const lengthTotal = this.getLength()
		const lengthSearch = percent * lengthTotal

		let length = 0
		let x = 0
		let y = 0
		for ( let i = 0; i < this.instructions.length; i++ ) {
			let int = this.instructions[i]
			switch ( int.type ) {
				case 'lineTo': {
					let d = distance( x, y, int.x, int.y )
					if ( d + length >= lengthSearch ) {
						let p = ( lengthSearch - length ) / d
						let finalX = mix( x, int.x, p )
						let finalY = mix( y, int.y, p )
						return { x: finalX, y: finalY }
					} else {
						length += d
					}
					x = int.x
					y = int.y
					break
				}
				case 'moveTo': {
					x = int.x
					y = int.y
					break
				}
			}
		}

		return { x: x, y: y }
	}

	//---------------------------------------------------------------- Export as svg

	toDom() {
		return string2dom( this.toString() )
	}

	toString() {
		let pathOpen = false
		let s = `<svg viewBox="0 0 ${this.width} ${this.height}" width="${this.width}" height="${this.height}" xmlns="http://www.w3.org/2000/svg">\n`

		const openPath = () => {
			if ( !pathOpen ) {
				s += '<path d="'
				pathOpen = true
			}
		}

		const closePath = ( color ) => {
			if ( pathOpen ) {
				s += `" fill="${this.fillColor}" stroke="${color}" stroke-width="${this.strokeWidth}" stroke-alignment="inner" />\n`
				pathOpen = false
			}
		}

		let int = null
		for ( let i = 0; i < this.instructions.length; i++ ) {
			int = this.instructions[i]
			switch ( int.type ) {
				case 'open': {
					openPath( int.color )
					break
				}
				case 'close': {
					closePath( int.color )
					break
				}
				case 'moveTo': {
					openPath()
					s += `M ${int.x} ${int.y + 0.5} `
					break
				}
				case 'lineTo': {
					openPath()
					s += `L ${int.x} ${int.y + 0.5} `
					break
				}

				case 'circle': {
					closePath( int.color )
					s += `<circle cx="${int.x}" cy="${int.y}" r="${int.radius}" fill="none" stroke="${int.color}" stroke-width="1" stroke-alignment="inner" />\n`
					break
				}

				case 'rect': {
					closePath( int.color )
					s += `<rect x="${int.x}" y="${int.y}" width="${int.width}" height="${int.height}" fill="none" stroke="${int.color}" stroke-width="1" stroke-alignment="inner" />\n`
					break
				}

				default: {
					break
				}
			}
		}
		closePath( int.color )
		s += '</svg>'
		return s
	}
}
