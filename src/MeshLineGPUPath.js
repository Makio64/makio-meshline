import {
	abs,
	acos,
	bool,
	cameraProjectionMatrix,
	cos,
	dot,
	float,
	Fn,
	If,
	instanceIndex,
	invocationLocalIndex,
	length,
	Loop,
	max,
	min,
	mix,
	modelViewMatrix,
	nodeObject,
	sin,
	step,
	storage,
	uint,
	uniform,
	uvec2,
	uvec4,
	vec2,
	vec4,
	vertexIndex,
	workgroupArray,
	workgroupBarrier,
} from 'three/tsl'
import {
	Box3,
	BufferGeometry,
	Color,
	DoubleSide,
	Group,
	IndirectStorageBufferAttribute,
	InstancedBufferAttribute,
	Mesh,
	MeshBasicNodeMaterial,
	Sphere,
	StorageBufferAttribute,
	Vector2,
	WebGPUCoordinateSystem,
} from 'three/webgpu'

import MeshLine from './MeshLine.js'
import { PlacedPositionNode } from './MeshLineNodeMaterial.js'

const DEFAULT_CHUNK_SEGMENTS = 128
const MAX_CHUNK_SEGMENTS = 4096
const PREFIX_WORKGROUP_SIZE = 256
const PARALLEL_PREFIX_THRESHOLD = 256
const DEFAULT_LOCAL_TOLERANCE = 0
const MAX_FLOAT32 = 3.4028234663852886e38
// Aspect-corrected NDC direction guard. Keep this aligned with the billboard
// material so dense, valid subpixel segments do not flip to a fallback axis.
const MIN_DIRECTION_LENGTH = 1e-7
// Division guard only. Clip classification uses the exact homogeneous planes;
// this value affects only the projectively undefined all-zero boundary.
const MIN_CLIP_W = 1e-30
const CLIP_RANGE_EPSILON = 0.000001
const TOPOLOGY_SUPPORT_EPSILON = 0.000001
const REVERSAL_DOT_THRESHOLD = Math.fround( -Math.cos( Math.PI / 180 ) )
const MAX_TOPOLOGY_SEGMENTS = 64
const UINT32_MAX = 0xffffffff

const PRIMITIVE_BODY_A = 0
const PRIMITIVE_BODY_B = 1
const PRIMITIVE_JOIN = 2
const PRIMITIVE_START_CAP = 3
const PRIMITIVE_END_CAP = 4
const PRIMITIVE_TYPE_BITS = 4
const BYTES_PER_COMPONENT = 4
const STORAGE_COMPONENTS = 4
const PRIMITIVE_RECORD_COMPONENTS = 2

const finitePositiveInteger = ( value, fallback ) => {
	const number = Number( value )
	return Number.isSafeInteger( number ) && number > 0 ? number : fallback
}

const isPowerOfTwo = value => Number.isSafeInteger( value ) && value > 0 && value <= MAX_CHUNK_SEGMENTS && Number.isInteger( Math.log2( value ) )

const normalizeTopologyOptions = ( options = {}, fallback = null ) => {
	const fallbackJoin = fallback?._options?.join ?? { type: 'miter', limit: 4, segments: 8 }
	const requestedJoin = options.join ?? fallbackJoin
	const join = {
		type: requestedJoin?.type === 'simple' ? 'miter' : requestedJoin?.type ?? fallbackJoin.type,
		limit: Number( requestedJoin?.limit ?? fallbackJoin.limit ?? 4 ),
		segments: Number( requestedJoin?.segments ?? fallbackJoin.segments ?? 8 ),
	}
	const fallbackCap = fallback?._options?.cap ?? { type: 'butt', segments: 8 }
	const requestedCap = typeof options.cap === 'string' ? { type: options.cap } : options.cap ?? fallbackCap
	const cap = {
		type: requestedCap?.type ?? fallbackCap.type ?? 'butt',
		segments: Number( requestedCap?.segments ?? fallbackCap.segments ?? 8 ),
	}
	return { join, cap }
}

const getTopologyLayout = ( topology, variableTopology = false ) => {
	const joinPrimitives = topology.join.type === 'round' ? topology.join.segments : 1
	const capPrimitives = topology.cap.type === 'round' ? topology.cap.segments : 0
	const joinCapacity = Math.max( joinPrimitives, capPrimitives )
	return {
		joinPrimitives,
		joinCapacity,
		capPrimitives,
		advanced: variableTopology || topology.join.type !== 'miter' || topology.cap.type !== 'butt',
		maximumPrimitivesPerSegment: 2 + joinCapacity + capPrimitives * 2,
	}
}

const safeIntegerProduct = ( label, ...values ) => {
	let result = 1
	for ( const value of values ) {
		if ( !Number.isSafeInteger( value ) || value < 0 ) {
			throw new RangeError( `[MeshLineGPUPath] ${label} requires non-negative safe integer factors` )
		}
		if ( value !== 0 && result > Math.floor( Number.MAX_SAFE_INTEGER / value ) ) {
			throw new RangeError( `[MeshLineGPUPath] ${label} exceeds safe integer capacity` )
		}
		result *= value
	}
	return result
}

const safeIntegerSum = ( label, ...values ) => {
	let result = 0
	for ( const value of values ) {
		if ( !Number.isSafeInteger( value ) || value < 0 || result > Number.MAX_SAFE_INTEGER - value ) {
			throw new RangeError( `[MeshLineGPUPath] ${label} exceeds safe integer capacity` )
		}
		result += value
	}
	return result
}

const createGPUResourcePlan = ( {
	pointCount,
	segmentCount,
	chunkCount,
	levelCount,
	runCount,
	simplify,
	advancedTopology,
	topologyLayout,
} ) => {
	const bodyPrimitiveCount = advancedTopology ? safeIntegerProduct( 'body primitive count', segmentCount, 2 ) : 0
	const joinPrimitiveCount = advancedTopology
		? safeIntegerProduct( 'join primitive count', segmentCount - runCount, topologyLayout.joinCapacity )
		: 0
	const capPrimitiveCount = advancedTopology
		? safeIntegerProduct( 'cap primitive count', runCount, topologyLayout.capPrimitives, 2 )
		: 0
	const primitiveCapacity = safeIntegerSum(
		'primitive capacity',
		bodyPrimitiveCount,
		joinPrimitiveCount,
		capPrimitiveCount
	)
	const maximumVertexCount = safeIntegerProduct(
		'indirect vertex count',
		advancedTopology ? primitiveCapacity : segmentCount,
		advancedTopology ? 6 : 12
	)
	const byteLength = ( label, count, components = STORAGE_COMPONENTS ) => safeIntegerProduct(
		`${label} byte length`,
		count,
		components,
		BYTES_PER_COMPONENT
	)
	return {
		primitiveCapacity,
		maximumVertexCount,
		storageBytes: {
			points: byteLength( 'point storage', pointCount ),
			chunks: simplify ? byteLength( 'chunk storage', chunkCount ) : 0,
			errors: simplify ? byteLength( 'error storage', safeIntegerProduct( 'error element count', chunkCount, levelCount ), 1 ) : 0,
			states: simplify ? byteLength( 'state storage', chunkCount ) : 0,
			segments: simplify || advancedTopology ? byteLength( 'segment storage', segmentCount ) : 0,
			primitiveStates: simplify && advancedTopology ? byteLength( 'primitive state storage', segmentCount ) : 0,
			primitives: advancedTopology ? byteLength( 'primitive storage', primitiveCapacity, PRIMITIVE_RECORD_COMPONENTS ) : 0,
		},
		indirectBytes: byteLength( 'indirect storage', 8, 1 ),
	}
}

const normalizeDeviceLimit = value => {
	if ( typeof value === 'bigint' ) return value > BigInt( Number.MAX_SAFE_INTEGER ) ? Number.MAX_SAFE_INTEGER : Number( value )
	return Number.isSafeInteger( value ) && value > 0 ? value : Number.MAX_SAFE_INTEGER
}

const assertGPUResourcePlan = ( plan, device ) => {
	const bindingLimit = normalizeDeviceLimit( device?.limits?.maxStorageBufferBindingSize )
	const bufferLimit = normalizeDeviceLimit( device?.limits?.maxBufferSize )
	const storageLimit = Math.min( bindingLimit, bufferLimit )
	for ( const [name, bytes] of Object.entries( plan.storageBytes ) ) {
		if ( bytes > storageLimit ) {
			throw new RangeError(
				`[MeshLineGPUPath] ${name} storage requires ${bytes} bytes, exceeding the native WebGPU storage-buffer limit of ${storageLimit}`
			)
		}
	}
	if ( plan.indirectBytes > bufferLimit ) {
		throw new RangeError(
			`[MeshLineGPUPath] indirect buffer requires ${plan.indirectBytes} bytes, exceeding maxBufferSize ${bufferLimit}`
		)
	}
	return plan
}

const isPointObject = value => !!value && typeof value === 'object' && Number.isFinite( Number( value.x ) ) && Number.isFinite( Number( value.y ) )

const normalizePositionAttribute = position => {
	if ( !position || !Number.isSafeInteger( position.count ) || position.count < 0 || position.itemSize < 2 ) {
		throw new TypeError( '[MeshLineGPUPath] BufferGeometry requires a valid position attribute with at least xy components' )
	}

	const result = new Float32Array( position.count * 3 )
	let write = 0
	for ( let point = 0; point < position.count; point++ ) {
		const x = Math.fround( Number( position.getX( point ) ) )
		const y = Math.fround( Number( position.getY( point ) ) )
		const z = Math.fround( Number( position.itemSize >= 3 ? position.getZ( point ) : 0 ) )
		if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) {
			throw new Error( `[MeshLineGPUPath] non-finite or Float32-overflowing point at index ${point}` )
		}
		if ( write > 0 && result[write - 3] === x && result[write - 2] === y && result[write - 1] === z ) continue
		result[write++] = x
		result[write++] = y
		result[write++] = z
	}

	if ( write < 6 ) throw new Error( '[MeshLineGPUPath] at least two distinct points are required' )
	return write === result.length ? result : result.slice( 0, write )
}

/**
 * Normalize one open polyline into finite, distinct Float32 xyz records.
 * This deliberately rejects non-finite values instead of silently dropping them.
 */
const normalizeOpenPoints = points => {
	let source

	if ( points?.isBufferGeometry === true ) {
		return normalizePositionAttribute( points.getAttribute?.( 'position' ) )
	} else {
		source = points
	}

	if ( source == null || typeof source.length !== 'number' ) {
		throw new TypeError( '[MeshLineGPUPath] one point array is required' )
	}

	let flat
	if ( ArrayBuffer.isView( source ) || ( Array.isArray( source ) && ( source.length === 0 || typeof source[0] === 'number' ) ) ) {
		if ( source.length % 3 !== 0 ) throw new Error( '[MeshLineGPUPath] flat point data must contain complete xyz records' )
		flat = source
	} else if ( Array.isArray( source ) ) {
		flat = new Float64Array( source.length * 3 )
		for ( let i = 0; i < source.length; i++ ) {
			const point = source[i]
			if ( Array.isArray( point ) || ArrayBuffer.isView( point ) ) {
				flat[i * 3] = point[0]
				flat[i * 3 + 1] = point[1]
				flat[i * 3 + 2] = point[2] ?? 0
			} else if ( isPointObject( point ) ) {
				flat[i * 3] = point.x
				flat[i * 3 + 1] = point.y
				flat[i * 3 + 2] = point.z ?? 0
			} else {
				throw new TypeError( `[MeshLineGPUPath] invalid point at index ${i}` )
			}
		}
	} else {
		throw new TypeError( '[MeshLineGPUPath] unsupported point container' )
	}

	const result = new Float32Array( flat.length )
	let write = 0
	for ( let read = 0; read < flat.length; read += 3 ) {
		const x = Math.fround( Number( flat[read] ) )
		const y = Math.fround( Number( flat[read + 1] ) )
		const z = Math.fround( Number( flat[read + 2] ) )
		if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) {
			throw new Error( `[MeshLineGPUPath] non-finite or Float32-overflowing point at index ${read / 3}` )
		}
		if ( write > 0 && result[write - 3] === x && result[write - 2] === y && result[write - 1] === z ) continue
		result[write++] = x
		result[write++] = y
		result[write++] = z
	}

	if ( write < 6 ) throw new Error( '[MeshLineGPUPath] at least two distinct points are required' )
	return write === result.length ? result : result.slice( 0, write )
}

/**
 * Partition an open line's segments. Adjacent chunks share one read-only seam
 * point, while every source segment has exactly one owner.
 */
const createChunkPlan = ( pointCount, chunkSegments = DEFAULT_CHUNK_SEGMENTS ) => {
	if ( !Number.isSafeInteger( pointCount ) || pointCount < 2 ) throw new RangeError( '[MeshLineGPUPath] pointCount must be at least two' )
	chunkSegments = finitePositiveInteger( chunkSegments, DEFAULT_CHUNK_SEGMENTS )
	if ( !isPowerOfTwo( chunkSegments ) ) throw new RangeError( `[MeshLineGPUPath] chunkSegments must be a power of two no greater than ${MAX_CHUNK_SEGMENTS}` )

	const segmentCount = pointCount - 1
	const chunks = []
	for ( let segmentStart = 0; segmentStart < segmentCount; segmentStart += chunkSegments ) {
		chunks.push( {
			pointStart: segmentStart,
			segmentStart,
			segmentCount: Math.min( chunkSegments, segmentCount - segmentStart ),
		} )
	}
	return chunks
}

const pointSegmentDistance = ( points, point, start, end ) => {
	const p3 = point * 3, s3 = start * 3, e3 = end * 3
	const px = points[p3], py = points[p3 + 1], pz = points[p3 + 2]
	const ax = points[s3], ay = points[s3 + 1], az = points[s3 + 2]
	const dx = points[e3] - ax, dy = points[e3 + 1] - ay, dz = points[e3 + 2] - az
	const denominator = dx * dx + dy * dy + dz * dz
	const t = denominator > 0
		? Math.max( 0, Math.min( 1, ( ( px - ax ) * dx + ( py - ay ) * dy + ( pz - az ) * dz ) / denominator ) )
		: 0
	const rx = px - ( ax + dx * t )
	const ry = py - ( ay + dy * t )
	const rz = pz - ( az + dz * t )
	return Math.sqrt( rx * rx + ry * ry + rz * rz )
}

