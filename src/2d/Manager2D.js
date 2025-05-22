/**
 * Manage the webGL 2D stage
 * @author David Ronai / @Makio64
 */

import stage2d from '@/makio/2d/Stage2d'
import stage from '@/makio/core/stage'
import * as PIXI from 'pixi.js'
import { animate } from 'animejs'

class Manager2D {
	constructor() {
		this.isHidden = false
		this.isInit = false
	}

	async init() {
		if ( this.isInit ) {
			return
		}
		await stage2d.init()

		stage.onResize.add( () => {
			if( this.circle ) {
				this.circle.x = stage.width / 2
				this.circle.y = stage.height / 2
			}
		} )
		this.isInit = true

	}

	showCircle = async ()=> {
		await this.init()

		if( !this.circle ) {
			this.circle = new PIXI.Graphics()
			this.circle.circle( 0, 0, 50 )
			this.circle.fill( 0xff0000 )
			this.circle.x = stage.width / 2
			this.circle.y = stage.height / 2
			stage2d.add( this.circle )
		}

		animate( this.circle, { alpha: 1 } )
		animate( this.circle.position, { y: [stage.height / 2 - 30, stage.height / 2] }, { duration: 1, ease: 'outQuad' } )
	}

	hideCircle( cb = null ) {
		animate( this.circle, { duration: 1, alpha: 0 } )
		animate( this.circle.position, { duration: 0.7, y: stage.height / 2 + 30, ease: 'outQuad', onComplete: cb } )
	}

	hide = () => {
		animate( stage2d.app.canvas, { opacity: 0, duration: 0.4, onComplete: () => {	stage2d.app.canvas.style.display = 'none'} } )
	}
	show = async () => {
		await this.init()
		stage2d.app.canvas.style.display = 'block'
		animate( stage2d.app.canvas, { opacity: 1, duration: 0.2 } )
	}
}

export default new Manager2D()
