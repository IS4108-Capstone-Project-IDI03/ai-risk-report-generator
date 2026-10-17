// The source panel beside the conversation (CB-01 AC1, AC2, AC14): the opened citation's
// document, edition, pages and quoted words, and whether those words were found there.
// Shown by screens/KnowledgeAssistant.tsx. CB-02 adds the Passage and PDF tabs and the newer-edition warning.
// Built from the review workspace's source viewer (assessments/review.css), so both read alike.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Badge, Callout, Icon, IconButton, IconRegistry, Tabs } from '../../../design-system'
import { calendarDate } from '../../knowledge-base/display'
import { pages } from '../../assessments/reviewDisplay'
import type { SelectedCitation } from './citationSelection'
import { useDocument } from './documents'
import { PdfErrorBoundary } from './PdfErrorBoundary'
import { PassageText } from './PassageText'
import { usePassage } from './usePassage'

// Loaded on first use of the PDF tab, so pdf.js isn't in the chat's first download.
const PassagePdf = lazy(() => import('./PassagePdf').then((m) => ({ default: m.PassagePdf })))

type Props = { selected: SelectedCitation; onClose: () => void }

/** The opened citation's source, beside the chat. */
export function CitationPanel({ selected, onClose }: Props) {
  const panel = useRef<HTMLElement>(null)
  const { number, quote, state, source } = selected
  const doc = useDocument(source?.documentId)
  // The tab chosen for this citation; a different citation opens on Passage again.
  const [picked, setPicked] = useState<{ for: SelectedCitation; tab: string } | null>(null)
  const tab = picked?.for === selected ? picked.tab : 'passage'
  const loaded = usePassage(source?.passageId)
  // The quote check may omit a page; pages() takes a missing page as null.
  const range =
    source && pages({ pageStart: source.pageStart ?? null, pageEnd: source.pageEnd ?? null })
  const withdrawn = Boolean(source?.withdrawn || doc?.withdrawn)

  // Focus moves into the panel, so a keyboard user lands on what they opened.
  useEffect(() => panel.current?.focus(), [selected])
  // Escape closes it from anywhere, as the review workspace's panel does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside
      ref={panel}
      className="chat-source rv-viewer"
      aria-label={`Source of citation ${number}`}
      tabIndex={-1}
    >
      <div className="rv-viewer-head">
        <span className="rv-index">{number}</span>
        {doc && (
          <Badge
            tone={doc.kind === 'report' ? 'neutral' : 'info'}
            icon={
              doc.kind === 'report' ? IconRegistry.evidence.report : IconRegistry.evidence.standard
            }
          >
            {doc.kind === 'report' ? 'Past report' : 'External standard'}
          </Badge>
        )}
        {withdrawn && (
          <Badge tone="danger" icon={IconRegistry.action.withdraw}>
            Withdrawn
          </Badge>
        )}
        <span />
        <IconButton icon="x" label="Close source" size="sm" onClick={onClose} />
      </div>
      <h3>{doc ? doc.title : 'Document details loading'}</h3>
      <dl className="rv-meta">
        {doc?.kind === 'standard' && doc.edition && (
          <>
            <dt>Edition</dt>
            <dd className="rv-mono">{doc.edition}</dd>
          </>
        )}
        {doc?.kind === 'report' && doc.date && (
          <>
            <dt>Report date</dt>
            <dd className="rv-mono">{calendarDate(doc.date)}</dd>
          </>
        )}
        <dt>{range?.includes('–') ? 'Pages' : 'Page'}</dt>
        <dd className="rv-mono">{range ?? 'Not recorded'}</dd>
      </dl>
      {doc?.newerEdition && (
        <Callout tone="warning" title="Newer edition available">
          A newer edition is in the knowledge base: {doc.newerEdition.title}
          {doc.newerEdition.edition ? ` (${doc.newerEdition.edition})` : ''}.
        </Callout>
      )}
      <span className="rv-passage-label">Quoted words</span>
      <blockquote className="rv-passage">{quote}</blockquote>
      {state === 'verified' && (
        <p className="chat-check">
          <Icon name={IconRegistry.action.accept} size={14} color="var(--status-low-fg)" />
          Quoted words found in the source
        </p>
      )}
      {state === 'checking' && <p className="rv-viewer-note">Checking the quoted words…</p>}
      {state === 'unverified' && (
        <Callout tone="danger" title="Unverified">
          These words weren't found in the cited passage. Check the source before relying on this
          statement.
        </Callout>
      )}
      {withdrawn && (
        <p className="rv-viewer-note">
          This edition has been withdrawn. It is only searched when you name it, so check whether a
          newer edition says the same.
        </p>
      )}
      <Tabs
        items={[
          { value: 'passage', label: 'Passage' },
          { value: 'pdf', label: 'PDF' },
        ]}
        value={tab}
        onChange={(value) => setPicked({ for: selected, tab: value })}
        style={{ marginTop: 'var(--space-6)' }}
      />
      <div role="tabpanel" aria-label={tab === 'pdf' ? 'PDF' : 'Passage'} className="chat-tabpanel">
        {loaded.status === 'loading' && <p className="rv-viewer-note">Loading the passage…</p>}
        {loaded.status === 'error' && (
          <p className="rv-viewer-note" role="alert">
            The passage couldn't be loaded. Use "Open the original PDF" below.
          </p>
        )}
        {loaded.status === 'ready' && tab === 'passage' && (
          <PassageText text={loaded.passage.text} quote={quote} />
        )}
        {loaded.status === 'ready' && tab === 'pdf' && !doc && (
          <p className="rv-viewer-note">
            The document's details haven't loaded, so its PDF can't be shown.
          </p>
        )}
        {loaded.status === 'ready' && tab === 'pdf' && doc && (
          <PdfErrorBoundary key={number}>
            <Suspense fallback={<p className="rv-viewer-note">Loading the page…</p>}>
              <PassagePdf fileUrl={doc.fileUrl} passage={loaded.passage} quote={quote} />
            </Suspense>
          </PdfErrorBoundary>
        )}
      </div>
      {doc && (
        <a
          className="rv-viewer-link"
          href={doc.fileUrl + (source?.pageStart != null ? `#page=${source.pageStart}` : '')}
          target="_blank"
          rel="noreferrer"
        >
          Open the original PDF{source?.pageStart != null ? ` at page ${source.pageStart}` : ''}
        </a>
      )}
    </aside>
  )
}
