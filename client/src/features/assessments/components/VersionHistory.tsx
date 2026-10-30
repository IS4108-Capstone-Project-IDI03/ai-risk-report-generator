import { Fragment, useState } from 'react'
import { Badge, Button, Callout, EmptyState, IconRegistry } from '../../../design-system'
import {
  GatewayError,
  restoreSectionVersion,
  type ReviewWorkspace,
  type SectionDocument,
  type SectionHistoryEntry,
  type SectionVersion,
} from '../api'
import { contentCitationNumbers } from '../documentContent'
import { formatDayYearTime } from '../format'
import { restoredLabel, versionLabel, versionOrigin } from '../reviewDisplay'
import { useSectionHistory } from '../useSectionHistory'
import {
  diffSections,
  sameText,
  wordsUnchanged,
  type DiffBlock,
  type DiffSegment,
  type DiffShape,
  type DiffStatus,
  type DiffToken,
} from '../versionDiff'
import { RestoreVersionDialog } from './ReviewDialogs'

// What a restore saved, for the workspace to show (RV-06 AC6).
export type RestoredVersion = {
  version: Omit<SectionVersion, 'current'>
  workspace: ReviewWorkspace
  // What was restored, in a sentence: "version 3", "the AI draft of 19 Oct 10:42".
  name: string
}

// How the comparison reads a citation marker: its number in the section, and
// its source in words, if known.
type Look = { numbers: Map<string, number>; describe?: (citation: string) => string }

// Words as written, in their formatting, each citation marker a numeral. A
// run's leading space is left to whoever places it (`lead` false).
function Words({ tokens, look, lead = true }: { tokens: DiffToken[]; look: Look; lead?: boolean }) {
  return (
    <>
      {tokens.map((t, i) => {
        const space = t.space && (lead || i > 0) ? ' ' : ''
        if (t.kind === 'cite')
          return (
            <Fragment key={i}>
              {space}
              <sup className="rv-diff-cite" title={look.describe?.(t.id)}>
                {look.numbers.get(t.id) ?? '?'}
              </sup>
            </Fragment>
          )
        let text: React.ReactNode = t.text
        if (t.marks.includes('underline')) text = <u>{text}</u>
        if (t.marks.includes('italic')) text = <em>{text}</em>
        if (t.marks.includes('bold')) text = <strong>{text}</strong>
        return (
          <Fragment key={i}>
            {space}
            {text}
          </Fragment>
        )
      })}
    </>
  )
}

// One run of a compared block: added text inserted (AC3), deleted text struck
// through (AC4), and changed text as the words deleted beside those added in
// their place, marked as one change (AC5).
function Segment({ segment, look }: { segment: DiffSegment; look: Look }) {
  if (segment.op === 'same') return <Words tokens={segment.tokens} look={look} />
  if (segment.op === 'changed')
    return (
      <>
        {segment.from[0]?.space ? ' ' : ''}
        <span className="rv-diff-change">
          <span className="rv-sr">Changed from </span>
          <del>
            <Words tokens={segment.from} look={look} lead={false} />
          </del>
          <span className="rv-sr"> to</span>{' '}
          <ins>
            <Words tokens={segment.to} look={look} lead={false} />
          </ins>
        </span>
      </>
    )
  const Mark = segment.op === 'added' ? 'ins' : 'del'
  return (
    <>
      {segment.tokens[0]?.space ? ' ' : ''}
      <Mark>
        <Words tokens={segment.tokens} look={look} lead={false} />
      </Mark>
    </>
  )
}

const SHAPE_NAME: Record<DiffShape, string> = {
  paragraph: 'a paragraph',
  heading: 'a sub-heading',
  bulletList: 'a bulleted list item',
  orderedList: 'a numbered list item',
}
const STATUS_TAG: Record<Exclude<DiffStatus, 'same'>, string> = {
  added: 'Added',
  deleted: 'Deleted',
  changed: 'Changed',
}

// One paragraph, sub-heading or list item of the comparison, tagged with
// what happened to it.
function Block({ block, look }: { block: DiffBlock; look: Look }) {
  const note =
    block.status !== 'changed'
      ? null
      : block.shapeWas
        ? `set as ${SHAPE_NAME[block.shape]}, was ${SHAPE_NAME[block.shapeWas]}`
        : wordsUnchanged(block)
          ? 'moved'
          : null
  const list =
    block.shape === 'bulletList' ? ' is-bullet' : block.shape === 'orderedList' ? ' is-ordered' : ''
  return (
    <div className={`rv-diff-block is-${block.status}${list}`}>
      {block.status !== 'same' && (
        <span className="rv-diff-tag">
          {STATUS_TAG[block.status]}
          {note && ` · ${note}`}
        </span>
      )}
      <p className={'rv-diff-text' + (block.shape === 'heading' ? ' is-heading' : '')}>
        {block.segments.map((s, i) => (
          <Segment key={i} segment={s} look={look} />
        ))}
      </p>
    </div>
  )
}

