// F-07 AC2: the browser returns to the sign-in screen after 15 idle minutes.
// Uses fake timers; the gateway is unreachable, as in access.test.tsx.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signOut } from './api'
import { signIn } from '../../test/session'

const MINUTE = 60_000

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.mocked(signOut).mockClear()
})

// The clock is fake before sign-in, so the idle timer starts on it.
// shouldAdvanceTime lets the sign-in form's waitFor keep polling.
async function signedIn() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  render(<App />)
  await signIn()
  // Let React run the new screen's effects, which start the idle timer.
  await act(async () => {})
}
const idleFor = (minutes: number) => act(() => void vi.advanceTimersByTime(minutes * MINUTE))
const signInHeading = () => screen.queryByRole('heading', { name: 'Sign in' })

describe('Idle timeout (F-07 AC2)', () => {
  it('shows the sign-in screen after 15 idle minutes and ends the session', async () => {
    await signedIn()
    idleFor(14)
    expect(signInHeading()).toBeNull()
    idleFor(1)
    expect(signInHeading()).toBeInTheDocument()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('restarts the 15 minutes when the user is active', async () => {
    await signedIn()
    idleFor(14)
    fireEvent.keyDown(document, { key: 'a' })
    idleFor(14)
    expect(signInHeading()).toBeNull()
    idleFor(1)
    expect(signInHeading()).toBeInTheDocument()
  })

  it('stops counting once signed out', async () => {
    await signedIn()
    idleFor(15)
    expect(signOut).toHaveBeenCalledTimes(1)
    idleFor(30)
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
