// The assessment's Details (AS-06 boards 06, D1, D3): a side panel from the right over a dimmed
// page on a computer, a bottom sheet on a phone. Its Edit Details button opens the dialog; Edit
// Site sits by the site; Open Map swaps the content to the site map, and a back arrow returns.
// Opened by the header's Details button and the rail's client card (AssessmentApp.tsx).
import { useEffect, useId, useRef, useState } from 'react'
import { BackButton, Button, IconAction, Sheet, useIsPhone } from '../../../design-system'
import { EditSiteDialog } from '../../clients/ClientDialogs'
import { EditDetailsDialog } from '../../assessments/components/EditDetailsDialog'
import type { AssessmentWorkflow } from '../../assessments/useAssessmentWorkflow'
import { DetailsContent, type DetailedRecord } from './DetailsContent'
import { DetailsToaster } from './DetailsToaster'
import { DETAILS_TOASTER } from './detailsToast'
import { SiteMapPanel } from './SiteMapPanel'
import '../marshbot.css'

/** Returns the Details panel (or sheet) while open; nothing without a saved record. */
export function DetailsPanel({
  v,
  open,
  onClose: close,
}: {
  v: AssessmentWorkflow
  open: boolean
  onClose: () => void
}) {
  const phone = useIsPhone()
  const [dialog, setDialog] = useState<'site' | 'details' | null>(null)
  // What the panel shows: the facts, or the site map in their place (same panel, no new dialog).
  const [view, setView] = useState<'details' | 'map'>('details')
  // Closing starts the next opening on the facts again.
  const onClose = () => {
    setView('details')
    close()
  }
  const titleId = useId()
  const pressedOnBackdrop = useRef(false)
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
  // On a computer the panel is a modal <dialog> in the top layer, which covers the app's toaster:
  // its toasts go to a toaster inside it. A phone's sheet isn't in the top layer, so it keeps the app's.
  const toasterId = phone ? undefined : DETAILS_TOASTER
  const mapping = view === 'map' && !!v.ovMap
  const title = mapping ? 'Site Map' : 'Details'
  const content = mapping ? (
    <SiteMapPanel
      map={v.ovMap!}
      onSaved={(message, undo) => v.siteSaved(message, { undo, toasterId })}
    />
  ) : (
    <DetailsContent
      v={v}
      record={record}
      onEditSite={edit?.site.allowed ? () => setDialog('site') : undefined}
      siteReason={edit && !edit.site.allowed ? edit.site.reason : null}
      onOpenMap={v.ovMap ? () => setView('map') : undefined}
      toasterId={toasterId}
    />
  )
  // The round Back button, left of the title (on a phone the sheet puts it after, so `order` moves it).
  const back = (
    <span className="mb-back">
      <BackButton label="Back to Details" onClick={() => setView('details')} />
    </span>
  )
  // The one way in to the details dialog: a button with words, not an icon to hunt for.
  const editDetails = edit && (
    <Button
      variant="pill"
      iconLeft="pencil"
      className="ds-press mb-hit"
      onClick={() => setDialog('details')}
    >
      Edit Details
    </Button>
  )
  return (
    <>
      {phone ? (
        <Sheet
          open={open}
          onClose={onClose}
          title={title}
          className={mapping ? 'mb-details-sheet mb-details-map' : 'mb-details-sheet'}
          headerAction={mapping ? back : editDetails}
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
            // Escape closes a list open over the panel (the Popover hears it too), not the panel:
            // without this one press would close both.
            onKeyDown={(e) =>
              e.key === 'Escape' &&
              e.currentTarget.querySelector('.ds-popover') &&
              e.preventDefault()
            }
            // A click on the dimmed backdrop (the dialog's own box, outside the panel) closes it,
            // but only when the press began there too: without this a text selection dragged out
            // of the panel would close it on release.
            onPointerDown={(e) => (pressedOnBackdrop.current = e.target === e.currentTarget)}
            // A press on the backdrop released inside the panel still clicks the dialog itself
            // (the two share only that ancestor), so the release must be on the backdrop too.
            onPointerUp={(e) => {
              if (e.target !== e.currentTarget) pressedOnBackdrop.current = false
            }}
            onClick={(e) => e.target === e.currentTarget && pressedOnBackdrop.current && onClose()}
          >
            <div className="mb-panel-sheet">
              <header className="mb-panel-head">
                {mapping && back}
                <h2 id={titleId}>{title}</h2>
                <span>
                  {!mapping && editDetails}
                  <IconAction
                    icon="x"
                    label="Close"
                    size="md"
                    placement="bottom"
                    className="mb-hit"
                    onClick={onClose}
                  />
                </span>
              </header>
              <div className="mb-panel-body">{content}</div>
            </div>
            <DetailsToaster />
          </dialog>
        )
      )}
      {dialog === 'site' && edit && (
        <EditSiteDialog
          site={edit.record.site}
          assessments={edit.site.assessments}
          onClose={() => setDialog(null)}
          // The dialog's own message names the site; a toast here stays short and generic.
          onSaved={() => {
            setDialog(null)
            void v.siteSaved('Site updated', { toasterId })
          }}
        />
      )}
      {dialog === 'details' && edit && (
        <EditDetailsDialog
          record={edit.record}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void v.detailsSaved('Details updated', { toasterId })
          }}
        />
      )}
    </>
  )
}
