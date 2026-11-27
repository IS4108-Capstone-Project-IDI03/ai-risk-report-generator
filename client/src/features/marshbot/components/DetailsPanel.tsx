// The assessment's Details (AS-06 boards 06, D1, D3) in the design system's SidePanel: from the
// right over a dimmed page on a computer, a bottom sheet on a phone. Edit details, in the panel's
// footer like every side panel's record actions, opens the dialog; Edit Site sits by the site; Open Map swaps the content to the site map, and the
// panel's Back returns. Opened by the header's Details button and the rail's client card
// (AssessmentApp.tsx).
import { useState } from 'react'
import { Button, SidePanel, useIsPhone } from '../../../design-system'
import { EditSiteDialog } from '../../clients/ClientDialogs'
import { EditDetailsDialog } from '../../assessments/components/EditDetailsDialog'
import type { AssessmentWorkflow } from '../../assessments/useAssessmentWorkflow'
import { DetailsContent, type DetailedRecord } from './DetailsContent'
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
  const record = v.liveRecord as DetailedRecord | null
  if (!record) return null
  const edit = v.ovEdit
  // On a computer the panel is a modal <dialog> in the top layer, which covers the app's toaster:
  // its toasts go to the panel's own (SidePanel `toaster`). A phone's sheet keeps the app's.
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
  // The way in to the details dialog: the record's action, so it sits in the footer at the panel's
  // bottom edge (as a knowledge-base document's and an account's do), not in the header.
  const editDetails = edit && (
    <Button variant="secondary" pill iconLeft="pencil" onClick={() => setDialog('details')}>
      Edit Details
    </Button>
  )
  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        title={title}
        className={mapping ? 'mb-details-panel mb-details-map' : 'mb-details-panel'}
        footer={mapping ? undefined : editDetails}
        back={mapping ? { label: 'Back to Details', onClick: () => setView('details') } : undefined}
        toaster={DETAILS_TOASTER}
      >
        {content}
      </SidePanel>
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
