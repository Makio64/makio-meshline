import { bumpMap, color, float, Fn, fract, fwidth, mix, normalViewGeometry, positionViewDirection, positionWorld, select, texture, uniform, uv, vec2 } from 'three/tsl'
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three/webgpu'

/**
 * Road paint as a single fragment node.
 *
 * Shoulders, wear, edge lines and the dashed centre are all derived from the
 * surface UVs, so one ribbon replaces the stack of slightly offset overlay
 * meshes a road demo usually needs — and with it every z-fighting seam and
 * every extra geometry rebuild during a drag. Its edges change with the height
 * of the road: on the ground a gravel shoulder and an earth verge, on a bridge
 * a paved shoulder and the concrete kerb its parapet stands on.
 *
 * The surface geometry writes `uv().x` as metres travelled (with `uvScale: 1`)
 * and `uv().y` as 0 → 1 across the ribbon, so all of this is measured in world
 * metres. `pinRoadPaintToControls()` then pins that distance to the authored
 * controls, so reshaping one span cannot slide the paint on the rest.
 */

export const DASH_PERIOD = 5.4
export const DASH_DUTY = 0.56

// Metres above the ground between which a road turns from an earthwork into a bridge deck.
export const RAISED_FROM = 1.2
export const RAISED_TO = 2.4

const ASPHALT = 0x34373A
const ASPHALT_AGED = 0x505253
const TAR = 0x15171A
const GRAVEL = 0x9F998B
const VERGE = 0x5A4A34
const KERB = 0xB7B3A9
const EDGE_PAINT = 0xECE9DC
const CENTRE_PAINT = 0xE9B431
const UNDERSIDE = 0x8C8880

/**
 * Pin the paint to the authored controls.
 *
 * Distance UVs count metres from the start of the road, so lengthening one span
 * used to slide every dash after it and re-roll the asphalt grain along the
 * whole route. Each span between two controls is instead given a whole number
 * of dash periods and its UVs are rescaled onto that, so every control sits on
 * the same dash phase. A longer span then re-spaces only its own dashes, and
 * everything after it moves by whole periods, which the periodic paint hides.
 *
 * Call it after every `setPositions()`: the surface rewrites its UVs each time.
 */
export function pinRoadPaintToControls( geometry, points, anchors, period = DASH_PERIOD ) {
	const uv = geometry?.getAttribute( 'uv' )
	const pin = uv && createPaintPin( points, anchors, period )
	if ( !pin ) return false

	// A dynamic surface keeps spare capacity past the vertices it draws.
	const array = uv.array
	const vertexCount = geometry.vertexCount ?? uv.count
	for ( let vertex = 0; vertex < vertexCount; vertex++ ) array[vertex * 2] = pin( array[vertex * 2] )
	uv.needsUpdate = true
	return true
}

/**
 * The pinned paint distance of every row of `points`: what `pinRoadPaintToControls()`
 * leaves in the UVs of that row. Whatever is built along the road measures itself
 * with these, and stays put with the paint when a span is reshaped.
 */
export function pinnedRowDistances( points, anchors, period = DASH_PERIOD ) {
	const pin = createPaintPin( points, anchors, period )
	const rows = points ? points.length / 3 : 0
	const distances = new Float32Array( rows )
	let travelled = 0
	for ( let row = 0; row < rows; row++ ) {
		if ( row > 0 ) travelled += rowLength( points, row )
		distances[row] = pin ? pin( travelled ) : travelled
	}
	return distances
}

const rowLength = ( points, row ) => Math.hypot(
	points[row * 3] - points[row * 3 - 3],
	points[row * 3 + 1] - points[row * 3 - 2],
	points[row * 3 + 2] - points[row * 3 - 1]
)

/** A function from metres travelled along `points` to the pinned paint distance, or null without two controls. */
function createPaintPin( points, anchors, period ) {
	if ( !points || !anchors || anchors.length < 2 ) return null

	const count = anchors.length
	const from = new Float64Array( count )
	const to = new Float64Array( count )
	let travelled = 0
	let row = 0
	for ( let index = 0; index < count; index++ ) {
		for ( ; row < anchors[index]; row++ ) travelled += rowLength( points, row + 1 )
		from[index] = travelled
		if ( index > 0 ) {
			to[index] = to[index - 1] + Math.max( 1, Math.round( ( from[index] - from[index - 1] ) / period ) ) * period
		}
	}

	return u => {
		let lower = 0
		let upper = count - 2
		while ( lower < upper ) {
			const middle = ( lower + upper + 1 ) >> 1
			if ( from[middle] <= u ) lower = middle
			else upper = middle - 1
		}
		const length = from[lower + 1] - from[lower]
		const scale = length > 0 ? ( to[lower + 1] - to[lower] ) / length : 1
		return to[lower] + ( u - from[lower] ) * scale
	}
}

