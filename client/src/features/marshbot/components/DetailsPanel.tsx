// The assessment's Details (AS-06 board 06): a side panel from the right over a dimmed page on
// a computer, a bottom sheet on a phone. Its pencil opens Edit details; Edit site sits by the
// site. Opened by the header's Details button and the rail's client card (AssessmentApp.tsx).
import { useEffect, useId, useRef, useState } from 'react'
import { IconButton, Sheet, useIsPhone } from '../../../design-system'
import { EditSiteDialog } from '../../clients/ClientDialogs'
import { EditDetailsDialog } from '../../assessments/components/EditDetailsDialog'
import type { AssessmentWorkflow } from '../../assessments/useAssessmentWorkflow'
import { DetailsContent, type DetailedRecord } from './DetailsContent'
import '../marshbot.css'

/** Returns the Details panel (or sheet) while open; nothing without a saved record. */
export function DetailsPanel({
  v,
  open,
  onClose,
}: {
  v: AssessmentWorkflow
  open: boolean
  onClose: () => void
}) {
  const phone = useIsPhone()
  const [dialog, setDialog] = useState<'site' | 'details' | null>(null)
  const titleId = useId()
  // What had focus when the panel opened. The panel unmounts rather than closing, so the
  // browser doesn't return focus by itself: without this it would drop to the page's top.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open || !opener.current) return
    opener.current.focus?.()
    opener.current = null
  }, [open])
  const record = v.liveRecord as DetailedRecord | null
  if (!record) return null
  const edit = v.ovEdit
  const content = (
    <DetailsContent
      v={v}
      record={record}
      onEditSite={edit?.site.allowed ? () => setDialog('site') : undefined}
    />
  )
  const editDetails = edit && (
    <IconButton
      icon="pencil"
      label="Edit details"
      tooltip="Edit details"
      className="mb-hit"
      onClick={() => setDialog('details')}
    />
  )
  return (
    <>
      {phone ? (
        <Sheet
          open={open}
          onClose={onClose}
          title="Details"
          className="mb-details-sheet"
          headerAction={editDetails}
        >
          {content}
        </Sheet>
      ) : (
        open && (
          <dialog
            // Opens modally as soon as it exists: the page behind dims and can't be tabbed into.
            ref={(el) => {
              if (el && !el.open) {
                opener.current = document.activeElement as HTMLElement | null
                el.showModal?.()
              }
            }}
            className="mb-panel-dialog"
            aria-labelledby={titleId}
            onCancel={(e) => {
              e.preventDefault()
              onClose()
            }}
            // A click on the dimmed backdrop (the dialog's own box, outside the panel) closes it.
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <div className="mb-panel-sheet">
              <header className="mb-panel-head">
                <h2 id={titleId}>Details</h2>
                <span>
                  {editDetails}
                  <IconButton icon="x" label="Close" tooltip="Close" onClick={onClose} />
                </span>
              </header>
              <div className="mb-panel-body">{content}</div>
            </div>
          </dialog>
        )
      )}
      {dialog === 'site' && edit && (
        <EditSiteDialog
          site={edit.record.site}
          assessments={edit.site.assessments}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null)
            void v.siteSaved(message)
          }}
        />
      )}
      {dialog === 'details' && edit && (
        <EditDetailsDialog
          record={edit.record}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null)
            void v.detailsSaved(message)
          }}
        />
      )}
    </>
  )
}
