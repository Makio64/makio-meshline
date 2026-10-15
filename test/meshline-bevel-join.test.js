import assert from 'node:assert/strict'
import test from 'node:test'

import MeshLine from '../src/MeshLine.js'
import { countJoinBridges, MeshLineGeometry } from '../src/MeshLineGeometry.js'
import { SCREEN_DIRECTION_EPSILON } from '../src/MeshLineNodeMaterial.js'

const BEVEL = { type: 'bevel', limit: 4, segments: 8, inner: 'exact' }
const COPIES_PER_POINT = 4

const openLine = pointCount => {
	const points = new Float32Array( pointCount * 3 )
	for ( let i = 0; i < pointCount; i++ ) points[i * 3] = i
	return points
}

// ---------------------------------------------------------------------------
// Index topology
// ---------------------------------------------------------------------------

test( 'bevel join fill is opt-in and leaves the default billboard topology untouched', () => {
	const points = openLine( 4 )
	const plain = new MeshLineGeometry( { lines: points } )
	const simple = new MeshLineGeometry( { lines: points.slice(), join: { type: 'miter', limit: 4 } } )

	assert.equal( plain.getIndex().count, ( 4 - 1 ) * 6 )
	assert.equal( simple.getIndex().count, ( 4 - 1 ) * 6, 'a miter join must not add triangles' )
	assert.deepEqual( Array.from( plain.getIndex().array ), Array.from( simple.getIndex().array ) )

	plain.dispose()
	simple.dispose()
} )

test( 'a bevel join bridges every interior point without adding vertices', () => {
	const points = openLine( 3 )
	const geometry = new MeshLineGeometry( { lines: points, join: BEVEL } )

	// One interior point on a 3-point open line: the endpoints carry no incident
	// direction, so they get no bridge.
	assert.equal( countJoinBridges( 3, false ), 1 )
	assert.equal( geometry.getAttribute( 'position' ).count, 3 * COPIES_PER_POINT, 'bevel fill must reuse existing vertices' )
	assert.equal( geometry.getIndex().count, ( 3 - 1 ) * 6 + 1 * 6 )
	assert.deepEqual( Array.from( geometry.getIndex().array ), [
		// bodies
		2, 3, 4, 4, 3, 5,
		6, 7, 8, 8, 7, 9,
		// bridge at point 1: (in+, in-, out+), (out+, in-, out-)
		4, 5, 6, 6, 5, 7,
	] )

	geometry.dispose()
} )

test( 'a bevel bridge quad reuses the body winding and only existing role copies', () => {
	const geometry = new MeshLineGeometry( { lines: openLine( 3 ), join: BEVEL, needsSide: true } )
	const side = geometry.getAttribute( 'side' )
	const joinRole = geometry.getAttribute( 'joinRole' )
	const bridge = Array.from( geometry.getIndex().array ).slice( -6 )

	// Same (+, -, +) / (+, -, -) pattern the body quads use.
	assert.deepEqual( bridge.map( vertex => side.getX( vertex ) ), [1, -1, 1, 1, -1, -1] )
	// Incoming pair then outgoing pair of the same point.
	assert.deepEqual( bridge.map( vertex => joinRole.getX( vertex ) ), [-1, -2, 1, 1, -2, 2] )
	assert.ok( bridge.every( vertex => vertex < geometry.getAttribute( 'position' ).count ) )

	geometry.dispose()
} )

test( 'a closed bevel line bridges its seam exactly once', () => {
	// A looped line stores a synthetic duplicate of point 0 as its last point, so
	// the seam corner lives at index 0 and the duplicate must not bridge again.
	const square = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] )
	const geometry = new MeshLineGeometry( { lines: [square], closed: true, join: BEVEL } )
	const storedPoints = geometry.getAttribute( 'position' ).count / COPIES_PER_POINT

	assert.equal( storedPoints, 5, 'the closing point is appended by the builder' )
	assert.equal( countJoinBridges( 5, true ), 4 )
	assert.equal( geometry.getIndex().count, ( 5 - 1 ) * 6 + 4 * 6 )

	const bridges = Array.from( geometry.getIndex().array ).slice( ( 5 - 1 ) * 6 )
	assert.deepEqual( bridges.slice( 0, 3 ), [0, 1, 2], 'the seam corner bridges at point 0' )
	const lastBridgeBase = bridges[bridges.length - 6]
	assert.equal( lastBridgeBase, 3 * COPIES_PER_POINT, 'the duplicated closing point must not bridge' )

	geometry.dispose()
} )