/**
 * Which face of the deck is on screen, read from its own normal rather than from
 * the winding of each triangle. Inside a steep, tight bend the surface has
 * slivers standing on edge, and seen from above those count as back faces: by
 * their winding they would be painted as the soffit and lit from underneath, a
 * dark hairline across the road. Give `roadDeckNormal` to `material.normalNode`.
 */
const deckFacesViewer = normalViewGeometry.dot( positionViewDirection ).greaterThanEqual( 0 )
export const roadDeckNormal = select( deckFacesViewer, normalViewGeometry, normalViewGeometry.negate() )

export const createRoadPaintUniforms = ( width, shoulder, verge ) => ( {
	width: uniform( width ),
	shoulder: uniform( shoulder ),
	verge: uniform( verge ),
	// 1 while the road is dressed as a bridge where it leaves the ground, 0 for the bare ribbon.
	structure: uniform( 1 ),
} )

/**
 * A seamless material-data tile: small stones in R, compacted grain in G and
 * broad mottling in B. Mipmaps filter the aggregate out towards the horizon,
 * instead of turning a fragment hash into sparkling salt and pepper.
 * Own and dispose this texture alongside the road's other scene resources.
 */
export function createRoadPaintTexture() {
	const size = 256
	const data = new Uint8Array( size * size * 4 )
	const hash = ( x, y, seed ) => {
		let value = Math.imul( x, 0x1F123BB5 ) ^ Math.imul( y, 0x5F356495 ) ^ seed
		value = Math.imul( value ^ ( value >>> 16 ), 0x45D9F3B )
		value = Math.imul( value ^ ( value >>> 16 ), 0x45D9F3B )
		return ( ( value ^ ( value >>> 16 ) ) >>> 0 ) / 4294967296
	}
	const smooth = value => value * value * ( 3 - 2 * value )
	const cloud = ( x, y, cells, seed ) => {
		const px = x / size * cells
		const py = y / size * cells
		const ix = Math.floor( px )
		const iy = Math.floor( py )
		const tx = smooth( px - ix )
		const ty = smooth( py - iy )
		const sample = ( dx, dy ) => hash( ( ix + dx ) & ( cells - 1 ), ( iy + dy ) & ( cells - 1 ), seed )
		return ( sample( 0, 0 ) * ( 1 - tx ) + sample( 1, 0 ) * tx ) * ( 1 - ty ) +
			( sample( 0, 1 ) * ( 1 - tx ) + sample( 1, 1 ) * tx ) * ty
	}
	for ( let y = 0; y < size; y++ ) {
		for ( let x = 0; x < size; x++ ) {
			const px = x / 4
			const py = y / 4
			const ix = Math.floor( px )
			const iy = Math.floor( py )
			let nearest = Infinity
			let stone = 0
			for ( let dy = -1; dy <= 1; dy++ ) {
				for ( let dx = -1; dx <= 1; dx++ ) {
					const cellX = ( ix + dx ) & 63
					const cellY = ( iy + dy ) & 63
					const sx = ix + dx + hash( cellX, cellY, 17 )
					const sy = iy + dy + hash( cellX, cellY, 31 )
					const distance = Math.hypot( px - sx, py - sy )
					if ( distance >= nearest ) continue
					nearest = distance
					stone = hash( cellX, cellY, 53 )
				}
			}
			const aggregate = 0.23 + stone * 0.54 - smooth( Math.min( 1, nearest / 0.8 ) ) * 0.16
			const offset = ( y * size + x ) * 4
			data[offset] = Math.round( aggregate * 255 )
			data[offset + 1] = Math.round( cloud( x, y, 16, 71 ) * 255 )
			data[offset + 2] = Math.round( cloud( x, y, 4, 97 ) * 255 )
			data[offset + 3] = 255
		}
	}
	const map = new DataTexture( data, size, size )
	map.name = 'Road aggregate and wear'
	map.wrapS = map.wrapT = RepeatWrapping
	map.magFilter = LinearFilter
	map.minFilter = LinearMipmapLinearFilter
	map.generateMipmaps = true
	map.anisotropy = 4
	map.needsUpdate = true
	return map
}

