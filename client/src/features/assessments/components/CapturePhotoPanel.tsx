// The Photo tab of New Observation: add photos and list those waiting (CP-02, CP-04, CP-10).
// Called by screens/SiteObservation.tsx, which opens a photo full size on `onView`.
import { Callout } from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { CaptureFilePicker } from './CaptureFilePicker'
import { CaptureItem } from './CaptureItem'
import { PhotoThumb } from './MediaPickers'
import { type ViewedPhoto } from './PhotoReferences'
import '../capture.css'

export function CapturePhotoPanel({
  v,
  onView,
}: {
  v: AssessmentWorkflow
  onView: (photo: ViewedPhoto) => void
}) {
  return (
    <>
      {/* Nothing added yet: the pickers sit in the middle of the media panel. */}
      <div className={'cap-pickers' + (v.fPhotos.length ? '' : ' cap-media-fill')}>
        {/* Chrome on Android 14+ offers no camera in its photo picker (CP-04 AC6), so taking
            one needs `capture`, which leaves out the library: two pickers. A desktop hides the
            first (workflow.css). */}
        <div className="cap-pickers-row">
          <CaptureFilePicker
            className="photo-take"
            icon="camera"
            label="Take photograph"
            accept="image/jpeg,image/png"
            capture="environment"
            disabled={v.fSaving}
            onChange={v.addPhotos}
          />
          <CaptureFilePicker
            icon="image"
            label="Choose photographs"
            accept="image/jpeg,image/png"
            multiple
            disabled={v.fSaving}
            onChange={v.addPhotos}
          />
        </div>
        <span className="cap-hint">{'JPG or PNG, stored exactly as taken.'}</span>
        {!!v.fPhotoError && (
          <div role="alert">
            <Callout tone="warning" title="Not added">
              {v.fPhotoError}
            </Callout>
          </div>
        )}
      </div>
      {v.fPhotos.length > 0 && (
        <ul className="sw-list cap-clips" aria-label="Photos">
          {v.fPhotos.map((photo) => (
            <CaptureItem
              key={photo.id}
              name={photo.name}
              removeLabel={'Remove ' + photo.name}
              busy={v.fSaving}
              onRemove={() => v.removePhoto(photo)}
              lead={
                <PhotoThumb
                  url={photo.url}
                  name={photo.name}
                  region={photo.region}
                  // It can be marked before it is saved (CP-10).
                  onOpen={() =>
                    onView({
                      name: photo.name,
                      url: photo.url,
                      region: photo.region,
                      mark: (region) => v.markDraftPhoto(photo.id, region),
                    })
                  }
                />
              }
            />
          ))}
        </ul>
      )}
    </>
  )
}
