// The microphone button beside the chat box (CB-10). Records a question, turns it into text
// (gateway /api/chat/transcribe) and puts it in the box for checking. In hands-free mode it
// sends the question itself, then listens again once the answer has been read.
// Drawn inside AgentInterface (screens/KnowledgeAssistant.tsx), where OpenUI's chat state lives.
// The recording itself is assessments/dictation/useRecorder.ts, shared with dictation (CP-27).
import { useThread } from '@openuidev/react-headless'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IconButton, Switch } from '../../../design-system'
import { useRecorder } from '../../assessments/dictation/useRecorder'
import { transcribeQuestion } from '../api'
import { answerSpoken, handsFreeTurn, isStopWord, useVoiceSettings } from '../speech'
import { COMPOSER_BOX, useComposerHosts } from './useComposerHosts'

// With no level meter, a hands-free question is cut off after this long.
const UNMETERED_MS = 15_000

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
  // Where a hands-free turn is after the question is sent: waiting for the answer, or hearing it.
  const [after, setAfter] = useState<'asking' | 'speaking' | null>(null)
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
  const onClip = useCallback(
    async (clip: Blob) => deliver(await transcribeQuestion(clip)),
    [deliver],
  )
  // Hands-free has no one to press Stop, so without a meter it ends after a fixed time.
  const unmeteredLimitMs = useCallback(() => (handsFree.current ? UNMETERED_MS : null), [])
  const recorder = useRecorder({ onClip, unmeteredLimitMs })
  const { state, note, level, metered, togglePause, start: record } = recorder
  const start = useCallback(() => {
    setAfter(null)
    return record()
  }, [record])

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
          <IconButton icon="square" label="Stop recording" onClick={recorder.stop} />
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
