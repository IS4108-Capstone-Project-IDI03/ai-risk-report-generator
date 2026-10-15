import { defineConfig } from 'vitest/config'

// `npm run build` compiles the tests into dist/ too; run only the sources.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,js,jsx}'],
    fileParallelism: false,
    // Tests read the reset code from the console, so they run with no SMTP even
    // if the developer's .env has real mail settings (F-06). A real send in a
    // test would email a stranger.
    // The services' URLs point at a closed local port for the same reason: the
    // real services call paid APIs (Claude, OpenAI, Cohere, Groq), so a test that
    // forgets to mock fetch fails instead of spending money.
    env: {
      SMTP_HOST: '',
      RAG_SERVICE_URL: 'http://127.0.0.1:9',
      SPEECH_OCR_SERVICE_URL: 'http://127.0.0.1:9',
      INGESTION_SERVICE_URL: 'http://127.0.0.1:9',
    },
    // Downloads the in-memory MongoDB binary once, before test files run.
    globalSetup: ['src/test/global-setup.ts'],
  },
})
