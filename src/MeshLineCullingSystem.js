import {
	abs,
	atomicAdd,
	atomicStore,
	bool,
	dot,
	Fn,
	If,
	instanceIndex,
	Loop,
	min,
	storage,
	uint,
	uniformArray,
} from 'three/tsl'
import {
	Frustum,
	IndirectStorageBufferAttribute,
	Matrix4,
	NormalBlending,
	StorageBufferAttribute,
	Vector4,
} from 'three/webgpu'

const DEFAULT_CHUNK_SIZE = 128
const DEFAULT_MAX_CHUNKS = 65_536
const DEFAULT_MAX_INDICES = 16_777_216
const DEFAULT_MIN_CHUNKS = 128
const DEFAULT_MIN_INDICES = 1_000_000
const INDIRECT_WORDS = 5
const UINT32_MAX = 0xffffffff

const systems = new WeakMap()
const attachedLines = new WeakMap()
const sceneHookLink = Symbol( 'MeshLineCullingSystem.sceneHookLink' )
const passthroughSnapshot = Object.freeze( { passthrough: true } )

const isObject = value => value !== null && ( typeof value === 'object' || typeof value === 'function' )

const finitePositiveInteger = ( value, fallback ) => {
	const number = Number( value )
	return Number.isSafeInteger( number ) && number > 0 ? number : fallback
}

const finiteNonNegativeInteger = ( value, fallback ) => {
	const number = Number( value )
	return Number.isSafeInteger( number ) && number >= 0 ? number : fallback
}

const normalizeMode = mode => String( mode ?? 'auto' ).toLowerCase() === 'webgpu' ? 'webgpu' : 'auto'
const normalizeFallback = fallback => String( fallback ?? 'draw-all' ).toLowerCase() === 'cpu' ? 'cpu' : 'draw-all'

const getIndex = geometry => typeof geometry?.getIndex === 'function' ? geometry.getIndex() : geometry?.index ?? null
const getIndirect = geometry => typeof geometry?.getIndirect === 'function' ? geometry.getIndirect() : geometry?.indirect ?? null

const setIndex = ( geometry, index ) => {
	if ( typeof geometry?.setIndex === 'function' ) geometry.setIndex( index )
	else if ( geometry ) geometry.index = index
}

const setIndirect = ( geometry, indirect, offset = 0 ) => {
	if ( typeof geometry?.setIndirect === 'function' ) geometry.setIndirect( indirect, offset )
	else if ( geometry ) {
		geometry.indirect = indirect
		geometry.indirectOffset = offset
	}
}

const unlinkOwnedHook = ( current, owned, replacement ) => {
	if ( current === owned ) return replacement
	const visited = new Set()
	let hook = current
	while ( typeof hook === 'function' && !visited.has( hook ) ) {
		visited.add( hook )
		const link = hook[sceneHookLink]
		if ( !link ) break
		if ( link.previous === owned ) {
			link.previous = replacement
			break
		}
		hook = link.previous
	}
	return current
}

const getInstanceCount = object => {
	if ( object?.geometry?.isInstancedBufferGeometry === true ) return object.geometry.instanceCount
	return object?.count === undefined ? 1 : object.count
}

const isFullDrawRange = ( geometry, indexCount ) => {
	const range = geometry?.drawRange
	if ( !range ) return true
	if ( range.start !== 0 ) return false
	return range.count === Infinity || range.count >= indexCount
}

const isOpaqueMaterial = material => {
	if ( !material || Array.isArray( material ) ) return false
	if ( material.transparent === true || Number( material.transmission ?? 0 ) > 0 ) return false
	if ( material.depthTest === false || material.depthWrite === false || material.wireframe === true ) return false
	return material.blending === undefined || material.blending === NormalBlending
}

const readBoundsEntry = entry => {
	if ( entry?.isBox3 === true || ( entry?.min && entry?.max ) ) {
		return [entry.min.x, entry.min.y, entry.min.z, entry.max.x, entry.max.y, entry.max.z]
	}
	if ( entry && typeof entry.length === 'number' && entry.length >= 6 ) {
		return [entry[0], entry[1], entry[2], entry[3], entry[4], entry[5]]
	}
	return null
}

const readPadding = ( value, target ) => {
	if ( value == null ) {
		target[0] = target[1] = target[2] = 0
		return target
	}
	if ( Number.isFinite( Number( value ) ) ) {
		const scalar = Math.max( 0, Number( value ) )
		target[0] = target[1] = target[2] = scalar
		return target
	}
	if ( value?.isVector3 === true || ( value && 'x' in value && 'y' in value && 'z' in value ) ) {
		const x = Number( value.x ), y = Number( value.y ), z = Number( value.z )
		if ( ![x, y, z].every( Number.isFinite ) ) return null
		target[0] = Math.max( 0, x )
		target[1] = Math.max( 0, y )
		target[2] = Math.max( 0, z )
		return target
	}
	if ( value && typeof value.length === 'number' && value.length >= 3 ) {
		const x = Number( value[0] ), y = Number( value[1] ), z = Number( value[2] )
		if ( ![x, y, z].every( Number.isFinite ) ) return null
		target[0] = Math.max( 0, x )
		target[1] = Math.max( 0, y )
		target[2] = Math.max( 0, z )
		return target
	}
	return null
}

const paddingEquals = ( left, right ) => !!left && !!right && left[0] === right[0] && left[1] === right[1] && left[2] === right[2]

const getExplicitBoundsEntry = ( bounds, context, chunkCount ) => {
	if ( typeof bounds === 'function' ) return readBoundsEntry( bounds( context ) )
	if ( ArrayBuffer.isView( bounds ) || ( Array.isArray( bounds ) && typeof bounds[0] === 'number' ) ) {
		if ( bounds.length < chunkCount * 6 ) return null
		const offset = context.chunkIndex * 6
		return readBoundsEntry( bounds.subarray ? bounds.subarray( offset, offset + 6 ) : bounds.slice( offset, offset + 6 ) )
	}
	if ( Array.isArray( bounds ) ) return readBoundsEntry( bounds[context.chunkIndex] )
	return null
}

