// New Observation: where, what was seen, then Save (CP-02, CP-22, CP-24). Two cards: the details
// on the left (location, categories, severity, Cancel and Save) and the media on the right (note,
// voice, photos, pages). The left card keeps its own height; the right is never shorter, and past
// the window's bottom edge scrolls inside itself. Stacked on a phone, with Cancel and Save in the
// bar at the bottom of the screen. Split into the Capture* components. Called by AssessmentApp.
import { useEffect, useState } from 'react'
import { Button, Dialog, Icon, Textarea } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { CaptureActions } from '../components/CaptureActions'
import { CaptureModeSwitcher } from '../components/CaptureModeSwitcher'
import { CapturePhotoPanel } from '../components/CapturePhotoPanel'
import { CaptureScanPanel } from '../components/CaptureScanPanel'
import { CaptureSessionNotice } from '../components/CaptureSessionNotice'
import { CaptureSeverity } from '../components/CaptureSeverity'
import { CaptureVoicePanel } from '../components/CaptureVoicePanel'
import { CategoryPicker } from '../components/CategoryPicker'
import { ChecklistSheet } from '../components/ChecklistSheet'
import { LocationPicker } from '../components/LocationSheet'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useCaptureFit } from '../useCaptureFit'
import '../capture.css'

// The one line under the title: what to do, and what happens to what is left blank.
const HELPER =
  "Choose a location and add what you saw. Leave category and severity blank and they'll be suggested once you save."

export function SiteObservation({ v }: { v: AssessmentWorkflow }) {
  // A waiting photo or page, open full size.
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  const grid = useCaptureFit<HTMLDivElement>()
  const split = v.captureSplit
  // Closing the tab asks first while something is unsaved: the same test as the Leave dialog's
  // "Not saved: ..." line. Without this, closing the tab would lose the draft silently.
  const unsaved = v.unsavedLabel !== ''
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])
  return (
    <>
      <div className="cap-page cap-page--v2">
        {/* A phone names the page in its top bar, with its ← beside it. */}
        {v.phone ? (
          !v.proposalCapture && <p className="sh-detail cap-phone-helper">{HELPER}</p>
        ) : (
          <ScreenHeader
            title="New Observation"
            // For a site walk proposal, where it will be added, once a location is chosen.
            detail={
              v.proposalCapture
                ? v.locationLabel
                  ? 'Adds to the site walk at ' + v.locationLabel
                  : 'Pick a location, add what you saw, then add it'
                : HELPER
            }
            back={v.proposalCapture ? 'Site walk proposal' : 'Observations'}
            onBack={v.leaveCapture}
          />
        )}
        {v.capture?.status === 'unavailable' && (
          <div className="cap-top">
            <CaptureSessionNotice
              capture={v.capture}
              reference={v.captureRef}
              onRetry={v.retryCapture}
            />
          </div>
        )}
        <div ref={grid} className="cap-grid" data-split={split ? '' : undefined}>
          {/* a. The details: where, which categories, how severe, then Cancel and Save. */}
          <div className="cap-panel">
            <section aria-label="Details" className="cap-panel-body">
              <LocationPicker v={v} />
              {v.canOpenChecklist && <ChecklistBar v={v} />}
              <CategoryPicker
                cats={v.fCats}
                onToggle={v.toggleFCat}
                hint={null}
                {...(v.proposalCapture && { legend: 'Category' })}
              />
              <CaptureSeverity value={v.fSev} onChange={v.setFSev} />
              {split && <CaptureActions v={v} pinned={false} />}
            </section>
          </div>
          {/* b. The media: never shorter than the details, scrolling inside itself past the window. */}
          <section aria-label="What you saw" className="cap-panel cap-panel--media">
            <CaptureModeSwitcher v={v} />
            <div className="cap-media">
              {!!v.isNoteMode && (
                <Textarea
                  aria-label="Note"
                  maxLength={5000}
                  rows={v.phone ? 6 : 8}
                  placeholder="What did you see? Write as you would for the record."
                  value={v.fNote}
                  onChange={v.setFNote}
                />
              )}
              {!!v.isVoiceMode && <CaptureVoicePanel v={v} />}
              {!!v.isPhotoMode && <CapturePhotoPanel v={v} onView={setViewing} />}
              {!!v.isScanMode && <CaptureScanPanel v={v} onView={setViewing} />}
            </div>
          </section>
        </div>
      </div>
      {!split && <CaptureActions v={v} pinned />}
      {/* Mounted only while open, so it loads the checklist as it is now. */}
      {v.checklistOpen && <ChecklistSheet v={v} />}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
      {v.leaveOpen && (
        <Dialog
          className="ds-dialog--v2"
          title="Leave without saving?"
          description={'Not saved: ' + v.unsavedLabel + '.'}
          width={480}
          onClose={v.closeLeave}
          footer={
            <>
              <Button variant="pill" style={{ height: 44 }} onClick={v.closeLeave}>
                {'Stay'}
              </Button>
              <Button variant="danger" pill style={{ height: 44 }} onClick={v.discardAndLeave}>
                {'Leave'}
              </Button>
            </>
          }
        />
      )}
    </>
  )
}

// Under the location bar: the checklist, to answer its items here (CP-31); or,
// while a Differs is recorded in full capture, the item it answers, with the
// way back to the checklist that leaves it unanswered.
function ChecklistBar({ v }: { v: AssessmentWorkflow }) {
  if (v.fChecklistItem)
    return (
      <section className="cap-checklist" aria-label="Recording a difference">
        <span className="cap-checklist-head">
          <Icon name="equal-not" size={15} />
          {'Recording a difference for:'}
        </span>
        <span className="cap-checklist-item">{v.fChecklistItem.text}</span>
        <span className="cap-checklist-hint">
          {'Record what you saw, then save. It is answered as Differs.'}
        </span>
        <Button
          variant="pill"
          iconLeft="arrow-left"
          style={{ height: v.phone ? 44 : 40 }}
          onClick={v.backToChecklist}
        >
          {'Back to checklist'}
        </Button>
      </section>
    )
  return (
    <Button
      variant="pill"
      iconLeft="list-checks"
      fullWidth
      style={{ height: v.phone ? 44 : 40 }}
      onClick={v.openChecklist}
    >
      {'Open checklist'}
    </Button>
  )
}
