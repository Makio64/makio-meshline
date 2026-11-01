import './demoHud.styl'

import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'

/**
 * Small pill in the top-left corner that tells the visitor how to interact.
 * Hidden with `?noUI` so embedded demos stay clean.
 */
export function createDemoHint( text, { accent = '#7dd3fc', hideAfter = 9000, attributes = {} } = {} ) {
	if ( noUI ) return { hide() {}, setText() {}, setAccent() {} }

	const element = stage3d.own( document.createElement( 'div' ) )
	element.className = 'DemoHint'
	element.textContent = text
	element.style.setProperty( '--demo-accent', accent )
	for ( const [name, value] of Object.entries( attributes ) ) element.setAttribute( name, value )
	document.body.appendChild( element )

	const hint = {
		hide() {
			element.classList.add( 'is-hidden' )
		},
		setText( value ) {
			element.textContent = value
		},
		setAccent( value ) {
			element.style.setProperty( '--demo-accent', value )
		},
	}
	if ( hideAfter > 0 ) setTimeout( hint.hide, hideAfter )
	return hint
}
