import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig } from 'vite'

const demo = import.meta.dirname
const publicAssets = [
	'icons/favicon.svg',
	'textures/noises/perlin/rgb-256x256.png',
	'textures/road-cockpit.png',
	...readdirSync( path.resolve( demo, 'public/sounds/road' ) )
		.filter( file => file.endsWith( '.mp3' ) )
		.sort()
		.map( file => `sounds/road/${file}` ),
]
const contentTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg' }

export default defineConfig( {
	root: path.resolve( demo, 'src/track-maker' ),
	publicDir: false,
	plugins: [
		vue(),
		// Shared demo helpers use the Vue auto-imports from the main demo build.
		AutoImport( { imports: ['vue'], dts: false } ),
		{
			name: 'track-maker-assets',
			configureServer( server ) {
				server.middlewares.use( ( req, res, next ) => {
					const file = publicAssets.find( asset => req.url?.split( '?' )[0] === `/${asset}` )
					if ( !file ) return next()
					res.setHeader( 'Content-Type', contentTypes[path.extname( file )] )
					res.end( readFileSync( path.resolve( demo, 'public', file ) ) )
				} )
			},
			generateBundle() {
				for ( const file of publicAssets ) {
					this.emitFile( { type: 'asset', fileName: file, source: readFileSync( path.resolve( demo, 'public', file ) ) } )
				}
			},
		},
	],
	resolve: {
		dedupe: ['three'],
		alias: { '@': path.resolve( demo, 'src' ) },
		extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue', '.styl'],
	},
	build: {
		target: 'esnext',
		outDir: path.resolve( demo, '../dist/track-maker' ),
		emptyOutDir: true,
	},
} )
