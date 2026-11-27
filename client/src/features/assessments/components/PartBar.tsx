// The heading row of a part of the report in Review (RV-01, GN-07, RV-06): its title, with any
// help and action (Redraft) beside it, then Version history and the stepper ("4 of 10" between
// round chevrons, the record stepper's look) at the right. One row for every part, so moving
// between them feels the same. Called by DraftEditor, ReportPart and ReviewWorkspace (Section 3).
// Calls IconAction.
import type { ReactNode } from 'react'
import { IconAction, IconRegistry } from '../../../design-system'

/** Returns the part's title row with its stepper and Version history. */
export function PartBar({
  title,
  position,
  onPrevious,
  onNext,
  onHistory,
  help,
  action,
  documentAction,
}: {
  title: ReactNode
  // e.g. "4 of 10": this part among all of the report's.
  position: string
  // Left out where there is no part before or after: that chevron greys out.
  onPrevious?: () => void
  onNext?: () => void
  onHistory?: () => void
  help?: ReactNode
  // Sits beside the tools, e.g. Redraft on Sections 2 and 3 (GN-13).
  action?: ReactNode
  // The bar's main action at its right end: Edit document (RV-08) or Open document (RV-03).
  documentAction?: ReactNode
}) {
  return (
    <div className="rv-part-bar">
      <span className="rv-heading-title">
        <h2>{title}</h2>
        {help}
      </span>
      <span className="rv-part-tools">
        {action}
        {onHistory && (
          <IconAction
            icon={IconRegistry.object.history}
            label="Version history"
            placement="bottom"
            data-walk="review.version-history"
            onClick={onHistory}
          />
        )}
        <nav className="rs" aria-label="Parts of the report">
          <IconAction
            icon="chevron-left"
            label="Previous"
            tooltip="Previous part"
            placement="bottom"
            size="md"
            shaded
            disabled={!onPrevious}
            onClick={onPrevious}
          />
          <span className="rs-place">{position}</span>
          <IconAction
            icon="chevron-right"
            label="Next"
            tooltip="Next part"
            placement="bottom"
            size="md"
            shaded
            disabled={!onNext}
            onClick={onNext}
          />
        </nav>
        {documentAction}
      </span>
    </div>
  )
}
