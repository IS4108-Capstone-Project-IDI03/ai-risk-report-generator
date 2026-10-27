import { readdirSync, readFileSync } from 'fs'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// CB-02: copies pdf.js's WebAssembly decoders into the build at /pdfjs-wasm/, under their own
// names because pdf.js asks for them by name. Must match wasmUrl in
// src/features/chat/components/PdfViewer.tsx. Without them an image-only PDF page is drawn blank.
const pdfjsWasm = (): Plugin => ({
  name: 'pdfjs-wasm',
  apply: 'build',
  generateBundle() {
    const dir = 'node_modules/pdfjs-dist/wasm'
    for (const name of readdirSync(dir))
      this.emitFile({
        type: 'asset',
        fileName: `pdfjs-wasm/${name}`,
        source: readFileSync(`${dir}/${name}`),
      })
  },
})

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
    plugins: [react(), pdfjsWasm()],
    resolve: {
      alias: [
        // CB-02: react-pdf imports pdf.js's modern build, which needs Chrome 145+
        // (Map.getOrInsertComputed). The legacy build carries polyfills; without
        // this, opening the PDF tab on an older browser blanks the app.
        // Must match the worker file in src/features/chat/components/PassagePdf.tsx.
        { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      ],
    },
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
