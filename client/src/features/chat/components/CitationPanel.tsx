// The source panel beside the conversation (CB-01 AC1, AC2, AC14; CB-02): the opened
// citation's Passage tab (PassageDetails) and PDF tab (PdfViewer), and a handle to resize it
// against the chat (useSplitWidth). Shown by screens/KnowledgeAssistant.tsx. Wide screens dock
// it beside the chat; narrow ones, or Expand on the PDF tab, cover the chat (chat.css).
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, IconButton, Tabs } from '../../../design-system'
import { pages } from '../../assessments/reviewDisplay'
import type { SelectedCitation } from './citationSelection'
import { useDocument } from './documents'
import { PassageDetails } from './PassageDetails'
import { PdfErrorBoundary } from './PdfErrorBoundary'
import { loadPdfViewer } from './pdfViewerLoader'
import { usePassage } from './usePassage'
import { useSplitWidth, type SplitMode } from './useSplitWidth'

const PdfViewer = lazy(() => loadPdfViewer().then((m) => ({ default: m.PdfViewer })))

type Props = { selected: SelectedCitation; onClose: () => void }

/** The opened citation's source, beside the chat. */
export function CitationPanel({ selected, onClose }: Props) {
  const panel = useRef<HTMLElement>(null)
  const [screen, setScreen] = useState<HTMLElement | null>(null)
  const { number, quote, state, source } = selected
  const doc = useDocument(source?.documentId)
  // The tab chosen for this citation; a different citation opens on Passage again.
  const [picked, setPicked] = useState<{ for: SelectedCitation; tab: SplitMode } | null>(null)
  const tab = picked?.for === selected ? picked.tab : 'passage'
  // Expand covers the chat with the PDF; it only applies on the PDF tab.
  const [expandedFor, setExpandedFor] = useState<SelectedCitation | null>(null)
  const expanded = expandedFor === selected && tab === 'pdf'
  const handle = useSplitWidth(screen, tab)
  const loaded = usePassage(source?.passageId)
  // The quote check may omit a page; pages() takes a missing page as null.
  const range = source
    ? pages({ pageStart: source.pageStart ?? null, pageEnd: source.pageEnd ?? null })
    : null
  const ready = loaded.status === 'ready' ? loaded.passage : null
  // Shown in either tab while the passage loads or when it can't be loaded.
  const status =
    loaded.status === 'loading' ? (
      <p className="rv-viewer-note">Loading the passage…</p>
    ) : loaded.status === 'error' ? (
      <p className="rv-viewer-note" role="alert">
        The passage couldn't be loaded, so the quoted words can't be highlighted: “{quote}”.
        {doc && (
          <>
            {' '}
            <a href={doc.fileUrl} target="_blank" rel="noreferrer">
              Open the original PDF
            </a>
          </>
        )}
      </p>
    ) : null

  // The PDF tab's own wording when the passage can't be loaded, so the two tabs never show
  // the same note twice. While it loads, the viewer is already up (and fetching the file).
  const pdfStatus =
    loaded.status === 'error' ? (
      <p className="rv-viewer-note">
        The PDF can't be shown without its passage.
        {doc && (
          <>
            {' '}
            <a href={doc.fileUrl} target="_blank" rel="noreferrer">
              Open the original PDF
            </a>
          </>
        )}
      </p>
    ) : null

  // The chat screen holds the panel; its width is set there.
  useLayoutEffect(() => setScreen(panel.current?.parentElement ?? null), [])
  // Focus moves into the panel, so a keyboard user lands on what they opened.
  useEffect(() => panel.current?.focus(), [selected])
  // Escape steps back: out of the expanded PDF first, then closes the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // Escape while typing a question belongs to the composer, not the panel.
      const target = event.target as HTMLElement
      if (
        target.closest?.('input, textarea, [contenteditable]') &&
        !panel.current?.contains(target)
      )
        return
      if (expanded) setExpandedFor(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [expanded, onClose])

  return (
    <aside
      ref={panel}
      className="chat-source"
      data-tab={tab}
      data-expanded={expanded ? '' : undefined}
      aria-label={`Source of citation ${number}`}
      tabIndex={-1}
    >
      {/* On the panel's left edge, between it and the chat; shown only when docked. */}
      <div className="chat-split-handle" {...handle} />
      <div className="chat-source-bar">
        {/* Narrow screens: the panel covers the chat (chat.css), so the way back is spelled out. */}
        <Button
          className="chat-source-back"
          variant="ghost"
          size="sm"
          iconLeft="arrow-left"
          onClick={onClose}
        >
          Back to chat
        </Button>
        <Tabs
          items={[
            { value: 'passage', label: 'Passage' },
            { value: 'pdf', label: 'PDF' },
          ]}
          value={tab}
          onChange={(value) => {
            setPicked({ for: selected, tab: value as SplitMode })
          }}
          // The bar's own full-width line stands in for the tabs' shorter one.
          style={{ flex: 1, borderBottom: 0, marginBottom: -1 }}
        />
        <IconButton
          className="chat-source-close"
          icon="x"
          label="Close source"
          size="sm"
          onClick={onClose}
        />
      </div>
      <div
        role="tabpanel"
        aria-label="Passage"
        className="chat-tabpanel chat-tabpanel--passage"
        hidden={tab !== 'passage'}
      >
        <PassageDetails
          number={number}
          doc={doc}
          withdrawn={Boolean(source?.withdrawn || doc?.withdrawn)}
          range={range}
          state={state}
          quote={quote}
          passageText={ready?.text ?? null}
          status={status}
        />
      </div>
      <div
        role="tabpanel"
        aria-label="PDF"
        className="chat-tabpanel chat-tabpanel--pdf"
        hidden={tab !== 'pdf'}
      >
        {/* Mounted as soon as the citation opens, hidden behind Passage, even before the passage
            arrives: the PDF's index and the cited pages load while the engineer reads, so the
            PDF tab is usually ready on click, and switching tabs never loads it again. */}
        {pdfStatus ??
          (doc ? (
            <PdfErrorBoundary key={number}>
              <Suspense fallback={<div className="chat-pdf-scroll" />}>
                <PdfViewer
                  fileUrl={doc.fileUrl}
                  passage={ready}
                  quote={quote}
                  shown={tab === 'pdf'}
                  expanded={expanded}
                  onToggleExpand={() => setExpandedFor(expanded ? null : selected)}
                />
              </Suspense>
            </PdfErrorBoundary>
          ) : (
            <p className="rv-viewer-note">
              The document's details haven't loaded, so its PDF can't be shown.
            </p>
          ))}
      </div>
    </aside>
  )
}
