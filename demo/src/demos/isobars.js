import { MeshLine, storagePositions } from 'makio-meshline'
import { attribute, float, mix, smoothstep, uniform, varyingProperty } from 'three/tsl'
import {
	CanvasTexture,
	DoubleSide,
	InstancedBufferAttribute,
	Mesh,
	MeshBasicNodeMaterial,
	PlaneGeometry,
	SRGBColorSpace,
	StorageBufferAttribute,
	Vector3,
} from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { createBloomPipeline } from '@/utils/bloomPipeline'

const GRID_X = 72
const GRID_Z = 52
const WORLD_WIDTH = 15.6
const WORLD_DEPTH = 11.2
const LINE_SEGMENTS = 96
const POINT_STRIDE = LINE_SEGMENTS + 1
const PRIMARY_CAPACITY = 20
const SECONDARY_CAPACITY = 36
const HOLD_DURATION = 1.6
const MORPH_DURATION = 2.6

// Four synoptic sea-level pressure states (hPa) with splitting/merging lows and ridges
const SYNOPTIC_STATES = [
	{
		id: '00Z',
		title: '00Z · North Atlantic Cyclone',
		base: 1013,
		gradX: -1.5,
		gradZ: -3.2,
		centers: [
			{ type: 'L', x: -3.4, z: -0.9, amp: -34, rx: 3.1, rz: 2.5 },
			{ type: 'H', x: 3.8, z: 1.4, amp: 22, rx: 3.8, rz: 3.0 },
			{ type: 'L', x: 2.4, z: -2.9, amp: -15, rx: 2.3, rz: 2.0 },
		],
	},
	{
		id: '06Z',
		title: '06Z · Ridge Split & Trough',
		base: 1013,
		gradX: 0.4,
		gradZ: -2.8,
		centers: [
			{ type: 'L', x: -1.6, z: -1.5, amp: -28, rx: 2.8, rz: 2.4 },
			{ type: 'L', x: -4.4, z: 1.6, amp: -19, rx: 2.3, rz: 2.1 },
			{ type: 'H', x: 2.9, z: 0.5, amp: 24, rx: 3.4, rz: 2.9 },
		],
	},
	{
		id: '12Z',
		title: '12Z · Twin Lows Merging',
		base: 1012,
		gradX: 1.8,
		gradZ: -2.2,
		centers: [
			{ type: 'L', x: 0.2, z: -0.4, amp: -31, rx: 3.3, rz: 2.4 },
			{ type: 'L', x: -3.1, z: 0.8, amp: -22, rx: 2.5, rz: 2.2 },
			{ type: 'H', x: 4.5, z: -1.2, amp: 21, rx: 3.2, rz: 2.8 },
			{ type: 'H', x: -4.2, z: -2.6, amp: 15, rx: 2.6, rz: 2.2 },
		],
	},
	{
		id: '18Z',
		title: '18Z · Deepening Polar Front',
		base: 1013,
		gradX: -0.8,
		gradZ: -3.5,
		centers: [
			{ type: 'L', x: 1.9, z: -0.6, amp: -35, rx: 3.4, rz: 2.6 },
			{ type: 'H', x: -3.2, z: 1.3, amp: 25, rx: 3.7, rz: 2.9 },
			{ type: 'L', x: -2.6, z: -2.8, amp: -16, rx: 2.3, rz: 1.9 },
		],
	},
]

const PRESSURE_LEVELS = []
for ( let p = 982.5; p <= 1032.5; p += 2.5 ) {
	PRESSURE_LEVELS.push( p )
}

function samplePressure( state, x, z ) {
	let p = state.base + ( x / ( WORLD_WIDTH * 0.5 ) ) * state.gradX + ( z / ( WORLD_DEPTH * 0.5 ) ) * state.gradZ
	for ( const c of state.centers ) {
		const dx = ( x - c.x ) / c.rx
		const dz = ( z - c.z ) / c.rz
		p += c.amp * Math.exp( -( dx * dx + dz * dz ) )
	}
	return p
}

function pressureToY( hPa ) {
	return ( hPa - 1012 ) * 0.022
}

