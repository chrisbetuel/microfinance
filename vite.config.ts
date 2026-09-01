import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  // Where the dev proxy forwards /api/* — set VITE_API_PROXY in .env if the
  // backend isn't on :8000. (VITE_API_BASE_URL, if set, makes the app call the
  // API directly instead of through the proxy — used for non-dev deployments.)
  const apiTarget = env.VITE_API_PROXY || env.VITE_API_BASE_URL || 'http://localhost:8000'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      // Pinned so the dev URL is stable. Override with FRONTEND_PORT in .env.
      port: Number(env.FRONTEND_PORT) || 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
