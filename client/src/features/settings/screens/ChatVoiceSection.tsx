// Settings > Chat and voice: the chat memory switch (CB-05). S-01 AC13.
// Called by Settings.tsx. Reuses chat/api.ts so Settings and chat show the same stored value.
import { useEffect, useState } from 'react'
import { Switch } from '../../../design-system'
import { fetchMemory, setMemoryEnabled } from '../../chat/api'
import { SaveStatus } from '../components/SaveStatus'
import type { SaveState } from '../useSave'

export function ChatVoiceSection() {
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

  return (
    <div className="st-row">
      <Switch
        label="Remember facts about me in chat"
        checked={enabled ?? false}
        disabled={enabled === null}
        onChange={toggle}
      />
      <SaveStatus state={state} />
    </div>
  )
}
