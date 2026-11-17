// Settings > QA eval: how strict the QA check is, and what each level means (S-01 AC12, EV-05).
// Called by Settings.tsx. Admin changes it for everyone; an engineer reads it.
// The QA criteria part is built by Chris later, so it shows a Coming soon tile.
import { SegmentedControl, Table } from '../../../design-system'
import { saveGlobal, type QaStrictness, type Settings } from '../api'
import { ComingSoon } from '../components/ComingSoon'
import { SaveStatus } from '../components/SaveStatus'
import { SetByAdmin } from '../components/SetByAdmin'
import { useSave } from '../useSave'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }

const CHOICES: { value: QaStrictness; label: string }[] = [
  { value: 'strict', label: 'Strict' },
  { value: 'standard', label: 'Standard' },
  { value: 'lenient', label: 'Lenient' },
]

// What each level does to a finding's severity. Must match the table in
// .local-docs/sprint-specs/sprint-5/EV-05.md (the QA check applies it when it is built).
const MEANING: Record<QaStrictness, { minor: string; major: string; critical: string }> = {
  lenient: { minor: 'Pass', major: 'Warn', critical: 'Fail' },
  standard: { minor: 'Warn', major: 'Fail', critical: 'Fail' },
  strict: { minor: 'Fail', major: 'Fail', critical: 'Fail' },
}

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
      <div className="st-row">
        <div className="st-row-label">What each level means</div>
        <p className="st-note">The verdict a finding gets, by how serious the judge rated it.</p>
        <Table
          columns={[
            { key: 'level', header: 'Strictness' },
            { key: 'minor', header: 'Minor' },
            { key: 'major', header: 'Major' },
            { key: 'critical', header: 'Critical' },
          ]}
          rows={CHOICES.map((c) => ({
            id: c.value,
            level: c.value === settings.qaStrictness ? `${c.label} (current)` : c.label,
            ...MEANING[c.value],
          }))}
        />
      </div>
      <ComingSoon name="QA criteria" owner="Chris" />
    </div>
  )
}
