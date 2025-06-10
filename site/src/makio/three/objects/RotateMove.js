import stage from "@/makio/core/stage"
import { Group } from "three"
import { mouse, onDown, onUp } from "@/makio/utils/input/mouse"

export default class RotateMove extends Group {
	constructor( options = { speed: 1, rotationSpeed: 0.001 } ) {
		super()
		this.speed = options.speed
		this.rotationSpeed = options.rotationSpeed
		this.direction = -1 // Default direction (left)
		this.dragStartX = 0

		// Listen to mouse events
		onDown.add( this.startDrag )
		onUp.add( this.endDrag )
		stage.onUpdate.add( this.update )
		this.update( 1 / 60 )
	}

	startDrag = () => {
		this.dragStartX = mouse.x
	}

	endDrag = () => {
		const moveX = mouse.x - this.dragStartX
		if ( Math.abs( moveX ) > 5 ) { // threshold to avoid tiny movements
			this.direction = Math.sign( moveX )
		}
	}

	update = ( dt = 16 ) => {
		this.rotation.y += this.rotationSpeed * this.speed * this.direction * ( dt / 16 )
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		onDown.remove( this.startDrag )
		onUp.remove( this.endDrag )
	}
}