// Extract stitched contour polylines from a scalar grid via marching squares
function extractIsobarsForState( state ) {
	const field = new Float32Array( ( GRID_X + 1 ) * ( GRID_Z + 1 ) )
	for ( let iz = 0; iz <= GRID_Z; iz++ ) {
		const z = ( iz / GRID_Z - 0.5 ) * WORLD_DEPTH
		for ( let ix = 0; ix <= GRID_X; ix++ ) {
			const x = ( ix / GRID_X - 0.5 ) * WORLD_WIDTH
			field[iz * ( GRID_X + 1 ) + ix] = samplePressure( state, x, z )
		}
	}

	const primary = []
	const secondary = []

	for ( const level of PRESSURE_LEVELS ) {
		const segments = []
		const edgePoint = ( x0, z0, v0, x1, z1, v1 ) => {
			const denom = v1 - v0
			const t = Math.abs( denom ) > 1e-6 ? Math.max( 0, Math.min( 1, ( level - v0 ) / denom ) ) : 0.5
			return [x0 + ( x1 - x0 ) * t, z0 + ( z1 - z0 ) * t]
		}

		for ( let iz = 0; iz < GRID_Z; iz++ ) {
			const z0 = ( iz / GRID_Z - 0.5 ) * WORLD_DEPTH
			const z1 = ( ( iz + 1 ) / GRID_Z - 0.5 ) * WORLD_DEPTH
			for ( let ix = 0; ix < GRID_X; ix++ ) {
				const x0 = ( ix / GRID_X - 0.5 ) * WORLD_WIDTH
				const x1 = ( ( ix + 1 ) / GRID_X - 0.5 ) * WORLD_WIDTH
				const i00 = iz * ( GRID_X + 1 ) + ix
				const v00 = field[i00]
				const v10 = field[i00 + 1]
				const v11 = field[i00 + GRID_X + 2]
				const v01 = field[i00 + GRID_X + 1]

				const mask = ( v00 >= level ? 1 : 0 ) |
					( v10 >= level ? 2 : 0 ) |
					( v11 >= level ? 4 : 0 ) |
					( v01 >= level ? 8 : 0 )
				if ( mask === 0 || mask === 15 ) continue

				// Compare corner states, not raw bits: ( mask & 1 ) !== ( mask & 2 ) is
				// also true when both corners are above the level.
				const above00 = v00 >= level
				const above10 = v10 >= level
				const above11 = v11 >= level
				const above01 = v01 >= level
				const eBottom = above00 !== above10 ? edgePoint( x0, z0, v00, x1, z0, v10 ) : null
				const eRight = above10 !== above11 ? edgePoint( x1, z0, v10, x1, z1, v11 ) : null
				const eTop = above11 !== above01 ? edgePoint( x1, z1, v11, x0, z1, v01 ) : null
				const eLeft = above01 !== above00 ? edgePoint( x0, z1, v01, x0, z0, v00 ) : null

				if ( mask === 5 || mask === 10 ) {
					const centerVal = 0.25 * ( v00 + v10 + v11 + v01 )
					if ( ( mask === 5 && centerVal >= level ) || ( mask === 10 && centerVal < level ) ) {
						segments.push( [eBottom, eLeft], [eTop, eRight] )
					} else {
						segments.push( [eBottom, eRight], [eTop, eLeft] )
					}
				} else {
					const pts = [eBottom, eRight, eTop, eLeft].filter( Boolean )
					if ( pts.length === 2 ) segments.push( [pts[0], pts[1]] )
				}
			}
		}

		const polylines = stitchSegments( segments )
		const isPrimary = Math.abs( level % 5 ) < 1e-4
		for ( const poly of polylines ) {
			const smoothed = chaikinSmooth( poly.points, poly.closed, 2 )
			const packed = new Float32Array( smoothed.length * 3 )
			const y = pressureToY( level )
			let length = 0
			let cx = 0
			let cz = 0
			for ( let i = 0; i < smoothed.length; i++ ) {
				const [x, z] = smoothed[i]
				packed[i * 3] = x
				packed[i * 3 + 1] = y
				packed[i * 3 + 2] = z
				cx += x
				cz += z
				if ( i > 0 ) {
					length += Math.hypot( x - smoothed[i - 1][0], z - smoothed[i - 1][1] )
				}
			}
			if ( poly.closed && smoothed.length > 2 ) {
				const last = smoothed[smoothed.length - 1]
				length += Math.hypot( smoothed[0][0] - last[0], smoothed[0][1] - last[1] )
			}
			if ( length < 1.1 ) continue

			const descriptor = {
				value: level,
				closed: poly.closed,
				points: packed,
				length,
				centroidX: cx / smoothed.length,
				centroidZ: cz / smoothed.length,
				startX: smoothed[0][0],
				startZ: smoothed[0][1],
				endX: smoothed[smoothed.length - 1][0],
				endZ: smoothed[smoothed.length - 1][1],
			}
			if ( isPrimary ) primary.push( descriptor )
			else secondary.push( descriptor )
		}
	}

	const extrema = state.centers.map( c => ( {
		type: c.type,
		x: c.x,
		z: c.z,
		value: Math.round( samplePressure( state, c.x, c.z ) ),
	} ) )

	return { primary, secondary, extrema }
}

function stitchSegments( segments ) {
	const eps = 1e-4
	const used = new Uint8Array( segments.length )
	const polylines = []
	const closeEnough = ( a, b ) => Math.abs( a[0] - b[0] ) < eps && Math.abs( a[1] - b[1] ) < eps

	for ( let i = 0; i < segments.length; i++ ) {
		if ( used[i] ) continue
		used[i] = 1
		const chain = [segments[i][0], segments[i][1]]
		let extended = true
		while ( extended ) {
			extended = false
			for ( let j = 0; j < segments.length; j++ ) {
				if ( used[j] ) continue
				const [a, b] = segments[j]
				const head = chain[0]
				const tail = chain[chain.length - 1]
				if ( closeEnough( tail, a ) ) {
					chain.push( b )
					used[j] = 1
					extended = true
				} else if ( closeEnough( tail, b ) ) {
					chain.push( a )
					used[j] = 1
					extended = true
				} else if ( closeEnough( head, b ) ) {
					chain.unshift( a )
					used[j] = 1
					extended = true
				} else if ( closeEnough( head, a ) ) {
					chain.unshift( b )
					used[j] = 1
					extended = true
				}
			}
		}
		const closed = chain.length > 3 && closeEnough( chain[0], chain[chain.length - 1] )
		if ( closed ) chain.pop()
		if ( chain.length >= 3 ) polylines.push( { points: chain, closed } )
	}
	return polylines
}

