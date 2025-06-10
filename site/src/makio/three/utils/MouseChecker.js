import { Raycaster, Vector2, Vector3 } from 'three'
import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'

const ray = new Raycaster()
const mouse = new Vector2()

class MouseChecker {
	constructor( returnNull = true ) {
		this.dummy = returnNull ? null : new Vector3( -9999, -9999, -9999 )
	}

	setMouse( x, y ) {
		mouse.x = ( x / stage.width ) * 2 - 1
		mouse.y = -( y / stage.height ) * 2 + 1
	}

	set x( value ) {
		mouse.x = value
	}

	set y( value ) {
		mouse.x = value
	}

	intersectObject( object, camera = stage3d.camera, full = false ) {
		ray.setFromCamera( mouse, camera )
		let currentVisible = object.visible

		object.visible = true
		const intersects = ray.intersectObject( object )
		object.visible = currentVisible

		if ( full ) {
			return intersects.length > 0 ? intersects[0] : null
		} else {
			return intersects.length > 0 ? intersects[0].point : this.dummy
		}
	}

	intersectObjects( objects, resursive = true, camera = stage3d.camera ) {
		ray.setFromCamera( mouse, camera )
		const intersects = ray.intersectObjects( objects, resursive )
		return intersects.length > 0 ? intersects[0] : this.dummy
	}

	intersect( object, camera ) {
		return this.intersectObject( object, camera )
	}
}

let mouseChecker = new MouseChecker( true )
export default mouseChecker
export { mouseChecker, MouseChecker, mouse, ray }
