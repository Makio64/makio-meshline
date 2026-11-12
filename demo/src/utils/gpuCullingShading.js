import { atan, attribute, cameraViewMatrix, cos, Fn, fract, mix, positionGeometry, sin, smoothstep, step, time, uniform, vec3, vec4 } from 'three/tsl'

import { TUNNEL_HEIGHT } from '@/utils/gpuCullingTerrain'

/**
 * Hooks of the GPU Culling demo, for a line whose `tunnel` vertex attribute is 0 on the range,
 * 1 on a tunnel arch, and 2 and up on a rail or a lane, with a fraction that sets its own pace.
 *
 * The range has dim blue flats, slopes that turn violet then pink, and summits in a warm
 * light. The tunnel itself is barely drawn: it is sketched by light. Trails run every rail and
 * lane against the flight, so they come at the camera with a soft head and a long fading tail,
 * and a slow glow with no edge to it passes through the arches the same way. The arches fade
 * out with distance, which leaves the far end of the tunnel to the trails.
 */
const TRAILS = 22 // trails of light on each rail and lane
const GLOWS = 6 // glows in the arches around the lap

/** Depth at which the arches have faded out of the view being drawn. The demo sets it for each view. */
export const archReach = uniform( 70 )

const { x, y, z } = positionGeometry
const kind = attribute( 'tunnel', 'float' )
const onTunnel = step( 0.5, kind )
const onLapLine = step( 1.5, kind )
const pace = fract( kind )
const lap = atan( z, x ).div( Math.PI * 2 )
const rise = y.div( TUNNEL_HEIGHT ).clamp()

// The flight goes up the lap, so a phase that grows with time comes down it, toward the
// camera. A trail is brightest just behind its front, where its stretch of the line begins.
const along = fract( lap.mul( TRAILS ).add( pace.mul( 7.3 ) ).add( time.mul( pace.mul( 0.5 ).add( 0.45 ) ) ) )
const trail = along.oneMinus().pow( 2.4 ).mul( smoothstep( 0, 0.12, along ) )
const glow = cos( lap.mul( GLOWS ).add( time.mul( 0.12 ) ).mul( Math.PI * 2 ) ).mul( 0.5 ).add( 0.5 ).pow( 3 )

// Far arches crowd together on screen: they fade from close to the camera out to their reach.
const depth = cameraViewMatrix.mul( vec4( positionGeometry, 1 ) ).z.negate()
const archFade = smoothstep( archReach.mul( 0.12 ), archReach, depth ).oneMinus()

/**
 * A trail swells gently toward its head, and an arch thickens a little inside a glow. A faded
 * arch also thins to nothing, so it does not draw dark over the trails behind it.
 */
export const tunnelWidth = Fn( ( [width] ) => {
	const swell = mix( glow.mul( 0.9 ).add( 0.8 ).mul( archFade ), trail.mul( 2 ).add( 0.6 ), onLapLine )
	return width.mul( mix( 1, swell, onTunnel ) )
} )

export const rangeAndTunnelColor = Fn( ( [base] ) => {
	const slopes = mix( vec3( 0.08, 0.5, 1 ), vec3( 0.5, 0.36, 1 ), smoothstep( 0.5, 8, y ) )
	const ridges = mix( slopes, vec3( 1, 0.34, 0.62 ), smoothstep( 6, 17, y ) )
	const summits = mix( ridges, vec3( 1, 0.84, 0.5 ), smoothstep( 15, 28, y ) )
	const range = summits.mul( smoothstep( 0, 3, y ).mul( 0.9 ).add( 0.1 ) )

	// At rest: deep blue at the road, pale at the crown.
	const ice = mix( mix( vec3( 0.05, 0.3, 0.9 ), vec3( 0.25, 0.7, 1 ), smoothstep( 0, 0.6, rise ) ), vec3( 0.8, 0.95, 1 ), smoothstep( 0.5, 1, rise ) )
	// The light drifts between cyan and lime around the lap, a little differently on each line.
	const aurora = mix( vec3( 0.1, 0.95, 1 ), vec3( 0.7, 1, 0.15 ), sin( lap.mul( Math.PI * 6 ).add( pace.mul( 1.5 ) ).add( time.mul( 0.2 ) ) ).mul( 0.5 ).add( 0.5 ) )

	// A rail or a lane shows only where a trail runs; the arches stay as a faint hint.
	// Squared, the fade is over before the arch has thinned to a row of dots.
	const arch = ice.mul( 0.12 ).add( aurora.mul( glow ).mul( 0.45 ) ).mul( archFade.pow( 2 ) )
	const lapLine = ice.mul( 0.03 ).add( aurora.mul( trail ).mul( 1.15 ) ).add( trail.pow( 4 ).mul( 0.45 ) )
	const tunnel = mix( arch, lapLine, onLapLine )

	return vec4( mix( range, tunnel, onTunnel ).mul( base.rgb ), 1 )
} )
