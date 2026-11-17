// Settings > QA check: one strictness setting for the whole report. S-01 AC12.
// Called by Settings.tsx. Admin changes it for everyone; an engineer reads it.
import { SegmentedControl } from '../../../design-system'
import { saveGlobal, type QaStrictness, type Settings } from '../api'
import { SaveStatus } from '../components/SaveStatus'
import { SetByAdmin } from '../components/SetByAdmin'
import { useSave } from '../useSave'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }

const CHOICES: { value: QaStrictness; label: string }[] = [
  { value: 'strict', label: 'Strict' },
  { value: 'standard', label: 'Standard' },
  { value: 'lenient', label: 'Lenient' },
]

export function QaSection({ settings, onSaved }: Props) {
  const { state, run } = useSave(onSaved)
  const edit = settings.canEditGlobal
  return (
    <div className="st-stack">
      <div className="st-row">
        <div className="st-row-label">QA strictness</div>
        {/* An engineer gets disabled options, so the value shows but cannot change */}
        <SegmentedControl
          ariaLabel="QA strictness"
          value={settings.qaStrictness}
          options={CHOICES.map((c) => ({ ...c, disabled: !edit }))}
          onChange={(qaStrictness) => run(() => saveGlobal({ qaStrictness }))}
        />
        <SaveStatus state={state} />
        {!edit && <SetByAdmin />}
      </div>
    </div>
  )
}
