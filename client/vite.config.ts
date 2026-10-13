import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Which gateway (S2) the dev server forwards /api to, first match wins:
  // 1. SERVER_URL in the shell. docker-compose.yml sets it to the Docker
  //    service name for the client container (CLAUDE.md "Known pitfalls").
  // 2. SERVER_URL in client/.env.development, read by `npm run dev`: the
  //    shared EC2 backend (copy client/.env.example). The file is gitignored.
  // 3. http://localhost:4000. `npm run dev:local` runs in its own mode, so it
  //    skips .env.development and always lands here.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const serverUrl = process.env.SERVER_URL || fileEnv.SERVER_URL || 'http://localhost:4000'

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      // Mocks sign-in and resets the URL between tests (F-04, F-05).
      setupFiles: ['./src/test/setup.ts'],
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: serverUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
