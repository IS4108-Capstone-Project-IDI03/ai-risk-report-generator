// Settings > Source priority: rank the four source tiers by authority (RT-04).
// Called by Settings.tsx. An admin reorders and saves for everyone; an engineer reads it.
// Calls saveSourcePriority in api.ts.
import { useState } from 'react'
import { Button } from '../../../design-system'
import { saveSourcePriority, type Settings } from '../api'
import { SaveStatus } from '../components/SaveStatus'
import { SetByAdmin } from '../components/SetByAdmin'
import { TierList } from '../components/TierList'
import { describeOrder } from '../tiers'
import { useSave } from '../useSave'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }

// "12 Oct 14:05" style time, same as the knowledge base's dateTime.
const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.toTimeString().slice(0, 5)}`
}

export function SourcePrioritySection({ settings, onSaved }: Props) {
  const { order: saved, history } = settings.sourcePriority
  const [draft, setDraft] = useState(saved)
  const { state, run } = useSave(onSaved)
  const edit = settings.canEditGlobal
  const changed = draft.join() !== saved.join()
  return (
    <div className="st-stack">
      {!edit && <SetByAdmin />}
      <p className="st-note">Rank 1 is trusted most. When sources disagree, the higher one wins.</p>
      <TierList order={draft} canEdit={edit} onChange={setDraft} />
      {edit && (
        <div className="st-row-head">
          <Button
            variant="primary"
            disabled={!changed || state.status === 'saving'}
            onClick={() => run(() => saveSourcePriority(draft))}
          >
            Save order
          </Button>
          <SaveStatus state={state} />
        </div>
      )}
      <div className="st-row">
        <div className="st-row-label">History</div>
        {history.length === 0 ? (
          <p className="st-note">No changes yet.</p>
        ) : (
          <ul className="st-history">
            {history.map((h) => (
              <li key={h.at}>
                {when(h.at)}, {h.by.name}: {describeOrder(h.before)} → {describeOrder(h.after)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
