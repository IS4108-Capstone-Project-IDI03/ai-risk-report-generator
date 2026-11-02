// The recording state of a site walk (CP-22 AC2, AC3): start, pause, resume,
// save, the 20-minute cap (a warning tone at 19:00, a second at 20:00) and a
// track that ends by itself (phone locked). Used by the Recording screen; media comes from recorder.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CAP_SEC, WARN_SEC, keepAwake, openWalkStream, playTone, recordAudio } from './recorder'

export type Phase = 'idle' | 'recording' | 'paused'
// Why recording stopped by itself: the 20-minute cap, or the microphone track ended.
export type StopNotice = 'cap' | 'ended' | null

type Active = {
  recorder: MediaRecorder
  seq: number
  base: number // seconds recorded before the last resume
  since: number | null // when it last resumed (ms), null while paused
  warned: boolean // the 19:00 tone has played
  clip: { durationSec: number } // filled in at stop, read when the clip arrives
  delivered: Promise<void> // settles once onClip has kept the clip
  release: () => void // lets the screen sleep again
}
type Stamp = { recordingSeq: number | null; offsetSec: number | null }

const seconds = (a: Active) => a.base + (a.since === null ? 0 : (Date.now() - a.since) / 1000)

// Returns the recorder's state and controls. onClip gets each finished
// recording: its seq (taken from `claimSeq`, the walk's one count), audio and length.
export function useWalkRecorder(
  claimSeq: () => number,
  onClip: (seq: number, audio: Blob, durationSec: number) => Promise<void> | void,
  // Called when the cap stopped a recording (it is kept); the screen tells the engineer.
  onCap?: () => void,
) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seq, setSeq] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [notice, setNotice] = useState<StopNotice>(null)
  // True from 19:00 until the recording stops: the screen shows the one-minute line.
  const [warning, setWarning] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const active = useRef<Active | null>(null)
  // A start waiting for the microphone, and whether a stop cancelled it.
  const starting = useRef(false)
  const cancelled = useRef(false)
  const [opening, setOpening] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const acquiring = useRef<Promise<MediaStream> | null>(null)
  // False once the screen has closed.
  const open = useRef(true)
  // The last recording made, so a photo taken between recordings still has a place.
  const last = useRef<Stamp>({ recordingSeq: null, offsetSec: null })
  const clipRef = useRef(onClip)
  const capRef = useRef(onCap)
  useEffect(() => {
    clipRef.current = onClip
    capRef.current = onCap
  }, [onClip, onCap])

  // Ends the current recording; resolves once onClip has kept its clip.
  const stop = useCallback((why: StopNotice = null): Promise<void> => {
    // Without this, a start still opening the microphone would record after Finish.
    if (starting.current) cancelled.current = true
    const a = active.current
    if (!a) return Promise.resolve()
    active.current = null
    a.clip.durationSec = Math.min(CAP_SEC, Math.round(seconds(a)))
    last.current = { recordingSeq: a.seq, offsetSec: a.clip.durationSec }
    a.release()
    setPhase('idle')
    setWarning(false)
    setElapsed(a.clip.durationSec)
    setNotice(why)
    // An ended track may already have stopped the recorder; recordAudio sends the clip once.
    if (a.recorder.state !== 'inactive') a.recorder.stop()
    else a.recorder.onstop?.(new Event('stop'))
    return a.delivered
  }, [])

  // Opens the walk's stream once, and again after its track ended.
  const ensureStream = useCallback(async () => {
    const live = streamRef.current?.getAudioTracks().some((t) => t.readyState !== 'ended')
    if (streamRef.current && live) return streamRef.current
    // Camera and Start tapped together share one request: two would leave the
    // first stream's microphone and camera on after the screen closed.
    acquiring.current ??= openWalkStream().finally(() => (acquiring.current = null))
    const s = await acquiring.current
    if (streamRef.current === s) return s
    // The screen closed while the microphone opened: without this it would stay on.
    if (!open.current) {
      s.getTracks().forEach((t) => t.stop())
      throw new Error('The site walk screen was closed.')
    }
    streamRef.current = s
    setStream(s)
    // The phone locked or the page went to the background: keep what was
    // recorded and tell the engineer (user story 10).
    s.getAudioTracks()[0]?.addEventListener('ended', () => {
      streamRef.current = null
      setStream(null)
      void stop('ended')
    })
    return s
  }, [stop])

  // Starts the next recording. Throws when the microphone can't start.
  // A second tap while the microphone opens does nothing: without this, two
  // recorders would run and only the last could be stopped.
  const start = useCallback(async () => {
    if (starting.current) return
    void stop()
    starting.current = true
    cancelled.current = false
    setOpening(true)
    let s: MediaStream
    try {
      s = await ensureStream()
    } finally {
      starting.current = false
      setOpening(false)
    }
    if (cancelled.current) return
    const thisSeq = claimSeq()
    const clip = { durationSec: 0 }
    let deliver: (kept: Promise<void> | void) => void = () => {}
    const delivered = new Promise<void>((resolve) => (deliver = resolve))
    const recorder = recordAudio(s, (audio) => {
      // A short tone confirms every saved recording, however it ended.
      playTone()
      deliver(clipRef.current(thisSeq, audio, clip.durationSec))
    })
    const a: Active = {
      recorder,
      seq: thisSeq,
      base: 0,
      since: Date.now(),
      warned: false,
      clip,
      delivered,
      release: () => {},
    }
    active.current = a
    setSeq(thisSeq)
    setElapsed(0)
    setNotice(null)
    setPhase('recording')
    const release = await keepAwake()
    if (active.current === a) a.release = release
    else release()
  }, [ensureStream, stop, claimSeq])

  const pause = useCallback(() => {
    const a = active.current
    if (!a || a.since === null) return
    a.base = seconds(a)
    a.since = null
    a.recorder.pause()
    setPhase('paused')
  }, [])

  const resume = useCallback(() => {
    const a = active.current
    if (!a || a.since !== null) return
    a.since = Date.now()
    a.recorder.resume()
    setPhase('recording')
  }, [])

  // The timer: ticks the clock, warns at 19:00 and stops the recording at the cap (AC2).
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => {
      const a = active.current
      if (!a) return
      const s = seconds(a)
      if (s >= CAP_SEC) {
        void stop('cap')
        capRef.current?.()
        return
      }
      if (s >= WARN_SEC && !a.warned) {
        a.warned = true
        playTone()
        setWarning(true)
      }
      setElapsed(s)
    }, 250)
    return () => clearInterval(id)
  }, [phase, stop])

  // Leaving the screen ends the recording (its clip is still kept) and frees the camera.
  useEffect(() => {
    open.current = true
    return () => {
      open.current = false
      void stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [stop])

  // Where a photo taken now sits in the walk: the recording running (or the
  // last one made) and the seconds into it (AC3).
  const stamp = useCallback((): Stamp => {
    const a = active.current
    return a ? { recordingSeq: a.seq, offsetSec: Math.round(seconds(a) * 10) / 10 } : last.current
  }, [])

  return {
    phase,
    opening,
    seq,
    elapsed,
    notice,
    warning,
    stream,
    start,
    pause,
    resume,
    stop,
    stamp,
    ensureStream,
  }
}