function chaikinSmooth( points, closed, iterations = 1 ) {
	let current = points
	for ( let iter = 0; iter < iterations; iter++ ) {
		const next = []
		const count = current.length
		if ( !closed ) next.push( current[0] )
		const limit = closed ? count : count - 1
		for ( let i = 0; i < limit; i++ ) {
			const a = current[i]
			const b = current[( i + 1 ) % count]
			next.push(
				[a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
				[a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]
			)
		}
		if ( !closed ) next.push( current[count - 1] )
		current = next
	}
	return current
}

// Arc-length resample one contour to `segments + 1` points (with duplicate closing point on loops)
function resampleContour( line, segments = LINE_SEGMENTS ) {
	const pts = line.points
	const count = pts.length / 3
	const closed = line.closed
	const cumulative = new Float64Array( count + ( closed ? 1 : 0 ) )
	let total = 0
	for ( let i = 1; i < count; i++ ) {
		const dx = pts[i * 3] - pts[( i - 1 ) * 3]
		const dz = pts[i * 3 + 2] - pts[( i - 1 ) * 3 + 2]
		total += Math.hypot( dx, dz )
		cumulative[i] = total
	}
	if ( closed && count > 1 ) {
		const last = ( count - 1 ) * 3
		total += Math.hypot( pts[0] - pts[last], pts[2] - pts[last + 2] )
		cumulative[count] = total
	}

	const out = new Float32Array( ( segments + 1 ) * 3 )
	const segEndCount = closed ? count : count - 1
	let seg = 0
	for ( let s = 0; s <= segments; s++ ) {
		const target = ( s / segments ) * total
		while ( seg < segEndCount - 1 && cumulative[seg + 1] < target ) seg++
		const d0 = cumulative[seg]
		const d1 = cumulative[seg + 1]
		const t = d1 > d0 + 1e-8 ? ( target - d0 ) / ( d1 - d0 ) : 0
		const i0 = seg * 3
		const i1 = ( ( seg + 1 ) % count ) * 3
		const dst = s * 3
		out[dst] = pts[i0] + ( pts[i1] - pts[i0] ) * t
		out[dst + 1] = pts[i0 + 1] + ( pts[i1 + 1] - pts[i0 + 1] ) * t
		out[dst + 2] = pts[i0 + 2] + ( pts[i1 + 2] - pts[i0 + 2] ) * t
	}
	return out
}

// Align closed loop phase (cyclic shift + winding direction) or open polyline orientation
// so pointwise morphing follows the shortest trajectory without twisting.
function alignContourPair( fromPoints, toPoints, closed ) {
	const sampleCount = fromPoints.length / 3
	const uniqueCount = closed ? sampleCount - 1 : sampleCount
	let bestCost = Infinity
	let bestReverse = false
	let bestShift = 0

	const evalCost = ( reverse, shift, step ) => {
		let cost = 0
		for ( let i = 0; i < uniqueCount; i += step ) {
			const j = closed
				? ( reverse ? ( shift - i + uniqueCount ) % uniqueCount : ( i + shift ) % uniqueCount )
				: ( reverse ? uniqueCount - 1 - i : i )
			const dx = fromPoints[i * 3] - toPoints[j * 3]
			const dz = fromPoints[i * 3 + 2] - toPoints[j * 3 + 2]
			cost += dx * dx + dz * dz
		}
		return cost
	}

	if ( closed ) {
		for ( const reverse of [false, true] ) {
			for ( let shift = 0; shift < uniqueCount; shift++ ) {
				const cost = evalCost( reverse, shift, 2 )
				if ( cost < bestCost ) {
					bestCost = cost
					bestReverse = reverse
					bestShift = shift
				}
			}
		}
	} else {
		for ( const reverse of [false, true] ) {
			const cost = evalCost( reverse, 0, 1 )
			if ( cost < bestCost ) {
				bestCost = cost
				bestReverse = reverse
			}
		}
	}

	const aligned = new Float32Array( toPoints.length )
	for ( let i = 0; i < uniqueCount; i++ ) {
		const j = closed
			? ( bestReverse ? ( bestShift - i + uniqueCount ) % uniqueCount : ( i + bestShift ) % uniqueCount )
			: ( bestReverse ? uniqueCount - 1 - i : i )
		aligned[i * 3] = toPoints[j * 3]
		aligned[i * 3 + 1] = toPoints[j * 3 + 1]
		aligned[i * 3 + 2] = toPoints[j * 3 + 2]
	}
	if ( closed ) {
		const last = uniqueCount * 3
		aligned[last] = aligned[0]
		aligned[last + 1] = aligned[1]
		aligned[last + 2] = aligned[2]
	}
	return aligned
}

function createContractedLoop( points, cx, cz, scale = 0.22 ) {
	const out = new Float32Array( points.length )
	for ( let i = 0; i < points.length; i += 3 ) {
		out[i] = cx + ( points[i] - cx ) * scale
		out[i + 1] = points[i + 1]
		out[i + 2] = cz + ( points[i + 2] - cz ) * scale
	}
	return out
}

// Match contours between two synoptic states using repo_js_map's track-matching model
function buildIsobarTracks( fromList, toList, capacity ) {
	const candidates = []
	for ( let fi = 0; fi < fromList.length; fi++ ) {
		const f = fromList[fi]
		for ( let ti = 0; ti < toList.length; ti++ ) {
			const t = toList[ti]
			if ( Math.abs( f.value - t.value ) > 2.5 || f.closed !== t.closed ) continue
			const ratio = Math.max( f.length, t.length ) / Math.max( 1e-4, Math.min( f.length, t.length ) )
			if ( ratio > 3.2 ) continue
			const dist = Math.hypot( f.centroidX - t.centroidX, f.centroidZ - t.centroidZ )
			if ( dist > 6.5 ) continue
			const levelPenalty = Math.abs( f.value - t.value ) * 0.8
			const cost = dist + Math.abs( Math.log( ratio ) ) * 1.8 + levelPenalty
			candidates.push( { fi, ti, cost } )
		}
	}
	candidates.sort( ( a, b ) => a.cost - b.cost )

	const usedFrom = new Set()
	const usedTo = new Set()
	const tracks = []

	for ( const { fi, ti } of candidates ) {
		if ( usedFrom.has( fi ) || usedTo.has( ti ) ) continue
		usedFrom.add( fi )
		usedTo.add( ti )
		const f = fromList[fi]
		const t = toList[ti]
		const fromPts = resampleContour( f )
		const toPts = alignContourPair( fromPts, resampleContour( t ), f.closed )
		tracks.push( {
			value: t.value,
			closed: f.closed,
			fromPoints: fromPts,
			toPoints: toPts,
			fromOpacity: 1,
			toOpacity: 1,
			importance: Math.max( f.length, t.length ) + 100,
		} )
	}

	for ( let fi = 0; fi < fromList.length; fi++ ) {
		if ( usedFrom.has( fi ) ) continue
		const f = fromList[fi]
		const fromPts = resampleContour( f )
		const toPts = f.closed ? createContractedLoop( fromPts, f.centroidX, f.centroidZ, 0.35 ) : fromPts
		tracks.push( {
			value: f.value,
			closed: f.closed,
			fromPoints: fromPts,
			toPoints: toPts,
			fromOpacity: 1,
			toOpacity: 0,
			importance: f.length,
		} )
	}

	for ( let ti = 0; ti < toList.length; ti++ ) {
		if ( usedTo.has( ti ) ) continue
		const t = toList[ti]
		const toPts = resampleContour( t )
		const fromPts = t.closed ? createContractedLoop( toPts, t.centroidX, t.centroidZ, 0.35 ) : toPts
		tracks.push( {
			value: t.value,
			closed: t.closed,
			fromPoints: fromPts,
			toPoints: toPts,
			fromOpacity: 0,
			toOpacity: 1,
			importance: t.length,
		} )
	}

	tracks.sort( ( a, b ) => b.importance - a.importance )
	return tracks.slice( 0, capacity )
}

function createChartGridTexture() {
	const canvas = document.createElement( 'canvas' )
	canvas.width = 512
	canvas.height = 512
	const ctx = canvas.getContext( '2d' )

	const grad = ctx.createRadialGradient( 256, 256, 30, 256, 256, 280 )
	grad.addColorStop( 0, '#0d1b30' )
	grad.addColorStop( 0.7, '#071120' )
	grad.addColorStop( 1, '#040811' )
	ctx.fillStyle = grad
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

	const tex = new CanvasTexture( canvas )
	tex.colorSpace = SRGBColorSpace
	tex.needsUpdate = true
	return tex
}

class IsobarBank {
	constructor( { name, color, gradientColor, lineWidth, opacity, capacity, uMorph, isWebGPU } ) {
		this.name = name
		this.capacity = capacity
		this.uMorph = uMorph
		this.isWebGPU = isWebGPU
		this.pointCapacity = capacity * POINT_STRIDE
		this.activeTracks = []

		this.fromAttribute = new StorageBufferAttribute( new Float32Array( this.pointCapacity * 4 ), 4 )
		this.toAttribute = new StorageBufferAttribute( new Float32Array( this.pointCapacity * 4 ), 4 )
		this.metaAttribute = new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 )

		const metaName = `isobar${name}Meta`
		const metaNode = attribute( metaName, 'vec4' )
		const trackAlpha = varyingProperty( 'float', `vIsobar${name}Alpha` )
		const easedMorph = smoothstep( float( 0 ), float( 1 ), uMorph )

		if ( isWebGPU ) {
			const positionNode = storagePositions( this.fromAttribute, {
				pointsPerLine: POINT_STRIDE,
				toBuffer: this.toAttribute,
				morph: easedMorph,
				closed: metaNode.z,
			} )

			this.mesh = new MeshLine()
				.instances( capacity )
				.segments( LINE_SEGMENTS )
				.gpuPositionNode( positionNode )
				.lineWidth( lineWidth )
				.color( color )
				.gradientColor( gradientColor )
				.opacity( opacity )
				// Transparent lines already skip depth writes unless asked otherwise.
				.transparent( true )
				.sizeAttenuation( true )
				.join( { type: 'round' } )
				.colorFn( baseColor => {
					trackAlpha.assign( mix( metaNode.x, metaNode.y, easedMorph ) )
					return baseColor
				} )
				.opacityFn( alpha => alpha.mul( trackAlpha ) )
				.build()
			this.mesh.geometry.setAttribute( metaName, this.metaAttribute )
			this.mesh.frustumCulled = false
		} else {
			// Portable WebGL2 fallback: single batched multi-line MeshLine updated on CPU
			const placeholder = [new Float32Array( POINT_STRIDE * 3 )]
			this.mesh = new MeshLine()
				.lines( placeholder, false )
				.dynamic( true )
				.lineWidth( lineWidth )
				.color( color )
				.gradientColor( gradientColor )
				.opacity( opacity )
				.transparent( true )
				.sizeAttenuation( true )
				.join( { type: 'round' } )
				.build()
			this.mesh.frustumCulled = false
		}
	}

	setTracks( tracks ) {
		const count = Math.min( tracks.length, this.capacity )
		this.activeTracks = tracks.slice( 0, count )

		if ( !this.isWebGPU ) {
			this.updateFallbackPositions( this.uMorph.value )
			return count
		}

		const fromArr = this.fromAttribute.array
		const toArr = this.toAttribute.array
		const metaArr = this.metaAttribute.array
		fromArr.fill( 0 )
		toArr.fill( 0 )
		metaArr.fill( 0 )

		for ( let t = 0; t < count; t++ ) {
			const track = tracks[t]
			const basePoint = t * POINT_STRIDE
			for ( let p = 0; p < POINT_STRIDE; p++ ) {
				const src = p * 3
				const dst = ( basePoint + p ) * 4
				fromArr[dst] = track.fromPoints[src]
				fromArr[dst + 1] = track.fromPoints[src + 1]
				fromArr[dst + 2] = track.fromPoints[src + 2]
				fromArr[dst + 3] = 1
				toArr[dst] = track.toPoints[src]
				toArr[dst + 1] = track.toPoints[src + 1]
				toArr[dst + 2] = track.toPoints[src + 2]
				toArr[dst + 3] = 1
			}
			const m = t * 4
			metaArr[m] = track.fromOpacity
			metaArr[m + 1] = track.toOpacity
			metaArr[m + 2] = track.closed ? 1 : 0
			metaArr[m + 3] = track.value
		}

		this.fromAttribute.needsUpdate = true
		this.toAttribute.needsUpdate = true
		this.metaAttribute.needsUpdate = true
		this.mesh.count = count
		return count
	}

	updateFallbackPositions( rawMorph ) {
		if ( this.isWebGPU || this.activeTracks.length === 0 ) return
		const t = rawMorph * rawMorph * ( 3 - 2 * rawMorph )
		const lines = []
		const closed = []
		for ( const track of this.activeTracks ) {
			const alpha = track.fromOpacity + ( track.toOpacity - track.fromOpacity ) * t
			if ( alpha < 0.08 ) continue
			const pts = new Float32Array( track.fromPoints.length )
			for ( let i = 0; i < pts.length; i++ ) {
				pts[i] = track.fromPoints[i] + ( track.toPoints[i] - track.fromPoints[i] ) * t
			}
			lines.push( pts )
			closed.push( track.closed )
		}
		if ( lines.length > 0 ) {
			this.mesh.visible = true
			this.mesh.lines( lines, closed )
		} else {
			this.mesh.visible = false
		}
	}

	resize() {
		this.mesh?.resize()
	}

	dispose() {
		this.mesh?.dispose()
	}
}

