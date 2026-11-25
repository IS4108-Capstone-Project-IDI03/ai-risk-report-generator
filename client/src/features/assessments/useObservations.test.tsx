// Tests for the Observations list's refresh (CP-24): it reloads when the gateway pushes an
// `observations` event, and polls only while something is transcribing, never for a suggestion.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedObservation } from './api'
import { useObservations } from './useObservations'

type Listener = () => void
class FakeSource {
  static all: FakeSource[] = []
  listeners: Record<string, Listener[]> = {}
  url: string
  constructor(url: string) {
    this.url = url
    FakeSource.all.push(this)
  }
  addEventListener(name: string, fn: Listener) {
    ;(this.listeners[name] ??= []).push(fn)
  }
  close() {}
  emit(name: string) {
    for (const fn of this.listeners[name] ?? []) fn()
  }
}

const saved = (over: Partial<SavedObservation> = {}) =>
  ({
    id: 'o1',
    recordings: [],
    photos: [],
    pages: [],
    deleted: null,
    interpretation: null,
    suggestion: null,
    toCheck: false,
    ...over,
  }) as unknown as SavedObservation

let reads = 0
let next: SavedObservation[] = []
beforeEach(() => {
  reads = 0
  next = [saved()]
  FakeSource.all = []
  vi.stubGlobal('EventSource', FakeSource)
  vi.stubGlobal('fetch', () => {
    reads++
    return Promise.resolve(new Response(JSON.stringify(next), { status: 200 }))
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useObservations push (CP-24)', () => {
  it('reloads when an observations event arrives', async () => {
    renderHook(() => useObservations('RPT-1', true))
    await waitFor(() => expect(reads).toBe(1))
    expect(FakeSource.all[0].url).toBe('/api/assessments/RPT-1/assistant/events')

    next = [saved({ toCheck: true })]
    act(() => FakeSource.all[0].emit('observations'))
    await waitFor(() => expect(reads).toBe(2))
  })

  it('reloads when the stream first connects, for a reading that finished between the list and the stream', async () => {
    renderHook(() => useObservations('RPT-1', true))
    await waitFor(() => expect(reads).toBe(1))

    // No push was sent for that change: only the connection itself says to read again.
    next = [saved({ toCheck: true })]
    act(() => FakeSource.all[0].emit('open'))
    await waitFor(() => expect(reads).toBe(2))
  })

  it('opens no stream while the tab is not open', () => {
    renderHook(() => useObservations('RPT-1', false))
    expect(FakeSource.all).toHaveLength(0)
  })

  it('does not poll while a suggestion is being read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    next = [
      saved({ suggestion: { status: 'reading', error: null, category: null, severity: null } }),
    ]
    renderHook(() => useObservations('RPT-1', true))
    await waitFor(() => expect(reads).toBe(1))
    await act(async () => void vi.advanceTimersByTime(10_000))
    expect(reads).toBe(1)
  })

  it('still polls while a recording is transcribing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    next = [
      saved({
        recordings: [
          { transcription: { status: 'transcribing' } },
        ] as unknown as SavedObservation['recordings'],
      }),
    ]
    renderHook(() => useObservations('RPT-1', true))
    await waitFor(() => expect(reads).toBe(1))
    await act(async () => void vi.advanceTimersByTime(3100))
    await waitFor(() => expect(reads).toBeGreaterThan(1))
  })
})