/**
 * Dry asphalt, gravel and paint share the same pinned UVs in every material channel.
 *
 * `clearance` is the metres between a fragment and the ground under it, which
 * turn the shoulder and the verge of a raised road into those of a bridge while
 * `uniforms.structure` is on. Without it the road keeps its gravel and earth.
 */
export function createRoadPaintNodes( uniforms, noise, { clearance = null } = {} ) {
	const coords = uv()
	const across = coords.y.sub( 0.5 ).mul( uniforms.width )
	const along = coords.x
	const lateral = across.abs()
	// Screen footprint of the across-road metre, so every band self-antialiases.
	const aa = fwidth( lateral ).max( 0.004 )
	const half = uniforms.width.mul( 0.5 )
	const vergeHalf = half.sub( uniforms.verge )
	const asphaltHalf = vergeHalf.sub( uniforms.shoulder )
	const sample = ( coordinates, channel ) => noise ? texture( noise, coordinates )[channel] : float( 0.5 )
	const raised = clearance ? clearance.smoothstep( RAISED_FROM, RAISED_TO ).mul( uniforms.structure ) : float( 0 )
	const grounded = raised.oneMinus()

	// A 54 cm tile of millimetre-scale aggregate and a 5.4 m tile of weathering.
	// Both make whole repeats per dash period, so editing cannot slide untouched spans.
	// Leave coordinates unwrapped: the sampler repeats them without breaking mip derivatives at a seam.
	const grainUV = vec2( along.div( DASH_PERIOD ).mul( 10 ), across.div( DASH_PERIOD / 10 ) )
	const aggregate = sample( grainUV, 'r' )
	const compacted = sample( grainUV.mul( 0.2 ), 'g' )
	const mottle = sample( vec2( along.div( DASH_PERIOD ), across.div( DASH_PERIOD ) ), 'b' )
	const grain = aggregate.sub( 0.42 )
	// Anchored to the world rather than to the road: tone that drifts over tens of
	// metres, which no dash period could hold.
	const world = positionWorld.xz
	const drift = sample( world.div( 43 ), 'b' )
	const patches = sample( world.div( 7.3 ), 'g' )

	// A gravel shoulder spills over the asphalt edge; a paved one is cut straight.
	const onShoulder = lateral.add( compacted.sub( 0.5 ).mul( 0.05 ).mul( grounded ) ).smoothstep( asphaltHalf.sub( aa ), asphaltHalf.add( aa ) )
	const onVerge = lateral.smoothstep( vergeHalf.sub( aa ), vergeHalf.add( aa ) )
	const onAsphalt = onShoulder.oneMinus()

	// Two tyre strips in each lane, polished darker and smoother than the asphalt between them.
	const trackCentre = asphaltHalf.mul( 0.52 )
	const tracks = lateral.sub( trackCentre ).abs().sub( 0.56 ).abs()
		.smoothstep( 0.1, 0.36 ).oneMinus().mul( onAsphalt )
		.mul( compacted.mul( 0.3 ).add( 0.7 ) )
	// Between them the drip of every engine that passed.
	const oil = lateral.sub( trackCentre ).abs().smoothstep( 0.08, 0.34 ).oneMinus().mul( onAsphalt ).mul( mottle.mul( 0.7 ).add( 0.3 ) )

	const edgeCentre = asphaltHalf.sub( 0.34 )
	const edgeHalf = float( 0.08 )
	const edge = lateral.sub( edgeCentre ).abs().add( grain.mul( 0.012 ) )
		.smoothstep( edgeHalf.sub( aa ).max( 0 ), edgeHalf.add( aa ) ).oneMinus()

	// The dash cycle is measured along the centreline, so dashes keep their real
	// length through a bend instead of stretching with the geometry.
	const cycle = fract( along.div( DASH_PERIOD ) )
	const cycleAA = fwidth( along ).div( DASH_PERIOD ).max( 0.002 )
	const dash = cycle.smoothstep( float( DASH_DUTY ).sub( cycleAA ), float( DASH_DUTY ).add( cycleAA ) ).oneMinus()
	const centreHalf = float( 0.1 )
	const centre = lateral.smoothstep( centreHalf.sub( aa ).max( 0 ), centreHalf.add( aa ) ).oneMinus().mul( dash )
	const marking = edge.max( centre )
	const paintWear = aggregate.smoothstep( 0.55, 0.75 ).mul( 0.2 ).add( compacted.mul( 0.06 ) ).oneMinus()

	// The kerb of a bridge is cast in lengths: a joint every half dash period, and a gutter along its foot.
	const kerbCycle = fract( along.div( DASH_PERIOD / 2 ) ).sub( 0.5 ).abs().mul( DASH_PERIOD / 2 )
	const kerbJoint = kerbCycle.smoothstep( float( 0.012 ), fwidth( along ).add( 0.012 ) ).oneMinus()
	const gutter = lateral.sub( vergeHalf ).abs().smoothstep( float( 0.02 ), aa.add( 0.02 ) ).oneMinus().mul( raised )

	const colorNode = Fn( () => {
		const tone = drift.mul( 0.26 ).add( 0.87 ).mul( mottle.mul( 0.2 ).add( 0.9 ) ).mul( patches.mul( 0.1 ).add( 0.95 ) )
		// Traffic keeps the lanes dark; towards the edges the binder has weathered off the stone.
		const aged = lateral.div( asphaltHalf ).smoothstep( 0.62, 1 ).mul( 0.5 ).add( lateral.smoothstep( 0, 0.5 ).oneMinus().mul( 0.22 ) )
		const asphalt = mix( color( ASPHALT ), color( ASPHALT_AGED ), aged ).mul( tone )
			.add( grain.mul( 0.034 ) ).add( aggregate.smoothstep( 0.58, 0.75 ).mul( 0.016 ) )
			.mul( tracks.mul( 0.2 ).oneMinus() ).mul( oil.mul( 0.09 ).oneMinus() )

		const gravel = color( GRAVEL ).mul( compacted.mul( 0.24 ).add( 0.88 ) ).mul( drift.mul( 0.12 ).add( 0.94 ) ).add( grain.mul( 0.075 ) )
		const paved = asphalt.mul( 1.16 ).add( 0.012 )
		// The earth edge keeps its graded, darker rim.
		const earth = color( VERGE ).mul( mottle.mul( 0.2 ).add( 0.9 ) ).add( grain.mul( 0.04 ) )
			.mul( lateral.smoothstep( vergeHalf, half ).mul( 0.35 ).oneMinus() )
		const kerb = color( KERB ).mul( patches.mul( 0.1 ).add( 0.95 ) ).add( grain.mul( 0.03 ) ).mul( kerbJoint.mul( 0.4 ).oneMinus() )
		const verge = mix( earth, kerb, raised )

		const surface = mix( mix( asphalt, mix( gravel, paved, raised ), onShoulder ), verge, onVerge )
		const drained = mix( surface, color( TAR ), gutter.mul( 0.55 ) )
		const withEdge = mix( drained, color( EDGE_PAINT ).mul( paintWear ), edge )
		const paint = mix( withEdge, color( CENTRE_PAINT ).mul( paintWear ), centre )
		// The deck's own normal keeps folded back-facing slivers painted and lit as road.
		return select( deckFacesViewer, paint, color( UNDERSIDE ).mul( mottle.mul( 0.12 ).add( 0.94 ) ) )
	} )()
	// Polished wheel tracks catch the sun; loose stone and earth do not.
	const asphaltRoughness = float( 0.9 ).add( grain.mul( 0.1 ) ).sub( tracks.mul( 0.2 ) )
	const shoulderRoughness = mix( float( 0.98 ), asphaltRoughness.add( 0.04 ), raised )
	const roughnessNode = select( deckFacesViewer,
		mix( mix( mix( asphaltRoughness, shoulderRoughness, onShoulder ), mix( float( 1 ), float( 0.9 ), raised ), onVerge ),
			compacted.mul( 0.08 ).add( 0.66 ), marking ).clamp( 0.5, 1 ),
		float( 0.96 )
	)
	const relief = mix( mix( float( 0.13 ), mix( float( 0.22 ), float( 0.13 ), raised ), onShoulder ), mix( float( 0.12 ), float( 0.05 ), raised ), onVerge )
		.mul( marking.mul( 0.7 ).oneMinus() )
	const normalNode = noise
		? bumpMap( texture( noise, grainUV ).r, relief, roadDeckNormal )
		: roadDeckNormal
	return { colorNode, roughnessNode, normalNode }
}

/** Colour-only use remains allocation-free when no material-data texture is supplied. */
export const createRoadPaintNode = ( uniforms, noise, options ) => createRoadPaintNodes( uniforms, noise, options ).colorNode
