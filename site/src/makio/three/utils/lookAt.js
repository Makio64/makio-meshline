// Author : David Ronai / @makio64
import { Vector3 } from 'three'

let v = new Vector3()
// use it as lookAt(yourObject,positionToLookAt(world coordinate))
export default function lookAt( obj, position ) {
	v.copy( position )
	var targetPos = obj.worldToLocal( v )
	var rotationAxis = new Vector3().crossVectors( new Vector3( 0, 0, -1 ), targetPos ).normalize()
	var angle = new Vector3( 0, 0, -1 ).angleTo( targetPos.normalize().clone() )
	obj.rotateOnAxis( rotationAxis, angle )
}
