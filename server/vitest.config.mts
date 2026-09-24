import { defineConfig } from 'vitest/config'

// `npm run build` compiles the tests into dist/ too; run only the sources.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,js,jsx}'],
  },
})
