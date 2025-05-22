import webworkerImageLoad from './webworkerImageLoad'
import Signal from '../../core/Signal'
import { isMobile } from '../detect'

// Use for better performance than using img when it will be rasterize
export default class CanvasImage {
	constructor( width = 1, height = 1, src = null ) {
		this._width = width
		this._height = height
		this.canvaxws = document.createElement( 'canvas' )

		if ( window.devicePixelRatio > 1 && isMobile ) {
			this.canvas.width = width * window.devicePixelRatio
			this.canvas.height = height * window.devicePixelRatio
			this.canvas.style.width = width + 'px'
			this.canvas.style.height = height + 'px'
		} else {
			this.canvas.width = width
			this.canvas.height = height
		}

		if ( src ) {
			this.load( src )
		}

		this.loading = false
		this.position = { x: 0, y: 0 }
		this.domElement = this.canvas
		this.onLoad = new Signal()
	}

	useCanvas( canvas ) {
		this.decodeCanvas = canvas
		this._width = canvas.width
		this._height = canvas.height
		this.loaded = true
		this.onLoad.dispatch()
	}

	load( src ) {
		if ( this.loading ) {
			return
		}
		this.loading = true
		if ( window.createImageBitmap != undefined && window.Worker != undefined && window.requestIdleCallback != undefined ) {
			webworkerImageLoad( src ).then( ( data ) => {
				this.decodeCanvas = document.createElement( 'canvas' )
				this.decodeCanvas.width = this._width = data.bitmap.width
				this.decodeCanvas.height = this._height = data.bitmap.height
				requestIdleCallback(
					() => {
						this.decodeCanvas.getContext( '2d' ).drawImage( data.bitmap, 0, 0 )
						requestIdleCallback(
							() => {
								this.resize( this._width, this._height )
								this.loaded = true
								this.onLoad.dispatch()
							},
							{ timeout: 100 },
						)
					},
					{ timeout: 200 },
				)
			} )
		} else {
			let image = new Image()
			image.onload = () => {
				// this.images[ id ] = image
				this.decodeCanvas = document.createElement( 'canvas' )
				this.decodeCanvas.width = this._width = image.width
				this.decodeCanvas.height = this._height = image.height
				this.decodeCanvas.getContext( '2d' ).drawImage( image, 0, 0 )
				this.resize( this._width, this._height )
				this.loaded = true
				this.onLoad.dispatch()
			}
			image.src = src
		}
	}

	resize( width, height ) {
		if ( window.devicePixelRatio > 1 ) {
			this._width = this.canvas.width = width * window.devicePixelRatio
			this._height = this.canvas.height = height * window.devicePixelRatio
			this.canvas.style.width = width + 'px'
			this.canvas.style.height = height + 'px'
		} else {
			this._width = this.canvas.width = width
			this._height = this.canvas.height = height
		}

		if ( !this.ctx ) {
			this.ctx = this.canvas.getContext( '2d' )
		}
		this.ctx.drawImage( this.decodeCanvas, 0, 0, this._width, this._height )
	}

	get width() {
		return this._width
	}
	get height() {
		return this._height
	}
}
