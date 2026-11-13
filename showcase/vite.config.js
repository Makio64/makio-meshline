import path from 'node:path'

import { defineConfig } from 'vite'

// Standalone prototype package (NOT a pnpm workspace member).
// - three is pinned to 0.186.1 here: ultra-text needs r186 (unpackUnorm4x8).
// - makio-meshline/src has its own node_modules/three (r185) and
//   ultra-msdf-threejs has r187dev: `dedupe` forces every importer onto
//   showcase/node_modules/three so only ONE three instance is loaded.
const here = import.meta.dirname
const repo = path.resolve( here, '..' )
const ultra = path.resolve( repo, '../ultra-msdf-threejs' )

export default defineConfig( {
	root: here,
	publicDir: path.resolve( repo, 'demo/public' ),
	resolve: {
		dedupe: ['three', '@chenglou/pretext'],
		alias: [
			// Exact matches first so the bare 'makio-meshline' alias never swallows subpaths.
			{ find: /^makio-meshline\/gpu-path$/, replacement: path.resolve( repo, 'src/MeshLineGPUPath.js' ) },
			{ find: /^makio-meshline\/gpu-culling$/, replacement: path.resolve( repo, 'src/MeshLineCullingSystem.js' ) },
			{ find: /^makio-meshline$/, replacement: path.resolve( repo, 'src/index.js' ) },
			{ find: /^ultra-text$/, replacement: path.resolve( ultra, 'dist/index.js' ) },
			// Read-only access to the demo sources (pure modules only, e.g. @demo/makio/tsl/easing.js).
			{ find: /^@demo\//, replacement: path.resolve( repo, 'demo/src' ) + '/' },
			{ find: /^@shared\//, replacement: path.resolve( here, 'shared' ) + '/' },
		],
	},
	server: {
		port: 3300,
		strictPort: true,
		host: true,
		fs: {
			allow: [repo, ultra],
		},
	},
	preview: {
		port: 3301,
		host: true,
	},
	optimizeDeps: {
		// three is pre-bundled once from showcase/node_modules.
		include: [
			'three',
			'three/webgpu',
			'three/tsl',
			'three/addons/tsl/display/BloomNode.js',
			'three/addons/loaders/GLTFLoader.js',
			'three/addons/loaders/DRACOLoader.js',
			'three/addons/utils/BufferGeometryUtils.js',
			'three-mesh-bvh',
		],
	},
	build: {
		target: 'esnext',
		outDir: path.resolve( here, 'dist' ),
		emptyOutDir: true,
		chunkSizeWarningLimit: 4000,
		rollupOptions: {
			input: {
				index: path.resolve( here, 'index.html' ),
				a: path.resolve( here, 'a.html' ),
				b: path.resolve( here, 'b.html' ),
				c: path.resolve( here, 'c.html' ),
				smoke: path.resolve( here, 'smoke.html' ),
			},
		},
	},
} )
