// The Photo mode of the capture screen: add photos and list those waiting (CP-02).
// Called by screens/SiteObservation.tsx, which opens a photo full size on `onView`.
import { Callout } from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { DraftList } from './DraftList'
import { PhotoPickers, PhotoThumb, ReadyItem, RemoveButton } from './MediaPickers'
import { type ViewedPhoto } from './PhotoReferences'

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
      <div
        className={v.fPhotos.length ? undefined : 'cap-media-fill'}
        style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        <PhotoPickers onChange={v.addPhotos} busy={v.fSaving} />
        <span className="cap-hint">{v.photoHint}</span>
        {!!v.fPhotoError && (
          <div role="alert">
            <Callout tone="warning" title="Not added">
              {v.fPhotoError}
            </Callout>
          </div>
        )}
      </div>
      {v.fPhotos.length > 0 && (
        <DraftList label="Photos">
          {v.fPhotos.map((photo) => (
            <ReadyItem key={photo.id} icon="image" title={photo.name}>
              <PhotoThumb
                url={photo.url}
                name={photo.name}
                onOpen={() => onView({ name: photo.name, url: photo.url })}
              />
              <RemoveButton
                label={'Remove ' + photo.name}
                disabled={v.fSaving}
                onClick={() => v.removePhoto(photo)}
              />
            </ReadyItem>
          ))}
        </DraftList>
      )}
    </>
  )
}
