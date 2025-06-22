import { Mesh } from 'three'

function findMesh( object3d ) {
	if ( object3d instanceof Mesh ) {
		return object3d
	}
	for ( let c of object3d.children ) {
		if ( c.children ) {
			let m = findMesh( c )
			if ( m ) {
				return m
			}
		}
	}
	return null
}

export default findMesh
