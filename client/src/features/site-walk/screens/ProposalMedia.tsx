// A site walk proposal's All Photos or All Handwritten Pages (CP-22 round 5):
// the Observations tab's screens (assessments/screens/Photos.tsx, Scans.tsx)
// for the proposal's own observations, on the same table (PhotoTable). A
// deleted observation's are left out, as on the tab. Opened from the proposal's
// navigator; rendered by screens/Review.tsx.
import { EmptyState, IconRegistry } from '../../../design-system'
import { ObservationBadge } from '../../assessments/components/ObservationBadge'
import { PhotoTable, type PhotoRow } from '../../assessments/components/PhotoTable'
import type { ViewedPhoto } from '../../assessments/components/PhotoReferences'
import { ScreenHeader } from '../../assessments/components/ScreenHeader'
import { locationLabel } from '../../assessments/locations'
import { plural } from '../../assessments/reviewDisplay'
import type { Proposal, SiteWalk } from '../api'
import { pathOf } from '../options'
import { ALL, sectionsAt } from '../proposal'

const NO_PLACE = { building: null, floor: null, name: 'No location yet', bare: true }

/** Returns a table row for each photo, or each page, of the proposal's observations. */
function rowsOf(
  kind: 'photos' | 'pages',
  proposal: Proposal,
  walk: SiteWalk,
  open: (ref: string) => void,
) {
  const rows: PhotoRow[] = []
  for (const o of sectionsAt(proposal, ALL).flatMap((s) => s.items)) {
    const place = proposal.locations.find((l) => l.ref === o.locationRef)
    const added = (walk.media ?? []).filter((m) => o.mediaIds?.includes(m.id))
    const files =
      kind === 'photos'
        ? [
            ...walk.photos.filter((p) => o.photoIds.includes(p.id)),
            ...added.filter((m) => m.kind === 'photo'),
          ]
        : added.filter((m) => m.kind === 'page')
    for (const f of files)
      rows.push({
        key: o.ref + f.id,
        name: `${kind === 'photos' ? 'Photo' : 'Page'} ${rows.length + 1}`,
        url: f.url,
        where: place ? locationLabel(pathOf(place)) : NO_PLACE.name,
        text: o.note.trim() || 'No note yet',
        cats: o.copeDimension ? [o.copeDimension] : [],
        path: place ? pathOf(place) : NO_PLACE,
        openObservation: () => open(o.ref),
      })
  }
  return rows
}

export function ProposalMedia({
  kind,
  proposal,
  walk,
  back,
  onOpen,
  onView,
}: {
  kind: 'photos' | 'pages'
  proposal: Proposal
  walk: SiteWalk
  back: { label: string; onClick: () => void }
  // Opens the observation a row belongs to.
  onOpen: (ref: string) => void
  onView: (photo: ViewedPhoto) => void
}) {
  const rows = rowsOf(kind, proposal, walk, onOpen)
  const places = new Set(rows.map((r) => r.where)).size
  const photos = kind === 'photos'
  return (
    <>
      <ScreenHeader
        title={photos ? 'All Photos' : 'All Handwritten Pages'}
        back={back.label}
        onBack={back.onClick}
        badge={<ObservationBadge kind="proposal" />}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={photos ? 'image' : IconRegistry.evidence.handwriting}
          title={photos ? 'No photos yet' : 'No handwritten pages yet'}
          description={
            photos
              ? 'Photos appear here once they are part of an observation.'
              : 'Pages appear here once they are added to an observation.'
          }
        />
      ) : (
        <PhotoTable
          label={photos ? 'Site photographs' : 'Handwritten pages'}
          rows={rows}
          count={`${plural(rows.length, photos ? 'photo' : 'page')} across ${plural(places, 'location')}`}
          onOpen={(r) => onView({ name: r.name, url: r.url, context: r.where })}
        />
      )}
    </>
  )
}
