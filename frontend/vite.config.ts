import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_BASE

  return {
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    server: {
      port: 5173,
      proxy: apiTarget ? {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      } : undefined,
    },
  }
})