/**
 * Exact/near-exact source-space reversals are mandatory retained points. The
 * projected shader performs the same test again because projection can turn a
 * harmless 3D corner into a screen-space cusp.
 */
const findReversalBreaks = ( points, threshold = REVERSAL_DOT_THRESHOLD ) => {
	const normalized = points instanceof Float32Array ? points : normalizeOpenPoints( points )
	if ( !Number.isFinite( threshold ) || threshold < -1 || threshold >= 1 ) {
		throw new RangeError( '[MeshLineGPUPath] reversal threshold must be within [-1, 1)' )
	}
	const pointCount = normalized.length / 3
	const breaks = new Uint8Array( pointCount )
	if ( pointCount < 3 ) return breaks
	let curX = normalized[3]
	let curY = normalized[4]
	let curZ = normalized[5]
	let incomingX = curX - normalized[0]
	let incomingY = curY - normalized[1]
	let incomingZ = curZ - normalized[2]
	let incomingLenSq = incomingX * incomingX + incomingY * incomingY + incomingZ * incomingZ
	for ( let point = 1; point < pointCount - 1; point++ ) {
		const nextOffset = ( point + 1 ) * 3
		const nextX = normalized[nextOffset]
		const nextY = normalized[nextOffset + 1]
		const nextZ = normalized[nextOffset + 2]
		const outgoingX = nextX - curX
		const outgoingY = nextY - curY
		const outgoingZ = nextZ - curZ
		const outgoingLenSq = outgoingX * outgoingX + outgoingY * outgoingY + outgoingZ * outgoingZ
		const prodLenSq = incomingLenSq * outgoingLenSq
		if ( prodLenSq > 0 ) {
			const directionDot = (
				incomingX * outgoingX +
				incomingY * outgoingY +
				incomingZ * outgoingZ
			) / Math.sqrt( prodLenSq )
			if ( directionDot <= threshold ) breaks[point] = 1
		}
		curX = nextX
		curY = nextY
		curZ = nextZ
		incomingX = outgoingX
		incomingY = outgoingY
		incomingZ = outgoingZ
		incomingLenSq = outgoingLenSq
	}
	return breaks
}

const clipHomogeneousSegment = ( start, end, options = {} ) => {
	if ( !start || !end || start.length < 4 || end.length < 4 ) {
		throw new TypeError( '[MeshLineGPUPath] homogeneous endpoints require four components' )
	}
	const padScaleX = Number( options.padScaleX ?? 0 )
	const padScaleY = Number( options.padScaleY ?? 0 )
	const padAddX = Number( options.padAddX ?? 0 )
	const padAddY = Number( options.padAddY ?? 0 )
	if ( ![padScaleX, padScaleY, padAddX, padAddY].every( value => Number.isFinite( value ) && value >= 0 ) ) {
		throw new RangeError( '[MeshLineGPUPath] homogeneous clip padding must be finite and non-negative' )
	}
	for ( let component = 0; component < 4; component++ ) {
		if ( !Number.isFinite( start[component] ) || !Number.isFinite( end[component] ) ) {
			return { visible: false, start: null, end: null, range: [1, 0] }
		}
	}

	let lower = 0
	let upper = 1
	const clipPlane = ( startDistance, endDistance ) => {
		if ( startDistance < 0 && endDistance < 0 ) {
			lower = 1
			upper = 0
			return
		}
		if ( startDistance < 0 ) {
			lower = Math.max( lower, startDistance / ( startDistance - endDistance ) )
		} else if ( endDistance < 0 ) {
			upper = Math.min( upper, startDistance / ( startDistance - endDistance ) )
		}
	}
	// Native WebGPU clip volume: positive w, 0 <= z <= w. XY planes are
	// conservatively widened for the complete extruded stroke.
	clipPlane( start[3], end[3] )
	clipPlane( start[2], end[2] )
	clipPlane( start[3] - start[2], end[3] - end[2] )
	clipPlane(
		start[0] + ( 1 + padScaleX ) * start[3] + padAddX,
		end[0] + ( 1 + padScaleX ) * end[3] + padAddX
	)
	clipPlane(
		( 1 + padScaleX ) * start[3] - start[0] + padAddX,
		( 1 + padScaleX ) * end[3] - end[0] + padAddX
	)
	clipPlane(
		start[1] + ( 1 + padScaleY ) * start[3] + padAddY,
		end[1] + ( 1 + padScaleY ) * end[3] + padAddY
	)
	clipPlane(
		( 1 + padScaleY ) * start[3] - start[1] + padAddY,
		( 1 + padScaleY ) * end[3] - end[1] + padAddY
	)
	if ( lower >= upper || upper <= 0 || lower >= 1 ) {
		return { visible: false, start: null, end: null, range: [lower, upper] }
	}
	lower = Math.max( 0, lower )
	upper = Math.min( 1, upper )
	const mixPoint = t => start.map( ( value, component ) => value + ( end[component] - value ) * t )
	return {
		visible: true,
		start: mixPoint( lower ),
		end: mixPoint( upper ),
		range: [lower, upper],
	}
}

const computeInnerJoinOffset = ( incoming, outgoing, halfWidth ) => {
	if ( !incoming || !outgoing || incoming.length < 2 || outgoing.length < 2 ) {
		throw new TypeError( '[MeshLineGPUPath] inner join directions require xy components' )
	}
	halfWidth = Number( halfWidth )
	if ( !Number.isFinite( halfWidth ) || halfWidth < 0 ) {
		throw new RangeError( '[MeshLineGPUPath] inner join width must be finite and non-negative' )
	}
	const incomingLength = Math.hypot( incoming[0], incoming[1] )
	const outgoingLength = Math.hypot( outgoing[0], outgoing[1] )
	if ( incomingLength <= 0 || outgoingLength <= 0 ) return { offset: [0, 0], side: 0, fallback: true }
	const directionA = [incoming[0] / incomingLength, incoming[1] / incomingLength]
	const directionB = [outgoing[0] / outgoingLength, outgoing[1] / outgoingLength]
	const turnCross = directionA[0] * directionB[1] - directionA[1] * directionB[0]
	const directionDot = directionA[0] * directionB[0] + directionA[1] * directionB[1]
	if ( Math.abs( turnCross ) <= MIN_DIRECTION_LENGTH || directionDot <= REVERSAL_DOT_THRESHOLD ) {
		return { offset: [0, 0], side: 0, fallback: directionDot <= REVERSAL_DOT_THRESHOLD }
	}
	const normalA = [-directionA[1], directionA[0]]
	const normalB = [-directionB[1], directionB[0]]
	const sumX = normalA[0] + normalB[0]
	const sumY = normalA[1] + normalB[1]
	const sumLength = Math.hypot( sumX, sumY )
	if ( sumLength <= MIN_DIRECTION_LENGTH ) return { offset: [0, 0], side: Math.sign( turnCross ), fallback: true }
	const bisectorX = sumX / sumLength
	const bisectorY = sumY / sumLength
	const denominator = Math.abs( bisectorX * normalB[0] + bisectorY * normalB[1] )
	const scale = denominator > MIN_DIRECTION_LENGTH ? halfWidth / denominator : Infinity
	if ( !Number.isFinite( scale ) ) {
		return { offset: [0, 0], side: Math.sign( turnCross ), fallback: true }
	}
	const side = Math.sign( turnCross )
	return { offset: [bisectorX * side * scale, bisectorY * side * scale], side, fallback: false }
}

/**
 * Resolve one projected join in aspect-corrected NDC. Exact inner offset-line
 * intersections are retained only while their longitudinal setback fits on
 * both incident legs. Wider/shorter configurations keep each incident body at
 * its full local half-width and use a bounded center pivot only for the join
 * wedge, instead of allowing the intersection to escape across the viewport.
 */
const resolveProjectedJoin = ( incoming, outgoing, halfWidth ) => {
	if ( !incoming || !outgoing || incoming.length < 2 || outgoing.length < 2 ) {
		throw new TypeError( '[MeshLineGPUPath] projected join deltas require xy components' )
	}
	halfWidth = Number( halfWidth )
	if ( !Number.isFinite( halfWidth ) || halfWidth < 0 ) {
		throw new RangeError( '[MeshLineGPUPath] projected join width must be finite and non-negative' )
	}
	const incomingX = Number( incoming[0] )
	const incomingY = Number( incoming[1] )
	const outgoingX = Number( outgoing[0] )
	const outgoingY = Number( outgoing[1] )
	const incomingLength = Math.hypot( incomingX, incomingY )
	const outgoingLength = Math.hypot( outgoingX, outgoingY )
	const degenerate = (
		!Number.isFinite( incomingLength ) || !Number.isFinite( outgoingLength ) ||
		incomingLength < MIN_DIRECTION_LENGTH || outgoingLength < MIN_DIRECTION_LENGTH
	)
	if ( degenerate ) {
		return {
			offset: [0, 0],
			pivotOffset: [0, 0],
			incomingBodyInnerOffset: null,
			outgoingBodyInnerOffset: null,
			exactOffset: [0, 0],
			side: 0,
			incomingLength,
			outgoingLength,
			turnDot: 1,
			turnCross: 0,
			incomingDemand: 0,
			outgoingDemand: 0,
			demand: 0,
			available: Math.min( incomingLength, outgoingLength ) * ( 1 - TOPOLOGY_SUPPORT_EPSILON ),
			reversal: false,
			defined: false,
			supported: false,
			fallback: 'degenerate',
		}
	}

	const incomingDirection = [incomingX / incomingLength, incomingY / incomingLength]
	const outgoingDirection = [outgoingX / outgoingLength, outgoingY / outgoingLength]
	const turnDot = Math.max( -1, Math.min( 1,
		incomingDirection[0] * outgoingDirection[0] + incomingDirection[1] * outgoingDirection[1]
	) )
	const turnCross = incomingDirection[0] * outgoingDirection[1] - incomingDirection[1] * outgoingDirection[0]
	const reversal = turnDot <= REVERSAL_DOT_THRESHOLD
	const straight = Math.abs( turnCross ) <= MIN_DIRECTION_LENGTH && !reversal
	if ( reversal || straight ) {
		return {
			offset: [0, 0],
			pivotOffset: [0, 0],
			incomingBodyInnerOffset: null,
			outgoingBodyInnerOffset: null,
			exactOffset: [0, 0],
			side: 0,
			incomingLength,
			outgoingLength,
			turnDot,
			turnCross,
			incomingDemand: 0,
			outgoingDemand: 0,
			demand: 0,
			available: Math.min( incomingLength, outgoingLength ) * ( 1 - TOPOLOGY_SUPPORT_EPSILON ),
			reversal,
			defined: false,
			supported: straight,
			fallback: reversal ? 'reversal' : 'exact',
		}
	}

	const exact = computeInnerJoinOffset( incomingDirection, outgoingDirection, halfWidth )
	const incomingNormal = [-incomingDirection[1], incomingDirection[0]]
	const incomingBaseX = incomingNormal[0] * exact.side * halfWidth
	const incomingBaseY = incomingNormal[1] * exact.side * halfWidth
	const incomingDemand = Math.abs(
		( exact.offset[0] - incomingBaseX ) * incomingDirection[0] +
		( exact.offset[1] - incomingBaseY ) * incomingDirection[1]
	)
	const outgoingNormal = [-outgoingDirection[1], outgoingDirection[0]]
	const outgoingBaseX = outgoingNormal[0] * exact.side * halfWidth
	const outgoingBaseY = outgoingNormal[1] * exact.side * halfWidth
	const outgoingDemand = Math.abs(
		( exact.offset[0] - outgoingBaseX ) * outgoingDirection[0] +
		( exact.offset[1] - outgoingBaseY ) * outgoingDirection[1]
	)
	const demand = Math.max( incomingDemand, outgoingDemand )
	const available = Math.min( incomingLength, outgoingLength ) * ( 1 - TOPOLOGY_SUPPORT_EPSILON )
	const supported = (
		!exact.fallback && Number.isFinite( demand ) &&
		incomingDemand <= incomingLength * ( 1 - TOPOLOGY_SUPPORT_EPSILON ) &&
		outgoingDemand <= outgoingLength * ( 1 - TOPOLOGY_SUPPORT_EPSILON )
	)
	const pivotOffset = supported ? exact.offset : [0, 0]
	return {
		offset: pivotOffset,
		pivotOffset,
		incomingBodyInnerOffset: supported ? exact.offset : [incomingBaseX, incomingBaseY],
		outgoingBodyInnerOffset: supported ? exact.offset : [outgoingBaseX, outgoingBaseY],
		exactOffset: exact.offset,
		side: exact.side,
		incomingLength,
		outgoingLength,
		turnDot,
		turnCross,
		incomingDemand,
		outgoingDemand,
		demand,
		available,
		reversal: false,
		defined: !exact.fallback,
		supported,
		fallback: supported ? 'exact' : 'center',
	}
}

const validateInnerJoinSupport = ( lengths, startDemands, endDemands, startSides, endSides ) => {
	const segmentCount = lengths.length
	if (
		startDemands.length !== segmentCount || endDemands.length !== segmentCount ||
		startSides.length !== segmentCount || endSides.length !== segmentCount
	) throw new RangeError( '[MeshLineGPUPath] inner join support arrays must have equal lengths' )

	for ( let segment = 0; segment < segmentCount; segment++ ) {
		const startDemand = startDemands[segment]
		const endDemand = endDemands[segment]
		const sameSide = startDemand > 0 && endDemand > 0 && startSides[segment] === endSides[segment]
		const required = sameSide ? startDemand + endDemand : Math.max( startDemand, endDemand )
		const available = lengths[segment]
		if ( !Number.isFinite( required ) || !Number.isFinite( available ) || required > available * ( 1 - TOPOLOGY_SUPPORT_EPSILON ) ) {
			return { safe: false, segment, required, available, sameSide }
		}
	}
	return { safe: true, segment: -1, required: 0, available: 0, sameSide: false }
}

