// AS-06 Architecture 5: useActivity counts engaged time only while the tab is visible and the
// person did something in the last 30 s, counts content only after it stays on screen for 1 s,
// and sends the totals with sendBeacon. Fake timers; IntersectionObserver and sendBeacon are stubs.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActivity } from './useActivity'

type Entry = Pick<IntersectionObserverEntry, 'target' | 'isIntersecting' | 'intersectionRatio'>
let observed: Element[]
let report: (entries: Entry[]) => void
const beacons: { url: string; body: string; type: string }[] = []

const setVisible = (visible: boolean) => {
  Object.defineProperty(document, 'visibilityState', {
    value: visible ? 'visible' : 'hidden',
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}
const sent = async () =>
  beacons.map(
    (b) =>
      JSON.parse(b.body).places[0] as {
        place: string
        engagedMs: number
        seen: Record<string, number>
      },
  )
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const touch = () => act(() => void window.dispatchEvent(new Event('pointerdown')))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T09:00:00Z'))
  beacons.length = 0
  observed = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (entries: Entry[]) => void) {
        report = cb
      }
      observe = (el: Element) => void observed.push(el)
      unobserve = () => undefined
      disconnect = () => undefined
      takeRecords = () => []
    },
  )
  // jsdom's Blob can't be read back synchronously, so a stand-in keeps what it was given.
  vi.stubGlobal(
    'Blob',
    class {
      parts: string[]
      type: string
      constructor(parts: string[], options: { type: string }) {
        this.parts = parts
        this.type = options.type
      }
    },
  )
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string, blob: { parts: string[]; type: string }) => {
      beacons.push({ url, body: blob.parts.join(''), type: blob.type })
      return true
    },
  })
  setVisible(true)
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useActivity', () => {
  it('counts engaged time only while the tab is visible and the person is doing something', async () => {
    const { unmount } = renderHook(() => useActivity('RPT-1', 'tab:checklist'))
    // Looking at it without touching anything is not engagement.
    await advance(3_000)
    await touch()
    await advance(4_000)
    // Hiding the tab sends what was counted and starts again from nothing.
    act(() => setVisible(false))
    await advance(10_000)
    await touch()
    await advance(5_000)
    act(() => setVisible(true))
    await touch()
    await advance(2_000)
    unmount()

    expect(beacons.map((b) => b.url)).toEqual([
      '/api/assessments/RPT-1/assistant/activity',
      '/api/assessments/RPT-1/assistant/activity',
    ])
    expect(beacons.every((b) => b.type === 'application/json')).toBe(true)
    const [before, after] = await sent()
    expect(before).toEqual({ place: 'tab:checklist', engagedMs: 4_000, seen: {} })
    expect(after.engagedMs).toBe(2_000)
  })

  it('stops counting 30 s after the last thing the person did', async () => {
    const { unmount } = renderHook(() => useActivity('RPT-1', 'review'))
    await touch()
    await advance(60_000)
    unmount()
    expect((await sent())[0].engagedMs).toBe(30_000)
  })

  it('counts content as seen only after 1 s with at least half of it on screen', async () => {
    document.body.innerHTML =
      '<p data-activity-key="item-1"></p><p data-activity-key="item-2"></p><p data-activity-key="item-3"></p>'
    const [one, two, three] = [...document.querySelectorAll('p')]
    const { unmount } = renderHook(() => useActivity('RPT-1', 'checklist', true, true))
    expect(observed).toHaveLength(3)

    act(() =>
      report([
        { target: one, isIntersecting: true, intersectionRatio: 0.8 },
        { target: two, isIntersecting: true, intersectionRatio: 0.8 },
        { target: three, isIntersecting: true, intersectionRatio: 0.3 },
      ]),
    )
    await advance(600)
    // The second leaves the screen before a full second.
    act(() => report([{ target: two, isIntersecting: false, intersectionRatio: 0 }]))
    await advance(600)
    unmount()

    expect((await sent())[0].seen).toEqual({ 'item-1': 1_200 })
  })

  it('does nothing for someone who is not the assigned engineer', async () => {
    const { unmount } = renderHook(() => useActivity('RPT-1', 'review', false))
    await touch()
    await advance(5_000)
    unmount()
    expect(beacons).toHaveLength(0)
  })
})