const createIndexCopy = index => {
	if ( !index?.array || !Number.isSafeInteger( index.count ) || index.count <= 0 ) return null
	const copy = new Uint32Array( index.count )
	for ( let i = 0; i < index.count; i++ ) {
		const value = Number( index.array[i] )
		if ( !Number.isInteger( value ) || value < 0 || value > UINT32_MAX ) return null
		copy[i] = value
	}
	return copy
}

const appendChunkedRange = ( chunks, start, count, maxIndices ) => {
	if ( !Number.isSafeInteger( start ) || !Number.isSafeInteger( count ) || start < 0 || count < 0 || count % 3 !== 0 ) return false
	for ( let offset = 0; offset < count; offset += maxIndices ) {
		const chunkCount = Math.min( maxIndices, count - offset )
		chunks.push( [start + offset, chunkCount] )
	}
	return true
}

const createChunkRanges = ( geometry, indexCount, chunkTriangles ) => {
	const maxIndices = chunkTriangles * 3
	const chunks = []
	const surfaceRanges = geometry?._lineRanges

	if ( Array.isArray( surfaceRanges ) && surfaceRanges.length > 0 ) {
		let covered = 0
		for ( const range of surfaceRanges ) {
			if ( !appendChunkedRange( chunks, range.indexStart, range.indexCount, maxIndices ) ) return null
			covered += range.indexCount
		}
		if ( covered === indexCount ) return chunks
		chunks.length = 0
	}

	const lines = geometry?._lines
	if ( Array.isArray( lines ) && lines.length > 0 && geometry?.isMeshLine === true ) {
		let indexStart = 0
		for ( const line of lines ) {
			const pointCount = Number( line?.length ?? 0 ) / 3
			const count = Math.max( 0, pointCount - 1 ) * 6
			if ( !Number.isSafeInteger( count ) || !appendChunkedRange( chunks, indexStart, count, maxIndices ) ) return null
			indexStart += count
		}
		if ( indexStart === indexCount ) return chunks
		chunks.length = 0
	}

	if ( !appendChunkedRange( chunks, 0, indexCount, maxIndices ) ) return null
	return chunks
}

const hasDeformationHooks = source => !!source && !!(
	source.gpuPositionNode ||
	source.positionFn ||
	source.previousFn ||
	source.nextFn ||
	source.widthFn ||
	source.normalFn ||
	source.vertexFn
)

const hasUnboundedVertexDeformation = object => {
	const geometry = object?.geometry
	const material = object?.material
	if ( hasDeformationHooks( geometry?.options ) || hasDeformationHooks( object?._options ) ) return true
	if ( hasDeformationHooks( material?.options ) || hasDeformationHooks( material ) ) return true
	if ( material?.positionNode || material?.displacementNode || material?.displacementMap ) return true
	if ( material?.vertexNode && material.isMeshLineNodeMaterial !== true ) return true
	if ( object?.isSkinnedMesh === true || object?.isBatchedMesh === true ) return true
	return Array.isArray( geometry?.morphAttributes?.position ) && geometry.morphAttributes.position.length > 0
}

const hasBundleAncestor = object => {
	for ( let parent = object?.parent; parent; parent = parent.parent ) {
		if ( parent.isBundleGroup === true ) return true
	}
	return false
}

const getWorldPadding = ( object, hasExplicitBounds, explicitWorldPadding ) => {
	if ( hasExplicitBounds ) {
		const padding = Number( explicitWorldPadding ?? 0 )
		return Number.isFinite( padding ) && padding >= 0 ? padding : null
	}
	const geometry = object?.geometry
	if ( geometry?.isMeshLine !== true ) return 0
	const material = object?.material
	if ( geometry.options?.sizeAttenuation === false || object?._options?.sizeAttenuation === false || material?.sizeAttenuation === false ) return null
	if ( typeof geometry.getBoundingPadding !== 'function' ) return null
	const geometryPadding = Number( geometry.getBoundingPadding() )
	if ( !Number.isFinite( geometryPadding ) || geometryPadding < 0 ) return null
	if ( material?.isMeshLineNodeMaterial !== true ) return geometryPadding
	const lineWidth = Number( material.lineWidth?.value ?? material.options?.lineWidth ?? 0 )
	const miterLimit = Number( material.miterLimit ?? material.options?.miterLimit ?? 4 )
	const maxWidth = Number( geometry._maxWidthMultiplier ?? 1 )
	if (
		!Number.isFinite( lineWidth ) ||
		!Number.isFinite( miterLimit ) ||
		!Number.isFinite( maxWidth ) ||
		lineWidth < 0 || miterLimit < 0 || maxWidth < 0
	) return null
	const materialPadding = lineWidth * Math.max( 1, miterLimit ) * 0.5 * Math.max( 1, maxWidth )
	return Number.isFinite( materialPadding ) ? Math.max( geometryPadding, materialPadding ) : null
}

