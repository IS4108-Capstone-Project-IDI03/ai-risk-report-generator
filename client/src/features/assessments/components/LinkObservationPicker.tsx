// "Link existing observation" (CP-37): a compact dialog listing this assessment's observations,
// with a search box. Called by ChecklistItems. Calls listObservations; the parent does the PATCH.
import { useEffect, useState } from 'react'
import { Dialog, Input } from '../../../design-system'
import { listObservations, type SavedObservation } from '../api'
import { locationLabel } from '../locations'
import { plural, severityLabel } from '../reviewDisplay'
import '../checklist.css'

// The one line shown for an observation, as the Observations list names it: its note, else its
// first transcript, else its first page's handwriting, else how many photos or pages it holds.
function snippet(o: SavedObservation) {
  const heard = o.recordings
    .map((r) => r.transcription.correction?.text ?? r.transcription.transcript)
    .find(Boolean)
  const pages = o.pages ?? []
  const pageText =
    (pages[0]?.transcription.correction?.text ?? pages[0]?.transcription.transcript)?.trim() ||
    (pages.length ? plural(pages.length, 'handwritten page') : '')
  return (
    o.note?.trim() ||
    heard ||
    pageText ||
    (o.photos.length ? plural(o.photos.length, 'photograph') : 'No note')
  )
}
const meta = (o: SavedObservation) =>
  [
    o.location ? locationLabel(o.location) : 'No location',
    o.severity ? severityLabel(o.severity) : 'No severity',
  ].join(' · ')

/** Returns the picker dialog; onPick gets the chosen observation. */
export function LinkObservationPicker({
  reference,
  onClose,
  onPick,
}: {
  reference: string
  onClose: () => void
  onPick: (observation: SavedObservation) => void
}) {
  const [all, setAll] = useState<SavedObservation[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    listObservations(reference, abort.signal)
      // One already answering another checklist item is not offered.
      .then((list) => setAll(list.filter((o) => !o.checklistItem)))
      .catch(() => !abort.signal.aborted && setFailed(true))
    return () => abort.abort()
  }, [reference])
  const q = query.trim().toLowerCase()
  const shown = (all ?? []).filter(
    (o) => !q || `${snippet(o)} ${meta(o)}`.toLowerCase().includes(q),
  )
  return (
    <Dialog title="Link an observation" width={520} onClose={onClose}>
      <Input
        iconLeft="search"
        aria-label="Search observations"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {failed ? (
        <p className="cl-note" role="alert">
          The observations could not be loaded.
        </p>
      ) : all === null ? (
        <p className="cl-note" role="status">
          Loading...
        </p>
      ) : shown.length === 0 ? (
        <p className="cl-note">
          {all.length === 0 ? 'There are no observations to link yet.' : 'Nothing matches.'}
        </p>
      ) : (
        <ul className="cl-obs-list" aria-label="Observations">
          {shown.map((o) => (
            <li key={o.id}>
              <button type="button" className="cl-obs" onClick={() => onPick(o)}>
                <span className="cl-obs-note">{snippet(o)}</span>
                <span className="cl-obs-meta">{meta(o)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
