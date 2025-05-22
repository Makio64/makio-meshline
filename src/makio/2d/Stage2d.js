import { Application, Assets } from 'pixi.js'
import stage from '@/makio/core/stage'

// import 'pixi.js/basis';

// setBasisTranscoderPath( {
// 	jsUrl: 'https://files.pixijs.download/transcoders/basis/basis_transcoder.js',
// 	wasmUrl: 'https://files.pixijs.download/transcoders/basis/basis_transcoder.wasm',
// })

class Stage2d {
	constructor( applicationOptions = {} ) {
		this.isInit = false
		this.initPromise = null
	}

	addChild( obj ) {
		this.stage.addChild( obj )
	}

	removeChild( obj ) {
		this.stage.removeChild( obj )
	}

	add( obj ) {
		this.stage.addChild( obj )
	}

	addChildAt( obj, index ) {
		this.stage.addChildAt( obj, index )
	}

	remove( obj ) {
		this.stage.removeChild( obj )
	}

	init = ( applicationOptions ) => {
		if ( this.initPromise ) return this.initPromise

		this.initPromise = new Promise( ( resolve, reject ) => {
			if ( this.isInit ) {
				resolve( this )
				return
			}

			const initialize = async () => {
				try {
					// Ticker.targetFPMS = 1 / 60

					this.app = new Application()

					await this.app.init( {
						width: stage.width,
						height: stage.height,
						antialias: true,
						backgroundColor: 0x1c005c,
						alpha: false,
						useContextAlpha: false,
						resolution: stage.devicePixelRatio,
						autoDensity: true,
						...applicationOptions,
					} )
					this.isInit = true
					this.app.start()

					// add stats
					// if(isLocal){
					// 	const stats = addStats(document, this.app);
					// 	const ticker = Ticker.shared;
					// 	ticker.add(stats.update, stats, UPDATE_PRIORITY.UTILITY);
					// }
					Assets.setPreferences( {
						preferWorkers: true,
						preferCreateImageBitmap: true,
						crossOrigin: 'Anonymous',
					} )

					this.stage = this.app.stage
					// console.log(this.app)
					this.app.canvas.className = 'pixi'
					document.body.appendChild( this.app.canvas )
					stage.onResize.add( this.resize )
					this.resize()

					resolve( this )
				} catch ( error ) {
					console.error( 'Error initializing Stage2d:', error )
					reject( error )
				}
			}

			initialize()
		} )

		return this.initPromise
	}

	dispose = () => {
		this.app.stop()
		if ( this.app.canvas.parentNode ) {
			document.body.removeChild( this.app.canvas )
		}
	}

	resize = () => {
		this.app.renderer.resize( stage.width, stage.height, stage.devicePixelRatio )
	}
}

export default new Stage2d()
