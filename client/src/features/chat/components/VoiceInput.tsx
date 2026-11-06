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
import { COMPOSER_BOX, useComposerHosts } from './useComposerHosts'

// Recording ends after this much quiet once speech was heard, after this long with none, or at the cap.
const QUIET_MS = 1200
const NO_SPEECH_MS = 8000
const MAX_MS = 60_000
const LOUD = 0.02
// A clip that never rose above this has no sound in it (a muted or wrong microphone): it is not sent,
// because Whisper would invent a sentence for it.
const HEARD = 0.003
// With no level meter, a hands-free question is cut off after this long.
const UNMETERED_MS = 15_000

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

// Puts text in the chat box the way typing would, so OpenUI's own state sees it.
function fillBox(text: string) {
  const box = document.querySelector<HTMLTextAreaElement>(COMPOSER_BOX)
  if (!box) return
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, text)
  box.dispatchEvent(new Event('input', { bubbles: true }))
  box.focus()
}

/** Mic button drawn in the chat box; shows its problem (blocked mic, no speech) under it. */
export function VoiceInput() {
  const processMessage = useThread((s) => s.processMessage)
  const [settings, change] = useVoiceSettings()
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'working'>(
    'idle',
  )
  const [note, setNote] = useState<Problem | null>(null)
  // Where a hands-free turn is after the question is sent: waiting for the answer, or hearing it.
  const [after, setAfter] = useState<'asking' | 'speaking' | null>(null)
  // How loud the microphone is now (for the meter) and how loud it got at all (for the check).
  const [level, setLevel] = useState(0)
  const peak = useRef(0)
  // False when the browser will not run the level meter; then only Stop ends a recording.
  const [metered, setMetered] = useState(true)
  const recorder = useRef<MediaRecorder | null>(null)
  const { card, below: host } = useComposerHosts()

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
      setAfter('asking')
      void processMessage({ role: 'user', content: text })
    },
    [change, processMessage],
  )

  const start = useCallback(async () => {
    setNote(null)
    setAfter(null)
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
    else if (handsFree.current) {
      // Hands-free has no one to press Stop, so without a meter it ends after a fixed time.
      const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), UNMETERED_MS)
      stopWatching = () => {
        clearTimeout(timer)
        void context.close()
      }
    }
    peak.current = 0
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = async () => {
      stopWatching()
      // Without this the browser keeps showing "recording" after the question is done.
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
        deliver(await transcribeQuestion(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })))
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
  }, [deliver])

  // Hands-free: listen again once the answer has been read.
  useEffect(() => {
    const again = () => {
      setAfter(null)
      if (settings.handsFree && state === 'idle') void start()
    }
    const speaking = () => setAfter('speaking')
    answerSpoken.addEventListener('done', again)
    answerSpoken.addEventListener('start', speaking)
    return () => {
      answerSpoken.removeEventListener('done', again)
      answerSpoken.removeEventListener('start', speaking)
    }
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
          <IconButton
            icon="square"
            label="Stop recording"
            onClick={() => recorder.current?.stop()}
          />
        </>
      ) : (
        <IconButton
          icon="mic"
          label="Ask by voice"
          disabled={state === 'working' || state === 'starting'}
          onClick={() => void start()}
        />
      )}
    </div>
  )
  // Errors follow design system v2: a red icon and short problem, then the fix in grey.
  const step =
    state === 'starting'
      ? 'Waiting for the microphone…'
      : state === 'recording'
        ? metered
          ? 'Listening… stop talking to send'
          : 'Listening… press Stop when you finish'
        : state === 'paused'
          ? 'Paused'
          : state === 'working'
            ? 'Reading your question…'
            : after === 'asking'
              ? 'Searching the knowledge base…'
              : after === 'speaking'
                ? 'Reading the answer. The mic opens again when it ends.'
                : ''
  // Hands-free is always one switch away, with a line saying what it does or what it is doing.
  const hint = settings.handsFree
    ? 'Tap the mic and ask. Your question is sent, the answer is read aloud, then I listen again. Say “stop” to end.'
    : 'Off: you check each question before it is sent.'
  const message = (
    <>
      {note && (
        <p className="voice-input__note" role="alert">
          <Icon name="circle-alert" size={16} />
          <strong>{note.problem}</strong>
          {note.fix && <span>{note.fix}</span>}
        </p>
      )}
      <div className="voice-input__panel">
        <Switch
          label="Hands-free"
          checked={settings.handsFree}
          onChange={(on) => change({ handsFree: on })}
        />
        <p className="voice-input__state" role="status">
          {step || hint}
          {live && metered && (
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
      </div>
    </>
  )
  return (
    <>
      {card && createPortal(button, card)}
      {host && createPortal(message, host)}
    </>
  )
}
