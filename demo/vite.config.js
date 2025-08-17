import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import mkcert from 'vite-plugin-mkcert'
import { qrcode } from 'vite-plugin-qrcode'
import { visualizer } from "rollup-plugin-visualizer"
import { brotliSizePlugin } from 'vite-plugin-brotli-size'

// Allow to auto import the components, making the code much more clean and light
import Components from 'unplugin-vue-components/vite'
import AutoImport from 'unplugin-auto-import/vite'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig( {
	plugins: [
		mkcert(),
		Components( {
			/* options https://github.com/antfu/unplugin-vue-components */
			deep: true,
			directives: false,
		} ),
		AutoImport( {
			/* options https://github.com/antfu/unplugin-auto-import */
			include: [/\.[tj]sx?$/, /\.vue$/, /\.vue\?vue/, /\.md$/],
			imports: ['vue', 'vue-router'],
			vueTemplate: true,
			eslintrc: {
				enabled: true,
			},
		} ),
		vue(),
		qrcode(),
		// network, sunburst, treemap, icicle
		// visualizer( { open: true, brotliSize: true, template: 'sunburst', emitFile: false, sourcemap: true } ),
		brotliSizePlugin(),
	],
	build: {
		target: 'esnext',
		emptyOutDir: true,
		sourcemap: true,
		rollupOptions: {
			output: {
				manualChunks: undefined
			}
		},
		minify: 'terser',
		terserOptions: {
			mangle: {
				keep_fnames: true,
				reserved: ['p']
			},
			compress: {
				keep_fnames: true
			}
		}
	},
	esbuild: {
		keepNames: true,
		legalComments: 'none',
	},
	// optimizeDeps: {
	// 	esbuildOptions: {
	// 		target: 'esnext', // Ensure esbuild target is set to esnext for dependencies
	// 	},
	// },
	base: process.env.NODE_ENV === 'production' ? '/' : '/',
	resolve: {
		alias: {
			'@': path.resolve( __dirname, './src' ),
		},
		extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue', '.styl'],
	},
	server: {
		https: true,
		port: 3000,
		strictPort: false
	},
} )
