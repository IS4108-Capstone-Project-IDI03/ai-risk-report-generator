// Reads the latest answer aloud, without its citation markers (CB-10 AC2, AC4). Drawn inside
// components/AnswerBar.tsx. The answer to a hands-free question starts by itself and tells the mic when it ends.
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../../design-system'
import { answerSpoken, canSpeak, handsFreeTurn, spokenText, useVoiceSettings } from '../speech'
import { VoiceSettings } from './VoiceSettings'

/** Play, pause and stop for the answer in `answer`; renders nothing where the browser cannot speak. */
export function PlayAnswer({ answer }: { answer: Element | null }) {
  // A separate component, so none of its hooks touch speechSynthesis where it does not exist.
  return canSpeak() ? <Player answer={answer} /> : null
}

function Player({ answer }: { answer: Element | null }) {
  const [settings] = useVoiceSettings()
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle')
  // A later answer must not inherit an earlier one's "playing" state.
  const spoken = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = () => {
    // Without clearing onend first, stopping would look like "finished" and re-open the mic.
    if (spoken.current) spoken.current.onend = null
    speechSynthesis.cancel()
    setState('idle')
  }
  // Speaks the answer. The state follows the voice's own events, so this can run from an effect.
  const speak = () => {
    const text = answer ? spokenText(answer) : ''
    if (!text) return
    if (spoken.current) spoken.current.onend = null
    speechSynthesis.cancel()
    const say = new SpeechSynthesisUtterance(text)
    say.rate = settings.rate
    const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === settings.voiceURI)
    if (voice) say.voice = voice
    say.onstart = () => setState('playing')
    say.onend = () => {
      setState('idle')
      answerSpoken.dispatchEvent(new Event('done'))
    }
    say.onerror = () => setState('idle')
    spoken.current = say
    speechSynthesis.speak(say)
  }
  const togglePause = () => {
    if (state === 'playing') {
      speechSynthesis.pause()
      setState('paused')
    } else {
      speechSynthesis.resume()
      setState('playing')
    }
  }

  // The answer to a hands-free question is read once, by itself. Leaving the page stops the voice.
  useEffect(() => {
    if (handsFreeTurn.waiting) {
      handsFreeTurn.waiting = false
      speak()
    }
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer element
  }, [answer])

  return (
    <>
      {state === 'idle' ? (
        <IconButton icon="volume-2" label="Read answer aloud" onClick={speak} />
      ) : (
        <>
          <IconButton
            icon={state === 'playing' ? 'pause' : 'play'}
            label={state === 'playing' ? 'Pause reading' : 'Resume reading'}
            onClick={togglePause}
          />
          <IconButton icon="square" label="Stop reading" onClick={stop} />
        </>
      )}
      <VoiceSettings />
    </>
  )
}
