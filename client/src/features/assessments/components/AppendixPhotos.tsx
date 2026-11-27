// Appendix A in the Review tab (GN-07 AC5-AC12). Rendered by
// screens/ReviewWorkspace.tsx; saves through useAppendix.ts.
import type * as React from 'react'
import { Badge, Button, Callout, CountPill, EmptyState, Icon } from '../../../design-system'
import type { AppendixPhoto } from '../api'
import { useAppendix } from '../useAppendix'
import { AppendixRow } from './AppendixRow'

// A new appendix photo's caption until the engineer rewrites it: where it was
// taken and its category, or just the one known, or its file name.
const defaultCaption = (p: AppendixPhoto) =>
  [p.location, p.category].filter(Boolean).join(' — ') || p.name

// Appendix A "Site Photos" (GN-07 AC5-AC12): the chosen photos in report
// order, each with its caption, and every photo of the report to choose from.
// Each change shows at once and saves the whole list (useAppendix). Reordering is by
// buttons, not dragging, so it works from the keyboard.
export function AppendixPhotos({
  reference,
  canEdit,
  page = false,
  after,
}: {
  reference: string
  canEdit: boolean
  // What the engineer wrote in Appendix A in the document editor, ending the page.
  after?: React.ReactNode
  // Review's look: the chosen photos and the photos to choose from as two subsections of the
  // report's page (review.css .rv-sub). The document editor keeps the cards.
  page?: boolean
}) {
  const { appendix, error, save } = useAppendix(reference)
  if (!appendix)
    return error ? (
      <Callout tone="danger" title="Appendix A could not be loaded">
        {error}
      </Callout>
    ) : (
      <p className="rv-muted">Loading…</p>
    )

  const { selected, available } = appendix
  const entries = selected.map(({ photoId, caption }) => ({ photoId, caption }))
  const add = (p: AppendixPhoto) =>
    save([...entries, { photoId: p.photoId, caption: defaultCaption(p) }])
  const remove = (id: string) => save(entries.filter((e) => e.photoId !== id))
  // Swaps a photo with its neighbour: -1 up, +1 down.
  const move = (index: number, by: -1 | 1) => {
    const next = [...entries]
    ;[next[index], next[index + by]] = [next[index + by], next[index]]
    save(next)
  }
  const recaption = (id: string, caption: string) =>
    save(entries.map((e) => (e.photoId === id ? { ...e, caption } : e)))

  const chosenList = (
    <ol className="rv-appendix-list">
      {selected.map((p, i) => (
        <AppendixRow
          key={p.photoId}
          photo={p}
          canEdit={canEdit}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < selected.length - 1 ? () => move(i, 1) : undefined}
          onRemove={() => remove(p.photoId)}
          onCaption={(c) => recaption(p.photoId, c)}
        />
      ))}
    </ol>
  )
  const availableList = (
    <ul className="rv-appendix-grid">
      {available.map((p) => (
        <li key={p.photoId}>
          <figure className="rv-appendix-photo">
            <img src={p.url} alt="" loading="lazy" />
            <figcaption>
              <span className="rv-appendix-name">{p.name}</span>
              {p.location && <span>{p.location}</span>}
              {p.category && <span>{p.category}</span>}
              {p.note && <span className="rv-muted rv-appendix-note">{p.note}</span>}
              {p.selected ? (
                <Badge tone="low" icon="check">
                  In appendix
                </Badge>
              ) : (
                canEdit && (
                  <Button
                    pill
                    variant="secondary"
                    size="sm"
                    iconLeft="plus"
                    aria-label={`Add ${p.name} to the appendix`}
                    onClick={() => add(p)}
                  >
                    Add to appendix
                  </Button>
                )
              )}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  )
  const noPhotos = 'No photographs yet. They appear here once saved with an observation.'

  if (page)
    return (
      <>
        {error && (
          <Callout tone="danger" title="Not saved">
            {error}
          </Callout>
        )}
        <div className="rv-page">
          <section aria-label="In Appendix A" className="rv-sub">
            <div className="rv-sub-head">
              <h3 className="rv-sub-heading">In Appendix A</h3>
              <CountPill>{selected.length}</CountPill>
            </div>
            {selected.length === 0 ? (
              <p className="rv-sub-note">
                <Icon name="image" size={14} />
                <span>
                  <strong>No photos in Appendix A</strong>
                  {available.length ? ' · Add them from the photos below.' : ''}
                </span>
              </p>
            ) : (
              chosenList
            )}
            <p className="rv-sub-note rv-sub-foot">
              <Icon name="info" size={14} />
              <span>
                Only the photos chosen here appear in Appendix A, in this order, each with its
                caption.
              </span>
            </p>
          </section>
          <section aria-label="Available photos" className="rv-sub">
            <div className="rv-sub-head">
              <h3 className="rv-sub-heading">Available photos</h3>
              <CountPill>{available.length}</CountPill>
            </div>
            {available.length === 0 ? <p className="rv-sub-note">{noPhotos}</p> : availableList}
          </section>
          {after}
        </div>
      </>
    )

  return (
    <>
      <p className="rv-muted">
        Only the photos chosen here appear in Appendix A, in this order, each with its caption.
      </p>
      {error && (
        <Callout tone="danger" title="Not saved">
          {error}
        </Callout>
      )}
      <section aria-label="In Appendix A" className="rv-subsection-note">
        <strong>In Appendix A</strong>
        {selected.length === 0 ? (
          <EmptyState
            icon="image"
            title="No photos in Appendix A"
            description="Add photos from the list below."
          />
        ) : (
          chosenList
        )}
      </section>
      <section aria-label="Available photos" className="rv-subsection-note">
        <strong>Available photos</strong>
        {available.length === 0 ? <p className="rv-muted">{noPhotos}</p> : availableList}
      </section>
    </>
  )
}