test( 'bevel index runs stay contiguous per line and are reported for chunking', () => {
	const first = openLine( 2 )
	const second = openLine( 4 )
	const geometry = new MeshLineGeometry( { lines: [first, second], join: BEVEL } )

	const firstCount = ( 2 - 1 ) * 6 + countJoinBridges( 2, false ) * 6
	const secondCount = ( 4 - 1 ) * 6 + countJoinBridges( 4, false ) * 6

	assert.equal( firstCount, 6, 'a two-point line has no interior join' )
	assert.equal( secondCount, 18 + 12 )
	assert.deepEqual( geometry._lineIndexCounts, [firstCount, secondCount] )
	assert.equal( geometry.getIndex().count, firstCount + secondCount )

	// Every index of the first line must address that line's own vertices, so the
	// culling system can keep treating each run as one contiguous range.
	const index = Array.from( geometry.getIndex().array )
	assert.ok( index.slice( 0, firstCount ).every( vertex => vertex < 2 * COPIES_PER_POINT ) )
	assert.ok( index.slice( firstCount ).every( vertex => vertex >= 2 * COPIES_PER_POINT ) )

	geometry.dispose()
} )

test( 'miterLimit() changes only the limit and keeps the join topology', () => {
	const bevel = new MeshLine( { lines: openLine( 4 ), join: BEVEL } ).build()
	const bevelCount = bevel.geometry.getIndex().count
	assert.equal( bevel.miterLimit( 2 ), bevel )
	assert.equal( bevel.material.miterLimit, 2 )
	assert.equal( bevel.geometry.getIndex().count, bevelCount, 'the bevel fill survives a limit change' )
	bevel.dispose()

	// An unset join is the default miter: only the material limit changes.
	const plain = new MeshLine( { lines: openLine( 4 ) } ).build()
	const index = plain.geometry.getIndex()
	const version = index.version
	plain.miterLimit( 6 )
	assert.equal( plain.material.miterLimit, 6 )
	assert.equal( plain.geometry.getIndex(), index )
	assert.equal( index.version, version, 'no rebuild for the implicit miter join' )
	assert.throws( () => plain.miterLimit( 0.5 ), /limit/ )
	plain.dispose()
} )

test( 'connectivity reuse is invalidated by the join type and the loop flag', () => {
	const square = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] )

	// Same point count, join type flips: the index buffer must be rebuilt.
	const geometry = new MeshLineGeometry( { lines: [square] } )
	const plainCount = geometry.getIndex().count
	geometry.buildLine( { lines: [square.slice()], join: BEVEL } )
	assert.notEqual( geometry.getIndex().count, plainCount )
	assert.equal( geometry.getIndex().count, ( 4 - 1 ) * 6 + countJoinBridges( 4, false ) * 6 )
	geometry.dispose()

	// Same stored point count (no seam point is appended for a procedural path),
	// loop flag flips: connectivity must not be reused.
	const gpu = new MeshLineGeometry( {
		lines: [square.slice()],
		closed: false,
		join: BEVEL,
		gpuPositionNode: () => null,
	} )
	const openCount = gpu.getIndex().count
	gpu.buildLine( { lines: [square.slice()], closed: true } )
	assert.equal( gpu.getAttribute( 'position' ).count, 4 * COPIES_PER_POINT, 'no seam point on the procedural path' )
	assert.notEqual( gpu.getIndex().count, openCount, 'a loop-flag flip must rebuild connectivity' )
	assert.equal( gpu.getIndex().count, ( 4 - 1 ) * 6 + countJoinBridges( 4, true ) * 6 )
	gpu.dispose()
} )

// ---------------------------------------------------------------------------
// Vertex-stage oracle
//
// A faithful CPU replica of MeshLineNodeMaterial's screen-space expansion, with
// mvp = identity, w = 1, aspect = 1. It exists to pin the geometric claims the
// bevel bridge relies on, which cannot be observed from the geometry alone.
// ---------------------------------------------------------------------------

