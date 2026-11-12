import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig( {
	plugins: [vue()],
	publicDir: '../wind-tunnel/public',
	resolve: { dedupe: ['three'] },
} )
