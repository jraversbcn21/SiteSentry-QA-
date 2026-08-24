import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // '' = cargar todas las vars de frontend/.env, no solo las VITE_*
  const env = { ...loadEnv(mode, __dirname, ''), ...process.env }
  // Puerto del backend; override con BACKEND_PORT si el 3001 esta ocupado
  const backendTarget = `http://127.0.0.1:${env.BACKEND_PORT || 3001}`

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: Number(env.FRONTEND_PORT) || 5173,
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
  }
})