class IsobarsExample {
	constructor() {
		this.uMorph = uniform( 0 )
		this.banks = []
		this.frames = []
		this.pairCache = new Map()
		this.fromIndex = 0
		this.toIndex = 1
		this.phaseTime = 0
		this.playing = true
		this.control = null
		this.bloom = null
		this.floor = null
		this.floorTexture = null
		this.hudStyle = null
		this.hud = null
		this.overlayRoot = null
		this.markerEls = []
		this.labelEls = []
		this.stateButtons = []
		this.sliderEl = null
		this.playBtn = null
		this.statusEl = null
		this.projScratch = new Vector3()
	}

	async init() {
		await stage3d.initRender( { background: 0x040914 } )

		stage3d.camera.position.set( 0, 10.6, 10.8 )
		stage3d.camera.lookAt( 0, 0, 0 )
		this.control = new OrbitControl( stage3d.camera, 17.5 )
		this.control._phi = 0.82
		this.control._theta = 0
		this.control.minRadius = 8
		this.control.maxRadius = 24
		this.control.maxPhi = Math.PI * 0.46
		stage3d.control = this.control

		const prefersReducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true
		if ( prefersReducedMotion ) this.playing = false

		this.frames = SYNOPTIC_STATES.map( extractIsobarsForState )
		const isWebGPU = stage3d.renderer?.backend?.isWebGPUBackend === true

		this.banks = [
			new IsobarBank( {
				name: 'Primary',
				color: 0xfff2bf,
				gradientColor: 0x7dd3fc,
				lineWidth: 0.11,
				opacity: 0.96,
				capacity: PRIMARY_CAPACITY,
				uMorph: this.uMorph,
				isWebGPU,
			} ),
			new IsobarBank( {
				name: 'Secondary',
				color: 0x67e8f9,
				gradientColor: 0x38bdf8,
				lineWidth: 0.055,
				opacity: 0.58,
				capacity: SECONDARY_CAPACITY,
				uMorph: this.uMorph,
				isWebGPU,
			} ),
		]
		for ( const bank of this.banks ) stage3d.add( bank.mesh )

		this.createChartFloor()
		this.bloom = createBloomPipeline( { strength: 0.45, radius: 0.3, threshold: 0.2 } )
		if ( !new URLSearchParams( window.location.search ).has( 'noUI' ) ) {
			this.createHud()
		}

		this.setPair( 0, 1, 0 )

		stage.onUpdate.add( this.update )
		stage.onResize.add( this.onResize )
		this.onResize()
	}

