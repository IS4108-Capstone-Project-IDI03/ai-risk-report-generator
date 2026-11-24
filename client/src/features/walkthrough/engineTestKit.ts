// Shared set-up for the engine tests (F-12, test seam 3): a stubbed gateway, fake time and small
// helpers. Imported only by engine.*.test.tsx; each test file still mocks the registry and toasts
// itself (vi.mock is per file).
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { TEST_DEFS } from './testDefinitions'
import { layOut } from './testKit'

// What the stubbed gateway answers, set per test: its saves land in `patches`.
export const net = {
  patches: [] as unknown[],
  checkOk: true,
  saveFails: false,
  practiceFails: false,
}

export const PRACTICE_PLACE = '/assessment?ref=PRACTICE-0001&tab=observations'

// Fake time for every test (timers, animation frames and performance.now), so a 4 s settle or a
// 90 s limit takes no real time. wait() moves the clock on and lets promises settle between timers.
const FAKE = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'performance',
  'Date',
] as const

/** Registers the gateway stub, fake time and clean-up around every test in the calling file. */
export function setUpEngineTests() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [...FAKE] })
    vi.clearAllMocks()
    net.patches = []
    net.checkOk = true
    net.saveFails = false
    net.practiceFails = false
    layOut()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/walkthroughs/check'))
          return Response.json({ ok: net.checkOk })
        if (String(url) === '/api/walkthroughs/practice')
          return net.practiceFails
            ? new Response('{}', { status: 503 })
            : Response.json({ reference: 'PRACTICE-0001' })
        if (init?.method === 'PATCH') {
          net.patches.push(JSON.parse(String(init.body)).walkthroughs)
          return net.saveFails ? new Response('{}', { status: 500 }) : Response.json({})
        }
        return Response.json({})
      }),
    )
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
}

/** Moves fake time on by `ms`, letting React and promises settle; returns when done. */
export const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
/** Presses the button with that accessible name; returns nothing. */
export const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
/** Returns the step bar's words ("Step 1 of 3"), if a bar shows. */
export const bar = () => screen.queryByText(/^Step \d+ of \d+$/)?.textContent
/** Returns the text without its **bold** marks, as it shows on screen. */
export const plain = (text: string) => text.replaceAll('**', '')
// The Clients test walkthrough's offer, first paragraph.
export const offerText = TEST_DEFS[1].offer!.split('\n\n')[0]
