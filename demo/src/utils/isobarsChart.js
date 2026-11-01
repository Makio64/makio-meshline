/**
 * The weather chart behind the Isobars demo: four synoptic pressure states, their
 * contours extracted with marching squares, and the tracks morphing one into another.
 */
import { CanvasTexture, DoubleSide, MathUtils, Mesh, MeshBasicNodeMaterial, PlaneGeometry, SRGBColorSpace } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { TWO_PI } from '@/makio/utils/math'
import { linePoints, times } from '@/utils/points'

export const LINE_SEGMENTS = 128

const WORLD_WIDTH = 15.6
const WORLD_DEPTH = 11.2
const GRID_X = 88
const GRID_Z = 64
const BASE_PRESSURE = 1012.5
const MIN_POINT_SPACING = 0.03

// The same cyclonic and anticyclonic systems persist through every state.
const SYSTEMS = [
	{ type: 'L', amp: -31.5, rx: 2.35, rz: 2.05 },
	{ type: 'L', amp: -21, rx: 1.85, rz: 1.65 },
	{ type: 'H', amp: 24.5, rx: 2.75, rz: 2.35 },
]

// Each pose is the [x, z, rotation, bend] of one system.
const createState = ( id, name, ...poses ) => ( {
	id,
	title: `${id} · ${name}`,
	centers: SYSTEMS.map( ( system, index ) => {
		const [x, z, rot, bend] = poses[index]
		return { ...system, x, z, rot, bend }
	} ),
} )

// Sea-level pressure states (hPa) that evolve smoothly without boundary clipping.
export const SYNOPTIC_STATES = [
	createState( '00Z', 'North Atlantic Cyclone', [-3.2, -1.1, 0.18, 0.08], [-1.6, 2, -0.22, -0.06], [3.1, 0.2, 0.14, 0.07] ),
	createState( '06Z', 'Ridge Split & Trough', [-2.5, -1.6, 0.32, 0.1], [-2.4, 1.65, -0.1, -0.08], [3.3, -0.4, -0.15, 0.09] ),
	createState( '12Z', 'Twin Lows Orbiting', [-1.8, -1.2, 0.1, 0.07], [-3.1, 1.45, 0.2, -0.05], [2.7, 0.6, 0.22, -0.08] ),
	createState( '18Z', 'Deepening Polar Front', [-2.7, -0.6, -0.12, -0.07], [-1.8, 2.35, -0.25, 0.06], [3, 0.8, 0.08, 0.06] ),
]

// Not the base pressure: the chart's edge sits exactly on it, so all the others close into loops.
const PRESSURE_LEVELS = times( 21, index => 982.5 + index * 2.5 ).filter( level => level !== BASE_PRESSURE )

export const SYSTEM_TYPES = SYSTEMS.map( system => system.type )

export const pressureToY = hPa => ( hPa - BASE_PRESSURE ) * 0.022

const gridX = ix => ( ix / GRID_X - 0.5 ) * WORLD_WIDTH
const gridZ = iz => ( iz / GRID_Z - 0.5 ) * WORLD_DEPTH
const distance = ( a, b ) => Math.hypot( a[0] - b[0], a[1] - b[1] )

const edgeFade = ( value, size ) => MathUtils.smoothstep( 1 - Math.abs( value ) / ( size * 0.48 ), 0, 0.22 )

function samplePressure( state, x, z ) {
	let anomaly = 0
	for ( const center of state.centers ) {
		const dx = x - center.x
		const dz = z - center.z
		const cos = Math.cos( center.rot )
		const sin = Math.sin( center.rot )
		const ux = ( dx * cos - dz * sin ) / center.rx
		const uz = ( dx * sin + dz * cos + center.bend * dx * dx ) / center.rz
		anomaly += center.amp * Math.exp( -( ux * ux + uz * uz ) )
	}
	return BASE_PRESSURE + anomaly * edgeFade( x, WORLD_WIDTH ) * edgeFade( z, WORLD_DEPTH )
}

