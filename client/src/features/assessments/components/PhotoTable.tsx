// The shared body of All Photos, All Handwritten Pages (CP-22 round 3) and All
// Recordings (CP-12): a table with one row per item: a thumbnail (opens it full
// size to zoom), the observation, its location and its category. A tap
// anywhere else on the row opens the observation (round 6), as a row of the
// Observations table does. The count sits in the toolbar above the rows. On a
// phone each row stacks. Rendered by screens/Photos.tsx, screens/Scans.tsx,
// components/RecordingTable.tsx (with a play tile for the thumbnail) and the
// site walk proposal's ProposalMedia.tsx.
//
// A row given an `item` also shows, under the observation's text, the item's
// own line (CP-12): its name, where its transcription stands, with Retry, and
// its transcript or description, opened with a toggle. A site walk
// proposal's rows have none, so they stay as they were.
//
// Given a `search` (CP-13), the toolbar has a search box: only the rows whose
// item text, name or observation text hold every word are listed, the count
// says how many of how many, the words are marked, and a row found in its
// own text opens that text. The query is kept by the caller, so it is still
// there after Back from an observation.
import type { ReactNode } from 'react'
import { EmptyState, Icon, SearchField } from '../../../design-system'
import type { TranscriptionStatus } from '../api'
import { rowMatches, searchWords, textHits } from '../evidenceSearch'
import type { Place } from '../locations'
import { plural } from '../reviewDisplay'
import { useOpenRows, type OpenRows } from '../useOpenRows'
import { HitText } from './HitText'
import { LocationPath } from './LocationPath'
import { ZoomBadge } from './ZoomBadge'
import { CategoryMark } from './ObservationMarks'

export type PhotoRow = {
  key: string
  name: string
  url?: string | null
  // Its location as one line, named in the photo's popup.
  where: string
  text: string
  cats: string[]
  path: Place & { bare?: boolean }
  openObservation: () => void
  item?: RowItem
}
export type RowItem = {
  // A recording's or page's transcription; null for a photo, or a demo page.
  status?: TranscriptionStatus | null
  // Starts a new transcription attempt; offered only when it failed.
  retry?: (() => void) | null
  // Its text, shown under the row when opened: "Transcript" or "Description",
  // with a search's words marked.
  detail?: { label: string; body: (words: readonly string[]) => ReactNode } | null
  // The text a search looks in, besides the observation's text and the name:
  // the transcript or description, when there is one to find words in.
  searchText?: string | null
}
// The search box over the rows (CP-13). `noun` is one row, e.g. "recording".
export type RowSearch = {
  query: string
  onQuery: (query: string) => void
  noun: string
  label: string
}

