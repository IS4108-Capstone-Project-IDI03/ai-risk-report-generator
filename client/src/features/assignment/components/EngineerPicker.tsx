// The Assigned engineer picker (RV-11, boards 09, 12, 13): a dropdown whose rows are an
// avatar, a name and a role word, Me first. It is the app's own ChoiceMenu (a popover
// that becomes a bottom sheet under 768 px), extended with a lead and a trail per row,
// not a native select, which can't draw avatars. Used by the New Assessment form's
// AssessmentBlock and the Reassign dialog.
import { useId } from 'react'
import { Icon } from '../../../design-system'
import { ChoiceMenu } from '../../assessments/components/ChoiceMenu'
import { ErrorLine } from '../../new-assessment/components/Field'
import type { Person } from '../api'
import { pickable, roleWord } from '../people'
import { PersonAvatar } from './PersonAvatar'

const LABEL = 'Assigned engineer'

export function EngineerPicker({
  people,
  me,
  value,
  onChange,
  error,
  notice,
  leaveOut,
  inDialog = false,
}: {
  people: Person[]
  me: { id: string; name: string }
  // The chosen person's id, or '' while none is chosen (the Reassign dialog starts so).
  value: string
  onChange: (id: string) => void
  // The one short line under the field when it is missing or refused; marks it red.
  error?: string
  // A line that isn't an error, e.g. the list could not load; the field stays usable.
  notice?: string
  // The current engineer, left out of the Reassign dialog's list.
  leaveOut?: string
  // In a dialog the list opens in the flow under the field, pushing the buttons down: a floating
  // one would be clipped by the dialog, and a phone's sheet would open behind it.
  inDialog?: boolean
}) {
  const labelId = useId()
  const valueId = useId()
  const lineId = useId()
  const list = pickable(people, me, leaveOut)
  const chosen = list.find((p) => p.id === value)
  const nameOf = (p: Person) => (p.id === me.id ? 'Me' : p.name)
  return (
    <div
      className={'na-field na-field--select ap-picker' + (inDialog ? ' ap-picker--inline' : '')}
      data-error={error ? '' : undefined}
    >
      <span className="na-label" id={labelId}>
        {LABEL}
        <span className="ap-star" aria-hidden="true">
          {'*'}
        </span>
      </span>
      <ChoiceMenu
        label={LABEL}
        align={inDialog ? 'left' : 'right'}
        className="ap-anchor"
        noSheet={inDialog}
        sheetCancel
        sheetClassName="ap-sheet"
        choices={list.map((p) => ({
          value: p.id,
          label: nameOf(p),
          lead: <PersonAvatar name={p.name} />,
          trail: roleWord(p.role),
        }))}
        selected={[value]}
        onChoose={onChange}
        trigger={(_, toggle) => (
          <button
            type="button"
            className="ap-trigger"
            aria-labelledby={labelId + ' ' + valueId}
            aria-invalid={error ? true : undefined}
            // A refused press lands here: without this a screen reader wouldn't say why.
            aria-describedby={error || notice ? lineId : undefined}
            onClick={toggle}
          >
            {chosen && <PersonAvatar name={chosen.name} size={24} />}
            <span id={valueId} className="ap-value" data-empty={chosen ? undefined : ''}>
              {chosen ? nameOf(chosen) : 'Choose'}
            </span>
            <Icon name="chevron-down" size={14} color="var(--text-muted)" />
          </button>
        )}
      />
      {(error || notice) && (
        <div className="ap-line" id={lineId}>
          <ErrorLine text={error || notice!} />
        </div>
      )}
    </div>
  )
}