	createChartFloor() {
		this.floorTexture = createChartGridTexture()
		const mat = new MeshBasicNodeMaterial( {
			map: this.floorTexture,
			transparent: true,
			opacity: 0.92,
			side: DoubleSide,
			depthWrite: false,
		} )
		this.floor = new Mesh( new PlaneGeometry( WORLD_WIDTH * 1.06, WORLD_DEPTH * 1.06 ), mat )
		this.floor.rotation.x = -Math.PI * 0.5
		this.floor.position.y = -0.78
		this.floor.renderOrder = -10
		stage3d.add( this.floor )
	}

	getPairData( fromIdx, toIdx ) {
		const key = `${fromIdx}->${toIdx}`
		if ( this.pairCache.has( key ) ) return this.pairCache.get( key )

		const fromFrame = this.frames[fromIdx]
		const toFrame = this.frames[toIdx]
		const primary = buildIsobarTracks( fromFrame.primary, toFrame.primary, PRIMARY_CAPACITY )
		const secondary = buildIsobarTracks( fromFrame.secondary, toFrame.secondary, SECONDARY_CAPACITY )

		// Match High / Low pressure extrema between states
		const extremaTracks = []
		const usedTo = new Set()
		for ( const f of fromFrame.extrema ) {
			let bestIdx = -1
			let bestDist = Infinity
			toFrame.extrema.forEach( ( t, idx ) => {
				if ( usedTo.has( idx ) || t.type !== f.type ) return
				const d = Math.hypot( f.x - t.x, f.z - t.z )
				if ( d < bestDist && d < 6.5 ) {
					bestDist = d
					bestIdx = idx
				}
			} )
			if ( bestIdx >= 0 ) {
				usedTo.add( bestIdx )
				const t = toFrame.extrema[bestIdx]
				extremaTracks.push( {
					type: f.type,
					fromX: f.x, fromZ: f.z, fromVal: f.value,
					toX: t.x, toZ: t.z, toVal: t.value,
					fromAlpha: 1, toAlpha: 1,
				} )
			} else {
				extremaTracks.push( {
					type: f.type,
					fromX: f.x, fromZ: f.z, fromVal: f.value,
					toX: f.x, toZ: f.z, toVal: f.value,
					fromAlpha: 1, toAlpha: 0,
				} )
			}
		}
		toFrame.extrema.forEach( ( t, idx ) => {
			if ( usedTo.has( idx ) ) return
			extremaTracks.push( {
				type: t.type,
				fromX: t.x, fromZ: t.z, fromVal: t.value,
				toX: t.x, toZ: t.z, toVal: t.value,
				fromAlpha: 0, toAlpha: 1,
			} )
		} )

		const pair = { primary, secondary, extremaTracks }
		this.pairCache.set( key, pair )
		return pair
	}

