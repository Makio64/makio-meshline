// Source data for the GPU simplification lab.
//
// Every dataset is authored as a handful of clean control polylines, then
// deliberately ruined: resampled to a huge uniform point budget and pushed
// around by drift, jitter and coordinate quantisation. That is what real vector
// data looks like after it has been digitised, traced, logged by a consumer GPS
// or extracted from a raster — a line whose *shape* costs a few hundred points
// but whose *file* costs a few hundred thousand.

import { random } from '@/makio/utils/random'

import { FRANCE_CORSICA, FRANCE_MAINLAND, FRANCE_RIVERS } from './franceOutline.js'

export const WORLD_SIZE = 96

// ---------------------------------------------------------------------------
// deterministic noise (shape stays identical between reloads, only the dirt uses
// the global seeded random)
// ---------------------------------------------------------------------------

const hash1 = i => {
	let value = Math.imul( i ^ 0x9e3779b9, 0x85ebca6b )
	value ^= value >>> 13
	value = Math.imul( value, 0xc2b2ae35 )
	return ( ( value ^ ( value >>> 16 ) ) >>> 0 ) / 4294967296
}

const hash2 = ( x, y ) => hash1( x * 73856093 ^ y * 19349663 )

const fade = t => t * t * ( 3 - 2 * t )

const noise1 = x => {
	const i = Math.floor( x )
	const t = fade( x - i )
	return hash1( i ) * ( 1 - t ) + hash1( i + 1 ) * t
}

const noise2 = ( x, y ) => {
	const ix = Math.floor( x )
	const iy = Math.floor( y )
	const tx = fade( x - ix )
	const ty = fade( y - iy )
	const bottom = hash2( ix, iy ) * ( 1 - tx ) + hash2( ix + 1, iy ) * tx
	const top = hash2( ix, iy + 1 ) * ( 1 - tx ) + hash2( ix + 1, iy + 1 ) * tx
	return bottom * ( 1 - ty ) + top * ty
}

const fbm1 = ( x, octaves = 4 ) => {
	let sum = 0
	let amplitude = 1
	let total = 0
	for ( let octave = 0; octave < octaves; octave++ ) {
		sum += noise1( x * 2 ** octave + octave * 37.1 ) * amplitude
		total += amplitude
		amplitude *= 0.5
	}
	return sum / total * 2 - 1
}

const fbm2 = ( x, y, octaves = 5 ) => {
	let sum = 0
	let amplitude = 1
	let total = 0
	for ( let octave = 0; octave < octaves; octave++ ) {
		const scale = 2 ** octave
		sum += noise2( x * scale + octave * 11.7, y * scale - octave * 5.3 ) * amplitude
		total += amplitude
		amplitude *= 0.5
	}
	return sum / total
}

// ---------------------------------------------------------------------------
// curve helpers
// ---------------------------------------------------------------------------

const polylineLength = points => {
	let total = 0
	for ( let i = 1; i < points.length; i++ ) {
		total += Math.hypot( points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1] )
	}
	return total
}

const catmullRom = ( p0, p1, p2, p3, t ) => {
	const t2 = t * t
	const t3 = t2 * t
	const component = index => 0.5 * (
		2 * p1[index] +
		( -p0[index] + p2[index] ) * t +
		( 2 * p0[index] - 5 * p1[index] + 4 * p2[index] - p3[index] ) * t2 +
		( -p0[index] + 3 * p1[index] - 3 * p2[index] + p3[index] ) * t3
	)
	return [component( 0 ), component( 1 )]
}

// Uniform arc-length resampling along the Catmull-Rom spline through `points`.
// The dense result is what makes the input "expensive": the shape never gains
// information, only vertices.
const resample = ( points, closed, count ) => {
	const knots = points.length
	if ( knots < 2 ) return points.slice()
	const segments = closed ? knots : knots - 1
	const at = index => points[closed
		? ( index + knots * 2 ) % knots
		: Math.min( knots - 1, Math.max( 0, index ) )]

	const evaluate = t => {
		const segment = Math.min( segments - 1, Math.floor( t ) )
		return catmullRom( at( segment - 1 ), at( segment ), at( segment + 1 ), at( segment + 2 ), t - segment )
	}

	const samplesPerSegment = 12
	const fineCount = segments * samplesPerSegment
	const lengths = new Float64Array( fineCount + 1 )
	let previous = evaluate( 0 )
	for ( let sample = 1; sample <= fineCount; sample++ ) {
		const current = evaluate( sample / samplesPerSegment )
		lengths[sample] = lengths[sample - 1] + Math.hypot( current[0] - previous[0], current[1] - previous[1] )
		previous = current
	}

	const total = lengths[fineCount]
	const result = []
	const spans = closed ? count : count - 1
	let cursor = 0
	for ( let index = 0; index < count; index++ ) {
		const target = total * ( index / spans )
		while ( cursor < fineCount - 1 && lengths[cursor + 1] < target ) cursor++
		const span = lengths[cursor + 1] - lengths[cursor]
		const local = span > 0 ? ( target - lengths[cursor] ) / span : 0
		result.push( evaluate( ( cursor + local ) / samplesPerSegment ) )
	}
	if ( closed ) result.push( result[0].slice() )
	return result
}

