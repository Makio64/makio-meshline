// Reads and drives what a demo shows on screen: the `.DemoControls` pills
// (from createDemoControls or a demo's own Vue pill), the HUD a demo renders
// inside `.ExampleView`, the hint, the instruction and the failure card.
// Plain DOM, so every demo is covered without changes.

const SCOPES = '.DemoControls, .ExampleView'
const FIELDS = 'button, input[type="range"], input[type="checkbox"], select'

const SKIP = '.DemoFailure, .CodeButton' // the failure card is read apart; site navigation is open_demo's job

const text = element => element?.textContent?.replace( /\s+/g, ' ' ).trim() || ''
// A button's text without its shortcut badge.
const ownText = element => [...element.childNodes].filter( node => node.nodeName !== 'KBD' ).map( node => node.textContent ).join( ' ' ).replace( /\s+/g, ' ' ).trim()

export const controlSlug = value => String( value ).toLowerCase().normalize( 'NFKD' ).replace( /[^\p{L}\p{N}]+/gu, '-' ).replace( /^-+|-+$/g, '' )

const groupOf = element => element.closest( '[role="group"][aria-label], .DemoControls[aria-label]' )?.getAttribute( 'aria-label' ) || ''

function fieldLabel( element ) {
	return element.getAttribute( 'aria-label' )
		|| text( element.labels?.[0] )
		|| text( element.getAttribute( 'aria-labelledby' ) && element.ownerDocument.getElementById( element.getAttribute( 'aria-labelledby' ) ) )
		|| element.title
		|| element.id
		|| ''
}

function common( element, label, type ) {
	const group = groupOf( element )
	const description = element.getAttribute( 'aria-label' )
	return {
		id: element.closest( '[data-control-id]' )?.dataset.controlId || element.id?.replace( /^demo-slider-/, '' ) || controlSlug( label ) || type,
		type,
		label,
		...( group ? { group } : {} ),
		...( description && description !== label ? { description } : {} ),
		...( element.title && element.title !== label ? { title: element.title } : {} ),
		...( element.disabled ? { disabled: true } : {} )
	}
}

function describeButton( button ) {
	const shortcut = text( button.querySelector( 'kbd' ) )
	const label = ownText( button ) || button.getAttribute( 'aria-label' ) || button.title || ''
	const pressed = button.getAttribute( 'aria-pressed' )
	const expanded = button.getAttribute( 'aria-expanded' )
	return {
		...common( button, label, pressed === null ? 'button' : 'toggle' ),
		...( pressed === null ? {} : { pressed: pressed === 'true' } ),
		...( expanded === null ? {} : { expanded: expanded === 'true' } ),
		...( shortcut ? { shortcut } : {} ),
		element: button
	}
}

function describeField( element ) {
	const label = fieldLabel( element )
	if ( element.tagName === 'SELECT' ) {
		return {
			...common( element, label, 'select' ),
			value: element.value,
			options: [...element.options].map( option => ( { value: option.value, label: text( option ) } ) ),
			element
		}
	}
	if ( element.type === 'checkbox' ) return { ...common( element, label, 'checkbox' ), checked: element.checked, element }
	return {
		...common( element, label, 'slider' ),
		value: Number( element.value ),
		min: Number( element.min || 0 ),
		max: Number( element.max || 100 ),
		step: element.step === 'any' ? 'any' : Number( element.step || 1 ),
		...( element.getAttribute( 'aria-valuetext' ) ? { display: element.getAttribute( 'aria-valuetext' ) } : {} ),
		element
	}
}

// Every visible control, in reading order; `element` stays private to this module.
export function readControls( root = document ) {
	const controls = []
	const seen = new Set()
	for ( const scope of root.querySelectorAll( SCOPES ) ) {
		for ( const element of scope.querySelectorAll( FIELDS ) ) {
			if ( seen.has( element ) || element.closest( SKIP ) ) continue
			seen.add( element )
			if ( !element.getClientRects().length ) continue // display: none, a collapsed panel
			controls.push( element.tagName === 'BUTTON' ? describeButton( element ) : describeField( element ) )
		}
	}
	const ids = new Map()
	for ( const control of controls ) {
		const count = ids.get( control.id ) || 0
		ids.set( control.id, count + 1 )
		if ( count ) control.id = `${control.id}-${count + 1}`
	}
	return controls
}

export const publicControl = ( { element, ...control } ) => control

// By id first, then by label or description, exact before partial.
export function findControl( controls, wanted ) {
	const value = String( wanted ?? '' ).trim().toLowerCase()
	if ( !value ) return null
	const slug = controlSlug( value )
	const names = control => [control.label, control.description, control.title].filter( Boolean ).map( name => name.toLowerCase() )
	return controls.find( control => control.id.toLowerCase() === value )
		|| controls.find( control => control.id === slug )
		|| controls.find( control => names( control ).includes( value ) )
		|| controls.find( control => names( control ).some( name => name.includes( value ) ) )
		|| null
}

// The value a range input settles on: clamped, then snapped to its step.
export function sliderValue( control, value ) {
	const number = Number( value )
	if ( !Number.isFinite( number ) ) return null
	const clamped = Math.min( Math.max( number, control.min ), control.max )
	if ( control.step === 'any' || !control.step ) return clamped
	const snapped = control.min + Math.round( ( clamped - control.min ) / control.step ) * control.step
	return Number( Math.min( snapped, control.max ).toFixed( 10 ) )
}

const fire = element => {
	element.dispatchEvent( new Event( 'input', { bubbles: true } ) )
	element.dispatchEvent( new Event( 'change', { bubbles: true } ) )
}

export function useControl( control, value ) {
	const { element } = control
	if ( control.disabled ) return { error: `"${control.label}" is disabled right now.` }
	if ( control.type === 'select' ) {
		const wanted = String( value ?? '' ).toLowerCase()
		const option = control.options.find( item => item.value.toLowerCase() === wanted ) || control.options.find( item => item.label.toLowerCase() === wanted )
		if ( !option ) return { error: `"${control.label}" is a select: pass one of ${control.options.map( item => `"${item.value}"` ).join( ', ' )} as value.` }
		element.value = option.value
		fire( element )
		return { done: `Set ${control.label} to ${option.label}.` }
	}
	if ( control.type === 'slider' ) {
		const next = sliderValue( control, value )
		if ( next === null ) return { error: `"${control.label}" is a slider from ${control.min} to ${control.max}: pass a number as value.` }
		element.value = String( next )
		fire( element )
		return { done: `Set ${control.label} to ${element.value}.` }
	}
	if ( control.type === 'checkbox' && typeof value === 'boolean' && value === control.checked ) return { done: `${control.label} was already ${value ? 'on' : 'off'}.` }
	element.click()
	return { done: `Pressed ${control.label}.` }
}

// Everything a visitor can read about the demo on screen.
export function readScreen( root = document ) {
	const failure = root.querySelector( '.DemoFailure' )
	return {
		failure: failure ? {
			title: text( failure.querySelector( 'h1' ) ),
			summary: text( failure.querySelector( '.DemoFailure__summary' ) ),
			guidance: [...failure.querySelectorAll( 'li' )].map( text ).filter( Boolean ),
			detail: text( failure.querySelector( 'code' ) )
		} : null,
		hint: [...root.querySelectorAll( '.DemoHint' )].map( text ).filter( Boolean ).join( ' ' ),
		instruction: text( root.querySelector( '.ExampleView .instruction' ) ),
		controls: readControls( root )
	}
}
