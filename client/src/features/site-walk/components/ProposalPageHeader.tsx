// The top of a proposed observation's page (CP-22 round 6, v2 in CP-24): the record header the saved
// observation's page draws (Back, its category tile, a "Proposed observation" eyebrow over where it
// is), and at the right the save state, the stepper through the proposal's observations, and the
// bin (Restore on a deleted one). Used by screens/ProposalPage.tsx. Calls RecordHeader, RecordStepper.
import { Button, IconAction, RecordHeader, RecordStepper } from '../../../design-system'
import { CategoryMark } from '../../assessments/components/ObservationMarks'
import type { ProposedObservation } from '../api'

/** Returns the header row. `at` counts from 1; the stepper is left out when it is the only one. */
export function ProposalPageHeader({
  back,
  observation: o,
  title,
  saveText,
  at,
  total,
  onStep,
  deleted,
  readOnly,
  onDelete,
  onRestore,
}: {
  back: { label: string; onClick: () => void }
  observation: ProposedObservation
  // Where it is: the location's name, or "No location yet".
  title: string
  // "Saving…" or "Saved", or nothing before the first edit.
  saveText: string
  at: number
  total: number
  onStep: (to: -1 | 1) => void
  deleted: boolean
  readOnly: boolean
  onDelete: () => void
  onRestore: () => void
}) {
  return (
    <RecordHeader
      back={back.label}
      onBack={back.onClick}
      tile={<CategoryMark cats={o.copeDimension ? [o.copeDimension] : []} />}
      eyebrow="Proposed observation"
      title={title}
      actions={
        <>
          <span className="ob-saved" role="status">
            {saveText && <span key={saveText}>{saveText}</span>}
          </span>
          {/* Where this one sits among them; nothing when it is the only one. */}
          {total > 1 && at > 0 && (
            <RecordStepper
              at={at}
              total={total}
              onPrevious={() => onStep(-1)}
              onNext={() => onStep(1)}
            />
          )}
          {readOnly ? null : deleted ? (
            <Button variant="create" iconLeft="rotate-ccw" onClick={onRestore}>
              Restore
            </Button>
          ) : (
            <IconAction
              icon="trash-2"
              label="Delete observation"
              tooltip="Delete observation"
              size="md"
              shaded
              style={{ color: 'var(--red-600)' }}
              onClick={onDelete}
            />
          )}
        </>
      }
    />
  )
}