const writeChunkBounds = ( target, chunks, indexArray, position, object, boundsOption, localPadding, worldPadding ) => {
	const chunkCount = chunks.length
	for ( let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++ ) {
		const [indexStart, indexCount] = chunks[chunkIndex]
		let minX = Infinity, minY = Infinity, minZ = Infinity
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

		if ( boundsOption != null ) {
			const entry = getExplicitBoundsEntry( boundsOption, {
				chunkIndex,
				indexStart,
				indexCount,
				geometry: object.geometry,
				object,
			}, chunkCount )
			if ( !entry ) return false
			minX = entry[0]
			minY = entry[1]
			minZ = entry[2]
			maxX = entry[3]
			maxY = entry[4]
			maxZ = entry[5]
		} else {
			for ( let i = indexStart; i < indexStart + indexCount; i++ ) {
				const vertex = indexArray[i]
				if ( vertex >= position.count ) return false
				const x = position.getX( vertex )
				const y = position.getY( vertex )
				const z = position.getZ( vertex )
				if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) return false
				minX = Math.min( minX, x )
				minY = Math.min( minY, y )
				minZ = Math.min( minZ, z )
				maxX = Math.max( maxX, x )
				maxY = Math.max( maxY, y )
				maxZ = Math.max( maxZ, z )
			}
		}

		if ( ![minX, minY, minZ, maxX, maxY, maxZ].every( Number.isFinite ) ) return false
		if ( minX > maxX || minY > maxY || minZ > maxZ ) return false

		minX -= localPadding[0]
		minY -= localPadding[1]
		minZ -= localPadding[2]
		maxX += localPadding[0]
		maxY += localPadding[1]
		maxZ += localPadding[2]

		const offset = chunkIndex * 8
		target[offset] = ( minX + maxX ) * 0.5
		target[offset + 1] = ( minY + maxY ) * 0.5
		target[offset + 2] = ( minZ + maxZ ) * 0.5
		target[offset + 3] = 0
		target[offset + 4] = ( maxX - minX ) * 0.5
		target[offset + 5] = ( maxY - minY ) * 0.5
		target[offset + 6] = ( maxZ - minZ ) * 0.5
		target[offset + 7] = worldPadding
		for ( let i = offset; i < offset + 8; i++ ) {
			if ( !Number.isFinite( target[i] ) ) return false
		}
	}
	return true
}

const createChunkInfo = chunks => {
	const info = new Uint32Array( chunks.length * 4 )
	for ( let i = 0; i < chunks.length; i++ ) {
		info[i * 4] = chunks[i][0]
		info[i * 4 + 1] = chunks[i][1]
	}
	return info
}

const matrixEquals = ( left, right ) => !!left?.equals && left.equals( right )
const matrixIsFinite = matrix => !!matrix?.elements && matrix.elements.every( Number.isFinite )
const planeIsFinite = plane => !!plane &&
	Number.isFinite( plane.normal.x ) &&
	Number.isFinite( plane.normal.y ) &&
	Number.isFinite( plane.normal.z ) &&
	Number.isFinite( plane.constant )

class MeshLineCullingHandle {
	constructor( system, line, options ) {
		this.system = system
		this.line = line
		this.options = { ...options }
		this.removed = false
		this.reason = 'not initialized'
		this.lastError = null
		this.chunkCount = 0
		this.indexCount = 0
		this.warmedUp = false
		this.prepared = false
		this._resources = null
		this._renderSnapshots = []
		this._snapshotPool = []
		this._paddingScratch = [0, 0, 0]
		this._hooksInstalled = false
		this._originalBeforeRender = null
		this._originalAfterRender = null
		this._originalFrustumCulled = line?.frustumCulled
		this._preparedMatrixWorld = new Matrix4()
		this._warmBackend = null
		this._warmDevice = null
		this._cpuFallback = false
		this.refresh()
	}

	get enabled() {
		return !this.removed && this._resources !== null && this.system.isNativeWebGPU
	}

	get active() {
		return this.enabled && this.warmedUp && this.prepared
	}

	get status() {
		return {
			enabled: this.enabled,
			active: this.active,
			warmedUp: this.warmedUp,
			chunkCount: this.chunkCount,
			indexCount: this.indexCount,
			reason: this.reason,
			lastError: this.lastError,
		}
	}

	_installObjectHooks() {
		if ( !this.line || this._hooksInstalled ) return
		const handle = this
		this._originalBeforeRender = this.line.onBeforeRender
		this._originalAfterRender = this.line.onAfterRender
		this._beforeRenderHook = function ( renderer, scene, camera, geometry, material, group ) {
			let result
			if ( typeof handle._originalBeforeRender === 'function' ) result = handle._originalBeforeRender.call( this, renderer, scene, camera, geometry, material, group )
			handle._beforeRender( renderer, scene, camera )
			return result
		}
		this._afterRenderHook = function ( renderer, scene, camera, geometry, material, group ) {
			handle._afterRender()
			if ( typeof handle._originalAfterRender === 'function' ) return handle._originalAfterRender.call( this, renderer, scene, camera, geometry, material, group )
		}
		this.line.onBeforeRender = this._beforeRenderHook
		this.line.onAfterRender = this._afterRenderHook
		this._hooksInstalled = true
	}

