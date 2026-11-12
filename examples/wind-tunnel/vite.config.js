import { defineConfig } from 'vite'

export default defineConfig( {
	base: './',
	resolve: { dedupe: ['three'] },
	build: { target: 'esnext' },
} )
