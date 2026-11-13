import './demoHud.styl'

import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

const isTyping = target => target?.matches?.( 'input:not([type="range"]), textarea, select, [contenteditable="true"]' )
const sliderProgress = ( value, min, max ) => `${Math.max( 0, Math.min( 100, ( ( value - min ) / ( max - min ) ) * 100 ) ).toFixed( 1 )}%`

/** Run `handler` when `key` is pressed, unless the visitor is typing or browsing the menu. */
export function onShortcut( key, handler ) {
	stage3d.listen( keyboard.onDown, ( pressed, event ) => {
		if ( pressed.toLowerCase() !== key.toLowerCase() ) return
		if ( event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ) return
		if ( !menuOpen.value && !isTyping( event.target ) ) handler()
	} )
}

/**
 * Pill of controls at the top center of the page, hidden with `?noUI`.
 * Items are `{ id, label, onClick, key?, title?, ariaLabel?, pressed? }`,
 * slider items `{ id, label, min?, max?, step?, value?, format?, ariaValueText?, onInput }`,
 * or `'divider'`.
 * A button with `pressed` is a toggle, one without is a plain accent action.
 * `key` adds a keyboard shortcut for `onClick`.
 */
export function createDemoControls( items, { accent = '#7dd3fc', label = 'Demo controls' } = {} ) {
	for ( const { key, onClick } of items ) {
		if ( key ) onShortcut( key, onClick )
	}

	const buttons = new Map()
	const sliders = new Map()
	const setPressed = ( id, pressed ) => buttons.get( id )?.setAttribute( 'aria-pressed', pressed )
	const controls = {
		setPressed,
		setLabel: ( id, text ) => { if ( buttons.has( id ) ) buttons.get( id ).firstChild.textContent = text },
		setValue: ( id, value ) => sliders.get( id )?.( value ),
		select: id => buttons.forEach( ( _, buttonId ) => setPressed( buttonId, buttonId === id ) ),
	}
	if ( noUI ) return controls

	const bar = stage3d.own( document.createElement( 'div' ) )
	bar.className = 'DemoControls'
	bar.setAttribute( 'role', 'group' )
	bar.setAttribute( 'aria-label', label )
	bar.style.setProperty( '--demo-accent', accent )
	bar.addEventListener( 'pointerdown', event => event.stopPropagation() )
	bar.addEventListener( 'touchstart', event => event.stopPropagation(), { passive: true } )
	bar.addEventListener( 'wheel', event => event.stopPropagation(), { passive: true } )
	bar.addEventListener( 'dragstart', event => event.preventDefault() )

	for ( const item of items ) {
		if ( item === 'divider' ) {
			bar.appendChild( document.createElement( 'hr' ) )
			continue
		}
		if ( item.onInput ) {
			const min = item.min ?? 0
			const max = item.max ?? 100
			const format = item.format ?? String
			const wrap = document.createElement( 'div' )
			wrap.className = 'DemoControls__slider'
			wrap.dataset.controlId = item.id

			const inputId = `demo-slider-${item.id}`
			const labelEl = document.createElement( 'label' )
			labelEl.htmlFor = inputId
			labelEl.textContent = item.label

			const input = document.createElement( 'input' )
			input.id = inputId
			input.type = 'range'
			input.draggable = false
			input.min = String( min )
			input.max = String( max )
			input.step = String( item.step ?? 1 )
			input.style.setProperty( '--attr-min', String( min ) )
			input.style.setProperty( '--attr-max', String( max ) )

			const valueEl = document.createElement( 'strong' )
			const sync = value => {
				const numeric = Number( value )
				const text = String( numeric )
				if ( input.value !== text ) input.value = text
				input.style.setProperty( '--control-value', text )
				input.style.setProperty( '--slider-progress', sliderProgress( numeric, min, max ) )
				input.setAttribute( 'aria-valuetext', item.ariaValueText ? item.ariaValueText( numeric ) : format( numeric ) )
				valueEl.textContent = format( numeric )
			}
			sync( item.value ?? min )
			input.addEventListener( 'input', () => {
				const next = Number( input.value )
				sync( next )
				item.onInput( next )
			} )
			if ( item.onChange ) {
				input.addEventListener( 'change', () => item.onChange( Number( input.value ) ) )
			}

			wrap.append( labelEl, input, valueEl )
			bar.appendChild( wrap )
			sliders.set( item.id, sync )
			continue
		}
		const button = document.createElement( 'button' )
		button.type = 'button'
		// Stable id for the WebMCP use_demo_control tool (labels can change)
		button.dataset.controlId = item.id
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
