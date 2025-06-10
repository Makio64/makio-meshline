import { DataTexture, LinearFilter, LinearMipMapLinearFilter, RGBAFormat, Vector2 } from 'three'

export default class TextureAtlas {
	constructor( width, height, renderer ) {
		// Dimensions and Canvas
		this.canvas = document.createElement( 'canvas' )
		this.width = this.canvas.width = width
		this.height = this.canvas.height = height
		this.context = this.canvas.getContext( '2d' )

		// Texture Data
		this.texture = new DataTexture( new Uint8Array( width * height * 4 ), width, height, RGBAFormat )
		this.texture.minFilter = LinearMipMapLinearFilter
		this.texture.magFilter = LinearFilter
		this.texture.anisotropy = 0
		// this.texture.flipY = true
		this.texture.needsUpdate = true

		// Renderer and WebGL
		this.renderer = renderer
		this.renderer.initTexture( this.texture )
		this.webglTexture = this.renderer.properties.get( this.texture ).__webglTexture

		// Positioning
		this.currentX = 0
		this.currentY = 0
		this.rowHeight = 0
		this.ids = {}
	}

	async loadFromJSON( jsonUrl ) {
		const data = await fetch( jsonUrl ).then( ( response ) => response.json() ) // Fetch the JSON file
		const frames = data.frames // Get the frames array

		return new Promise( ( resolve, reject ) => {
			const img = new Image()
			img.src = 'img/' + data.meta.image
			img.onload = () => {
				frames.forEach( ( frame ) => {
					const frameData = frame.frame
					const region = {
						x: frameData.x,
						y: frameData.y,
						width: frameData.w,
						height: frameData.h,
						uvStartX: frameData.x / this.width,
						uvStartY: frameData.y / this.height,
						uvEndX: ( frameData.x + frameData.w ) / this.width,
						uvEndY: ( frameData.y + frameData.h ) / this.height,
					}
					this.ids[frame.filename] = region
					this.updateRegion( img, region )
				} )
				resolve()
			}

			img.onerror = () => {
				reject( 'Failed to load the spritesheet image.' )
			}
		} )
	}

	loadAndAddImage( url ) {
		return new Promise( ( resolve, reject ) => {
			const img = new Image()
			img.onload = () => resolve( this.addImage( img, url ) )
			img.onerror = () => reject( new Error( 'Failed to load the image.' ) )
			img.src = url
		} )
	}

	addImage( img, id = '' ) {
		const nextX = this.currentX + img.width
		const nextY = this.currentY + img.height

		// If the image doesn't fit in the current row, move to the next
		if ( nextX > this.width ) {
			this.currentX = 0
			this.currentY += this.rowHeight
			this.rowHeight = 0
		}

		// If the image doesn't fit at all, return an error
		if ( nextY > this.height ) {
			console.error( 'Texture atlas is full or image is too large!' )
			return null
		}

		const region = {
			x: this.currentX,
			y: this.currentY,
			width: img.width,
			height: img.height,
			uvStartX: this.currentX / this.width,
			uvStartY: this.currentY / this.height,
			uvEndX: ( this.currentX + img.width ) / this.width,
			uvEndY: ( this.currentY + img.height ) / this.height,
		}

		if ( id != '' ) this.ids[id] = region
		this.updateRegion( img, region )

		this.currentX = nextX
		this.rowHeight = Math.max( this.rowHeight, img.height )

		return region
	}

	updateRegion( img, region ) {
		const tempCanvas = document.createElement( 'canvas' )
		const tempContext = tempCanvas.getContext( '2d' )
		tempCanvas.width = region.width
		tempCanvas.height = region.height

		tempContext.drawImage( img, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height )

		const dataTexture = new DataTexture( new Uint8Array( tempContext.getImageData( 0, 0, region.width, region.height ).data.buffer ), region.width, region.height, RGBAFormat )
		this.renderer.copyTextureToTexture( new Vector2( region.x, region.y ), dataTexture, this.texture )
	}
}
