// The one player behind All Recordings (CP-12): one recording plays at a time,
// a site walk clip only its own part of the walk, with a seek bar and a speed
// that stays as chosen from one recording to the next. Used by
// components/RecordingTable.tsx, which renders the hidden <audio> it drives.
import { useRef, useState } from 'react'

export type Clip = { start: number; end: number } | null
export const SPEEDS = [1, 1.5, 2] as const
export type Speed = (typeof SPEEDS)[number]

// The recording playing or paused: where it is and how long it is, both in
// seconds of the recording (a clip's own 0:00 is its start in the walk).
// `length` is null when the browser cannot tell.
export type Playing = { key: string; playing: boolean; at: number; length: number | null }

// Resolves once the browser knows the file's length, or false if it fails to load.
function metadata(el: HTMLAudioElement): Promise<boolean> {
  if (el.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(true)
  return new Promise((resolve) => {
    const settle = (ok: boolean) => () => {
      el.removeEventListener('loadedmetadata', loaded)
      el.removeEventListener('error', failed)
      resolve(ok)
    }
    const loaded = settle(true)
    const failed = settle(false)
    el.addEventListener('loadedmetadata', loaded)
    el.addEventListener('error', failed)
  })
}

// A recording made in the browser (webm from MediaRecorder) has no length in
// its header, so the browser says Infinity until it has read to the end.
// Seeking far past the end makes it work the length out; then back to 0:00.
function knownLength(el: HTMLAudioElement): Promise<number | null> {
  if (Number.isFinite(el.duration)) return Promise.resolve(el.duration)
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('durationchange', check)
      clearTimeout(timer)
      el.currentTime = 0
      resolve(Number.isFinite(el.duration) ? el.duration : null)
    }
    const check = () => {
      if (Number.isFinite(el.duration)) done()
    }
    const timer = setTimeout(done, 3000)
    el.addEventListener('durationchange', check)
    el.currentTime = 1e7
  })
}

export function useRecordingPlayer() {
  const audio = useRef<HTMLAudioElement>(null)
  const [now, setNow] = useState<Playing | null>(null)
  const [speed, setSpeed] = useState<Speed>(1)
  // Kept beside the state so the audio's events read them as they are now.
  const active = useRef<{ key: string; clip: Clip; length: number | null } | null>(null)
  // The latest tap: one still loading gives way to a newer one.
  const turn = useRef(0)
  // While the length is being worked out the file jumps to its end; its
  // events then mean nothing.
  const measuring = useRef(false)

  const startOf = () => active.current?.clip?.start ?? 0
  const finish = () => {
    active.current = null
    setNow(null)
  }

  async function toggle(key: string, url: string, clip: Clip) {
    const el = audio.current
    if (!el) return
    if (active.current?.key === key) {
      if (el.paused) void el.play()
      else el.pause()
      return
    }
    const mine = ++turn.current
    el.pause()
    const length = clip ? clip.end - clip.start : null
    active.current = { key, clip, length }
    setNow({ key, playing: false, at: 0, length })
    // The clip's bounds are kept here, not left to the url's media fragment,
    // so seeking back and forth stays inside the clip.
    el.src = url.split('#')[0]
    if (!(await metadata(el))) {
      if (mine === turn.current) finish()
      return
    }
    if (mine !== turn.current) return
    if (!clip) {
      measuring.current = true
      const found = await knownLength(el)
      measuring.current = false
      if (mine !== turn.current) return
      active.current = { key, clip, length: found }
      setNow((n) => (n?.key === key ? { ...n, length: found } : n))
    }
    el.currentTime = startOf()
    // A new source puts the speed back to the default one.
    el.defaultPlaybackRate = speed
    el.playbackRate = speed
    void el.play()
  }

  // Moves to a point in the recording, in its own seconds.
  function seek(to: number) {
    const el = audio.current
    const length = active.current?.length
    if (!el || length == null) return
    const at = Math.min(Math.max(to, 0), length)
    el.currentTime = startOf() + at
    setNow((n) => n && { ...n, at })
  }

  // 1×, 1.5×, 2×, then back to 1×.
  function nextSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    setSpeed(next)
    const el = audio.current
    if (el) {
      el.defaultPlaybackRate = next
      el.playbackRate = next
    }
  }

  // Props for the hidden <audio> the table renders once.
  const audioProps = {
    ref: audio,
    preload: 'metadata',
    onPlay: () => setNow((n) => n && { ...n, playing: true }),
    onPause: () => {
      if (!measuring.current) setNow((n) => n && { ...n, playing: false })
    },
    onTimeUpdate: () => {
      const el = audio.current
      const clip = active.current?.clip
      if (!el || !active.current || measuring.current) return
      // A clip stops at its end, as the walk goes on past it.
      if (clip && el.currentTime >= clip.end) {
        el.pause()
        finish()
        return
      }
      const at = Math.max(0, el.currentTime - startOf())
      setNow((n) => n && { ...n, at })
    },
    onEnded: () => {
      if (!measuring.current) finish()
    },
  } as const

  return { now, speed, toggle, seek, nextSpeed, audioProps }
}
