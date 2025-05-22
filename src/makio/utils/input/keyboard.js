/**
 * Keyboard signal dispatcher
 * @author David Ronai / @Makio64
 */

import Signal from '../../core/Signal'

const onDown = new Signal()
const onUp = new Signal()

const keyboard = {
	onUp: onUp,
	onDown: onDown,
	crtlKey: false,
	altKey: false,
}

window.addEventListener( 'keydown', ( e ) => {
	keyboard.crtlKey = e.ctrlKey
	keyboard.altKey = e.altKey
	onDown.dispatch( e.key, e )
} )

window.addEventListener( 'keyup', ( e ) => {
	onUp.dispatch( e.key, e )
} )

export function prevent( e ) {
	e.preventDefault()
	e.stopPropagation()
	e.stopImmediatePropagation()
}

export default keyboard
export { keyboard }
