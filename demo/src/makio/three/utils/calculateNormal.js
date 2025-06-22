import { Vector3 } from 'three'

// flat face normals
const pA = new Vector3()
const pB = new Vector3()
const pC = new Vector3()
const ab = new Vector3()

function calculateNormal( ax, ay, az, bx, by, bz, cx, cy, cz ) {
	pA.set( ax, ay, az )
	pB.set( bx, by, bz )
	pC.set( cx, cy, cz )
	ab.subVectors( pA, pB )
	return pA.subVectors( pC, pB ).cross( ab ).normalize()
}

// gl_FrontFacing is only in the fragment, to avoid it :
// https://stackoverflow.com/questions/24375171/is-there-a-reliable-alternative-to-gl-frontfacing-in-a-fragment-shader
function calculateNormalDoubleSided( ax, ay, az, bx, by, bz, cx, cy, cz, px, py, pz ) {
	let n = calculateNormal( ax, ay, az, bx, by, bz, cx, cy, cz )
	pB.set( px, py, pz )
	if ( n.dot( pB ) > 0 ) {
		n.multiplyScalar( -1 )
	}
	return n
}

export default calculateNormal
export { calculateNormal, calculateNormalDoubleSided }
