import { MeshLineBillboard } from './MeshLineBillboard.js'
import MeshLineSurfaceGeometry from './MeshLineSurfaceGeometry.js'
import MeshLineSurfaceNodeMaterial from './MeshLineSurfaceNodeMaterial.js'

/**
 * High-level facade for creating GPU-rendered lines in Three.js.
 * Extends `THREE.Mesh` and provides a fluent/chainable API for configuring
 * geometry, material, hooks, and instancing in a single call chain.
 *
 * Everything but the world-space surface profile lives in `MeshLineBillboard`,
 * which this class extends with `surface()` for roads, tracks and ribbons.
 *
 * @example
 * const line = new MeshLine()
 *   .lines( circlePositions( 64 ), true )
 *   .color( 0xff6600 )
 *   .lineWidth( 0.4 )
 *   .build()
 * scene.add( line )
 */
export default class MeshLine extends MeshLineBillboard {

	static surfaceProfile = { Geometry: MeshLineSurfaceGeometry, Material: MeshLineSurfaceNodeMaterial }

}
