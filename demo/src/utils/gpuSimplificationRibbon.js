/**
 * The render half of the GPU simplification lab: three draw modes pulled straight
 * from storage buffers. An indirect command owns each mode's vertex count and every
 * position is procedural, so no capacity-sized vertex buffers are ever allocated.
 */
import {
	abs,
	color,
	cross,
	dot,
	float,
	Fn,
	length,
	log2,
	max,
	min,
	mix,
	smoothstep,
	uint,
	vec3,
	vec4,
	vertexIndex,
} from 'three/tsl'
import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	LineBasicNodeMaterial,
	LineSegments,
	Mesh,
	MeshBasicNodeMaterial,
} from 'three/webgpu'

import {
	RIBBON_CAMERA_PLANE_OFFSET_FRACTION,
	RIBBON_JOIN_SUPPORT_FRACTION,
	SIMPLIFICATION_CHUNK_MAX,
} from '@/utils/gpuSimplification'
import {
	DRAW_COMMAND_UINTS,
	EPSILON,
	LINE_CAPACITY,
	LINE_VERTICES_PER_SEGMENT,
	RIBBON_VERTICES_PER_SEGMENT,
	WIREFRAME_VERTICES_PER_SEGMENT,
} from '@/utils/gpuSimplificationCompute'

const DRAW_COMMAND_BYTES = DRAW_COMMAND_UINTS * Uint32Array.BYTES_PER_ELEMENT
const RIBBON_DRAW_OFFSET = 0
const LINE_DRAW_OFFSET = DRAW_COMMAND_BYTES
const WIREFRAME_DRAW_OFFSET = DRAW_COMMAND_BYTES * 2
// Tighter than the library's 4: at 4 a hairpin grew a miter tip 1.7x the full
// stroke width past the corner, and the support guard never fired to catch it.
const RIBBON_MITER_LIMIT = 2

const createRenderObject = ( ObjectType, material, indirect, indirectOffset ) => {
	// A one-vertex placeholder gives Three a finite non-indexed draw range.
	const placeholder = new BufferGeometry()
	placeholder.setAttribute( 'position', new BufferAttribute( new Float32Array( [0, 0, 0] ), 3 ) )
	placeholder.setIndirect( indirect, indirectOffset )

	const object = new ObjectType( placeholder, material )
	object.frustumCulled = false
	object.matrixAutoUpdate = false
	object.visible = false
	return object
}

/**
 * The ribbons, lines and wireframe of one point buffer.
 *
 * @param {object} params
 * @param {Node} params.count - Points in `points`
 * @param {Node} [params.gaps] - Source points each segment stands in for, drawn as a heatmap
 * @param {Node} params.halfWidth - Half the ribbon width, in world units
 * @param {IndirectStorageBufferAttribute} params.indirect - Ribbon, line and wireframe draw commands
 * @param {Node} params.lineClosed - Per-line closed flags
 * @param {Node} params.points - xyz plus the polyline id in w
 * @param {Node} params.projectionView - Matches the render camera
 * @param {Node} params.runs - First and last point index of each polyline
 */
