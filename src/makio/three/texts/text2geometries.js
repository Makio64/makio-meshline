import canvas2svg from '../../utils/img/canvas2svg'
import { text2canvas } from '../../utils/img/text2canvas'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import { ExtrudeGeometry, Matrix4, ShapeGeometry } from 'three'

const extrudeSettings = {
	steps: 1,
	depth: 5,
	bevelEnabled: true,
	bevelThickness: 1,
	bevelSize: 1,
	bevelOffset: 1,
	bevelSegments: 1,
}

export default async function text2geometries( text, options ) {
	let { canvas } = await text2canvas( text, options )
	let svg = canvas2svg( canvas )

	let svgParser = new SVGLoader()
	let data = svgParser.parse( svg )
	let geometries = []
	let minX = 100000
	let minY = 100000

	for ( let i = 0; i < data.paths.length; i++ ) {
		const path = data.paths[i]
		if ( path.color.r == 0 ) {
			continue
		}

		const shapes = SVGLoader.createShapes( path )
		for ( let j = 0; j < shapes.length; j++ ) {
			const shape = shapes[j]

			let geometry = options.extrude ? new ExtrudeGeometry( shape, { extrudeSettings, ...options.extrudeSettings } ) : new ShapeGeometry( shape )
			// let geometry = new ExtrudeGeometry(shape, extrudeSettings)
			geometry.applyMatrix4( new Matrix4().makeScale( options.geometryScale, options.geometryScale, options.geometryScale ) )
			geometry.applyMatrix4( new Matrix4().makeRotationX( Math.PI ) )
			geometry.computeBoundingBox()
			minX = Math.min( minX, geometry.boundingBox.min.x )
			minY = Math.min( minY, geometry.boundingBox.min.y )
			geometries.push( geometry )
		}
	}

	for ( let geometry of geometries ) {
		geometry.applyMatrix4( new Matrix4().makeTranslation( -minX, 0, 0 ) )
	}
	return geometries
}