const encodePrimitive = ( type, slot = 0 ) => ( slot << PRIMITIVE_TYPE_BITS ) | type

/**
 * CPU oracle for the fixed-stride procedural stream decoded by the vertex
 * shader. Each uvec2 is `[type|slot, segmentRecordIndex]` and represents
 * exactly one non-indexed triangle. Only ordinary joins and actual run caps are
 * emitted; extra join slots exist solely when round caps need enough records to
 * turn a projection-induced reversal into a semicircle without GPU readback.
 */
const createProceduralPrimitiveRecords = ( segmentRecords, topologyOptions = {} ) => {
	if ( !( segmentRecords instanceof Uint32Array ) || segmentRecords.length % 4 !== 0 ) {
		throw new TypeError( '[MeshLineGPUPath] segment records must be a complete Uint32Array uvec4 stream' )
	}
	const topology = normalizeTopologyOptions( topologyOptions )
	const layout = getTopologyLayout( topology )
	let recordCount = safeIntegerProduct( 'body primitive record count', segmentRecords.length / 4, 2 )
	for ( let offset = 0; offset < segmentRecords.length; offset += 4 ) {
		if ( segmentRecords[offset + 3] !== segmentRecords[offset + 2] ) {
			recordCount = safeIntegerSum( 'primitive record count', recordCount, layout.joinCapacity )
		}
		if ( segmentRecords[offset] === segmentRecords[offset + 1] ) {
			recordCount = safeIntegerSum( 'primitive record count', recordCount, layout.capPrimitives )
		}
		if ( segmentRecords[offset + 3] === segmentRecords[offset + 2] ) {
			recordCount = safeIntegerSum( 'primitive record count', recordCount, layout.capPrimitives )
		}
	}
	const result = new Uint32Array( safeIntegerProduct( 'primitive record component count', recordCount, PRIMITIVE_RECORD_COMPONENTS ) )
	let write = 0
	const append = ( type, slot, segment ) => {
		result[write++] = encodePrimitive( type, slot )
		result[write++] = segment
	}
	for ( let offset = 0, segment = 0; offset < segmentRecords.length; offset += 4, segment++ ) {
		const previous = segmentRecords[offset]
		const a = segmentRecords[offset + 1]
		const b = segmentRecords[offset + 2]
		const next = segmentRecords[offset + 3]
		append( PRIMITIVE_BODY_A, 0, segment )
		append( PRIMITIVE_BODY_B, 0, segment )
		if ( next !== b ) {
			for ( let slot = 0; slot < layout.joinCapacity; slot++ ) append( PRIMITIVE_JOIN, slot, segment )
		}
		if ( previous === a ) {
			for ( let slot = 0; slot < layout.capPrimitives; slot++ ) append( PRIMITIVE_START_CAP, slot, segment )
		}
		if ( next === b ) {
			for ( let slot = 0; slot < layout.capPrimitives; slot++ ) append( PRIMITIVE_END_CAP, slot, segment )
		}
	}
	return result
}

/** CPU oracle for the GPU dyadic chunk-error pass. */
const computeDyadicChunkErrors = ( points, chunks ) => {
	const normalized = points instanceof Float32Array ? points : normalizeOpenPoints( points )
	if ( !Array.isArray( chunks ) || chunks.length === 0 ) throw new Error( '[MeshLineGPUPath] a non-empty chunk plan is required' )
	const maximumSegments = Math.max( ...chunks.map( chunk => chunk.segmentCount ) )
	const levelCount = Math.ceil( Math.log2( maximumSegments ) ) + 1
	const errors = new Float32Array( chunks.length * levelCount )

	for ( let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++ ) {
		const chunk = chunks[chunkIndex]
		for ( let level = 1; level < levelCount; level++ ) {
			const stride = 2 ** level
			let maximumError = 0
			for ( let local = 0; local <= chunk.segmentCount; local++ ) {
				const intervalStart = Math.floor( local / stride ) * stride
				const intervalEnd = Math.min( intervalStart + stride, chunk.segmentCount )
				maximumError = Math.max( maximumError, pointSegmentDistance(
					normalized,
					chunk.pointStart + local,
					chunk.pointStart + intervalStart,
					chunk.pointStart + intervalEnd
				) )
			}
			errors[chunkIndex * levelCount + level] = maximumError
		}
	}
	return { errors, levelCount }
}

/**
 * Per-point diagnostic importance derived from the same dyadic intervals.
 * It is useful as a CPU oracle, but the renderer selects one proven stride per
 * chunk from `computeDyadicChunkErrors()` rather than thresholding these values.
 */
const computeDyadicImportance = ( points, chunks = null ) => {
	const normalized = points instanceof Float32Array ? points : normalizeOpenPoints( points )
	const pointCount = normalized.length / 3
	const plan = chunks ?? createChunkPlan( pointCount )
	const importance = new Float32Array( pointCount )

	for ( const chunk of plan ) {
		importance[chunk.pointStart] = MAX_FLOAT32
		importance[chunk.pointStart + chunk.segmentCount] = MAX_FLOAT32
		const levelCount = Math.ceil( Math.log2( chunk.segmentCount ) ) + 1
		for ( let level = 1; level < levelCount; level++ ) {
			const stride = 2 ** level
			for ( let local = 1; local < chunk.segmentCount; local++ ) {
				const intervalStart = Math.floor( local / stride ) * stride
				const intervalEnd = Math.min( intervalStart + stride, chunk.segmentCount )
				const error = pointSegmentDistance(
					normalized,
					chunk.pointStart + local,
					chunk.pointStart + intervalStart,
					chunk.pointStart + intervalEnd
				)
				importance[chunk.pointStart + local] = Math.max( importance[chunk.pointStart + local], error )
			}
		}
	}
	return importance
}

/**
 * Stable CPU scatter oracle. Records are `[previous, a, b, next]`; invisible
 * chunks start/end independent runs and therefore never bridge a culled gap.
 */
const createStableSegmentRecords = ( pointCount, chunks, visible = null, keep = null, breaks = null ) => {
	if ( !Number.isSafeInteger( pointCount ) || pointCount < 2 ) throw new RangeError( '[MeshLineGPUPath] invalid pointCount' )
	if ( !Array.isArray( chunks ) || chunks.length === 0 ) throw new Error( '[MeshLineGPUPath] a non-empty chunk plan is required' )
	if ( visible != null && visible.length < chunks.length ) throw new RangeError( '[MeshLineGPUPath] visibility array is shorter than the chunk plan' )
	if ( keep != null && keep.length < pointCount ) throw new RangeError( '[MeshLineGPUPath] keep array is shorter than pointCount' )
	if ( breaks != null && breaks.length < pointCount ) throw new RangeError( '[MeshLineGPUPath] reversal array is shorter than pointCount' )
	const canonicalPlan = visible == null && keep == null && chunks.every( ( chunk, index ) => (
		chunk.segmentStart === chunk.pointStart &&
		chunk.segmentStart === ( index === 0 ? 0 : chunks[index - 1].segmentStart + chunks[index - 1].segmentCount )
	) ) && chunks[chunks.length - 1].segmentStart + chunks[chunks.length - 1].segmentCount === pointCount - 1
	if ( canonicalPlan ) {
		const segmentCount = pointCount - 1
		const records = new Uint32Array( safeIntegerProduct( 'segment record component count', segmentCount, 4 ) )
		let write = 0
		for ( let a = 0; a < segmentCount; a++ ) {
			const b = a + 1
			records[write++] = a === 0 || breaks?.[a] ? a : a - 1
			records[write++] = a
			records[write++] = b
			records[write++] = b === pointCount - 1 || breaks?.[b] ? b : b + 1
		}
		return records
	}

	const selected = new Array( chunks.length )
	let recordCount = 0
	for ( let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++ ) {
		if ( visible != null && !visible[chunkIndex] ) {
			selected[chunkIndex] = null
			continue
		}
		const chunk = chunks[chunkIndex]
		const ids = [chunk.pointStart]
		for ( let local = 1; local < chunk.segmentCount; local++ ) {
			const point = chunk.pointStart + local
			if ( keep == null || keep[point] ) ids.push( point )
		}
		ids.push( chunk.pointStart + chunk.segmentCount )
		selected[chunkIndex] = ids
		recordCount += ids.length - 1
	}

	const records = new Uint32Array( safeIntegerProduct( 'segment record component count', recordCount, 4 ) )
	let write = 0
	for ( let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++ ) {
		const ids = selected[chunkIndex]
		if ( !ids ) continue
		const previousChunk = chunkIndex > 0 ? selected[chunkIndex - 1] : null
		const nextChunk = chunkIndex + 1 < chunks.length ? selected[chunkIndex + 1] : null
		for ( let segment = 0; segment < ids.length - 1; segment++ ) {
			const a = ids[segment]
			const b = ids[segment + 1]
			const previous = breaks?.[a]
				? a
				: segment > 0
					? ids[segment - 1]
					: previousChunk && previousChunk[previousChunk.length - 1] === a
						? previousChunk[previousChunk.length - 2]
						: a
			const next = breaks?.[b]
				? b
				: segment + 2 < ids.length
					? ids[segment + 2]
					: nextChunk && nextChunk[0] === b
						? nextChunk[1]
						: b
			records[write++] = previous
			records[write++] = a
			records[write++] = b
			records[write++] = next
		}
	}
	return records
}

const packPoints = ( points, breaks = null ) => {
	const packed = new Float32Array( points.length / 3 * 4 )
	for ( let point = 0; point < points.length / 3; point++ ) {
		packed[point * 4] = points[point * 3]
		packed[point * 4 + 1] = points[point * 3 + 1]
		packed[point * 4 + 2] = points[point * 3 + 2]
		packed[point * 4 + 3] = breaks?.[point] ? 1 : 0
	}
	return packed
}

const packChunks = chunks => {
	const packed = new Uint32Array( chunks.length * 4 )
	for ( let i = 0; i < chunks.length; i++ ) {
		packed[i * 4] = chunks[i].pointStart
		packed[i * 4 + 1] = chunks[i].segmentStart
		packed[i * 4 + 2] = chunks[i].segmentCount
	}
	return packed
}

const hasAnyClosedLine = closed => Array.isArray( closed ) ? closed.some( Boolean ) : closed === true

const getUnsupportedReason = ( options, fallback ) => {
	if ( fallback.geometry?._lines?.length !== 1 ) return 'the experimental GPU path currently supports one line'
	if ( hasAnyClosedLine( options.closed ) ) return 'closed lines are not supported by the experimental GPU path'
	if ( options.surface ) return 'road/surface geometry is not supported by the stage-1 GPU path'
	if ( options.shadow ) return 'shadow passes are not supported by the experimental GPU path'
	if ( options.instanceCount != null && options.instanceCount >= 0 ) return 'instancing is not supported by the experimental GPU path'
	if ( options.smoothSharpBends ) return 'CPU topology smoothing is not composable with the experimental GPU path'

	const unsupportedOptions = [
		'widthCallback',
		'gradientColor',
		'map',
		'alphaMap',
		'vertexColors',
		'dash',
		'dashCount',
		'dashRatio',
		'dashOffset',
		'gpuPositionNode',
		'positionFn',
		'previousFn',
		'nextFn',
		'widthFn',
		'normalFn',
		'colorFn',
		'gradientFn',
		'opacityFn',
		'dashFn',
		'uvFn',
		'vertexFn',
		'fragmentColorFn',
		'fragmentAlphaFn',
		'discardFn',
	]
	for ( const key of unsupportedOptions ) {
		if ( options[key] != null ) return `${key} is not supported by the experimental GPU path`
	}
	const optionalAttributes = [
		'needsUV',
		'needsWidth',
		'needsProgress',
		'needsPrevious',
		'needsNext',
		'needsSide',
		'needsVertexColor',
	]
	for ( const key of optionalAttributes ) {
		if ( options[key] === true ) return `${key} is not exposed by the experimental GPU path`
	}
	const topology = normalizeTopologyOptions( options, fallback )
	if ( !['miter', 'bevel', 'round'].includes( topology.join.type ) ) return `join type ${topology.join.type} is not supported by the experimental GPU path`
	if ( !Number.isFinite( topology.join.limit ) || topology.join.limit < 1 ) return 'join.limit must be finite and at least 1'
	if ( !Number.isSafeInteger( topology.join.segments ) || topology.join.segments < 1 ) return 'join.segments must be a positive safe integer'
	if ( !['butt', 'square', 'round'].includes( topology.cap.type ) ) return `cap type ${topology.cap.type} is not supported by the experimental GPU path`
	if ( !Number.isSafeInteger( topology.cap.segments ) || topology.cap.segments < 1 ) return 'cap.segments must be a positive safe integer'
	if ( topology.cap.type === 'round' && topology.cap.segments < 2 ) return 'round caps require cap.segments of at least 2'
	if ( topology.join.type === 'round' && topology.join.segments > MAX_TOPOLOGY_SEGMENTS ) {
		return `round join segments exceed the GPU-path limit of ${MAX_TOPOLOGY_SEGMENTS}`
	}
	if ( topology.cap.type === 'round' && topology.cap.segments > MAX_TOPOLOGY_SEGMENTS ) {
		return `round cap segments exceed the GPU-path limit of ${MAX_TOPOLOGY_SEGMENTS}`
	}
	return null
}

