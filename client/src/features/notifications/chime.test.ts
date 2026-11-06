// Tests for the sound decision (F-10 criterion 11): when a chime plays, which one, and when a
// second tab stays quiet. The audio itself is not tested; it can't be heard here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chimeFor, chimeOnce, playedElsewhere, raiseSeen, startAudioUnlock } from './chime'

const OLD = '2026-11-01T01:00:00.000Z'
const MID = '2026-11-02T01:00:00.000Z'
const NEW = '2026-11-03T01:00:00.000Z'
const newest = (newestInbox: string | null, newestBell: string | null = null) => ({
  total: 0,
  unread: 0,
  inboxTodo: 0,
  newestInbox,
  newestBell,
})
const seen = (newestInbox: string | null, newestBell: string | null = null) => ({
  newestInbox,
  newestBell,
})

describe('chimeFor', () => {
  it('stays silent on the first poll: it only sets the mark', () => {
    expect(chimeFor(null, newest(NEW, NEW))).toBeNull()
  })

  it('plays the bell sound for a newer bell item', () => {
    expect(chimeFor(seen(OLD, OLD), newest(OLD, NEW))).toBe('bell')
  })

  it('plays the Inbox sound for a newer Inbox item', () => {
    expect(chimeFor(seen(OLD, OLD), newest(NEW, OLD))).toBe('inbox')
  })

  it('plays one sound when both are new, and the Inbox wins', () => {
    expect(chimeFor(seen(OLD, OLD), newest(NEW, NEW))).toBe('inbox')
  })

  it('plays for the first item ever, when nothing was there before', () => {
    expect(chimeFor(seen(null, null), newest(NEW))).toBe('inbox')
    expect(chimeFor(seen(null, null), newest(null, NEW))).toBe('bell')
  })

  it('stays silent when the newest times are the same or fall', () => {
    expect(chimeFor(seen(MID, MID), newest(MID, MID))).toBeNull()
    expect(chimeFor(seen(MID, MID), newest(OLD, null))).toBeNull()
  })

  // Someone unticked an old item: To do rises, but nothing here is new.
  it('stays silent for an item coming back, whatever the count does', () => {
    const back = { total: 0, unread: 0, inboxTodo: 5, newestInbox: OLD, newestBell: null }
    expect(chimeFor(seen(MID), back)).toBeNull()
  })

  it('stays silent when the gateway sends no times', () => {
    expect(chimeFor(seen(OLD, OLD), { total: 1, unread: 1, inboxTodo: 1 })).toBeNull()
  })
})

describe('raiseSeen', () => {
  it('starts from the first poll', () => {
    expect(raiseSeen(null, newest(MID, null))).toEqual(seen(MID, null))
  })

  it('rises for each kind on its own and is never lowered', () => {
    expect(raiseSeen(seen(MID, MID), newest(NEW, OLD))).toEqual(seen(NEW, MID))
    expect(raiseSeen(seen(MID, MID), newest(null, null))).toEqual(seen(MID, MID))
  })

  // Ticking the newest item lowers the gateway's time; unticking it must not chime.
  it('keeps an unticked item silent after its time dropped and came back', () => {
    const afterTick = raiseSeen(seen(NEW), newest(OLD))
    expect(chimeFor(afterTick, newest(NEW))).toBeNull()
  })
})

describe('playedElsewhere', () => {
  const stored = { at: 1_000_000, newestInbox: MID, newestBell: OLD }

  it('is false when no other tab has played', () => {
    expect(playedElsewhere(null, 'inbox', newest(MID), 1_000_500)).toBe(false)
  })

  it('is true when another tab just played for this item', () => {
    expect(playedElsewhere(stored, 'inbox', newest(MID), 1_020_000)).toBe(true)
    expect(playedElsewhere(stored, 'bell', newest(OLD, OLD), 1_020_000)).toBe(true)
  })

  it('is false for a newer arrival, even right after another tab played', () => {
    expect(playedElsewhere(stored, 'inbox', newest(NEW), 1_020_000)).toBe(false)
  })

  it('is false once the other tab played long ago', () => {
    expect(playedElsewhere(stored, 'inbox', newest(MID), 1_000_000 + 5 * 60_000)).toBe(false)
  })

  // A note an older version of this page left names counts, not times.
  it('is false for a note with no times', () => {
    const old = { at: 1_000_000, inboxTodo: 3, unread: 1 }
    expect(playedElsewhere(old, 'inbox', newest(MID), 1_020_000)).toBe(false)
  })
})

describe('chimeOnce', () => {
  const KEY = 'f10-chime-played'
  // Node in CI has no localStorage (a laptop's may), so each test brings its own, empty.
  beforeEach(() => {
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  // Runs before any press: this file's first test sees the audio still locked.
  it('leaves no note while it has no audio, so a tab that can play still will', () => {
    expect(chimeOnce('inbox', newest(MID), 1_000_000)).toBe(false)
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

    it('takes no notice of its own note', () => {
      expect(chimeOnce('inbox', newest(MID), 1_000_000)).toBe(true)
      expect(chimeOnce('inbox', newest(MID), 1_020_000)).toBe(true)
    })

    it("stays quiet for another tab's note for this item, and plays for a newer one", () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ tab: 'other', at: 1_000_000, newestInbox: MID, newestBell: null }),
      )
      expect(chimeOnce('inbox', newest(MID), 1_020_000)).toBe(false)
      expect(chimeOnce('inbox', newest(NEW), 1_020_000)).toBe(true)
    })
  })
})
