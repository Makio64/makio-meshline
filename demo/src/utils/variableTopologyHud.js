import './variableTopologyHud.styl'

import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

import stage3d from '@/makio/three/stage3d'

/** The overlay that pins the labels to the scene. */
export function createLabelRenderer() {
	const renderer = new CSS2DRenderer()
	Object.assign( renderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' } )
	document.body.appendChild( stage3d.own( renderer.domElement ) )
	return renderer
}

export function createLabel( text, color, position ) {
	const element = document.createElement( 'div' )
	element.className = 'VariableTopologyLabel'
	element.style.setProperty( '--accent', `#${color.toString( 16 ).padStart( 6, '0' )}` )
	element.textContent = text

	const label = new CSS2DObject( element )
	label.position.set( ...position )
	stage3d.add( label )
	return element
}

export function paintBadge( badge, metrics ) {
	badge.textContent = metrics.badge
	badge.classList.toggle( 'VariableTopologyLabel__meta--clipped', metrics.join === 'miter' && metrics.variableTopology )
}

export function addBadge( label ) {
	const badge = document.createElement( 'span' )
	badge.className = 'VariableTopologyLabel__meta'
	label.appendChild( badge )
	return badge
}