export function createRenderSet( { count, gaps, halfWidth, indirect, lineClosed, points, projectionView, runs } ) {
	const lastIndex = max( uint( 1 ), count ).sub( uint( 1 ) )
	const positionAt = pointIndex => points.element( min( pointIndex, lastIndex ) ).xyz
	const lineAt = pointIndex => points.element( min( pointIndex, lastIndex ) ).w
	const sameLine = ( a, b ) => lineAt( a ).equal( lineAt( b ) )
	const lineOf = pointIndex => min( lineAt( pointIndex ).toUint(), uint( LINE_CAPACITY - 1 ) )
	const runStartOf = pointIndex => runs.element( lineOf( pointIndex ).mul( uint( 2 ) ) )
	const runEndOf = pointIndex => runs.element( lineOf( pointIndex ).mul( uint( 2 ) ).add( uint( 1 ) ) )
	const isClosed = pointIndex => lineClosed.element( lineOf( pointIndex ) ).greaterThan( uint( 0 ) )

	// Neighbours never cross a polyline boundary, so hundreds of independent
	// strokes can live in one buffer and one draw call without the ribbon
	// stitching the end of one stroke to the start of the next.
	//
	// A closed ring repeats its first point at the end, so without wrapping it
	// would render as an open stroke with two independent butt caps stacked on
	// one position — measured at 48% of the stroke width left unpainted at the
	// France mainland seam. Wrapping across the run makes the seam an ordinary
	// join like every other vertex.
	const previousOf = pointIndex => {
		const runStart = runStartOf( pointIndex )
		const runEnd = runEndOf( pointIndex )
		const wrapped = max( runStart.add( uint( 1 ) ), runEnd ).sub( uint( 1 ) )
		return pointIndex.lessThanEqual( runStart ).select(
			isClosed( pointIndex ).select( wrapped, pointIndex ),
			max( uint( 1 ), pointIndex ).sub( uint( 1 ) ),
		)
	}
	const nextOf = pointIndex => {
		const runStart = runStartOf( pointIndex )
		const runEnd = runEndOf( pointIndex )
		const wrapped = min( runStart.add( uint( 1 ) ), runEnd )
		return pointIndex.greaterThanEqual( runEnd ).select(
			isClosed( pointIndex ).select( wrapped, pointIndex ),
			min( pointIndex.add( uint( 1 ) ), lastIndex ),
		)
	}

	const ribbonPoint = Fn( ( [pointIndex, positiveSide, segmentEnd] ) => {
		const point = positionAt( pointIndex )
		const previous = positionAt( previousOf( pointIndex ) )
		const next = positionAt( nextOf( pointIndex ) )
		const incomingVector = point.sub( previous )
		const outgoingVector = next.sub( point )
		const incomingLength = length( incomingVector )
		const outgoingLength = length( outgoingVector )
		// An endpoint borrows its only neighbour's direction for both legs, and
		// a pair of points that quantised onto each other borrows an axis. Every
		// branch divides by a clamped length so no side of a select is ever NaN.
		const safeIncoming = incomingVector.div( max( incomingLength, EPSILON ) )
		const safeOutgoing = outgoingVector.div( max( outgoingLength, EPSILON ) )
		const incoming = incomingLength.greaterThan( EPSILON ).select(
			safeIncoming,
			outgoingLength.greaterThan( EPSILON ).select( safeOutgoing, vec3( 1, 0, 0 ) ),
		)
		const outgoing = outgoingLength.greaterThan( EPSILON ).select( safeOutgoing, incoming )
		const fixedUp = vec3( 0, 0, 1 )
		const fallbackUp = vec3( 0, 1, 0 )
		const incomingUp = abs( incoming.z ).greaterThan( 0.999 ).select( fallbackUp, fixedUp )
		const outgoingUp = abs( outgoing.z ).greaterThan( 0.999 ).select( fallbackUp, fixedUp )
		const incomingSide = cross( incomingUp, incoming ).normalize()
		const outgoingSide = cross( outgoingUp, outgoing ).normalize()
		const miterSum = incomingSide.add( outgoingSide )
		const miterLength = length( miterSum )
		const miter = miterLength.greaterThan( EPSILON ).select(
			miterSum.div( max( miterLength, EPSILON ) ),
			outgoingSide,
		)
		const denominator = max( abs( dot( miter, outgoingSide ) ), EPSILON )
		const miterScale = halfWidth.div( denominator )
		const miterOffset = miter.mul( miterScale )
		// A valid miter can still be unsupported by very short legs. Bound its
		// longitudinal setback on both; unsupported joins keep the owning
		// segment's full-width side instead of folding.
		const support = max(
			abs( dot( miterOffset, incoming ) ),
			abs( dot( miterOffset, outgoing ) ),
		)
		const available = min(
			max( incomingLength, EPSILON ),
			max( outgoingLength, EPSILON ),
		).mul( float( RIBBON_JOIN_SUPPORT_FRACTION ) )
		const miterSupported = miterLength.greaterThan( EPSILON )
			.and( miterScale.lessThanEqual( halfWidth.mul( float( RIBBON_MITER_LIMIT ) ) ) )
			.and( support.lessThanEqual( available ) )
		const bodySide = segmentEnd.select( incomingSide, outgoingSide )
		const offset = miterSupported.select( miterOffset, bodySide.mul( halfWidth ) )
		// Keep the ribbon on the camera's side of the centerline so a hidden
		// interval cannot leak a rail through the projection singularity.
		const clipW = abs( projectionView.mul( vec4( point, 1 ) ).w )
		const projectionSafeScale = min(
			float( 1 ),
			clipW.mul( float( RIBBON_CAMERA_PLANE_OFFSET_FRACTION ) )
				.div( max( length( offset ), EPSILON ) ),
		)
		const safeOffset = offset.mul( projectionSafeScale )
		return positiveSide.select( point.add( safeOffset ), point.sub( safeOffset ) )
	} )

	// A segment whose two ends belong to different polylines is collapsed to a
	// point instead of stitching the end of one stroke to the start of the next.
	const breaksAt = segmentIndex =>
		sameLine( segmentIndex, min( segmentIndex.add( uint( 1 ) ), lastIndex ) ).not()

	const triangleVertex = vertexIndex.toUint().mod( uint( RIBBON_VERTICES_PER_SEGMENT ) )
	const triangleSegment = vertexIndex.toUint().div( uint( RIBBON_VERTICES_PER_SEGMENT ) )
	const ribbonBodyVertex = triangleVertex.lessThan( uint( 6 ) )
	const bodyVertex = triangleVertex.mod( uint( 6 ) )
	const bodyUsesNext = bodyVertex.equal( uint( 2 ) )
		.or( bodyVertex.equal( uint( 3 ) ) )
		.or( bodyVertex.equal( uint( 5 ) ) )
	const bodyPositiveSide = bodyVertex.equal( uint( 1 ) )
		.or( bodyVertex.equal( uint( 4 ) ) )
		.or( bodyVertex.equal( uint( 5 ) ) )

	// Each segment reserves two triangles at its far end. They collapse for a
	// supported shared miter; otherwise one outer half-wedge bridges the
	// incoming and outgoing full-width bodies.
	const joinVertex = triangleVertex.sub( uint( 6 ) )
	const joinPointIndex = min( triangleSegment.add( uint( 1 ) ), lastIndex )
	const joinCenter = positionAt( joinPointIndex )
	const joinPrevious = positionAt( previousOf( joinPointIndex ) )
	const joinNext = positionAt( nextOf( joinPointIndex ) )
	const joinCenterVertex = joinVertex.equal( uint( 0 ) ).or( joinVertex.equal( uint( 3 ) ) )
	const joinPositiveSide = joinVertex.lessThan( uint( 3 ) )
	const joinUsesIncoming = joinVertex.equal( uint( 1 ) ).or( joinVertex.equal( uint( 5 ) ) )
	const joinTurn = dot(
		cross( joinCenter.sub( joinPrevious ), joinNext.sub( joinCenter ) ),
		vec3( 0, 0, 1 ),
	)
	const joinIsOuter = joinTurn.lessThan( float( 0 ) )
		.select( joinPositiveSide, joinPositiveSide.not() )
	const ribbonPositiveSide = ribbonBodyVertex.select( bodyPositiveSide, joinPositiveSide )
	const ribbonPointIndex = ribbonBodyVertex.select(
		triangleSegment.add( bodyUsesNext.select( uint( 1 ), uint( 0 ) ) ),
		joinPointIndex,
	)
	const ribbonSegmentEnd = ribbonBodyVertex.select( bodyUsesNext, joinUsesIncoming )
	const evaluatedRibbonPoint = ribbonPoint( ribbonPointIndex, ribbonPositiveSide, ribbonSegmentEnd )
	const joinPosition = joinCenterVertex.or( joinIsOuter.not() ).select( joinCenter, evaluatedRibbonPoint )
	const ribbonPosition = breaksAt( triangleSegment ).select(
		positionAt( triangleSegment ),
		ribbonBodyVertex.select( evaluatedRibbonPoint, joinPosition ),
	)

	const lineVertex = vertexIndex.toUint().mod( uint( LINE_VERTICES_PER_SEGMENT ) )
	const lineSegment = vertexIndex.toUint().div( uint( LINE_VERTICES_PER_SEGMENT ) )
	const linePosition = breaksAt( lineSegment ).select(
		positionAt( lineSegment ),
		positionAt( lineSegment.add( lineVertex ) ),
	)

	// Topology overlay: the two ribbon rails plus one transverse rib per
	// segment. Enough to read the emitted vertex density without turning the
	// dense regions into an unreadable hairball.
	const wireVertex = vertexIndex.toUint().mod( uint( WIREFRAME_VERTICES_PER_SEGMENT ) )
	const wireSegment = vertexIndex.toUint().div( uint( WIREFRAME_VERTICES_PER_SEGMENT ) )
	const wireEndPoint = min( wireSegment.add( uint( 1 ) ), lastIndex )
	const wireEndCenter = positionAt( wireEndPoint )
	const wireChordVisible = length( wireEndCenter.sub( positionAt( wireSegment ) ) )
		.greaterThanEqual( halfWidth.mul( 2 ) )
	const wireUsesEnd = wireVertex.equal( uint( 0 ) ).or( wireVertex.equal( uint( 2 ) ) ).not()
	const wirePositiveSide = wireVertex.equal( uint( 2 ) )
		.or( wireVertex.equal( uint( 3 ) ) )
		.or( wireVertex.equal( uint( 5 ) ) )
	const wireRibbonPoint = ribbonPoint(
		wireUsesEnd.select( wireEndPoint, wireSegment ),
		wirePositiveSide,
		wireUsesEnd,
	)
	const wireframePosition = wireVertex.greaterThanEqual( uint( 4 ) )
		.and( wireChordVisible.not() )
		.select( wireEndCenter, wireRibbonPoint )
	const wireframeFinal = breaksAt( wireSegment ).select( positionAt( wireSegment ), wireframePosition )

	const segmentHeat = segmentIndex => log2( max( float( gaps.element( min( segmentIndex, lastIndex ) ) ), 1 ) )
		// A fixed reference so the heatmap keeps meaning the same thing while
		// the chunk lattice moves with the tolerance.
		.div( float( Math.log2( SIMPLIFICATION_CHUNK_MAX ) ) )
		.clamp( 0, 1 )
	const heatColor = heat => {
		const coolToMint = mix( color( 0x38bdf8 ), color( 0x5eead4 ), smoothstep( 0.05, 0.42, heat ) )
		const mintToAmber = mix( coolToMint, color( 0xfacc15 ), smoothstep( 0.34, 0.74, heat ) )
		return mix( mintToAmber, color( 0xfb7185 ), smoothstep( 0.7, 1, heat ) )
	}
	const shade = segmentIndex => gaps
		? heatColor( segmentHeat( segmentIndex ) )
		: mix( color( 0x0e7490 ), color( 0x67e8f9 ), float( 0.55 ) )

	const ribbonMaterial = new MeshBasicNodeMaterial( { side: DoubleSide } )
	ribbonMaterial.positionNode = ribbonPosition
	ribbonMaterial.colorNode = gaps
		? heatColor( segmentHeat( triangleSegment ) )
		: mix( color( 0x155e75 ), color( 0x7dd3fc ), ribbonPositiveSide.select( float( 1 ), float( 0 ) ) )

	const lineMaterial = new LineBasicNodeMaterial()
	lineMaterial.positionNode = linePosition
	lineMaterial.colorNode = shade( lineSegment )

	const wireframeMaterial = new LineBasicNodeMaterial()
	wireframeMaterial.positionNode = wireframeFinal
	wireframeMaterial.colorNode = shade( wireSegment )

	return {
		lines: createRenderObject( LineSegments, lineMaterial, indirect, LINE_DRAW_OFFSET ),
		ribbons: createRenderObject( Mesh, ribbonMaterial, indirect, RIBBON_DRAW_OFFSET ),
		wireframe: createRenderObject( LineSegments, wireframeMaterial, indirect, WIREFRAME_DRAW_OFFSET ),
	}
}
