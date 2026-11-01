import './demoHud.styl'

import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

const isTyping = target => target?.matches?.( 'input, textarea, select, [contenteditable="true"]' )

/** Run `handler` when `key` is pressed, unless the visitor is typing or browsing the menu. */
export function onShortcut( key, handler ) {
	stage3d.listen( keyboard.onDown, ( pressed, event ) => {
		if ( pressed.toLowerCase() !== key.toLowerCase() ) return
		if ( event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ) return
		if ( !menuOpen.value && !isTyping( event.target ) ) handler()
	} )
}

/**
 * Pill of buttons at the top center of the page, hidden with `?noUI`.
 * Items are `{ id, label, onClick, key?, title?, ariaLabel?, pressed? }`, or `'divider'`.
 * A button with `pressed` is a toggle, one without is a plain accent action.
 * `key` adds a keyboard shortcut for `onClick`.
 */
export function createDemoControls( items, { accent = '#7dd3fc', label = 'Demo controls' } = {} ) {
	for ( const { key, onClick } of items ) {
		if ( key ) onShortcut( key, onClick )
	}

	const buttons = new Map()
	const setPressed = ( id, pressed ) => buttons.get( id )?.setAttribute( 'aria-pressed', pressed )
	const controls = {
		setPressed,
		setLabel: ( id, text ) => { if ( buttons.has( id ) ) buttons.get( id ).firstChild.textContent = text },
		select: id => buttons.forEach( ( _, buttonId ) => setPressed( buttonId, buttonId === id ) ),
	}
	if ( noUI ) return controls

	const bar = stage3d.own( document.createElement( 'div' ) )
	bar.className = 'DemoControls'
	bar.setAttribute( 'role', 'group' )
	bar.setAttribute( 'aria-label', label )
	bar.style.setProperty( '--demo-accent', accent )
	for ( const type of ['pointerdown', 'touchstart', 'wheel'] ) bar.addEventListener( type, event => event.stopPropagation() )

	for ( const item of items ) {
		if ( item === 'divider' ) {
			bar.appendChild( document.createElement( 'hr' ) )
			continue
		}
		const button = document.createElement( 'button' )
		button.type = 'button'
		button.title = item.title ?? ''
		if ( item.ariaLabel ) button.setAttribute( 'aria-label', item.ariaLabel )
		button.innerHTML = `<span>${item.label}</span>${item.key ? `<kbd>${item.key}</kbd>` : ''}`
		if ( item.pressed !== undefined ) button.setAttribute( 'aria-pressed', item.pressed )
		button.addEventListener( 'click', item.onClick )
		bar.appendChild( button )
		buttons.set( item.id, button )
	}

	document.body.appendChild( bar )
	return controls
}
