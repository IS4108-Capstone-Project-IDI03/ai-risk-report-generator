// New Observation: where, what was seen, then Save (CP-02, CP-22, CP-24). The site's weather
// (CP-62) in the header; one form card in the left half (location, what was seen as a note, voice,
// photos or pages, then categories, severity, tags, Cancel and Save) that fits a laptop's window;
// the checklist in the right half (CP-37), the Checklist tab's own cards, never shorter than the
// form and scrolling inside itself past the window's bottom edge. One column on a phone, with Cancel and Save in the bar at the bottom of
// the screen. Split into the Capture* components. Called by AssessmentApp.
import { useEffect, useId, useState } from 'react'
import { Button, Dialog, Icon } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { CaptureActions } from '../components/CaptureActions'
import { CaptureModeSwitcher } from '../components/CaptureModeSwitcher'
import { CaptureNoteBox } from '../components/CaptureNoteBox'
import { CapturePhotoPanel } from '../components/CapturePhotoPanel'
import { CaptureScanPanel } from '../components/CaptureScanPanel'
import { CaptureSessionNotice } from '../components/CaptureSessionNotice'
import { CaptureSeverity } from '../components/CaptureSeverity'
import { CaptureVoicePanel } from '../components/CaptureVoicePanel'
import { CategoryPicker } from '../components/CategoryPicker'
import { ChecklistPane } from '../components/ChecklistPane'
import { ChecklistSheet } from '../components/ChecklistSheet'
import { Tip } from '../../help/Tip'
import { LocationPicker } from '../components/LocationSheet'
import { KindPicker } from '../components/KindPicker'
import { SiteWeatherPanel } from '../weather/SiteWeatherPanel'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useCaptureFit } from '../useCaptureFit'
import { useWideCapture } from '../useWideCapture'
import { useNewObservationWalk } from '../newObservationWalk'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import '../capture.css'

// The one line under a phone's top bar: what to do, and what happens to what is left blank.
const HELPER =
  "Choose a location and add what you saw. Leave category and severity blank and they'll be suggested once you save."

