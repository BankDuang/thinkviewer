import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path'

// The FastAPI engine runs on :19080. In dev we proxy /api, /ws and /static to it
// so the SPA is same-origin (no CORS, and a secure context on localhost for the
// Clipboard API). In prod, FastAPI serves the built ./dist directly on :19080.
const BACKEND = 'http://localhost:19080'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/static': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
