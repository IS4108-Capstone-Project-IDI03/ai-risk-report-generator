// The source panel's Passage tab (CB-02 AC1, AC3, AC4; CB-01 AC2, AC14): the document, its
// edition and page, a newer edition if there is one, whether the quoted words were found, and
// the passage with them highlighted. Jesper (18 Oct): only these, in this order.
// Used by CitationPanel. Above the text, the part of the original page a table, formula or
// picture was read from (KB-02); the text, its formulas and highlight come from PassageBody.
import type { ReactNode } from 'react'
import { Badge, Callout, Fact, FactList, Icon, IconRegistry } from '../../../design-system'
import { calendarDate } from '../../knowledge-base/display'
import { Tip } from '../../help/Tip'
import { CitedImage } from '../../sources/CitedImage'
import { CitedRegion } from '../../sources/CitedRegion'
import { PassageBody } from '../../sources/PassageBody'
import { useFoldedText } from '../../sources/useFoldedText'
import type { Passage } from '../api'
import type { SelectedCitation } from './citationSelection'
import type { DocSummary } from './documents'

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
  /** Names the source when it is not a knowledge-base document (an attached PDF, CB-09). */
  title?: string
  /** The part of the original page the passage was read from, if it records one (KB-02). */
  region?: Passage['region']
  /** The passage holds a model's description of a picture (IN-13). */
  generated?: boolean
  /** A manually entered clause (IN-18): no page; its screenshots stand in for the page. */
  manual?: boolean
  /** The clause's screenshots' addresses (IN-18). */
  images?: string[]
}

/** The citation's details above its passage, the quoted words highlighted. */
export function PassageDetails(props: Props) {
  const { number, doc, withdrawn, range, state, quote, passageText, status, title } = props
  const { region, generated, manual = false, images = [] } = props
  const fold = useFoldedText(region ?? null, images.length > 0)
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
        {manual && <Badge tone="neutral">Manual entry</Badge>}
      </div>
      <h3>{title ?? (doc ? doc.title : 'Document details loading')}</h3>
      {/* The v2 fact list, as the knowledge base's document panel shows a document's details. */}
      <FactList>
        {doc?.kind === 'standard' && doc.edition && <Fact label="Edition">{doc.edition}</Fact>}
        {doc?.kind === 'report' && doc.date && (
          <Fact label="Report date">{calendarDate(doc.date)}</Fact>
        )}
        {/* A manual clause has no page (IN-18). */}
        {!manual && <Fact label={many ? 'Pages' : 'Page'}>{range ?? 'Not recorded'}</Fact>}
      </FactList>
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
      {/* KB-02: the words are only in a picture's AI description, so they are cited but
          never "found" in the document; the highlight below shows them in the description. */}
      {state === 'described' && (
        <Callout tone="info">
          From the AI's reading of the figure on {where}, not the document's printed text. Check the
          figure.
        </Callout>
      )}
      {/* CB-01 AC2: nothing is highlighted then, so the quoted words are shown instead. */}
      {state === 'unverified' && (
        <Callout
          tone="danger"
          title={
            <span className="chat-check-tip">
              {`Not found on ${where}`}
              <Tip id="chat.citation-unverified" />
            </span>
          }
        >
          “{quote}” Check the source before relying on this statement.
        </Callout>
      )}
      {!status && doc?.fileUrl && (
        <CitedRegion fileUrl={doc.fileUrl} region={region} quote={quote} onDrawn={fold.onDrawn} />
      )}
      {!status && <CitedImage urls={images} alt="Screenshot" />}
      {/* KB-02 AC6: the description is shown, as what the answer read, but never as the
          document's words; a quote of it is never found (rag-service quotable_text). */}
      {!status && generated && (
        <p className="rv-viewer-note">
          The picture's description was written by AI, not printed in the document.
        </p>
      )}
      {status ?? <PassageBody text={passageText ?? ''} quote={quote} folded={fold.folded} />}
    </div>
  )
}
