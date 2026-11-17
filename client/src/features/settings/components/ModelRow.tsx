// One AI task in the Models section: its dropdown, save state and warning. S-01 AC3-AC8.
// Called by screens/ModelsSection. Saves at once with PUT; no Save button.
import { Icon } from '../../../design-system'
import { saveModel, type ModelRowData, type Settings } from '../api'
import { useSave } from '../useSave'
import { ModelSelect } from './ModelSelect'
import { SaveStatus } from './SaveStatus'

type Props = {
  row: ModelRowData
  canEdit: boolean
  onSaved: (settings: Settings) => void
}

export function ModelRow({ row, canEdit, onSaved }: Props) {
  const { state, run } = useSave(onSaved)
  return (
    <div className="st-row">
      <div className="st-row-head">
        <span className="st-row-label">{row.label}</span>
        <SaveStatus state={state} />
      </div>
      <ModelSelect
        label={row.label}
        options={row.options}
        selected={row.selected}
        // A fixed task never changes, and an engineer only reads.
        disabled={!canEdit || row.fixed}
        onChoose={(id) => run(() => saveModel(row.task, id))}
      />
      {row.fixed && <p className="st-note">Only one model works for this task.</p>}
      {row.warning && (
        <p className="st-warn" role="status">
          <Icon name="triangle-alert" size={16} color="var(--amber-600)" />
          <span>{row.warning}</span>
        </p>
      )}
    </div>
  )
}