export function PhotoTable<R extends PhotoRow>({
  label,
  rows,
  count,
  onOpen,
  lead,
  extra,
  openRows,
  search,
}: {
  label: string
  rows: R[]
  // e.g. "3 photos across 2 locations", shown in the toolbar.
  count: string
  onOpen?: (row: R & { url: string }) => void
  // In place of the thumbnail, e.g. a recording's play tile.
  lead?: (row: R) => ReactNode
  // Under the item's line, e.g. the playing recording's seek bar.
  extra?: (row: R) => ReactNode
  openRows?: OpenRows
  search?: RowSearch
}) {
  const words = searchWords(search?.query ?? '')
  // Back with a search, the texts it found open again.
  const own = useOpenRows(() => textHits(rows, words))
  const { open, toggle, showAll } = openRows ?? own
  const shown = words.length ? rows.filter((r) => rowMatches(r, words)) : rows
  const onQuery = (query: string) => {
    search?.onQuery(query)
    showAll(textHits(rows, searchWords(query)))
  }
  return (
    <div className="ob-card">
      <div className="ob-filters">
        {search && (
          <SearchField
            className="ob-search"
            label={search.label}
            placeholder={search.label}
            value={search.query}
            onChange={(e) => onQuery(e.target.value)}
          />
        )}
        <span className="ob-count">
          {words.length ? `${shown.length} of ${plural(rows.length, search!.noun)}` : count}
        </span>
      </div>
      {words.length > 0 && shown.length === 0 && (
        <div className="ob-empty">
          <EmptyState
            icon="search"
            title={`No ${search!.noun}s match “${search!.query.trim()}”`}
            description="Try fewer words, or check the spelling."
            action={
              <button
                type="button"
                className="ob-button ob-button--tinted ob-button--small"
                onClick={() => onQuery('')}
              >
                Clear search
              </button>
            }
          />
        </div>
      )}
      <div role="group" aria-label={label} hidden={shown.length === 0}>
        <div className="ob-pt-head ob-pt-grid" aria-hidden="true">
          <span />
          <span>Observation</span>
          <span>Location</span>
          <span>Category</span>
          <span />
        </div>
        <ul className="ob-pt-list">
          {shown.map((r) => (
            <li key={r.key} className="ob-pt-grid ob-pt-row">
              {lead ? (
                lead(r)
              ) : r.url && onOpen ? (
                <button
                  type="button"
                  className="ob-pt-thumb"
                  aria-label={'Open ' + r.name}
                  onClick={() => onOpen({ ...r, url: r.url! })}
                >
                  {/* shortcut: loads the original; serve smaller copies if photo lists grow long. */}
                  <img src={r.url} alt="" loading="lazy" />
                  <ZoomBadge />
                </button>
              ) : (
                <span className="ob-pt-thumb">
                  <Icon name="image" size={22} color="var(--text-muted)" />
                </span>
              )}
              {r.item ? (
                <div className="ob-pt-main">
                  <button type="button" className="ob-pt-text" onClick={r.openObservation}>
                    <HitText text={r.text} words={words} />
                  </button>
                  <ItemLine
                    rowKey={r.key}
                    name={r.name}
                    words={words}
                    item={r.item}
                    open={open.has(r.key)}
                    onToggle={() => toggle(r.key)}
                  />
                  {extra?.(r)}
                  {r.item.detail && open.has(r.key) && (
                    <div id={detailId(r.key)} className="ob-pt-detail ob-pt-above">
                      {r.item.detail.body(words)}
                    </div>
                  )}
                </div>
              ) : (
                <button type="button" className="ob-pt-text" onClick={r.openObservation}>
                  {r.text}
                </button>
              )}
              <span className="ob-pt-where">
                <LocationPath {...r.path} />
              </span>
              <span className="ob-pt-cat">
                <CategoryMark cats={r.cats} />
                <span>{r.cats.join(', ') || 'Uncategorised'}</span>
              </span>
              <span className="ob-pt-go" aria-hidden="true">
                <Icon name="chevron-right" size={16} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const detailId = (key: string) => 'ob-pt-detail-' + key.replace(/[^\w-]/g, '-')

// The item's own line: its name, where its transcription stands (with Retry
// after a failure), and the toggle for its text.
function ItemLine({
  rowKey,
  name,
  words,
  item,
  open,
  onToggle,
}: {
  rowKey: string
  name: string
  words: readonly string[]
  item: RowItem
  open: boolean
  onToggle: () => void
}) {
  return (
    <p className="ob-pt-meta">
      <span className="ob-pt-name">
        <HitText text={name} words={words} />
      </span>
      {item.status === 'transcribing' && (
        <span className="ob-pt-state">
          <Icon name="loader-circle" size={14} className="ob-spin" />
          Transcribing
        </span>
      )}
      {item.status === 'failed' && (
        <span className="ob-pt-state ob-pt-state--failed">
          <Icon name="circle-alert" size={14} />
          Couldn’t transcribe
        </span>
      )}
      {item.status === 'failed' && !!item.retry && (
        <button
          type="button"
          className="ob-button ob-button--tinted ob-button--small ob-pt-above"
          onClick={item.retry}
        >
          Retry
        </button>
      )}
      {!!item.detail && (
        <button
          type="button"
          className="ob-pt-toggle ob-pt-above"
          // Starts with the word shown, and says whose text it is.
          aria-label={item.detail.label + ' of ' + name}
          aria-expanded={open}
          aria-controls={open ? detailId(rowKey) : undefined}
          onClick={onToggle}
        >
          {item.detail.label}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
      )}
    </p>
  )
}
