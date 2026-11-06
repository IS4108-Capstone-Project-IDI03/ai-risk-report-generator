// The voice options in a panel under the answer bar (CB-10 add-on A): reading speed and voice.
// Hands-free mode is set from the mic's own cog (components/VoiceInput.tsx). Shown in the answer
// bar by components/PlayAnswer.tsx. Saved by speech.ts.
import { useEffect, useState } from 'react'
import { IconButton, Select } from '../../../design-system'
import { useVoiceSettings } from '../speech'

const SPEEDS = ['0.75', '1', '1.25', '1.5']

/** A cog that shows speed and voice controls right under the bar (a popover was clipped by the answer). */
export function VoiceSettings() {
  const [open, setOpen] = useState(false)
  const [settings, change] = useVoiceSettings()
  // The browser loads its voices a moment after the page; listen until they arrive.
  const [voices, setVoices] = useState(() => speechSynthesis.getVoices())
  useEffect(() => {
    const update = () => setVoices(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', update)
    return () => speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])
  return (
    <>
      <IconButton
        icon="settings"
        label="Voice settings"
        selected={open}
        onClick={() => setOpen((was) => !was)}
      />
      {open && (
        <div className="voice-settings">
          <Select
            label="Speed"
            value={String(settings.rate)}
            options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))}
            onChange={(e) => change({ rate: Number(e.target.value) })}
          />
          <Select
            label="Voice"
            value={settings.voiceURI}
            options={[
              { value: '', label: 'Browser default' },
              ...voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` })),
            ]}
            onChange={(e) => change({ voiceURI: e.target.value })}
          />
        </div>
      )}
    </>
  )
}