function sampleField( state ) {
	const field = new Float32Array( ( GRID_X + 1 ) * ( GRID_Z + 1 ) )
	for ( let iz = 0; iz <= GRID_Z; iz++ ) {
		for ( let ix = 0; ix <= GRID_X; ix++ ) {
			field[iz * ( GRID_X + 1 ) + ix] = samplePressure( state, gridX( ix ), gridZ( iz ) )
		}
	}
	return field
}

// The segments where `level` crosses the grid, as unordered pairs of [x, z] points.
function marchSquares( field, level ) {
	const segments = []
	const edgePoint = ( x0, z0, v0, x1, z1, v1 ) => {
		const delta = v1 - v0
		const t = Math.abs( delta ) > 1e-6 ? MathUtils.clamp( ( level - v0 ) / delta, 0, 1 ) : 0.5
		return [MathUtils.lerp( x0, x1, t ), MathUtils.lerp( z0, z1, t )]
	}

	for ( let iz = 0; iz < GRID_Z; iz++ ) {
		const z0 = gridZ( iz )
		const z1 = gridZ( iz + 1 )
		for ( let ix = 0; ix < GRID_X; ix++ ) {
			const x0 = gridX( ix )
			const x1 = gridX( ix + 1 )
			const corner = iz * ( GRID_X + 1 ) + ix
			const v00 = field[corner]
			const v10 = field[corner + 1]
			const v11 = field[corner + GRID_X + 2]
			const v01 = field[corner + GRID_X + 1]

			const above00 = v00 >= level
			const above10 = v10 >= level
			const above11 = v11 >= level
			const above01 = v01 >= level
			if ( above00 === above10 && above10 === above11 && above11 === above01 ) continue

			const bottom = above00 !== above10 ? edgePoint( x0, z0, v00, x1, z0, v10 ) : null
			const right = above10 !== above11 ? edgePoint( x1, z0, v10, x1, z1, v11 ) : null
			const top = above11 !== above01 ? edgePoint( x1, z1, v11, x0, z1, v01 ) : null
			const left = above01 !== above00 ? edgePoint( x0, z1, v01, x0, z0, v00 ) : null

			const crossings = [bottom, right, top, left].filter( Boolean )
			if ( crossings.length === 2 ) {
				segments.push( crossings )
				continue
			}

			// A saddle: the cell's average decides which of its corners connect.
			const centerAbove = 0.25 * ( v00 + v10 + v11 + v01 ) >= level
			if ( centerAbove === above00 ) segments.push( [bottom, left], [top, right] )
			else segments.push( [bottom, right], [top, left] )
		}
	}
	return segments
}

function stitchSegments( segments ) {
	const eps = 1e-4
	const closeEnough = ( a, b ) => Math.abs( a[0] - b[0] ) < eps && Math.abs( a[1] - b[1] ) < eps
	const used = new Uint8Array( segments.length )
	const loops = []

	for ( let i = 0; i < segments.length; i++ ) {
		if ( used[i] ) continue
		used[i] = 1
		const chain = [...segments[i]]
		let extended = true
		while ( extended ) {
			extended = false
			for ( let j = 0; j < segments.length; j++ ) {
				if ( used[j] ) continue
				const [a, b] = segments[j]
				const head = chain[0]
				const tail = chain.at( -1 )
				if ( closeEnough( tail, a ) ) chain.push( b )
				else if ( closeEnough( tail, b ) ) chain.push( a )
				else if ( closeEnough( head, b ) ) chain.unshift( a )
				else if ( closeEnough( head, a ) ) chain.unshift( b )
				else continue
				used[j] = 1
				extended = true
			}
		}
		// A stray segment never closes. A loop ends by repeating its first point.
		if ( chain.length > 3 && closeEnough( chain[0], chain.at( -1 ) ) ) {
			chain.pop()
			loops.push( chain )
		}
	}
	return loops
}

