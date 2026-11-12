import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig( {
	plugins: [react()],
	publicDir: '../wind-tunnel/public',
	resolve: { dedupe: ['three'] },
} )
