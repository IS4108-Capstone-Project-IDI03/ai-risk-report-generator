// One AI task in the Models section: its dropdown, failed-save line and warning. S-01 AC3-AC8.
// Called by screens/ModelsSection and ChatVoiceSection. Saves at once with PUT (toast "Model saved"); no Save button.
import { HelpTip, Icon } from '../../../design-system'
import { saveModel, type ModelRowData, type Settings } from '../api'
import { useSave } from '../useSave'
import { ModelSelect } from './ModelSelect'
import { SaveStatus } from './SaveStatus'
import { SettingBlock } from './SettingBlock'

type Props = {
  row: ModelRowData
  canEdit: boolean
  // True in the "Not used yet" section: greyed out and not changeable, nothing reads it yet.
  unused?: boolean
  // A line for under the title, e.g. the "Set by an admin" chip when this one is read-only.
  note?: React.ReactNode
  onSaved: (settings: Settings) => void
}

export function ModelRow({ row, canEdit, unused, note, onSaved }: Props) {
  const { state, run } = useSave(onSaved)
  return (
    <SettingBlock
      title={row.label}
      titleLevel={unused ? 4 : 3}
      help={note}
      tip={
        row.fixed ? (
          <HelpTip label={`Why ${row.label} can't be changed`}>
            <p>Only one model works for this task.</p>
          </HelpTip>
        ) : undefined
      }
      status={<SaveStatus state={state} />}
      muted={unused}
    >
      <ModelSelect
        label={row.label}
        options={row.options}
        selected={row.selected}
        // A fixed task never changes, and an engineer only reads.
        disabled={!canEdit || row.fixed || Boolean(unused)}
        onChoose={(id) => run(() => saveModel(row.task, id), 'Model saved')}
      />
      {row.warning && (
        <p className="st-warn" role="status">
          <Icon name="triangle-alert" size={16} color="var(--amber-600)" />
          <span>{row.warning}</span>
        </p>
      )}
    </SettingBlock>
  )
}
