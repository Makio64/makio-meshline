import Signal from '@/makio/core/Signal'

const TIME_STEP = 8
const MAX_DT = 100
const MAX_STEPS = 10

class Stage {
	pause = false
	lastTime = performance.now()
	dtOffset = 0
	width = window.innerWidth
	height = window.innerHeight
	pixelRatio = Math.min( 1.5, window.devicePixelRatio )
	onResize = new Signal()
	onUpdate = new Signal()
	onRender = new Signal()

	constructor() {
		window.addEventListener( 'resize', this.resize )
		window.addEventListener( 'orientationchange', this.resize )
		this.resize()
		requestAnimationFrame( this.update )
	}

	resize = () => {
		this.width = window.innerWidth
		this.height = window.innerHeight
		this.documentHeight = document.documentElement.clientHeight
		this.onResize.dispatch()
	}

	update = () => {
		if ( this.pause )
			return requestAnimationFrame( this.update )

		const now = performance.now()
		let dt = Math.min( now - this.lastTime, MAX_DT )
		this.lastTime = now
		this.dtOffset += dt

		let steps = 0
		while ( this.dtOffset >= TIME_STEP && steps < MAX_STEPS ) {
			this.onUpdate.dispatch( TIME_STEP )
			this.dtOffset -= TIME_STEP
			steps++
		}

		this.onRender.dispatch( this.dtOffset / TIME_STEP )
		requestAnimationFrame( this.update )
	}
}

const stage = new Stage()
export default stage
export { stage, Stage }
