// The Scan tab of New Observation: pages of handwritten notes, one photo per page (CP-19, CP-24).
// They are transcribed word for word once saved, as a recording is.
// Called by screens/SiteObservation.tsx, which opens a page full size on `onView`.
import { Callout } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { CaptureFilePicker } from './CaptureFilePicker'
import { CaptureItem } from './CaptureItem'
import { PhotoThumb } from './MediaPickers'
import { type ViewedPhoto } from './PhotoReferences'
import '../capture.css'

export function CaptureScanPanel({
  v,
  onView,
}: {
  v: AssessmentWorkflow
  onView: (photo: ViewedPhoto) => void
}) {
  return (
    <>
      {/* Nothing added yet: the pickers sit in the middle of the media panel. */}
      <div className={'cap-pickers' + (v.fPages.length ? '' : ' cap-media-fill')}>
        <div className="cap-pickers-row">
          <CaptureFilePicker
            className="photo-take"
            icon="camera"
            label="Photograph a page"
            accept="image/jpeg,image/png"
            capture="environment"
            disabled={v.fSaving}
            onChange={v.addPages}
          />
          <CaptureFilePicker
            icon="image"
            label="Choose pages"
            accept="image/jpeg,image/png"
            multiple
            disabled={v.fSaving}
            onChange={v.addPages}
          />
          <Tip id="new-observation.scan" align="right" />
        </div>
        <span className="cap-hint">
          {'JPG or PNG, one photo per page. Each page is transcribed once you save.'}
        </span>
        {/* Pages go to the AI as photographed: client details in them can't be masked (PV-04). */}
        <span className="cap-hint">
          {
            'Leave names, phone numbers and ID numbers off the page: an external AI service reads it.'
          }
        </span>
        {!!v.fPageError && (
          <div role="alert">
            <Callout tone="warning" title="Not added">
              {v.fPageError}
            </Callout>
          </div>
        )}
      </div>
      {v.fPages.length > 0 && (
        <ul className="sw-list cap-clips" aria-label="Pages">
          {v.fPages.map((page) => (
            <CaptureItem
              key={page.id}
              name={page.name}
              removeLabel={'Remove ' + page.name}
              busy={v.fSaving}
              onRemove={() => v.removePage(page)}
              lead={
                <PhotoThumb
                  url={page.url}
                  name={page.name}
                  onOpen={() => onView({ name: page.name, url: page.url })}
                />
              }
            />
          ))}
        </ul>
      )}
    </>
  )
}