const makeStatus = () => ( {
	enabled: false,
	active: false,
	backend: 'unprepared',
	reason: 'call prepare( renderer, camera ) to select the native-WebGPU path',
	fallback: 'cpu-full-detail',
	pointCount: 0,
	segmentCapacity: 0,
	chunkCount: 0,
	stableOrder: true,
	segmentRecords: 'derived',
	primitiveRecords: 'procedural-fixed-stride',
	primitiveCapacity: 0,
	primitivesPerSegment: 2,
	prefixScan: 'none',
	culling: false,
	simplification: 'off',
	toleranceSpace: null,
	toleranceGuaranteed: false,
	join: 'miter',
	cap: 'butt',
	topology: 'fixed-strip',
	topologySafety: 'not-required',
	topologySafetyReason: null,
	reversalSplitting: 'source-and-projected',
	homogeneousClipping: true,
	coordinateSystem: 'webgpu-0-to-1',
	reversedDepth: false,
	lastError: null,
} )

// The GPU mesh's `vertexNode` strokes points from storage, so its geometry
// `position` is a template, as it is for placed billboard lines. Builds that
// read a position accessor get the stroked centerline through the same node.
class MeshLineGPUPathMaterial extends MeshBasicNodeMaterial {

	setupPosition( builder ) {
		const position = super.setupPosition( builder )
		if ( this._placedPositionNode ) this._placedPositionNode.toStack()
		return position
	}

	copy( source ) {
		this._placedPositionNode = source._placedPositionNode ?? null
		return super.copy( source )
	}

}

/**
 * Experimental point-centric native-WebGPU renderer for one open screen line.
 *
 * The wrapper always retains a complete CPU `MeshLine` child. Unsupported
 * inputs/backends and explicit failures keep that child visible. The GPU child
 * uses one stable non-indexed indirect draw and four-u32 segment records, with
 * no source/output index buffers and no GPU readback in the update path.
 */
export class MeshLineGPUPath extends Group {

	constructor( lineOptions = {}, gpuOptions = {} ) {
		super()
		this.type = 'MeshLineGPUPath'
		this.isMeshLineGPUPath = true
		this.lineOptions = { ...lineOptions }
		this.gpuOptions = {
			chunkSegments: finitePositiveInteger( gpuOptions.chunkSegments, DEFAULT_CHUNK_SEGMENTS ),
			simplify: gpuOptions.simplify ?? false,
			localTolerance: Number( gpuOptions.localTolerance ?? gpuOptions.simplify?.localTolerance ?? DEFAULT_LOCAL_TOLERANCE ),
			variableTopology: gpuOptions.variableTopology === true,
		}
		if ( !isPowerOfTwo( this.gpuOptions.chunkSegments ) ) {
			throw new RangeError( `[MeshLineGPUPath] chunkSegments must be a power of two no greater than ${MAX_CHUNK_SEGMENTS}` )
		}
		if ( !Number.isFinite( this.gpuOptions.localTolerance ) || this.gpuOptions.localTolerance < 0 ) {
			throw new RangeError( '[MeshLineGPUPath] localTolerance must be finite and non-negative' )
		}

		this.fallback = new MeshLine( lineOptions ).build()
		this.fallback.name = `${this.name || 'MeshLineGPUPath'}:CPUFallback`
		this.add( this.fallback )
		this.gpuMesh = null
		this.status = makeStatus()
		this._renderer = null
		this._backend = null
		this._device = null
		this._points = null
		this._breaks = null
		this._chunks = null
		this._resources = null
		this._computeNodes = []
		this._resolution = new Vector2( Number( lineOptions.renderWidth ?? 1 ), Number( lineOptions.renderHeight ?? 1 ) )
		this._unsupportedReason = getUnsupportedReason( lineOptions, this.fallback )
	}

	async prepare( renderer, camera = null ) {
		if ( camera?.isArrayCamera === true ) return this._useFallback( 'ArrayCamera/XR is not supported by the experimental GPU path' )
		this._unsupportedReason = getUnsupportedReason( this.lineOptions, this.fallback )
		if ( this._unsupportedReason ) return this._useFallback( this._unsupportedReason )
		try {
			if ( typeof renderer?.init === 'function' ) await renderer.init()
			const nativeWebGPU = !!(
				renderer?.isWebGPURenderer === true &&
				renderer?.backend?.isWebGPUBackend === true &&
				typeof renderer.computeAsync === 'function'
			)
			if ( !nativeWebGPU ) return this._useFallback( 'native WebGPU compute is unavailable' )
			if ( renderer.coordinateSystem != null && renderer.coordinateSystem !== WebGPUCoordinateSystem ) {
				return this._useFallback( 'renderer coordinate system is not WebGPU 0-to-1 clip space' )
			}
			this._renderer = renderer
			this._backend = renderer.backend
			this._device = renderer.backend?.device ?? null
			this.status.reversedDepth = renderer.reversedDepthBuffer === true
			const configuredLines = this.lineOptions.lines
			const configuredGeometry = configuredLines?.isBufferGeometry === true
				? configuredLines
				: Array.isArray( configuredLines ) && configuredLines.length === 1 && configuredLines[0]?.isBufferGeometry === true
					? configuredLines[0]
					: null
			const source = configuredGeometry ?? this.fallback.geometry?._lines?.[0] ?? configuredLines
			this._points = normalizeOpenPoints( source )
			this._breaks = findReversalBreaks( this._points )
			this._chunks = createChunkPlan( this._points.length / 3, this.gpuOptions.chunkSegments )
			if ( typeof renderer.getSize === 'function' ) {
				const size = renderer.getSize( new Vector2() )
				if ( size?.x > 0 && size?.y > 0 ) this.resize( size.x, size.y )
			}
			this._disposeGPU()
			this._createGPUResources()
			if ( this._computeNodes.length > 0 ) await renderer.computeAsync( this._computeNodes )
			this.fallback.visible = false
			this.gpuMesh.visible = true
			this.status.enabled = true
			this.status.active = true
			this.status.backend = 'webgpu'
			this.status.reason = 'stable native-WebGPU procedural topology path active'
			this.status.fallback = null
			this.status.lastError = null
			return true
		} catch ( error ) {
			return this._useFallback( 'GPU-path preparation failed', error )
		}
	}

	update( camera = null ) {
		if ( camera?.isArrayCamera === true ) return this._useFallback( 'ArrayCamera/XR requires the CPU full-detail path' )
		if ( !this.status.active ) return false
		if ( this._renderer?.backend !== this._backend || ( this._device && this._renderer?.backend?.device !== this._device ) ) {
			return this._useFallback( 'renderer backend/device changed; call prepare() again' )
		}
		return true
	}

	resize( width, height ) {
		width = Number( width )
		height = Number( height )
		if ( !Number.isFinite( width ) || !Number.isFinite( height ) || width <= 0 || height <= 0 ) {
			throw new RangeError( '[MeshLineGPUPath] resize dimensions must be finite and greater than zero' )
		}
		this._resolution.set( width, height )
		if ( this._resources?.resolutionNode ) this._resources.resolutionNode.value.copy( this._resolution )
		return this
	}

	wireframe( enabled = true ) {
		const active = Boolean( enabled )
		this.lineOptions.wireframe = active
		this.fallback.wireframe( active )
		if ( this._resources?.wireframeNode ) {
			this._resources.wireframeNode.value = active ? 1 : 0
		}
		if ( this.gpuMesh ) {
			this.gpuMesh.isLineSegments = active
			if ( this.gpuMesh.geometry ) {
				this.gpuMesh.geometry.indirectOffset = active ? 16 : 0
			}
		}
		return this
	}

	async setSimplificationTolerance( localTolerance ) {
		localTolerance = Number( localTolerance )
		if ( !Number.isFinite( localTolerance ) || localTolerance < 0 ) {
			throw new RangeError( '[MeshLineGPUPath] localTolerance must be finite and non-negative' )
		}
		this.gpuOptions.localTolerance = localTolerance
		if ( this._resources?.toleranceNode ) this._resources.toleranceNode.value = localTolerance
		if ( this.status.active && this._computeNodes.length > 1 ) {
			try {
				await this._renderer.computeAsync( this._computeNodes.slice( 1 ) )
			} catch ( error ) {
				this._useFallback( 'GPU simplification update failed', error )
			}
		}
		return this
	}

	async setPositions( points ) {
		const normalized = normalizeOpenPoints( points )
		this.fallback.setPositions( normalized, true )
		this.lineOptions.lines = normalized
		if ( !this._renderer ) {
			this._points = normalized
			return this
		}
		this._points = normalized
		await this.prepare( this._renderer )
		return this
	}

	_useFallback( reason, error = null ) {
		this.fallback.visible = true
		if ( this.gpuMesh ) this.gpuMesh.visible = false
		this._disposeGPU()
		this.status.enabled = false
		this.status.active = false
		this.status.backend = this._renderer?.backend?.isWebGPUBackend === true ? 'webgpu' : 'fallback'
		this.status.reason = `${reason}; drawing the complete CPU MeshLine`
		this.status.fallback = 'cpu-full-detail'
		this.status.lastError = error ?? null
		return false
	}

