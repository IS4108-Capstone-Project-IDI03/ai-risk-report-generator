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
    // Fake AI keys, so Settings > Models sees every model as available (S-01) and tests give
    // the same result with or without a developer's .env (CI has none). Calls are mocked anyway.
    // PII protection starts off; tests that need it on set config.piiProtection.
    env: {
      SMTP_HOST: '',
      COHERE_KEY_TIER: '',
      PII_PROTECTION: 'off',
      ANTHROPIC_API_KEY: 'test-key',
      GEMINI_API_KEY: 'test-key',
      OPENAI_API_KEY: 'test-key',
      OPENAI_CHAT_API_KEY: 'test-key',
      OPENAI_LABEL_API_KEY: 'test-key',
      TYPESAFE_API_KEY: 'test-key',
      RAG_SERVICE_URL: 'http://127.0.0.1:9',
      SPEECH_OCR_SERVICE_URL: 'http://127.0.0.1:9',
      INGESTION_SERVICE_URL: 'http://127.0.0.1:9',
      CONVERTER_SERVICE_URL: 'http://127.0.0.1:9',
      PRIVACY_SERVICE_URL: 'http://127.0.0.1:9',
    },
    // Downloads the in-memory MongoDB binary once, before test files run.
    globalSetup: ['src/test/global-setup.ts'],
    // Keeps supertest's requests on the test server, not another local app.
    setupFiles: ['src/test/supertest-loopback.ts'],
  },
})