// ---------------------------------------------------------------------------
// the dirt
// ---------------------------------------------------------------------------

const applyDirt = ( points, dirt, scale ) => {
	const {
		drift = 0,
		driftScale = 0.02,
		jitter = 0,
		quantize = 0,
		spikeChance = 0,
		spikeAmount = 0,
		wobble = 0,
		wobbleScale = 0.35,
	} = dirt
	const count = points.length
	const seed = random( 0, 1000 )
	let driftX = 0
	let driftY = 0

	const dirty = points.map( ( point, index ) => {
		const previous = points[Math.max( 0, index - 1 )]
		const next = points[Math.min( count - 1, index + 1 )]
		const tangentX = next[0] - previous[0]
		const tangentY = next[1] - previous[1]
		const tangentLength = Math.hypot( tangentX, tangentY ) || 1
		const normalX = -tangentY / tangentLength
		const normalY = tangentX / tangentLength

		let offset = 0
		if ( wobble ) offset += fbm1( index * wobbleScale + seed, 3 ) * wobble * scale
		if ( jitter ) offset += ( random() - 0.5 ) * 2 * jitter * scale
		if ( spikeChance && random() < spikeChance ) offset += ( random() - 0.5 ) * 2 * spikeAmount * scale

		if ( drift ) {
			driftX += ( random() - 0.5 ) * 2 * drift * scale * driftScale
			driftY += ( random() - 0.5 ) * 2 * drift * scale * driftScale
			driftX *= 0.995
			driftY *= 0.995
		}

		return [
			point[0] + normalX * offset + driftX,
			point[1] + normalY * offset + driftY,
		]
	} )

	if ( quantize <= 0 ) return dirty

	const step = quantize * scale
	for ( const point of dirty ) {
		point[0] = Math.round( point[0] / step ) * step
		point[1] = Math.round( point[1] / step ) * step
	}
	// Snapping collapses neighbours onto each other. Real traced data does not
	// store the repeat, and a zero-length segment has no direction to offset a
	// ribbon along, so drop them here rather than special-casing them downstream.
	return dirty.filter( ( point, index ) =>
		index === 0 || point[0] !== dirty[index - 1][0] || point[1] !== dirty[index - 1][1] )
}

// ---------------------------------------------------------------------------
// datasets
// ---------------------------------------------------------------------------

const buildFrance = () => {
	// Equirectangular projection around the country's mid-latitude.
	const project = ( [lon, lat] ) => [lon * Math.cos( 46.5 * Math.PI / 180 ), lat]
	return [
		{ closed: true, points: FRANCE_MAINLAND.map( project ), weight: 3 },
		{ closed: true, points: FRANCE_CORSICA.map( project ), weight: 1 },
		...FRANCE_RIVERS.map( river => ( { closed: false, points: river.map( project ), weight: 1 } ) ),
	]
}