export function SiteObservation({ v }: { v: AssessmentWorkflow }) {
  // A waiting photo or page, open full size.
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  // The two halves: the checklist never ends above the form (useCaptureFit's --cap-room).
  const grid = useCaptureFit<HTMLDivElement>()
  const sawId = useId()
  const split = v.captureSplit
  // Wide: the checklist stays beside the recording (CP-37); narrower, it opens as a sheet.
  const pane = useWideCapture() && v.canOpenChecklist
  // The note as it was when the engineer last left its box: the tag picker's cue to suggest.
  const [blurred, setBlurred] = useState('')
  // Closing the tab asks first while something is unsaved: the same test as the Leave dialog's
  // "Not saved: ..." line. Without this, closing the tab would lose the draft silently.
  const unsaved = v.unsavedLabel !== ''
  // F-12: ready once the capture session is live. Nothing is offered over unsaved work, a site walk
  // proposal's capture, a checklist item being answered as Differs, or an archived assessment.
  useWalkthroughScreen(
    'new-observation',
    v.liveVoice,
    unsaved ? 'unsaved' : v.proposalCapture || !!v.fChecklistItem || v.archivedOpen,
  )
  useNewObservationWalk(v)
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])
  // The site's weather (CP-62): advisory, so it never blocks Save, since an engineer may be
  // recording at their desk. A slim card at the header's right end, so the form below fits the
  // window; a phone has no header here, so it tops the form.
  const weather = <SiteWeatherPanel reference={v.liveReference} layout="card" />
  return (
    <>
      <div className="cap-page cap-page--v2">
        {/* A phone names the page in its top bar, with its ← beside it. */}
        {v.phone ? (
          !v.proposalCapture && <p className="sh-detail cap-phone-helper">{HELPER}</p>
        ) : (
          <ScreenHeader
            title="New Observation"
            // For a site walk proposal, where it will be added, once a location is chosen. A plain
            // observation has no line: the form says what it needs (Location's *, the category
            // (?) tip), so the whole form fits under the header on a laptop.
            detail={
              v.proposalCapture
                ? v.locationLabel
                  ? 'Adds to the site walk at ' + v.locationLabel
                  : 'Pick a location, add what you saw, then add it'
                : undefined
            }
            back={v.proposalCapture ? 'Site walk proposal' : 'Observations'}
            onBack={v.leaveCapture}
            // F-12: "Add an observation" presses Back (the phone bar's ← carries the same tag).
            backWalk="new-observation.back"
            actions={weather}
          />
        )}
        {v.captureFailed && (
          <div className="cap-top">
            <CaptureSessionNotice capture={v.capture} onRetry={v.retryCapture} />
          </div>
        )}
        <div ref={grid} className="cap-layout" data-pane={pane ? '' : undefined}>
          <div className="cap-main">
            {v.phone && weather}
            <section aria-label="Details" className="cap-panel cap-form">
              {/* a. Where, and what was seen. */}
              <div className="cap-group">
                <LocationPicker v={v} />
                {v.canOpenChecklist && (!pane || v.fChecklistItem) && <ChecklistBar v={v} />}
                <section aria-labelledby={sawId} className="cap-field cap-saw">
                  <span id={sawId} className="cap-label">
                    {'What you saw'}
                  </span>
                  <CaptureModeSwitcher v={v} />
                  <div className="cap-media">
                    {!!v.isNoteMode && (
                      <CaptureNoteBox
                        value={v.fNote}
                        onChange={v.setFNote}
                        phone={!!v.phone}
                        reference={v.liveVoice ? v.captureRef : null}
                        onBlur={setBlurred}
                      />
                    )}
                    {!!v.isVoiceMode && <CaptureVoicePanel v={v} />}
                    {!!v.isPhotoMode && <CapturePhotoPanel v={v} onView={setViewing} />}
                    {!!v.isScanMode && <CaptureScanPanel v={v} onView={setViewing} />}
                  </div>
                </section>
              </div>
              {/* b. How to file it: all optional, suggested after Save when left blank. */}
              <div className="cap-group">
                <CategoryPicker
                  cats={v.fCats}
                  onToggle={v.toggleFCat}
                  hint={null}
                  walk="new-observation.categories"
                  // A site walk proposal's capture is not suggested after saving, so the tip does not apply.
                  help={
                    !v.proposalCapture && (
                      <Tip id="new-observation.category-severity" align="left" />
                    )
                  }
                  {...(v.proposalCapture && { legend: 'Category' })}
                />
                <CaptureSeverity value={v.fSev} onChange={v.setFSev} />
                {/* Tags (CP-36): in every mode, since a photo or voice observation is tagged too.
                    A site walk proposal saves locally, so it asks for no suggestion. */}
                <KindPicker
                  value={v.fKinds}
                  onChange={v.setFKinds}
                  labels={v.fLabels}
                  onLabels={v.proposalCapture ? undefined : v.setFLabels}
                  reference={v.proposalCapture ? null : v.liveVoice ? v.captureRef : null}
                  text={v.fNote}
                  blurred={blurred}
                  disabled={v.fSaving}
                />
              </div>
              {split && <CaptureActions v={v} pinned={false} />}
            </section>
          </div>
          {pane && <ChecklistPane v={v} />}
        </div>
      </div>
      {!split && <CaptureActions v={v} pinned />}
      {/* Mounted only while open, so it loads the checklist as it is now. */}
      {v.checklistOpen && !pane && <ChecklistSheet v={v} />}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
      {v.leaveOpen && (
        <Dialog
          title="Leave without saving?"
          description={'Not saved: ' + v.unsavedLabel + '.'}
          width={480}
          onClose={v.closeLeave}
          footer={
            <>
              <Button variant="pill" onClick={v.closeLeave}>
                {'Stay'}
              </Button>
              <Button variant="danger" pill onClick={v.discardAndLeave}>
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
