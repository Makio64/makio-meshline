/** Tiny scalar helpers for scroll-scrubbed animation (pure JS, no three). */

export const clamp = ( v, a = 0, b = 1 ) => Math.max( a, Math.min( b, v ) )
export const lerp = ( a, b, t ) => a + ( b - a ) * t
/** 0..1 position of v between a and b (clamped). */
export const invLerp = ( a, b, v ) => clamp( ( v - a ) / ( b - a || 1e-9 ) )
/** Map v from [a0, a1] to [b0, b1] (clamped). */
export const remap = ( v, a0, a1, b0, b1 ) => lerp( b0, b1, invLerp( a0, a1, v ) )
export const smoothstep = ( a, b, v ) => {
	const t = invLerp( a, b, v )
	return t * t * ( 3 - 2 * t )
}
/** Frame-rate independent exponential follow: x = damp( x, target, 8, dt ). */
export const damp = ( x, target, lambda, dt ) => lerp( x, target, 1 - Math.exp( -lambda * dt ) )

export const easeOutCubic = ( t ) => 1 - Math.pow( 1 - t, 3 )
export const easeInOutCubic = ( t ) => ( t < 0.5 ? 4 * t * t * t : 1 - Math.pow( -2 * t + 2, 3 ) / 2 )
export const easeOutExpo = ( t ) => ( t >= 1 ? 1 : 1 - Math.pow( 2, -10 * t ) )
export const easeInOutSine = ( t ) => -( Math.cos( Math.PI * t ) - 1 ) / 2
