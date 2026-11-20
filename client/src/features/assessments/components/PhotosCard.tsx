// An observation's photos (CP-04, CP-10, CP-24): square tiles that open the zoomable viewer, a
// dashed Add photo tile (opens Add media), who added each photo, and what the photos show,
// written without being asked. Shown while it has photos or a description (Copy into note stays
// after the last photo goes). Rendered by screens/ObservationPage.tsx. Calls PhotoGrid, PhotoDescription.
import { Icon } from '../../../design-system'
import { PhotoDescription, type PhotoDescriptionData } from './PhotoDescription'
import { PhotoGrid, type Tile } from './PhotoGrid'
import { RecordCard } from './RecordCard'
import type { ObservationChange } from '../useAssessmentWorkflow'

/** Returns the Photos card, or nothing when there is nothing to show. */
export function PhotosCard({
  tiles,
  stamps,
  description,
  save,
  busy,
  onOpen,
  onAdd,
  retry,
}: {
  tiles: Tile[]
  stamps: string[]
  description: PhotoDescriptionData | null
  save: (change: ObservationChange) => Promise<boolean>
  busy: boolean
  onOpen: (tile: Tile & { url: string }) => void
  // Opens Add media; null for whoever may not add.
  onAdd: (() => void) | null
  // Try again for a failed description (null: none to offer).
  retry?: (() => void) | null
}) {
  if (!tiles.length && !description) return null
  return (
    <RecordCard title={tiles.length ? 'Photos · ' + tiles.length : 'Photos'} label="Photos">
      {tiles.length > 0 && (
        <PhotoGrid
          label="Photos of this observation"
          tiles={tiles}
          onOpen={onOpen}
          end={
            onAdd && (
              <button type="button" className="sw-photo-add" onClick={onAdd}>
                <Icon name="plus" size={22} />
                {'Add photo'}
              </button>
            )
          }
        />
      )}
      {stamps.map((line) => (
        <p key={line} className="ob-stamp">
          {line}
        </p>
      ))}
      <PhotoDescription reading={description} save={save} busy={busy} retry={retry} />
    </RecordCard>
  )
}
