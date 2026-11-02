// An observation's pictures (CP-22 round 6): its photos as small tiles and its
// handwritten pages, together in the narrow column on the right of its page,
// while the words (tags, note, recordings) take the wide column on the left.
// A tile opens the zoomable viewer (PhotoReferences.tsx PhotoDialog). Rendered
// by screens/ObservationPage.tsx and site-walk/screens/ProposalPage.tsx.
import type { ReactNode } from 'react'
import { PhotoGrid, type Tile } from './PhotoGrid'

export function MediaPanel({
  photos,
  photoStamps,
  photoReading,
  pageCount,
  pages,
  onOpen,
}: {
  photos: Tile[]
  // Under the tiles: who added which photo, when known.
  photoStamps?: ReactNode
  // Under them: what the AI read in them (ObservationProposal.tsx PhotoReading).
  photoReading?: ReactNode
  pageCount: number
  // The pages as the page draws them: entries with their transcript, or tiles.
  pages: ReactNode
  onOpen: (tile: Tile & { url: string }) => void
}) {
  if (!photos.length && !pageCount && !photoReading) return null
  return (
    <section className="ob-card op-media" aria-label="Photos and handwritten pages">
      {/* The reading stays after the last photo is removed, so Copy into note
          is still there. */}
      {(photos.length > 0 || !!photoReading) && (
        <section className="op-media-part" aria-label="Photos">
          {photos.length > 0 && (
            <>
              <h3 className="ob-section-head">
                <span>Photos</span>
                <span className="op-count">{photos.length}</span>
              </h3>
              <PhotoGrid label="Photos of this observation" tiles={photos} onOpen={onOpen} />
              {photoStamps}
            </>
          )}
          {photoReading}
        </section>
      )}
      {pageCount > 0 && (
        <section className="op-media-part" aria-label="Handwritten pages">
          <h3 className="ob-section-head">
            <span>Handwritten pages</span>
            <span className="op-count">{pageCount}</span>
          </h3>
          {pages}
        </section>
      )}
    </section>
  )
}
