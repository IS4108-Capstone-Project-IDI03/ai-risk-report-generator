// An observation's pictures (CP-22 round 6): its photos as small tiles and its
// handwritten pages, together in the narrow column on the right of its page,
// while the words (tags, note, recordings) take the wide column on the left.
// A tile opens the zoomable viewer (PhotoReferences.tsx PhotoDialog). Rendered
// by site-walk/screens/ProposalPage.tsx (the observation page has its own cards).
import type { ReactNode } from 'react'
import { PhotoGrid, type Tile } from './PhotoGrid'

export function MediaPanel({
  photos,
  pageCount,
  pages,
  onOpen,
}: {
  photos: Tile[]
  pageCount: number
  // The pages as the page draws them: entries with their transcript, or tiles.
  pages: ReactNode
  onOpen: (tile: Tile & { url: string }) => void
}) {
  if (!photos.length && !pageCount) return null
  return (
    <section className="ob-card op-media" aria-label="Photos and handwritten pages">
      {photos.length > 0 && (
        <section className="op-media-part" aria-label="Photos">
          <h3 className="ob-section-head">
            <span>Photos</span>
            <span className="op-count">{photos.length}</span>
          </h3>
          <PhotoGrid label="Photos of this observation" tiles={photos} onOpen={onOpen} />
        </section>
      )}
      {pageCount > 0 && (
        <section className="op-media-part" aria-label="Handwritten pages">
          <h3 className="ob-section-head">
            <span>Handwritten Pages</span>
            <span className="op-count">{pageCount}</span>
          </h3>
          {pages}
        </section>
      )}
    </section>
  )
}
