import { defineConfig } from 'vitest/config'

// `npm run build` compiles the tests into dist/ too; run only the sources.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,js,jsx}'],
    fileParallelism: false,
    // Tests read the reset and invitation codes from the console, so they run
    // with no SMTP even if the developer's .env has real mail settings (F-06,
    // F-08). A real send in a test would email a stranger.
    // The services' URLs point at a closed local port for the same reason: the
    // real services call paid APIs (Claude, OpenAI, Cohere, Groq), so a test that
    // forgets to mock fetch fails instead of spending money.
    // The Cohere key tier is cleared so pricing tests see the default (trial),
    // whatever key the developer's .env names.
    env: {
      SMTP_HOST: '',
      COHERE_KEY_TIER: '',
      RAG_SERVICE_URL: 'http://127.0.0.1:9',
      SPEECH_OCR_SERVICE_URL: 'http://127.0.0.1:9',
      INGESTION_SERVICE_URL: 'http://127.0.0.1:9',
    },
    // Downloads the in-memory MongoDB binary once, before test files run.
    globalSetup: ['src/test/global-setup.ts'],
  },
})
