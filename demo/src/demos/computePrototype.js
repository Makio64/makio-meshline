import { MeshLine } from 'makio-meshline'
import { abs, color, cross, dot, float, Fn, instanceIndex, length, max, min, mix, storage, uint, vec3, vec4, vertexIndex } from 'three/tsl'
import { BufferAttribute, BufferGeometry, DoubleSide, HemisphereLight, Mesh, MeshBasicNodeMaterial, StorageBufferAttribute } from 'three/webgpu'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const POINT_CAPACITY = 256
const VERTEX_CAPACITY = POINT_CAPACITY * 2
const HALF_WIDTH = 0.42
const MITER_LIMIT = 4
const PROFILE_OFFSET = 1.2

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
		this.text = 'Compute-fed MeshLine (upper) · fixed-up ribbon (lower)'
		this.line = null
		this.ribbon = null
		this.ribbonGeometry = null
		this.ribbonMaterial = null
		this.computeNode = null
		this.storageAttributes = []
		this.metrics = null
		this.control = null
		this.fallbackLight = null
	}

	async init() {
		this.metrics = {
			pointCount: POINT_CAPACITY,
			vertexCount: VERTEX_CAPACITY,
			lineVertexCount: VERTEX_CAPACITY,
			ribbonVertexCount: VERTEX_CAPACITY,
			renderedVertexCount: VERTEX_CAPACITY * 2,
			profiles: ['screen-line', 'world-ribbon'],
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
			this.control = new OrbitControl( stage3d.camera, 17 )
			this.control.minRadius = 8
			this.control.maxRadius = 30
			this.control._phi = 0.95
			this.control._theta = 0.85
			this.control.update()
			stage3d.control = this.control

			if ( !isNativeWebGPU ) {
				this.createCPUFallbackProfiles()
				stage3d.add( this.line )
				stage3d.add( this.ribbon )
				this.metrics.ready = true
				this.text = 'WebGL2 fallback · CPU MeshLine screen stroke (upper) · CPU world-space surface (lower)'
				return
			}

			this.createProfiles()
			await stage3d.renderer.computeAsync( this.computeNode )
			this.metrics.dispatchCount++
			stage3d.add( this.line )
			stage3d.add( this.ribbon )
			this.metrics.ready = true
		} catch ( error ) {
			if ( this.metrics.backend === 'initializing' ) this.metrics.backend = 'unavailable'
			this.metrics.error = error instanceof Error ? error.message : String( error )
			console.error( '[computePrototype] Failed to initialize:', error )
		}
	}

	createCPUFallbackProfiles() {
		const source = createPathData()
		const upper = new Float32Array( POINT_CAPACITY * 3 )
		const lower = new Float32Array( POINT_CAPACITY * 3 )

		for ( let pointIndex = 0; pointIndex < POINT_CAPACITY; pointIndex++ ) {
			const sourceOffset = pointIndex * 4
			const targetOffset = pointIndex * 3
			upper[targetOffset] = lower[targetOffset] = source[sourceOffset]
			upper[targetOffset + 1] = source[sourceOffset + 1] + PROFILE_OFFSET
			lower[targetOffset + 1] = source[sourceOffset + 1] - PROFILE_OFFSET
			upper[targetOffset + 2] = lower[targetOffset + 2] = source[sourceOffset + 2]
		}

		this.line = new MeshLine()
			.lines( upper )
			.sizeAttenuation( false )
			.lineWidth( 7 )
			.color( 0xfacc15 )
			.autoResize()
			.build()

		this.ribbon = new MeshLine()
			.lines( lower )
			.lineWidth( HALF_WIDTH * 2 )
			.color( 0x22d3ee )
			.surface( { frame: 'fixed-up', up: [0, 1, 0], roughness: 0.82 } )
			.build()

		this.fallbackLight = new HemisphereLight( 0xdbeafe, 0x111827, 2.5 )
		stage3d.add( this.fallbackLight )
	}

	createProfiles() {
		// One dispatch feeds both V2 profiles. The compute pass can prepare a shared
		// centerline, but camera-facing expansion must remain in MeshLine's draw stage
		// because it depends on the active camera. The lower profile also proves that
		// fixed-up world-space ribbon positions can be expanded ahead of the draw.
		// Explicit vec4 records avoid implicit vec3 storage-array padding when the
		// generated buffers are rebound as vertex attributes after compute.
		const pointAttribute = new StorageBufferAttribute( createPathData(), 4 )
		const linePositionAttribute = new StorageBufferAttribute( POINT_CAPACITY, 4 )
		const ribbonPositionAttribute = new StorageBufferAttribute( VERTEX_CAPACITY, 4 )
		this.storageAttributes = [pointAttribute, linePositionAttribute, ribbonPositionAttribute]

		const points = storage( pointAttribute, 'vec4', POINT_CAPACITY ).toReadOnly()
		const linePositions = storage( linePositionAttribute, 'vec4', POINT_CAPACITY )
		const renderedLinePositions = storage( linePositionAttribute, 'vec4', POINT_CAPACITY ).toReadOnly()
		const ribbonPositions = storage( ribbonPositionAttribute, 'vec4', VERTEX_CAPACITY )

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
			const linePoint = point.add( vec3( 0, PROFILE_OFFSET, 0 ) )
			const ribbonPoint = point.sub( vec3( 0, PROFILE_OFFSET, 0 ) )

			linePositions.element( pointIndex ).assign( vec4( linePoint, 1 ) )
			ribbonPositions.element( vertexIndex ).assign( vec4( ribbonPoint.add( negativeOffset ), 1 ) )
			ribbonPositions.element( vertexIndex.add( uint( 1 ) ) ).assign( vec4( ribbonPoint.add( positiveOffset ), 1 ) )
		} )().compute( POINT_CAPACITY )

		const computedLinePosition = Fn( ( [progress] ) => {
			const pointIndex = min( progress.mul( POINT_CAPACITY - 1 ).round().toUint(), uint( POINT_CAPACITY - 1 ) )
			return renderedLinePositions.element( pointIndex ).xyz
		} )
		// Keep one luminance along the stroke so MSAA edge coverage reads as one
		// consistent width instead of changing visually with a color gradient.
		this.line = new MeshLine()
			.segments( POINT_CAPACITY - 1 )
			.gpuPositionNode( computedLinePosition )
			.sizeAttenuation( false )
			.lineWidth( 7 )
			.color( 0xfacc15 )
			.autoResize()
			.build()

		this.ribbonGeometry = new BufferGeometry()
		// Reuse the compute output as the geometry's vertex-capacity attribute. It is
		// already STORAGE|VERTEX capable, so a duplicate CPU placeholder is unnecessary.
		// CPU bounds and raycasting remain deliberately out of scope.
		this.ribbonGeometry.setAttribute( 'position', ribbonPositionAttribute )
		this.ribbonGeometry.setIndex( new BufferAttribute( createRibbonIndices(), 1 ) )

		const generatedPosition = ribbonPositions.toAttribute().xyz
		const generatedSide = float( vertexIndex.bitAnd( uint( 1 ) ) )
		this.ribbonMaterial = new MeshBasicNodeMaterial( { side: DoubleSide } )
		this.ribbonMaterial.positionNode = generatedPosition
		this.ribbonMaterial.colorNode = mix( color( 0x2563eb ), color( 0x22d3ee ), generatedSide )

		this.ribbon = new Mesh( this.ribbonGeometry, this.ribbonMaterial )
		this.ribbon.frustumCulled = false
	}

	dispose() {
		if ( this.line ) stage3d.remove( this.line )
		if ( this.ribbon ) stage3d.remove( this.ribbon )
		this.computeNode?.dispose()
		this.line?.dispose()
		this.ribbon?.dispose?.()
		this.ribbonGeometry?.dispose()
		this.ribbonMaterial?.dispose()
		if ( this.fallbackLight ) {
			stage3d.remove( this.fallbackLight )
			this.fallbackLight.dispose()
		}
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.line = null
		this.ribbon = null
		this.ribbonGeometry = null
		this.ribbonMaterial = null
		this.computeNode = null
		this.storageAttributes = []
		this.control = null
		this.fallbackLight = null
		if ( this.metrics ) this.metrics.ready = false
	}

}

export default ComputePrototypeExample
