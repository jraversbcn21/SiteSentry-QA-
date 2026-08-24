import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Puerto del backend; override con BACKEND_PORT si el 3001 esta ocupado
const backendTarget = `http://127.0.0.1:${process.env.BACKEND_PORT || 3001}`

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/screenshots': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
})