	refresh() {
		if ( this.removed ) return false
		try {
			this._restoreAllSnapshots()
			this._restoreOwnedGeometryState()
			this._disposeComputeNodes()
			this._resources = null
			this.prepared = false
			this.warmedUp = false
			this.chunkCount = 0
			this.indexCount = 0
			this._cpuFallback = false

			if ( typeof this.line?.ensureBuilt === 'function' ) this.line.ensureBuilt()
			if ( !this.system.isNativeWebGPU ) return this._fail( this.system.backendReason )
			const geometry = this.line?.geometry
			const index = getIndex( geometry )
			const position = geometry?.getAttribute?.( 'position' )
			const instanceCount = Number( getInstanceCount( this.line ) )
			if ( !geometry || !index || !position ) return this._fail( 'an indexed position geometry is required' )
			if ( hasBundleAncestor( this.line ) ) return this._fail( 'render bundles are not supported safely' )
			if ( index.count % 3 !== 0 ) return this._fail( 'the source index count must be triangle-aligned' )
			if ( !Number.isSafeInteger( instanceCount ) || instanceCount <= 0 || instanceCount > UINT32_MAX ) return this._fail( 'invalid instance count' )
			if ( !isFullDrawRange( geometry, index.count ) ) return this._fail( 'partial drawRange is not supported' )
			if ( Array.isArray( geometry.groups ) && geometry.groups.length > 0 ) return this._fail( 'geometry groups are not supported' )
			if ( getIndirect( geometry ) !== null ) return this._fail( 'an existing indirect draw cannot be composed safely' )
			if ( !isOpaqueMaterial( this.line.material ) ) return this._fail( 'only opaque depth-writing materials are supported' )
			if ( index.count > this.system.options.maxIndices ) return this._fail( 'index capacity exceeded' )
			if ( instanceCount > 1 && this.options.bounds == null ) return this._fail( 'instanced deformation requires explicit aggregate chunk bounds' )
			if ( this.options.bounds == null && hasUnboundedVertexDeformation( this.line ) ) return this._fail( 'vertex deformation requires explicit chunk bounds' )

			const source = createIndexCopy( index )
			if ( !source ) return this._fail( 'the source index is invalid' )
			const chunks = createChunkRanges( geometry, index.count, this.options.chunkSize )
			if ( !chunks || chunks.length === 0 ) return this._fail( 'no drawable chunks were produced' )
			if ( chunks.length > this.system.options.maxChunks ) return this._fail( 'chunk capacity exceeded' )
			if (
				this.system.options.mode === 'auto' &&
				( index.count < this.system.options.minIndices || chunks.length < this.system.options.minChunks )
			) return this._fail( 'geometry is below the automatic GPU-culling threshold; using CPU culling', null, true )

			const worldPadding = getWorldPadding( this.line, this.options.bounds != null, this.options.worldPadding )
			if ( worldPadding === null ) return this._fail( 'camera-sized or unknown-width lines require explicit bounds' )
			const localPadding = readPadding( this.options.boundsPadding, [0, 0, 0] )
			if ( localPadding === null ) return this._fail( 'bounds padding is invalid' )
			const bounds = new Float32Array( chunks.length * 8 )
			if ( !writeChunkBounds(
				bounds,
				chunks,
				source,
				position,
				this.line,
				this.options.bounds,
				localPadding,
				worldPadding
			) ) return this._fail( 'chunk bounds are invalid' )

			const sourceAttribute = new StorageBufferAttribute( source.slice(), 1, Uint32Array )
			const outputAttribute = new StorageBufferAttribute( source.slice(), 1, Uint32Array )
			const chunkAttribute = new StorageBufferAttribute( createChunkInfo( chunks ), 4, Uint32Array )
			const boundsAttribute = new StorageBufferAttribute( bounds, 4 )
			const indirectArray = new Uint32Array( [index.count, instanceCount, 0, 0, 0] )
			const indirectAttribute = new IndirectStorageBufferAttribute( indirectArray, 1 )
			const planes = Array.from( { length: 6 }, () => new Vector4() )

			this.geometry = geometry
			this.originalIndex = index
			this.originalIndirect = getIndirect( geometry )
			this.originalIndirectOffset = geometry.indirectOffset ?? 0
			this.positionAttribute = position
			this.instanceCount = instanceCount
			this.indexVersion = index.version
			this.positionVersion = position.version
			this.chunkCount = chunks.length
			this.indexCount = index.count
			this._resources = {
				bounds,
				boundsAttribute,
				chunkAttribute,
				chunks,
				indirectAttribute,
				localPadding,
				outputAttribute,
				planes,
				sourceAttribute,
				worldPadding,
			}
			this._createComputeNodes()
			this._installObjectHooks()
			this._enforceFrustumPolicy()
			this.reason = this.system.isNativeWebGPU ? 'waiting for INDEX|STORAGE warm-up' : this.system.backendReason
			this.lastError = null
			return true
		} catch ( error ) {
			return this._fail( 'refresh failed', error )
		}
	}

	_createComputeNodes() {
		const resources = this._resources
		const sourceBuffer = storage( resources.sourceAttribute, 'uint', this.indexCount ).toReadOnly()
		const outputBuffer = storage( resources.outputAttribute, 'uint', this.indexCount )
		const chunkBuffer = storage( resources.chunkAttribute, 'uvec4', this.chunkCount ).toReadOnly()
		const boundsBuffer = storage( resources.boundsAttribute, 'vec4', this.chunkCount * 2 ).toReadOnly()
		const indirectBuffer = storage( resources.indirectAttribute, 'uint', INDIRECT_WORDS ).toAtomic()
		const planeBuffer = uniformArray( resources.planes, 'vec4' )
		const instanceCount = this.instanceCount

		resources.resetNode = Fn( () => {
			If( instanceIndex.equal( uint( 0 ) ), () => {
				atomicStore( indirectBuffer.element( uint( 0 ) ), uint( 0 ) )
				atomicStore( indirectBuffer.element( uint( 1 ) ), uint( instanceCount ) )
				atomicStore( indirectBuffer.element( uint( 2 ) ), uint( 0 ) )
				atomicStore( indirectBuffer.element( uint( 3 ) ), uint( 0 ) )
				atomicStore( indirectBuffer.element( uint( 4 ) ), uint( 0 ) )
			} )
		} )().compute( 1 )

		resources.cullNode = Fn( () => {
			If( instanceIndex.lessThan( uint( this.chunkCount ) ), () => {
				const chunk = chunkBuffer.element( instanceIndex )
				const center = boundsBuffer.element( instanceIndex.mul( uint( 2 ) ) )
				const extent = boundsBuffer.element( instanceIndex.mul( uint( 2 ) ).add( uint( 1 ) ) )
				const visible = bool( true ).toVar()

				for ( let planeIndex = 0; planeIndex < 6; planeIndex++ ) {
					const plane = planeBuffer.element( uint( planeIndex ) )
					const distance = dot( plane.xyz, center.xyz ).add( plane.w )
					const radius = dot( abs( plane.xyz ), extent.xyz ).add( extent.w )
					visible.assign( visible.and( distance.add( radius ).greaterThanEqual( 0 ) ) )
				}

				If( visible, () => {
					const sourceStart = chunk.x
					const sourceCount = chunk.y
					const available = uint( this.indexCount ).sub( sourceStart )
					const count = min( sourceCount, available )
					const outputStart = atomicAdd( indirectBuffer.element( uint( 0 ) ), count )
					Loop( { start: uint( 0 ), end: count, type: 'uint', condition: '<' }, ( { i } ) => {
						outputBuffer.element( outputStart.add( i ) ).assign( sourceBuffer.element( sourceStart.add( i ) ) )
					} )
				} )
			} )
		} )().compute( this.chunkCount )
	}

