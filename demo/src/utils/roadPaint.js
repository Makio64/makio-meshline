import { color, float, Fn, fract, fwidth, mix, sin, uniform, uv } from 'three/tsl'

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
 * metres and stays put when the road is reshaped.
 */

export const DASH_PERIOD = 5.4
export const DASH_DUTY = 0.56

const ASPHALT = 0x2B2F35
const GRAVEL = 0xA9A08C
const VERGE = 0x5A4A34
const EDGE_PAINT = 0xE8E4D2
const CENTRE_PAINT = 0xE2B63E

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

	const grain = fract( sin( along.mul( 12.9898 ).add( across.mul( 78.233 ) ) ).mul( 43758.5453 ) )
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

	return mix( withEdge, color( CENTRE_PAINT ), centre )
} )()
