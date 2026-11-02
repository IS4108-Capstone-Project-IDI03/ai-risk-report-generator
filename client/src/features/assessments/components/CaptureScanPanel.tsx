// The Scan mode of the capture screen: pages of handwritten notes, one photo per page (CP-19).
// They are transcribed word for word once saved, as a recording is.
// Called by screens/SiteObservation.tsx, which opens a page full size on `onView`.
import { Callout, IconRegistry } from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { DraftList } from './DraftList'
import { PhotoPickers, PhotoThumb, ReadyItem, RemoveButton } from './MediaPickers'
import { type ViewedPhoto } from './PhotoReferences'

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
      <div
        className={v.fPages.length ? undefined : 'cap-media-fill'}
        style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        <PhotoPickers
          onChange={v.addPages}
          busy={v.fSaving}
          takeLabel="Photograph a page"
          chooseLabel="Choose pages"
        />
        <span className="cap-hint">{v.pageHint}</span>
        {!!v.fPageError && (
          <div role="alert">
            <Callout tone="warning" title="Not added">
              {v.fPageError}
            </Callout>
          </div>
        )}
      </div>
      {v.fPages.length > 0 && (
        <DraftList label="Pages">
          {v.fPages.map((page) => (
            <ReadyItem key={page.id} icon={IconRegistry.evidence.handwriting} title={page.name}>
              <PhotoThumb
                url={page.url}
                name={page.name}
                onOpen={() => onView({ name: page.name, url: page.url })}
              />
              <RemoveButton
                label={'Remove ' + page.name}
                disabled={v.fSaving}
                onClick={() => v.removePage(page)}
              />
            </ReadyItem>
          ))}
        </DraftList>
      )}
    </>
  )
}
