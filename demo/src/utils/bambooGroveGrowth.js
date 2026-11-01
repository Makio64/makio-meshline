import { random, randomInt } from '@/makio/utils/random'

const CLUMP_COUNT = 16
const GROVE_RADIUS = 8.5
const NODE_SPACING = 1.1

// Unit vector from an azimuth around Y and an elevation above the horizon.
const unitVector = ( azimuth, elevation ) => [
	Math.cos( azimuth ) * Math.cos( elevation ),
	Math.sin( elevation ),
	Math.sin( azimuth ) * Math.cos( elevation ),
]

// Where the culm stands at height `y`, before any wind.
const restPoint = ( stalk, y ) => {
	const fraction = y / stalk.height
	const leanAmount = stalk.lean * fraction * fraction
	return [stalk.x + stalk.leanDirX * leanAmount, y, stalk.z + stalk.leanDirZ * leanAmount]
}

// Bamboo leaves grow in palmate sprays: a fan of blades radiating from a shared
// node along the twig with progressive splay and droop.
function addLeafSpray( leaves, stalk, origin, { azimuth: baseAzimuth, pitch: basePitch, fanCount, scale } ) {
	const spread = 0.34 + fanCount * 0.06
	for ( let i = 0; i < fanCount; i++ ) {
		const u = i / ( fanCount - 1 ) * 2 - 1
		const azimuth = baseAzimuth + u * spread + random( -0.08, 0.08 )
		const pitch = basePitch + ( 1 - Math.abs( u ) ) * 0.14 - Math.abs( u ) * 0.18 + random( -0.08, 0.08 )
		leaves.push( {
			origin,
			direction: unitVector( azimuth, pitch ),
			length: scale * ( 1 - Math.abs( u ) * 0.28 ) * random( 0.88, 1.14 ),
			flutter: random( 0, Math.PI * 2 ),
			phase: stalk.phase + u * 0.11,
			droop: random( 0.18, 0.42 ),
		} )
	}
}

function addTwig( { twigs, leaves }, stalk, start, side ) {
	const azimuth = random( 0, Math.PI * 2 )
	const direction = unitVector( azimuth, random( 0.1, 0.55 ) )
	const length = random( 0.6, 1.5 ) * ( 1.15 - start[1] / stalk.height * 0.4 )
	const end = start.map( ( value, axis ) => value + direction[axis] * length )
	twigs.push( { start, end, phase: stalk.phase } )

	// Lateral spray partway along the twig + terminal fan at the twig tip.
	const midAlong = random( 0.48, 0.68 )
	const middle = start.map( ( value, axis ) => value + ( end[axis] - value ) * midAlong )
	addLeafSpray( leaves, stalk, middle, {
		azimuth: azimuth + side * random( 0.35, 0.65 ),
		pitch: random( -0.28, 0.05 ),
		fanCount: randomInt( 2, 3 ),
		scale: random( 0.52, 0.72 ),
	} )
	addLeafSpray( leaves, stalk, end, {
		azimuth: azimuth + random( -0.2, 0.2 ),
		pitch: random( -0.32, 0.08 ),
		fanCount: randomInt( 3, 4 ),
		scale: random( 0.58, 0.84 ),
	} )
}

function addCulm( grove, clumpX, clumpZ ) {
	const offsetAngle = random( 0, Math.PI * 2 )
	const offsetRadius = random( 0.15, 0.95 )
	const leanAngle = offsetAngle + random( -0.4, 0.4 )
	const stalk = {
		x: clumpX + Math.cos( offsetAngle ) * offsetRadius,
		z: clumpZ + Math.sin( offsetAngle ) * offsetRadius,
		height: random( 7.5, 13 ),
		width: random( 0.07, 0.15 ),
		lean: random( 0.2, 1 ),
		leanDirX: Math.cos( leanAngle ),
		leanDirZ: Math.sin( leanAngle ),
		phase: random( 0, Math.PI * 2 ),
	}
	grove.stalks.push( stalk )

	const nodeCount = Math.floor( stalk.height / NODE_SPACING )
	for ( let nodeIndex = 1; nodeIndex < nodeCount; nodeIndex++ ) {
		const y = nodeIndex * NODE_SPACING
		const position = restPoint( stalk, y )
		grove.nodes.push( { position, size: stalk.width * 0.8, widthMult: stalk.width * 10.4, phase: stalk.phase } )

		// Branches and foliage fill the upper part of the culm only.
		if ( y / stalk.height < 0.42 ) continue
		const twigCount = random() < 0.7 ? 1 : 2
		for ( let twig = 0; twig < twigCount; twig++ ) addTwig( grove, stalk, position, twig === 0 ? 1 : -1 )
	}

	// A crown of leaf sprays fanning out from the tip.
	const tip = restPoint( stalk, stalk.height )
	const crownAngle = random( 0, Math.PI * 2 )
	for ( let spray = 0; spray < 2; spray++ ) {
		addLeafSpray( grove.leaves, stalk, tip, {
			azimuth: crownAngle + spray * Math.PI + random( -0.4, 0.4 ),
			pitch: random( -0.1, 0.32 ),
			fanCount: randomInt( 3, 4 ),
			scale: random( 0.62, 0.88 ),
		} )
	}
}

/**
 * Bamboo grows in clumps: a few culms around each clump centre, leaning slightly
 * outward. Returns one flat list of records per MeshLine layer.
 */
export function growBamboo() {
	const grove = { stalks: [], nodes: [], twigs: [], leaves: [] }

	for ( let clump = 0; clump < CLUMP_COUNT; clump++ ) {
		const angle = random( 0, Math.PI * 2 )
		const radius = Math.sqrt( random( 0, 1 ) ) * GROVE_RADIUS
		const x = Math.cos( angle ) * radius
		const z = Math.sin( angle ) * radius
		const culms = randomInt( 3, 7 )
		for ( let culm = 0; culm < culms; culm++ ) addCulm( grove, x, z )
	}

	return grove
}