	_fail( reason, error = null, cpuFallback = false ) {
		this._disposeComputeNodes()
		this.reason = reason
		this.lastError = error ?? null
		this.prepared = false
		this._resources = null
		this._cpuFallback = cpuFallback
		this._enforceFrustumPolicy()
		return false
	}

	_enforceFrustumPolicy() {
		if ( !this.line ) return
		if ( this.enabled || ( !this._cpuFallback && this.system.options.fallback === 'draw-all' ) ) this.line.frustumCulled = false
		else if ( this._cpuFallback ) this.line.frustumCulled = this._originalFrustumCulled
	}

	_restoreOwnedGeometryState() {
		const geometry = this.geometry
		if ( !geometry ) return
		const currentIndex = getIndex( geometry )
		const currentIndirect = getIndirect( geometry )
		if ( currentIndex === this._resources?.outputAttribute ) setIndex( geometry, this.originalIndex )
		if ( currentIndirect === this._resources?.indirectAttribute ) setIndirect( geometry, this.originalIndirect, this.originalIndirectOffset )
	}

	_restoreAllSnapshots() {
		while ( this._renderSnapshots.length > 0 ) this._restoreSnapshot( this._renderSnapshots.pop() )
	}

	_restoreSnapshot( snapshot ) {
		if ( !snapshot?.geometry ) return
		setIndex( snapshot.geometry, snapshot.index )
		setIndirect( snapshot.geometry, snapshot.indirect, snapshot.indirectOffset )
	}

	_beforeRender( renderer, scene, camera ) {
		if ( this.removed ) return
		try {
			if ( renderer !== this.system.renderer || scene !== this.system.scene ) {
				this._renderSnapshots.push( passthroughSnapshot )
				return
			}
			const geometry = this.line?.geometry
			const depth = this._renderSnapshots.length
			const snapshot = this._snapshotPool[depth] ?? ( this._snapshotPool[depth] = {} )
			snapshot.geometry = geometry
			snapshot.index = getIndex( geometry )
			snapshot.indirect = getIndirect( geometry )
			snapshot.indirectOffset = geometry?.indirectOffset ?? 0
			snapshot.warming = false
			snapshot.passthrough = false
			this._renderSnapshots.push( snapshot )
			this._enforceFrustumPolicy()
			if ( !this.enabled || geometry !== this.geometry ) return
			const ownsIndexState = snapshot.index === this.originalIndex || snapshot.index === this._resources.outputAttribute
			const ownsIndirectState = snapshot.indirect === this.originalIndirect || snapshot.indirect === this._resources.indirectAttribute
			if ( !ownsIndexState || !ownsIndirectState ) return

			if ( !this._hasCurrentDevice() ) this._resetWarmup( 'renderer device changed; warm-up required' )
			if ( !this.warmedUp ) {
				// The source attribute may have been edited in place after refresh().
				// Synchronize its CPU copy before the first INDEX|STORAGE warm-up draw.
				if ( !this._syncDynamicData() ) return
				setIndex( geometry, this._resources.outputAttribute )
				setIndirect( geometry, null, 0 )
				snapshot.warming = true
				return
			}

			if ( this.system._isSafeRenderPass() && scene?.overrideMaterial == null && this._isPreparedFor( camera ) ) {
				setIndex( geometry, this._resources.outputAttribute )
				setIndirect( geometry, this._resources.indirectAttribute, 0 )
			} else {
				setIndex( geometry, this.originalIndex )
				setIndirect( geometry, this.originalIndirect, this.originalIndirectOffset )
			}
		} catch ( error ) {
			this.reason = 'render selection failed; drawing all'
			this.lastError = error
			const snapshot = this._renderSnapshots[this._renderSnapshots.length - 1]
			if ( snapshot ) this._restoreSnapshot( snapshot )
		}
	}

	_afterRender() {
		const snapshot = this._renderSnapshots.pop()
		if ( !snapshot || snapshot.passthrough ) return
		try {
			if ( snapshot.warming ) {
				this.warmedUp = true
				this._warmBackend = this.system.renderer?.backend ?? null
				this._warmDevice = this.system.renderer?.backend?.device ?? null
				this.reason = 'ready for compute update'
			}
		} finally {
			this._restoreSnapshot( snapshot )
		}
	}

	_hasCurrentDevice() {
		if ( !this.warmedUp ) return true
		const backend = this.system.renderer?.backend ?? null
		const device = backend?.device ?? null
		return backend === this._warmBackend && device === this._warmDevice
	}

	_resetWarmup( reason ) {
		this.warmedUp = false
		this.prepared = false
		this.reason = reason
		this._warmBackend = null
		this._warmDevice = null
	}

