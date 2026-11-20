// Records a short spoken clip from the microphone and hands it on when it ends: on Stop, after a
// pause in speech, or at the cap. Shared by the chat's mic (CB-10, chat/components/VoiceInput.tsx)
// and the dictate button on an assessment's text fields (CP-27, DictateButton.tsx).
import { useCallback, useEffect, useRef, useState } from 'react'
import { asProblem, micProblem, type Problem } from '../../chat/speech'
import { GatewayError } from '../api'

// Recording ends after this much quiet once speech was heard, after this long with none, or at the cap.
const QUIET_MS = 1200
const NO_SPEECH_MS = 8000
const MAX_MS = 60_000
const LOUD = 0.02
// A clip that never rose above this has no sound in it (a muted or wrong microphone): it is not sent,
// because Whisper would invent a sentence for it.
const HEARD = 0.003

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'working'

// Calls `onQuiet` when the stream goes quiet (see above); returns a function that stops listening.
// While `paused()` the clock stands still, so a pause never counts as silence.
function watchQuiet(
  context: AudioContext,
  stream: MediaStream,
  onQuiet: () => void,
  paused: () => boolean,
  onLevel: (level: number) => void,
) {
  const analyser = context.createAnalyser()
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  let started = Date.now()
  let lastLoud = 0
  const timer = setInterval(() => {
    if (paused()) {
      started += 100
      if (lastLoud) lastLoud += 100
      return
    }
    analyser.getFloatTimeDomainData(samples)
    const level = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length)
    onLevel(level)
    const now = Date.now()
    if (level > LOUD) lastLoud = now
    const quiet = lastLoud ? now - lastLoud > QUIET_MS : now - started > NO_SPEECH_MS
    if (quiet || now - started > MAX_MS) onQuiet()
  }, 100)
  return () => {
    clearInterval(timer)
    void context.close()
  }
}

type Options = {
  // Turns the finished clip into whatever the caller needs; a GatewayError's message is shown.
  onClip: (clip: Blob) => Promise<void>
  // With no level meter only Stop ends a recording, unless this gives a time limit (hands-free).
  unmeteredLimitMs?: () => number | null
}

/** The recorder's state and controls, and the problem to show (blocked mic, no sound, a refusal). */
export function useRecorder({ onClip, unmeteredLimitMs }: Options) {
  const [state, setState] = useState<RecorderState>('idle')
  const [note, setNote] = useState<Problem | null>(null)
  // How loud the microphone is now (for the meter) and how loud it got at all (for the check).
  const [level, setLevel] = useState(0)
  const peak = useRef(0)
  // False when the browser will not run the level meter; then only Stop ends a recording.
  const [metered, setMetered] = useState(true)
  const recorder = useRef<MediaRecorder | null>(null)
  // Ends a recording still running when this goes away (its screen closed mid-sentence): the
  // meter, the recorder and the microphone stop, and nothing is transcribed.
  const release = useRef<() => void>(() => {})
  useEffect(() => {
    const leave = release
    return () => leave.current()
  }, [])

  const start = useCallback(async () => {
    setNote(null)
    const blocked = micProblem()
    if (blocked) return setNote(blocked)
    // Made here, in the click, not after the permission prompt: a browser may keep a meter made
    // later paused, and a paused meter reads zero however loud you are.
    const context = new AudioContext()
    void context.resume().catch(() => {})
    setState('starting')
    let stream: MediaStream
    try {
      // Asked for by name: some browsers leave gain control off, and a quiet microphone then
      // records almost nothing.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (error) {
      void context.close()
      setState('idle')
      return setNote(micProblem(error)!)
    }
    await context.resume().catch(() => {})
    const meter = context.state === 'running'
    setMetered(meter)
    const input = stream.getAudioTracks()[0]?.label
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, { audioBitsPerSecond: 64_000 })
    recorder.current = rec
    let stopWatching: () => void = () => void context.close()
    const limit = meter ? null : (unmeteredLimitMs?.() ?? null)
    if (meter)
      stopWatching = watchQuiet(
        context,
        stream,
        () => rec.state === 'recording' && rec.stop(),
        () => rec.state === 'paused',
        (now) => {
          peak.current = Math.max(peak.current, now)
          setLevel(now)
        },
      )
    else if (limit !== null) {
      const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), limit)
      stopWatching = () => {
        clearTimeout(timer)
        void context.close()
      }
    }
    peak.current = 0
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    release.current = () => {
      rec.onstop = null
      if (rec.state !== 'inactive') rec.stop()
      stopWatching()
      stream.getTracks().forEach((t) => t.stop())
    }
    rec.onstop = async () => {
      release.current = () => {}
      stopWatching()
      // Without this the browser keeps showing "recording" after the clip is done.
      stream.getTracks().forEach((t) => t.stop())
      if (meter && peak.current < HEARD) {
        setNote({
          problem: 'No sound from your microphone',
          fix: `${input ? `Input used: ${input}. ` : ''}Check it is not muted, or pick another input in your browser.`,
        })
        return setState('idle')
      }
      setState('working')
      try {
        await onClip(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
      } catch (error) {
        setNote(
          asProblem(
            error instanceof GatewayError ? error.message : 'Could not read the recording.',
          ),
        )
      } finally {
        setState('idle')
      }
    }
    rec.start()
    setState('recording')
  }, [onClip, unmeteredLimitMs])

  // Pause holds the recording; Resume carries on. Stop ends it and hands it on.
  const togglePause = () => {
    const rec = recorder.current
    if (!rec) return
    if (state === 'recording') {
      rec.pause()
      setState('paused')
    } else {
      rec.resume()
      setState('recording')
    }
  }
  const stop = () => recorder.current?.stop()

  return { state, note, setNote, level, metered, start, stop, togglePause }
}
