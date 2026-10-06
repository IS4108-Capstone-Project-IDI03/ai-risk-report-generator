import { useEffect, useRef } from 'react'
import { Badge, EvidenceCitation, IconButton, IconRegistry } from '../../../design-system'
import { calendarDate } from '../../knowledge-base/display'
import type { FieldObservation, ReviewSection, SourcePassage } from '../api'
import { formatDay } from '../format'
import {
  claimsOf,
  excerpt,
  pageLocator,
  pages,
  severityLabel,
  type ReviewFocus,
} from '../reviewDisplay'
import { CitationMark } from './CitationMark'

// How a source listed below the viewer looks while it is open above.
const OPEN_STYLE = {
  border: '1px solid var(--border-focus)',
  background: 'var(--surface-selected)',
}
const LAST = Number.MAX_SAFE_INTEGER

function ViewerHead({
  number,
  children,
  onClose,
}: {
  number: number | undefined
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="rv-viewer-head">
      {number != null && <span className="rv-index">{number}</span>}
      {children}
      <span />
      <IconButton icon="x" label="Close source" size="sm" onClick={onClose} />
    </div>
  )
}

// A cited passage exactly as the draft was given it (AC7), with its page
// (AC8) and its document's title, edition, effective date and any
// withdrawal (AC9-AC12).
function PassageView({
  passage,
  number,
  onClose,
}: {
  passage: SourcePassage
  number: number | undefined
  onClose: () => void
}) {
  const doc = passage.document
  const precedent = passage.kind === 'precedent'
  const range = pages(passage)
  return (
    <>
      <ViewerHead number={number} onClose={onClose}>
        <Badge
          tone={precedent ? 'neutral' : 'info'}
          icon={precedent ? IconRegistry.evidence.report : IconRegistry.evidence.standard}
        >
          {precedent ? 'Past report' : 'External standard'}
        </Badge>
        {doc?.withdrawnAt && (
          <Badge tone="danger" icon={IconRegistry.action.withdraw}>
            Withdrawn
          </Badge>
        )}
      </ViewerHead>
      <h3>{doc ? doc.title : 'Document details not found'}</h3>
      <dl className="rv-meta">
        {doc ? (
          <>
            <dt>Issued by</dt>
            <dd>{doc.issuingBody}</dd>
            {doc.edition && (
              <>
                <dt>Edition</dt>
                <dd className="rv-mono">{doc.edition}</dd>
              </>
            )}
            {/* The knowledge base records a past report's date in the same field. */}
            <dt>{precedent ? 'Report date' : 'Effective date'}</dt>
            <dd className="rv-mono">{calendarDate(doc.effectiveDate)}</dd>
            {doc.withdrawnAt && (
              <>
                <dt>Withdrawn</dt>
                <dd className="rv-mono">{formatDay(new Date(doc.withdrawnAt))}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>Document</dt>
            <dd className="rv-mono">{passage.documentId ?? 'Not recorded'}</dd>
          </>
        )}
        {passage.headings.length > 0 && (
          <>
            <dt>Heading</dt>
            <dd>{passage.headings.join(' › ')}</dd>
          </>
        )}
        <dt>{range?.includes('–') ? 'Pages' : 'Page'}</dt>
        <dd className="rv-mono">{range ?? 'Not recorded'}</dd>
      </dl>
      {/* Focusable, since a long passage scrolls on its own. */}
      <blockquote className="rv-passage" tabIndex={0} aria-label="Passage text">
        {passage.text}
      </blockquote>
      {doc?.withdrawnAt && (
        <p className="rv-viewer-note">
          This source has been withdrawn from the knowledge base, so search no longer uses it. Check
          whether the statements citing it still stand.
        </p>
      )}
      {precedent && (
        <p className="rv-viewer-note">
          Past reports describe other sites. They show wording and precedent only, so a statement
          resting on one alone is marked Unsupported.
        </p>
      )}
      {doc ? (
        <a
          className="rv-viewer-link"
          href={doc.fileUrl + (passage.pageStart != null ? `#page=${passage.pageStart}` : '')}
          target="_blank"
          rel="noreferrer"
        >
          Open the original PDF
          {passage.pageStart != null ? ` at page ${passage.pageStart}` : ''}
        </a>
      ) : (
        <p className="rv-viewer-note">
          This document has no record in the knowledge base, so its title, edition and dates cannot
          be shown.
        </p>
      )}
    </>
  )
}

// A field observation quoted exactly as the draft was given it.
function ObservationView({
  observation: o,
  number,
  onClose,
}: {
  observation: FieldObservation
  number: number | undefined
  onClose: () => void
}) {
  return (
    <>
      <ViewerHead number={number} onClose={onClose}>
        <Badge tone="neutral" icon={IconRegistry.evidence.observation}>
          Site observation
        </Badge>
      </ViewerHead>
      <h3>{o.location ?? 'Location not recorded'}</h3>
      <dl className="rv-meta">
        <dt>Category</dt>
        <dd>{o.copeDimension}</dd>
        <dt>Severity</dt>
        <dd>{severityLabel(o.severity)}</dd>
        {o.standard && (
          <>
            <dt>Standard</dt>
            <dd>{o.standard}</dd>
          </>
        )}
      </dl>
      {o.note && (
        <>
          <span className="rv-passage-label">Note</span>
          <blockquote className="rv-passage">{o.note}</blockquote>
        </>
      )}
      {o.transcripts.map((t, i) => (
        <div key={i}>
          <span className="rv-passage-label">Voice transcript</span>
          <blockquote className="rv-passage">{t}</blockquote>
        </div>
      ))}
      <p className="rv-viewer-note">As captured when this section was drafted.</p>
    </>
  )
}

function ObservationText({
  observation: o,
  section,
}: {
  observation: FieldObservation
  section: ReviewSection
}) {
  return (
    <>
      {/* One filed elsewhere is here because the draft cites it. */}
      {!section.copeDimensions.includes(o.copeDimension) && (
        <span className="rv-block rv-block-label">Filed under {o.copeDimension}</span>
      )}
      {o.note && <span className="rv-block">{o.note}</span>}
      {o.transcripts.map((t, i) => (
        <span key={i} className="rv-block">
          <span className="rv-block-label">Voice transcript · </span>
          {t}
        </span>
      ))}
    </>
  )
}

// The reference source panel of the review workspace (RV-01 AC2), beside the
// draft. A selected citation opens at the top. Below it are every passage the
// draft cites, the original field observations (AC3), and every claim with
// its citations (AC4).
export function SourcePanel({
  section,
  numbers,
  focus,
  describe,
  onCite,
  onShowClaim,
  style,
}: {
  section: ReviewSection
  numbers: Map<string, number>
  focus: ReviewFocus
  describe: (citation: string) => string
  onCite: (citation: string | null, statement: string | null) => void
  onShowClaim: (claim: string) => void
  style: React.CSSProperties
}) {
  const viewer = useRef<HTMLElement>(null)
  const open = focus.citation
  // Brings an opened source into view, also when the panel sits below the draft.
  useEffect(() => {
    if (open) viewer.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])

  const numberOf = (id: string) => numbers.get(id) ?? LAST
  const passages = Object.values(section.sources).sort((a, b) => numberOf(a.id) - numberOf(b.id))
  const observations = [...section.observations].sort(
    (a, b) => numberOf(`O:${a.id}`) - numberOf(`O:${b.id}`),
  )
  const claims = section.draft ? claimsOf(section.draft) : []
  const unsupported = claims.filter((c) => !c.supported).length
  const close = () => onCite(null, focus.statement)

  const passage = open ? section.sources[open] : undefined
  const observation = open?.startsWith('O:')
    ? section.observations.find((o) => o.id === open.slice(2))
    : undefined

  return (
    <aside aria-label="Source panel" className="om-scroll" style={style}>
      <div className="rv-panel-section">
        {!open ? (
          <div className="rv-viewer is-empty">
            <p className="rv-muted">
              {!section.draft
                ? 'This section has no draft, so nothing is cited yet.'
                : numbers.size
                  ? 'Select a citation number in the draft to open its source here.'
                  : 'This draft cites nothing.'}
            </p>
          </div>
        ) : (
          <article
            ref={viewer}
            className="rv-viewer"
            aria-label={passage ? 'Source passage' : observation ? 'Field observation' : 'Citation'}
          >
            {passage ? (
              <PassageView passage={passage} number={numbers.get(open)} onClose={close} />
            ) : observation ? (
              <ObservationView
                observation={observation}
                number={numbers.get(open)}
                onClose={close}
              />
            ) : (
              <>
                <ViewerHead number={numbers.get(open)} onClose={close}>
                  <Badge tone="moderate" icon="triangle-alert">
                    Not found
                  </Badge>
                </ViewerHead>
                <h3>This citation could not be found</h3>
                <p className="rv-viewer-note">
                  The draft cites <span className="rv-mono">{open}</span>, which is not among the
                  evidence saved with it. The statement citing it is marked Unsupported.
                </p>
              </>
            )}
          </article>
        )}
      </div>

      <section className="rv-panel-section" aria-label="Reference sources">
        <div className="rv-panel-head">
          <h3 className="rv-label">Reference sources</h3>
          <span className="rv-mono">{passages.length}</span>
        </div>
        {passages.length ? (
          <ul className="rv-panel-list">
            {passages.map((p) => (
              <li key={p.id}>
                <EvidenceCitation
                  index={numbers.get(p.id)}
                  kind={p.kind === 'precedent' ? 'report' : 'standard'}
                  source={
                    <>
                      {p.document?.title ?? p.documentId ?? 'Document not found'}
                      {p.document?.withdrawnAt && (
                        <span className="rv-flag">
                          <Badge tone="danger">Withdrawn</Badge>
                        </span>
                      )}
                    </>
                  }
                  locator={pageLocator(p) ?? undefined}
                  excerpt={excerpt(p.text)}
                  onOpen={() => onCite(p.id, null)}
                  style={open === p.id ? OPEN_STYLE : undefined}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rv-muted">
            {section.draft ? 'The draft cites no standards or past reports.' : 'None yet.'}
          </p>
        )}
      </section>

      <section className="rv-panel-section" aria-label="Original observations">
        <div className="rv-panel-head">
          <h3 className="rv-label">Original observations</h3>
          <span className="rv-mono">{observations.length}</span>
        </div>
        {observations.length ? (
          <ul className="rv-panel-list">
            {observations.map((o) => (
              <li key={o.id}>
                <EvidenceCitation
                  index={numbers.get(`O:${o.id}`)}
                  kind="observation"
                  source={o.location ?? 'Location not recorded'}
                  locator={severityLabel(o.severity)}
                  excerpt={<ObservationText observation={o} section={section} />}
                  onOpen={() => onCite(`O:${o.id}`, null)}
                  style={open === `O:${o.id}` ? OPEN_STYLE : undefined}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rv-muted">
            {section.draft
              ? `No observations under ${section.copeDimensions.join(' or ')} went into this draft.`
              : 'None yet.'}
          </p>
        )}
      </section>

      <section className="rv-panel-section" aria-label="Claims">
        <div className="rv-panel-head">
          <h3 className="rv-label">Claims</h3>
          <span className="rv-mono">
            {claims.length}
            {unsupported ? ` · ${unsupported} unsupported` : ''}
          </span>
        </div>
        {claims.length ? (
          <ol className="rv-panel-list">
            {claims.map((c, n) => (
              <li
                key={c.key}
                className={'rv-claim' + (focus.statement === c.key ? ' is-active' : '')}
              >
                <div className="rv-claim-heading">
                  <span>
                    {n + 1}. {c.heading}
                  </span>
                  {!c.supported && (
                    <Badge tone="moderate" icon="triangle-alert">
                      Unsupported
                    </Badge>
                  )}
                </div>
                <button
                  type="button"
                  className="rv-claim-text"
                  title="Show this statement in the draft"
                  onClick={() => onShowClaim(c.key)}
                >
                  <span>{c.text}</span>
                </button>
                <div className="rv-claim-cites">
                  {c.citations.length ? 'Cites' : 'Cites nothing'}
                  {c.citations.map((id, k) => (
                    <CitationMark
                      key={k}
                      number={numbers.get(id)!}
                      label={describe(id)}
                      current={open === id}
                      onSelect={() => onCite(id, c.key)}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rv-muted">{section.draft ? 'The draft makes no claims.' : 'None yet.'}</p>
        )}
      </section>
    </aside>
  )
}