	_syncDynamicData() {
		if ( !this._resources || this.line?.geometry !== this.geometry ) return this._stale( 'geometry identity changed; call refresh()' )
		if ( hasBundleAncestor( this.line ) ) return this._transient( 'render bundles are not supported safely' )
		const currentIndex = getIndex( this.geometry )
		const currentIndirect = getIndirect( this.geometry )
		if ( currentIndex !== this.originalIndex && currentIndex !== this._resources.outputAttribute ) return this._stale( 'index identity changed; call refresh()' )
		if ( currentIndirect !== this.originalIndirect && currentIndirect !== this._resources.indirectAttribute ) return this._stale( 'indirect draw changed; call refresh()' )
		if ( getInstanceCount( this.line ) !== this.instanceCount ) return this._stale( 'instance count changed; call refresh()' )
		if ( !isOpaqueMaterial( this.line.material ) ) return this._transient( 'only opaque depth-writing materials are culled' )
		if ( this.options.bounds == null && hasUnboundedVertexDeformation( this.line ) ) return this._transient( 'vertex deformation requires explicit chunk bounds' )

		const position = this.geometry.getAttribute?.( 'position' )
		if ( !position ) return this._stale( 'position attribute is missing; call refresh()' )
		if ( this.originalIndex.count !== this.indexCount ) return this._stale( 'index capacity changed; call refresh()' )
		if ( position.count !== this.positionAttribute.count ) return this._stale( 'position capacity changed; call refresh()' )

		let sourceChanged = false
		if ( this.originalIndex.version !== this.indexVersion ) {
			const source = createIndexCopy( this.originalIndex )
			if ( !source || source.length !== this.indexCount ) return this._stale( 'updated source index is invalid; call refresh()' )
			this._resources.sourceAttribute.array.set( source )
			this._resources.outputAttribute.array.set( source )
			this._resources.sourceAttribute.needsUpdate = true
			this._resources.outputAttribute.needsUpdate = true
			this.indexVersion = this.originalIndex.version
			sourceChanged = true
		}

		const worldPadding = getWorldPadding( this.line, this.options.bounds != null, this.options.worldPadding )
		if ( worldPadding === null ) return this._transient( 'camera-sized or unknown-width lines require explicit bounds' )
		const localPadding = readPadding( this.options.boundsPadding, this._paddingScratch )
		if ( localPadding === null ) return this._transient( 'bounds padding is invalid; drawing all' )
		const positionChanged = position !== this.positionAttribute || position.version !== this.positionVersion
		const paddingChanged = worldPadding !== this._resources.worldPadding
		const localPaddingChanged = !paddingEquals( localPadding, this._resources.localPadding )
		if ( positionChanged || sourceChanged || paddingChanged || localPaddingChanged || this.options.dynamicBounds === true ) {
			const source = this._resources.sourceAttribute.array
			if ( !writeChunkBounds(
				this._resources.bounds,
				this._resources.chunks,
				source,
				position,
				this.line,
				this.options.bounds,
				localPadding,
				worldPadding
			) ) return this._transient( 'updated chunk bounds are invalid; drawing all' )
			this._resources.boundsAttribute.needsUpdate = true
			this._resources.worldPadding = worldPadding
			this._resources.localPadding[0] = localPadding[0]
			this._resources.localPadding[1] = localPadding[1]
			this._resources.localPadding[2] = localPadding[2]
			this.positionAttribute = position
			this.positionVersion = position.version
			this.prepared = false
		}

		this.line.updateWorldMatrix?.( true, false )
		return true
	}

	_stale( reason ) {
		this.reason = reason
		this.prepared = false
		return false
	}

	_transient( reason ) {
		this.reason = reason
		this.prepared = false
		return false
	}

	_updateLocalPlanes( worldPlanes ) {
		const elements = this.line.matrixWorld.elements
		for ( let i = 0; i < 6; i++ ) {
			const plane = worldPlanes[i]
			const x = plane.normal.x, y = plane.normal.y, z = plane.normal.z, w = plane.constant
			const localX = elements[0] * x + elements[1] * y + elements[2] * z + elements[3] * w
			const localY = elements[4] * x + elements[5] * y + elements[6] * z + elements[7] * w
			const localZ = elements[8] * x + elements[9] * y + elements[10] * z + elements[11] * w
			const localW = elements[12] * x + elements[13] * y + elements[14] * z + elements[15] * w
			if ( ![localX, localY, localZ, localW].every( Number.isFinite ) ) return false
			this._resources.planes[i].set( localX, localY, localZ, localW )
		}
		this._preparedMatrixWorld.copy( this.line.matrixWorld )
		return true
	}

	_markPrepared() {
		this.prepared = true
		this.reason = 'GPU culling active'
	}

	_isPreparedFor( camera ) {
		const geometry = this.line?.geometry
		const position = geometry?.getAttribute?.( 'position' )
		const worldPadding = getWorldPadding( this.line, this.options.bounds != null, this.options.worldPadding )
		const localPadding = readPadding( this.options.boundsPadding, this._paddingScratch )
		return this.prepared &&
			this.system._isPreparedCamera( camera ) &&
			geometry === this.geometry &&
			matrixEquals( this.line.matrixWorld, this._preparedMatrixWorld ) &&
			position === this.positionAttribute &&
			this.positionAttribute?.version === this.positionVersion &&
			this.originalIndex?.version === this.indexVersion &&
			getInstanceCount( this.line ) === this.instanceCount &&
			isFullDrawRange( geometry, this.indexCount ) &&
			( !Array.isArray( geometry?.groups ) || geometry.groups.length === 0 ) &&
			!hasBundleAncestor( this.line ) &&
			( this.options.bounds != null || !hasUnboundedVertexDeformation( this.line ) ) &&
			worldPadding !== null && worldPadding === this._resources?.worldPadding &&
			localPadding !== null && paddingEquals( localPadding, this._resources?.localPadding ) &&
			isOpaqueMaterial( this.line.material )
	}

