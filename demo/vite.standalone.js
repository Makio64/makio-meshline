import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig } from 'vite'

const demo = import.meta.dirname
const contentTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg' }
// three's package folder: its main entry is build/three.cjs.
const three = path.resolve( createRequire( import.meta.url ).resolve( 'three' ), '../..' )

// Netlify headers: hashed files never change, the page and the public files may.
const HEADERS = `/assets/*
	Cache-Control: public, max-age=31536000, immutable
`

/**
 * One demo built as an app of its own: the page in src/<name>/, built into dist/<name>/ at the
 * repository root. `assets` are the files of public/ the demo reads, served and shipped as they are;
 * `preload` lists those the head asks for before the app's script runs, as `{ href, as }`.
 *
 * The page loads in one round trip of its own: one script, its styles inline, and the head
 * preloading the demo's first files and the app's pipeline recording (src/standalone/fastStart.js).
 */
export default function standaloneConfig( name, assets, { preload = [] } = {} ) {
	const publicAssets = ['icons/favicon.svg', ...assets]

	return defineConfig( ( { command } ) => ( {
		root: path.resolve( demo, 'src', name ),
		publicDir: false,
		plugins: [
			vue(),
			// Shared demo helpers use the Vue auto-imports from the main demo build.
			AutoImport( { imports: ['vue'], dts: false } ),
			{
				name: `${name}-assets`,
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
					this.emitFile( { type: 'asset', fileName: '_headers', source: HEADERS } )
				},
			},
			{
				name: `${name}-head`,
				apply: 'build',
				transformIndexHtml: {
					order: 'post',
					handler( html, { bundle } ) {
						// The styles inline: no stylesheet request between the page and its first paint.
						html = html.replace( /<link\b[^>]*rel="stylesheet"[^>]*>/g, tag => {
							const file = /href="\/?([^"]+)"/.exec( tag )?.[1]
							const asset = bundle[file]
							if ( asset?.type !== 'asset' ) throw new Error( `Cannot inline ${file}` )
							delete bundle[file]
							return `<style>${asset.source}</style>`
						} )
						// Images load as the demo's TextureLoader asks for them: anonymous CORS.
						const tags = preload.map( attrs => ( { tag: 'link', attrs: { rel: 'preload', crossorigin: '', ...attrs }, injectTo: 'head' } ) )
						const recording = Object.values( bundle ).find( item => item.type === 'asset' && item.originalFileNames?.some( file => file.endsWith( 'pipelines.json' ) ) )
						if ( recording ) tags.push( { tag: 'link', attrs: { rel: 'preload', as: 'fetch', crossorigin: '', href: `/${recording.fileName}` }, injectTo: 'head' } )
						return { html, tags }
					},
				},
			},
		],
		resolve: {
			dedupe: ['three'],
			alias: [
				{ find: '@', replacement: path.resolve( demo, 'src' ) },
				// Built from three's sources rather than its prebuilt files, so what the app never uses is
				// left out, and with a renderer that downloads the WebGL2 backend only when it is needed.
				...command === 'build' ? [
					{ find: /^three\/webgpu$/, replacement: path.resolve( demo, 'src/standalone/threeWebGPU.js' ) },
					{ find: /^three\/tsl$/, replacement: path.join( three, 'src/nodes/TSL.js' ) },
					{ find: /^three$/, replacement: path.join( three, 'src/Three.Core.js' ) },
				] : [],
			],
			extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue', '.styl'],
		},
		build: {
			target: 'esnext',
			outDir: path.resolve( demo, '../dist', name ),
			emptyOutDir: true,
		},
	} ) )
}
