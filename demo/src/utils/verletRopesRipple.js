import './verletRopesRipple.styl'

import stage3d from '@/makio/three/stage3d'
import { noUI, reducedMotion } from '@/makio/utils/detect'

/** Returns `ripple( x, y )`, which pops a fading ring at a screen position. */
export function createPluckRipples() {
	if ( noUI ) return () => {}

	const layer = stage3d.own( document.createElement( 'div' ) )
	document.body.appendChild( layer )

	return ( x, y ) => {
		if ( reducedMotion.matches ) return

		const ripple = document.createElement( 'div' )
		ripple.className = 'VerletRopesPulse'
		ripple.style.left = `${x}px`
		ripple.style.top = `${y}px`
		ripple.addEventListener( 'animationend', () => ripple.remove(), { once: true } )
		layer.appendChild( ripple )
	}
}
