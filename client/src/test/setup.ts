import { configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { testAuth } from './session'

// findBy*/waitFor give up after 1s by default, too short for a screen that
// renders under a full parallel run.
configure({ asyncUtilTimeout: 5000 })

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

// jsdom never matches `:focus-visible`, which is how Tooltip tells keyboard focus from the focus a
// click gives. In tests any real focus (`element.focus()`) counts as keyboard focus.
const matches = Element.prototype.matches
Element.prototype.matches = function (this: Element, selector: string) {
  return matches.call(this, selector.replace(':focus-visible', ':focus'))
} as typeof matches

afterEach(() => {
  // The screen follows the URL (F-05); jsdom keeps it between tests.
  window.history.replaceState(null, '', '/')
  testAuth.role = 'risk_engineer'
})