	_createGPUResources() {
		const pointCount = this._points.length / 3
		const segmentCount = pointCount - 1
		const chunkCount = this._chunks.length
		const levelCount = Math.log2( this.gpuOptions.chunkSegments ) + 1
		const topology = normalizeTopologyOptions( this.lineOptions, this.fallback )
		const topologyLayout = getTopologyLayout( topology, this.gpuOptions.variableTopology )
		const advancedTopology = topologyLayout.advanced
		const simplifyRequested = !!this.gpuOptions.simplify
		// Local-space simplification cannot prove that a removed point will not
		// become a cusp after projection. Variable topology therefore stays at
		// full detail until classification runs in the active camera's clip space.
		const simplify = simplifyRequested && !advancedTopology
		const runCount = 1 + this._breaks.reduce( ( count, split ) => count + ( split ? 1 : 0 ), 0 )
		const resourcePlan = assertGPUResourcePlan( createGPUResourcePlan( {
			pointCount,
			segmentCount,
			chunkCount,
			levelCount,
			runCount,
			simplify,
			advancedTopology,
			topologyLayout,
		} ), this._device )
		const { primitiveCapacity, maximumVertexCount } = resourcePlan
		if ( maximumVertexCount > UINT32_MAX ) throw new RangeError( '[MeshLineGPUPath] indirect vertex count would overflow uint32' )

		const rawSegmentRecords = advancedTopology && !simplify
			? createStableSegmentRecords( pointCount, this._chunks, null, null, this._breaks )
			: null
		const rawPrimitiveRecords = rawSegmentRecords
			? createProceduralPrimitiveRecords( rawSegmentRecords, topology )
			: null
		const pointAttribute = new StorageBufferAttribute( packPoints( this._points, this._breaks ), 4 )
		const chunkAttribute = simplify ? new StorageBufferAttribute( packChunks( this._chunks ), 4, Uint32Array ) : null
		const errorAttribute = simplify ? new StorageBufferAttribute( chunkCount * levelCount, 1 ) : null
		const stateAttribute = simplify ? new StorageBufferAttribute( chunkCount, 4, Uint32Array ) : null
		const segmentAttribute = simplify
			? new StorageBufferAttribute( segmentCount, 4, Uint32Array )
			: rawSegmentRecords
				? new StorageBufferAttribute( rawSegmentRecords, 4 )
				: null
		const primitiveStateAttribute = simplify && advancedTopology ? new StorageBufferAttribute( segmentCount, 4, Uint32Array ) : null
		const primitiveAttribute = advancedTopology
			? rawPrimitiveRecords
				? new StorageBufferAttribute( rawPrimitiveRecords, PRIMITIVE_RECORD_COMPONENTS )
				: new StorageBufferAttribute( primitiveCapacity, PRIMITIVE_RECORD_COMPONENTS, Uint32Array )
			: null
		const initialVertexCount = rawPrimitiveRecords ? rawPrimitiveRecords.length / PRIMITIVE_RECORD_COMPONENTS * 3 : segmentCount * 6
		const indirectAttribute = new IndirectStorageBufferAttribute(
			new Uint32Array( [initialVertexCount, 1, 0, 0, initialVertexCount * 2, 1, 0, 0] ),
			1
		)

		const points = storage( pointAttribute, 'vec4', pointCount ).toReadOnly()
		const segments = segmentAttribute ? storage( segmentAttribute, 'uvec4', segmentCount ) : null
		const primitives = primitiveAttribute ? storage( primitiveAttribute, 'uvec2', primitiveAttribute.count ) : null
		const toleranceNode = simplify ? uniform( this.gpuOptions.localTolerance ) : null
		const resolutionNode = uniform( this._resolution.clone() )
		const wireframe = Boolean( this.lineOptions.wireframe )
		const wireframeNode = uniform( uint( wireframe ? 1 : 0 ) )
		const computeNodes = []

		if ( simplify ) {
			const chunks = storage( chunkAttribute, 'uvec4', chunkCount ).toReadOnly()
			const errors = storage( errorAttribute, 'float', chunkCount * levelCount )
			const states = storage( stateAttribute, 'uvec4', chunkCount )
			const indirect = storage( indirectAttribute, 'uint', 8 )

			const errorNode = Fn( () => {
				const invocation = instanceIndex.toUint()
				If( invocation.lessThan( uint( chunkCount * levelCount ) ), () => {
					const chunkIndex = invocation.div( uint( levelCount ) )
					const level = invocation.mod( uint( levelCount ) )
					const stride = uint( 1 ).shiftLeft( level )
					const chunk = chunks.element( chunkIndex )
					const maximumError = float( 0 ).toVar()

					Loop( { start: uint( 0 ), end: chunk.z.add( uint( 1 ) ), type: 'uint', condition: '<' }, ( { i } ) => {
						const intervalStart = i.div( stride ).mul( stride )
						const intervalEnd = min( intervalStart.add( stride ), chunk.z )
						const point = points.element( chunk.x.add( i ) ).xyz
						const start = points.element( chunk.x.add( intervalStart ) ).xyz
						const end = points.element( chunk.x.add( intervalEnd ) ).xyz
						const chord = end.sub( start )
						const denominator = max( dot( chord, chord ), 1e-12 )
						const t = dot( point.sub( start ), chord ).div( denominator ).clamp( 0, 1 )
						maximumError.assign( max( maximumError, length( point.sub( start.add( chord.mul( t ) ) ) ) ) )
						If(
							points.element( chunk.x.add( i ) ).w.greaterThan( float( 0.5 ) )
								.and( i.greaterThan( uint( 0 ) ) )
								.and( i.lessThan( chunk.z ) )
								.and( i.mod( stride ).notEqual( uint( 0 ) ) ),
							() => { maximumError.assign( float( MAX_FLOAT32 ) ) }
						)
					} )
					errors.element( invocation ).assign( maximumError )
				} )
			} )().compute( chunkCount * levelCount )

			const classifyNode = Fn( () => {
				const chunkIndex = instanceIndex.toUint()
				If( chunkIndex.lessThan( uint( chunkCount ) ), () => {
					const chunk = chunks.element( chunkIndex )
					const selectedStride = uint( 1 ).toVar()
					for ( let level = 1; level < levelCount; level++ ) {
						const candidateStride = uint( 2 ** level )
						const error = errors.element( chunkIndex.mul( uint( levelCount ) ).add( uint( level ) ) )
						If( error.lessThanEqual( toleranceNode ), () => {
							selectedStride.assign( candidateStride )
						} )
					}
					const retainedSegments = chunk.z.add( selectedStride ).sub( uint( 1 ) ).div( selectedStride )
					states.element( chunkIndex ).assign( uvec4( selectedStride, retainedSegments, 0, 0 ) )
				} )
			} )().compute( chunkCount )

			let prefixNode
			if ( chunkCount <= PARALLEL_PREFIX_THRESHOLD ) {
				prefixNode = Fn( () => {
					If( instanceIndex.equal( uint( 0 ) ), () => {
						const running = uint( 0 ).toVar()
						Loop( { start: uint( 0 ), end: uint( chunkCount ), type: 'uint', condition: '<' }, ( { i } ) => {
							const state = states.element( i )
							states.element( i ).assign( uvec4( state.x, state.y, running, state.w ) )
							running.addAssign( state.y )
						} )
						const triVertices = advancedTopology ? running : running.mul( uint( 6 ) )
						indirect.element( uint( 0 ) ).assign( triVertices )
						indirect.element( uint( 1 ) ).assign( uint( 1 ) )
						indirect.element( uint( 2 ) ).assign( uint( 0 ) )
						indirect.element( uint( 3 ) ).assign( uint( 0 ) )
						indirect.element( uint( 4 ) ).assign( triVertices.mul( uint( 2 ) ) )
						indirect.element( uint( 5 ) ).assign( uint( 1 ) )
						indirect.element( uint( 6 ) ).assign( uint( 0 ) )
						indirect.element( uint( 7 ) ).assign( uint( 0 ) )
					} )
				} )().compute( 1 )
			} else {
				const prefixShared = workgroupArray( 'uint', PREFIX_WORKGROUP_SIZE )
				const chunksPerLane = Math.floor( chunkCount / PREFIX_WORKGROUP_SIZE )
				const extraChunkLanes = chunkCount % PREFIX_WORKGROUP_SIZE
				prefixNode = Fn( () => {
					const lane = invocationLocalIndex.toUint()
					const receivesExtraChunk = lane.lessThan( uint( extraChunkLanes ) ).select( uint( 1 ), uint( 0 ) )
					const rangeStart = lane.mul( uint( chunksPerLane ) ).add( min( lane, uint( extraChunkLanes ) ) )
					const rangeEnd = rangeStart.add( uint( chunksPerLane ) ).add( receivesExtraChunk )
					const laneTotal = uint( 0 ).toVar()

					Loop( { start: rangeStart, end: rangeEnd, type: 'uint', condition: '<' }, ( { i } ) => {
						laneTotal.addAssign( states.element( i ).y )
					} )
					prefixShared.element( lane ).assign( laneTotal )
					workgroupBarrier()

					for ( let offset = 1; offset < PREFIX_WORKGROUP_SIZE; offset *= 2 ) {
						const addition = uint( 0 ).toVar()
						If( lane.greaterThanEqual( uint( offset ) ), () => {
							addition.assign( prefixShared.element( lane.sub( uint( offset ) ) ) )
						} )
						workgroupBarrier()
						prefixShared.element( lane ).addAssign( addition )
						workgroupBarrier()
					}

					const running = uint( 0 ).toVar()
					If( lane.greaterThan( uint( 0 ) ), () => {
						running.assign( prefixShared.element( lane.sub( uint( 1 ) ) ) )
					} )
					Loop( { start: rangeStart, end: rangeEnd, type: 'uint', condition: '<' }, ( { i } ) => {
						const state = states.element( i )
						states.element( i ).assign( uvec4( state.x, state.y, running, state.w ) )
						running.addAssign( state.y )
					} )

					If( lane.equal( uint( 0 ) ), () => {
						const total = prefixShared.element( uint( PREFIX_WORKGROUP_SIZE - 1 ) )
						const triVertices = advancedTopology ? total : total.mul( uint( 6 ) )
						indirect.element( uint( 0 ) ).assign( triVertices )
						indirect.element( uint( 1 ) ).assign( uint( 1 ) )
						indirect.element( uint( 2 ) ).assign( uint( 0 ) )
						indirect.element( uint( 3 ) ).assign( uint( 0 ) )
						indirect.element( uint( 4 ) ).assign( triVertices.mul( uint( 2 ) ) )
						indirect.element( uint( 5 ) ).assign( uint( 1 ) )
						indirect.element( uint( 6 ) ).assign( uint( 0 ) )
						indirect.element( uint( 7 ) ).assign( uint( 0 ) )
					} )
				} )().compute( PREFIX_WORKGROUP_SIZE, [PREFIX_WORKGROUP_SIZE] )
			}

			const emitNode = Fn( () => {
				const sourceSegment = instanceIndex.toUint()
				If( sourceSegment.lessThan( uint( segmentCount ) ), () => {
					const chunkIndex = sourceSegment.div( uint( this.gpuOptions.chunkSegments ) )
					const chunk = chunks.element( chunkIndex )
					const state = states.element( chunkIndex )
					const localSegment = sourceSegment.sub( chunk.y )
					If( localSegment.lessThan( chunk.z ).and( localSegment.mod( state.x ).equal( uint( 0 ) ) ), () => {
						const a = chunk.x.add( localSegment )
						const b = chunk.x.add( min( localSegment.add( state.x ), chunk.z ) )
						const previous = a.toVar()
						const next = b.toVar()

						If( localSegment.greaterThan( uint( 0 ) ), () => {
							previous.assign( a.sub( min( state.x, localSegment ) ) )
						} ).ElseIf( chunkIndex.greaterThan( uint( 0 ) ), () => {
							const previousChunk = chunks.element( chunkIndex.sub( uint( 1 ) ) )
							const previousState = states.element( chunkIndex.sub( uint( 1 ) ) )
							previous.assign( a.sub( min( previousState.x, previousChunk.z ) ) )
						} )

						If( b.lessThan( chunk.x.add( chunk.z ) ), () => {
							next.assign( min( b.add( state.x ), chunk.x.add( chunk.z ) ) )
						} ).ElseIf( chunkIndex.add( uint( 1 ) ).lessThan( uint( chunkCount ) ), () => {
							const nextChunk = chunks.element( chunkIndex.add( uint( 1 ) ) )
							const nextState = states.element( chunkIndex.add( uint( 1 ) ) )
							next.assign( b.add( min( nextState.x, nextChunk.z ) ) )
						} )
						If( points.element( a ).w.greaterThan( float( 0.5 ) ), () => { previous.assign( a ) } )
						If( points.element( b ).w.greaterThan( float( 0.5 ) ), () => { next.assign( b ) } )

						const destination = state.z.add( localSegment.div( state.x ) )
						segments.element( destination ).assign( uvec4( previous, a, b, next ) )
					} )
				} )
			} )().compute( segmentCount )

			computeNodes.push( errorNode, classifyNode, prefixNode, emitNode )

			if ( advancedTopology ) {
				const primitiveStates = storage( primitiveStateAttribute, 'uvec4', segmentCount )
				const primitiveClassifyNode = Fn( () => {
					const segment = instanceIndex.toUint()
					const retainedCount = indirect.element( uint( 0 ) )
					If( segment.lessThan( uint( segmentCount ) ), () => {
						const count = uint( 0 ).toVar()
						If( segment.lessThan( retainedCount ), () => {
							const record = segments.element( segment )
							count.assign( uint( 2 ) )
							If( record.w.notEqual( record.z ), () => { count.addAssign( uint( topologyLayout.joinCapacity ) ) } )
							If( record.x.equal( record.y ), () => { count.addAssign( uint( topologyLayout.capPrimitives ) ) } )
							If( record.w.equal( record.z ), () => { count.addAssign( uint( topologyLayout.capPrimitives ) ) } )
						} )
						primitiveStates.element( segment ).assign( uvec4( count, 0, 0, 0 ) )
					} )
				} )().compute( segmentCount )

				let primitivePrefixNode
				if ( segmentCount <= PARALLEL_PREFIX_THRESHOLD ) {
					primitivePrefixNode = Fn( () => {
						If( instanceIndex.equal( uint( 0 ) ), () => {
							const running = uint( 0 ).toVar()
							Loop( { start: uint( 0 ), end: uint( segmentCount ), type: 'uint', condition: '<' }, ( { i } ) => {
								const state = primitiveStates.element( i )
								primitiveStates.element( i ).assign( uvec4( state.x, running, 0, 0 ) )
								running.addAssign( state.x )
							} )
							const triVertices = running.mul( uint( 3 ) )
							indirect.element( uint( 0 ) ).assign( triVertices )
							indirect.element( uint( 4 ) ).assign( triVertices.mul( uint( 2 ) ) )
						} )
					} )().compute( 1 )
				} else {
					const primitivePrefixShared = workgroupArray( 'uint', PREFIX_WORKGROUP_SIZE )
					const segmentsPerLane = Math.floor( segmentCount / PREFIX_WORKGROUP_SIZE )
					const extraSegmentLanes = segmentCount % PREFIX_WORKGROUP_SIZE
					primitivePrefixNode = Fn( () => {
						const lane = invocationLocalIndex.toUint()
						const receivesExtraSegment = lane.lessThan( uint( extraSegmentLanes ) ).select( uint( 1 ), uint( 0 ) )
						const rangeStart = lane.mul( uint( segmentsPerLane ) ).add( min( lane, uint( extraSegmentLanes ) ) )
						const rangeEnd = rangeStart.add( uint( segmentsPerLane ) ).add( receivesExtraSegment )
						const laneTotal = uint( 0 ).toVar()
						Loop( { start: rangeStart, end: rangeEnd, type: 'uint', condition: '<' }, ( { i } ) => {
							laneTotal.addAssign( primitiveStates.element( i ).x )
						} )
						primitivePrefixShared.element( lane ).assign( laneTotal )
						workgroupBarrier()

						for ( let offset = 1; offset < PREFIX_WORKGROUP_SIZE; offset *= 2 ) {
							const addition = uint( 0 ).toVar()
							If( lane.greaterThanEqual( uint( offset ) ), () => {
								addition.assign( primitivePrefixShared.element( lane.sub( uint( offset ) ) ) )
							} )
							workgroupBarrier()
							primitivePrefixShared.element( lane ).addAssign( addition )
							workgroupBarrier()
						}

						const running = uint( 0 ).toVar()
						If( lane.greaterThan( uint( 0 ) ), () => {
							running.assign( primitivePrefixShared.element( lane.sub( uint( 1 ) ) ) )
						} )
						Loop( { start: rangeStart, end: rangeEnd, type: 'uint', condition: '<' }, ( { i } ) => {
							const state = primitiveStates.element( i )
							primitiveStates.element( i ).assign( uvec4( state.x, running, 0, 0 ) )
							running.addAssign( state.x )
						} )
						If( lane.equal( uint( 0 ) ), () => {
							const triVertices = primitivePrefixShared.element( uint( PREFIX_WORKGROUP_SIZE - 1 ) ).mul( uint( 3 ) )
							indirect.element( uint( 0 ) ).assign( triVertices )
							indirect.element( uint( 4 ) ).assign( triVertices.mul( uint( 2 ) ) )
						} )
					} )().compute( PREFIX_WORKGROUP_SIZE, [PREFIX_WORKGROUP_SIZE] )
				}

				const primitiveEmitNode = Fn( () => {
					const segment = instanceIndex.toUint()
					If( segment.lessThan( uint( segmentCount ) ), () => {
						const state = primitiveStates.element( segment )
						If( state.x.greaterThan( uint( 0 ) ), () => {
							const record = segments.element( segment )
							const write = state.y.toVar()
							primitives.element( write ).assign( uvec2( uint( PRIMITIVE_BODY_A ), segment ) )
							write.addAssign( uint( 1 ) )
							primitives.element( write ).assign( uvec2( uint( PRIMITIVE_BODY_B ), segment ) )
							write.addAssign( uint( 1 ) )
							If( record.w.notEqual( record.z ), () => {
								Loop( { start: uint( 0 ), end: uint( topologyLayout.joinCapacity ), type: 'uint', condition: '<' }, ( { i } ) => {
									primitives.element( write ).assign( uvec2( i.mul( uint( 1 << PRIMITIVE_TYPE_BITS ) ).add( uint( PRIMITIVE_JOIN ) ), segment ) )
									write.addAssign( uint( 1 ) )
								} )
							} )
							If( record.x.equal( record.y ), () => {
								Loop( { start: uint( 0 ), end: uint( topologyLayout.capPrimitives ), type: 'uint', condition: '<' }, ( { i } ) => {
									primitives.element( write ).assign( uvec2( i.mul( uint( 1 << PRIMITIVE_TYPE_BITS ) ).add( uint( PRIMITIVE_START_CAP ) ), segment ) )
									write.addAssign( uint( 1 ) )
								} )
							} )
							If( record.w.equal( record.z ), () => {
								Loop( { start: uint( 0 ), end: uint( topologyLayout.capPrimitives ), type: 'uint', condition: '<' }, ( { i } ) => {
									primitives.element( write ).assign( uvec2( i.mul( uint( 1 << PRIMITIVE_TYPE_BITS ) ).add( uint( PRIMITIVE_END_CAP ) ), segment ) )
									write.addAssign( uint( 1 ) )
								} )
							} )
						} )
					} )
				} )().compute( segmentCount )

				computeNodes.push( primitiveClassifyNode, primitivePrefixNode, primitiveEmitNode )
			}
		}

		const geometry = new BufferGeometry()
		// A single template point gives three a finite draw count. It is fetched
		// only by builds that read a position accessor, which then overwrite it
		// with the stroked centerline; one instance-rate element keeps that fetch
		// in bounds for every vertex of the indirect draw.
		geometry.setAttribute( 'position', new InstancedBufferAttribute( new Float32Array( [0, 0, 0] ), 3 ) )
		geometry.setIndirect( indirectAttribute, wireframe ? 16 : 0 )
		const fallbackBox = this.fallback.geometry?.boundingBox
		const fallbackSphere = this.fallback.geometry?.boundingSphere
		geometry.boundingBox = fallbackBox?.clone?.() ?? new Box3().setFromArray( this._points )
		geometry.boundingSphere = fallbackSphere?.clone?.() ?? geometry.boundingBox.getBoundingSphere( new Sphere() )

		const material = this._createGPUMaterial( {
			points,
			segments,
			primitives,
			resolutionNode,
			wireframeNode,
			simplify,
			pointCount,
			topology,
			topologyLayout,
		} )
		const gpuMesh = new Mesh( geometry, material )
		gpuMesh.name = `${this.name || 'MeshLineGPUPath'}:GPU`
		gpuMesh.isLineSegments = wireframe
		gpuMesh.frustumCulled = false
		gpuMesh.castShadow = false
		gpuMesh.receiveShadow = false
		gpuMesh.visible = false
		this.gpuMesh = gpuMesh
		this.add( gpuMesh )
		this._computeNodes = computeNodes
		this._resources = {
			pointAttribute,
			chunkAttribute,
			errorAttribute,
			stateAttribute,
			segmentAttribute,
			primitiveStateAttribute,
			primitiveAttribute,
			indirectAttribute,
			toleranceNode,
			resolutionNode,
			wireframeNode,
		}

		this.status.pointCount = pointCount
		this.status.segmentCapacity = segmentCount
		this.status.chunkCount = chunkCount
		this.status.segmentRecords = simplify || advancedTopology ? 'storage' : 'derived'
		this.status.primitiveRecords = advancedTopology ? 'compact-storage' : 'procedural-fixed-stride'
		this.status.primitiveCapacity = advancedTopology ? primitiveAttribute.count : segmentCount * 2
		this.status.primitivesPerSegment = advancedTopology ? null : 2
		this.status.prefixScan = simplify
			? chunkCount > PARALLEL_PREFIX_THRESHOLD ? 'parallel-256' : 'serial'
			: 'none'
		this.status.simplification = simplify
			? 'experimental-dyadic-local'
			: simplifyRequested ? 'disabled-for-variable-topology' : 'off'
		this.status.toleranceSpace = simplify ? 'local' : null
		this.status.toleranceGuaranteed = simplify ? 'source-points to selected dyadic chords, local-space only' : false
		this.status.join = topology.join.type
		this.status.cap = topology.cap.type
		this.status.topology = advancedTopology ? 'variable-triangles' : 'fixed-strip'
		this.status.topologySafety = advancedTopology ? 'projected-join-guarded' : 'not-required'
		this.status.topologySafetyReason = advancedTopology
			? 'unsupported projected inner intersections keep full-width bodies and use a bounded center pivot for the join wedge; adjacent fallback regions can still overlap'
			: null
		this.status.reversalSplitting = simplify ? 'retained-points-only' : 'source-and-projected'
	}