const REVERSAL_DOT = Math.fround( -Math.cos( Math.PI / 180 ) )
const sub2 = ( a, b ) => [a[0] - b[0], a[1] - b[1]]
const add2 = ( a, b ) => [a[0] + b[0], a[1] + b[1]]
const scale2 = ( a, s ) => [a[0] * s, a[1] * s]
const len2 = a => Math.hypot( a[0], a[1] )
const dot2 = ( a, b ) => a[0] * b[0] + a[1] * b[1]
const cross2 = ( a, b ) => a[0] * b[1] - a[1] * b[0]
const mix2 = ( a, b, t ) => Array.isArray( a )
	? [a[0] * ( 1 - t ) + b[0] * t, a[1] * ( 1 - t ) + b[1] * t]
	: a * ( 1 - t ) + b * t
const stepAt = ( edge, x ) => x < edge ? 0 : 1
const smoothstepAt = ( e0, e1, x ) => {
	const t = Math.min( 1, Math.max( 0, ( x - e0 ) / ( e1 - e0 ) ) )
	return t * t * ( 3 - 2 * t )
}

const expandVertex = ( previous, point, next, { outgoing, side, width = 0.2, miterLimit = 4, endpointMarker = 0 } ) => {
	const eps = SCREEN_DIRECTION_EPSILON
	const threshold = 2 / miterLimit
	const delta1Raw = sub2( point, previous )
	const delta2Raw = sub2( next, point )
	const delta1RawLen = len2( delta1Raw )
	const delta2RawLen = len2( delta2Raw )
	const projected1 = scale2( delta1Raw, 1 / Math.max( delta1RawLen, eps ) )
	const projected2 = scale2( delta2Raw, 1 / Math.max( delta2RawLen, eps ) )
	const reversal = delta1RawLen >= eps && delta2RawLen >= eps && dot2( projected1, projected2 ) <= REVERSAL_DOT
	const atStart = Math.max( Math.max( -endpointMarker, 0 ), outgoing && reversal ? 1 : 0 )
	const atEnd = Math.max( Math.max( endpointMarker, 0 ), !outgoing && reversal ? 1 : 0 )
	const delta1 = mix2( delta1Raw, delta2Raw, atStart )
	const delta2 = mix2( delta2Raw, delta1Raw, atEnd )
	const delta1Len = len2( delta1 )
	const delta2Len = len2( delta2 )
	const dir1Raw = scale2( delta1, 1 / Math.max( delta1Len, eps ) )
	const dir2Raw = scale2( delta2, 1 / Math.max( delta2Len, eps ) )
	const dir1 = mix2( mix2( [1, 0], dir2Raw, stepAt( eps, delta2Len ) ), dir1Raw, stepAt( eps, delta1Len ) )
	const dir2 = mix2( dir1, dir2Raw, stepAt( eps, delta2Len ) )
	const dirSum = add2( dir1, dir2 )
	const dirSumLen = len2( dirSum )
	const bodyDirection = outgoing ? dir2 : dir1
	const perpFallback = [-bodyDirection[1], bodyDirection[0]]
	const miterBlend = smoothstepAt( threshold * 0.75, threshold, dirSumLen )
	const blendedPerp = mix2( perpFallback, scale2( [-dirSum[1], dirSum[0]], 1 / Math.max( dirSumLen, 1e-4 ) ), miterBlend )
	const blendedPerpLen = len2( blendedPerp )
	const unitPerp = mix2( perpFallback, scale2( blendedPerp, 1 / Math.max( blendedPerpLen, 1e-4 ) ), stepAt( 1e-4, blendedPerpLen ) )
	const miterHalfWidth = mix2( width * 0.5, width / Math.max( dirSumLen, threshold ), miterBlend )
	const bodyVisible = ( outgoing ? delta2RawLen : delta1RawLen ) >= eps
	// The shipped material gates the OFFSET, so an invisible row collapses onto
	// its centerline instead of being pushed outside the frustum.
	const offset = bodyVisible ? scale2( unitPerp, miterHalfWidth * side ) : [0, 0]
	return { position: add2( point, offset ), miterBlend, bodyVisible }
}

const expandPoint = ( previous, point, next, options = {} ) => [
	expandVertex( previous, point, next, { outgoing: false, side: 1, ...options } ),
	expandVertex( previous, point, next, { outgoing: false, side: -1, ...options } ),
	expandVertex( previous, point, next, { outgoing: true, side: 1, ...options } ),
	expandVertex( previous, point, next, { outgoing: true, side: -1, ...options } ),
]

const signedArea = ( a, b, c ) => 0.5 * cross2( sub2( b, a ), sub2( c, a ) )