const buildIsolines = () => {
	const gridWidth = 176
	const gridHeight = 132
	const levels = [-0.26, -0.18, -0.1, -0.02, 0.06, 0.14, 0.22, 0.3, 0.38]
	const field = new Float64Array( gridWidth * gridHeight )

	for ( let y = 0; y < gridHeight; y++ ) {
		for ( let x = 0; x < gridWidth; x++ ) {
			const u = x / ( gridWidth - 1 )
			const v = y / ( gridHeight - 1 )
			// A ridge running across a basin: enough closed loops to be a real
			// contour map, enough long runs to reward simplification.
			const terrain = fbm2( u * 3.4, v * 2.6, 5 ) - 0.5
			const ridge = Math.exp( -( ( v - 0.58 - Math.sin( u * 4.1 ) * 0.08 ) ** 2 ) * 26 ) * 0.34
			const basin = -Math.exp( -( ( u - 0.28 ) ** 2 + ( v - 0.3 ) ** 2 ) * 12 ) * 0.3
			field[y * gridWidth + x] = terrain * 0.8 + ridge + basin
		}
	}

	// Marching squares. Endpoints are identified by the grid edge they sit on, so
	// neighbouring cells agree exactly and contours chain without a spatial hash.
	const horizontalEdge = ( x, y ) => ( y * gridWidth + x ) * 2
	const verticalEdge = ( x, y ) => ( y * gridWidth + x ) * 2 + 1
	const cases = [
		[],
		[[3, 0]],
		[[0, 1]],
		[[3, 1]],
		[[1, 2]],
		[[3, 2], [0, 1]],
		[[0, 2]],
		[[3, 2]],
		[[2, 3]],
		[[2, 0]],
		[[3, 0], [1, 2]],
		[[2, 1]],
		[[1, 3]],
		[[1, 0]],
		[[0, 3]],
		[],
	]
	const lines = []

	for ( const level of levels ) {
		const segments = []
		const edgePoints = new Map()
		const edgeUses = new Map()

		const interpolate = ( ax, ay, bx, by ) => {
			const va = field[ay * gridWidth + ax]
			const vb = field[by * gridWidth + bx]
			const t = Math.abs( vb - va ) < 1e-9 ? 0.5 : ( level - va ) / ( vb - va )
			return [ax + ( bx - ax ) * t, ay + ( by - ay ) * t]
		}

		for ( let y = 0; y < gridHeight - 1; y++ ) {
			for ( let x = 0; x < gridWidth - 1; x++ ) {
				const code = ( field[y * gridWidth + x] > level ? 1 : 0 )
					| ( field[y * gridWidth + x + 1] > level ? 2 : 0 )
					| ( field[( y + 1 ) * gridWidth + x + 1] > level ? 4 : 0 )
					| ( field[( y + 1 ) * gridWidth + x] > level ? 8 : 0 )
				const pairs = cases[code]
				if ( pairs.length === 0 ) continue

				const edgeId = side => {
					if ( side === 0 ) return horizontalEdge( x, y )
					if ( side === 1 ) return verticalEdge( x + 1, y )
					if ( side === 2 ) return horizontalEdge( x, y + 1 )
					return verticalEdge( x, y )
				}
				const edgePoint = side => {
					if ( side === 0 ) return interpolate( x, y, x + 1, y )
					if ( side === 1 ) return interpolate( x + 1, y, x + 1, y + 1 )
					if ( side === 2 ) return interpolate( x, y + 1, x + 1, y + 1 )
					return interpolate( x, y, x, y + 1 )
				}

				for ( const [a, b] of pairs ) {
					const idA = edgeId( a )
					const idB = edgeId( b )
					if ( !edgePoints.has( idA ) ) edgePoints.set( idA, edgePoint( a ) )
					if ( !edgePoints.has( idB ) ) edgePoints.set( idB, edgePoint( b ) )
					const index = segments.length
					segments.push( [idA, idB] )
					for ( const id of [idA, idB] ) {
						if ( !edgeUses.has( id ) ) edgeUses.set( id, [] )
						edgeUses.get( id ).push( index )
					}
				}
			}
		}

		const consumed = new Uint8Array( segments.length )
		const extend = ( edgeId, chainIds ) => {
			let currentEdge = edgeId
			for ( ;; ) {
				const candidates = edgeUses.get( currentEdge ) ?? []
				const next = candidates.find( index => !consumed[index] )
				if ( next === undefined ) return
				consumed[next] = 1
				const [a, b] = segments[next]
				currentEdge = a === currentEdge ? b : a
				chainIds.push( currentEdge )
			}
		}

		for ( let index = 0; index < segments.length; index++ ) {
			if ( consumed[index] ) continue
			consumed[index] = 1
			const [startEdge, endEdge] = segments[index]
			const forward = [endEdge]
			extend( endEdge, forward )
			const backward = [startEdge]
			extend( startEdge, backward )
			const chainIds = [...backward.reverse(), ...forward]
			if ( chainIds.length < 10 ) continue

			const points = chainIds.map( id => {
				const [gx, gy] = edgePoints.get( id )
				return [gx / ( gridWidth - 1 ) - 0.5, gy / ( gridHeight - 1 ) - 0.5]
			} )
			const closed = chainIds[0] === chainIds[chainIds.length - 1]
			if ( closed ) points.pop()
			if ( points.length < 8 ) continue
			lines.push( { closed, points, weight: 1 } )
		}
	}

	return lines
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

// Every dirt amount is a fraction of the world box: `quantize` is the storage
// grid the coordinates were rounded onto, the rest is measurement error.
export const VECTOR_DATASETS = [
	{
		build: buildFrance,
		description: 'Coastline, land border, Corsica and the four main rivers. The shape Douglas & Peucker wrote their paper about.',
		dirt: { jitter: 0.0006, quantize: 0.0009, wobble: 0.0016, wobbleScale: 0.6 },
		id: 'france',
		label: 'France',
		subtitle: 'digitised border',
	},
	{
		build: buildIsolines,
		description: 'Marching-squares contours over a terrain field. Raster extraction leaves every contour on a staircase of cell edges.',
		dirt: { jitter: 0.0004, quantize: 0.0007, wobble: 0.0008, wobbleScale: 0.9 },
		id: 'isolines',
		label: 'Isolines',
		subtitle: 'contour extraction',
	},
]

export const resolveVectorDataset = id =>
	VECTOR_DATASETS.find( dataset => dataset.id === id ) ?? VECTOR_DATASETS[0]

/**
 * Builds a dataset into the flat vec4 buffer the GPU pipeline consumes.
 * `w` carries the polyline id so a single buffer can hold hundreds of separate
 * strokes without the renderer joining them end to end.
 */
export const buildVectorDataset = ( id, targetPointCount ) => {
	const dataset = resolveVectorDataset( id )
	const sourceLines = dataset.build().filter( line => line.points.length >= 2 )

	// Normalise every dataset into the same world box so the camera, the world
	// tolerance and the ribbon width mean the same thing everywhere.
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
	for ( const line of sourceLines ) {
		for ( const [x, y] of line.points ) {
			if ( x < minX ) minX = x
			if ( x > maxX ) maxX = x
			if ( y < minY ) minY = y
			if ( y > maxY ) maxY = y
		}
	}
	const extent = Math.max( maxX - minX, maxY - minY ) || 1
	const scale = WORLD_SIZE / extent
	const centerX = ( minX + maxX ) / 2
	const centerY = ( minY + maxY ) / 2
	const normalized = sourceLines.map( line => ( {
		...line,
		points: line.points.map( ( [x, y] ) => [( x - centerX ) * scale, ( y - centerY ) * scale] ),
	} ) )

	// Point budget follows arc length, weighted so headline shapes stay dense.
	const budgets = normalized.map( line => Math.max(
		1e-6,
		polylineLength( line.points ) * ( line.weight ?? 1 ) + ( line.closed ? polylineLength( [
			line.points[line.points.length - 1],
			line.points[0],
		] ) : 0 ),
	) )
	const budgetTotal = budgets.reduce( ( total, value ) => total + value, 0 )

	// Closed rings repeat their first point, so hold that many slots back before
	// sharing the budget out — otherwise the last line falls off the end.
	const budgetCeiling = targetPointCount - normalized.length
	const lines = []
	let pointCount = 0
	for ( let index = 0; index < normalized.length; index++ ) {
		const line = normalized[index]
		const remaining = budgetCeiling - pointCount - ( normalized.length - index - 1 ) * 12
		if ( remaining < 12 ) break
		const share = Math.round( budgetCeiling * budgets[index] / budgetTotal )
		const count = Math.max( 12, Math.min( share, remaining ) )
		const dense = resample( line.points, line.closed, count )
		const dirty = applyDirt( dense, dataset.dirt, WORLD_SIZE )
		if ( line.closed ) dirty[dirty.length - 1] = dirty[0].slice()
		lines.push( { closed: !!line.closed, points: dirty } )
		pointCount += dirty.length
	}

	const positions = new Float32Array( pointCount * 4 )
	const ranges = []
	let offset = 0
	for ( let lineIndex = 0; lineIndex < lines.length; lineIndex++ ) {
		const line = lines[lineIndex].points
		ranges.push( {
			closed: lines[lineIndex].closed,
			end: offset + line.length - 1,
			start: offset,
		} )
		for ( const [x, y] of line ) {
			positions[offset * 4] = x
			positions[offset * 4 + 1] = y
			positions[offset * 4 + 2] = 0
			positions[offset * 4 + 3] = lineIndex
			offset++
		}
	}

	return {
		description: dataset.description,
		id: dataset.id,
		label: dataset.label,
		lineCount: lines.length,
		pointCount,
		positions,
		ranges,
		subtitle: dataset.subtitle,
	}
}
