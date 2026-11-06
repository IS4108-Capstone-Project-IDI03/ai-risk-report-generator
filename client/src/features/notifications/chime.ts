// The Inbox's and the bell's sounds (F-10): when to play one, which, and how it is made.
// Called by NotificationCountsContext.tsx after each count poll. No sound files: Web Audio
// makes both tones in code, with the values of the approved prototype (spec "Sound").

// `newestInbox` and `newestBell` are ISO times from the count route: when the newest Inbox and
// bell items addressed to this person arrived, in any state. The gateway always sends them;
// they're optional so a screen test's fake counts can leave them out.
export type Counts = {
  total: number
  unread: number
  inboxTodo: number
  newestInbox?: string | null
  newestBell?: string | null
}
export type Chime = 'inbox' | 'bell'
// The latest time seen for each kind: this person's high-water mark, which never goes down.
export type Seen = { newestInbox: string | null; newestBell: string | null }

// Compared as text, which works because the gateway always writes the same ISO format.
const isNewer = (time: string | null | undefined, than: string | null) =>
  !!time && (!than || time > than)

/**
 * Returns which sound a poll earns, or null. Only an item newer than anything seen plays: one
 * coming back through an untick has an old time, so it stays silent though the count rises. The
 * first poll (`seen` null) only sets the mark, so loading the page is quiet. When both kinds are
 * new, one sound plays and the Inbox wins, since it is the one that needs a person.
 */
export function chimeFor(seen: Seen | null, next: Counts): Chime | null {
  if (!seen) return null
  if (isNewer(next.newestInbox, seen.newestInbox)) return 'inbox'
  if (isNewer(next.newestBell, seen.newestBell)) return 'bell'
  return null
}

/** Returns the marks after a poll: each kind moves up to the poll's time, and never down. */
export function raiseSeen(seen: Seen | null, next: Counts): Seen {
  const raised = (time: string | null | undefined, mark: string | null) =>
    isNewer(time, mark) ? time! : mark
  return {
    newestInbox: raised(next.newestInbox, seen?.newestInbox ?? null),
    newestBell: raised(next.newestBell, seen?.newestBell ?? null),
  }
}

// What a tab leaves in localStorage when it plays, so two open tabs don't both chime.
// `tab` says whose note it is: a tab's own note says nothing about a new arrival.
export type Played = Partial<Seen> & { tab?: string; at: number }
// This tab, for the note. Not crypto.randomUUID: it only exists on https.
const THIS_TAB = Math.random().toString(36).slice(2)
// Longer than a hidden tab's slowed poll (about a minute), so the second tab sees the note.
const SHARED_FOR_MS = 90_000
const STORAGE_KEY = 'f10-chime-played'

/**
 * Returns true when another tab already played for this item. Comparing the times too means
 * a genuinely newer arrival still plays right after another tab's chime.
 */
export function playedElsewhere(
  stored: Played | null,
  chime: Chime,
  next: Counts,
  now: number,
): boolean {
  if (!stored || stored.tab === THIS_TAB || now - stored.at > SHARED_FOR_MS) return false
  const [played, time] =
    chime === 'inbox'
      ? [stored.newestInbox, next.newestInbox]
      : [stored.newestBell, next.newestBell]
  return !!played && !isNewer(time, played)
}

// localStorage can throw (private window, blocked site data), and a missing note only
// means two tabs might both chime, so every access is wrapped.
function readPlayed(): Played | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Played | null
  } catch {
    return null
  }
}
function writePlayed(next: Counts, now: number) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tab: THIS_TAB,
        at: now,
        newestInbox: next.newestInbox,
        newestBell: next.newestBell,
      }),
    )
  } catch {
    // Quiet: see above.
  }
}

/** Plays the sound for `chime` unless another tab already did; returns whether it played. */
export function chimeOnce(chime: Chime, next: Counts, now = Date.now()): boolean {
  // Without this, a tab never pressed would write "played" and stay silent, and silence the
  // tab that can play as well.
  if (!audio || audio.state === 'closed') return false
  if (playedElsewhere(readPlayed(), chime, next, now)) return false
  writePlayed(next, now)
  play(chime)
  return true
}

// Browsers only allow sound after a press in the page, so the context is made lazily and
// resumed on the first press anywhere (startAudioUnlock). Before that, a chime is skipped.
let audio: AudioContext | null = null

/** Listens for the first press or key anywhere and wakes the audio context; call once. */
export function startAudioUnlock(): () => void {
  const unlock = () => {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audio ??= new Ctx()
    void audio.resume()
    stop()
  }
  const stop = () => {
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
  return stop
}

// One sine tone that rises in 4 ms to `level` and fades to silence over `fade` seconds.
function tone(ctx: AudioContext, freq: number, level: number, fade: number, delay: number) {
  const at = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(level, at + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + fade)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(at)
  osc.stop(at + fade + 0.02)
}

// Soft handbell: a real bell is several unrelated pitches ringing together, each fading at
// its own speed. [pitch ratio, loudness, seconds to fade], on a 1047 Hz base at level 0.08.
const BELL_PARTS: [number, number, number][] = [
  [1, 1, 1.3],
  [2, 0.35, 0.9],
  [2.76, 0.2, 0.6],
  [5.4, 0.06, 0.25],
]

function play(chime: Chime) {
  if (!audio) return
  void audio.resume()
  if (chime === 'bell') {
    for (const [ratio, loud, fade] of BELL_PARTS) tone(audio, 1047 * ratio, 0.08 * loud, fade, 0)
    return
  }
  // Two notes up, 110 ms apart: 1047 Hz then 1568 Hz at level 0.18, fading over 0.3 s.
  ;[1047, 1568].forEach((freq, i) => tone(audio!, freq, 0.18, 0.3, i * 0.11))
}
