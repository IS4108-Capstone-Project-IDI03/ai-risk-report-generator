// Parts filled in elsewhere, as they read in Marsh's page layout (RV-12):
// Section 1's text without the screen's note on where it comes from,
// Section 3's matrix, OFI records and charts as the report has them, and
// Appendix A's chosen photos with their captions. Read-only, like every
// locked part (LockedBlockView).
import { lazy, Suspense } from 'react'
import type { AcceptedOfi, SavedObservation } from '../../api'
import { ChartBoundary } from '../../components/ChartBoundary'
import { OfisInReport } from '../../components/OfiSuggestions'
import { RiskMatrix } from '../../components/RiskMatrix'
import { useAppendix } from '../../useAppendix'

// Brings the chart library, so loaded only when Section 3 is shown.
const OfiCharts = lazy(() =>
  import('../../components/OfiCharts').then((m) => ({ default: m.OfiCharts })),
)

export function PurposeText({ text }: { text: (string | string[])[] | null }) {
  if (!text) return <p className="pg-note">Loading…</p>
  return (
    <div className="pg-purpose">
      {text.map((block, i) =>
        Array.isArray(block) ? (
          <ul key={i}>
            {block.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{block}</p>
        ),
      )}
    </div>
  )
}

export function OfisReport({
  ofis,
  observations,
}: {
  ofis: AcceptedOfi[]
  observations: SavedObservation[]
}) {
  return (
    <>
      <RiskMatrix />
      <OfisInReport accepted={ofis} observations={observations} />
      {ofis.length > 0 && (
        <ChartBoundary>
          <Suspense fallback={null}>
            <OfiCharts accepted={ofis} />
          </Suspense>
        </ChartBoundary>
      )}
    </>
  )
}

export function AppendixReport({ reference }: { reference: string }) {
  const { appendix, error } = useAppendix(reference)
  if (!appendix) return <p className="pg-note">{error ?? 'Loading…'}</p>
  if (!appendix.selected.length)
    return <p className="pg-note">No photos are chosen for Appendix A.</p>
  return (
    <>
      {appendix.selected.map((photo) => (
        <figure key={photo.photoId} className="pg-photo">
          <img src={photo.url} alt={photo.caption || photo.name} />
          <figcaption>{photo.caption}</figcaption>
        </figure>
      ))}
    </>
  )
}
