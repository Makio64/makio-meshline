import { readdirSync } from 'node:fs'
import path from 'node:path'

import standaloneConfig from './vite.standalone.js'

const sounds = readdirSync( path.resolve( import.meta.dirname, 'public/sounds/road' ) )
	.filter( file => file.endsWith( '.mp3' ) )
	.sort()
	.map( file => `sounds/road/${file}` )

export default standaloneConfig( 'track-maker', [
	'textures/noises/perlin/rgb-256x256.png',
	'textures/road-cockpit.png',
	...sounds,
] )