const bridgeAreas = rows => {
	const p = rows.map( row => row.position )
	return [signedArea( p[0], p[1], p[2] ), signedArea( p[2], p[1], p[3] )]
}

const cornerAt = degrees => {
	const angle = Math.PI * degrees / 180
	return [[-1, 0], [0, 0], [Math.cos( angle ), Math.sin( angle )]]
}

test( 'the bevel bridge is a bowtie: its triangles always wind oppositely', () => {
	for ( const turn of [20, -20, 60, -60, 175, -175, 179.9, -179.9] ) {
		const [previous, point, next] = cornerAt( turn )
		const [first, second] = bridgeAreas( expandPoint( previous, point, next ) )
		assert.ok(
			Math.sign( first ) !== Math.sign( second ) || ( first === 0 && second === 0 ),
			`turn ${turn}: expected opposite windings, got ${first} and ${second}`,
		)
	}
} )

test( 'exactly one bevel bridge triangle survives front-face culling at a fallback join', () => {
	// Default miter limit 4 puts the fallback threshold near a 151 degree bend.
	for ( const turn of [160, -160, 175, -175, 179, -179] ) {
		const [previous, point, next] = cornerAt( turn )
		const rows = expandPoint( previous, point, next )
		const [first, second] = bridgeAreas( rows )
		const frontFacing = [first, second].filter( area => area > 0 )

		assert.ok( rows[0].miterBlend < 1, `turn ${turn}: expected the miter fallback to engage` )
		assert.equal( frontFacing.length, 1, `turn ${turn}: areas ${first} and ${second}` )
		assert.ok( Math.abs( first ) > 1e-9, `turn ${turn}: the bridge must have real area` )
	}
} )

test( 'a supported miter leaves both bevel bridge triangles exactly degenerate', () => {
	for ( const turn of [5, -5, 20, -20, 90, -90, 140, -140] ) {
		const [previous, point, next] = cornerAt( turn )
		const rows = expandPoint( previous, point, next )
		assert.equal( rows[0].miterBlend, 1, `turn ${turn}: expected a fully resolved miter` )
		assert.deepEqual( rows[0].position, rows[2].position, `turn ${turn}: the + rows must coincide` )
		assert.deepEqual( rows[1].position, rows[3].position, `turn ${turn}: the - rows must coincide` )
		assert.deepEqual( bridgeAreas( rows ), [0, 0], `turn ${turn}: a supported miter must cost no fill` )
	}
} )

test( 'a bridge whose incoming body collapses in screen space has no area', () => {
	// Two coincident points give the incoming body zero projected length. With
	// the old off-frustum sentinel this produced a wedge spanning the viewport.
	const rows = expandPoint( [0, 0], [0, 0], [1, 0] )
	const [first, second] = bridgeAreas( rows )

	assert.equal( rows[0].bodyVisible, false, 'the incoming row must be classified as collapsed' )
	assert.equal( rows[2].bodyVisible, true, 'the outgoing row is still a real body' )
	assert.deepEqual( rows[0].position, [0, 0], 'a collapsed row sits on its centerline' )
	assert.equal( first, 0 )
	assert.equal( second, 0 )
} )

// ---------------------------------------------------------------------------
// Antialias / transparency invariant
// ---------------------------------------------------------------------------

test( 'antialias keeps the material blending through every transparency setter', () => {
	// Coverage is written into alpha, and three drops the blend state entirely for
	// an opaque NormalBlending material — so any setter that recomputes
	// `transparent` has to keep honouring antialias, or the feature silently dies.
	const line = new MeshLine().lines( openLine( 3 ) ).antialias( true ).build()
	assert.equal( line.material.transparent, true )

	line.opacity( 0.4 )
	assert.equal( line.material.transparent, true )

	line.opacity( 1 )
	assert.equal( line.material.transparent, true, 'opacity( 1 ) must not switch blending off' )

	line.transparent( false )
	assert.equal( line.material.transparent, true, 'transparent( false ) must not switch blending off' )

	line.dispose()

	// ...and a line without antialias keeps its previous behaviour exactly.
	const plain = new MeshLine().lines( openLine( 3 ) ).build()
	assert.equal( plain.material.transparent, false )
	plain.opacity( 0.4 )
	assert.equal( plain.material.transparent, true )
	plain.opacity( 1 )
	assert.equal( plain.material.transparent, false )
	plain.dispose()
} )
