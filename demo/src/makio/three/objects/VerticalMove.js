import stage from "@/makio/core/stage"
import stage3d from "@/makio/three/stage3d"
import { Group } from "three"

export default class VerticalMove extends Group {
	constructor( options ) {
		options = { speed: 1, y: 0.1, ...options }
		super()
		this.speed = options.speed
		this.y = options.y
		this.time = 0
		this.update()
		stage.onUpdate.add( this.update )
	}

	update = ( dt )=>{
		if( !stage3d.canMove ) { return }
		this.time += dt
		this.position.y = Math.sin( this.time * 0.002 * this.speed ) * this.y
	}

	dispose() {
		stage.onUpdate.remove( this.update )
	}
}
