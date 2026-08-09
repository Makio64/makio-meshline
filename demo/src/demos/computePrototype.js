import { abs, color, cross, dot, float, Fn, instanceIndex, length, max, mix, storage, uint, vec3, vec4, vertexIndex } from 'three/tsl'
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, StorageBufferAttribute } from 'three/webgpu'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const POINT_CAPACITY = 256
const VERTEX_CAPACITY = POINT_CAPACITY * 2
const HALF_WIDTH = 0.42
const MITER_LIMIT = 4

const createPathData = () => {
	const points = new Float32Array( POINT_CAPACITY * 4 )

	for ( let i = 0; i < POINT_CAPACITY; i++ ) {
		const progress = i / ( POINT_CAPACITY - 1 )
		const angle = progress * Math.PI * 3.5
		const offset = i * 4

		points[offset] = ( progress - 0.5 ) * 20
		points[offset + 1] = Math.sin( progress * Math.PI * 2 ) * 0.35
		points[offset + 2] = Math.sin( angle ) * 2.6 + Math.sin( angle * 0.43 ) * 0.7
		points[offset + 3] = 1
	}

	return points
}

const createRibbonIndices = () => {
	const indices = new Uint16Array( ( POINT_CAPACITY - 1 ) * 6 )

	for ( let i = 0; i < POINT_CAPACITY - 1; i++ ) {
		const vertex = i * 2
		const offset = i * 6

		indices[offset] = vertex
		indices[offset + 1] = vertex + 1
		indices[offset + 2] = vertex + 2
		indices[offset + 3] = vertex + 2
		indices[offset + 4] = vertex + 1
		indices[offset + 5] = vertex + 3
	}

	return indices
}

class ComputePrototypeExample {
	constructor() {
		this.mesh = null
		this.geometry = null
		this.material = null
		this.computeNode = null
		this.storageAttributes = []
		this.metrics = null
		this.control = null
	}

	async init() {
		this.metrics = {
			pointCount: POINT_CAPACITY,
			vertexCount: VERTEX_CAPACITY,
			dispatchCount: 0,
			backend: 'initializing',
			ready: false,
			error: null,
		}
		window.__meshLineComputeMetrics = this.metrics

		try {
			await stage3d.initRender( { background: 0x071018 } )

			const isNativeWebGPU = stage3d.renderer?.backend?.isWebGPUBackend === true
			this.metrics.backend = isNativeWebGPU ? 'webgpu' : 'webgl2'

			if ( !isNativeWebGPU ) {
				this.metrics.error = 'Native WebGPU is unavailable; the compute accelerator proof was skipped.'
				console.warn( `[computePrototype] ${this.metrics.error}` )
				return
			}

			this.control = new OrbitControl( stage3d.camera, 17 )
			this.control.minRadius = 8
			this.control.maxRadius = 30
			this.control._phi = 0.95
			this.control._theta = 0.85
			this.control.update()
			stage3d.control = this.control

			this.createRibbon()
			await stage3d.renderer.computeAsync( this.computeNode )
			this.metrics.dispatchCount++
			stage3d.add( this.mesh )
			this.metrics.ready = true
		} catch ( error ) {
			if ( this.metrics.backend === 'initializing' ) this.metrics.backend = 'unavailable'
			this.metrics.error = error instanceof Error ? error.message : String( error )
			console.error( '[computePrototype] Failed to initialize:', error )
		}
	}

