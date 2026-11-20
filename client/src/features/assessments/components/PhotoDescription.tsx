// What the AI says the photos show (CP-05, CP-24), under the photos on an observation's page.
// It is written without being asked and again when the photos or their marks change, so there
// is no button except the quiet Copy into note. No heading, AI label or tint (design system v2).
// Rendered by components/PhotosCard.tsx; the data is the row view's `photoDescription`
// (useAssessmentWorkflow.tsx). Calls ReadingStatus, FailedLine, IconAction.
import { FailedLine, IconAction, ReadingStatus } from '../../../design-system'
import type { ObservationChange } from '../useAssessmentWorkflow'
import type { ObservationRowView } from '../useObservationsView'

export type PhotoDescriptionData = NonNullable<ObservationRowView['photoDescription']>

/** Returns the description (or its being-written and failed states), or nothing before the photos are first described. */
export function PhotoDescription({
  reading,
  save,
  busy,
  retry,
}: {
  reading: PhotoDescriptionData | null
  save: (change: ObservationChange) => Promise<boolean>
  // While a save is on its way, a copy would be built on the note as it was before it.
  busy: boolean
  // Try again for a failed description; null for view-only users, or when the suggestion's own
  // Try again (in Details) already covers it.
  retry?: (() => void) | null
}) {
  if (!reading) return null
  if (reading.status === 'interpreting')
    return (
      <div className="cpp-desc-row">
        <ReadingStatus state="working" label="Describing the photo" />
      </div>
    )
  if (reading.status === 'failed')
    return (
      <div className="cpp-desc-row">
        <FailedLine
          message={reading.error || 'The photos could not be described.'}
          onAction={retry ?? undefined}
        />
      </div>
    )
  return (
    <div className="cpp-desc-row cpp-desc-text">
      <p className="cpp-desc">{reading.description}</p>
      {!!reading.addToNote && (
        <IconAction
          icon="copy-plus"
          label="Copy into note"
          tooltip="Copy into note"
          disabled={busy}
          onClick={() => void save(reading.addToNote!)}
        />
      )}
    </div>
  )
}
