// The microphone button beside the chat box (CB-10). Records a question, turns it into text
// (gateway /api/chat/transcribe) and puts it in the box for checking. In hands-free mode it
// sends the question itself, then listens again once the answer has been read.
// Drawn inside AgentInterface (screens/KnowledgeAssistant.tsx), where OpenUI's chat state lives.
import { useThread } from '@openuidev/react-headless'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IconButton, Switch } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { transcribeQuestion } from '../api'
import {
  answerSpoken,
  asProblem,
  handsFreeTurn,
  isStopWord,
  micProblem,
  useVoiceSettings,
  type Problem,
} from '../speech'

// The chat's own box, not the edit box inside a sent question.
const BOX = '.knowledge-assistant .openui-agent-thread-composer textarea'
const COMPOSER = '.knowledge-assistant .openui-agent-thread-composer'
const CARD = `${COMPOSER}__input-wrapper`
// Recording ends after this much quiet once speech was heard, after this long with none, or at the cap.
const QUIET_MS = 1200
const NO_SPEECH_MS = 8000
const MAX_MS = 60_000
const LOUD = 0.02
// A clip that never rose above this has no sound in it (a muted or wrong microphone): it is not sent,
// because Whisper would invent a sentence for it.
const HEARD = 0.003

// Calls `onQuiet` when the stream goes quiet (see above); returns a function that stops listening.
// While `paused()` the clock stands still, so a pause never counts as silence.
function watchQuiet(
  stream: MediaStream,
  onQuiet: () => void,
  paused: () => boolean,
  onLevel: (level: number) => void,
) {
  const context = new AudioContext()
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

// Puts text in the chat box the way typing would, so OpenUI's own state sees it.
function fillBox(text: string) {
  const box = document.querySelector<HTMLTextAreaElement>(BOX)
  if (!box) return
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, text)
  box.dispatchEvent(new Event('input', { bubbles: true }))
  box.focus()
}

/** Mic button drawn in the chat box; shows its problem (blocked mic, no speech) under it. */
export function VoiceInput() {
  const processMessage = useThread((s) => s.processMessage)
  const [settings, change] = useVoiceSettings()
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'working'>('idle')
  const [note, setNote] = useState<Problem | null>(null)
  const [cog, setCog] = useState(false)
  // How loud the microphone is now (for the meter) and how loud it got at all (for the check).
  const [level, setLevel] = useState(0)
  const peak = useRef(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const [host, setHost] = useState<Element | null>(null)
  const [card, setCard] = useState<Element | null>(null)
  useEffect(() => {
    // The box is drawn by OpenUI after this component; look again whenever the page changes.
    const find = () => {
      setHost(document.querySelector(COMPOSER))
      setCard(document.querySelector(CARD))
    }
    find()
    const watch = new MutationObserver(find)
    watch.observe(document.body, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [])

  // Read when the recording ends, not when it began, so a switch flipped mid-recording counts.
  const handsFree = useRef(settings.handsFree)
  useEffect(() => {
    handsFree.current = settings.handsFree
  }, [settings.handsFree])
  const deliver = useCallback(
    (text: string) => {
      if (!handsFree.current) return fillBox(text)
      // Saying "stop" leaves hands-free mode without asking anything.
      if (isStopWord(text)) return change({ handsFree: false })
      handsFreeTurn.waiting = true
      void processMessage({ role: 'user', content: text })
    },
    [change, processMessage],
  )

  const start = useCallback(async () => {
    setNote(null)
    const blocked = micProblem()
    if (blocked) return setNote(blocked)
    let stream: MediaStream
    try {
      // Asked for by name: some browsers leave gain control off, and a quiet microphone then
      // records almost nothing.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (error) {
      return setNote(micProblem(error)!)
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, { audioBitsPerSecond: 64_000 })
    recorder.current = rec
    const stopWatching = watchQuiet(
      stream,
      () => rec.state === 'recording' && rec.stop(),
      () => rec.state === 'paused',
      (now) => {
        peak.current = Math.max(peak.current, now)
        setLevel(now)
      },
    )
    peak.current = 0
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = async () => {
      stopWatching()
      // Without this the browser keeps showing "recording" after the question is done.
      stream.getTracks().forEach((t) => t.stop())
      if (peak.current < HEARD) {
        setNote({
          problem: 'No sound from your microphone',
          fix: 'Check it is not muted, or pick another input in your browser.',
        })
        return setState('idle')
      }
      setState('working')
      try {
        deliver(await transcribeQuestion(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })))
      } catch (error) {
        setNote(
          asProblem(error instanceof GatewayError ? error.message : 'Could not read the recording.'),
        )
      } finally {
        setState('idle')
      }
    }
    rec.start()
    setState('recording')
  }, [deliver])

  // Hands-free: listen again once the answer has been read.
  useEffect(() => {
    const again = () => settings.handsFree && state === 'idle' && void start()
    answerSpoken.addEventListener('done', again)
    return () => answerSpoken.removeEventListener('done', again)
  }, [settings.handsFree, state, start])

  // Pause holds the recording; Resume carries on. Stop ends it and turns it into text.
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
  // While recording the mic becomes Pause and Stop, as in Claude; what it is doing, or what went
  // wrong, shows under the box.
  const live = state === 'recording' || state === 'paused'
  const button = (
    <div className="voice-input">
      {live ? (
        <>
          <IconButton
            icon={state === 'paused' ? 'play' : 'pause'}
            label={state === 'paused' ? 'Resume recording' : 'Pause recording'}
            onClick={togglePause}
          />
          <IconButton icon="square" label="Stop recording" onClick={() => recorder.current?.stop()} />
          <IconButton
            icon="settings"
            label="Hands-free settings"
            selected={cog}
            onClick={() => setCog((open) => !open)}
          />
        </>
      ) : (
        <IconButton
          icon="mic"
          label="Ask by voice"
          disabled={state === 'working'}
          onClick={() => void start()}
        />
      )}
    </div>
  )
  // Errors follow design system v2: a red icon and short problem, then the fix in grey.
  const message = cog && live ? (
    <div className="voice-input__panel">
      <Switch
        label="Hands-free: read answers and listen again"
        checked={settings.handsFree}
        onChange={(on) => change({ handsFree: on })}
      />
    </div>
  ) : note ? (
      <p className="voice-input__note" role="alert">
        <Icon name="circle-alert" size={16} />
        <strong>{note.problem}</strong>
        {note.fix && <span>{note.fix}</span>}
      </p>
    ) : (
      state !== 'idle' && (
        <p className="voice-input__state" role="status">
          {state === 'recording'
            ? 'Listening… stop talking to send'
            : state === 'paused'
              ? 'Paused'
              : 'Reading your question…'}
          {live && (
            // Shows the engineer at once whether the microphone is hearing them.
            <span
              className="voice-input__meter"
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={Math.min(level * 4, 1)}
            >
              <i style={{ transform: `scaleX(${Math.min(level * 4, 1)})` }} />
            </span>
          )}
        </p>
      )
    )
  return (
    <>
      {card && createPortal(button, card)}
      {host && message && createPortal(message, host)}
    </>
  )
}
