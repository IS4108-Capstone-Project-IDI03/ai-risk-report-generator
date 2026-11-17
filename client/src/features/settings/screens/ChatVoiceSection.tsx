// Settings > Chat and voice: chat memory (CB-05), the voice-transcription model, and how the
// chat reads answers aloud (speed and voice, CB-10). S-01 AC13. Called by Settings.tsx.
// Speed and voice are saved in this browser (chat/speech.ts), so each device keeps its own.
import { useEffect, useState } from 'react'
import { Button, Select, Switch } from '../../../design-system'
import type { Settings } from '../api'
import { fetchMemory, setMemoryEnabled } from '../../chat/api'
import { canSpeak, useVoices, useVoiceSettings } from '../../chat/speech'
import { ModelRow } from '../components/ModelRow'
import { SaveStatus } from '../components/SaveStatus'
import { SetByAdmin } from '../components/SetByAdmin'
import type { SaveState } from '../useSave'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }
const SPEEDS = ['0.75', '1', '1.25', '1.5']

// Speed and voice for reading answers aloud. "Browser default" is the safe choice: every
// browser on Windows, macOS, iOS and Android has one, and it follows the device's language.
// Split in two so no speech hook runs in a browser without speech (without this, it would crash).
function ReadAloud() {
  return canSpeak() ? (
    <ReadAloudControls />
  ) : (
    <p className="st-note">This browser cannot read answers aloud.</p>
  )
}

function ReadAloudControls() {
  const [voice, change] = useVoiceSettings()
  const voices = useVoices()
  const sample = () => {
    speechSynthesis.cancel()
    const say = new SpeechSynthesisUtterance('This is how answers will sound.')
    say.rate = voice.rate
    say.voice = speechSynthesis.getVoices().find((v) => v.voiceURI === voice.voiceURI) ?? null
    speechSynthesis.speak(say)
  }
  return (
    <div className="st-row">
      <div className="st-row-label">Reading answers aloud</div>
      <div className="st-editor">
        <Select
          label="Speed"
          value={String(voice.rate)}
          options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))}
          onChange={(e) => change({ rate: Number(e.target.value) })}
        />
        <Select
          label="Voice"
          value={voice.voiceURI}
          options={[
            { value: '', label: 'Browser default (works on every device)' },
            ...voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` })),
          ]}
          onChange={(e) => change({ voiceURI: e.target.value })}
        />
        <Button variant="secondary" size="md" onClick={sample}>
          Play sample
        </Button>
      </div>
      <p className="st-note">Saved on this device only. Voices differ between devices.</p>
    </div>
  )
}

export function ChatVoiceSection({ settings, onSaved }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [state, setState] = useState<SaveState>({ status: 'idle', message: '' })

  useEffect(() => {
    fetchMemory().then(
      (m) => setEnabled(m.enabled),
      () => setState({ status: 'failed', message: 'Reload the page.' }),
    )
  }, [])

  const toggle = async (next: boolean) => {
    setState({ status: 'saving', message: '' })
    try {
      setEnabled((await setMemoryEnabled(next)).enabled)
      setState({ status: 'saved', message: '' })
    } catch {
      setState({ status: 'failed', message: 'Try again.' })
    }
  }

  const transcription = settings.models.find((m) => m.task === 'transcription')
  return (
    <div className="st-stack">
      {transcription && (
        <>
          {!settings.canEditGlobal && <SetByAdmin />}
          <ModelRow row={transcription} canEdit={settings.canEditGlobal} onSaved={onSaved} />
        </>
      )}
      <ReadAloud />
      <div className="st-row">
        <Switch
          label="Remember facts about me in chat"
          checked={enabled ?? false}
          disabled={enabled === null}
          onChange={toggle}
        />
        <SaveStatus state={state} />
      </div>
    </div>
  )
}
