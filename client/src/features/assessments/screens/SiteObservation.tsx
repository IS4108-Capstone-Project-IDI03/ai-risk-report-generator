// The Add manually screen: where, what was seen, its tags, then Save (CP-02,
// CP-22). Two panels: the details on the left (location, categories, severity,
// Save) and the media on the right (note, voice, photos, pages), the same
// height; stacked on a phone. Split into the Capture* components.
// Called by AssessmentApp.
import { useState } from 'react'
import { Dialog, Icon } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { CaptureActions } from '../components/CaptureActions'
import { CaptureHelp } from '../components/CaptureHelp'
import { CaptureModeSwitcher } from '../components/CaptureModeSwitcher'
import { CapturePhotoPanel } from '../components/CapturePhotoPanel'
import { CaptureScanPanel } from '../components/CaptureScanPanel'
import { CaptureSessionNotice } from '../components/CaptureSessionNotice'
import { CaptureVoicePanel } from '../components/CaptureVoicePanel'
import { CategoryPicker } from '../components/CategoryPicker'
import { ChecklistSheet } from '../components/ChecklistSheet'
import { LocationPicker } from '../components/LocationSheet'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import { SeverityPicker } from '../components/SeverityPicker'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../capture.css'

export function SiteObservation({ v }: { v: AssessmentWorkflow }) {
  // A waiting photo or page, open full size.
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  const split = v.captureSplit
  return (
    <>
      <div className="cap-page">
        {/* A phone names the page in its top bar, with its ← beside it. */}
        {!v.phone && (
          <ScreenHeader
            title="New Observation"
            // Where it will be saved, once a location is chosen; until then, the how-to.
            detail={
              v.locationLabel
                ? `${v.proposalCapture ? 'Adds to the site walk at' : 'Saves to'} ${v.locationLabel}`
                : 'Pick a location, add what you saw, then save'
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
        <div className="cap-grid" data-split={split ? '' : undefined}>
          {/* a. The details: where, which categories, how severe, then Save. */}
          <div className="cap-panel">
            <section aria-label="Details" className="cap-panel-body">
              <div className="cap-field">
                <span className="cap-label cap-label--help">
                  {'Location'}
                  <CaptureHelp proposal={v.proposalCapture} />
                </span>
                <LocationPicker v={v} />
              </div>
              {v.canOpenChecklist && <ChecklistBar v={v} />}
              <CategoryPicker
                cats={v.fCats}
                onToggle={v.toggleFCat}
                {...(v.proposalCapture && { legend: 'Category' })}
              />
              <SeverityPicker value={v.fSev} onChange={v.setFSev} />
            </section>
            {split && <CaptureActions v={v} pinned={false} />}
          </div>
          {/* b. The media, as tall as the details beside it. */}
          <section aria-label="What you saw" className="cap-panel">
            <CaptureModeSwitcher v={v} />
            <div className="cap-media">
              {!!v.isNoteMode && (
                <textarea
                  className="cap-note"
                  aria-label="Note"
                  maxLength={5000}
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
        {!split && <CaptureActions v={v} pinned />}
      </div>
      {/* Mounted only while open, so it loads the checklist as it is now. */}
      {v.checklistOpen && <ChecklistSheet v={v} />}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
      {v.leaveOpen && (
        <Dialog
          title="Leave without saving?"
          description={'Not saved: ' + v.unsavedLabel + '.'}
          width={480}
          onClose={v.closeLeave}
          footer={
            <>
              <button type="button" className="cap-btn cap-btn--secondary" onClick={v.closeLeave}>
                {'Stay'}
              </button>
              <button type="button" className="cap-btn cap-btn--danger" onClick={v.discardAndLeave}>
                {'Leave'}
              </button>
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
        <button
          type="button"
          className="cap-btn cap-btn--secondary cap-checklist-back"
          onClick={v.backToChecklist}
        >
          <Icon name="arrow-left" size={16} />
          {'Back to checklist'}
        </button>
      </section>
    )
  // The capture screen's own tinted button, full width like the fields around it.
  return (
    <button
      type="button"
      className="cap-btn cap-btn--secondary cap-btn--block"
      onClick={v.openChecklist}
    >
      <Icon name="list-checks" size={16} />
      {'Open checklist'}
    </button>
  )
}