	setPair( fromIdx, toIdx, morph = 0 ) {
		this.fromIndex = fromIdx
		this.toIndex = toIdx
		const pair = this.getPairData( fromIdx, toIdx )
		this.banks[0].setTracks( pair.primary )
		this.banks[1].setTracks( pair.secondary )
		this.setMorph( morph )
		this.syncHudButtons()
	}

	setMorph( value ) {
		const clamped = Math.max( 0, Math.min( 1, value ) )
		this.uMorph.value = clamped
		for ( const bank of this.banks ) {
			bank.updateFallbackPositions( clamped )
		}
		if ( this.sliderEl ) this.sliderEl.value = String( Math.round( clamped * 100 ) )
		if ( this.statusEl ) {
			const fromState = SYNOPTIC_STATES[this.fromIndex]
			const toState = SYNOPTIC_STATES[this.toIndex]
			this.statusEl.textContent = `${fromState.id} → ${toState.id} (${Math.round( clamped * 100 )}%)`
		}
	}

	jumpToState( targetIdx ) {
		if ( targetIdx === this.toIndex && this.uMorph.value > 0.5 ) {
			this.playing = false
			this.syncPlayButton()
			this.setMorph( 1 )
			return
		}
		const currentActive = this.uMorph.value >= 0.5 ? this.toIndex : this.fromIndex
		const fromIdx = currentActive === targetIdx ? ( targetIdx + SYNOPTIC_STATES.length - 1 ) % SYNOPTIC_STATES.length : currentActive
		this.phaseTime = 0
		this.setPair( fromIdx, targetIdx, 0 )
		this.playing = true
		this.syncPlayButton()
	}

