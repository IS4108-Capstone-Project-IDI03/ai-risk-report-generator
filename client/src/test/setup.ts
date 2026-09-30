import { afterEach, vi } from 'vitest'
import { testAuth } from './session'

// Every test signs in without a gateway: the auth calls answer with the
// session in session.ts, and no session exists until the form is submitted.
// Tests of the real calls use vi.importActual.
vi.mock('../features/auth/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/auth/api')>()
  const { SESSIONS, testAuth } = await import('./session')
  return {
    ...actual,
    currentSession: vi.fn(async () => null),
    signIn: vi.fn(async () => SESSIONS[testAuth.role]),
    signOut: vi.fn(async () => undefined),
  }
})

afterEach(() => {
  // The screen follows the URL (F-05); jsdom keeps it between tests.
  window.history.replaceState(null, '', '/')
  testAuth.role = 'risk_engineer'
})
