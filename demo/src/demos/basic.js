/**
 * Minimal MeshLine starter: a 64-segment closed circle with a gradient stroke.
 *
 * Key APIs:
 * - `circlePositions( segments, radius )`
 * - `new MeshLine().lines( points, true ).lineWidth().color().gradientColor()`
 * - `.autoResize()` to follow the window size
 */
import { circlePositions, MeshLine } from 'makio-meshline'

import stage3d from '@/makio/three/stage3d'

export default class BasicExample {
	async init() {
		await stage3d.initRender()
		stage3d.orbit( 10 )

		stage3d.add( new MeshLine()
			.lines( circlePositions( 64, 3 ), true )
			.lineWidth( 0.2 )
			.color( 0xff8800 )
			.gradientColor( 0xffffff )
			.autoResize() )
	}
}
