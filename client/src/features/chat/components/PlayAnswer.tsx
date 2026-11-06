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
  const spoken = useRef<SpeechSynthesisUtterance | null>(null)
  // What is being read, and how far the voice has got in it (characters), so a change of speed
  // or voice can carry on from the same word instead of starting over.
  const text = useRef('')
  const at = useRef(0)

  const stop = () => {
    // Without clearing onend first, stopping would look like "finished" and re-open the mic.
    if (spoken.current) spoken.current.onend = null
    speechSynthesis.cancel()
    setState('idle')
  }
  // Speaks the answer from character `from`. The state follows the voice's own events, so this
  // can run from an effect.
  const speak = (from = 0) => {
    if (!from) text.current = answer ? spokenText(answer) : ''
    const rest = text.current.slice(from)
    if (!rest) return
    if (spoken.current) spoken.current.onend = null
    speechSynthesis.cancel()
    const say = new SpeechSynthesisUtterance(rest)
    say.rate = settings.rate
    const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === settings.voiceURI)
    if (voice) say.voice = voice
    say.onboundary = (e) => void (at.current = from + e.charIndex)
    say.onstart = () => setState('playing')
    say.onend = () => {
      setState('idle')
      answerSpoken.dispatchEvent(new Event('done'))
    }
    say.onerror = () => setState('idle')
    spoken.current = say
    speechSynthesis.speak(say)
  }
  // A new speed or voice applies at once, from the word being read, with no stop and start.
  useEffect(() => {
    if (state !== 'idle') speak(at.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the settings change
  }, [settings.rate, settings.voiceURI])
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
        <IconButton icon="volume-2" label="Read answer aloud" onClick={() => speak()} />
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
