import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'

/** Page-wide overlay the cell labels render into, released with the demo. */
export function createLabelRenderer() {
	const renderer = new CSS2DRenderer()
	Object.assign( renderer.domElement.style, { position: 'absolute', top: '0px', left: '0px', pointerEvents: 'none' } )
	document.body.appendChild( stage3d.own( renderer.domElement ) )
	return renderer
}

/** A cell's label: a button that calls `onSelect`, inert with `?noUI`. */
export function createLabel( { title, hook }, onSelect ) {
	const element = document.createElement( 'button' )
	element.type = 'button'
	element.className = hook ? 'line-label is-hook' : 'line-label'
	element.textContent = title
	element.title = `Inspect ${title} code`
	if ( !noUI ) {
		element.style.pointerEvents = 'auto'
		element.addEventListener( 'click', event => {
			event.stopPropagation()
			onSelect( title )
		} )
	}
	return new CSS2DObject( element )
}
