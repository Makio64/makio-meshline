import { Box3, Vector3 } from 'three/webgpu'

/**
 * Robustly centers and scales any 3D model to fit within a target size
 * @param {Object3D} model - The model to center and scale
 * @param {number} targetSize - The desired maximum dimension
 * @returns {Object} - Contains bounds and outerRadius for the model
 */
export function centerAndScaleModel( model, targetSize ) {
	// Reset transforms to get accurate bounds
	model.position.set( 0, 0, 0 )
	model.rotation.set( 0, 0, 0 )
	model.scale.set( 1, 1, 1 )
	model.updateMatrixWorld( true )

	// Calculate bounds of the entire model hierarchy
	const box = new Box3().setFromObject( model )
	const size = box.getSize( new Vector3() )
	const center = box.getCenter( new Vector3() )

	// Scale to fit target size
	const maxDimension = Math.max( size.x, size.y, size.z )
	if ( maxDimension > 0 ) {
		const scale = targetSize / maxDimension
		model.scale.setScalar( scale )
		// Adjust center position for the new scale
		center.multiplyScalar( scale )
	}

	// Center the model at origin
	model.position.sub( center )
	model.updateMatrixWorld( true )

	// Return useful metrics
	const bounds = new Box3().setFromObject( model )
	const finalSize = bounds.getSize( new Vector3() )
	const halfDiagXZ = 0.5 * Math.hypot( finalSize.x, finalSize.z )
	const outerRadius = halfDiagXZ * 1.2

	return {
		bounds,
		outerRadius
	}
}