	_createGPUMaterial( { points, segments, primitives, resolutionNode, wireframeNode, simplify, pointCount, topology, topologyLayout } ) {
		// Read the live CPU oracle after `MeshLine.build()` has validated and
		// Float32-bounded every value used by the GPU profile.
		const lineWidth = Number( this.fallback.material.lineWidth?.value ?? this.lineOptions.lineWidth ?? 0.3 )
		const miterLimit = Number( this.fallback.material.miterLimit ?? this.lineOptions.join?.limit ?? 4 )
		const widthNode = uniform( lineWidth )
		const miterThreshold = uniform( 2 / miterLimit )
		const colorNode = uniform( new Color( this.fallback.material.color?.value ?? this.lineOptions.color ?? 0xffffff ) )
		const opacity = Number( this.fallback.material.opacity?.value ?? this.lineOptions.opacity ?? 1 )
		const opacityNode = uniform( opacity )
		const sizeAttenuation = this.lineOptions.sizeAttenuation !== false
		const paddingFactor = Math.max(
			topology.join.type === 'miter' ? miterLimit : 1,
			topology.cap.type === 'square' ? Math.SQRT2 : 1
		)
		let clipPadding
		if ( sizeAttenuation ) {
			const paddingRadius = widthNode.mul( 0.5 * paddingFactor )
			const projectedX = cameraProjectionMatrix.mul( vec4( paddingRadius, 0, 0, 0 ) )
			const projectedY = cameraProjectionMatrix.mul( vec4( 0, paddingRadius, 0, 0 ) )
			clipPadding = vec4(
				0,
				0,
				abs( projectedX.x ).add( abs( projectedY.x ) ),
				abs( projectedX.y ).add( abs( projectedY.y ) )
			)
		} else {
			clipPadding = vec4(
				widthNode.mul( paddingFactor ).div( resolutionNode.x ),
				widthNode.mul( paddingFactor ).div( resolutionNode.y ),
				0,
				0
			)
		}

		const clipRange = Fn( ( [start, end, padding] ) => {
			const lower = float( 0 ).toVar()
			const upper = float( 1 ).toVar()
			const clipPlane = ( startDistance, endDistance ) => {
				If( startDistance.lessThan( float( 0 ) ).and( endDistance.lessThan( float( 0 ) ) ), () => {
					lower.assign( float( 1 ) )
					upper.assign( float( 0 ) )
				} ).ElseIf( startDistance.lessThan( float( 0 ) ), () => {
					lower.assign( max( lower, startDistance.div( startDistance.sub( endDistance ) ) ) )
				} ).ElseIf( endDistance.lessThan( float( 0 ) ), () => {
					upper.assign( min( upper, startDistance.div( startDistance.sub( endDistance ) ) ) )
				} )
			}
			clipPlane( start.w, end.w )
			clipPlane( start.z, end.z )
			clipPlane( start.w.sub( start.z ), end.w.sub( end.z ) )
			clipPlane(
				start.x.add( start.w.mul( padding.x.add( 1 ) ) ).add( padding.z ),
				end.x.add( end.w.mul( padding.x.add( 1 ) ) ).add( padding.z )
			)
			clipPlane(
				start.w.mul( padding.x.add( 1 ) ).sub( start.x ).add( padding.z ),
				end.w.mul( padding.x.add( 1 ) ).sub( end.x ).add( padding.z )
			)
			clipPlane(
				start.y.add( start.w.mul( padding.y.add( 1 ) ) ).add( padding.w ),
				end.y.add( end.w.mul( padding.y.add( 1 ) ) ).add( padding.w )
			)
			clipPlane(
				start.w.mul( padding.y.add( 1 ) ).sub( start.y ).add( padding.w ),
				end.w.mul( padding.y.add( 1 ) ).sub( end.y ).add( padding.w )
			)
			return vec2( lower.clamp( 0, 1 ), upper.clamp( 0, 1 ) )
		} ).setLayout( {
			name: 'meshLineGPUPathClipRange',
			type: 'vec2',
			inputs: [
				{ name: 'start', type: 'vec4' },
				{ name: 'end', type: 'vec4' },
				{ name: 'padding', type: 'vec4' },
			],
		} )

		const fixClip = Fn( ( [clip, aspect] ) => {
			const safeW = max( clip.w, MIN_CLIP_W )
			const ndc = clip.xy.div( safeW )
			return vec2( ndc.x.mul( aspect ), ndc.y )
		} ).setLayout( {
			name: 'meshLineGPUPathFixClip',
			type: 'vec2',
			inputs: [
				{ name: 'clip', type: 'vec4' },
				{ name: 'aspect', type: 'float' },
			],
		} )
		const rotate2D = Fn( ( [direction, angle] ) => {
			const cosine = cos( angle )
			const sine = sin( angle )
			return vec2(
				direction.x.mul( cosine ).sub( direction.y.mul( sine ) ),
				direction.x.mul( sine ).add( direction.y.mul( cosine ) )
			)
		} ).setLayout( {
			name: 'meshLineGPUPathRotate2D',
			type: 'vec2',
			inputs: [
				{ name: 'direction', type: 'vec2' },
				{ name: 'angle', type: 'float' },
			],
		} )

		const material = new MeshLineGPUPathMaterial( { side: DoubleSide } )
		const rawVertex = vertexIndex.toUint()
		const wireCorner = rawVertex.mod( uint( 6 ) ).add( uint( 1 ) ).div( uint( 2 ) ).mod( uint( 3 ) )
		const wireVertex = rawVertex.div( uint( 6 ) ).mul( uint( 3 ) ).add( wireCorner )
		const effectiveVertex = rawVertex.mul( uint( 1 ).sub( wireframeNode ) ).add( wireVertex.mul( wireframeNode ) ).toVar()
		// Each branch fetches and clips its segment outside the vertex Fn, so the
		// stroke and, in builds that read one, the position accessors share it:
		// `centerline` is the local point a vertex is stroked from.
		//
		// three emits a value that several nodes read where it generates the
		// first of them. If that read sits inside a select() or If() branch, some
		// versions leave the value unset on every other path. So the fetched
		// values are vars that each vertex Fn stacks first, and in the Fn, every
		// value that a branch and anything outside it both read is a `toVar()`
		// defined ahead of the branch.
		let centerline
		if ( !topologyLayout.advanced ) {
			const triangleVertex = effectiveVertex.mod( uint( 6 ) )
			const segmentIndex = effectiveVertex.div( uint( 6 ) ).toVar()
			const rawPrevious = segmentIndex.greaterThan( uint( 0 ) ).select( segmentIndex.sub( uint( 1 ) ), uint( 0 ) )
			const rawNext = min( segmentIndex.add( uint( 2 ) ), uint( pointCount - 1 ) )
			const record = ( simplify
				? segments.element( segmentIndex )
				: uvec4(
					points.element( segmentIndex ).w.greaterThan( float( 0.5 ) ).select( segmentIndex, rawPrevious ),
					segmentIndex,
					segmentIndex.add( uint( 1 ) ),
					points.element( segmentIndex.add( uint( 1 ) ) ).w.greaterThan( float( 0.5 ) ).select( segmentIndex.add( uint( 1 ) ), rawNext )
				) ).toVar()
			const usesB = triangleVertex.equal( uint( 2 ) )
				.or( triangleVertex.equal( uint( 3 ) ) )
				.or( triangleVertex.equal( uint( 5 ) ) )
				.toVar()
			const positiveSide = triangleVertex.equal( uint( 1 ) )
				.or( triangleVertex.equal( uint( 4 ) )
					.or( triangleVertex.equal( uint( 5 ) ) ) )
				.toVar()
			const mvp = cameraProjectionMatrix.mul( modelViewMatrix )
			const previousRaw = mvp.mul( vec4( points.element( record.x ).xyz, 1 ) ).toVar()
			const aRaw = mvp.mul( vec4( points.element( record.y ).xyz, 1 ) ).toVar()
			const bRaw = mvp.mul( vec4( points.element( record.z ).xyz, 1 ) ).toVar()
			const nextRaw = mvp.mul( vec4( points.element( record.w ).xyz, 1 ) ).toVar()
			const bodyRange = clipRange( aRaw, bRaw, clipPadding ).toVar()
			const previousRange = clipRange( previousRaw, aRaw, clipPadding ).toVar()
			const nextRange = clipRange( bRaw, nextRaw, clipPadding ).toVar()
			const fetched = [effectiveVertex, segmentIndex, record, usesB, positiveSide, previousRaw, aRaw, bRaw, nextRaw, bodyRange, previousRange, nextRange]
			// A vertex is stroked from its body's clipped A or B end. Those are
			// mixes of homogeneous clip positions, so the same mixes of the local
			// points are exactly where they come from. The end is picked without
			// a conditional: one would first emit the shared clip range inside a
			// branch, leaving it unset for the other branch and for the stroke.
			centerline = mix(
				points.element( record.y ).xyz,
				points.element( record.z ).xyz,
				mix( bodyRange.x, bodyRange.y, float( usesB ) )
			)
			material.vertexNode = Fn( () => {
				for ( const value of fetched ) value.toStack()
				const bodyVisible = bodyRange.x.lessThan( bodyRange.y )
				const previousVisible = previousRange.x.lessThan( previousRange.y )
				const nextVisible = nextRange.x.lessThan( nextRange.y )
				const aPosition = mix( aRaw, bRaw, bodyRange.x ).toVar()
				const bPosition = mix( aRaw, bRaw, bodyRange.y ).toVar()
				const clippedPrevious = mix( previousRaw, aRaw, previousRange.x ).toVar()
				const clippedNext = mix( bRaw, nextRaw, nextRange.y ).toVar()
				const clippedStart = bodyRange.x.greaterThan( float( CLIP_RANGE_EPSILON ) ).toVar()
				const clippedEnd = bodyRange.y.lessThan( float( 1 - CLIP_RANGE_EPSILON ) ).toVar()
				const previousReachesA = previousVisible
					.and( previousRange.y.greaterThanEqual( float( 1 - CLIP_RANGE_EPSILON ) ) )
					.and( record.x.notEqual( record.y ) )
					.toVar()
				const nextStartsB = nextVisible
					.and( nextRange.x.lessThanEqual( float( CLIP_RANGE_EPSILON ) )
						.and( record.w.notEqual( record.z ) ) )
					.toVar()
				const currentPosition = usesB.select( bPosition, aPosition )
				const previousPosition = usesB.select(
					aPosition,
					clippedStart.or( previousReachesA.not() ).select( aPosition, clippedPrevious )
				)
				const nextPosition = usesB.select(
					clippedEnd.or( nextStartsB.not() ).select( bPosition, clippedNext ),
					bPosition
				)
				const aspect = resolutionNode.x.div( resolutionNode.y )
				const currentP = fixClip( currentPosition, aspect )
				const previousP = fixClip( previousPosition, aspect )
				const nextP = fixClip( nextPosition, aspect )
				const delta1Raw = currentP.sub( previousP )
				const delta2Raw = nextP.sub( currentP )
				const delta1RawLength = length( delta1Raw ).toVar()
				const delta2RawLength = length( delta2Raw ).toVar()
				const projectedReversal = delta1RawLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) )
					.and( delta2RawLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) ) )
					.and( dot(
						delta1Raw.div( max( delta1RawLength, MIN_DIRECTION_LENGTH ) ),
						delta2Raw.div( max( delta2RawLength, MIN_DIRECTION_LENGTH ) )
					).lessThanEqual( float( REVERSAL_DOT_THRESHOLD ) ) )
				const atStart = previousReachesA.not().or( clippedStart )
					.or( usesB.not().and( projectedReversal ) )
					.select( float( 1 ), float( 0 ) )
				const atEnd = nextStartsB.not().or( clippedEnd )
					.or( usesB.and( projectedReversal ) )
					.select( float( 1 ), float( 0 ) )
				const delta1 = mix( delta1Raw, delta2Raw, atStart )
				const delta2 = mix( delta2Raw, delta1Raw, atEnd )
				const delta1Length = length( delta1 )
				const delta2Length = length( delta2 )
				const fallbackDirection = vec2( 1, 0 )
				const direction1Raw = delta1.div( max( delta1Length, MIN_DIRECTION_LENGTH ) )
				const direction2Raw = delta2.div( max( delta2Length, MIN_DIRECTION_LENGTH ) )
				const direction1 = mix(
					mix( fallbackDirection, direction2Raw, step( MIN_DIRECTION_LENGTH, delta2Length ) ),
					direction1Raw,
					step( MIN_DIRECTION_LENGTH, delta1Length )
				).toVar()
				const direction2 = mix( direction1, direction2Raw, step( MIN_DIRECTION_LENGTH, delta2Length ) ).toVar()
				const directionSum = direction1.add( direction2 )
				const directionSumLength = length( directionSum )
				const perpendicularRaw = vec2( directionSum.y.negate(), directionSum.x )
				// The fixed strip owns separate A/outgoing and B/incoming endpoint
				// vertices. Keep an over-limit join aligned with that physical body.
				const bodyDirection = usesB.select( direction1, direction2 )
				const perpendicularFallback = vec2( bodyDirection.y.negate(), bodyDirection.x )
				const miterBlend = directionSumLength.smoothstep( miterThreshold.mul( 0.75 ), miterThreshold )
				const blendedPerpendicular = mix(
					perpendicularFallback,
					perpendicularRaw.div( max( directionSumLength, MIN_DIRECTION_LENGTH ) ),
					miterBlend
				)
				const blendedLength = length( blendedPerpendicular )
				const unitPerpendicular = mix(
					perpendicularFallback,
					blendedPerpendicular.div( max( blendedLength, MIN_DIRECTION_LENGTH ) ),
					step( MIN_DIRECTION_LENGTH, blendedLength )
				)
				const halfWidth = mix(
					widthNode.mul( 0.5 ),
					widthNode.div( max( directionSumLength, miterThreshold ) ),
					miterBlend
				)
				const offset = unitPerpendicular.mul( halfWidth ).toVar()
				if ( sizeAttenuation ) {
					offset.assign( cameraProjectionMatrix.mul( vec4( offset, 0, 0 ) ).xy )
				} else {
					offset.x.divAssign( aspect )
					offset.mulAssign( currentPosition.w.mul( 2 ).div( resolutionNode.y ) )
				}
				const finalPosition = currentPosition.toVar()
				const side = positiveSide.select( float( 1 ), float( -1 ) )
				finalPosition.xy.addAssign( offset.mul( side ) )
				const bodyProjectedLength = usesB.select( delta1RawLength, delta2RawLength )
				const projectedBodyVisible = bodyProjectedLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) )
				return bodyVisible.and( projectedBodyVisible ).select( finalPosition, vec4( 2, 2, 2, 1 ) )
			} )()
		} else {
			const primitive = primitives.element( effectiveVertex.div( uint( 3 ) ) )
			const primitiveType = primitive.x.mod( uint( 1 << PRIMITIVE_TYPE_BITS ) ).toVar()
			const primitiveSlot = primitive.x.div( uint( 1 << PRIMITIVE_TYPE_BITS ) ).toVar()
			const triangleVertex = effectiveVertex.mod( uint( 3 ) ).toVar()
			const record = segments.element( primitive.y ).toVar()
			const mvp = cameraProjectionMatrix.mul( modelViewMatrix )
			const previousRaw = mvp.mul( vec4( points.element( record.x ).xyz, 1 ) ).toVar()
			const aRaw = mvp.mul( vec4( points.element( record.y ).xyz, 1 ) ).toVar()
			const bRaw = mvp.mul( vec4( points.element( record.z ).xyz, 1 ) ).toVar()
			const nextRaw = mvp.mul( vec4( points.element( record.w ).xyz, 1 ) ).toVar()
			const bodyRange = clipRange( aRaw, bRaw, clipPadding ).toVar()
			const previousRange = clipRange( previousRaw, aRaw, clipPadding ).toVar()
			const nextRange = clipRange( bRaw, nextRaw, clipPadding ).toVar()
			const bodyA = primitiveType.equal( uint( PRIMITIVE_BODY_A ) ).toVar()
			const usesB = bodyA.select(
				triangleVertex.equal( uint( 2 ) ),
				triangleVertex.notEqual( uint( 1 ) )
			).toVar()
			const fetched = [effectiveVertex, primitiveType, primitiveSlot, triangleVertex, record, previousRaw, aRaw, bRaw, nextRaw, bodyRange, previousRange, nextRange, bodyA, usesB]
			// Bodies are stroked from their clipped A or B end, as in the fixed
			// strip. Joins and end caps are stroked from B and start caps from A,
			// and only while that end is unclipped. Picked without conditionals
			// around the shared clip range, for the same reason.
			const bodyEnd = mix( bodyRange.x, bodyRange.y, float( usesB ) )
			const capEnd = float( primitiveType.notEqual( uint( PRIMITIVE_START_CAP ) ) )
			centerline = mix(
				points.element( record.y ).xyz,
				points.element( record.z ).xyz,
				mix( capEnd, bodyEnd, float( primitiveType.lessThan( uint( PRIMITIVE_JOIN ) ) ) )
			)
			material.vertexNode = Fn( () => {
				for ( const value of fetched ) value.toStack()
				const bodyVisible = bodyRange.x.lessThan( bodyRange.y ).toVar()
				const previousVisible = previousRange.x.lessThan( previousRange.y )
				const nextVisible = nextRange.x.lessThan( nextRange.y )
				const aPosition = mix( aRaw, bRaw, bodyRange.x ).toVar()
				const bPosition = mix( aRaw, bRaw, bodyRange.y ).toVar()
				const previousPosition = mix( previousRaw, aRaw, previousRange.x )
				const nextPosition = mix( bRaw, nextRaw, nextRange.y )
				const reachesA = bodyRange.x.lessThanEqual( float( CLIP_RANGE_EPSILON ) ).toVar()
				const reachesB = bodyRange.y.greaterThanEqual( float( 1 - CLIP_RANGE_EPSILON ) ).toVar()
				const aInsideClip = aRaw.w.greaterThan( float( 0 ) )
					.and( aRaw.z.greaterThanEqual( float( 0 ) ) )
					.and( aRaw.z.lessThanEqual( aRaw.w ) )
					.and( aRaw.x.add( aRaw.w.mul( clipPadding.x.add( 1 ) ) ).add( clipPadding.z ).greaterThanEqual( float( 0 ) ) )
					.and( aRaw.w.mul( clipPadding.x.add( 1 ) ).sub( aRaw.x ).add( clipPadding.z ).greaterThanEqual( float( 0 ) ) )
					.and( aRaw.y.add( aRaw.w.mul( clipPadding.y.add( 1 ) ) ).add( clipPadding.w ).greaterThanEqual( float( 0 ) ) )
					.and( aRaw.w.mul( clipPadding.y.add( 1 ) ).sub( aRaw.y ).add( clipPadding.w ).greaterThanEqual( float( 0 ) ) )
					.toVar()
				const bInsideClip = bRaw.w.greaterThan( float( 0 ) )
					.and( bRaw.z.greaterThanEqual( float( 0 ) ) )
					.and( bRaw.z.lessThanEqual( bRaw.w ) )
					.and( bRaw.x.add( bRaw.w.mul( clipPadding.x.add( 1 ) ) ).add( clipPadding.z ).greaterThanEqual( float( 0 ) ) )
					.and( bRaw.w.mul( clipPadding.x.add( 1 ) ).sub( bRaw.x ).add( clipPadding.z ).greaterThanEqual( float( 0 ) ) )
					.and( bRaw.y.add( bRaw.w.mul( clipPadding.y.add( 1 ) ) ).add( clipPadding.w ).greaterThanEqual( float( 0 ) ) )
					.and( bRaw.w.mul( clipPadding.y.add( 1 ) ).sub( bRaw.y ).add( clipPadding.w ).greaterThanEqual( float( 0 ) ) )
					.toVar()
				const previousReachesA = previousVisible
					.and( previousRange.y.greaterThanEqual( float( 1 - CLIP_RANGE_EPSILON ) ) )
					.and( record.x.notEqual( record.y ) )
				const nextStartsB = nextVisible
					.and( nextRange.x.lessThanEqual( float( CLIP_RANGE_EPSILON ) ) )
					.and( record.w.notEqual( record.z ) )
					.toVar()
				const aspect = resolutionNode.x.div( resolutionNode.y )
				const aP = fixClip( aPosition, aspect )
				const bP = fixClip( bPosition, aspect )
				const bodyDelta = bP.sub( aP )
				const bodyLength = length( bodyDelta ).toVar()
				const bodyDirection = bodyDelta.div( max( bodyLength, MIN_DIRECTION_LENGTH ) ).toVar()
				const bodyNormal = vec2( bodyDirection.y.negate(), bodyDirection.x ).toVar()
				const previousP = fixClip( previousPosition, aspect )
				const nextP = fixClip( nextPosition, aspect )
				const incomingDelta = aP.sub( previousP )
				const outgoingDelta = nextP.sub( bP )
				const incomingLength = length( incomingDelta )
				const outgoingLength = length( outgoingDelta )
				const incomingDirection = incomingDelta.div( max( incomingLength, MIN_DIRECTION_LENGTH ) )
				const outgoingDirection = outgoingDelta.div( max( outgoingLength, MIN_DIRECTION_LENGTH ) ).toVar()
				const incomingNormal = vec2( incomingDirection.y.negate(), incomingDirection.x )
				const outgoingNormal = vec2( outgoingDirection.y.negate(), outgoingDirection.x ).toVar()
				const startReversal = previousReachesA
					.and( incomingLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) ) )
					.and( dot( incomingDirection, bodyDirection ).lessThanEqual( float( REVERSAL_DOT_THRESHOLD ) ) )
				const endReversal = nextStartsB
					.and( outgoingLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) ) )
					.and( dot( bodyDirection, outgoingDirection ).lessThanEqual( float( REVERSAL_DOT_THRESHOLD ) ) )
					.toVar()
				const startBoundary = record.x.equal( record.y ).or( startReversal )
				const endBoundary = record.w.equal( record.z ).or( endReversal )
				const halfWidth = widthNode.mul( 0.5 ).toVar()
				const startTurnCross = incomingDirection.x.mul( bodyDirection.y ).sub( incomingDirection.y.mul( bodyDirection.x ) ).toVar()
				const endTurnCross = bodyDirection.x.mul( outgoingDirection.y ).sub( bodyDirection.y.mul( outgoingDirection.x ) ).toVar()
				const startTurnDot = dot( incomingDirection, bodyDirection ).clamp( -1, 1 )
				const endTurnDot = dot( bodyDirection, outgoingDirection ).clamp( -1, 1 )
				let startScreenHalfWidth
				let endScreenHalfWidth
				if ( sizeAttenuation ) {
					const projectedHalfWidthX = abs( cameraProjectionMatrix.mul( vec4( halfWidth, 0, 0, 0 ) ).x ).mul( aspect )
					const projectedHalfWidthY = abs( cameraProjectionMatrix.mul( vec4( 0, halfWidth, 0, 0 ) ).y )
					const projectedHalfWidth = max( projectedHalfWidthX, projectedHalfWidthY )
					startScreenHalfWidth = projectedHalfWidth.div( max( aRaw.w, MIN_CLIP_W ) )
					endScreenHalfWidth = projectedHalfWidth.div( max( bRaw.w, MIN_CLIP_W ) )
				} else {
					startScreenHalfWidth = halfWidth.mul( 2 ).div( resolutionNode.y )
					endScreenHalfWidth = startScreenHalfWidth
				}
				// q = h * |cross| / ( 1 + dot ) is the longitudinal inner
				// setback. Compare without dividing so a near-reversal cannot
				// manufacture a viewport-sized intermediate or final position.
				const supportFactor = float( 1 - TOPOLOGY_SUPPORT_EPSILON )
				const startInnerSupported = incomingLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) )
					.and( bodyLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) ) )
					.and( startReversal.not() )
					.and(
						startScreenHalfWidth.mul( abs( startTurnCross ) ).lessThanEqual(
							min( incomingLength, bodyLength )
								.mul( max( float( 0 ), float( 1 ).add( startTurnDot ) ) )
								.mul( supportFactor )
						)
					)
				const endInnerSupported = bodyLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) )
					.and( outgoingLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) ) )
					.and( endReversal.not() )
					.and(
						endScreenHalfWidth.mul( abs( endTurnCross ) ).lessThanEqual(
							min( bodyLength, outgoingLength )
								.mul( max( float( 0 ), float( 1 ).add( endTurnDot ) ) )
								.mul( supportFactor )
						)
					)
				const startNormalSum = incomingNormal.add( bodyNormal )
				const endNormalSum = bodyNormal.add( outgoingNormal )
				const startNormalSumLength = length( startNormalSum )
				const endNormalSumLength = length( endNormalSum )
				const startBisector = startNormalSum.div( max( startNormalSumLength, MIN_DIRECTION_LENGTH ) ).toVar()
				const endBisector = endNormalSum.div( max( endNormalSumLength, MIN_DIRECTION_LENGTH ) ).toVar()
				const startInnerDefined = startNormalSumLength.greaterThan( float( MIN_DIRECTION_LENGTH ) )
				const endInnerDefined = endNormalSumLength.greaterThan( float( MIN_DIRECTION_LENGTH ) )
				const startInnerDenominator = startInnerDefined.and( startInnerSupported ).select(
					abs( dot( startBisector, bodyNormal ) ),
					float( 1 )
				)
				const endInnerDenominator = endInnerDefined.and( endInnerSupported ).select(
					abs( dot( endBisector, outgoingNormal ) ),
					float( 1 )
				)
				const startInnerScale = halfWidth.div( max( startInnerDenominator, MIN_DIRECTION_LENGTH ) ).toVar()
				const endInnerScale = halfWidth.div( max( endInnerDenominator, MIN_DIRECTION_LENGTH ) ).toVar()
				const startOuterMiterValid = startInnerDefined.and( startInnerSupported )
					.and( startInnerScale.lessThanEqual( halfWidth.mul( float( miterLimit ) ) ) )
				// Miter bodies and joins both read this one. Built for miter joins
				// only: three r183 still emits a var that nothing reads.
				const endOuterMiterValid = topology.join.type === 'miter'
					? endInnerDefined.and( endInnerSupported )
						.and( endInnerScale.lessThanEqual( halfWidth.mul( float( miterLimit ) ) ) )
						.toVar()
					: null
				const startInnerSide = startTurnCross.greaterThan( float( 0 ) ).select( float( 1 ), float( -1 ) ).toVar()
				const endInnerSide = endTurnCross.greaterThan( float( 0 ) ).select( float( 1 ), float( -1 ) ).toVar()
				const startInnerOffset = startInnerDefined.select(
					startBisector.mul( startInnerSide ).mul( startInnerScale ),
					vec2( 0 )
				).toVar()
				const endInnerOffset = endInnerDefined.select(
					endBisector.mul( endInnerSide ).mul( endInnerScale ),
					vec2( 0 )
				).toVar()
				const startOuterMiter = startBisector.mul( startInnerSide.negate() ).mul( startInnerScale )
				const endOuterMiter = endBisector.mul( endInnerSide.negate() ).mul( endInnerScale )
				const startJoinActive = previousReachesA.and( reachesA ).and( aInsideClip )
					.and( startReversal.not() )
					.and( abs( startTurnCross ).greaterThan( float( MIN_DIRECTION_LENGTH ) ) )
					.toVar()
				const endJoinActive = nextStartsB.and( reachesB ).and( bInsideClip )
					.and( endReversal.not() )
					.and( abs( endTurnCross ).greaterThan( float( MIN_DIRECTION_LENGTH ) ) )
					.toVar()
				const startInnerExact = startInnerDefined.and( startInnerSupported )
				const endInnerExact = endInnerDefined.and( endInnerSupported )
				// The finite-support guard applies only to the shared join pivot. When
				// the exact intersection would extend beyond either incident leg, keep
				// each body at its own normal half-width so the stroke cannot taper away.
				const startBodyInnerOffset = startInnerExact.select(
					startInnerOffset,
					bodyNormal.mul( startInnerSide ).mul( halfWidth )
				).toVar()
				const endBodyInnerOffset = endInnerExact.select(
					endInnerOffset,
					bodyNormal.mul( endInnerSide ).mul( halfWidth )
				).toVar()
				const endJoinPivotOffset = endInnerExact.select( endInnerOffset, vec2( 0 ) ).toVar()
				const emitted = bool( false ).toVar()
				const finalPosition = aPosition.toVar()
				const strokeOffset = vec2( 0 ).toVar()

				If( primitiveType.equal( uint( PRIMITIVE_BODY_A ) ).or( primitiveType.equal( uint( PRIMITIVE_BODY_B ) ) ), () => {
					const positiveSide = bodyA.select(
						triangleVertex.equal( uint( 1 ) ),
						triangleVertex.notEqual( uint( 0 ) )
					)
					finalPosition.assign( usesB.select( bPosition, aPosition ) )
					strokeOffset.assign( bodyNormal.mul( positiveSide.select( halfWidth, halfWidth.negate() ) ) )
					If(
						usesB.not().and( startJoinActive ).and( positiveSide.equal( startTurnCross.greaterThan( float( 0 ) ) ) ),
						() => { strokeOffset.assign( startBodyInnerOffset ) }
					)
					If(
						usesB.and( endJoinActive ).and( positiveSide.equal( endTurnCross.greaterThan( float( 0 ) ) ) ),
						() => { strokeOffset.assign( endBodyInnerOffset ) }
					)
					if ( topology.join.type === 'miter' ) {
						If(
							usesB.not()
								.and( startJoinActive )
								.and( startOuterMiterValid )
								.and( positiveSide.notEqual( startTurnCross.greaterThan( float( 0 ) ) ) ),
							() => { strokeOffset.assign( startOuterMiter ) }
						)
						If(
							usesB
								.and( endJoinActive )
								.and( endOuterMiterValid )
								.and( positiveSide.notEqual( endTurnCross.greaterThan( float( 0 ) ) ) ),
							() => { strokeOffset.assign( endOuterMiter ) }
						)
					}
					if ( topology.cap.type === 'square' ) {
						const longitudinal = usesB.select(
							endBoundary.and( reachesB ).and( bInsideClip ).select( halfWidth, float( 0 ) ),
							startBoundary.and( reachesA ).and( aInsideClip ).select( halfWidth.negate(), float( 0 ) )
						)
						strokeOffset.addAssign( bodyDirection.mul( longitudinal ) )
					}
					emitted.assign( bodyVisible.and( bodyLength.greaterThanEqual( float( MIN_DIRECTION_LENGTH ) ) ) )
				} )

				If( primitiveType.equal( uint( PRIMITIVE_JOIN ) ), () => {
					const joinVisible = bodyVisible.and( reachesB ).and( nextStartsB ).and( bInsideClip ).toVar()
					const turnCross = bodyDirection.x.mul( outgoingDirection.y ).sub( bodyDirection.y.mul( outgoingDirection.x ) )
					const turnSign = turnCross.greaterThanEqual( float( 0 ) ).select( float( 1 ), float( -1 ) )
					const outerSide = turnSign.negate()
					const outerIncoming = bodyNormal.mul( outerSide )
					const outerOutgoing = outgoingNormal.mul( outerSide )
					finalPosition.assign( bRaw )

					if ( topology.cap.type === 'round' ) {
						If( endReversal.and( primitiveSlot.lessThan( uint( topology.cap.segments ) ) ), () => {
							const startFraction = primitiveSlot.toFloat().div( float( topology.cap.segments ) )
							const endFraction = primitiveSlot.add( uint( 1 ) ).toFloat().div( float( topology.cap.segments ) )
							const startRadius = rotate2D( bodyNormal.negate(), startFraction.mul( Math.PI ) )
							const endRadius = rotate2D( bodyNormal.negate(), endFraction.mul( Math.PI ) )
							strokeOffset.assign( triangleVertex.equal( uint( 0 ) ).select(
								vec2( 0 ),
								triangleVertex.equal( uint( 1 ) ).select( startRadius, endRadius ).mul( halfWidth )
							) )
							emitted.assign( joinVisible )
						} )
					}

					If( endReversal.not(), () => {
						if ( topology.join.type === 'round' ) {
							If( primitiveSlot.lessThan( uint( topology.join.segments ) ), () => {
								const arcAngle = acos( dot( outerIncoming, outerOutgoing ).clamp( -1, 1 ) )
								const startFraction = primitiveSlot.toFloat().div( float( topology.join.segments ) )
								const endFraction = primitiveSlot.add( uint( 1 ) ).toFloat().div( float( topology.join.segments ) )
								const startRadius = rotate2D( outerIncoming, arcAngle.mul( turnSign ).mul( startFraction ) )
								const endRadius = rotate2D( outerIncoming, arcAngle.mul( turnSign ).mul( endFraction ) )
								strokeOffset.assign( triangleVertex.equal( uint( 0 ) ).select(
									endJoinPivotOffset,
									triangleVertex.equal( uint( 1 ) ).select( startRadius, endRadius ).mul( halfWidth )
								) )
								emitted.assign( joinVisible.and( abs( turnCross ).greaterThan( float( MIN_DIRECTION_LENGTH ) ) ) )
							} )
						} else {
							const outerA = outerIncoming.mul( halfWidth )
							const outerB = outerOutgoing.mul( halfWidth )
							const middle = endJoinPivotOffset.toVar()
							const emitJoin = bool( true ).toVar()
							if ( topology.join.type === 'miter' ) {
								emitJoin.assign( endOuterMiterValid.not() )
							}
							strokeOffset.assign( triangleVertex.equal( uint( 0 ) ).select(
								outerA,
								triangleVertex.equal( uint( 1 ) ).select( middle, outerB )
							) )
							emitted.assign(
								joinVisible
									.and( emitJoin )
									.and( primitiveSlot.equal( uint( 0 ) ) )
									.and( abs( turnCross ).greaterThan( float( MIN_DIRECTION_LENGTH ) ) )
							)
						}
					} )
				} )

				if ( topology.cap.type === 'round' ) {
					If( primitiveType.equal( uint( PRIMITIVE_START_CAP ) ), () => {
						const startFraction = primitiveSlot.toFloat().div( float( topology.cap.segments ) )
						const endFraction = primitiveSlot.add( uint( 1 ) ).toFloat().div( float( topology.cap.segments ) )
						const startRadius = rotate2D( bodyNormal, startFraction.mul( Math.PI ) )
						const endRadius = rotate2D( bodyNormal, endFraction.mul( Math.PI ) )
						finalPosition.assign( aRaw )
						strokeOffset.assign( triangleVertex.equal( uint( 0 ) ).select(
							vec2( 0 ),
							triangleVertex.equal( uint( 1 ) ).select( startRadius, endRadius ).mul( halfWidth )
						) )
						emitted.assign( bodyVisible.and( reachesA ).and( aInsideClip ).and( startBoundary ) )
					} )
					If( primitiveType.equal( uint( PRIMITIVE_END_CAP ) ), () => {
						const startFraction = primitiveSlot.toFloat().div( float( topology.cap.segments ) )
						const endFraction = primitiveSlot.add( uint( 1 ) ).toFloat().div( float( topology.cap.segments ) )
						const startRadius = rotate2D( bodyNormal.negate(), startFraction.mul( Math.PI ) )
						const endRadius = rotate2D( bodyNormal.negate(), endFraction.mul( Math.PI ) )
						finalPosition.assign( bRaw )
						strokeOffset.assign( triangleVertex.equal( uint( 0 ) ).select(
							vec2( 0 ),
							triangleVertex.equal( uint( 1 ) ).select( startRadius, endRadius ).mul( halfWidth )
						) )
						emitted.assign( bodyVisible.and( reachesB ).and( bInsideClip ).and( endBoundary ) )
					} )
				}

				const clipOffset = strokeOffset.toVar()
				if ( sizeAttenuation ) {
					clipOffset.assign( cameraProjectionMatrix.mul( vec4( strokeOffset, 0, 0 ) ).xy )
				} else {
					clipOffset.x.divAssign( aspect )
					clipOffset.mulAssign( finalPosition.w.mul( 2 ).div( resolutionNode.y ) )
				}
				finalPosition.xy.addAssign( clipOffset )
				return emitted.select( finalPosition, vec4( 2, 2, 2, 1 ) )
			} )()
		}
		material._placedPositionNode = nodeObject( new PlacedPositionNode( centerline.toVar( 'linePosition' ) ) )
		material.colorNode = vec4( colorNode, 1 )
		material.opacityNode = opacityNode
		material.transparent = this.fallback.material.transparent === true || opacity < 1
		material.depthWrite = this.lineOptions.depthWrite ?? !material.transparent
		material.depthTest = this.lineOptions.depthTest ?? true
		material.alphaTest = Number( this.lineOptions.alphaTest ?? 0 )
		return material
	}

	_disposeGPU() {
		if ( this.gpuMesh ) this.remove( this.gpuMesh )
		for ( const node of this._computeNodes ) node?.dispose?.()
		this.gpuMesh?.geometry?.dispose?.()
		this.gpuMesh?.material?.dispose?.()
		this.gpuMesh = null
		this._computeNodes = []
		this._resources = null
	}

	dispose() {
		this._disposeGPU()
		this.fallback?.dispose?.()
		this.parent?.remove( this )
		this.status.active = false
		this.status.enabled = false
	}

}

export const _gpuPathInternals = Object.freeze( {
	normalizeOpenPoints,
	normalizeTopologyOptions,
	getTopologyLayout,
	createGPUResourcePlan,
	assertGPUResourcePlan,
	createChunkPlan,
	computeDyadicChunkErrors,
	computeDyadicImportance,
	findReversalBreaks,
	clipHomogeneousSegment,
	computeInnerJoinOffset,
	resolveProjectedJoin,
	validateInnerJoinSupport,
	createStableSegmentRecords,
	createProceduralPrimitiveRecords,
} )

export default MeshLineGPUPath
