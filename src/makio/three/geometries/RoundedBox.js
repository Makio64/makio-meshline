import { Shape, ExtrudeGeometry } from 'three'

export default class RoundedBox extends ExtrudeGeometry {
	constructor( width, height, depth, radius, curveSegments = 4 ) {
		const shape = new Shape()
		const x = -width / 2, y = -height / 2

		shape.moveTo( x + radius, y )
		shape.lineTo( x + width - radius, y )
		shape.quadraticCurveTo( x + width, y, x + width, y + radius )
		shape.lineTo( x + width, y + height - radius )
		shape.quadraticCurveTo( x + width, y + height, x + width - radius, y + height )
		shape.lineTo( x + radius, y + height )
		shape.quadraticCurveTo( x, y + height, x, y + height - radius )
		shape.lineTo( x, y + radius )
		shape.quadraticCurveTo( x, y, x + radius, y )

		const extrudeSettings = { depth: depth, bevelEnabled: false, curveSegments: curveSegments }
		super( shape, extrudeSettings )
	}
}
