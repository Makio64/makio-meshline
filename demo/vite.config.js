import vue from '@vitejs/plugin-vue'
import path from 'path'
import AutoImport from 'unplugin-auto-import/vite'
// Allow to auto import the components, making the code much more clean and light
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import { brotliSizePlugin } from 'vite-plugin-brotli-size'
import mkcert from 'vite-plugin-mkcert'
import { qrcode } from 'vite-plugin-qrcode'

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
	optimizeDeps: {
		exclude: ['three/addons/inspector/Inspector.js'],
	},
	base: process.env.NODE_ENV === 'production' ? '/' : '/',
	resolve: {
		dedupe: ['three'],
		alias: {
			'@': path.resolve( import.meta.dirname, './src' ),
		},
		extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue', '.styl'],
	},
	server: {
		https: true,
		port: 3000,
		strictPort: false
	},
} )
