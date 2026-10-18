// The source panel's Passage tab (CB-02 AC1, AC3, AC4; CB-01 AC2, AC14): the document, its
// edition and page, a newer edition if there is one, whether the quoted words were found, and
// the passage with them highlighted. Jesper (18 Oct): only these, in this order.
// Used by CitationPanel. The highlight comes from PassageText.
import type { ReactNode } from 'react'
import { Badge, Callout, Icon, IconRegistry } from '../../../design-system'
import { calendarDate } from '../../knowledge-base/display'
import type { SelectedCitation } from './citationSelection'
import type { DocSummary } from './documents'
import { PassageText } from './PassageText'

type Props = {
  number: number
  doc?: DocSummary
  withdrawn: boolean
  /** The cited page or pages, e.g. "30" or "50–52"; null when the check gave none. */
  range: string | null
  state: SelectedCitation['state']
  quote: string
  passageText: string | null
  /** Shown instead of the passage while it loads or when it can't be loaded. */
  status: ReactNode
}

/** The citation's details above its passage, the quoted words highlighted. */
export function PassageDetails(props: Props) {
  const { number, doc, withdrawn, range, state, quote, passageText, status } = props
  const many = Boolean(range?.includes('–'))
  const where = range ? `${many ? 'pages' : 'page'} ${range}` : 'the passage'

  return (
    <div className="chat-details">
      <div className="chat-details-head">
        <span className="rv-index">{number}</span>
        {/* CB-01 AC14: a withdrawn edition stays labelled. */}
        {withdrawn && (
          <Badge tone="danger" icon={IconRegistry.action.withdraw}>
            Withdrawn
          </Badge>
        )}
      </div>
      <h3>{doc ? doc.title : 'Document details loading'}</h3>
      <dl className="rv-meta">
        {doc?.kind === 'standard' && doc.edition && (
          <>
            <dt>Edition</dt>
            <dd>{doc.edition}</dd>
          </>
        )}
        {doc?.kind === 'report' && doc.date && (
          <>
            <dt>Report date</dt>
            <dd>{calendarDate(doc.date)}</dd>
          </>
        )}
        <dt>{many ? 'Pages' : 'Page'}</dt>
        <dd>{range ?? 'Not recorded'}</dd>
      </dl>
      {doc?.newerEdition && (
        <Callout tone="warning">
          Newer edition:{' '}
          <strong>
            {doc.newerEdition.title}
            {doc.newerEdition.edition ? ` (${doc.newerEdition.edition})` : ''}
          </strong>
        </Callout>
      )}
      {state === 'verified' && (
        <p className="chat-check">
          <Icon name={IconRegistry.action.accept} size={14} color="var(--status-low-fg)" />
          <span>
            Found on <strong>{where}</strong>
          </span>
        </p>
      )}
      {state === 'checking' && <p className="rv-viewer-note">Checking {where}…</p>}
      {/* CB-01 AC2: nothing is highlighted then, so the quoted words are shown instead. */}
      {state === 'unverified' && (
        <Callout tone="danger" title={`Not found on ${where}`}>
          “{quote}” Check the source before relying on this statement.
        </Callout>
      )}
      {status ?? <PassageText text={passageText ?? ''} quote={quote} />}
    </div>
  )
}
