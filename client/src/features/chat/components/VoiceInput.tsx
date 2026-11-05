// The microphone button beside the chat box (CB-10). Records a question, turns it into text
// (gateway /api/chat/transcribe) and puts it in the box for checking. In hands-free mode it
// sends the question itself, then listens again once the answer has been read.
// Drawn inside AgentInterface (screens/KnowledgeAssistant.tsx), where OpenUI's chat state lives.
import { useThread } from '@openuidev/react-headless'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { transcribeQuestion } from '../api'
import { answerSpoken, handsFreeTurn, isStopWord, micProblem, useVoiceSettings } from '../speech'

// The chat's own box, not the edit box inside a sent question.
const BOX = '.knowledge-assistant .openui-agent-thread-composer textarea'
const COMPOSER = '.knowledge-assistant .openui-agent-thread-composer'
const CARD = `${COMPOSER}__input-wrapper`
// Recording ends after this much quiet once speech was heard, after this long with none, or at the cap.
const QUIET_MS = 2000
const NO_SPEECH_MS = 8000
const MAX_MS = 60_000
const LOUD = 0.02

// Calls `onQuiet` when the stream goes quiet (see above); returns a function that stops listening.
function watchQuiet(stream: MediaStream, onQuiet: () => void) {
  const context = new AudioContext()
  const analyser = context.createAnalyser()
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const started = Date.now()
  let lastLoud = 0
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    const level = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length)
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
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle')
  const [note, setNote] = useState('')
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

  const deliver = useCallback(
    (text: string) => {
      if (!settings.handsFree) return fillBox(text)
      // Saying "stop" leaves hands-free mode without asking anything.
      if (isStopWord(text)) return change({ handsFree: false })
      handsFreeTurn.waiting = true
      void processMessage({ role: 'user', content: text })
    },
    [settings.handsFree, change, processMessage],
  )

  const start = useCallback(async () => {
    setNote('')
    if (micProblem()) return setNote(micProblem()!)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      return setNote(micProblem(error)!)
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, { audioBitsPerSecond: 64_000 })
    recorder.current = rec
    const stopWatching = watchQuiet(stream, () => rec.state === 'recording' && rec.stop())
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = async () => {
      stopWatching()
      // Without this the browser keeps showing "recording" after the question is done.
      stream.getTracks().forEach((t) => t.stop())
      setState('working')
      try {
        deliver(await transcribeQuestion(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })))
      } catch (error) {
        setNote(error instanceof GatewayError ? error.message : 'Could not read the recording.')
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

  const press = () => (state === 'recording' ? recorder.current?.stop() : void start())
  // The button sits in the box beside Send; what it is doing, or what went wrong, shows under it.
  const button = (
    <div className="voice-input">
      <IconButton
        icon="mic"
        label={state === 'recording' ? 'Stop recording' : 'Ask by voice'}
        selected={state === 'recording'}
        disabled={state === 'working'}
        onClick={press}
      />
    </div>
  )
  const message = (state !== 'idle' || note) && (
    <p className={note ? 'voice-input__note' : 'voice-input__state'} role={note ? 'alert' : 'status'}>
      {note || (state === 'recording' ? 'Listening… stop talking to send' : 'Reading your question…')}
    </p>
  )
  return (
    <>
      {card && createPortal(button, card)}
      {host && message && createPortal(message, host)}
    </>
  )
}
