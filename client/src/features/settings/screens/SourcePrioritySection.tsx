// Settings > Source priority: rank the four source tiers by authority (RT-04).
// Called by Settings.tsx. An admin reorders and saves for everyone; an engineer reads it, with
// "Set by an admin" once in the title bar's end slot.
// Calls saveSourcePriority in api.ts.
import { useState } from 'react'
import { Button, EmptyNote } from '../../../design-system'
import { saveSourcePriority, type Settings } from '../api'
import { SaveStatus } from '../components/SaveStatus'
import { SetByAdmin } from '../components/SetByAdmin'
import { SettingBlock } from '../components/SettingBlock'
import { TierList } from '../components/TierList'
import { describeOrder } from '../tiers'
import { useSave } from '../useSave'

type Props = {
  settings: Settings
  onSaved: (settings: Settings) => void
  titleEnd: HTMLElement | null
}

// "12 Oct 14:05" style time, same as the knowledge base's dateTime.
const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.toTimeString().slice(0, 5)}`
}

export function SourcePrioritySection({ settings, onSaved, titleEnd }: Props) {
  const { order: saved, history } = settings.sourcePriority
  // The draft starts from the saved order and starts over when that changes (without this, another
  // admin's save would leave a stale list that Save could overwrite). Not a `key`: remounting would hide a failed-save line.
  const [draftState, setDraftState] = useState({ base: saved.join(), order: saved })
  if (draftState.base !== saved.join()) setDraftState({ base: saved.join(), order: saved })
  const draft = draftState.order
  const setDraft = (order: typeof saved) => setDraftState((d) => ({ ...d, order }))
  const { state, run } = useSave(onSaved)
  const edit = settings.canEditGlobal
  const changed = draft.join() !== saved.join()
  return (
    <>
      <SettingBlock wide>
        {!edit && <SetByAdmin into={titleEnd} />}
        <div className="st-notes">
          <p className="st-note">
            Rank 1 is trusted most. When sources disagree, the higher one wins.
          </p>
          <p className="st-note">
            A national code ranks only when the question names its country (for example Singapore).
          </p>
        </div>
        <TierList order={draft} canEdit={edit} onChange={setDraft} />
        {edit && (
          <div className="st-editor st-editor--actions">
            <Button
              variant="primary"
              pill
              loading={state.status === 'saving'}
              disabledReason={
                changed ? undefined : { title: 'No changes', text: 'Move a source, then save.' }
              }
              onClick={() => run(() => saveSourcePriority(draft), 'Order saved')}
            >
              Save order
            </Button>
            <SaveStatus state={state} />
          </div>
        )}
      </SettingBlock>
      <SettingBlock title="History">
        {history.length === 0 ? (
          <EmptyNote>No changes yet.</EmptyNote>
        ) : (
          <ul className="st-history">
            {history.map((h) => (
              <li key={h.at}>
                {when(h.at)}, {h.by.name}: {describeOrder(h.before)} → {describeOrder(h.after)}
              </li>
            ))}
          </ul>
        )}
      </SettingBlock>
    </>
  )
}
