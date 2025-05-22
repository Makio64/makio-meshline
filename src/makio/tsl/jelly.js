// From https://github.com/mrdoob/three.js/blob/master/examples/webgpu_compute_geometry.html
export const pointerPosition = uniform( vec4( 0 ) )
export const elasticity = uniform( .4 ) // elasticity ( how "strong" the spring is )
export const damping = uniform( .94 ) // damping factor ( energy loss )
export const brushSize = uniform( .25 )
export const brushStrength = uniform( .22 )

export const jelly = Fn( ( { renderer, geometry, object } ) => {

	const count = geometry.attributes.position.count

	// replace geometry attributes for storage buffer attributes

	const positionBaseAttribute = geometry.attributes.position
	const positionStorageBufferAttribute = new THREE.StorageBufferAttribute( count, 3 )
	const speedBufferAttribute = new THREE.StorageBufferAttribute( count, 3 )

	geometry.setAttribute( 'storagePosition', positionStorageBufferAttribute )

	// attributes

	const positionAttribute = storage( positionBaseAttribute, 'vec3', count )
	const positionStorageAttribute = storage( positionStorageBufferAttribute, 'vec3', count )

	const speedAttribute = storage( speedBufferAttribute, 'vec3', count )

	// vectors

	const basePosition = positionAttribute.element( instanceIndex )
	const currentPosition = positionStorageAttribute.element( instanceIndex )
	const currentSpeed = speedAttribute.element( instanceIndex )

	//

	const computeInit = Fn( () => {

		// copy position to storage

		currentPosition.assign( basePosition )

	} )().compute( count )

	//

	const computeUpdate = Fn( () => {

		// pinch

		If( pointerPosition.w.equal( 1 ), () => {

			const worldPosition = objectWorldMatrix( object ).mul( currentPosition )

			const dist = worldPosition.distance( pointerPosition.xyz )
			const direction = pointerPosition.xyz.sub( worldPosition ).normalize()

			const power = brushSize.sub( dist ).max( 0 ).mul( brushStrength )

			currentPosition.addAssign( direction.mul( power ) )

		} )

		// compute ( jelly )

		const distance = basePosition.distance( currentPosition )
		const force = elasticity.mul( distance ).mul( basePosition.sub( currentPosition ) )

		currentSpeed.addAssign( force )
		currentSpeed.mulAssign( damping )

		currentPosition.addAssign( currentSpeed )

	} )().compute( count )

	// initialize the storage buffer with the base position

	computeUpdate.onInit( () => renderer.compute( computeInit ) )

	//

	return computeUpdate

} )

export default jelly