	createHud() {
		this.hudStyle = document.createElement( 'style' )
		this.hudStyle.textContent = `
			.IsobarOverlay {
				position: fixed;
				inset: 0;
				z-index: 12;
				pointer-events: none;
				overflow: hidden;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
				user-select: none;
			}
			.IsobarHud {
				position: fixed;
				left: calc(16px + var(--sail, 0px));
				bottom: calc(16px + var(--saib, 0px));
				z-index: 20;
				display: flex;
				flex-direction: column;
				gap: 8px;
				max-width: min(520px, calc(100vw - 32px));
				padding: 11px 13px;
				border: 1px solid rgba(148, 203, 255, 0.2);
				border-radius: 14px;
				background: rgba(6, 13, 26, 0.78);
				box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35);
				backdrop-filter: blur(12px);
				color: #f1f5f9;
				font: 600 11px/1.2 system-ui, sans-serif;
				user-select: none;
			}
			.IsobarHud__top {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
			}
			.IsobarHud__title {
				font-size: 10px;
				font-weight: 800;
				letter-spacing: 0.12em;
				text-transform: uppercase;
				color: #fff2bf;
			}
			.IsobarHud__status {
				font-variant-numeric: tabular-nums;
				color: #93c5fd;
				font-size: 11px;
			}
			.IsobarHud__states {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}
			.IsobarHud__btn {
				padding: 5px 10px;
				border: 1px solid rgba(148, 163, 184, 0.25);
				border-radius: 999px;
				background: rgba(15, 23, 42, 0.7);
				color: #e2e8f0;
				font: 600 10px/1 system-ui, sans-serif;
				letter-spacing: 0.04em;
				cursor: pointer;
				transition: background 0.15s, border-color 0.15s;
			}
			.IsobarHud__btn.is-active {
				background: rgba(56, 189, 248, 0.25);
				border-color: rgba(125, 211, 252, 0.75);
				color: #fff;
			}
			.IsobarHud__scrubber {
				display: flex;
				align-items: center;
				gap: 8px;
			}
			.IsobarHud__slider {
				flex: 1;
				accent-color: #38bdf8;
				cursor: pointer;
			}
			.IsobarMarker {
				position: absolute;
				top: 0;
				left: 0;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				width: 42px;
				height: 42px;
				border: 2px solid rgba(255, 255, 255, 0.92);
				border-radius: 50%;
				color: #fff;
				box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
				line-height: 1;
				transform: translate(-50%, -50%);
				will-change: transform, opacity;
			}
			.IsobarMarker.is-high {
				background: linear-gradient(135deg, #ff7670, #c92d35);
			}
			.IsobarMarker.is-low {
				background: linear-gradient(135deg, #59b7ff, #1458af);
			}
			.IsobarMarker b { font-size: 15px; font-weight: 800; }
			.IsobarMarker small { margin-top: 2px; font-size: 9px; font-weight: 700; font-variant-numeric: tabular-nums; }
			.IsobarLabel {
				position: absolute;
				top: 0;
				left: 0;
				padding: 2px 5px;
				border-radius: 4px;
				background: rgba(245, 250, 255, 0.9);
				color: #0f2942;
				font: 800 9px/1 system-ui, sans-serif;
				font-variant-numeric: tabular-nums;
				box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
				transform: translate(-50%, -50%);
				will-change: transform, opacity;
			}
		`
		document.head.appendChild( this.hudStyle )

		this.overlayRoot = document.createElement( 'div' )
		this.overlayRoot.className = 'IsobarOverlay'
		document.body.appendChild( this.overlayRoot )

		for ( let i = 0; i < 8; i++ ) {
			const el = document.createElement( 'div' )
			el.className = 'IsobarMarker'
			el.style.display = 'none'
			el.innerHTML = '<b>H</b><small>1024</small>'
			this.overlayRoot.appendChild( el )
			this.markerEls.push( el )
		}

		for ( let i = 0; i < 10; i++ ) {
			const el = document.createElement( 'div' )
			el.className = 'IsobarLabel'
			el.style.display = 'none'
			this.overlayRoot.appendChild( el )
			this.labelEls.push( el )
		}

		const hud = document.createElement( 'aside' )
		hud.className = 'IsobarHud'
		hud.setAttribute( 'aria-label', 'Isobar synoptic transition controls' )

		const top = document.createElement( 'div' )
		top.className = 'IsobarHud__top'
		const title = document.createElement( 'span' )
		title.className = 'IsobarHud__title'
		title.textContent = 'Isobar Contour Track Morphing'
		this.statusEl = document.createElement( 'span' )
		this.statusEl.className = 'IsobarHud__status'
		top.append( title, this.statusEl )

		const statesRow = document.createElement( 'div' )
		statesRow.className = 'IsobarHud__states'
		SYNOPTIC_STATES.forEach( ( state, idx ) => {
			const btn = document.createElement( 'button' )
			btn.type = 'button'
			btn.className = 'IsobarHud__btn'
			btn.textContent = state.title
			btn.addEventListener( 'click', () => this.jumpToState( idx ) )
			statesRow.appendChild( btn )
			this.stateButtons.push( btn )
		} )

		const scrubber = document.createElement( 'div' )
		scrubber.className = 'IsobarHud__scrubber'
		this.playBtn = document.createElement( 'button' )
		this.playBtn.type = 'button'
		this.playBtn.className = 'IsobarHud__btn'
		this.playBtn.addEventListener( 'click', () => {
			this.playing = !this.playing
			this.syncPlayButton()
		} )
		this.sliderEl = document.createElement( 'input' )
		this.sliderEl.type = 'range'
		this.sliderEl.min = '0'
		this.sliderEl.max = '100'
		this.sliderEl.value = '0'
		this.sliderEl.className = 'IsobarHud__slider'
		this.sliderEl.addEventListener( 'input', () => {
			this.playing = false
			this.syncPlayButton()
			this.setMorph( Number( this.sliderEl.value ) / 100 )
		} )
		scrubber.append( this.playBtn, this.sliderEl )

		hud.append( top, statesRow, scrubber )
		document.body.appendChild( hud )
		this.hud = hud
		this.syncPlayButton()
	}

