// Tests for the sound decision (F-10 criterion 11): when a chime plays, which one, and when a
// second tab stays quiet. The audio itself is not tested; it can't be heard here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chimeFor, chimeOnce, playedElsewhere, startAudioUnlock } from './chime'

const counts = (unread: number, inboxTodo: number) => ({ total: unread, unread, inboxTodo })

describe('chimeFor', () => {
  it('stays silent on the first poll: it only sets the baseline', () => {
    expect(chimeFor(null, counts(3, 2))).toBeNull()
  })

  it('plays the bell sound when unread rises', () => {
    expect(chimeFor(counts(1, 0), counts(2, 0))).toBe('bell')
  })

  it('plays the Inbox sound when the To do count rises', () => {
    expect(chimeFor(counts(0, 1), counts(0, 2))).toBe('inbox')
  })

  it('plays one sound when both rise, and the Inbox wins', () => {
    expect(chimeFor(counts(1, 1), counts(4, 3))).toBe('inbox')
  })

  it('stays silent when counts are the same or fall', () => {
    expect(chimeFor(counts(2, 2), counts(2, 2))).toBeNull()
    expect(chimeFor(counts(2, 2), counts(1, 0))).toBeNull()
  })
})

describe('playedElsewhere', () => {
  const stored = { at: 1_000_000, inboxTodo: 3, unread: 1 }

  it('is false when no other tab has played', () => {
    expect(playedElsewhere(null, 'inbox', counts(0, 3), 1_000_500)).toBe(false)
  })

  it('is true when another tab just played for this level', () => {
    expect(playedElsewhere(stored, 'inbox', counts(0, 3), 1_020_000)).toBe(true)
    expect(playedElsewhere(stored, 'bell', counts(1, 3), 1_020_000)).toBe(true)
  })

  it('is false for a newer arrival, even right after another tab played', () => {
    expect(playedElsewhere(stored, 'inbox', counts(0, 4), 1_020_000)).toBe(false)
  })

  it('is false once the other tab played long ago', () => {
    expect(playedElsewhere(stored, 'inbox', counts(0, 3), 1_000_000 + 5 * 60_000)).toBe(false)
  })
})

describe('chimeOnce', () => {
  const KEY = 'f10-chime-played'
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  // Runs before any press: this file's first test sees the audio still locked.
  it('leaves no note while it has no audio, so a tab that can play still will', () => {
    expect(chimeOnce('inbox', counts(0, 3), 1_000_000)).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  describe('once a press has woken the audio', () => {
    beforeEach(() => {
      const node = () => ({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: {},
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      })
      vi.stubGlobal(
        'AudioContext',
        class {
          state = 'running'
          currentTime = 0
          resume = () => Promise.resolve()
          createOscillator = node
          createGain = node
        },
      )
      const stop = startAudioUnlock()
      window.dispatchEvent(new Event('pointerdown'))
      stop()
    })

    it('plays again at the same count after a tick and an arrival, from its own note', () => {
      expect(chimeOnce('inbox', counts(0, 3), 1_000_000)).toBe(true)
      expect(chimeOnce('inbox', counts(0, 3), 1_020_000)).toBe(true)
    })

    it("stays quiet for another tab's note at this level", () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ tab: 'other', at: 1_000_000, inboxTodo: 3, unread: 0 }),
      )
      expect(chimeOnce('inbox', counts(0, 3), 1_020_000)).toBe(false)
    })
  })
})