// The older text against the newer: each subsection under its heading, every
// block tagged Added, Deleted or Changed, with the words that changed marked,
// and how many of each above.
function Comparison({
  older,
  newer,
  olderName,
  newerName,
  describe,
}: {
  older: SectionDocument
  newer: SectionDocument
  olderName: string
  newerName: string
  describe?: (citation: string) => string
}) {
  const diff = diffSections(older, newer)
  // Citations numbered in the newer text's order, then the older's own.
  const numbers = contentCitationNumbers(newer)
  for (const [id] of contentCitationNumbers(older))
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1)
  const look = { numbers, describe }
  const { added, deleted, changed } = diff.counts
  return (
    <section className="rv-diff" aria-label="Comparison">
      <p className="rv-diff-summary">
        From {olderName} to {newerName}
      </p>
      <ul className="rv-diff-legend" aria-label="Changes">
        <li>
          <span className="rv-diff-swatch is-added" aria-hidden="true" />
          {added} added
        </li>
        <li>
          <span className="rv-diff-swatch is-deleted" aria-hidden="true" />
          {deleted} deleted
        </li>
        <li>
          <span className="rv-diff-swatch is-changed" aria-hidden="true" />
          {changed} changed
        </li>
      </ul>
      {added + deleted + changed === 0 ? (
        <p className="rv-muted" style={{ margin: 0 }}>
          No differences: the text is the same in both.
        </p>
      ) : (
        diff.parts.map((part) => (
          <div key={part.heading ?? ''} className="rv-diff-part">
            {part.heading && <h4 className="rv-diff-heading">{part.heading}</h4>}
            {part.blocks.map((b, i) => (
              <Block key={i} block={b} look={look} />
            ))}
          </div>
        ))
      )}
    </section>
  )
}

// Who made an entry, and when (AC2): who saved a version, who drafted or
// accepted a draft.
const attribution = (e: SectionHistoryEntry) =>
  [e.by?.name, formatDayYearTime(new Date(e.at))].filter(Boolean).join(' · ')