function dropClosePoints( loop ) {
	const kept = [loop[0]]
	for ( const point of loop ) {
		if ( distance( point, kept.at( -1 ) ) > MIN_POINT_SPACING ) kept.push( point )
	}
	if ( distance( kept[0], kept.at( -1 ) ) <= MIN_POINT_SPACING ) kept.pop()
	return kept
}

function chaikinSmooth( loop, iterations ) {
	let current = loop
	for ( let iteration = 0; iteration < iterations; iteration++ ) {
		const next = []
		for ( let i = 0; i < current.length; i++ ) {
			const a = current[i]
			const b = current[( i + 1 ) % current.length]
			next.push(
				[a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
				[a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
			)
		}
		current = next
	}
	return current
}

// One smooth counter-clockwise loop, with its points as a flat XYZ buffer.
function createContour( rawLoop, level ) {
	const loop = chaikinSmooth( dropClosePoints( rawLoop ), 4 )
	let area = 0
	let length = 0
	loop.forEach( ( a, i ) => {
		const b = loop[( i + 1 ) % loop.length]
		area += a[0] * b[1] - b[0] * a[1]
		length += distance( a, b )
	} )
	if ( area < 0 ) loop.reverse()

	const y = pressureToY( level )
	return { level, length, points: linePoints( loop.length, ( t, i ) => [loop[i][0], y, loop[i][1]] ) }
}

function extractContours( state ) {
	const field = sampleField( state )
	const contours = PRESSURE_LEVELS.flatMap( level => stitchSegments( marchSquares( field, level ) )
		.map( loop => createContour( loop, level ) ) )

	return {
		primary: contours.filter( contour => contour.level % 5 === 0 ),
		secondary: contours.filter( contour => contour.level % 5 !== 0 ),
		extrema: state.centers.map( ( { x, z } ) => ( { x, z, value: Math.round( samplePressure( state, x, z ) ) } ) ),
	}
}

// Arc-length resample one contour to `LINE_SEGMENTS + 1` points, the last repeating the
// first, with continuous first-Fourier-harmonic phase locking so loops morph without
// twist or state-boundary phase jumps.
function resampleContour( { points } ) {
	const count = points.length / 3
	const cumulative = new Float64Array( count + 1 )
	let total = 0
	for ( let i = 0; i < count; i++ ) {
		const next = ( i + 1 ) % count
		total += Math.hypot( points[next * 3] - points[i * 3], points[next * 3 + 2] - points[i * 3 + 2] )
		cumulative[i + 1] = total
	}

	const sampleAtArc = ( arc, out, offset ) => {
		const target = ( ( arc % total ) + total ) % total
		let low = 0
		let high = count - 1
		while ( low < high ) {
			const middle = ( low + high + 1 ) >> 1
			if ( cumulative[middle] <= target ) low = middle
			else high = middle - 1
		}
		const start = cumulative[low]
		const end = cumulative[low + 1]
		const t = end > start + 1e-8 ? ( target - start ) / ( end - start ) : 0
		const from = low * 3
		const to = ( ( low + 1 ) % count ) * 3
		for ( let axis = 0; axis < 3; axis++ ) {
			out[offset + axis] = MathUtils.lerp( points[from + axis], points[to + axis], t )
		}
	}

	const ring = new Float32Array( LINE_SEGMENTS * 3 )
	let cx = 0
	let cz = 0
	for ( let s = 0; s < LINE_SEGMENTS; s++ ) {
		sampleAtArc( ( s / LINE_SEGMENTS ) * total, ring, s * 3 )
		cx += ring[s * 3]
		cz += ring[s * 3 + 2]
	}
	cx /= LINE_SEGMENTS
	cz /= LINE_SEGMENTS

	let re = 0
	let im = 0
	for ( let s = 0; s < LINE_SEGMENTS; s++ ) {
		const dx = ring[s * 3] - cx
		const dz = ring[s * 3 + 2] - cz
		const radius = Math.hypot( dx, dz ) || 1
		const theta = ( s / LINE_SEGMENTS ) * TWO_PI
		re += ( dx * Math.cos( theta ) + dz * Math.sin( theta ) ) / radius
		im += ( dz * Math.cos( theta ) - dx * Math.sin( theta ) ) / radius
	}
	const arcOffset = ( -Math.atan2( im, re ) / TWO_PI ) * total

	const resampled = new Float32Array( ( LINE_SEGMENTS + 1 ) * 3 )
	for ( let s = 0; s < LINE_SEGMENTS; s++ ) {
		sampleAtArc( arcOffset + ( s / LINE_SEGMENTS ) * total, resampled, s * 3 )
	}
	resampled.copyWithin( LINE_SEGMENTS * 3, 0, 3 )
	return resampled
}

// Every level keeps exactly one contour through all four states, so the same index
// is the same isobar. Longest first: labels are staggered by track index.
const createTracks = ( fromContours, toContours ) => fromContours
	.map( ( from, index ) => ( {
		value: from.level,
		fromPoints: resampleContour( from ),
		toPoints: resampleContour( toContours[index] ),
		length: Math.max( from.length, toContours[index].length ),
	} ) )
	.sort( ( a, b ) => b.length - a.length )

/** Returns `( fromIndex, toIndex ) => pair`, the morph between two states, built on first use. */
export function createPairLookup() {
	const frames = SYNOPTIC_STATES.map( extractContours )
	const pairs = new Map()

	return ( fromIndex, toIndex ) => {
		const key = `${fromIndex}->${toIndex}`
		if ( pairs.has( key ) ) return pairs.get( key )

		const from = frames[fromIndex]
		const to = frames[toIndex]
		const pair = {
			primary: createTracks( from.primary, to.primary ),
			secondary: createTracks( from.secondary, to.secondary ),
			extrema: from.extrema.map( ( extremum, index ) => ( { from: extremum, to: to.extrema[index] } ) ),
		}
		pairs.set( key, pair )
		return pair
	}
}

function createChartGridTexture() {
	const canvas = document.createElement( 'canvas' )
	canvas.width = 512
	canvas.height = 512
	const ctx = canvas.getContext( '2d' )

	const gradient = ctx.createRadialGradient( 256, 256, 30, 256, 256, 280 )
	gradient.addColorStop( 0, '#0d1b30' )
	gradient.addColorStop( 0.7, '#071120' )
	gradient.addColorStop( 1, '#040811' )
	ctx.fillStyle = gradient
	ctx.fillRect( 0, 0, 512, 512 )

	ctx.strokeStyle = 'rgba(125, 211, 252, 0.08)'
	ctx.lineWidth = 1
	for ( let i = 32; i < 512; i += 32 ) {
		ctx.beginPath()
		ctx.moveTo( i, 0 )
		ctx.lineTo( i, 512 )
		ctx.stroke()
		ctx.beginPath()
		ctx.moveTo( 0, i )
		ctx.lineTo( 512, i )
		ctx.stroke()
	}

	ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)'
	ctx.strokeRect( 8, 8, 496, 496 )

	const texture = new CanvasTexture( canvas )
	texture.colorSpace = SRGBColorSpace
	return texture
}

export function createChartFloor() {
	const floor = new Mesh(
		new PlaneGeometry( WORLD_WIDTH * 1.06, WORLD_DEPTH * 1.06 ),
		new MeshBasicNodeMaterial( {
			map: stage3d.own( createChartGridTexture() ),
			transparent: true,
			opacity: 0.92,
			side: DoubleSide,
			depthWrite: false,
		} ),
	)
	floor.rotation.x = -Math.PI * 0.5
	floor.position.y = -0.78
	floor.renderOrder = -10
	return floor
}