	syncPlayButton() {
		if ( !this.playBtn ) return
		this.playBtn.textContent = this.playing ? 'Pause' : 'Play'
	}

	syncHudButtons() {
		const activeIdx = this.uMorph.value >= 0.5 ? this.toIndex : this.fromIndex
		this.stateButtons.forEach( ( btn, idx ) => {
			btn.classList.toggle( 'is-active', idx === activeIdx )
		} )
	}

	updateOverlayPositions() {
		if ( !this.overlayRoot ) return
		const pair = this.getPairData( this.fromIndex, this.toIndex )
		const raw = this.uMorph.value
		const t = raw * raw * ( 3 - 2 * raw )
		const camera = stage3d.camera
		const halfW = stage.width * 0.5
		const halfH = stage.height * 0.5

		// Project H/L pressure center markers
		this.markerEls.forEach( ( el, i ) => {
			const track = pair.extremaTracks[i]
			if ( !track ) {
				el.style.display = 'none'
				return
			}
			const alpha = track.fromAlpha + ( track.toAlpha - track.fromAlpha ) * t
			if ( alpha < 0.08 ) {
				el.style.display = 'none'
				return
			}
			const x = track.fromX + ( track.toX - track.fromX ) * t
			const z = track.fromZ + ( track.toZ - track.fromZ ) * t
			const val = Math.round( track.fromVal + ( track.toVal - track.fromVal ) * t )
			const y = pressureToY( val ) + 0.26

			this.projScratch.set( x, y, z ).project( camera )
			if ( this.projScratch.z > 1 ) {
				el.style.display = 'none'
				return
			}
			const sx = ( this.projScratch.x * halfW ) + halfW
			const sy = -( this.projScratch.y * halfH ) + halfH
			el.style.display = 'flex'
			el.className = `IsobarMarker ${track.type === 'H' ? 'is-high' : 'is-low'}`
			el.style.opacity = alpha.toFixed( 2 )
			el.style.transform = `translate(${sx.toFixed( 1 )}px, ${sy.toFixed( 1 )}px)`
			el.firstChild.textContent = track.type
			el.lastChild.textContent = String( val )
		} )

		// Project hPa value pills on primary contours
		const midPointIndex = Math.floor( LINE_SEGMENTS * 0.5 ) * 3
		this.labelEls.forEach( ( el, i ) => {
			const track = pair.primary[i]
			if ( !track ) {
				el.style.display = 'none'
				return
			}
			const alpha = track.fromOpacity + ( track.toOpacity - track.fromOpacity ) * t
			if ( alpha < 0.25 ) {
				el.style.display = 'none'
				return
			}
			const x = track.fromPoints[midPointIndex] + ( track.toPoints[midPointIndex] - track.fromPoints[midPointIndex] ) * t
			const y = track.fromPoints[midPointIndex + 1] + ( track.toPoints[midPointIndex + 1] - track.fromPoints[midPointIndex + 1] ) * t + 0.08
			const z = track.fromPoints[midPointIndex + 2] + ( track.toPoints[midPointIndex + 2] - track.fromPoints[midPointIndex + 2] ) * t

			this.projScratch.set( x, y, z ).project( camera )
			if ( this.projScratch.z > 1 ) {
				el.style.display = 'none'
				return
			}
			const sx = ( this.projScratch.x * halfW ) + halfW
			const sy = -( this.projScratch.y * halfH ) + halfH
			el.style.display = 'block'
			el.style.opacity = ( alpha * 0.9 ).toFixed( 2 )
			el.style.transform = `translate(${sx.toFixed( 1 )}px, ${sy.toFixed( 1 )}px)`
			el.textContent = `${Math.round( track.value )} hPa`
		} )
	}

	update = ( dt ) => {
		const deltaSec = Math.min( dt, 100 ) * 0.001
		if ( this.playing ) {
			this.phaseTime += deltaSec
			const cycle = MORPH_DURATION + HOLD_DURATION
			if ( this.phaseTime >= cycle ) {
				this.phaseTime -= cycle
				const nextFrom = this.toIndex
				const nextTo = ( nextFrom + 1 ) % SYNOPTIC_STATES.length
				this.setPair( nextFrom, nextTo, 0 )
			} else {
				const morph = Math.min( 1, this.phaseTime / MORPH_DURATION )
				this.setMorph( morph )
				this.syncHudButtons()
			}
		}
		this.updateOverlayPositions()
	}

	onResize = () => {
		for ( const bank of this.banks ) bank.resize()
		this.updateOverlayPositions()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		stage.onResize.remove( this.onResize )

		this.hud?.remove()
		this.overlayRoot?.remove()
		this.hudStyle?.remove()
		this.hud = null
		this.overlayRoot = null
		this.hudStyle = null
		this.markerEls = []
		this.labelEls = []
		this.stateButtons = []

		for ( const bank of this.banks ) {
			stage3d.remove( bank.mesh )
			bank.dispose()
		}
		this.banks = []

		if ( this.floor ) {
			stage3d.remove( this.floor )
			this.floor.geometry.dispose()
			this.floor.material.dispose()
			this.floor = null
		}
		this.floorTexture?.dispose()
		this.floorTexture = null

		this.bloom?.dispose()
		this.bloom = null
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		this.control = null
		this.pairCache.clear()
	}
}

export default IsobarsExample