	createRibbon() {
		// This is an accelerator feasibility proof for a fixed-up world-space ribbon.
		// It intentionally does not replace the camera-facing vertex expansion needed
		// for deformation-free screen-space MeshLine joins at every viewing angle.
		// Explicit vec4 records avoid implicit vec3 storage-array padding when the
		// generated buffers are rebound as vertex attributes after compute.
		const pointAttribute = new StorageBufferAttribute( createPathData(), 4 )
		const positionAttribute = new StorageBufferAttribute( VERTEX_CAPACITY, 4 )
		this.storageAttributes = [pointAttribute, positionAttribute]

		const points = storage( pointAttribute, 'vec4', POINT_CAPACITY ).toReadOnly()
		const positions = storage( positionAttribute, 'vec4', VERTEX_CAPACITY )

		this.computeNode = Fn( () => {
			const pointIndex = instanceIndex.toUint()
			const isFirstPoint = pointIndex.equal( uint( 0 ) )
			const isLastPoint = pointIndex.equal( uint( POINT_CAPACITY - 1 ) )
			const previousIndex = isFirstPoint.select( uint( 0 ), pointIndex.sub( uint( 1 ) ) )
			const nextIndex = isLastPoint.select( uint( POINT_CAPACITY - 1 ), pointIndex.add( uint( 1 ) ) )

			const point = points.element( pointIndex ).xyz
			const previousPoint = points.element( previousIndex ).xyz
			const nextPoint = points.element( nextIndex ).xyz
			const incomingVector = isFirstPoint.select( nextPoint.sub( point ), point.sub( previousPoint ) )
			const outgoingVector = isLastPoint.select( point.sub( previousPoint ), nextPoint.sub( point ) )
			const incoming = incomingVector.normalize()
			const outgoing = outgoingVector.normalize()

			const fixedUp = vec3( 0, 1, 0 )
			const fallbackUp = vec3( 1, 0, 0 )
			const incomingUp = incoming.y.abs().greaterThan( 0.999 ).select( fallbackUp, fixedUp )
			const outgoingUp = outgoing.y.abs().greaterThan( 0.999 ).select( fallbackUp, fixedUp )
			const incomingSide = cross( incomingUp, incoming ).normalize()
			const outgoingSide = cross( outgoingUp, outgoing ).normalize()
			const miterSum = incomingSide.add( outgoingSide )
			const miterLength = length( miterSum )
			const miter = miterLength.greaterThan( 0.00001 ).select(
				miterSum.div( max( miterLength, 0.00001 ) ),
				outgoingSide,
			)
			const miterDenominator = max( abs( dot( miter, outgoingSide ) ), 1 / MITER_LIMIT )
			const miterScale = float( HALF_WIDTH ).div( miterDenominator )
			const vertexIndex = pointIndex.mul( uint( 2 ) )
			const negativeOffset = miter.mul( miterScale ).negate()
			const positiveOffset = miter.mul( miterScale )

			positions.element( vertexIndex ).assign( vec4( point.add( negativeOffset ), 1 ) )
			positions.element( vertexIndex.add( uint( 1 ) ) ).assign( vec4( point.add( positiveOffset ), 1 ) )
		} )().compute( POINT_CAPACITY )

		this.geometry = new BufferGeometry()
		// Reuse the compute output as the geometry's vertex-capacity attribute. It is
		// already STORAGE|VERTEX capable, so a duplicate CPU placeholder is unnecessary.
		// CPU bounds and raycasting remain deliberately out of scope.
		this.geometry.setAttribute( 'position', positionAttribute )
		this.geometry.setIndex( new BufferAttribute( createRibbonIndices(), 1 ) )

		const generatedPosition = positions.toAttribute().xyz
		const generatedSide = float( vertexIndex.bitAnd( uint( 1 ) ) )
		this.material = new MeshBasicNodeMaterial( { side: DoubleSide } )
		this.material.positionNode = generatedPosition
		this.material.colorNode = mix( color( 0x2563eb ), color( 0x22d3ee ), generatedSide )

		this.mesh = new Mesh( this.geometry, this.material )
		this.mesh.frustumCulled = false
	}

	dispose() {
		if ( this.mesh ) stage3d.remove( this.mesh )
		this.computeNode?.dispose()
		this.geometry?.dispose()
		this.material?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.mesh = null
		this.geometry = null
		this.material = null
		this.computeNode = null
		this.storageAttributes = []
		this.control = null
		if ( this.metrics ) this.metrics.ready = false
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new ComputePrototypeExample()