// A section's version history (RV-06), in place of its draft in the review
// workspace: its AI drafts and the versions saved in the document editor,
// oldest first (AC1), each with who made it and when (AC2), down the side;
// beside them the chosen one compared with the current text, or with the
// version before it, its additions, deletions and changes marked (AC3-AC5);
// and, for the assigned engineer, Restore this version (AC6).
export function VersionHistory({
  reference,
  sectionId,
  title,
  position,
  current,
  describe,
  findings,
  canRestore,
  onClose,
  onRestored,
  onStale,
  panelStyle,
}: {
  reference: string
  sectionId: string
  // e.g. "7. Construction"
  title: string
  // e.g. "9 of 15"
  position: string
  // The section's text as the review workspace shows it; null until loaded.
  current: SectionDocument | null
  describe?: (citation: string) => string
  // Its findings follow a restore (sections 4-12 with a draft).
  findings: boolean
  canRestore: boolean
  onClose: () => void
  onRestored: (restored: RestoredVersion) => void
  // A restore was refused as the section changed since: the workspace reads
  // it again.
  onStale: () => void
  panelStyle: React.CSSProperties
}) {
  const { history, loadError, reload } = useSectionHistory(reference, sectionId)
  const [chosen, setChosen] = useState<string | null>(null)
  const [compare, setCompare] = useState<'current' | 'previous'>('current')
  const [confirming, setConfirming] = useState(false)

  const entries = history?.entries ?? []
  // Opens on the newest entry whose text is not the current text, else the newest.
  const opening =
    (current && [...entries].reverse().find((e) => !sameText(e.document, current))) ||
    entries[entries.length - 1]
  const selected = entries.find((e) => e.id === chosen) ?? opening
  const index = selected ? entries.indexOf(selected) : -1
  const before = index > 0 ? entries[index - 1] : null
  const latest = entries[entries.length - 1]
  const showing = compare === 'previous' && before ? 'previous' : 'current'
  const unchanged = !selected || !current || sameText(selected.document, current)

  const pick = (id: string) => {
    setChosen(id)
    setConfirming(false)
  }

  let body: React.ReactNode
  if (loadError && !history)
    body = (
      <div role="alert">
        <Callout
          tone="danger"
          title="The version history could not be loaded"
          actions={
            <Button
              variant="secondary"
              size="sm"
              iconLeft={IconRegistry.action.regenerate}
              onClick={reload}
            >
              Try again
            </Button>
          }
        >
          {loadError}
        </Callout>
      </div>
    )
  else if (!history || !current) body = <p className="rv-muted">Loading the section's versions…</p>
  else if (!selected)
    body = (
      <EmptyState
        icon={IconRegistry.object.history}
        title="No versions yet"
        description="A version is kept each time the section is drafted, and each time it is saved in the document editor."
      />
    )
  else
    body = (
      <>
        <div className="rv-version-head">
          <div className="rv-version-title">
            <h3>{versionLabel(selected)}</h3>
            <p className="rv-history-by">{attribution(selected)}</p>
            <p className="rv-version-origin">{versionOrigin(selected, entries)}</p>
          </div>
          {canRestore && (
            <Button
              variant="secondary"
              size="sm"
              iconLeft={IconRegistry.action.reinstate}
              disabled={unchanged}
              title={unchanged ? 'Its text is the current text.' : undefined}
              onClick={() => setConfirming(true)}
            >
              Restore this version
            </Button>
          )}
        </div>
        {!selected.onSavedDraft && (
          <Callout tone="info" title="Written on an earlier draft">
            The section has been drafted again since. Restoring it keeps its findings that are in
            the current draft as findings, and restores the rest of its text as your own.
          </Callout>
        )}
        <div className="rv-segmented" role="group" aria-label="Compare with">
          <Button
            variant={showing === 'current' ? 'tonal' : 'ghost'}
            size="sm"
            aria-pressed={showing === 'current'}
            onClick={() => setCompare('current')}
          >
            Current text
          </Button>
          <Button
            variant={showing === 'previous' ? 'tonal' : 'ghost'}
            size="sm"
            aria-pressed={showing === 'previous'}
            disabled={!before}
            onClick={() => setCompare('previous')}
          >
            Version before
          </Button>
        </div>
        {showing === 'previous' && before ? (
          <Comparison
            older={before.document}
            newer={selected.document}
            olderName={restoredLabel(before.id, entries)}
            newerName={restoredLabel(selected.id, entries)}
            describe={describe}
          />
        ) : (
          <Comparison
            older={selected.document}
            newer={current}
            olderName={restoredLabel(selected.id, entries)}
            newerName="the current text"
            describe={describe}
          />
        )}
      </>
    )

  return (
    <>
      <section aria-label="Version history" className="om-scroll rv-editor">
        <div className="rv-editor-inner">
          <div className="rv-editor-bar">
            <p className="rv-label">Version history · {position}</p>
            <Button variant="ghost" size="sm" iconLeft="chevron-left" onClick={onClose}>
              Back to the draft
            </Button>
          </div>
          <h2>{title}</h2>
          {body}
        </div>
      </section>
      <aside aria-label="Versions" className="om-scroll" style={panelStyle}>
        <section className="rv-panel-section" aria-label="Section versions">
          <div className="rv-panel-head">
            <h3 className="rv-label">Versions</h3>
            <span className="rv-mono">{entries.length}</span>
          </div>
          {!history ? (
            <p className="rv-muted">{loadError ? 'Not loaded.' : 'Loading…'}</p>
          ) : !entries.length ? (
            <p className="rv-muted">
              None yet. Drafting the section, and saving it in the document editor, each keep a
              version here, with who made it and when.
            </p>
          ) : (
            <ol className="rv-panel-list rv-version-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="rv-version-row"
                    aria-current={e.id === selected?.id ? 'true' : undefined}
                    onClick={() => pick(e.id)}
                  >
                    <span className="rv-version-name">
                      <strong>{versionLabel(e)}</strong>
                      {e === latest && <Badge tone="info">Latest</Badge>}
                      {!e.onSavedDraft && <Badge tone="neutral">Earlier draft</Badge>}
                    </span>
                    <span className="rv-history-by">{attribution(e)}</span>
                    <span className="rv-version-origin">{versionOrigin(e, entries)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
      {confirming && selected && history && (
        <RestoreVersionDialog
          name={restoredLabel(selected.id, entries)}
          earlierDraft={!selected.onSavedDraft}
          findings={findings}
          onClose={() => setConfirming(false)}
          onRestore={async () => {
            const name = restoredLabel(selected.id, entries)
            try {
              const saved = await restoreSectionVersion(reference, sectionId, {
                baseVersion: history.latestVersion,
                draftId: history.savedDraftId,
                from: selected.id,
              })
              onRestored({ ...saved, name })
            } catch (error: unknown) {
              // Saved or drafted since it was read: read both again, so the
              // engineer sees the newer text and can restore on it.
              if (error instanceof GatewayError && error.status === 409) {
                reload()
                onStale()
              }
              throw error
            }
          }}
        />
      )}
    </>
  )
}