	_disposeComputeNodes() {
		this._resources?.resetNode?.dispose?.()
		this._resources?.cullNode?.dispose?.()
	}

	remove() {
		if ( this.removed ) return
		this.removed = true
		this._restoreAllSnapshots()
		this._restoreOwnedGeometryState()
		this._disposeComputeNodes()
		if ( this.line && this._hooksInstalled ) {
			if ( this.line.onBeforeRender === this._beforeRenderHook ) this.line.onBeforeRender = this._originalBeforeRender
			if ( this.line.onAfterRender === this._afterRenderHook ) this.line.onAfterRender = this._originalAfterRender
		}
		if ( this.line ) this.line.frustumCulled = this._originalFrustumCulled
		this._resources = null
		this.prepared = false
		attachedLines.delete( this.line )
		this.system?._handles.delete( this )
	}
}

/**
 * Native-WebGPU chunk culling for opaque indexed MeshLine billboard and
 * surface geometries. The public API intentionally fails open: unsupported
 * backends, invalid bounds, stale topology, extra cameras, and capacity limits
 * render the complete source index instead of suppressing geometry.
 *
 * `chunkSize` is measured in triangles. The first render/compile of each line
 * draws a full CPU copy once so Three allocates the compacted buffer with both
 * INDEX and STORAGE usage before compute writes it.
 */
export class MeshLineCullingSystem {
	static attach( renderer, scene, options = {} ) {
		if ( isObject( renderer ) && isObject( scene ) ) {
			let byScene = systems.get( renderer )
			if ( !byScene ) {
				byScene = new WeakMap()
				systems.set( renderer, byScene )
			}
			const existing = byScene.get( scene )
			if ( existing && !existing.disposed ) return existing
			const system = new MeshLineCullingSystem( renderer, scene, options )
			byScene.set( scene, system )
			return system
		}
		return new MeshLineCullingSystem( renderer, scene, options )
	}

	constructor( renderer, scene, options = {} ) {
		this.renderer = renderer
		this.scene = scene
		this.options = {
			mode: normalizeMode( options.mode ),
			autoUpdate: options.autoUpdate !== false,
			fallback: normalizeFallback( options.fallback ),
			chunkSize: finitePositiveInteger( options.chunkSize, DEFAULT_CHUNK_SIZE ),
			maxChunks: finitePositiveInteger( options.maxChunks, DEFAULT_MAX_CHUNKS ),
			maxIndices: finitePositiveInteger( options.maxIndices, DEFAULT_MAX_INDICES ),
			minChunks: finiteNonNegativeInteger( options.minChunks, DEFAULT_MIN_CHUNKS ),
			minIndices: finiteNonNegativeInteger( options.minIndices, DEFAULT_MIN_INDICES ),
		}
		this.disposed = false
		this.lastError = null
		this._handles = new Set()
		this._frustum = new Frustum()
		this._projectionView = new Matrix4()
		this._preparedProjection = new Matrix4()
		this._preparedView = new Matrix4()
		this._preparedCamera = null
		this._preparedCoordinateSystem = null
		this._preparedReversedDepth = null
		this._computeNodes = []
		this._preparedHandles = []
		this._originalSceneBeforeRender = scene?.onBeforeRender
		this._originalSceneAfterRender = scene?.onAfterRender
		this._sceneRenderDepth = 0
		this._depthResetQueued = false
		this._depthResetTask = () => {
			this._sceneRenderDepth = 0
			this._depthResetQueued = false
		}
		this._installSceneHooks()
	}

	get isNativeWebGPU() {
		return !!(
			this.renderer?.isWebGPURenderer === true &&
			this.renderer?.backend?.isWebGPUBackend === true &&
			typeof this.renderer?.compute === 'function'
		)
	}

	get backendReason() {
		if ( this.isNativeWebGPU ) return 'native WebGPU available'
		return this.options.mode === 'webgpu'
			? 'native WebGPU was requested but is unavailable; drawing all'
			: 'native WebGPU is unavailable; using the configured fallback'
	}

	get size() {
		return this._handles.size
	}

	_installSceneHooks() {
		if ( !this.scene ) return
		const system = this
		this._sceneBeforeRenderLink = { previous: this._originalSceneBeforeRender }
		this._sceneAfterRenderLink = { previous: this._originalSceneAfterRender }
		this._sceneBeforeRenderHook = function ( renderer, scene, camera, renderTarget ) {
			const previous = system._sceneBeforeRenderLink.previous
			if ( renderer !== system.renderer ) {
				if ( typeof previous === 'function' ) return previous.call( this, renderer, scene, camera, renderTarget )
				return
			}
			system._sceneRenderDepth++
			system._queueDepthReset()
			try {
				let result
				if ( typeof previous === 'function' ) result = previous.call( this, renderer, scene, camera, renderTarget )
				if ( system._sceneRenderDepth === 1 ) {
					if ( system.options.autoUpdate ) system._updateSync( camera )
					else system._enforceFallbackPolicies()
				} else {
					system._enforceFallbackPolicies()
				}
				return result
			} catch ( error ) {
				system._sceneRenderDepth = Math.max( 0, system._sceneRenderDepth - 1 )
				throw error
			}
		}
		this._sceneAfterRenderHook = function ( renderer, scene, camera, renderTarget ) {
			const previous = system._sceneAfterRenderLink.previous
			if ( renderer !== system.renderer ) {
				if ( typeof previous === 'function' ) return previous.call( this, renderer, scene, camera, renderTarget )
				return
			}
			try {
				if ( system._sceneRenderDepth === 1 ) system._restoreLeakedSnapshots()
				if ( typeof previous === 'function' ) return previous.call( this, renderer, scene, camera, renderTarget )
			} finally {
				system._sceneRenderDepth = Math.max( 0, system._sceneRenderDepth - 1 )
			}
		}
		this._sceneBeforeRenderHook[sceneHookLink] = this._sceneBeforeRenderLink
		this._sceneAfterRenderHook[sceneHookLink] = this._sceneAfterRenderLink
		this.scene.onBeforeRender = this._sceneBeforeRenderHook
		this.scene.onAfterRender = this._sceneAfterRenderHook
	}

