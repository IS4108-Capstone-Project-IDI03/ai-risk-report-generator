// Parts filled in elsewhere, as they read in Marsh's page layout (RV-12):
// Section 1's text without the screen's note on where it comes from,
// Section 3's matrix, OFI records and charts as the report has them, and
// Appendix A's chosen photos with their captions. Read-only, like every
// locked part (LockedBlockView).
import { lazy, Suspense } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import type { AcceptedOfi, SavedObservation } from '../../api'
import { ChartBoundary } from '../../components/ChartBoundary'
import { MaturityTable } from '../../components/MaturityTable'
import { OfisInReport } from '../../components/OfiSuggestions'
import { RiskMatrix } from '../../components/RiskMatrix'
import { useAppendix } from '../../useAppendix'
import type { ReferenceGroup } from '../export/references'
import { programRowsOf } from './programs'

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

// Section 6's programs as Marsh's two tables (GN-11, EX-01 AC7), from the
// rows written in its subsection, read again as they change: each rank
// coloured, each row's citations numbered as its section numbers them.
export function ProgramsTable({
  editor,
  getPos,
}: {
  editor: Editor
  getPos: () => number | undefined
}) {
  const rows = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const pos = getPos()
      if (pos === undefined) return []
      const at = e.state.doc.resolve(pos)
      if (at.depth < 2) return []
      return programRowsOf(at.node(1), at.parent).rows
    },
  })
  const entries = new Map(
    rows.map((row) => [
      row.program,
      {
        rank: row.rank,
        comment: (
          <>
            {row.comment}
            {row.cites.map((n) => (
              <sup key={n} className="dm-cite" data-n={n} />
            ))}
          </>
        ),
      },
    ]),
  )
  return <MaturityTable entries={entries} />
}

// The export's References (EX-01 AC6): each section that cites anything,
// with what each of its numbers cites.
export function ReferencesList({ groups }: { groups: ReferenceGroup[] }) {
  return (
    <div className="pg-references">
      {groups.map((group) => (
        <section key={group.sectionId} className="pg-reference-group">
          <h3 className="pg-reference-heading">{group.label}</h3>
          <ol className="pg-reference-list">
            {group.entries.map((entry) => (
              <li key={entry.number} value={entry.number}>
                {entry.text}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
