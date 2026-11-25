// Settings > Chat and voice: chat memory (CB-05), the voice-transcription model, and how the
// chat reads answers aloud (speed and voice, CB-10). S-01 AC13. Called by Settings.tsx.
// Speed and voice are saved in this browser (chat/speech.ts), so each device keeps its own.
// "Set by an admin" sits beside the one admin-set setting (voice transcription), as the rest are the person's own.
import { useEffect, useState } from 'react'
import { Button, Select, Switch, toast } from '../../../design-system'
import type { Settings } from '../api'
import { fetchMemory, setMemoryEnabled } from '../../chat/api'
import { canSpeak, useVoices, useVoiceSettings } from '../../chat/speech'
import { ModelRow } from '../components/ModelRow'
import { SaveStatus } from '../components/SaveStatus'
import { SetByAdmin } from '../components/SetByAdmin'
import { SettingBlock } from '../components/SettingBlock'
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
    <SettingBlock title="Reading answers aloud">
      <p className="st-note">This browser cannot read answers aloud.</p>
    </SettingBlock>
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
    <SettingBlock
      title="Reading answers aloud"
      help="Saved on this device only. Voices differ between devices."
    >
      <div className="st-editor">
        <div className="st-field st-field--speed">
          <Select
            label="Speed"
            value={String(voice.rate)}
            options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))}
            onChange={(e) => change({ rate: Number(e.target.value) })}
          />
        </div>
        <div className="st-field st-field--voice">
          <Select
            label="Voice"
            value={voice.voiceURI}
            options={[
              { value: '', label: 'Browser default (works on every device)' },
              ...voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` })),
            ]}
            onChange={(e) => change({ voiceURI: e.target.value })}
          />
        </div>
        <Button variant="secondary" pill iconLeft="volume-2" onClick={sample}>
          Play sample
        </Button>
      </div>
    </SettingBlock>
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

  // Like the Walkthroughs offers switch: the switch itself shows a good change, so only a failure
  // says anything. Without the catch, a failed save would be silent while the switch looked changed.
  const toggle = async (next: boolean) => {
    try {
      setEnabled((await setMemoryEnabled(next)).enabled)
    } catch {
      toast.error("Couldn't save that change", { description: 'Please try again.' })
    }
  }

  const transcription = settings.models.find((m) => m.task === 'transcription')
  return (
    <>
      {transcription && (
        <ModelRow
          row={transcription}
          canEdit={settings.canEditGlobal}
          note={!settings.canEditGlobal && <SetByAdmin />}
          onSaved={onSaved}
        />
      )}
      <ReadAloud />
      <SettingBlock>
        <div className="st-switch-row">
          <Switch
            label="Remember facts about me in chat"
            checked={enabled ?? false}
            disabled={enabled === null}
            onChange={toggle}
          />
          <SaveStatus state={state} />
        </div>
      </SettingBlock>
    </>
  )
}