	_queueDepthReset() {
		if ( this._depthResetQueued ) return
		this._depthResetQueued = true
		queueMicrotask( this._depthResetTask )
	}

	_isSafeRenderPass() {
		return this._sceneRenderDepth <= 1
	}

	add( line, options = {} ) {
		if ( this.disposed || !isObject( line ) ) return null
		const existing = attachedLines.get( line )
		if ( existing && !existing.removed ) return existing
		const handle = new MeshLineCullingHandle( this, line, {
			...options,
			chunkSize: finitePositiveInteger( options.chunkSize, this.options.chunkSize ),
		} )
		this._handles.add( handle )
		attachedLines.set( line, handle )
		return handle
	}

	remove( lineOrHandle ) {
		const handle = lineOrHandle instanceof MeshLineCullingHandle ? lineOrHandle : attachedLines.get( lineOrHandle )
		if ( handle?.system === this ) handle.remove()
	}

	async update( camera ) {
		if ( this.disposed ) return false
		try {
			if ( typeof this.renderer?.init === 'function' ) await this.renderer.init()
			return this._updateSync( camera )
		} catch ( error ) {
			this._failOpen( 'renderer initialization failed', error )
			return false
		}
	}

	_updateSync( camera ) {
		if ( this.disposed ) return false
		this._enforceFallbackPolicies()
		if ( !this.isNativeWebGPU ) {
			this._preparedCamera = null
			return false
		}
		if ( !camera?.isCamera || camera.isArrayCamera === true ) {
			this._preparedCamera = null
			for ( const handle of this._handles ) handle._transient( 'unsupported or array camera; drawing all' )
			return false
		}

		try {
			camera.updateWorldMatrix?.( true, false )
			if ( camera.far !== undefined && !Number.isFinite( camera.far ) ) return this._failOpen( 'camera far plane is not finite' )
			if ( !matrixIsFinite( camera.projectionMatrix ) || !matrixIsFinite( camera.matrixWorldInverse ) ) return this._failOpen( 'camera matrices are not finite' )
			this._projectionView.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
			this._frustum.setFromProjectionMatrix( this._projectionView, camera.coordinateSystem, camera.reversedDepth )
			if ( !this._frustum.planes.every( planeIsFinite ) ) return this._failOpen( 'frustum planes are not finite' )
			const computeNodes = this._computeNodes
			const preparedHandles = this._preparedHandles
			computeNodes.length = 0
			preparedHandles.length = 0
			let retainedPrepared = false

			for ( const handle of this._handles ) {
				if ( !handle.enabled || !handle.warmedUp || !handle._hasCurrentDevice() ) continue
				if ( !handle._syncDynamicData() ) continue
				if ( handle._isPreparedFor( camera ) ) {
					retainedPrepared = true
					continue
				}
				if ( !handle._updateLocalPlanes( this._frustum.planes ) ) {
					handle._transient( 'local frustum planes are not finite; drawing all' )
					continue
				}
				computeNodes.push( handle._resources.resetNode, handle._resources.cullNode )
				preparedHandles.push( handle )
			}

			if ( computeNodes.length === 0 ) {
				return retainedPrepared
			}

			const result = this.renderer.compute( computeNodes )
			if ( result?.catch ) {
				result.catch( error => this._failOpen( 'asynchronous compute dispatch failed', error ) )
				this._preparedCamera = null
				return false
			}
			this._preparedCamera = camera
			this._preparedProjection.copy( camera.projectionMatrix )
			this._preparedView.copy( camera.matrixWorldInverse )
			this._preparedCoordinateSystem = camera.coordinateSystem
			this._preparedReversedDepth = camera.reversedDepth
			for ( const handle of preparedHandles ) handle._markPrepared()
			this.lastError = null
			return true
		} catch ( error ) {
			this._failOpen( 'compute dispatch failed', error )
			return false
		}
	}

	_isPreparedCamera( camera ) {
		return camera === this._preparedCamera &&
			matrixEquals( camera?.projectionMatrix, this._preparedProjection ) &&
			matrixEquals( camera?.matrixWorldInverse, this._preparedView ) &&
			camera?.coordinateSystem === this._preparedCoordinateSystem &&
			camera?.reversedDepth === this._preparedReversedDepth
	}

	_enforceFallbackPolicies() {
		for ( const handle of this._handles ) handle._enforceFrustumPolicy()
	}

	_restoreLeakedSnapshots() {
		for ( const handle of this._handles ) handle._restoreAllSnapshots()
	}

	_failOpen( reason, error = null ) {
		this._preparedCamera = null
		this.lastError = error
		for ( const handle of this._handles ) {
			handle.prepared = false
			handle.reason = `${reason}; drawing all`
			handle.lastError = error
		}
		return false
	}

	dispose() {
		if ( this.disposed ) return
		this.disposed = true
		for ( const handle of Array.from( this._handles ) ) handle.remove()
		if ( this.scene ) {
			this.scene.onBeforeRender = unlinkOwnedHook( this.scene.onBeforeRender, this._sceneBeforeRenderHook, this._sceneBeforeRenderLink?.previous )
			this.scene.onAfterRender = unlinkOwnedHook( this.scene.onAfterRender, this._sceneAfterRenderHook, this._sceneAfterRenderLink?.previous )
		}
		const byScene = isObject( this.renderer ) ? systems.get( this.renderer ) : null
		byScene?.delete?.( this.scene )
		this._preparedCamera = null
	}
}

export default MeshLineCullingSystem
