import { defineConfig } from 'vitest/config'

// `npm run build` compiles the tests into dist/ too; run only the sources.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,js,jsx}'],
    fileParallelism: false,
    // Tests read the reset code from the console, so they run with no SMTP even
    // if the developer's .env has real mail settings (F-06). A real send in a
    // test would email a stranger.
    env: { SMTP_HOST: '' },
    // Downloads the in-memory MongoDB binary once, before test files run.
    globalSetup: ['src/test/global-setup.ts'],
  },
})
