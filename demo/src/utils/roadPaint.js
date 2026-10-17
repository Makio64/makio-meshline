import { color, float, Fn, fract, frontFacing, fwidth, mix, select, sin, uniform, uv } from 'three/tsl'

/**
 * Road paint as a single fragment node.
 *
 * Shoulders, wear, edge lines and the dashed centre are all derived from the
 * surface UVs, so one ribbon replaces the stack of slightly offset overlay
 * meshes a road demo usually needs — and with it every z-fighting seam and
 * every extra geometry rebuild during a drag.
 *
 * The surface geometry writes `uv().x` as metres travelled (with `uvScale: 1`)
 * and `uv().y` as 0 → 1 across the ribbon, so all of this is measured in world
 * metres. `pinRoadPaintToControls()` then pins that distance to the authored
 * controls, so reshaping one span cannot slide the paint on the rest.
 */

export const DASH_PERIOD = 5.4
export const DASH_DUTY = 0.56

const ASPHALT = 0x2B2F35
const GRAVEL = 0xA9A08C
const VERGE = 0x5A4A34
const EDGE_PAINT = 0xE8E4D2
const CENTRE_PAINT = 0xE2B63E
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
	if ( !uv || !points || !anchors || anchors.length < 2 ) return false

	const count = anchors.length
	const from = new Float64Array( count )
	const to = new Float64Array( count )
	let travelled = 0
	let row = 0
	for ( let index = 0; index < count; index++ ) {
		for ( ; row < anchors[index]; row++ ) {
			const offset = row * 3
			travelled += Math.hypot(
				points[offset + 3] - points[offset],
				points[offset + 4] - points[offset + 1],
				points[offset + 5] - points[offset + 2]
			)
		}
		from[index] = travelled
		if ( index > 0 ) {
			to[index] = to[index - 1] + Math.max( 1, Math.round( ( from[index] - from[index - 1] ) / period ) ) * period
		}
	}

	const array = uv.array
	for ( let vertex = 0; vertex < uv.count; vertex++ ) {
		const u = array[vertex * 2]
		let lower = 0
		let upper = count - 2
		while ( lower < upper ) {
			const middle = ( lower + upper + 1 ) >> 1
			if ( from[middle] <= u ) lower = middle
			else upper = middle - 1
		}
		const length = from[lower + 1] - from[lower]
		const scale = length > 0 ? ( to[lower + 1] - to[lower] ) / length : 1
		array[vertex * 2] = to[lower] + ( u - from[lower] ) * scale
	}
	uv.needsUpdate = true
	return true
}

export const createRoadPaintUniforms = ( width, shoulder, verge ) => ( {
	width: uniform( width ),
	shoulder: uniform( shoulder ),
	verge: uniform( verge ),
} )

export const createRoadPaintNode = uniforms => Fn( () => {
	const coords = uv()
	const across = coords.y.sub( 0.5 ).mul( uniforms.width )
	const along = coords.x
	const lateral = across.abs()
	// Screen footprint of the across-road metre, so every band self-antialiases.
	const aa = fwidth( lateral ).max( 0.004 )
	const half = uniforms.width.mul( 0.5 )
	const vergeHalf = half.sub( uniforms.verge )
	const asphaltHalf = vergeHalf.sub( uniforms.shoulder )

	// Grain repeats every dash period, so a whole-period shift past an edited
	// span leaves it exactly where it was instead of re-rolling the noise.
	const grainAlong = fract( along.div( DASH_PERIOD ) ).mul( DASH_PERIOD )
	const grain = fract( sin( grainAlong.mul( 12.9898 ).add( across.mul( 78.233 ) ) ).mul( 43758.5453 ) )
		.sub( 0.5 )
	const onGravel = lateral.smoothstep( asphaltHalf.sub( aa ), asphaltHalf.add( aa ) )
	const onVerge = lateral.smoothstep( vergeHalf.sub( aa ), vergeHalf.add( aa ) )
	// Asphalt → gravel shoulder → graded earth verge, all on the one ribbon. The
	// verge used to be a second, slightly lower ribbon, which the terrain buried
	// on the uphill edge of every cross-slope.
	const ground = mix(
		mix(
			color( ASPHALT ).add( grain.mul( 0.05 ) ),
			color( GRAVEL ).add( grain.mul( 0.13 ) ),
			onGravel
		),
		color( VERGE ).add( grain.mul( 0.1 ) ).mul( lateral.smoothstep( vergeHalf, half ).mul( 0.35 ).oneMinus() ),
		onVerge
	)

	// Polished wheel tracks, one pair per lane, kept off the gravel.
	const trackCentre = asphaltHalf.mul( 0.52 )
	const track = lateral.sub( trackCentre ).abs()
		.smoothstep( 0.18, 0.62 ).oneMinus()
		.mul( onGravel.oneMinus() ).mul( 0.22 )
	const worn = ground.mul( float( 1 ).sub( track ) )

	const edgeCentre = asphaltHalf.sub( 0.34 )
	const edgeHalf = float( 0.08 )
	const edge = lateral.sub( edgeCentre ).abs()
		.smoothstep( edgeHalf.sub( aa ).max( 0 ), edgeHalf.add( aa ) ).oneMinus()
	const withEdge = mix( worn, color( EDGE_PAINT ), edge )

	// The dash cycle is measured along the centreline, so dashes keep their real
	// length through a bend instead of stretching with the geometry.
	const cycle = fract( along.div( DASH_PERIOD ) )
	const cycleAA = fwidth( along ).div( DASH_PERIOD ).max( 0.002 )
	const dash = cycle.smoothstep( float( DASH_DUTY ).sub( cycleAA ), float( DASH_DUTY ).add( cycleAA ) ).oneMinus()
	const centreHalf = float( 0.1 )
	const centre = lateral.smoothstep( centreHalf.sub( aa ).max( 0 ), centreHalf.add( aa ) ).oneMinus().mul( dash )

	const paint = mix( withEdge, color( CENTRE_PAINT ), centre )
	// The ribbon is double-sided so bridges can be seen from below; the geometry
	// winds its front face along the surface normal, so the back is the soffit.
	return select( frontFacing, paint, color( UNDERSIDE ).add( grain.mul( 0.04 ) ) )
} )()
