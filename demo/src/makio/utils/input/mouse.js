/**
 * Mouse signal dispatcher
 * @author David Ronai / @Makio64
 */

import stage from '../../core/stage'
import Signal from '../../core/Signal'
import { isIOS } from '../detect'

const mouse = {
	isDown: false,
	x: stage.width * 0.5,
	y: stage.height * 0.5,
	moveX: stage.width * 0.5,
	moveY: stage.height * 0.5,
	isMoveX: false,
	isMoveY: false,
	e: null,
	downStart: 0,
	downEnd: 0,
	percentX: 0.5,
	percentY: 0.5,
	normalizedX: 0.0,
	normalizedY: 0.0,
	totalDistance: 0,
}
const prevMouse = { x: mouse.x, y: mouse.y }

const [onDown, onUp, onMove, onClick, onEnter, onLeave] = Array( 6 ).fill().map( () => new Signal() )

function refreshMouseState( e ) {
	Object.assign( mouse, {
		x: e.x,
		y: e.y,
		moveX: e.x - mouse.x,
		moveY: e.y - mouse.y,
		percentX: e.x / stage.width,
		percentY: e.y / stage.height,
		normalizedX: ( e.x / stage.width - 0.5 ) * 2,
		normalizedY: ( e.y / stage.height - 0.5 ) * 2,
		e,
	} )
	if ( !mouse.isMoveX && !mouse.isMoveY ) {
		if ( Math.abs( mouse.moveX ) > Math.abs( mouse.moveY ) && Math.abs( mouse.moveX ) > 15 ) {
			mouse.isMoveX = true
		} else if ( Math.abs( mouse.moveY ) > Math.abs( mouse.moveX ) && Math.abs( mouse.moveY ) > 15 ) {
			mouse.isMoveY = true
		}
	}
	mouse.totalDistance += Math.abs( mouse.moveX ) + Math.abs( mouse.moveY )
	return mouse
}

function clearMouseState() {
	Object.assign( mouse, { isDown: false, moveX: 0, moveY: 0, isMoveX: false, isMoveY: false, downEnd: Date.now() } )
}

if ( typeof window !== 'undefined' ) {

	// Prevent zoom on double tap
	document.addEventListener( 'touchstart', ( e ) => {
		if ( isIOS ) { // else it block on android all interactions
			if ( e.touches.length > 1 || e.scale !== 1 ) { e.preventDefault() }
		}
	}, { passive: false } )

	// Prevent zoom on double tap
	document.addEventListener( 'gesturestart', ( e ) => { e.preventDefault() }, { passive: false } )

	// Prevent context menu on long touch on iOs
	if ( isIOS ) {
		window.addEventListener( 'contextmenu', ( e ) => { e.preventDefault() } )
	}

	// Fix double click zoom on iOS
	document.ondblclick = ( e ) => { e.preventDefault() }

	const leaveOrBlur = () => {
		clearMouseState()
		onLeave.dispatch()
	}
	window.addEventListener( 'blur', leaveOrBlur )
	window.addEventListener( 'pointerleave', leaveOrBlur )

	// Handle both pointer and touch events
	const startHandler = ( e ) => {
		const x = e.touches ? e.touches[0].clientX : e.x
		const y = e.touches ? e.touches[0].clientY : e.y
		Object.assign( mouse, { isDown: true, downStart: Date.now(), x, y, totalDistance: 0 } )
		onDown.dispatch( refreshMouseState( { x, y } ) )
	}

	let moveTimeout = null
	
	const moveHandler = ( e ) => {
		const x = e.touches ? e.touches[0].clientX : e.x
		const y = e.touches ? e.touches[0].clientY : e.y
		Object.assign( prevMouse, mouse )
		onMove.dispatch( refreshMouseState( { x, y } ) )
		
		// Clear any existing timeout
		if ( moveTimeout ) {
			clearTimeout( moveTimeout )
		}
		
		// Set a timeout to reset moveX/moveY after mouse stops
		moveTimeout = setTimeout( () => {
			mouse.moveX = 0
			mouse.moveY = 0
		}, 50 ) // Reset after 50ms of no movement
	}

	const endHandler = ( e ) => {
		// e.preventDefault()
		const x = e.changedTouches ? e.changedTouches[0].clientX : e.x
		const y = e.changedTouches ? e.changedTouches[0].clientY : e.y
		clearMouseState()
		onUp.dispatch( refreshMouseState( { x, y } ) )

		// Handle click detection for both touch and pointer events
		if ( mouse.downEnd - mouse.downStart <= 300 && mouse.totalDistance <= 10 ) {
			onClick.dispatch( refreshMouseState( { x, y } ) )
		}
	}

	// Pointer events
	window.addEventListener( 'pointerdown', startHandler )
	window.addEventListener( 'pointermove', moveHandler )
	window.addEventListener( 'pointerup', endHandler )
	window.addEventListener( 'pointercancel', endHandler )

}

if ( typeof document !== 'undefined' ) {
	document.body.addEventListener( 'pointerenter', () => {
		clearMouseState()
		onEnter.dispatch()
	} )
}

export { mouse, prevMouse, onDown, onUp, onMove, onClick, onEnter, onLeave }
export default mouse
