/** The Lines panel of the Wind Tunnel demo: a lil-gui over the uniforms that shape its smoke. */
import GUI from 'lil-gui'

import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'

// Colours of the smoke by air speed: stalled, free stream, sliding over the body, fastest.
const PALETTES = {
	Ice: ['#6a3cff', '#35a4ff', '#dcf4ff', '#ffd9a3'],
	Ember: ['#5b1bbf', '#ff4d2e', '#ffc46b', '#fff4d6'],
	Neon: ['#ff2bd6', '#7c4dff', '#2bffd9', '#f4ff61'],
	Mono: ['#39414f', '#8794a6', '#e8eef5', '#ffffff'],
}

/**
 * Build the panel over `look`, the demo's map of uniforms. A range uniform is a
 * `Vector2( min, max )`, and gets one slider for each end.
 */
export function createLinesPanel( look ) {
	if ( noUI ) return

	const gui = stage3d.own( new GUI( { title: 'Lines', width: 260 } ) )
	// Under the Demos button, and folded until asked for.
	gui.domElement.style.top = '68px'
	gui.domElement.style.right = '16px'
	gui.close()

	const range = ( folder, vector, name, min, max, step ) => {
		folder.add( vector.value, 'x', min, max, step ).name( `${name} min` )
		folder.add( vector.value, 'y', min, max, step ).name( `${name} max` )
	}

	const shape = gui.addFolder( 'Shape' )
	shape.add( look.density, 'value', 0.05, 1, 0.01 ).name( 'density' )
	range( shape, look.width, 'width', 0.002, 0.08, 0.001 )
	range( shape, look.length, 'length', 0.05, 1, 0.01 )
	range( shape, look.speed, 'speed', 0.3, 2, 0.01 )
	shape.add( look.halo, 'value', 0, 3, 0.01 ).name( 'halo' )

	const colors = gui.addFolder( 'Colors' )
	const swatches = ['stalled', 'stream', 'sliding', 'peak'].map( name => {
		const swatch = { [name]: `#${look[name].value.getHexString()}` }
		return colors.addColor( swatch, name ).onChange( hex => look[name].value.set( hex ) )
	} )
	colors.add( { palette: 'Ice' }, 'palette', Object.keys( PALETTES ) ).onChange( name => {
		swatches.forEach( ( swatch, index ) => swatch.setValue( PALETTES[name][index] ) )
	} )
	colors.add( look.glow, 'value', 0, 3, 0.01 ).name( 'glow' )

	const flow = gui.addFolder( 'Flow' )
	flow.add( look.cling, 'value', 0, 2, 0.01 ).name( 'cling to the car' )
	flow.add( look.turbulence, 'value', 0, 3, 0.01 ).name( 'wake turbulence' )
}
